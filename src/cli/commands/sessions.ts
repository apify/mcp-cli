/**
 * Sessions command handlers
 */

import { createServer } from 'net';
import {
  OutputMode,
  isValidSessionName,
  generateSessionName,
  normalizeServerUrl,
  validateProfileName,
  isProcessAlive,
  getServerHost,
  redactHeaders,
} from '../../lib/index.js';
import { DISCONNECTED_THRESHOLD_MS } from '../../lib/types.js';
import type { ServerConfig, ProxyConfig } from '../../lib/types.js';
import {
  formatOutput,
  formatSuccess,
  formatWarning,
  formatError,
  formatSessionLine,
  formatServerDetails,
} from '../output.js';
import { withMcpClient, resolveTarget, resolveAuthProfile } from '../helpers.js';
import { listAuthProfiles } from '../../lib/auth/profiles.js';
import {
  sessionExists,
  deleteSession,
  saveSession,
  updateSession,
  consolidateSessions,
  getSession,
  loadSessions,
} from '../../lib/sessions.js';
import {
  startBridge,
  StartBridgeOptions,
  stopBridge,
  reconnectCrashedSessions,
} from '../../lib/bridge-manager.js';
import {
  storeKeychainSessionHeaders,
  storeKeychainProxyBearerToken,
} from '../../lib/auth/keychain.js';
import {
  AuthError,
  ClientError,
  isAuthenticationError,
  createServerAuthError,
} from '../../lib/index.js';
import { getWallet } from '../../lib/wallets.js';
import chalk from 'chalk';
import { createLogger } from '../../lib/logger.js';
import { parseProxyArg } from '../parser.js';

const logger = createLogger('sessions');

/**
 * Check if a port is available for binding
 */
async function checkPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        // Other errors (like permission denied) - treat as unavailable
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, host);
  });
}

/**
 * Find an existing session that matches the given server target and authentication settings.
 * Used when auto-generating session names to reuse existing sessions instead of creating duplicates.
 *
 * @returns The matching session name (with @ prefix), or undefined if no match found
 */
async function findMatchingSession(
  parsed: { type: 'url'; url: string } | { type: 'config'; file: string; entry: string },
  options: { profile?: string; headers?: string[]; noProfile?: boolean }
): Promise<string | undefined> {
  const storage = await loadSessions();
  const sessions = Object.values(storage.sessions);

  if (sessions.length === 0) return undefined;

  // Determine the effective profile name for comparison
  const effectiveProfile = options.noProfile ? undefined : (options.profile ?? 'default');

  for (const session of sessions) {
    if (!session.server) continue;

    // Match server target
    if (parsed.type === 'url') {
      if (!session.server.url) continue;
      // Compare normalized URLs
      try {
        const existingUrl = normalizeServerUrl(session.server.url);
        const newUrl = normalizeServerUrl(parsed.url);
        if (existingUrl !== newUrl) continue;
      } catch {
        continue;
      }
    } else {
      // Config entry: match by command (stdio transport)
      // Config entries produce stdio configs with command/args, so we can't easily
      // compare them. Instead, just compare generated session names for config targets.
      // This is handled by the caller (resolveSessionName) via name-based dedup.
      continue;
    }

    // Match profile
    const sessionProfile = session.profileName ?? 'default';
    if (effectiveProfile !== sessionProfile) continue;

    // Match header keys (values are redacted, so we only compare key sets)
    const existingHeaderKeys = Object.keys(session.server.headers || {}).sort();
    const newHeaderKeys = (options.headers || [])
      .map((h) => h.split(':')[0]?.trim() || '')
      .filter(Boolean)
      .sort();
    if (existingHeaderKeys.join(',') !== newHeaderKeys.join(',')) continue;

    // Found a match
    return session.name;
  }

  return undefined;
}

/**
 * Resolve the session name when @session is omitted from `mcpc connect`.
 * Finds an existing matching session or generates a new unique name.
 *
 * @returns Session name with @ prefix
 */
