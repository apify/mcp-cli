/**
 * OS Keychain integration for secure credential storage
 * Uses @napi-rs/keyring for cross-platform keychain access.
 * Falls back to ~/.mcpc/credentials.json (mode 0600) when the OS keychain
 * is unavailable (e.g. headless servers, containers).
 */

import { Entry } from '@napi-rs/keyring';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { createLogger, getJsonMode } from '../logger.js';
import { getServerHost, getMcpcHome } from '../utils.js';
import { withFileLock } from '../file-lock.js';

const logger = createLogger('keychain');
const SERVICE_NAME = 'mcpc';

// =============================================================================
// File-based fallback store
// =============================================================================

const credentialsPath = (): string => join(getMcpcHome(), 'credentials.json');

async function fileGet(account: string): Promise<string | null> {
  try {
    const data = JSON.parse(await readFile(credentialsPath(), 'utf8')) as Record<string, string>;
    return data[account] ?? null;
  } catch {
    return null;
  }
}

async function fileSet(account: string, value: string): Promise<void> {
  await withFileLock(credentialsPath(), async () => {
    const raw = await readFile(credentialsPath(), 'utf8').catch(() => '{}');
    const data = { ...(JSON.parse(raw) as Record<string, string>), [account]: value };
    await writeFile(credentialsPath(), JSON.stringify(data), { mode: 0o600 });
  });
}

async function fileDelete(account: string): Promise<boolean> {
  return withFileLock(credentialsPath(), async () => {
    const raw = await readFile(credentialsPath(), 'utf8').catch(() => '{}');
    const data = JSON.parse(raw) as Record<string, string>;
    if (!(account in data)) return false;
    delete data[account];
    await writeFile(credentialsPath(), JSON.stringify(data), { mode: 0o600 });
    return true;
  });
}

// =============================================================================
// Keychain wrappers with automatic file fallback
// =============================================================================

let keychainAvailable: boolean | null = null; // null = untested

function withKeychain<T>(keychainOp: () => T, fallback: () => Promise<T>): Promise<T> {
  if (keychainAvailable === false) return fallback();
  try {
    const result = keychainOp();
    keychainAvailable = true;
    return Promise.resolve(result);
  } catch (error) {
    if (keychainAvailable === null && !getJsonMode()) {
      logger.warn(
        `OS keychain unavailable (${(error as Error).message}), ` +
          `falling back to file-based credential storage (${credentialsPath()}). ` +
          `Install a keyring daemon (e.g. gnome-keyring or kwallet) for better security.`
      );
    }
    keychainAvailable = false;
    return fallback();
  }
}

function keychainSet(account: string, value: string): Promise<void> {
  return withKeychain(
    () => {
      new Entry(SERVICE_NAME, account).setPassword(value);
    },
    () => fileSet(account, value)
  );
}

function keychainGet(account: string): Promise<string | null> {
  return withKeychain(
    () => new Entry(SERVICE_NAME, account).getPassword() ?? null,
    () => fileGet(account)
  );
}

function keychainDelete(account: string): Promise<boolean> {
  return withKeychain(
    () => new Entry(SERVICE_NAME, account).deletePassword(),
    () => fileDelete(account)
  );
}

async function keychainGetParsed<T>(account: string, label: string): Promise<T | undefined> {
  const raw = await keychainGet(account);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.error(`Failed to parse ${label}: ${(error as Error).message}`);
    return undefined;
  }
}

// =============================================================================
// Types
// =============================================================================

export interface OAuthClientInfo {
  clientId: string;
  clientSecret?: string;
}

export interface OAuthTokenInfo {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  expiresAt?: number; // Unix timestamp
  scope?: string;
}

// =============================================================================
// Account name builders
// =============================================================================

const oauthClientAccount = (serverUrl: string, profileName: string): string =>
  `auth-profile:${getServerHost(serverUrl)}:${profileName}:client`;

const oauthTokensAccount = (serverUrl: string, profileName: string): string =>
  `auth-profile:${getServerHost(serverUrl)}:${profileName}:tokens`;

const sessionHeadersAccount = (sessionName: string): string => `session:${sessionName}:headers`;

const proxyBearerTokenAccount = (sessionName: string): string =>
  `session:${sessionName}:proxy-bearer-token`;

// =============================================================================
// Public API
// =============================================================================

