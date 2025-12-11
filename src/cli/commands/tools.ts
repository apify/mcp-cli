/**
 * Tools command handlers
 */

import type { OutputMode } from '../../lib/types.js';
import { formatOutput, formatToolDetail, formatSuccess } from '../output.js';
import { ClientError } from '../../lib/errors.js';

/**
 * List available tools
 */
export async function listTools(
  target: string,
  options: {
    cursor?: string;
    outputMode: OutputMode;
  }
): Promise<void> {
  // TODO: Connect to MCP client using target and list tools
  // For now, return mock data

  const mockTools = [
    {
      name: 'search',
      description: 'Search for information',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      inputSchema: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression' },
        },
        required: ['expression'],
      },
    },
  ];

  console.log(`[Using target: ${target}]`);
  console.log(formatOutput(mockTools, options.outputMode));
}

/**
 * Get information about a specific tool
 */
export async function getTool(
  target: string,
  name: string,
  options: { outputMode: OutputMode }
): Promise<void> {
  // TODO: Connect to MCP client using target and get tool

  const mockTool = {
    name,
    description: `Description for ${name}`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        param: { type: 'string' },
      },
    },
  };

  if (options.outputMode === 'json') {
    console.log(formatOutput(mockTool, 'json'));
  } else {
    console.log(`[Using target: ${target}]`);
    console.log(formatToolDetail(mockTool));
  }
}

/**
 * Call a tool with arguments
 */
export async function callTool(
  target: string,
  name: string,
  options: {
    args?: string[];
    argsFile?: string;
    outputMode: OutputMode;
  }
): Promise<void> {
  // TODO: Connect to MCP client using target and call tool

  // Parse args from key=value or key:=json pairs
  let parsedArgs: Record<string, unknown> = {};

  if (options.argsFile) {
    // TODO: Load args from file
    throw new ClientError('--args-file is not implemented yet');
  } else if (options.args) {
    // Parse key=value or key:=json pairs
    for (const pair of options.args) {
      if (pair.includes(':=')) {
        const parts = pair.split(':=', 2);
        const key = parts[0];
        const jsonValue = parts[1];
        if (!key || jsonValue === undefined) {
          throw new ClientError(`Invalid argument format: ${pair}. Use key=value or key:=json`);
        }
        try {
          parsedArgs[key] = JSON.parse(jsonValue);
        } catch (error) {
          throw new ClientError(`Invalid JSON value for ${key}: ${(error as Error).message}`);
        }
      } else if (pair.includes('=')) {
        const parts = pair.split('=', 2);
        const key = parts[0];
        const value = parts[1];
        if (!key || value === undefined) {
          throw new ClientError(`Invalid argument format: ${pair}. Use key=value or key:=json`);
        }
        parsedArgs[key] = value;
      } else {
        throw new ClientError(`Invalid argument format: ${pair}. Use key=value or key:=json`);
      }
    }
  }

  const mockResult = {
    content: [
      {
        type: 'text',
        text: `Result of calling ${name} with args: ${JSON.stringify(parsedArgs)}`,
      },
    ],
  };

  if (options.outputMode === 'human') {
    console.log(`[Using target: ${target}]`);
    console.log(formatSuccess(`Tool ${name} executed successfully`));
    console.log(formatOutput(mockResult, 'human'));
  } else {
    console.log(formatOutput(mockResult, 'json'));
  }
}