export async function resolveSessionName(
  parsed: { type: 'url'; url: string } | { type: 'config'; file: string; entry: string },
  options: {
    outputMode: OutputMode;
    profile?: string;
    headers?: string[];
    noProfile?: boolean;
  }
): Promise<string> {
  // First, check if an existing session matches this server + auth settings
  const existingName = await findMatchingSession(parsed, options);
  if (existingName) {
    return existingName;
  }

  // Generate a new session name
  const candidateName = generateSessionName(parsed);

  // Check if the candidate name is already taken by a different server
  const storage = await loadSessions();
  if (!(candidateName in storage.sessions)) {
    if (options.outputMode === 'human') {
      console.log(chalk.cyan(`Using session name: ${candidateName}`));
    }
    return candidateName;
  }

  // Name is taken - try suffixed variants
  for (let i = 2; i <= 99; i++) {
    const suffixed = `${candidateName}-${i}`;
    if (isValidSessionName(suffixed) && !(suffixed in storage.sessions)) {
      if (options.outputMode === 'human') {
        console.log(chalk.cyan(`Using session name: ${suffixed}`));
      }
      return suffixed;
    }
  }

  throw new ClientError(
    `Cannot auto-generate session name: too many sessions for this server.\n` +
      `Specify a name explicitly: mcpc connect ${parsed.type === 'url' ? parsed.url : `${parsed.file}:${parsed.entry}`} @my-session`
  );
}

/**
 * Creates a new session, starts a bridge process, and instructs it to connect an MCP server.
 * If session already exists with crashed bridge, reconnects it automatically
 */
