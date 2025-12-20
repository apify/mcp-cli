/**
 * Session-aware MCP client wrapper
 * Adapts BridgeClient to look like McpClient for seamless session support
 */

import type {
  Implementation,
  ServerCapabilities,
  ListToolsResult,
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
  ListPromptsResult,
  GetPromptResult,
  LoggingLevel,
  IMcpClient,
} from './types.js';
import type { ListResourceTemplatesResult } from '@modelcontextprotocol/sdk/types.js';
import { BridgeClient } from './bridge-client.js';
import { getSession } from './sessions.js';
import { ensureBridgeHealthy } from './bridge-manager.js';
import { ClientError } from './errors.js';

/**
 * Wrapper that makes BridgeClient compatible with McpClient interface
 * Implements IMcpClient by sending requests to bridge process via IPC
 */
export class SessionClient implements IMcpClient {
  private bridgeClient: BridgeClient;

  constructor(_sessionName: string, socketPath: string) {
    this.bridgeClient = new BridgeClient(socketPath);
  }

  async connect(): Promise<void> {
    await this.bridgeClient.connect();
  }

  async close(): Promise<void> {
    await this.bridgeClient.close();
  }

  // Server info methods
  async getServerCapabilities(): Promise<ServerCapabilities | undefined> {
    return (await this.bridgeClient.request('getServerCapabilities')) as ServerCapabilities | undefined;
  }

  async getServerVersion(): Promise<Implementation | undefined> {
    return (await this.bridgeClient.request('getServerVersion')) as Implementation | undefined;
  }

  async getInstructions(): Promise<string | undefined> {
    return (await this.bridgeClient.request('getInstructions')) as string | undefined;
  }

  async getProtocolVersion(): Promise<string | undefined> {
    return (await this.bridgeClient.request('getProtocolVersion')) as string | undefined;
  }

  // MCP operations
  async ping(): Promise<void> {
    await this.bridgeClient.request('ping');
  }

  async listTools(cursor?: string): Promise<ListToolsResult> {
    return (await this.bridgeClient.request('listTools', cursor)) as ListToolsResult;
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    return (await this.bridgeClient.request('callTool', { name, arguments: args })) as CallToolResult;
  }

  async listResources(cursor?: string): Promise<ListResourcesResult> {
    return (await this.bridgeClient.request('listResources', cursor)) as ListResourcesResult;
  }

  async listResourceTemplates(cursor?: string): Promise<ListResourceTemplatesResult> {
    return (await this.bridgeClient.request('listResourceTemplates', cursor)) as ListResourceTemplatesResult;
  }

  async readResource(uri: string): Promise<ReadResourceResult> {
    return (await this.bridgeClient.request('readResource', { uri })) as ReadResourceResult;
  }

  async subscribeResource(uri: string): Promise<void> {
    await this.bridgeClient.request('subscribeResource', { uri });
  }

  async unsubscribeResource(uri: string): Promise<void> {
    await this.bridgeClient.request('unsubscribeResource', { uri });
  }

  async listPrompts(cursor?: string): Promise<ListPromptsResult> {
    return (await this.bridgeClient.request('listPrompts', cursor)) as ListPromptsResult;
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    return (await this.bridgeClient.request('getPrompt', { name, arguments: args })) as GetPromptResult;
  }

  async setLoggingLevel(level: LoggingLevel): Promise<void> {
    await this.bridgeClient.request('setLoggingLevel', level);
  }

  // Compatibility method for SDK client
  getSDKClient(): never {
    throw new Error('SessionClient does not expose underlying SDK client');
  }
}

/**
 * Create a client for a session
 * Automatically handles bridge health checks and reconnection
 */
export async function createSessionClient(sessionName: string): Promise<SessionClient> {
  // Get session info
  const session = await getSession(sessionName);

  if (!session) {
    throw new ClientError(`Session not found: ${sessionName}`);
  }

  if (!session.socketPath) {
    throw new ClientError(`Session ${sessionName} has no socket path`);
  }

  // Ensure bridge is healthy (auto-restart if needed)
  await ensureBridgeHealthy(sessionName);

  // Create and connect client
  const client = new SessionClient(sessionName, session.socketPath);
  await client.connect();

  return client;
}

/**
 * Execute a callback with a session client
 * Handles connection and cleanup automatically
 */
export async function withSessionClient<T>(
  sessionName: string,
  callback: (client: IMcpClient) => Promise<T>
): Promise<T> {
  const client = await createSessionClient(sessionName);

  try {
    const result = await callback(client);
    return result;
  } finally {
    await client.close();
  }
}
