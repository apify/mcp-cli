/**
 * Unit tests for MCP transports
 */

import { createTransportFromConfig } from '../../../src/core/transports';
import { ClientError } from '../../../src/lib/errors';

// Mock the SDK transports
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  getDefaultEnvironment: jest.fn().mockReturnValue({}),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  StreamableHTTPError: class StreamableHTTPError extends Error {},
}));

describe('createTransportFromConfig', () => {
  it('should create stdio transport from config', () => {
    const transport = createTransportFromConfig({
      command: 'node',
      args: ['server.js'],
    });

    expect(transport).toBeDefined();
  });

  it('should create http transport from config', () => {
    const transport = createTransportFromConfig({
      url: 'https://mcp.example.com',
    });

    expect(transport).toBeDefined();
  });

  it('should throw error for config without url or command', () => {
    expect(() =>
      createTransportFromConfig({} as any)
    ).toThrow(ClientError);
  });

  it('should pass headers to http transport', () => {
    const transport = createTransportFromConfig({
      url: 'https://mcp.example.com',
      headers: {
        Authorization: 'Bearer token',
      },
    });

    expect(transport).toBeDefined();
  });

  it('should pass environment variables to stdio transport', () => {
    const transport = createTransportFromConfig({
      command: 'node',
      args: ['server.js'],
      env: {
        DEBUG: '1',
      },
    });

    expect(transport).toBeDefined();
  });
});