export async function connectSession(
  target: string,
  name: string,
  options: {
    outputMode: OutputMode;
    verbose?: boolean;
    config?: string;
    headers?: string[];
    timeout?: number;
    profile?: string;
    noProfile?: boolean;
    proxy?: string;
    proxyBearerToken?: string;
    x402?: boolean;
    insecure?: boolean;
  }
): Promise<void> {
  // Validate session name
  if (!isValidSessionName(name)) {
    throw new ClientError(
      `Invalid session name: ${name}\n` +
        `Session names must start with @ and be followed by 1-64 characters, alphanumeric with hyphens or underscores only (e.g., @my-session).`
    );
  }

  // Validate profile name (if provided)
  if (options.profile) {
    validateProfileName(options.profile);
  }

  // Parse proxy configuration (if provided)
  let proxyConfig: ProxyConfig | undefined;
  if (options.proxy) {
    proxyConfig = parseProxyArg(options.proxy);
    logger.debug(`Proxy config: ${proxyConfig.host}:${proxyConfig.port}`);

    // Validate port is available before starting bridge
    const portAvailable = await checkPortAvailable(proxyConfig.host, proxyConfig.port);
    if (!portAvailable) {
      throw new ClientError(
        `Port ${proxyConfig.port} is already in use on ${proxyConfig.host}. ` +
          `Choose a different port with --proxy [host:]port`
      );
    }
  }

  // Validate proxy-bearer-token is only used with --proxy
  if (options.proxyBearerToken && !options.proxy) {
    throw new ClientError('--proxy-bearer-token requires --proxy to be specified');
  }

  // Check if session already exists
  const existingSession = await getSession(name);
  if (existingSession) {
    const bridgeStatus = getBridgeStatus(existingSession);

    if (bridgeStatus === 'live') {
      // Session exists and bridge is running - just show server info
      if (options.outputMode === 'human') {
        console.log(formatSuccess(`Session ${name} is already active`));
      }
      await showServerDetails(name, { ...options, hideTarget: false });
      return;
    }

    // Bridge has crashed or expired - reconnect with warning
    if (options.outputMode === 'human') {
      console.log(
        chalk.yellow(`Session ${name} exists but bridge is ${bridgeStatus}, reconnecting...`)
      );
    }

    // Clean up old bridge resources before reconnecting
    try {
      await stopBridge(name);
    } catch {
      // Bridge may already be stopped
    }
  }

  // Resolve target to transport config
  const serverConfig = await resolveTarget(target, options);

  // Detect conflicting auth flags: --profile and --header "Authorization: ..." are mutually exclusive
  const hasExplicitAuthHeader = serverConfig.headers?.Authorization !== undefined;
  const hasExplicitProfile = options.profile !== undefined;

  if (hasExplicitAuthHeader && hasExplicitProfile) {
    throw new ClientError(
      `Cannot combine --profile with --header "Authorization: ...".\n\n` +
        `Use either:\n` +
        `  --profile ${options.profile}  (OAuth authentication via saved profile)\n` +
        `  --header "Authorization: Bearer <token>"  (static bearer token)`
    );
  }

  // For HTTP targets, resolve auth profile (with helpful errors if none available)
  // Skip OAuth profile resolution when:
  // - --no-profile is specified (explicit anonymous connection)
  // - --header "Authorization: ..." is provided (explicit bearer token)
  // - --x402 is specified (x402 payment auth instead of OAuth)
  let profileName: string | undefined;
  if (serverConfig.url) {
    if (options.noProfile) {
      logger.debug('Skipping OAuth profile: --no-profile specified');
    } else if (hasExplicitAuthHeader) {
      logger.debug(
        'Skipping OAuth profile auto-detection: explicit Authorization header provided via --header'
      );
    } else if (options.x402 && !options.profile) {
      // When using --x402 without explicit --profile, don't try to auto-discover default profile
      // since x402 itself serves as the authentication mechanism
      logger.debug('Skipping OAuth profile auto-detection: --x402 specified');
    } else {
      profileName = await resolveAuthProfile(serverConfig.url, target, options.profile, {
        sessionName: name,
      });
    }
  }

  // Store headers in OS keychain (secure storage) before starting bridge
  let headers: Record<string, string> | undefined;
  if (Object.keys(serverConfig.headers || {}).length > 0) {
    headers = { ...serverConfig.headers };

    if (Object.keys(headers).length > 0) {
      logger.debug(
        `Storing ${Object.keys(headers).length} headers for session ${name} in keychain`
      );
      await storeKeychainSessionHeaders(name, headers);
    } else {
      headers = undefined;
    }
  }

  // Store proxy bearer token in keychain (if provided)
  if (options.proxyBearerToken) {
    logger.debug(`Storing proxy bearer token for session ${name} in keychain`);
    await storeKeychainProxyBearerToken(name, options.proxyBearerToken);
  }

  // Validate x402 wallet (if provided)
  if (options.x402) {
    const wallet = await getWallet();
    if (!wallet) {
      throw new ClientError('x402 wallet not found. Create one with: mcpc x402 init');
    }
    logger.debug(`Using x402 wallet: ${wallet.address}`);
  }

  // Create or update session record (without pid - that comes from startBridge)
  // Store serverConfig with headers redacted (actual values in keychain)
  const isReconnect = !!existingSession;
  const { headers: _originalHeaders, ...baseTransportConfig } = serverConfig;
  const sessionTransportConfig: ServerConfig = {
    ...baseTransportConfig,
    ...(headers && { headers: redactHeaders(headers) }),
  };

  const sessionUpdate: Parameters<typeof updateSession>[1] = {
    server: sessionTransportConfig,
    ...(profileName && { profileName }),
    ...(proxyConfig && { proxy: proxyConfig }),
    ...(options.x402 && { x402: true }),
    ...(options.insecure && { insecure: true }),
    // Clear any previous error status (unauthorized, expired) when reconnecting
    ...(isReconnect && { status: 'active' }),
  };

  if (isReconnect) {
    await updateSession(name, sessionUpdate);
    logger.debug(`Session record updated for reconnect: ${name}`);
  } else {
    await saveSession(name, {
      server: sessionTransportConfig,
      createdAt: new Date().toISOString(),
      status: 'connecting',
      lastConnectionAttemptAt: new Date().toISOString(),
      ...sessionUpdate,
    });
    logger.debug(`Initial session record created for: ${name}`);
  }

  // Start bridge process (handles spawning and IPC credential delivery)
  try {
    const bridgeOptions: StartBridgeOptions = {
      sessionName: name,
      serverConfig: serverConfig,
      verbose: options.verbose || false,
    };
    if (headers) {
      bridgeOptions.headers = headers;
    }
    if (profileName) {
      bridgeOptions.profileName = profileName;
    }
    if (proxyConfig) {
      bridgeOptions.proxyConfig = proxyConfig;
    }
    if (options.x402) {
      bridgeOptions.x402 = true;
    }
    if (options.insecure) {
      bridgeOptions.insecure = true;
    }

    const { pid } = await startBridge(bridgeOptions);

    // Update session with bridge info and mark as active (clears 'connecting' status)
    await updateSession(name, { pid, status: 'active' });
    logger.debug(`Session ${name} updated with bridge PID: ${pid}`);
  } catch (error) {
    // Clean up on bridge start failure
    logger.debug(`Bridge start failed, cleaning up session ${name}`);
    if (!isReconnect) {
      // Only delete session record for new sessions (not reconnects)
      try {
        await deleteSession(name);
      } catch {
        // Ignore cleanup errors
      }
    }
    throw error;
  }

  // Verify the connection works by fetching server details.
  // showServerDetails blocks until the bridge is connected (via health check),
  // so by the time it returns or throws, we have definitive bridge status.
  // Only print success after the server actually responds.
  try {
    await showServerDetails(name, {
      ...options,
      hideTarget: false, // Show session info prefix
    });

    // Server responded — now we can print success
    if (options.outputMode === 'human') {
      console.log(formatSuccess(`Session ${name} ${isReconnect ? 'reconnected' : 'created'}`));
    }
  } catch (detailsError) {
    if (detailsError instanceof AuthError) {
      throw detailsError;
    }
    // Fallback: check error message for auth patterns (error may have been wrapped
    // as ClientError/ServerError during bridge IPC serialization)
    if (detailsError instanceof Error && isAuthenticationError(detailsError.message)) {
      throw createServerAuthError(serverConfig.url || target, { sessionName: name });
    }

    // Non-auth failure: session was created but server didn't respond properly.
    // Show a warning instead of silent success, so the user knows something is wrong.
    if (options.outputMode === 'human') {
      const errorMsg = detailsError instanceof Error ? detailsError.message : String(detailsError);
      console.log(
        formatWarning(
          `Session ${name} created but server is not responding: ${errorMsg}\n` +
            `  The session will auto-recover when the server becomes available.\n` +
            `  Check status with: mcpc ${name}`
        )
      );
    }
    logger.debug(
      `showServerDetails failed for new session ${name}: ${(detailsError as Error).message}`
    );
  }
}