/** Store OAuth client registration info for an auth profile. */
export async function storeKeychainOAuthClientInfo(
  serverUrl: string,
  profileName: string,
  client: OAuthClientInfo
): Promise<void> {
  logger.debug(`Storing OAuth client info for ${profileName} @ ${serverUrl}`);
  await keychainSet(oauthClientAccount(serverUrl, profileName), JSON.stringify(client));
}

/** Read OAuth client registration info for an auth profile. */
export async function readKeychainOAuthClientInfo(
  serverUrl: string,
  profileName: string
): Promise<OAuthClientInfo | undefined> {
  logger.debug(`Retrieving OAuth client info for ${profileName} @ ${serverUrl}`);
  return keychainGetParsed<OAuthClientInfo>(
    oauthClientAccount(serverUrl, profileName),
    'OAuth client info'
  );
}

/** Delete OAuth client registration info for an auth profile. */
export async function removeKeychainOAuthClientInfo(
  serverUrl: string,
  profileName: string
): Promise<boolean> {
  logger.debug(`Deleting OAuth client info for ${profileName} @ ${serverUrl}`);
  return keychainDelete(oauthClientAccount(serverUrl, profileName));
}

/** Store OAuth tokens for an auth profile. */
export async function storeKeychainOAuthTokenInfo(
  serverUrl: string,
  profileName: string,
  tokens: OAuthTokenInfo
): Promise<void> {
  logger.debug(`Storing OAuth tokens for ${profileName} @ ${serverUrl}`);
  await keychainSet(oauthTokensAccount(serverUrl, profileName), JSON.stringify(tokens));
}

/** Read OAuth tokens for an auth profile. */
export async function readKeychainOAuthTokenInfo(
  serverUrl: string,
  profileName: string
): Promise<OAuthTokenInfo | undefined> {
  logger.debug(`Retrieving OAuth tokens for ${profileName} @ ${serverUrl}`);
  return keychainGetParsed<OAuthTokenInfo>(
    oauthTokensAccount(serverUrl, profileName),
    'OAuth tokens'
  );
}

/** Delete OAuth tokens for an auth profile. */
export async function removeKeychainOAuthTokenInfo(
  serverUrl: string,
  profileName: string
): Promise<boolean> {
  logger.debug(`Deleting OAuth tokens for ${profileName} @ ${serverUrl}`);
  return keychainDelete(oauthTokensAccount(serverUrl, profileName));
}

/** Store custom HTTP headers for a session. */
export async function storeKeychainSessionHeaders(
  sessionName: string,
  headers: Record<string, string>
): Promise<void> {
  logger.debug(`Storing headers for session ${sessionName}`);
  await keychainSet(sessionHeadersAccount(sessionName), JSON.stringify(headers));
}

/** Read custom HTTP headers for a session. */
export async function readKeychainSessionHeaders(
  sessionName: string
): Promise<Record<string, string> | undefined> {
  logger.debug(`Retrieving headers for session ${sessionName}`);
  return keychainGetParsed<Record<string, string>>(
    sessionHeadersAccount(sessionName),
    'session headers'
  );
}

/** Delete custom HTTP headers for a session. */
export async function removeKeychainSessionHeaders(sessionName: string): Promise<boolean> {
  logger.debug(`Deleting headers for session ${sessionName}`);
  return keychainDelete(sessionHeadersAccount(sessionName));
}

/** Store the bearer token used to authenticate requests to the proxy server. */
export async function storeKeychainProxyBearerToken(
  sessionName: string,
  token: string
): Promise<void> {
  logger.debug(`Storing proxy bearer token for session ${sessionName}`);
  await keychainSet(proxyBearerTokenAccount(sessionName), token);
}

/** Read the bearer token used to authenticate requests to the proxy server. */
export async function readKeychainProxyBearerToken(
  sessionName: string
): Promise<string | undefined> {
  logger.debug(`Retrieving proxy bearer token for session ${sessionName}`);
  return (await keychainGet(proxyBearerTokenAccount(sessionName))) ?? undefined;
}

/** Delete the bearer token used to authenticate requests to the proxy server. */
export async function removeKeychainProxyBearerToken(sessionName: string): Promise<boolean> {
  logger.debug(`Deleting proxy bearer token for session ${sessionName}`);
  return keychainDelete(proxyBearerTokenAccount(sessionName));
}
