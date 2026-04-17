/**
 * Unit tests for OAuth flow utility functions
 */

import { validateClientMetadataUrl } from '../../../../src/lib/auth/oauth-utils.js';

describe('validateClientMetadataUrl', () => {
  it('accepts a valid HTTPS URL with path', () => {
    expect(() =>
      validateClientMetadataUrl('https://example.com/client-metadata/v1.json')
    ).not.toThrow();
  });

  it('accepts a URL with a port', () => {
    expect(() => validateClientMetadataUrl('https://example.com:8443/client.json')).not.toThrow();
  });

  it('rejects a non-HTTPS URL', () => {
    expect(() => validateClientMetadataUrl('http://example.com/client.json')).toThrow(
      /"https" scheme/
    );
  });

  it('rejects a URL without a path component', () => {
    expect(() => validateClientMetadataUrl('https://example.com')).toThrow(/path component/);
  });

  it('rejects a URL with only a root path', () => {
    expect(() => validateClientMetadataUrl('https://example.com/')).toThrow(/path component/);
  });

  it('rejects an invalid URL', () => {
    expect(() => validateClientMetadataUrl('not-a-url')).toThrow(/not a valid URL/);
  });

  it('rejects a URL with a fragment', () => {
    expect(() => validateClientMetadataUrl('https://example.com/client.json#section')).toThrow(
      /fragment/
    );
  });

  it('rejects a URL with a username', () => {
    expect(() => validateClientMetadataUrl('https://user@example.com/client.json')).toThrow(
      /username or password/
    );
  });

  it('rejects a URL with a username and password', () => {
    expect(() => validateClientMetadataUrl('https://user:pass@example.com/client.json')).toThrow(
      /username or password/
    );
  });

  it('rejects a URL with single-dot path segment', () => {
    expect(() => validateClientMetadataUrl('https://example.com/./client.json')).toThrow(
      /path segments/
    );
  });

  it('rejects a URL with double-dot path segment', () => {
    expect(() => validateClientMetadataUrl('https://example.com/../client.json')).toThrow(
      /path segments/
    );
  });

  it('accepts a URL with a query string', () => {
    expect(() => validateClientMetadataUrl('https://example.com/client.json?v=1')).not.toThrow();
  });
});
