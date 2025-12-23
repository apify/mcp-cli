/**
 * Token refresh functionality for OAuth profiles
 * Handles automatic refresh of expired access tokens using refresh tokens
 * Tokens are stored securely in OS keychain
 */

import type { AuthProfile, OAuthTokens } from '../types.js';
import { saveAuthProfile } from '../auth-profiles.js';
import { createLogger } from '../logger.js';
import { AuthError } from '../errors.js';
import { getOAuthTokens, storeOAuthTokens, type KeychainOAuthTokens } from './keychain.js';

const logger = createLogger('token-refresh');

/**
 * OAuth token endpoint response
 */
interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Discover OAuth metadata from server
 * Tries well-known endpoints to find the token endpoint
 */
async function discoverTokenEndpoint(serverUrl: string): Promise<string | undefined> {
  // Try standard OAuth 2.0 discovery endpoints
  const discoveryUrls = [
    `${serverUrl}/.well-known/oauth-authorization-server`,
    `${serverUrl}/.well-known/openid-configuration`,
  ];

  for (const url of discoveryUrls) {
    try {
      logger.debug(`Trying OAuth discovery at: ${url}`);
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        const metadata = await response.json() as { token_endpoint?: string };
        if (metadata.token_endpoint) {
          logger.debug(`Found token endpoint: ${metadata.token_endpoint}`);
          return metadata.token_endpoint;
        }
      }
    } catch {
      // Continue to next URL
    }
  }

  return undefined;
}

/**
 * Refresh OAuth tokens using the refresh token from keychain
 * Returns the new tokens on success, or throws an error on failure
 */
export async function refreshTokens(
  profile: AuthProfile
): Promise<OAuthTokens> {
  // Get refresh token from keychain
  const storedTokens = await getOAuthTokens(profile.serverUrl, profile.name);
  if (!storedTokens?.refreshToken) {
    throw new AuthError(
      `No refresh token available for profile ${profile.name}. ` +
        `Please re-authenticate with: mcpc ${profile.serverUrl} auth --profile ${profile.name}`
    );
  }

  logger.info(`Refreshing expired token for profile: ${profile.name}`);

  // Discover token endpoint
  const tokenEndpoint = await discoverTokenEndpoint(profile.serverUrl);
  if (!tokenEndpoint) {
    throw new AuthError(
      `Could not find OAuth token endpoint for ${profile.serverUrl}. ` +
        `Please re-authenticate with: mcpc ${profile.serverUrl} auth --profile ${profile.name}`
    );
  }

  // Prepare refresh request (OAuth spec uses snake_case)
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: storedTokens.refreshToken,
  });

  try {
    logger.debug(`Refreshing token at: ${tokenEndpoint}`);
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Token refresh failed: ${response.status} ${errorText}`);

      // Check for specific error types
      if (response.status === 400 || response.status === 401) {
        throw new AuthError(
          `Refresh token is invalid or expired. ` +
            `Please re-authenticate with: mcpc ${profile.serverUrl} auth --profile ${profile.name}`
        );
      }

      throw new AuthError(
        `Failed to refresh token: ${response.status} ${response.statusText}. ` +
          `Please re-authenticate with: mcpc ${profile.serverUrl} auth --profile ${profile.name}`
      );
    }

    const tokenResponse = await response.json() as TokenResponse;

    // Build new tokens object
    const newTokens: OAuthTokens = {
      access_token: tokenResponse.access_token,
      token_type: tokenResponse.token_type || 'Bearer',
    };

    if (tokenResponse.expires_in !== undefined) {
      newTokens.expires_in = tokenResponse.expires_in;
      newTokens.expires_at = Math.floor(Date.now() / 1000) + tokenResponse.expires_in;
    }

    // Use new refresh token if provided, otherwise keep the old one
    newTokens.refresh_token = tokenResponse.refresh_token || storedTokens.refreshToken;

    if (tokenResponse.scope !== undefined) {
      newTokens.scope = tokenResponse.scope;
    }

    logger.info(`Token refreshed successfully for profile: ${profile.name}`);
    return newTokens;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    logger.error(`Token refresh error: ${(error as Error).message}`);
    throw new AuthError(
      `Failed to refresh token: ${(error as Error).message}. ` +
        `Please re-authenticate with: mcpc ${profile.serverUrl} auth --profile ${profile.name}`
    );
  }
}

/**
 * Refresh tokens and save to keychain
 * Returns the updated profile metadata (tokens are stored in keychain)
 */
export async function refreshAndSaveTokens(
  profile: AuthProfile
): Promise<AuthProfile> {
  const newTokens = await refreshTokens(profile);

  // Store tokens in keychain (convert from OAuth snake_case to camelCase)
  const keychainTokens: KeychainOAuthTokens = {
    accessToken: newTokens.access_token,
    tokenType: newTokens.token_type,
  };
  if (newTokens.expires_in !== undefined) {
    keychainTokens.expiresIn = newTokens.expires_in;
  }
  if (newTokens.expires_at !== undefined) {
    keychainTokens.expiresAt = newTokens.expires_at;
  }
  if (newTokens.refresh_token !== undefined) {
    keychainTokens.refreshToken = newTokens.refresh_token;
  }
  if (newTokens.scope !== undefined) {
    keychainTokens.scope = newTokens.scope;
  }
  await storeOAuthTokens(profile.serverUrl, profile.name, keychainTokens);

  // Update profile metadata (without tokens)
  const now = new Date().toISOString();
  const updatedProfile: AuthProfile = {
    ...profile,
    authenticatedAt: now,
    updatedAt: now,
  };

  // Update expiresAt if we have expiration info
  if (newTokens.expires_at) {
    updatedProfile.expiresAt = new Date(newTokens.expires_at * 1000).toISOString();
  }

  // Update scopes if provided
  if (newTokens.scope) {
    updatedProfile.scopes = newTokens.scope.split(' ');
  }

  // Save updated profile metadata
  await saveAuthProfile(updatedProfile);

  return updatedProfile;
}

/**
 * Check if a token is expired (or about to expire within buffer time)
 */
export function isTokenExpired(profile: AuthProfile, bufferSeconds: number = 60): boolean {
  if (!profile.expiresAt) {
    // No expiration info, assume not expired
    return false;
  }

  const expiresDate = new Date(profile.expiresAt);
  const bufferMs = bufferSeconds * 1000;
  const now = Date.now();

  return expiresDate.getTime() - bufferMs < now;
}

/**
 * Check if a profile has a refresh token in keychain
 */
export async function hasRefreshToken(profile: AuthProfile): Promise<boolean> {
  const tokens = await getOAuthTokens(profile.serverUrl, profile.name);
  return !!tokens?.refreshToken;
}
