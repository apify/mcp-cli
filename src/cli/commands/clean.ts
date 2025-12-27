/**
 * Clean command handlers
 * Cleans up mcpc data (sessions, profiles, logs, sockets)
 */

import { readdir, unlink, rm } from 'fs/promises';
import { join } from 'path';
import type { OutputMode } from '../../lib/index.js';
import { getMcpcHome, getBridgesDir, getLogsDir, isProcessAlive, fileExists } from '../../lib/index.js';
import { formatOutput, formatSuccess } from '../output.js';
import { loadSessions, deleteSession } from '../../lib/sessions.js';
import { stopBridge } from '../../lib/bridge-manager.js';
import { removeKeychainSessionHeaders } from '../../lib/auth/keychain.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('clean');

interface CleanOptions {
  outputMode: OutputMode;
  sessions?: boolean;
  profiles?: boolean;
  logs?: boolean;
  all?: boolean;
}

interface CleanResult {
  staleSockets: number;
  deadBridges: number;
  sessions: number;
  profiles: number;
  logs: number;
}

/**
 * Safe cleanup: remove stale sockets and dead bridge processes
 * This is non-destructive - only cleans up orphaned resources
 */
async function cleanStale(): Promise<{ staleSockets: number; deadBridges: number }> {
  let staleSockets = 0;
  let deadBridges = 0;

  // Load sessions
  const sessionsStorage = await loadSessions();
  const sessions = sessionsStorage.sessions;

  // Check each session for dead bridges
  for (const [name, session] of Object.entries(sessions)) {
    if (session.pid && !isProcessAlive(session.pid)) {
      logger.debug(`Found dead bridge for session ${name} (PID: ${session.pid})`);
      deadBridges++;

      // Remove socket file if it exists
      if (session.socketPath && (await fileExists(session.socketPath))) {
        try {
          await unlink(session.socketPath);
          staleSockets++;
          logger.debug(`Removed stale socket: ${session.socketPath}`);
        } catch {
          // Ignore errors
        }
      }

      // Note: We don't update the session record here since pid/socketPath
      // will be overwritten when a new bridge starts. The important cleanup
      // is removing the stale socket file (done above).
    }
  }

  // Also clean up orphaned socket files (sockets with no matching session)
  const bridgesDir = getBridgesDir();
  if (await fileExists(bridgesDir)) {
    const files = await readdir(bridgesDir);
    for (const file of files) {
      if (file.endsWith('.sock')) {
        const sessionName = file.replace('.sock', '');
        if (!sessions[sessionName]) {
          try {
            await unlink(join(bridgesDir, file));
            staleSockets++;
            logger.debug(`Removed orphaned socket: ${file}`);
          } catch {
            // Ignore errors
          }
        }
      }
    }
  }

  return { staleSockets, deadBridges };
}

/**
 * Clean all sessions (closes bridges, removes session records and keychain data)
 */
async function cleanSessions(): Promise<number> {
  const sessionsStorage = await loadSessions();
  const sessionNames = Object.keys(sessionsStorage.sessions);
  let count = 0;

  for (const name of sessionNames) {
    try {
      // Stop the bridge if running
      try {
        await stopBridge(name);
      } catch {
        // Bridge may already be stopped
      }

      // Delete session record
      await deleteSession(name);

      // Remove keychain data
      try {
        await removeKeychainSessionHeaders(name);
      } catch {
        // May not have keychain data
      }

      count++;
      logger.debug(`Cleaned session: ${name}`);
    } catch (error) {
      logger.warn(`Failed to clean session ${name}:`, error);
    }
  }

  return count;
}

/**
 * Clean all authentication profiles
 */
async function cleanProfiles(): Promise<number> {
  const mcpcHome = getMcpcHome();
  const profilesFile = join(mcpcHome, 'auth-profiles.json');

  if (!(await fileExists(profilesFile))) {
    return 0;
  }

  try {
    await unlink(profilesFile);
    logger.debug('Removed auth-profiles.json');
    // TODO: Also clean keychain entries for OAuth tokens
    return 1;
  } catch {
    return 0;
  }
}

/**
 * Clean all log files
 */
