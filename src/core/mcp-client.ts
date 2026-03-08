/**
 * MCP Client wrapper
 * Wraps the @modelcontextprotocol/sdk Client class with additional functionality
 */

import { Client as SDKClient, type ClientOptions } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  Implementation,
  ListToolsResult,
  CallToolResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ReadResourceResult,
  ListPromptsResult,
  GetPromptResult,
  LoggingLevel,
  GetTaskResult,
  ListTasksResult,
  CancelTaskResult,
} from '@modelcontextprotocol/sdk/types.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createNoOpLogger, type Logger } from '../lib/logger.js';
import { ServerError, NetworkError, isShutdownError } from '../lib/errors.js';

/**
 * Traverse the .cause chain to find the deepest (most specific) error message
 */
function getRootCauseMessage(error: Error): string {
  let current: Error = error;
  while (current.cause instanceof Error) {
    current = current.cause;
  }
  return current.message;
}
import type { IMcpClient, ServerDetails, TaskUpdate } from '../lib/types.js';
import type { Task } from '@modelcontextprotocol/sdk/types.js';

/**
 * Convert an SDK Task to a TaskUpdate, handling exactOptionalPropertyTypes
 */
function taskToUpdate(task: Task): TaskUpdate {
  const update: TaskUpdate = {
    taskId: task.taskId,
    status: task.status,
    createdAt: task.createdAt,
    lastUpdatedAt: task.lastUpdatedAt,
  };
  if (task.statusMessage) {
    update.statusMessage = task.statusMessage;
  }
  return update;
}

/**
 * Transport with protocol version information (e.g., StreamableHTTPClientTransport)
 */
interface TransportWithProtocolVersion extends Transport {
  protocolVersion?: string;
}

/**
 * Transport with MCP-Session-Id for resumption (e.g., StreamableHTTPClientTransport)
 * Note: The SDK uses 'sessionId' property name
 */
interface TransportWithMcpSessionId extends Transport {
  sessionId?: string;
}

/**
 * Options for creating an MCP client
 */
export interface McpClientOptions extends ClientOptions {
  /**
   * Logger to use for client operations
   */
  logger?: Logger;

  /**
   * Request timeout in milliseconds for MCP operations
   * If not specified, uses SDK default (60 seconds)
   */
  requestTimeout?: number;
}

/**
 * Transport with session termination capability (e.g., StreamableHTTPClientTransport)
 */
interface TransportWithTermination extends Transport {
  terminateSession?: () => Promise<void>;
}

/**
 * MCP Client wrapper class
 * Provides a convenient interface to the MCP SDK Client with error handling and logging
 * Implements IMcpClient interface for compatibility with SessionClient
 */
export class McpClient implements IMcpClient {
  private client: SDKClient;
  private logger: Logger;
  private negotiatedProtocolVersion?: string;
  private mcpSessionId?: string;
  private transport?: TransportWithTermination;
  private hasConnected = false;
  private requestTimeout?: number;

  constructor(clientInfo: Implementation, options: McpClientOptions = {}) {
    this.logger = options.logger || createNoOpLogger();
    if (options.requestTimeout !== undefined) {
      this.requestTimeout = options.requestTimeout;
    }

    this.client = new SDKClient(clientInfo, {
      capabilities: options.capabilities || {},
      ...options,
    });

    // Set up error handling
    this.client.onerror = (error) => {
      // Ignore abort errors - these occur when connection is closed intentionally
      if (isShutdownError(error)) {
        this.logger.debug('Client aborted (expected during close)');
        return;
      }
      // Don't duplicate logging of errors on initial connection
      this.logger.log(this.hasConnected ? 'error' : 'debug', 'Client error:', error);
    };
  }

  /**
   * Override request timeout for subsequent requests (in milliseconds)
   * Used by bridge to apply per-request timeout from CLI --timeout flag
   */
  setRequestTimeout(timeoutMs: number): void {
    this.requestTimeout = timeoutMs;
  }

  /**
   * Get request options with timeout if configured
   */
  private getRequestOptions(): { timeout?: number } | undefined {
    return this.requestTimeout ? { timeout: this.requestTimeout } : undefined;
  }

