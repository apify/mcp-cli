/**
 * Unit tests for OAuth utility functions
 */

import {
  discoverTokenEndpoint,
  requestClientCredentialsToken,
} from '../../../../src/lib/auth/oauth-utils.js';
import { AuthError } from '../../../../src/lib/errors.js';
import * as proxyModule from '../../../../src/lib/proxy.js';

// Helper to create a mock fetch Response
function mockResponse(body: object | null, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(body ? JSON.stringify(body) : ''),
  } as unknown as Response;
}

function mockResponseWithStatus(body: object | null, status: number): Response {
  return {
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(body ? JSON.stringify(body) : ''),
  } as unknown as Response;
}

describe('discoverTokenEndpoint', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(proxyModule, 'proxyFetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns token endpoint from path-based oauth-authorization-server', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url === 'https://example.com/mcp/.well-known/oauth-authorization-server') {
        return Promise.resolve(mockResponse({ token_endpoint: 'https://example.com/token' }));
      }
      return Promise.resolve(mockResponse(null, false));
    });

    const result = await discoverTokenEndpoint('https://example.com/mcp');
    expect(result).toBe('https://example.com/token');
  });

  it('falls back to path-based openid-configuration when oauth-authorization-server has no token_endpoint', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url === 'https://example.com/.well-known/oauth-authorization-server') {
        return Promise.resolve(mockResponse({})); // no token_endpoint
      }
      if (url === 'https://example.com/.well-known/openid-configuration') {
        return Promise.resolve(mockResponse({ token_endpoint: 'https://example.com/oidc/token' }));
      }
      return Promise.resolve(mockResponse(null, false));
    });

    const result = await discoverTokenEndpoint('https://example.com');
    expect(result).toBe('https://example.com/oidc/token');
  });

  it('falls back to root-based discovery when path-based URLs return no token_endpoint', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url === 'https://example.com/.well-known/oauth-authorization-server') {
        return Promise.resolve(mockResponse({ token_endpoint: 'https://example.com/token' }));
      }
      return Promise.resolve(mockResponse(null, false));
    });

    const result = await discoverTokenEndpoint('https://example.com/mcp');
    expect(result).toBe('https://example.com/token');
  });

  it('returns undefined when no discovery URL returns a token endpoint', async () => {
    fetchSpy.mockResolvedValue(mockResponse(null, false));

    const result = await discoverTokenEndpoint('https://example.com/mcp');
    expect(result).toBeUndefined();
  });

  it('handles fetch errors gracefully and continues to next URL', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url === 'https://example.com/mcp/.well-known/oauth-authorization-server') {
        return Promise.reject(new Error('Network error'));
      }
      if (url === 'https://example.com/mcp/.well-known/openid-configuration') {
        return Promise.resolve(mockResponse({ token_endpoint: 'https://example.com/token' }));
      }
      return Promise.resolve(mockResponse(null, false));
    });

    const result = await discoverTokenEndpoint('https://example.com/mcp');
    expect(result).toBe('https://example.com/token');
  });

  it('trims trailing slashes from serverUrl before building discovery URLs', async () => {
    const expectedUrls = [
      'https://example.com/mcp/.well-known/oauth-authorization-server',
      'https://example.com/mcp/.well-known/openid-configuration',
      'https://example.com/.well-known/oauth-authorization-server',
      'https://example.com/.well-known/openid-configuration',
    ];

    for (const trailingSlashes of ['/', '///']) {
      const calledUrls: string[] = [];
      fetchSpy.mockImplementation((url: string) => {
        calledUrls.push(url);
        return Promise.resolve(mockResponse(null, false));
      });

      await discoverTokenEndpoint(`https://example.com/mcp${trailingSlashes}`);
      expect(calledUrls).toEqual(expectedUrls);
    }
  });

  it('does not add duplicate root-based URLs when serverUrl is already root', async () => {
    const calledUrls: string[] = [];
    fetchSpy.mockImplementation((url: string) => {
      calledUrls.push(url);
      return Promise.resolve(mockResponse(null, false));
    });

    await discoverTokenEndpoint('https://example.com');
    expect(calledUrls).toHaveLength(2);
    expect(calledUrls).toEqual([
      'https://example.com/.well-known/oauth-authorization-server',
      'https://example.com/.well-known/openid-configuration',
    ]);
  });

  it('does not add duplicate root-based URLs when serverUrl has trailing slash only', async () => {
    const calledUrls: string[] = [];
    fetchSpy.mockImplementation((url: string) => {
      calledUrls.push(url);
      return Promise.resolve(mockResponse(null, false));
    });

    await discoverTokenEndpoint('https://example.com/');
    expect(calledUrls).toHaveLength(2);
  });

  it('tries all 4 discovery URLs for a path-based serverUrl', async () => {
    const calledUrls: string[] = [];
    fetchSpy.mockImplementation((url: string) => {
      calledUrls.push(url);
      return Promise.resolve(mockResponse(null, false));
    });

    await discoverTokenEndpoint('https://example.com/mcp');
    expect(calledUrls).toEqual([
      'https://example.com/mcp/.well-known/oauth-authorization-server',
      'https://example.com/mcp/.well-known/openid-configuration',
      'https://example.com/.well-known/oauth-authorization-server',
      'https://example.com/.well-known/openid-configuration',
    ]);
  });
});

describe('requestClientCredentialsToken', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(proxyModule, 'proxyFetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('POSTs grant_type=client_credentials with client_id and client_secret', async () => {
    let capturedBody = '';
    let capturedHeaders: Record<string, string> | undefined;
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(
        mockResponse({
          access_token: 'abc123',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      );
    });

    const result = await requestClientCredentialsToken(
      'https://example.com/token',
      'my-client',
      'my-secret'
    );

    expect(result.access_token).toBe('abc123');
    expect(result.token_type).toBe('Bearer');
    expect(result.expires_in).toBe(3600);

    const params = new URLSearchParams(capturedBody);
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('client_id')).toBe('my-client');
    expect(params.get('client_secret')).toBe('my-secret');
    expect(params.get('scope')).toBeNull();

    expect(capturedHeaders?.['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('includes scope in the request when provided', async () => {
    let capturedBody = '';
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve(mockResponse({ access_token: 'x', token_type: 'Bearer' }));
    });

    await requestClientCredentialsToken(
      'https://example.com/token',
      'cid',
      'csecret',
      'tools:read tools:write'
    );

    const params = new URLSearchParams(capturedBody);
    expect(params.get('scope')).toBe('tools:read tools:write');
  });

  it('throws AuthError with a clear message on 401', async () => {
    fetchSpy.mockResolvedValue(mockResponseWithStatus({ error: 'invalid_client' }, 401));

    await expect(
      requestClientCredentialsToken('https://example.com/token', 'cid', 'bad')
    ).rejects.toThrow(AuthError);
    await expect(
      requestClientCredentialsToken('https://example.com/token', 'cid', 'bad')
    ).rejects.toThrow(/Client credentials are invalid|rejected/);
  });

  it('throws AuthError on unexpected 5xx', async () => {
    fetchSpy.mockResolvedValue(mockResponseWithStatus({ error: 'server_error' }, 500));

    await expect(
      requestClientCredentialsToken('https://example.com/token', 'cid', 'sec')
    ).rejects.toThrow(AuthError);
  });
});
