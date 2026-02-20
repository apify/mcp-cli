/**
 * OS Keychain integration for secure credential storage
 * Uses @napi-rs/keyring package for cross-platform keychain access
 */

import { Entry } from "@napi-rs/keyring";
import { createLogger } from "../logger.js";
import { getServerHost } from "../utils.js";

const logger = createLogger("keychain");

// Service name for all mcpc credentials in the keychain
const SERVICE_NAME = "mcpc";

/**
 * OAuth client information (from dynamic registration)
 */
export interface OAuthClientInfo {
	clientId: string;
	clientSecret?: string;
}

/**
 * OAuth tokens
 */
export interface OAuthTokenInfo {
	accessToken: string;
	refreshToken?: string;
	tokenType: string;
	expiresIn?: number;
	expiresAt?: number; // Unix timestamp
	scope?: string;
}

/**
 * Get a keychain account name for OAuth client info
 * Uses getServerHost() to normalize the server URL to a canonical host
 */
function buildOAuthClientAccountName(
	serverUrl: string,
	profileName: string,
): string {
	const host = getServerHost(serverUrl);
	return `auth-profile:${host}:${profileName}:client`;
}

/**
 * Get a keychain account name for OAuth tokens
 * Uses getServerHost() to normalize the server URL to a canonical host
 */
function buildOAuthTokensAccountName(
	serverUrl: string,
	profileName: string,
): string {
	const host = getServerHost(serverUrl);
	return `auth-profile:${host}:${profileName}:tokens`;
}

/**
 * Get a keychain account name for session headers
 */
function buildSessionAccountName(sessionName: string): string {
	return `session:${sessionName}:headers`;
}

/**
 * Get a keychain account name for proxy bearer token
 */
function buildProxyBearerTokenAccountName(sessionName: string): string {
	return `session:${sessionName}:proxy-bearer-token`;
}

/**
 * Store OAuth client info in keychain
 */
export async function storeKeychainOAuthClientInfo(
	serverUrl: string,
	profileName: string,
	client: OAuthClientInfo,
): Promise<void> {
	const account = buildOAuthClientAccountName(serverUrl, profileName);
	const value = JSON.stringify(client);

	logger.debug(`Storing OAuth client info for ${profileName} @ ${serverUrl}`);
	new Entry(SERVICE_NAME, account).setPassword(value);
}

/**
 * Get OAuth client info from keychain
 */
export async function readKeychainOAuthClientInfo(
	serverUrl: string,
	profileName: string,
): Promise<OAuthClientInfo | undefined> {
	const account = buildOAuthClientAccountName(serverUrl, profileName);

	logger.debug(
		`Retrieving OAuth client info for ${profileName} @ ${serverUrl}`,
	);

	let value: string | null;
	try {
		value = new Entry(SERVICE_NAME, account).getPassword();
	} catch {
		return undefined;
	}

	if (!value) {
		return undefined;
	}

	try {
		return JSON.parse(value) as OAuthClientInfo;
	} catch (error) {
		logger.error(
			`Failed to parse OAuth client info from keychain: ${(error as Error).message}`,
		);
		return undefined;
	}
}

/**
 * Delete OAuth client info from keychain
 */
export async function removeKeychainOAuthClientInfo(
	serverUrl: string,
	profileName: string,
): Promise<boolean> {
	const account = buildOAuthClientAccountName(serverUrl, profileName);

	logger.debug(`Deleting OAuth client info for ${profileName} @ ${serverUrl}`);
	try {
		new Entry(SERVICE_NAME, account).deletePassword();
		return true;
	} catch {
		return false;
	}
}

/**
 * Store OAuth tokens in keychain
 * TODO: The operations on Keychain should be done under profiles file lock, to ensure atomocity...
 */
export async function storeKeychainOAuthTokenInfo(
	serverUrl: string,
	profileName: string,
	tokens: OAuthTokenInfo,
): Promise<void> {
	const account = buildOAuthTokensAccountName(serverUrl, profileName);
	const value = JSON.stringify(tokens);

	logger.debug(`Storing OAuth tokens for ${profileName} @ ${serverUrl}`);
	new Entry(SERVICE_NAME, account).setPassword(value);
}

