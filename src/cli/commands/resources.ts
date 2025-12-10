/**
 * Resources command handlers
 */

import type { OutputMode } from '../../lib/types.js';
import { formatOutput, formatSuccess } from '../output.js';

/**
 * List available resources
 */
export async function listResources(options: {
  cursor?: string;
  outputMode: OutputMode;
}): Promise<void> {
  // TODO: Connect to MCP client and list resources

  const mockResources = [
    {
      uri: 'file:///documents/report.pdf',
      name: 'Annual Report',
      mimeType: 'application/pdf',
      description: '2024 annual report',
    },
    {
      uri: 'https://api.example.com/data',
      name: 'API Data',
      mimeType: 'application/json',
      description: 'Live data from API',
    },
  ];

  console.log(formatOutput(mockResources, options.outputMode));
}

/**
 * Get a resource by URI
 */
export async function getResource(uri: string, options: { outputMode: OutputMode }): Promise<void> {
  // TODO: Connect to MCP client and get resource

  const mockResource = {
    uri,
    contents: [
      {
        uri,
        mimeType: 'text/plain',
        text: `Content of resource: ${uri}`,
      },
    ],
  };

  console.log(formatOutput(mockResource, options.outputMode));
}

/**
 * Subscribe to resource updates
 */
export async function subscribeResource(
  uri: string,
  options: { outputMode: OutputMode }
): Promise<void> {
  // TODO: Connect to MCP client and subscribe

  if (options.outputMode === 'human') {
    console.log(formatSuccess(`Subscribed to resource: ${uri}`));
  } else {
    console.log(formatOutput({ subscribed: true, uri }, 'json'));
  }
}

/**
 * Unsubscribe from resource updates
 */
export async function unsubscribeResource(
  uri: string,
  options: { outputMode: OutputMode }
): Promise<void> {
  // TODO: Connect to MCP client and unsubscribe

  if (options.outputMode === 'human') {
    console.log(formatSuccess(`Unsubscribed from resource: ${uri}`));
  } else {
    console.log(formatOutput({ unsubscribed: true, uri }, 'json'));
  }
}