async function cleanLogs(): Promise<number> {
  const logsDir = getLogsDir();

  if (!(await fileExists(logsDir))) {
    return 0;
  }

  let count = 0;
  const files = await readdir(logsDir);

  for (const file of files) {
    if (file.endsWith('.log') || file.match(/\.log\.\d+$/)) {
      try {
        await unlink(join(logsDir, file));
        count++;
      } catch {
        // Ignore errors
      }
    }
  }

  logger.debug(`Removed ${count} log files`);
  return count;
}

/**
 * Clean the entire ~/.mcpc directory using proper cleanup functions
 */
async function cleanAll(): Promise<CleanResult> {
  const result: CleanResult = {
    staleSockets: 0,
    deadBridges: 0,
    sessions: 0,
    profiles: 0,
    logs: 0,
  };

  // Clean sessions first (stops bridges, removes keychain data)
  result.sessions = await cleanSessions();

  // Clean auth profiles
  result.profiles = await cleanProfiles();

  // Clean logs
  result.logs = await cleanLogs();

  // Clean any remaining stale sockets
  const staleResult = await cleanStale();
  result.staleSockets = staleResult.staleSockets;
  result.deadBridges = staleResult.deadBridges;

  // Remove any remaining empty directories
  const mcpcHome = getMcpcHome();
  const bridgesDir = getBridgesDir();
  const logsDir = getLogsDir();

  for (const dir of [bridgesDir, logsDir]) {
    if (await fileExists(dir)) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore errors
      }
    }
  }

  // Try to remove mcpc home if empty
  if (await fileExists(mcpcHome)) {
    try {
      const files = await readdir(mcpcHome);
      if (files.length === 0) {
        await rm(mcpcHome, { recursive: true, force: true });
        logger.debug(`Removed empty ${mcpcHome}`);
      }
    } catch {
      // Ignore errors
    }
  }

  return result;
}

/**
 * Main clean command handler
 */
export async function clean(options: CleanOptions): Promise<void> {
  const result: CleanResult = {
    staleSockets: 0,
    deadBridges: 0,
    sessions: 0,
    profiles: 0,
    logs: 0,
  };

  // --all overrides everything
  if (options.all) {
    const allResult = await cleanAll();

    if (options.outputMode === 'human') {
      const parts: string[] = [];
      if (allResult.sessions > 0) parts.push(`${allResult.sessions} session(s)`);
      if (allResult.profiles > 0) parts.push(`${allResult.profiles} profile(s)`);
      if (allResult.logs > 0) parts.push(`${allResult.logs} log file(s)`);
      if (allResult.staleSockets > 0) parts.push(`${allResult.staleSockets} socket(s)`);

      if (parts.length > 0) {
        console.log(formatSuccess(`Cleaned ${parts.join(', ')}`));
      } else {
        console.log(formatSuccess('Nothing to clean'));
      }
    } else {
      console.log(formatOutput(allResult, 'json'));
    }
    return;
  }

  // Determine what to clean
  const cleaningSpecific = options.sessions || options.profiles || options.logs;

  // Always do safe cleanup unless specific options are provided
  if (!cleaningSpecific) {
    const staleResult = await cleanStale();
    result.staleSockets = staleResult.staleSockets;
    result.deadBridges = staleResult.deadBridges;
  }

  // Clean specific resources if requested
  if (options.sessions) {
    result.sessions = await cleanSessions();
  }

  if (options.profiles) {
    result.profiles = await cleanProfiles();
  }

  if (options.logs) {
    result.logs = await cleanLogs();
  }

  // Output results
  if (options.outputMode === 'human') {
    const messages: string[] = [];

    if (!cleaningSpecific) {
      if (result.deadBridges > 0 || result.staleSockets > 0) {
        messages.push(`Cleaned ${result.deadBridges} dead bridge(s), ${result.staleSockets} stale socket(s)`);
      } else {
        messages.push('No stale resources found');
      }
    }

    if (options.sessions) {
      messages.push(`Removed ${result.sessions} session(s)`);
    }

    if (options.profiles) {
      messages.push(result.profiles > 0 ? 'Removed authentication profiles' : 'No profiles to remove');
    }

    if (options.logs) {
      messages.push(`Removed ${result.logs} log file(s)`);
    }

    for (const msg of messages) {
      console.log(formatSuccess(msg));
    }
  } else {
    console.log(formatOutput(result, 'json'));
  }
}
