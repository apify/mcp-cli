/**
 * Helper functions for CLI command handlers
 * Provides target resolution and MCP client management
 */

import { createClient } from '../core/factory.js';
import type { McpClient } from '../core/client.js';
import type { OutputMode, TransportConfig } from '../lib/types.js';
import { ClientError, NetworkError } from '../lib/errors.js';
import { isValidUrl } from '../lib/utils.js';
import { setVerbose, createLogger } from '../lib/logger.js';

const logger = createLogger('cli');

/**
 * Resolve a target string to transport configuration
 *
 * Target types:
 * - @<name> - Named session (looks up in sessions.json)
 * - https://... - Remote HTTP server
 * - <package> - Local package name
 * - <config-entry> - Entry from config file (when --config is used)
 */
export async function resolveTarget(
  target: string,
  options: {
    config?: string;
    headers?: string[];
    timeout?: number;
    verbose?: boolean;
  } = {}
): Promise<TransportConfig> {
  if (options.verbose) {
    setVerbose(true);
  }

  // Named session (@name)
  if (target.startsWith('@')) {
    // TODO: Look up session in ~/.mcpc/sessions.json
    throw new ClientError(
      `Named sessions not yet implemented. Session: ${target}\n` +
      `For now, use direct URLs like: mcpc https://mcp.example.com tools-list`
    );
  }

  // HTTP/HTTPS URL
  if (isValidUrl(target)) {
    const headers: Record<string, string> = {};

    // Parse --header flags
    if (options.headers) {
      for (const header of options.headers) {
        const colonIndex = header.indexOf(':');
        if (colonIndex < 1) {
          throw new ClientError(`Invalid header format: ${header}. Use "Key: Value"`);
        }
        const key = header.substring(0, colonIndex).trim();
        const value = header.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    const config: TransportConfig = {
      type: 'http',
      url: target,
      headers,
    };

    // Only include timeout if it's provided
    if (options.timeout) {
      config.timeout = options.timeout * 1000;
    }

    return config;
  }

  // Config file entry
  if (options.config) {
    // TODO: Load config file and look up entry
    throw new ClientError(
      `Config files not yet implemented. Entry: ${target}\n` +
      `For now, use direct URLs like: mcpc https://mcp.example.com tools-list`
    );
  }

  // Local package
  // TODO: Resolve package to stdio transport
  throw new ClientError(
    `Local packages not yet implemented. Package: ${target}\n` +
    `For now, use direct URLs like: mcpc https://mcp.example.com tools-list`
  );
}

/**
 * Execute an operation with an MCP client
 * Handles connection, execution, and cleanup
 *
 * @param target - Target string (URL, @session, package, etc.)
 * @param options - CLI options (verbose, config, headers, etc.)
 * @param callback - Async function that receives the connected client
 */
export async function withMcpClient<T>(
  target: string,
  options: {
    outputMode?: OutputMode;
    config?: string;
    headers?: string[];
    timeout?: number;
    verbose?: boolean;
  },
  callback: (client: McpClient) => Promise<T>
): Promise<T> {
  // Resolve target to transport config
  const transportConfig = await resolveTarget(target, options);

  logger.debug('Resolved target:', { target, transportConfig });

  // Create and connect client
  const clientConfig: Parameters<typeof createClient>[0] = {
    clientInfo: { name: 'mcpc', version: '0.1.0' },
    transport: transportConfig,
    capabilities: {
      // Declare client capabilities
      roots: { listChanged: true },
      sampling: {},
    },
    autoConnect: true,
  };

  // Only include verbose if it's true
  if (options.verbose) {
    clientConfig.verbose = true;
  }

  const client = await createClient(clientConfig);

  try {
    logger.debug('Connected successfully');

    // Execute callback with connected client
    const result = await callback(client);

    return result;
  } catch (error) {
    logger.error('MCP operation failed:', error);

    if (error instanceof NetworkError || error instanceof ClientError) {
      throw error;
    }

    throw new NetworkError(
      `Failed to communicate with MCP server: ${(error as Error).message}`,
      { originalError: error }
    );
  } finally {
    // Always clean up
    try {
      logger.debug('Closing connection...');
      await client.close();
      logger.debug('Connection closed');
    } catch (error) {
      logger.warn('Error closing connection:', error);
    }
  }
}
