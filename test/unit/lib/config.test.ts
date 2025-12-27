/**
 * Unit tests for config file loading
 */

import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadConfig, getServerConfig, validateServerConfig, listServers } from '../../../src/lib/config';
import { ClientError } from '../../../src/lib/errors';

const TEST_DIR = join(process.cwd(), 'test-tmp-config');

beforeAll(() => {
  // Create test directory
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  // Clean up test directory
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('should load valid config file', () => {
    const configPath = join(TEST_DIR, 'valid-config.json');
    const configContent = {
      mcpServers: {
        'test-server': {
          url: 'https://test.example.com',
          headers: { 'X-Test': 'value' },
        },
      },
    };

    writeFileSync(configPath, JSON.stringify(configContent));

    const config = loadConfig(configPath);
    expect(config.mcpServers).toHaveProperty('test-server');
    const testServer = config.mcpServers['test-server'];
    expect(testServer).toBeDefined();
    expect(testServer?.url).toBe('https://test.example.com');
  });

  it('should throw on missing file', () => {
    const configPath = join(TEST_DIR, 'non-existent.json');
    expect(() => loadConfig(configPath)).toThrow(ClientError);
    expect(() => loadConfig(configPath)).toThrow('Config file not found');
  });

  it('should throw on invalid JSON', () => {
    const configPath = join(TEST_DIR, 'invalid.json');
    writeFileSync(configPath, '{ invalid json }');

    expect(() => loadConfig(configPath)).toThrow(ClientError);
    expect(() => loadConfig(configPath)).toThrow('Invalid JSON');
  });

  it('should throw on missing mcpServers field', () => {
    const configPath = join(TEST_DIR, 'no-servers.json');
    writeFileSync(configPath, JSON.stringify({ other: 'field' }));

    expect(() => loadConfig(configPath)).toThrow(ClientError);
    expect(() => loadConfig(configPath)).toThrow('missing or invalid "mcpServers" field');
  });
});

describe('getServerConfig', () => {
  const config = {
    mcpServers: {
      'http-server': {
        url: 'https://api.example.com',
        headers: { Authorization: 'Bearer ${API_TOKEN}' },
        timeout: 60,
      },
      'stdio-server': {
        command: 'node',
        args: ['server.js'],
        env: { DEBUG: '${DEBUG_MODE}' },
      },
    },
  };

  beforeEach(() => {
    // Set test environment variables
    process.env.API_TOKEN = 'test-token-123';
    process.env.DEBUG_MODE = 'true';
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.API_TOKEN;
    delete process.env.DEBUG_MODE;
  });

  it('should return server config by name', () => {
    const serverConfig = getServerConfig(config, 'http-server');
    expect(serverConfig.url).toBe('https://api.example.com');
    expect(serverConfig.timeout).toBe(60);
  });

  it('should substitute environment variables in HTTP config', () => {
    const serverConfig = getServerConfig(config, 'http-server');
    expect(serverConfig.headers?.Authorization).toBe('Bearer test-token-123');
  });

  it('should substitute environment variables in stdio config', () => {
    const serverConfig = getServerConfig(config, 'stdio-server');
    expect(serverConfig.env?.DEBUG).toBe('true');
  });

  it('should use empty string for missing environment variables', () => {
    delete process.env.API_TOKEN;
    const serverConfig = getServerConfig(config, 'http-server');
    expect(serverConfig.headers?.Authorization).toBe('Bearer ');
  });

  it('should throw on non-existent server', () => {
    expect(() => getServerConfig(config, 'non-existent')).toThrow(ClientError);
    expect(() => getServerConfig(config, 'non-existent')).toThrow('Server "non-existent" not found');
  });

  it('should list available servers in error message', () => {
    expect(() => getServerConfig(config, 'unknown')).toThrow('Available servers: http-server, stdio-server');
  });
});

describe('validateServerConfig', () => {
  it('should validate HTTP server config', () => {
    const config = { url: 'https://api.example.com' };
    expect(validateServerConfig(config)).toBe(true);
  });

  it('should validate stdio server config', () => {
    const config = { command: 'node', args: ['server.js'] };
    expect(validateServerConfig(config)).toBe(true);
  });

  it('should reject config without url or command', () => {
    const config = { timeout: 60 };
    expect(() => validateServerConfig(config)).toThrow(ClientError);
    expect(() => validateServerConfig(config)).toThrow('must specify either "url" (for HTTP) or "command" (for stdio)');
  });

  it('should reject config with both url and command', () => {
    const config = { url: 'https://example.com', command: 'node' };
    expect(() => validateServerConfig(config)).toThrow(ClientError);
    expect(() => validateServerConfig(config)).toThrow('cannot specify both "url" and "command"');
  });

  it('should reject invalid URL protocol', () => {
    const config = { url: 'ftp://example.com' };
    expect(() => validateServerConfig(config)).toThrow(ClientError);
    expect(() => validateServerConfig(config)).toThrow('must start with http:// or https://');
  });

  it('should reject empty command', () => {
    const config = { command: '' };
    expect(() => validateServerConfig(config)).toThrow(ClientError);
    expect(() => validateServerConfig(config)).toThrow('must be a non-empty string');
  });
});

describe('listServers', () => {
  it('should list all server names', () => {
    const config = {
      mcpServers: {
        server1: { url: 'https://example.com' },
        server2: { command: 'node' },
        server3: { url: 'https://test.com' },
      },
    };

    const servers = listServers(config);
    expect(servers).toEqual(['server1', 'server2', 'server3']);
  });

  it('should return empty array for empty config', () => {
    const config = { mcpServers: {} };
    const servers = listServers(config);
    expect(servers).toEqual([]);
  });
});

describe('environment variable substitution', () => {
  beforeEach(() => {
    process.env.TEST_VAR = 'test-value';
    process.env.ANOTHER_VAR = 'another-value';
  });

  afterEach(() => {
    delete process.env.TEST_VAR;
    delete process.env.ANOTHER_VAR;
  });

  it('should substitute multiple variables in URL', () => {
    const config = {
      mcpServers: {
        test: {
          url: 'https://${TEST_VAR}.example.com/${ANOTHER_VAR}',
        },
      },
    };

    const serverConfig = getServerConfig(config, 'test');
    expect(serverConfig.url).toBe('https://test-value.example.com/another-value');
  });

  it('should substitute variables in command and args', () => {
    const config = {
      mcpServers: {
        test: {
          command: '${TEST_VAR}',
          args: ['--flag=${ANOTHER_VAR}'],
        },
      },
    };

    const serverConfig = getServerConfig(config, 'test');
    expect(serverConfig.command).toBe('test-value');
    expect(serverConfig.args).toEqual(['--flag=another-value']);
  });

  it('should not substitute if no variables present', () => {
    const config = {
      mcpServers: {
        test: {
          url: 'https://example.com',
        },
      },
    };

    const serverConfig = getServerConfig(config, 'test');
    expect(serverConfig.url).toBe('https://example.com');
  });
});
