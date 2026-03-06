/**
 * Unit tests for CLI argument parsing functions
 */

import { extractOptions, parseServerArg } from '../../../src/cli/parser.js';

describe('parseServerArg', () => {
  it('should parse a bare domain as URL', () => {
    const result = parseServerArg('mcp.apify.com');
    expect(result).toEqual({ type: 'url', url: 'mcp.apify.com' });
  });

  it('should parse a full URL as URL', () => {
    const result = parseServerArg('https://mcp.apify.com');
    expect(result).toEqual({ type: 'url', url: 'https://mcp.apify.com' });
  });

  it('should parse a URL with path (no colon-entry) as URL', () => {
    const result = parseServerArg('https://mcp.apify.com/v1');
    expect(result).toEqual({ type: 'url', url: 'https://mcp.apify.com/v1' });
  });

  it('should parse ~/.vscode/mcp.json:filesystem as config', () => {
    const result = parseServerArg('~/.vscode/mcp.json:filesystem');
    expect(result).toEqual({ type: 'config', file: '~/.vscode/mcp.json', entry: 'filesystem' });
  });

  it('should parse ./mcp.json:server as config', () => {
    const result = parseServerArg('./mcp.json:server');
    expect(result).toEqual({ type: 'config', file: './mcp.json', entry: 'server' });
  });

  it('should parse /absolute/path.json:entry as config', () => {
    const result = parseServerArg('/absolute/path.json:entry');
    expect(result).toEqual({ type: 'config', file: '/absolute/path.json', entry: 'entry' });
  });

  it('should parse .yaml extension as config', () => {
    const result = parseServerArg('./config.yaml:myserver');
    expect(result).toEqual({ type: 'config', file: './config.yaml', entry: 'myserver' });
  });

  it('should parse .yml extension as config', () => {
    const result = parseServerArg('config.yml:myserver');
    expect(result).toEqual({ type: 'config', file: 'config.yml', entry: 'myserver' });
  });

  it('should NOT parse hostname:port as config', () => {
    // 127.0.0.1:8080 — does not look like a file path
    const result = parseServerArg('127.0.0.1:8080');
    expect(result).toEqual({ type: 'url', url: '127.0.0.1:8080' });
  });

  it('should NOT parse URL with :// as config', () => {
    const result = parseServerArg('https://example.com');
    expect(result).toEqual({ type: 'url', url: 'https://example.com' });
  });
});

describe('extractOptions', () => {
  it('should extract boolean flags', () => {
    const result = extractOptions(['--json', '--verbose']);
    expect(result).toEqual({ json: true, verbose: true });
  });

  it('should extract --json short form (-j)', () => {
    const result = extractOptions(['-j']);
    expect(result).toEqual({ json: true, verbose: false });
  });

  it('should extract multiple --header options', () => {
    const result = extractOptions(['--header', 'Auth: Bearer token', '--header', 'X-Key: value']);
    expect(result).toEqual({
      json: false,
      verbose: false,
      headers: ['Auth: Bearer token', 'X-Key: value'],
    });
  });

  it('should extract --header short form (-H)', () => {
    const result = extractOptions(['-H', 'Auth: token', '-H', 'X-Key: value']);
    expect(result).toEqual({
      json: false,
      verbose: false,
      headers: ['Auth: token', 'X-Key: value'],
    });
  });

  it('should extract --timeout', () => {
    const result = extractOptions(['--timeout', '120']);
    expect(result).toEqual({ json: false, verbose: false, timeout: 120 });
  });

  it('should extract all options together', () => {
    const result = extractOptions([
      '--json',
      '--verbose',
      '--header',
      'Auth: token',
      '--timeout',
      '60',
    ]);
    expect(result).toEqual({
      json: true,
      verbose: true,
      headers: ['Auth: token'],
      timeout: 60,
    });
  });

  it('should handle empty args', () => {
    const result = extractOptions([]);
    expect(result).toEqual({ json: false, verbose: false });
  });

  it('should handle timeout at end of args', () => {
    const result = extractOptions(['--json', '--timeout']);
    expect(result).toEqual({ json: true, verbose: false });
  });

  it('should parse timeout as integer', () => {
    const result = extractOptions(['--timeout', '300']);
    expect(result).toEqual({ json: false, verbose: false, timeout: 300 });
  });

  it('should handle NaN timeout gracefully', () => {
    const result = extractOptions(['--timeout', 'invalid']);
    expect(result.timeout).toBeNaN();
  });
});
