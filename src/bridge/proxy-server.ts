/**
 * Proxy MCP Server for bridge process
 * Creates an HTTP MCP server that forwards requests to the upstream MCP client
 * without exposing original authentication tokens - useful for AI sandboxing
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'http';
import { Server as MCPServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  SetLevelRequestSchema,
  PingRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpClient } from '../core/mcp-client.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('proxy-server');

export interface ProxyServerOptions {
  host: string;
  port: number;
  client: McpClient;
  sessionName: string;
  bearerToken?: string;
  instructions?: string; // Instructions from upstream server to pass to proxy clients
}

/**
 * Proxy MCP Server class
 * Wraps an upstream MCP client and exposes it as an HTTP MCP server
 */
export class ProxyServer {
  private httpServer: HttpServer | null = null;
  private mcpServer: MCPServer | null = null;
  private transport: StreamableHTTPServerTransport | null = null;
  private options: ProxyServerOptions;

  constructor(options: ProxyServerOptions) {
    this.options = options;
  }

  /**
   * Start the proxy server
   */
  async start(): Promise<void> {
    const { host, port, client, sessionName, bearerToken, instructions } = this.options;

    logger.info(`Starting proxy server on ${host}:${port} for session ${sessionName}`);

    // Create MCP server that forwards to upstream client
    this.mcpServer = new MCPServer(
      {
        name: `mcpc-proxy${sessionName}`,
        version: 'yolo',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {},
        },
        // Pass upstream server's instructions to proxy clients (if available)
        ...(instructions && { instructions }),
      }
    );

    // Register handlers that forward to upstream client
    this.registerHandlers(client);

    // Create HTTP server
    this.httpServer = createServer((req, res) => {
      this.handleRequest(req, res, bearerToken).catch((error) => {
        logger.error('Error handling request:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(port, host, () => {
        logger.info(`Proxy server listening on http://${host}:${port}`);
        resolve();
      });

      this.httpServer!.on('error', (error) => {
        logger.error('HTTP server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    bearerToken?: string
  ): Promise<void> {
    const { method, url } = req;

    logger.debug(`Proxy request: ${method} ${url}`);

    // Health check endpoint
    if (url === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Validate bearer token if configured
    if (bearerToken) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.debug('Missing or invalid Authorization header');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Bearer token required' }));
        return;
      }

      const providedToken = authHeader.slice(7); // Remove 'Bearer ' prefix
      if (providedToken !== bearerToken) {
        logger.debug('Invalid bearer token');
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Invalid bearer token' }));
        return;
      }
    }

    // Handle MCP requests
    if (method === 'POST') {
      // Create transport for this request (stateless - no session management)
      this.transport = new StreamableHTTPServerTransport({});

      // Connect transport to MCP server (cast needed due to exactOptionalPropertyTypes)
      await this.mcpServer!.connect(this.transport as unknown as Transport);

      // Handle the request
      await this.transport.handleRequest(req, res);
      return;
    }

    // Handle GET for SSE (if needed)
    if (method === 'GET') {
      // Create transport for this request (stateless - no session management)
      this.transport = new StreamableHTTPServerTransport({});

      // Connect transport to MCP server (cast needed due to exactOptionalPropertyTypes)
      await this.mcpServer!.connect(this.transport as unknown as Transport);
      await this.transport.handleRequest(req, res);
      return;
    }

    // Handle DELETE for session termination
    if (method === 'DELETE') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'session terminated' }));
      return;
    }

    // Unknown method
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  /**
   * Register MCP request handlers that forward to upstream client
   */
  private registerHandlers(client: McpClient): void {
    // Ping
    this.mcpServer!.setRequestHandler(PingRequestSchema, async () => {
      await client.ping();
      return {};
    });

    // Tools
    this.mcpServer!.setRequestHandler(ListToolsRequestSchema, async (request) => {
      return await client.listTools(request.params?.cursor);
    });

    this.mcpServer!.setRequestHandler(CallToolRequestSchema, async (request) => {
      return await client.callTool(
        request.params.name,
        request.params.arguments
      );
    });

    // Resources
    this.mcpServer!.setRequestHandler(ListResourcesRequestSchema, async (request) => {
      return await client.listResources(request.params?.cursor);
    });

    this.mcpServer!.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
      return await client.listResourceTemplates(request.params?.cursor);
    });

    this.mcpServer!.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return await client.readResource(request.params.uri);
    });

    // Prompts
    this.mcpServer!.setRequestHandler(ListPromptsRequestSchema, async (request) => {
      return await client.listPrompts(request.params?.cursor);
    });

    this.mcpServer!.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return await client.getPrompt(
        request.params.name,
        request.params.arguments
      );
    });

    // Logging
    this.mcpServer!.setRequestHandler(SetLevelRequestSchema, async (request) => {
      await client.setLoggingLevel(request.params.level);
      return {};
    });
  }

  /**
   * Stop the proxy server
   */
  async stop(): Promise<void> {
    logger.info('Stopping proxy server...');

    // Close transport
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        logger.warn('Error closing transport:', error);
      }
      this.transport = null;
    }

    // Close MCP server
    if (this.mcpServer) {
      try {
        await this.mcpServer.close();
      } catch (error) {
        logger.warn('Error closing MCP server:', error);
      }
      this.mcpServer = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => {
          logger.debug('HTTP server closed');
          resolve();
        });
      });
      this.httpServer = null;
    }

    logger.info('Proxy server stopped');
  }

  /**
   * Get the proxy server address
   */
  getAddress(): string {
    return `http://${this.options.host}:${this.options.port}`;
  }
}
