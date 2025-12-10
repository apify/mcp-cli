/**
 * Sessions command handlers
 */

import type { OutputMode } from '../../lib/types.js';
import { formatOutput, formatSuccess } from '../output.js';

/**
 * Connect to an MCP server and create a session
 */
export async function connectSession(
  name: string,
  target: string,
  options: { outputMode: OutputMode }
): Promise<void> {
  // TODO: Create bridge process and session

  if (options.outputMode === 'human') {
    console.log(formatSuccess(`Session '${name}' created successfully`));
    console.log(`  Target: ${target}`);
    console.log(`\nUse "mcpc @${name} tools list" to list available tools.`);
  } else {
    console.log(
      formatOutput(
        {
          session: name,
          target,
          created: true,
        },
        'json'
      )
    );
  }
}

/**
 * List active sessions
 */
export async function listSessions(options: { outputMode: OutputMode }): Promise<void> {
  // TODO: Read from sessions.json

  const mockSessions = [
    {
      name: 'apify',
      target: 'https://mcp.apify.com',
      transport: 'http',
      createdAt: new Date().toISOString(),
    },
    {
      name: 'local',
      target: 'node server.js',
      transport: 'stdio',
      createdAt: new Date().toISOString(),
    },
  ];

  console.log(formatOutput(mockSessions, options.outputMode));
}

/**
 * Close a session
 */
export async function closeSession(
  name: string,
  options: { outputMode: OutputMode }
): Promise<void> {
  // TODO: Terminate bridge process and clean up

  if (options.outputMode === 'human') {
    console.log(formatSuccess(`Session '${name}' closed`));
  } else {
    console.log(
      formatOutput(
        {
          session: name,
          closed: true,
        },
        'json'
      )
    );
  }
}
