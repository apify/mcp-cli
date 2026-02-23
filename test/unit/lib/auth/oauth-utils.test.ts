/**
 * Unit tests for OAuth utility functions
 */

import { discoverTokenEndpoint } from '../../../../src/lib/auth/oauth-utils.js';

// Helper to create a mock fetch Response
function mockResponse(body: object | null, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('discoverTokenEndpoint', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
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
