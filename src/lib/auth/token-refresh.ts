/**
 * Token refresh functionality for OAuth profiles
 * Handles automatic refresh of expired access tokens using refresh tokens
 * Tokens are stored securely in OS keychain
 */

import type { AuthProfile, OAuthTokens } from '../types.js';
import { getAuthProfile, saveAuthProfile } from '../auth/auth-profiles.js';
import { createLogger } from '../logger.js';
import { createReauthError, DEFAULT_AUTH_PROFILE } from './oauth-utils.js';
import { getOAuthTokens, storeOAuthTokens, type KeychainOAuthTokens } from './keychain.js';
import { OAuthTokenManager, type OnTokenRefreshCallback } from './oauth-token-manager.js';

const logger = createLogger('token-refresh');

/**
 * Refresh OAuth tokens using the refresh token from keychain
 * Uses OAuthTokenManager for the refresh logic
 * Returns the new tokens on success, or throws an error on failure
 */
export async function refreshTokens(
  profile: AuthProfile
): Promise<OAuthTokens> {
  // Get refresh token from keychain
  const storedTokens = await getOAuthTokens(profile.serverUrl, profile.name);
  if (!storedTokens?.refreshToken) {
    throw createReauthError(
      profile.serverUrl,
      profile.name,
      `No refresh token available for profile ${profile.name}`
    );
  }

  // Use OAuthTokenManager to handle the refresh
  const tokenManager = new OAuthTokenManager({
    serverUrl: profile.serverUrl,
    profileName: profile.name,
    refreshToken: storedTokens.refreshToken,
  });

  const tokenResponse = await tokenManager.refreshAccessToken();

  // Build OAuthTokens object from response
  const newTokens: OAuthTokens = {
    access_token: tokenResponse.access_token,
    token_type: tokenResponse.token_type || 'Bearer',
  };

  if (tokenResponse.expires_in !== undefined) {
    newTokens.expires_in = tokenResponse.expires_in;
    newTokens.expires_at = Math.floor(Date.now() / 1000) + tokenResponse.expires_in;
  }

  // Use new refresh token if provided, otherwise keep the old one
  newTokens.refresh_token = tokenManager.getRefreshToken();

  if (tokenResponse.scope !== undefined) {
    newTokens.scope = tokenResponse.scope;
  }

  logger.info(`Token refreshed successfully for profile: ${profile.name}`);
  return newTokens;
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

/**
 * Create a persistence callback for OAuthTokenManager that saves tokens to keychain
 */
function createPersistenceCallback(
  serverUrl: string,
  profileName: string,
  profile: AuthProfile
): OnTokenRefreshCallback {
  return async (newTokens) => {
    // Store tokens in keychain
    const keychainTokens: KeychainOAuthTokens = {
      accessToken: newTokens.access_token,
      tokenType: newTokens.token_type,
    };
    if (newTokens.expires_in !== undefined) {
      keychainTokens.expiresIn = newTokens.expires_in;
      keychainTokens.expiresAt = Math.floor(Date.now() / 1000) + newTokens.expires_in;
    }
    if (newTokens.refresh_token !== undefined) {
      keychainTokens.refreshToken = newTokens.refresh_token;
    }
    if (newTokens.scope !== undefined) {
      keychainTokens.scope = newTokens.scope;
    }
    await storeOAuthTokens(serverUrl, profileName, keychainTokens);

    // Update profile metadata
    const now = new Date().toISOString();
    const updatedProfile: AuthProfile = {
      ...profile,
      authenticatedAt: now,
      updatedAt: now,
    };
    if (keychainTokens.expiresAt) {
      updatedProfile.expiresAt = new Date(keychainTokens.expiresAt * 1000).toISOString();
    }
    if (newTokens.scope) {
      updatedProfile.scopes = newTokens.scope.split(' ');
    }
    await saveAuthProfile(updatedProfile);

    logger.info(`Token refreshed and saved for profile: ${profileName}`);
  };
}

/**
 * Get a valid access token for a profile, refreshing if necessary
 * Tokens are loaded from and saved to OS keychain automatically
 *
 * @returns The access token, or undefined if no profile/tokens exist
 * @throws AuthError if token is expired and cannot be refreshed
 */
export async function getValidAccessTokenFromKeychain(
  serverUrl: string,
  profileName: string = DEFAULT_AUTH_PROFILE
): Promise<string | undefined> {
  // Load profile metadata
  const profile = await getAuthProfile(serverUrl, profileName);
  if (!profile) {
    logger.debug(`No auth profile found for ${serverUrl} (profile: ${profileName})`);
    return undefined;
  }

  // Load tokens from keychain
  const tokens = await getOAuthTokens(serverUrl, profileName);
  if (!tokens?.accessToken) {
    logger.warn(`Auth profile exists but has no access token in keychain: ${profileName}`);
    return undefined;
  }

  // If no refresh token, check if current token is still valid
  if (!tokens.refreshToken) {
    if (tokens.expiresAt && Date.now() / 1000 > tokens.expiresAt - 60) {
      throw createReauthError(
        serverUrl,
        profileName,
        'Authentication token expired and no refresh token available'
      );
    }
    // Token is still valid (or no expiry info)
    logger.debug(`Using auth profile: ${profileName}`);
    return tokens.accessToken;
  }

  // Create token manager with persistence callback
  const tokenManager = new OAuthTokenManager({
    serverUrl,
    profileName,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    ...(tokens.expiresAt !== undefined && { accessTokenExpiresAt: tokens.expiresAt }),
    onTokenRefresh: createPersistenceCallback(serverUrl, profileName, profile),
  });

  // Get valid token (will refresh and persist if expired)
  logger.debug(`Using auth profile: ${profileName}`);
  return await tokenManager.getValidAccessToken();
}