  /**
   * Connect to an MCP server using the provided transport
   */
  async connect(transport: Transport): Promise<void> {
    try {
      this.logger.debug('Connecting to MCP server...');

      // Store transport for later use (e.g., terminateSession on close)
      this.transport = transport as TransportWithTermination;

      // Set up transport error handlers
      transport.onerror = (error) => {
        // Ignore abort errors - these occur when connection is closed intentionally
        if (isShutdownError(error)) {
          this.logger.debug('Transport aborted (expected during close)');
          return;
        }
        // Don't duplicate logging of errors on initial connection
        this.logger.log(this.hasConnected ? 'error' : 'debug', 'Transport error:', error);
      };

      transport.onclose = () => {
        this.logger.debug('Transport closed');
      };

      await this.client.connect(transport);

      this.hasConnected = true;

      // Capture negotiated protocol version from transport if available
      // StreamableHTTPClientTransport exposes protocolVersion after initialization
      const transportWithVersion = transport as TransportWithProtocolVersion;
      if (transportWithVersion.protocolVersion) {
        this.negotiatedProtocolVersion = transportWithVersion.protocolVersion;
        this.logger.debug(`Negotiated protocol version: ${this.negotiatedProtocolVersion}`);
      }

      // Capture MCP session ID from transport if available (for session resumption)
      // StreamableHTTPClientTransport exposes sessionId after initialization
      const transportWithMcpSessionId = transport as TransportWithMcpSessionId;
      if (transportWithMcpSessionId.sessionId) {
        this.mcpSessionId = transportWithMcpSessionId.sessionId;
        this.logger.debug(`MCP session ID: ${this.mcpSessionId}`);
      }

      const serverVersion = this.client.getServerVersion();
      const serverCapabilities = this.client.getServerCapabilities();

      this.logger.debug(
        `Connected to ${serverVersion?.name || 'unknown'} v${serverVersion?.version || 'unknown'}`
      );
      this.logger.debug('Server capabilities:', serverCapabilities);
    } catch (error) {
      this.logger.debug('Failed to connect:', error);
      throw new NetworkError(
        `Failed to connect to MCP server: ${getRootCauseMessage(error as Error)}`,
        {
          originalError: error,
        }
      );
    }
  }

  /**
   * Close the connection to the server
   * For HTTP transport, sends DELETE request to terminate session before closing
   */
  async close(): Promise<void> {
    this.logger.debug('Closing connection...');

    try {
      // For HTTP transport, terminate the session first (sends HTTP DELETE)
      // This is separate from close() in the SDK - terminateSession() sends the DELETE,
      // while close() just cleans up the client without notifying the server
      if (this.transport?.terminateSession) {
        this.logger.debug('Terminating session (sending DELETE)...');
        try {
          await Promise.race([
            this.transport.terminateSession(),
            new Promise<void>((resolve) => setTimeout(resolve, 2000)),
          ]);
          this.logger.debug('Session terminated');
        } catch (error) {
          this.logger.debug('Error terminating session:', error);
        }
      }

      // Now close the client
      await Promise.race([
        this.client.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      ]);
      this.logger.debug('Connection closed');
    } catch (error) {
      this.logger.debug('Error during close (ignored):', error);
    }
  }

  /**
   * Get all server information in a single call
   * Returns a Promise for interface compatibility with SessionClient
   * Structure matches MCP InitializeResult for consistency
   */
  getServerDetails(): Promise<ServerDetails> {
    const details: ServerDetails = {};
    const serverInfo = this.client.getServerVersion();
    const capabilities = this.client.getServerCapabilities();
    const instructions = this.client.getInstructions();

    if (this.negotiatedProtocolVersion) details.protocolVersion = this.negotiatedProtocolVersion;
    if (capabilities) details.capabilities = capabilities;
    if (serverInfo) details.serverInfo = serverInfo;
    if (instructions) details.instructions = instructions;

    return Promise.resolve(details);
  }

  /**
   * Get the MCP session ID assigned by the server (if any)
   * This can be used for session resumption after bridge restart
   */
  getMcpSessionId(): string | undefined {
    return this.mcpSessionId;
  }