// DISCONNECTED_THRESHOLD_MS imported from ../../lib/types.js

export type DisplayStatus =
  | 'live'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'crashed'
  | 'unauthorized'
  | 'expired';

/**
 * Determine bridge status for a session
 */
export function getBridgeStatus(session: {
  status?: string;
  pid?: number;
  lastSeenAt?: string;
}): DisplayStatus {
  if (session.status === 'unauthorized') {
    return 'unauthorized';
  }
  if (session.status === 'expired') {
    return 'expired';
  }
  // Transient states: connecting (initial) or reconnecting (after crash)
  if (session.status === 'connecting' || session.status === 'reconnecting') {
    return session.status;
  }
  if (!session.pid || !isProcessAlive(session.pid)) {
    return 'crashed';
  }
  // Bridge is alive — check if server is actually responding
  if (session.lastSeenAt) {
    const lastSeenMs = Date.now() - new Date(session.lastSeenAt).getTime();
    if (lastSeenMs > DISCONNECTED_THRESHOLD_MS) {
      return 'disconnected';
    }
  }
  return 'live';
}

/**
 * Format bridge status for display with dot indicator
 */
export function formatBridgeStatus(status: DisplayStatus): { dot: string; text: string } {
  switch (status) {
    case 'live':
      return { dot: chalk.green('●'), text: chalk.green('live') };
    case 'connecting':
      return { dot: chalk.yellow('●'), text: chalk.yellow('connecting') };
    case 'reconnecting':
      return { dot: chalk.yellow('●'), text: chalk.yellow('reconnecting') };
    case 'disconnected':
      return { dot: chalk.yellow('●'), text: chalk.yellow('disconnected') };
    case 'crashed':
      return { dot: chalk.yellow('○'), text: chalk.yellow('crashed') };
    case 'unauthorized':
      return { dot: chalk.red('○'), text: chalk.red('unauthorized') };
    case 'expired':
      return { dot: chalk.red('○'), text: chalk.red('expired') };
  }
}

/**
 * Format time ago in human-friendly way
 */
