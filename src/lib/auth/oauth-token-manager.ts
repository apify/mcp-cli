/**
 * OAuth Token Manager
 * Encapsulates all OAuth token lifecycle management including storage, refresh, and expiry checking.
 * Used by both CLI (with keychain persistence) and bridge (in-memory only).
 */

import { createLogger } from '../logger.js';
import { AuthError } from '../errors.js';
import {
  discoverAndRefreshToken,
  discoverTokenEndpoint,
  requestClientCredentialsToken,
  createReauthError,
  type OAuthTokenResponse,
} from './oauth-utils.js';

const logger = createLogger('oauth-token-manager');

// Default token expiry if server doesn't specify (1 hour)
const DEFAULT_TOKEN_EXPIRY_SECONDS = 3600;

// Buffer time before expiry to trigger refresh (60 seconds)
const EXPIRY_BUFFER_SECONDS = 60;

/**
 * Callback invoked when tokens are refreshed
 * Allows callers to persist the new tokens (e.g., to keychain)
 */
export type OnTokenRefreshCallback = (tokens: OAuthTokenResponse) => void | Promise<void>;

/**
 * Callback invoked before token refresh to reload latest tokens
 * Returns the current refresh token from persistent storage (e.g., keychain)
 * This handles cases where another process may have rotated the token
 */
export type OnBeforeRefreshCallback = () => Promise<
  { refreshToken?: string; accessToken?: string; accessTokenExpiresAt?: number } | undefined
>;

/**
 * Options for creating an OAuthTokenManager
 */
export interface OAuthTokenManagerOptions {
  serverUrl: string;
  profileName: string;
  /**
   * Grant used to obtain new access tokens when the current one expires.
   * Defaults to 'refresh_token'. 'client_credentials' re-issues tokens using
   * clientId/clientSecret instead of a refresh token.
   */
  grantType?: 'refresh_token' | 'client_credentials';
  /** OAuth client ID (required for public clients) */
  clientId: string;
  /** OAuth client secret (required for client_credentials grant) */
  clientSecret?: string;
  /** Refresh token (required for refresh_token grant) */
  refreshToken?: string;
  /** OAuth scope to request on re-issuance (client_credentials grant only) */
  scope?: string;
  /** Pre-known token endpoint; when absent, it is discovered from server metadata */
  tokenEndpoint?: string;
  /** Initial access token (optional - will be refreshed if not provided or expired) */
  accessToken?: string;
  /** Unix timestamp when access token expires */
  accessTokenExpiresAt?: number;
  /** Callback when tokens are refreshed (for persistence) */
  onTokenRefresh?: OnTokenRefreshCallback;
  /** Callback to reload tokens before refresh (handles token rotation by other processes) */
  onBeforeRefresh?: OnBeforeRefreshCallback;
}

/**
 * Manages OAuth token lifecycle including automatic refresh
 */
export class OAuthTokenManager {
  private serverUrl: string;
  private profileName: string;
  private grantType: 'refresh_token' | 'client_credentials';
  private clientId: string;
  private clientSecret?: string;
  private refreshToken: string;
  private scope?: string;
  private tokenEndpoint?: string;
  private accessToken: string | null = null;
  private accessTokenExpiresAt: number | null = null; // unix timestamp
  private onTokenRefresh?: OnTokenRefreshCallback;
  private onBeforeRefresh?: OnBeforeRefreshCallback;

  constructor(options: OAuthTokenManagerOptions) {
    this.serverUrl = options.serverUrl;
    this.profileName = options.profileName;
    this.grantType = options.grantType ?? 'refresh_token';
    this.clientId = options.clientId;
    if (options.clientSecret) {
      this.clientSecret = options.clientSecret;
    }
    this.refreshToken = options.refreshToken ?? '';
    if (options.scope) {
      this.scope = options.scope;
    }
    if (options.tokenEndpoint) {
      this.tokenEndpoint = options.tokenEndpoint;
    }
    this.accessToken = options.accessToken ?? null;
    this.accessTokenExpiresAt = options.accessTokenExpiresAt ?? null;
    if (options.onTokenRefresh) {
      this.onTokenRefresh = options.onTokenRefresh;
    }
    if (options.onBeforeRefresh) {
      this.onBeforeRefresh = options.onBeforeRefresh;
    }

    // Validate required fields per grant type
    if (this.grantType === 'refresh_token' && !this.refreshToken) {
      throw new Error('OAuthTokenManager: refresh_token grant requires refreshToken');
    }
    if (this.grantType === 'client_credentials' && !this.clientSecret) {
      throw new Error('OAuthTokenManager: client_credentials grant requires clientSecret');
    }
  }

  /**
   * Check if the current access token is expired or about to expire
   */
  isAccessTokenExpired(): boolean {
    if (!this.accessToken || !this.accessTokenExpiresAt) {
      return true;
    }
    return Date.now() / 1000 > this.accessTokenExpiresAt - EXPIRY_BUFFER_SECONDS;
  }