/**
 * Get OAuth tokens from keychain
 */
export async function readKeychainOAuthTokenInfo(
	serverUrl: string,
	profileName: string,
): Promise<OAuthTokenInfo | undefined> {
	const account = buildOAuthTokensAccountName(serverUrl, profileName);

	logger.debug(`Retrieving OAuth tokens for ${profileName} @ ${serverUrl}`);

	let value: string | null;
	try {
		value = new Entry(SERVICE_NAME, account).getPassword();
	} catch {
		return undefined;
	}

	if (!value) {
		return undefined;
	}

	try {
		return JSON.parse(value) as OAuthTokenInfo;
	} catch (error) {
		logger.error(
			`Failed to parse OAuth tokens from keychain: ${(error as Error).message}`,
		);
		return undefined;
	}
}

/**
 * Delete OAuth tokens from keychain
 */
export async function removeKeychainOAuthTokenInfo(
	serverUrl: string,
	profileName: string,
): Promise<boolean> {
	const account = buildOAuthTokensAccountName(serverUrl, profileName);

	logger.debug(`Deleting OAuth tokens for ${profileName} @ ${serverUrl}`);
	try {
		new Entry(SERVICE_NAME, account).deletePassword();
		return true;
	} catch {
		return false;
	}
}

/**
 * Store HTTP headers for a session in keychain
 * All headers from --header flags are treated as potentially sensitive
 */
export async function storeKeychainSessionHeaders(
	sessionName: string,
	headers: Record<string, string>,
): Promise<void> {
	const account = buildSessionAccountName(sessionName);
	const value = JSON.stringify(headers);

	logger.debug(`Storing headers for session ${sessionName}`);
	new Entry(SERVICE_NAME, account).setPassword(value);
}

/**
 * Retrieve HTTP headers for a session from keychain
 */
export async function readKeychainSessionHeaders(
	sessionName: string,
): Promise<Record<string, string> | undefined> {
	const account = buildSessionAccountName(sessionName);

	logger.debug(`Retrieving headers for session ${sessionName}`);

	let value: string | null;
	try {
		value = new Entry(SERVICE_NAME, account).getPassword();
	} catch {
		return undefined;
	}

	if (!value) {
		return undefined;
	}

	try {
		return JSON.parse(value) as Record<string, string>;
	} catch (error) {
		logger.error(
			`Failed to parse headers from keychain: ${(error as Error).message}`,
		);
		return undefined;
	}
}

/**
 * Delete HTTP headers for a session from keychain
 */
export async function removeKeychainSessionHeaders(
	sessionName: string,
): Promise<boolean> {
	const account = buildSessionAccountName(sessionName);

	logger.debug(`Deleting headers for session ${sessionName}`);
	try {
		new Entry(SERVICE_NAME, account).deletePassword();
		return true;
	} catch {
		return false;
	}
}

/**
 * Store proxy bearer token for a session in keychain
 * Used to secure the proxy MCP server with authentication
 */
export async function storeKeychainProxyBearerToken(
	sessionName: string,
	token: string,
): Promise<void> {
	const account = buildProxyBearerTokenAccountName(sessionName);

	logger.debug(`Storing proxy bearer token for session ${sessionName}`);
	new Entry(SERVICE_NAME, account).setPassword(token);
}

/**
 * Retrieve proxy bearer token for a session from keychain
 */
export async function readKeychainProxyBearerToken(
	sessionName: string,
): Promise<string | undefined> {
	const account = buildProxyBearerTokenAccountName(sessionName);

	logger.debug(`Retrieving proxy bearer token for session ${sessionName}`);
	try {
		return new Entry(SERVICE_NAME, account).getPassword() || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Delete proxy bearer token for a session from keychain
 */
export async function removeKeychainProxyBearerToken(
	sessionName: string,
): Promise<boolean> {
	const account = buildProxyBearerTokenAccountName(sessionName);

	logger.debug(`Deleting proxy bearer token for session ${sessionName}`);
	try {
		new Entry(SERVICE_NAME, account).deletePassword();
		return true;
	} catch {
		return false;
	}
}