export function formatTimeAgo(isoDate: string | undefined): string {
  if (!isoDate) return '';

  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

/**
 * List active sessions and authentication profiles
 * Consolidates session state first (cleans up crashed bridges, removes expired sessions)
 */
export async function listSessionsAndAuthProfiles(options: {
  outputMode: OutputMode;
}): Promise<void> {
  // Consolidate sessions first (cleans up crashed bridges, removes expired sessions)
  const consolidateResult = await consolidateSessions(false);
  const sessions = Object.values(consolidateResult.sessions);

  // Auto-restart crashed bridges in the background (fire-and-forget)
  reconnectCrashedSessions(consolidateResult.sessionsToRestart);

  // Load auth profiles from disk
  const profiles = await listAuthProfiles();

  if (options.outputMode === 'json') {
    // Add bridge status to JSON output
    const sessionsWithStatus = sessions.map((session) => ({
      ...session,
      status: getBridgeStatus(session),
    }));
    console.log(
      formatOutput(
        {
          sessions: sessionsWithStatus,
          profiles,
        },
        'json'
      )
    );
  } else {
    // Display sessions
    if (sessions.length === 0) {
      console.log(chalk.bold('No active MCP sessions.'));
      console.log(chalk.dim('  ↳ run: mcpc connect mcp.example.com @test'));
    } else {
      console.log(chalk.bold('MCP sessions:'));
      for (const session of sessions) {
        const status = getBridgeStatus(session);
        const { dot, text } = formatBridgeStatus(status);

        // Format status with time ago info (show for non-live states and stale live sessions)
        let statusStr = `${dot} ${text}`;
        if (session.lastSeenAt) {
          const lastSeenMs = Date.now() - new Date(session.lastSeenAt).getTime();
          const isStale = lastSeenMs > 5 * 60 * 1000; // 5 minutes
          if (status !== 'live' || isStale) {
            const timeAgo = formatTimeAgo(session.lastSeenAt);
            if (timeAgo) {
              statusStr += chalk.dim(`, ${timeAgo}`);
            }
          }
        }

        console.log(`  ${formatSessionLine(session)} ${statusStr}`);

        // Show recovery hints for non-live sessions
        if (status === 'unauthorized') {
          console.log(chalk.dim(`    ↳ run: mcpc ${session.name} restart`));
        } else if (status === 'crashed') {
          console.log(chalk.dim(`    ↳ run: mcpc ${session.name}`));
        } else if (status === 'expired') {
          console.log(chalk.dim(`    ↳ run: mcpc ${session.name} restart`));
        }
      }
    }

    // Display auth profiles
    console.log('');
    if (profiles.length === 0) {
      console.log(chalk.bold('No OAuth profiles.'));
      console.log(chalk.dim('  ↳ run: mcpc login mcp.example.com'));
    } else {
      console.log(chalk.bold('Saved OAuth profiles:'));
      for (const profile of profiles) {
        const hostStr = getServerHost(profile.serverUrl);
        const nameStr = chalk.magenta(profile.name);
        const userStr = profile.userEmail || profile.userName || '';
        // Show refreshedAt if available, otherwise createdAt
        const timeAgo = formatTimeAgo(profile.refreshedAt || profile.createdAt);
        const timeLabel = profile.refreshedAt ? 'refreshed' : 'created';

        let line = `  ${hostStr} / ${nameStr}`;
        if (userStr) {
          line += chalk.dim(` (${userStr})`);
        }
        if (timeAgo) {
          line += chalk.dim(`, ${timeLabel} ${timeAgo}`);
        }
        console.log(line);
      }
    }
  }
}

/**
 * Close a session
 */
export async function closeSession(
  name: string,
  options: { outputMode: OutputMode }
): Promise<void> {
  try {
    // Check if session exists
    if (!(await sessionExists(name))) {
      throw new ClientError(`Session not found: ${name}`);
    }

    // Stop the bridge process (graceful: send IPC shutdown on Windows so
    // the bridge can send HTTP DELETE to the server before exiting)
    await stopBridge(name, { graceful: true });

    // Delete session record from storage
    await deleteSession(name);

    // Success!
    if (options.outputMode === 'human') {
      console.log(formatSuccess(`Session ${name} closed successfully\n`));
    } else {
      console.log(
        formatOutput(
          {
            sessionName: name,
            closed: true,
          },
          'json'
        )
      );
    }
  } catch (error) {
    if (options.outputMode === 'human') {
      console.error(formatError((error as Error).message));
    } else {
      console.error(
        formatOutput(
          {
            sessionName: name,
            closed: false,
            error: (error as Error).message,
          },
          'json'
        )
      );
    }
    throw error;
  }
}

/**
 * Get server instructions and capabilities (also used for help command)
 */
export async function showServerDetails(
  target: string,
  options: {
    outputMode: OutputMode;
    config?: string;
    headers?: string[];
    timeout?: number;
    verbose?: boolean;
    hideTarget?: boolean;
  }
): Promise<void> {
  await withMcpClient(target, options, async (client, context) => {
    const serverDetails = await client.getServerDetails();
    const { serverInfo, capabilities, instructions, protocolVersion } = serverDetails;

    // Get tools list (uses bridge cache when available, no extra server call)
    const cachedToolsResult = await client.listAllTools();
    const tools = cachedToolsResult.tools;

    if (options.outputMode === 'human') {
      console.log(formatServerDetails(serverDetails, target, tools));
    } else {
      // JSON output MUST match MCP InitializeResult structure!
      // See https://modelcontextprotocol.io/specification/2025-11-25/schema#initializeresult
      // Build _mcpc.server with redacted headers for security
      const server: ServerConfig = {
        ...context.serverConfig,
        ...(context.serverConfig?.headers && {
          headers: redactHeaders(context.serverConfig.headers),
        }),
      };

      console.log(
        formatOutput(
          {
            _mcpc: {
              sessionName: context.sessionName,
              profileName: context.profileName,
              server,
            },
            protocolVersion,
            capabilities,
            serverInfo,
            instructions,
            ...(tools.length > 0 && { toolNames: tools.map((t) => t.name) }),
          },
          'json'
        )
      );
    }
  });
}

/**
 * Restart a session by stopping and restarting the bridge process
 */
export async function restartSession(
  name: string,
  options: { outputMode: OutputMode; verbose?: boolean }
): Promise<void> {
  try {
    // Get existing session
    const session = await getSession(name);

    if (!session) {
      throw new ClientError(`Session not found: ${name}`);
    }

    if (options.outputMode === 'human') {
      console.log(chalk.yellow(`Restarting session ${name}...`));
    }

    // Stop the bridge (even if it's alive)
    try {
      await stopBridge(name);
    } catch {
      // Bridge may already be stopped
    }

    // Get server config from session
    const serverConfig = session.server;
    if (!serverConfig) {
      throw new ClientError(`Session ${name} has no server configuration`);
    }

    // Load headers from keychain if present
    const { readKeychainSessionHeaders } = await import('../../lib/auth/keychain.js');
    const headers = await readKeychainSessionHeaders(name);

    // Start bridge process
    const bridgeOptions: StartBridgeOptions = {
      sessionName: name,
      serverConfig: { ...serverConfig, ...(headers && { headers }) },
      verbose: options.verbose || false,
    };

    if (headers) {
      bridgeOptions.headers = headers;
    }

    // Resolve auth profile: use stored profile, or auto-detect a "default" profile.
    // This handles the case where user creates a session without auth, then later runs
    // `mcpc login <server>` to create a default profile, and restarts the session.
    const hasExplicitAuthHeader = headers?.Authorization !== undefined;
    let profileName = session.profileName;
    if (!profileName && serverConfig.url && !hasExplicitAuthHeader && !session.x402) {
      profileName = await resolveAuthProfile(serverConfig.url, serverConfig.url, undefined, {
        sessionName: name,
      });
      if (profileName) {
        logger.debug(`Discovered auth profile "${profileName}" for session ${name}`);
        await updateSession(name, { profileName });
      }
    }

    if (profileName) {
      bridgeOptions.profileName = profileName;
    }

    if (session.proxy) {
      bridgeOptions.proxyConfig = session.proxy;
    }

    if (session.x402) {
      bridgeOptions.x402 = session.x402;
    }

    if (session.insecure) {
      bridgeOptions.insecure = session.insecure;
    }

    // NOTE: Do NOT pass mcpSessionId on explicit restart.
    // Explicit restart should create a fresh session, not try to resume the old one.
    // Session resumption is only attempted on automatic bridge restart (when bridge crashes
    // and CLI detects it). If server rejects the session ID, session is marked as expired.

    const { pid } = await startBridge(bridgeOptions);

    // Update session with new bridge PID and clear any expired/crashed status
    await updateSession(name, { pid, status: 'active' });
    logger.debug(`Session ${name} restarted with bridge PID: ${pid}`);

    // Success message
    if (options.outputMode === 'human') {
      console.log(formatSuccess(`Session ${name} restarted`));
    }

    // Show server details (like when creating a session)
    await showServerDetails(name, {
      ...options,
      hideTarget: false,
    });
  } catch (error) {
    if (options.outputMode === 'human') {
      console.error(formatError((error as Error).message));
    } else {
      console.error(
        formatOutput(
          {
            sessionName: name,
            restarted: false,
            error: (error as Error).message,
          },
          'json'
        )
      );
    }
    throw error;
  }
}

/**
 * Show help for a server (alias for getInstructions)
 */
/**
 * Open an interactive shell for a target
 */
export async function openShell(target: string): Promise<void> {
  // Import shell dynamically to avoid circular dependencies
  const { startShell } = await import('../shell.js');
  await startShell(target);
}