  /**
   * Get seconds until the access token expires (accounting for buffer)
   * Returns 0 if already expired or no token
   */
  getSecondsUntilExpiry(): number {
    if (!this.accessToken || !this.accessTokenExpiresAt) {
      return 0;
    }
    const secondsUntil =
      this.accessTokenExpiresAt - EXPIRY_BUFFER_SECONDS - Math.floor(Date.now() / 1000);
    return Math.max(0, secondsUntil);
  }

  /**
   * Refresh the access token using the refresh token
   * @returns The token response from the server
   * @throws AuthError if refresh fails
   */
  async refreshAccessToken(): Promise<OAuthTokenResponse> {
    // Reload tokens from keychain before refresh (handles token rotation by other processes)
    if (this.onBeforeRefresh) {
      logger.debug('Reloading tokens from storage before refresh...');
      const latestTokens = await this.onBeforeRefresh();
      if (latestTokens) {
        if (latestTokens.refreshToken && latestTokens.refreshToken !== this.refreshToken) {
          logger.debug('Found newer refresh token in storage (another process rotated it)');
          this.refreshToken = latestTokens.refreshToken;
        }
        // Also update access token if still valid (another process may have refreshed)
        if (latestTokens.accessToken && latestTokens.accessTokenExpiresAt) {
          const nowSeconds = Math.floor(Date.now() / 1000);
          if (latestTokens.accessTokenExpiresAt > nowSeconds + EXPIRY_BUFFER_SECONDS) {
            logger.debug('Found valid access token in storage, using it instead of refreshing');
            this.accessToken = latestTokens.accessToken;
            this.accessTokenExpiresAt = latestTokens.accessTokenExpiresAt;
            // Return early - no need to refresh, we have a valid token
            return {
              access_token: this.accessToken,
              token_type: 'Bearer',
            };
          }
        }
      }
    }

    logger.debug(
      `Refreshing access token for profile: ${this.profileName} (grant: ${this.grantType})`
    );

    try {
      let tokenResponse: OAuthTokenResponse;
      if (this.grantType === 'client_credentials') {
        if (!this.clientSecret) {
          throw createReauthError(
            this.serverUrl,
            this.profileName,
            `No client secret available for profile ${this.profileName}`
          );
        }
        // Resolve token endpoint (cache after first discovery)
        if (!this.tokenEndpoint) {
          const discovered = await discoverTokenEndpoint(this.serverUrl);
          if (!discovered) {
            throw new AuthError(`Could not discover OAuth token endpoint for ${this.serverUrl}`);
          }
          this.tokenEndpoint = discovered;
        }
        tokenResponse = await requestClientCredentialsToken(
          this.tokenEndpoint,
          this.clientId,
          this.clientSecret,
          this.scope
        );
      } else {
        if (!this.refreshToken) {
          throw createReauthError(
            this.serverUrl,
            this.profileName,
            `No refresh token available for profile ${this.profileName}`
          );
        }
        tokenResponse = await discoverAndRefreshToken(
          this.serverUrl,
          this.refreshToken,
          this.clientId
        );
      }

      // Store new access token
      this.accessToken = tokenResponse.access_token;

      // Calculate expiry time
      const expiresIn = tokenResponse.expires_in ?? DEFAULT_TOKEN_EXPIRY_SECONDS;
      this.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + expiresIn;

      // Update refresh token if a new one was provided (token rotation; refresh_token grant only)
      if (tokenResponse.refresh_token && this.grantType === 'refresh_token') {
        this.refreshToken = tokenResponse.refresh_token;
        logger.debug('Received new refresh token (token rotation)');
      }

      logger.debug(`Access token refreshed successfully for profile: ${this.profileName}`);

      // Notify callback for persistence
      if (this.onTokenRefresh) {
        await this.onTokenRefresh(tokenResponse);
      }

      return tokenResponse;
    } catch (error) {
      if (error instanceof AuthError) {
        // Add re-authentication hint
        throw createReauthError(this.serverUrl, this.profileName, error.message);
      }
      logger.error(`Token refresh error: ${(error as Error).message}`);
      throw createReauthError(
        this.serverUrl,
        this.profileName,
        `Failed to refresh token: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   * @returns The current valid access token
   * @throws AuthError if refresh fails
   */
  async getValidAccessToken(): Promise<string> {
    // logger.debug('>>> getValidAccessToken() called <<<');
    // logger.debug(`  hasAccessToken: ${!!this.accessToken}`);
    // logger.debug(`  accessTokenExpiresAt: ${this.accessTokenExpiresAt}`);
    // logger.debug(`  isExpired: ${this.isAccessTokenExpired()}`);
    // logger.debug(`  secondsUntilExpiry: ${this.getSecondsUntilExpiry()}`);

    if (this.isAccessTokenExpired()) {
      await this.refreshAccessToken();
    }

    if (!this.accessToken) {
      throw new AuthError('No access token available after refresh');
    }

    return this.accessToken;
  }
}
