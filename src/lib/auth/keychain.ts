/**
 * OS Keychain integration for secure credential storage
 * Uses keytar package for cross-platform keychain access
 */

import keytar from 'keytar';
import { createLogger } from '../logger.js';

const logger = createLogger('keychain');

// Service name for all mcpc credentials in the keychain
const SERVICE_NAME = 'mcpc';

/**
 * Build a keychain account name for OAuth credentials
 * Format: auth:<serverUrl>:<profileName>
 */
function buildOAuthAccountName(serverUrl: string, profileName: string): string {
  return `auth:${serverUrl}:${profileName}`;
}

/**
 * Build a keychain account name for session headers
 * Format: session:<sessionName>:headers
 */
function buildSessionAccountName(sessionName: string): string {
  return `session:${sessionName}:headers`;
}

/**
 * OAuth credentials stored in keychain (client info + tokens)
 */
export interface KeychainOAuthCredentials {
  // Client info (from dynamic registration)
  clientId: string;
  clientSecret?: string;
  // Tokens
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  expiresAt?: number; // Unix timestamp
  scope?: string;
}

/**
 * Store OAuth credentials in keychain
 */
export async function storeKeychainOAuthCredentials(
  serverUrl: string,
  profileName: string,
  credentials: KeychainOAuthCredentials
): Promise<void> {
  const account = buildOAuthAccountName(serverUrl, profileName);
  const value = JSON.stringify(credentials);

  logger.debug(`Storing OAuth credentials for ${profileName} @ ${serverUrl}`);
  await keytar.setPassword(SERVICE_NAME, account, value);
}

/**
 * Retrieve OAuth credentials from keychain
 */
export async function getKeychainOAuthCredentials(
  serverUrl: string,
  profileName: string
): Promise<KeychainOAuthCredentials | undefined> {
  const account = buildOAuthAccountName(serverUrl, profileName);

  logger.debug(`Retrieving OAuth credentials for ${profileName} @ ${serverUrl}`);
  const value = await keytar.getPassword(SERVICE_NAME, account);

  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as KeychainOAuthCredentials;
  } catch (error) {
    logger.error(`Failed to parse OAuth credentials from keychain: ${(error as Error).message}`);
    return undefined;
  }
}

/**
 * Delete OAuth credentials from keychain
 */
export async function deleteKeychainOAuthCredentials(
  serverUrl: string,
  profileName: string
): Promise<boolean> {
  const account = buildOAuthAccountName(serverUrl, profileName);

  logger.debug(`Deleting OAuth credentials for ${profileName} @ ${serverUrl}`);
  return keytar.deletePassword(SERVICE_NAME, account);
}

/**
 * OAuth client information (subset of credentials for partial updates)
 */
export interface OAuthClientInfo {
  clientId: string;
  clientSecret?: string;
}

/**
 * OAuth tokens (subset of credentials for partial updates)
 */
export interface OAuthTokenInfo {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  expiresAt?: number;
  scope?: string;
}

/**
 * Store OAuth client info, preserving existing tokens
 * Used after dynamic client registration (before tokens exist)
 */
export async function saveKeychainOAuthClient(
  serverUrl: string,
  profileName: string,
  client: OAuthClientInfo
): Promise<void> {
  const existing = await getKeychainOAuthCredentials(serverUrl, profileName);

  // Build credentials, only including defined values
  const credentials: KeychainOAuthCredentials = {
    accessToken: existing?.accessToken ?? '',
    tokenType: existing?.tokenType ?? 'Bearer',
    clientId: client.clientId,
  };

  // Preserve existing token fields if any
  if (existing?.refreshToken) credentials.refreshToken = existing.refreshToken;
  if (existing?.expiresIn !== undefined) credentials.expiresIn = existing.expiresIn;
  if (existing?.expiresAt !== undefined) credentials.expiresAt = existing.expiresAt;
  if (existing?.scope) credentials.scope = existing.scope;

  // Add client secret if provided
  if (client.clientSecret) credentials.clientSecret = client.clientSecret;

  await storeKeychainOAuthCredentials(serverUrl, profileName, credentials);
}

