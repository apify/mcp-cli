/**
 * Unit tests for CLI argument parsing functions
 */

import { extractOptions, parseServerArg, hasSubcommand } from '../../../src/cli/parser.js';

// args format mirrors process.argv: [node, script, ...actual_args]
const A = (...args: string[]) => ['node', 'script', ...args];

describe('hasSubcommand', () => {
  it('returns true when a subcommand is present', () => {
    expect(hasSubcommand(A('tools-list'))).toBe(true);
  });

  it('returns true when subcommand follows options', () => {
    expect(hasSubcommand(A('--json', 'tools-list'))).toBe(true);
  });

  it('returns true when subcommand follows an option with value', () => {
    expect(hasSubcommand(A('--timeout', '30', 'ping'))).toBe(true);
  });

  it('returns false when only options are present', () => {
    expect(hasSubcommand(A('--json', '--verbose'))).toBe(false);
  });

  it('returns false for empty args', () => {
    expect(hasSubcommand(A())).toBe(false);
  });

  it('does not treat option values as subcommands', () => {
    expect(hasSubcommand(A('--timeout', '30'))).toBe(false);
  });
});

describe('parseServerArg', () => {
  it('should parse a bare domain as URL', () => {
    const result = parseServerArg('mcp.apify.com');
    expect(result).toEqual({ type: 'url', url: 'mcp.apify.com' });

    const result2 = parseServerArg('example.com');
    expect(result2).toEqual({ type: 'url', url: 'example.com' });

    const result3 = parseServerArg('example');
    expect(result3).toEqual({ type: 'url', url: 'example' });
  });

  it('should parse a full URL as URL', () => {
    const result = parseServerArg('https://mcp.apify.com');
    expect(result).toEqual({ type: 'url', url: 'https://mcp.apify.com' });

    const result2 = parseServerArg('http://mcp.apify.com');
    expect(result2).toEqual({ type: 'url', url: 'http://mcp.apify.com' });

    const result3 = parseServerArg('http://mcp.apify.com:8000');
    expect(result3).toEqual({ type: 'url', url: 'http://mcp.apify.com:8000' });
  });

  it('should parse a URL with path (no colon-entry) as URL', () => {
    const result = parseServerArg('https://mcp.apify.com/v1');
    expect(result).toEqual({ type: 'url', url: 'https://mcp.apify.com/v1' });

    const result2 = parseServerArg('mcp.apify.com/v1');
    expect(result2).toEqual({ type: 'url', url: 'mcp.apify.com/v1' });

    const result3 = parseServerArg('mcp.apify.com:8000/v1');
    expect(result3).toEqual({ type: 'url', url: 'mcp.apify.com:8000/v1' });
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

  it('should parse .json extension as config', () => {
    const result = parseServerArg('./config.json:myserver');
    expect(result).toEqual({ type: 'config', file: './config.json', entry: 'myserver' });

    const result2 = parseServerArg('config.json:myserver');
    expect(result2).toEqual({ type: 'config', file: 'config.json', entry: 'myserver' });
  });

  it('should parse .yaml extension as config', () => {
    const result = parseServerArg('./config.yaml:myserver');
    expect(result).toEqual({ type: 'config', file: './config.yaml', entry: 'myserver' });

    const result2 = parseServerArg('config.yaml:myserver');
    expect(result2).toEqual({ type: 'config', file: 'config.yaml', entry: 'myserver' });
  });

  it('should parse .yml extension as config', () => {
    const result = parseServerArg('./config.yml:myserver');
    expect(result).toEqual({ type: 'config', file: './config.yml', entry: 'myserver' });

    const result2 = parseServerArg('config.yml:myserver');
    expect(result2).toEqual({ type: 'config', file: 'config.yml', entry: 'myserver' });

    const result3 = parseServerArg('../config.yml:myserver');
    expect(result3).toEqual({ type: 'config', file: '../config.yml', entry: 'myserver' });
  });

  it('should NOT parse hostname:port as config', () => {
    // 127.0.0.1:8080 — does not look like a file path
    const result = parseServerArg('127.0.0.1:8080');
    expect(result).toEqual({ type: 'url', url: '127.0.0.1:8080' });

    const result2 = parseServerArg('mcp.example.com:8080');
    expect(result2).toEqual({ type: 'url', url: 'mcp.example.com:8080' });
  });

  it('should NOT parse URL with :// as config', () => {
    const result = parseServerArg('https://example.com');
    expect(result).toEqual({ type: 'url', url: 'https://example.com' });
  });

  it('should return null for colon-only or leading-colon input', () => {
    expect(parseServerArg(':')).toBeNull();
    expect(parseServerArg(':entry')).toBeNull();
  });

  it('should return null for trailing-colon input', () => {
    expect(parseServerArg('file:')).toBeNull();
  });

  it('should return null for hostname:non-numeric-port (not a valid URL or file path)', () => {
    expect(parseServerArg('example.com:foo')).toBeNull();
    expect(parseServerArg('myhost:notaport')).toBeNull();
  });

  it('should return null for https:// URL with invalid port', () => {
    expect(parseServerArg('https://mcp.apify.com:invalid')).toBeNull();
    expect(parseServerArg('http://example.com:badport')).toBeNull();
  });

  it('should return null for other invalid full-URL syntax', () => {
    expect(parseServerArg('https://host:badport/path')).toBeNull();
  });

  it('should parse Windows drive-letter config paths correctly', () => {
    const result = parseServerArg('C:\\Users\\me\\mcp.json:filesystem');
    expect(result).toEqual({
      type: 'config',
      file: 'C:\\Users\\me\\mcp.json',
      entry: 'filesystem',
    });

    const result2 = parseServerArg('D:/projects/config.yaml:myserver');
    expect(result2).toEqual({ type: 'config', file: 'D:/projects/config.yaml', entry: 'myserver' });
  });

  it('should parse bare config file path (no :entry) as config-file', () => {
    expect(parseServerArg('~/.vscode/mcp.json')).toEqual({
      type: 'config-file',
      file: '~/.vscode/mcp.json',
    });

    expect(parseServerArg('./mcp.json')).toEqual({
      type: 'config-file',
      file: './mcp.json',
    });

    expect(parseServerArg('/absolute/path/config.json')).toEqual({
      type: 'config-file',
      file: '/absolute/path/config.json',
    });

    expect(parseServerArg('../config.yaml')).toEqual({
      type: 'config-file',
      file: '../config.yaml',
    });

    expect(parseServerArg('config.json')).toEqual({
      type: 'config-file',
      file: 'config.json',
    });

    expect(parseServerArg('config.yml')).toEqual({
      type: 'config-file',
      file: 'config.yml',
    });
  });

  it('should parse Windows bare config file path as config-file', () => {
    expect(parseServerArg('C:\\Users\\me\\mcp.json')).toEqual({
      type: 'config-file',
      file: 'C:\\Users\\me\\mcp.json',
    });

    expect(parseServerArg('D:/projects/config.yaml')).toEqual({
      type: 'config-file',
      file: 'D:/projects/config.yaml',
    });
  });

  it('should NOT parse bare hostname as config-file', () => {
    // These should still be URLs, not config files
    expect(parseServerArg('example.com')).toEqual({ type: 'url', url: 'example.com' });
    expect(parseServerArg('mcp.apify.com')).toEqual({ type: 'url', url: 'mcp.apify.com' });
  });

  describe('inline stdio command', () => {
    it('should parse a simple command with args', () => {
      expect(parseServerArg('npx -y foo')).toEqual({
        type: 'command',
        command: 'npx',
        args: ['-y', 'foo'],
      });
    });

    it('should parse "node dist/stdio.js" as inline command', () => {
      expect(parseServerArg('node dist/stdio.js')).toEqual({
        type: 'command',
        command: 'node',
        args: ['dist/stdio.js'],
      });
    });

    it('should parse a real-world npx command', () => {
      expect(parseServerArg('npx -y @modelcontextprotocol/server-filesystem /')).toEqual({
        type: 'command',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/'],
      });
    });

    it('should parse a uvx command with --flag=value', () => {
      expect(parseServerArg('uvx mcp-server-time --local-timezone=Europe/Prague')).toEqual({
        type: 'command',
        command: 'uvx',
        args: ['mcp-server-time', '--local-timezone=Europe/Prague'],
      });
    });

    it('should preserve single-quoted tokens', () => {
      expect(parseServerArg("python -c 'import x; x.run()'")).toEqual({
        type: 'command',
        command: 'python',
        args: ['-c', 'import x; x.run()'],
      });
    });

    it('should preserve double-quoted tokens with spaces', () => {
      expect(parseServerArg('node "my server.js"')).toEqual({
        type: 'command',
        command: 'node',
        args: ['my server.js'],
      });
    });

    it('should preserve ${VAR}-looking literals (no expansion)', () => {
      expect(parseServerArg("node 'dist/foo.js' '${PWD}/data'")).toEqual({
        type: 'command',
        command: 'node',
        args: ['dist/foo.js', '${PWD}/data'],
      });
    });

    it('should throw on unbalanced double quote', () => {
      expect(() => parseServerArg('node "unclosed')).toThrow(/Unbalanced double quote/);
    });

    it('should throw on unbalanced single quote', () => {
      expect(() => parseServerArg("node 'unclosed")).toThrow(/Unbalanced single quote/);
    });

    it('should NOT parse a single-word non-hostname as inline command', () => {
      // No whitespace → falls through to URL step, which succeeds for any non-special token.
      // Single-word stdio binaries require the `--` form (handled by the CLI, not parseServerArg).
      expect(parseServerArg('mcp-fs')).toEqual({ type: 'url', url: 'mcp-fs' });
    });

    it('should prefer config-file branch for paths-with-spaces ending in .json', () => {
      // Config file extension wins over whitespace heuristic.
      expect(parseServerArg('./path with space.json')).toEqual({
        type: 'config-file',
        file: './path with space.json',
      });
    });

    it('should prefer config-file branch for absolute paths-with-spaces', () => {
      // Path-character heuristic wins over whitespace heuristic.
      expect(parseServerArg('./my dir/server.json')).toEqual({
        type: 'config-file',
        file: './my dir/server.json',
      });
    });

    it('should not parse URL-with-port-and-path as command (no whitespace)', () => {
      expect(parseServerArg('mcp.apify.com:8000/v1')).toEqual({
        type: 'url',
        url: 'mcp.apify.com:8000/v1',
      });
    });
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

  it('should not extract --header (connect-specific option)', () => {
    const result = extractOptions(['--header', 'Auth: Bearer token', '--header', 'X-Key: value']);
    expect(result).toEqual({
      json: false,
      verbose: false,
    });
  });

  it('should not extract -H short form (connect-specific option)', () => {
    const result = extractOptions(['-H', 'Auth: token', '-H', 'X-Key: value']);
    expect(result).toEqual({
      json: false,
      verbose: false,
    });
  });

  it('should extract --timeout', () => {
    const result = extractOptions(['--timeout', '120']);
    expect(result).toEqual({ json: false, verbose: false, timeout: 120 });
  });

  it('should extract all global options together', () => {
    const result = extractOptions(['--json', '--verbose', '--timeout', '60']);
    expect(result).toEqual({
      json: true,
      verbose: true,
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
