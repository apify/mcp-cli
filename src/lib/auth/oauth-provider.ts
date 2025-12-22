/**
 * OAuth provider implementation for mcpc
 * Implements the OAuthClientProvider interface from MCP SDK
 */

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthProfile, OAuthTokens as StoredTokens } from '../types.js';
import { getAuthProfile, saveAuthProfile } from '../auth-profiles.js';
import { createLogger } from '../logger.js';

const logger = createLogger('oauth-provider');

/**
 * OAuth provider that manages authentication for a single server and profile
 */
export class McpcOAuthProvider implements OAuthClientProvider {
  private serverUrl: string;
  private profileName: string;
  private _redirectUrl: string;
  private _authProfile: AuthProfile | undefined;
  private _codeVerifier: string | undefined;
  private _clientInformation: OAuthClientInformationMixed | undefined;

  constructor(serverUrl: string, profileName: string, redirectUrl: string) {
    this.serverUrl = serverUrl;
    this.profileName = profileName;
    this._redirectUrl = redirectUrl;
  }

  /**
   * Load auth profile from storage
   */
  private async loadProfile(): Promise<AuthProfile | undefined> {
    if (!this._authProfile) {
      this._authProfile = await getAuthProfile(this.serverUrl, this.profileName);
    }
    return this._authProfile;
  }

  get redirectUrl(): string {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this._redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client (CLI)
      client_name: 'mcpc',
      client_uri: 'https://github.com/apify/mcpc',
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return this._clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    this._clientInformation = clientInformation;
    logger.debug('Saved client information for dynamic registration');
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const profile = await this.loadProfile();
    if (!profile?.tokens) {
      return undefined;
    }

    // Convert stored tokens to SDK format
    const storedTokens = profile.tokens;
    const result: OAuthTokens = {
      access_token: storedTokens.access_token,
      token_type: storedTokens.token_type,
    };

    if (storedTokens.expires_in !== undefined) {
      result.expires_in = storedTokens.expires_in;
    }
    if (storedTokens.refresh_token !== undefined) {
      result.refresh_token = storedTokens.refresh_token;
    }
    if (storedTokens.scope !== undefined) {
      result.scope = storedTokens.scope;
    }

    return result;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    logger.debug('Saving OAuth tokens');

    // Load or create profile
    let profile = await this.loadProfile();
    const now = new Date().toISOString();

    // Convert SDK tokens to stored format
    const storedTokens: StoredTokens = {
      access_token: tokens.access_token,
      token_type: tokens.token_type,
    };

    if (tokens.expires_in !== undefined) {
      storedTokens.expires_in = tokens.expires_in;
      storedTokens.expires_at = Math.floor(Date.now() / 1000) + tokens.expires_in;
    }
    if (tokens.refresh_token !== undefined) {
      storedTokens.refresh_token = tokens.refresh_token;
    }
    if (tokens.scope !== undefined) {
      storedTokens.scope = tokens.scope;
    }

    if (!profile) {
      // Create new profile
      profile = {
        name: this.profileName,
        serverUrl: this.serverUrl,
        authType: 'oauth',
        oauthIssuer: '', // Will be set by caller
        authenticatedAt: now,
        tokens: storedTokens,
        createdAt: now,
        updatedAt: now,
      };

      if (tokens.scope) {
        profile.scopes = tokens.scope.split(' ');
      }
      if (storedTokens.expires_at) {
        profile.expiresAt = new Date(storedTokens.expires_at * 1000).toISOString();
      }
    } else {
      // Update existing profile
      profile.tokens = storedTokens;
      profile.authenticatedAt = now;
      profile.updatedAt = now;

      if (tokens.scope) {
        profile.scopes = tokens.scope.split(' ');
      }
      if (storedTokens.expires_at) {
        profile.expiresAt = new Date(storedTokens.expires_at * 1000).toISOString();
      }
    }

    await saveAuthProfile(profile);
    this._authProfile = profile;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // This will be implemented in the OAuth flow handler
    // For now, just log the URL
    logger.info(`Authorization URL: ${authorizationUrl.toString()}`);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this._codeVerifier = codeVerifier;
  }

  async codeVerifier(): Promise<string> {
    if (!this._codeVerifier) {
      throw new Error('Code verifier not found');
    }
    return this._codeVerifier;
  }

  /**
   * Set the OAuth issuer URL (authorization server)
   * This is called after discovery
   */
  setOAuthIssuer(issuer: string): void {
    if (this._authProfile) {
      this._authProfile.oauthIssuer = issuer;
    }
  }
}
