/**
 * OAuth 2.1 client_credentials grant flow for MCP.
 * Implements https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials
 *
 * This is a non-interactive flow for machine-to-machine authentication:
 * the client authenticates directly with client_id/client_secret and receives
 * an access token in a single POST to the token endpoint. No browser, no user.
 */

import { URL } from 'url';
import { normalizeServerUrl } from '../utils.js';
import { ClientError } from '../errors.js';
import { createLogger } from '../logger.js';
import {
  storeKeychainOAuthClientInfo,
  storeKeychainOAuthTokenInfo,
  removeKeychainOAuthTokenInfo,
  type OAuthTokenInfo,
} from './keychain.js';
import { getAuthProfile, saveAuthProfile } from './profiles.js';
import { discoverTokenEndpoint, requestClientCredentialsToken } from './oauth-utils.js';
import type { AuthProfile } from '../types.js';

const logger = createLogger('client-credentials-flow');

export interface ClientCredentialsFlowResult {
  profile: AuthProfile;
  success: boolean;
}

export interface ClientCredentialsFlowOptions {
  serverUrl: string;
  profileName: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  /**
   * Optional pre-supplied token endpoint. When omitted, mcpc discovers it via
   * OAuth/OIDC metadata at /.well-known/oauth-authorization-server (or openid-configuration).
   */
  tokenEndpoint?: string;
}

/**
 * Perform the OAuth client_credentials flow:
 *   1. Discover (or use supplied) token endpoint
 *   2. POST grant_type=client_credentials with the supplied client_id / client_secret
 *   3. Persist the client credentials and resulting access token to the OS keychain
 *   4. Write (or update) the auth profile metadata
 */
export async function performClientCredentialsFlow(
  options: ClientCredentialsFlowOptions
): Promise<ClientCredentialsFlowResult> {
  const normalizedServerUrl = normalizeServerUrl(options.serverUrl);
  const { profileName, clientId, clientSecret, scope } = options;

  logger.debug(
    `Starting client_credentials flow for ${normalizedServerUrl} (profile: ${profileName})`
  );

  // Warn about OAuth over plain HTTP (except localhost). Client credentials
  // travel in the request body, so HTTPS is strongly recommended in production.
  const parsedUrl = new URL(normalizedServerUrl);
  if (
    parsedUrl.protocol === 'http:' &&
    parsedUrl.hostname !== 'localhost' &&
    parsedUrl.hostname !== '127.0.0.1'
  ) {
    console.warn(
      '\nWarning: OAuth client_credentials over plain HTTP is insecure. ' +
        'Only use for local development.\n'
    );
  }

  // Resolve token endpoint (pre-supplied or discovered)
  let tokenEndpoint = options.tokenEndpoint;
  if (!tokenEndpoint) {
    logger.debug(`Discovering token endpoint for ${normalizedServerUrl}...`);
    tokenEndpoint = await discoverTokenEndpoint(normalizedServerUrl);
    if (!tokenEndpoint) {
      throw new ClientError(
        `Could not discover OAuth token endpoint for ${normalizedServerUrl}. ` +
          `Pass --token-endpoint <url> to specify it explicitly.`
      );
    }
    logger.debug(`Discovered token endpoint: ${tokenEndpoint}`);
  }

  // Request the access token
  const tokenResponse = await requestClientCredentialsToken(
    tokenEndpoint,
    clientId,
    clientSecret,
    scope
  );

  // Persist client credentials (used for re-issuing tokens on expiry).
  // Replace any existing tokens from a previous (different-grant) login.
  await storeKeychainOAuthClientInfo(normalizedServerUrl, profileName, {
    clientId,
    clientSecret,
  });
  await removeKeychainOAuthTokenInfo(normalizedServerUrl, profileName);

  const tokenInfo: OAuthTokenInfo = {
    accessToken: tokenResponse.access_token,
    tokenType: tokenResponse.token_type || 'Bearer',
  };
  if (tokenResponse.expires_in !== undefined) {
    tokenInfo.expiresIn = tokenResponse.expires_in;
    tokenInfo.expiresAt = Math.floor(Date.now() / 1000) + tokenResponse.expires_in;
  }
  if (tokenResponse.scope !== undefined) {
    tokenInfo.scope = tokenResponse.scope;
  }
  // Most client_credentials responses omit refresh_token; honour it if present.
  if (tokenResponse.refresh_token !== undefined) {
    tokenInfo.refreshToken = tokenResponse.refresh_token;
  }
  await storeKeychainOAuthTokenInfo(normalizedServerUrl, profileName, tokenInfo);

  // Create/update profile metadata
  const now = new Date().toISOString();
  const existing = await getAuthProfile(normalizedServerUrl, profileName);

  const profile: AuthProfile = existing
    ? { ...existing, authType: 'oauth-client-credentials', authenticatedAt: now }
    : {
        name: profileName,
        serverUrl: normalizedServerUrl,
        authType: 'oauth-client-credentials',
        oauthIssuer: '',
        createdAt: now,
        authenticatedAt: now,
      };

  // Record the token endpoint so runtime token re-issuance can skip discovery.
  profile.tokenEndpoint = tokenEndpoint;

  // Prefer scopes granted by the server; fall back to the scopes requested by the caller.
  if (tokenResponse.scope) {
    profile.scopes = tokenResponse.scope.split(' ').filter(Boolean);
  } else if (scope) {
    profile.scopes = scope.split(' ').filter(Boolean);
  }

  await saveAuthProfile(profile);
  logger.debug('client_credentials flow completed successfully');

  return { profile, success: true };
}