/**
 * Get OAuth client info from keychain
 */
export async function getKeychainOAuthClient(
  serverUrl: string,
  profileName: string
): Promise<OAuthClientInfo | undefined> {
  const credentials = await getKeychainOAuthCredentials(serverUrl, profileName);
  if (!credentials?.clientId) {
    return undefined;
  }
  const result: OAuthClientInfo = {
    clientId: credentials.clientId,
  };
  if (credentials.clientSecret) {
    result.clientSecret = credentials.clientSecret;
  }
  return result;
}

/**
 * Store OAuth tokens, preserving existing client info
 * Used after OAuth flow completes
 */
export async function saveKeychainOAuthTokens(
  serverUrl: string,
  profileName: string,
  tokens: OAuthTokenInfo
): Promise<void> {
  const existing = await getKeychainOAuthCredentials(serverUrl, profileName);

  if (!existing?.clientId) {
    throw new Error(`Cannot save tokens without client info for ${profileName} @ ${serverUrl}`);
  }

  // Build credentials, only including defined values
  const credentials: KeychainOAuthCredentials = {
    clientId: existing.clientId,
    accessToken: tokens.accessToken,
    tokenType: tokens.tokenType,
  };

  // Preserve client secret if exists
  if (existing.clientSecret) credentials.clientSecret = existing.clientSecret;

  // Add token fields if provided
  if (tokens.refreshToken) credentials.refreshToken = tokens.refreshToken;
  if (tokens.expiresIn !== undefined) credentials.expiresIn = tokens.expiresIn;
  if (tokens.expiresAt !== undefined) credentials.expiresAt = tokens.expiresAt;
  if (tokens.scope) credentials.scope = tokens.scope;

  await storeKeychainOAuthCredentials(serverUrl, profileName, credentials);
}

/**
 * Get OAuth tokens from keychain
 */
export async function getKeychainOAuthTokens(
  serverUrl: string,
  profileName: string
): Promise<OAuthTokenInfo | undefined> {
  const credentials = await getKeychainOAuthCredentials(serverUrl, profileName);
  if (!credentials?.accessToken) {
    return undefined;
  }
  const result: OAuthTokenInfo = {
    accessToken: credentials.accessToken,
    tokenType: credentials.tokenType,
  };
  if (credentials.refreshToken) result.refreshToken = credentials.refreshToken;
  if (credentials.expiresIn !== undefined) result.expiresIn = credentials.expiresIn;
  if (credentials.expiresAt !== undefined) result.expiresAt = credentials.expiresAt;
  if (credentials.scope) result.scope = credentials.scope;
  return result;
}

/**
 * Store HTTP headers for a session in keychain
 * All headers from --header flags are treated as potentially sensitive
 */
export async function storeKeychainSessionHeaders(
  sessionName: string,
  headers: Record<string, string>
): Promise<void> {
  const account = buildSessionAccountName(sessionName);
  const value = JSON.stringify(headers);

  logger.debug(`Storing headers for session ${sessionName}`);
  await keytar.setPassword(SERVICE_NAME, account, value);
}

/**
 * Retrieve HTTP headers for a session from keychain
 */
export async function getKeychainSessionHeaders(
  sessionName: string
): Promise<Record<string, string> | undefined> {
  const account = buildSessionAccountName(sessionName);

  logger.debug(`Retrieving headers for session ${sessionName}`);
  const value = await keytar.getPassword(SERVICE_NAME, account);

  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as Record<string, string>;
  } catch (error) {
    logger.error(`Failed to parse headers from keychain: ${(error as Error).message}`);
    return undefined;
  }
}

/**
 * Delete HTTP headers for a session from keychain
 */
export async function deleteKeychainSessionHeaders(sessionName: string): Promise<boolean> {
  const account = buildSessionAccountName(sessionName);

  logger.debug(`Deleting headers for session ${sessionName}`);
  return keytar.deletePassword(SERVICE_NAME, account);
}