  /**
   * Ping the server
   */
  async ping(): Promise<void> {
    try {
      this.logger.debug('Sending ping...');
      await this.client.ping(this.getRequestOptions());
      this.logger.debug('Ping successful');
    } catch (error) {
      this.logger.error('Ping failed:', error);
      throw new NetworkError(`Ping failed: ${(error as Error).message}`, { originalError: error });
    }
  }

  /**
   * List available tools
   */
  async listTools(cursor?: string): Promise<ListToolsResult> {
    try {
      this.logger.debug('Listing tools...', cursor ? { cursor } : {});
      const result = await this.client.listTools({ cursor }, this.getRequestOptions());
      this.logger.debug(`Found ${result.tools.length} tools`);
      return result;
    } catch (error) {
      this.logger.error('Failed to list tools:', error);
      throw new ServerError(`Failed to list tools: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * Call a tool
   */
  async callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    try {
      this.logger.debug(`Calling tool: ${name}`, args);
      const result = (await this.client.callTool(
        {
          name,
          arguments: args || {},
        },
        undefined, // resultSchema - use default
        this.getRequestOptions()
      )) as CallToolResult;
      this.logger.debug(`Tool ${name} completed`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to call tool ${name}:`, error);
      throw new ServerError(`Failed to call tool ${name}: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * List available resources
   */
  async listResources(cursor?: string): Promise<ListResourcesResult> {
    try {
      this.logger.debug('Listing resources...', cursor ? { cursor } : {});
      const result = await this.client.listResources({ cursor }, this.getRequestOptions());
      this.logger.debug(`Found ${result.resources.length} resources`);
      return result;
    } catch (error) {
      this.logger.error('Failed to list resources:', error);
      throw new ServerError(`Failed to list resources: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * List available resource templates
   */
  async listResourceTemplates(cursor?: string): Promise<ListResourceTemplatesResult> {
    try {
      this.logger.debug('Listing resource templates...', cursor ? { cursor } : {});
      const result = await this.client.listResourceTemplates({ cursor }, this.getRequestOptions());
      this.logger.debug(`Found ${result.resourceTemplates.length} resource templates`);
      return result;
    } catch (error) {
      this.logger.error('Failed to list resource templates:', error);
      throw new ServerError(`Failed to list resource templates: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<ReadResourceResult> {
    try {
      this.logger.debug(`Reading resource: ${uri}`);
      const result = await this.client.readResource({ uri }, this.getRequestOptions());
      this.logger.debug(`Resource ${uri} read successfully`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to read resource ${uri}:`, error);
      throw new ServerError(`Failed to read resource ${uri}: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * Subscribe to resource updates
   */
  async subscribeResource(uri: string): Promise<void> {
    try {
      this.logger.debug(`Subscribing to resource: ${uri}`);
      await this.client.subscribeResource({ uri }, this.getRequestOptions());
      this.logger.debug(`Subscribed to resource ${uri}`);
    } catch (error) {
      this.logger.error(`Failed to subscribe to resource ${uri}:`, error);
      throw new ServerError(`Failed to subscribe to resource ${uri}: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * Unsubscribe from resource updates
   */
  async unsubscribeResource(uri: string): Promise<void> {
    try {
      this.logger.debug(`Unsubscribing from resource: ${uri}`);
      await this.client.unsubscribeResource({ uri }, this.getRequestOptions());
      this.logger.debug(`Unsubscribed from resource ${uri}`);
    } catch (error) {
      this.logger.error(`Failed to unsubscribe from resource ${uri}:`, error);
      throw new ServerError(
        `Failed to unsubscribe from resource ${uri}: ${(error as Error).message}`,
        { originalError: error }
      );
    }
  }

  /**
   * List available prompts
   */
  async listPrompts(cursor?: string): Promise<ListPromptsResult> {
    try {
      this.logger.debug('Listing prompts...', cursor ? { cursor } : {});
      const result = await this.client.listPrompts({ cursor }, this.getRequestOptions());
      this.logger.debug(`Found ${result.prompts.length} prompts`);
      return result;
    } catch (error) {
      this.logger.error('Failed to list prompts:', error);
      throw new ServerError(`Failed to list prompts: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * Get a prompt
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    try {
      this.logger.debug(`Getting prompt: ${name}`, args);
      const result = (await this.client.getPrompt(
        {
          name,
          arguments: args,
        },
        this.getRequestOptions()
      )) as GetPromptResult;
      this.logger.debug(`Prompt ${name} retrieved`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to get prompt ${name}:`, error);
      throw new ServerError(`Failed to get prompt ${name}: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * Set the logging level on the server
   */
  async setLoggingLevel(level: LoggingLevel): Promise<void> {
    try {
      this.logger.debug(`Setting log level to: ${level}`);
      await this.client.setLoggingLevel(level, this.getRequestOptions());
      this.logger.debug('Log level set successfully');
    } catch (error) {
      this.logger.error(`Failed to set log level:`, error);
      throw new ServerError(`Failed to set log level: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * Check if the server supports task-augmented tool calls
   */
  supportsTasksForToolCall(): boolean {
    const capabilities = this.client.getServerCapabilities();
    return !!capabilities?.tasks?.requests?.tools?.call;
  }

  /**
   * Call a tool with task-augmented execution
   * Uses the SDK's experimental callToolStream which handles task creation,
   * polling, and result retrieval automatically via an AsyncGenerator.
   */
  async callToolWithTask(
    name: string,
    args?: Record<string, unknown>,
    onUpdate?: (update: TaskUpdate) => void
  ): Promise<CallToolResult> {
    try {
      this.logger.debug(`Calling tool with task: ${name}`, args);
      const stream = this.client.experimental.tasks.callToolStream(
        { name, arguments: args || {} },
        CallToolResultSchema,
        this.getRequestOptions()
      );

      let result: CallToolResult | undefined;

      for await (const message of stream) {
        switch (message.type) {
          case 'taskCreated':
            this.logger.debug(`Task created: ${message.task.taskId}`);
            onUpdate?.(taskToUpdate(message.task));
            break;

          case 'taskStatus':
            this.logger.debug(`Task ${message.task.taskId} status: ${message.task.status}`);
            onUpdate?.(taskToUpdate(message.task));
            break;

          case 'result':
            this.logger.debug(`Task completed with result for tool ${name}`);
            result = message.result as CallToolResult;
            break;

          case 'error':
            this.logger.error(`Task error for tool ${name}:`, message.error);
            throw new ServerError(`Tool ${name} task failed: ${message.error.message}`, {
              originalError: message.error,
            });
        }
      }

      if (!result) {
        throw new ServerError(`Tool ${name} task completed without a result`);
      }

      return result;
    } catch (error) {
      if (error instanceof ServerError) throw error;
      this.logger.error(`Failed to call tool ${name} with task:`, error);
      throw new ServerError(`Failed to call tool ${name} with task: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * List tasks on the server
   */
  async listTasks(cursor?: string): Promise<ListTasksResult> {
    try {
      this.logger.debug('Listing tasks...', cursor ? { cursor } : {});
      const result = await this.client.experimental.tasks.listTasks(
        cursor,
        this.getRequestOptions()
      );
      this.logger.debug(`Found ${result.tasks.length} tasks`);
      return result;
    } catch (error) {
      this.logger.error('Failed to list tasks:', error);
      throw new ServerError(`Failed to list tasks: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * Get a task's current status
   */
  async getTask(taskId: string): Promise<GetTaskResult> {
    try {
      this.logger.debug(`Getting task: ${taskId}`);
      const result = await this.client.experimental.tasks.getTask(taskId, this.getRequestOptions());
      this.logger.debug(`Task ${taskId} status: ${result.status}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to get task ${taskId}:`, error);
      throw new ServerError(`Failed to get task ${taskId}: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * Cancel a running task
   */
  async cancelTask(taskId: string): Promise<CancelTaskResult> {
    try {
      this.logger.debug(`Cancelling task: ${taskId}`);
      const result = await this.client.experimental.tasks.cancelTask(
        taskId,
        this.getRequestOptions()
      );
      this.logger.debug(`Task ${taskId} cancelled`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to cancel task ${taskId}:`, error);
      throw new ServerError(`Failed to cancel task ${taskId}: ${(error as Error).message}`, {
        originalError: error,
      });
    }
  }

  /**
   * Get the underlying SDK client instance
   * Use this for advanced operations not covered by the wrapper
   */
  getSDKClient(): SDKClient {
    return this.client;
  }
}
