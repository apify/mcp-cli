/**
 * Prompts command handlers
 */

import type { OutputMode } from '../../lib/types.js';
import { formatOutput } from '../output.js';
import { ClientError } from '../../lib/errors.js';

/**
 * List available prompts
 */
export async function listPrompts(options: {
  cursor?: string;
  outputMode: OutputMode;
}): Promise<void> {
  // TODO: Connect to MCP client and list prompts

  const mockPrompts = [
    {
      name: 'summarize',
      description: 'Summarize a document',
      arguments: [{ name: 'document', description: 'Document to summarize', required: true }],
    },
    {
      name: 'translate',
      description: 'Translate text to another language',
      arguments: [
        { name: 'text', description: 'Text to translate', required: true },
        { name: 'language', description: 'Target language', required: true },
      ],
    },
  ];

  console.log(formatOutput(mockPrompts, options.outputMode));
}

/**
 * Get a prompt by name
 */
export async function getPrompt(
  name: string,
  options: {
    args?: string;
    outputMode: OutputMode;
  }
): Promise<void> {
  // TODO: Connect to MCP client and get prompt

  // Parse args JSON
  let parsedArgs: Record<string, string> = {};
  if (options.args) {
    try {
      parsedArgs = JSON.parse(options.args) as Record<string, string>;
    } catch (error) {
      throw new ClientError(`Invalid JSON in --args: ${(error as Error).message}`);
    }
  }

  const mockPrompt = {
    description: `Prompt: ${name}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Prompt ${name} with args: ${JSON.stringify(parsedArgs)}`,
        },
      },
    ],
  };

  console.log(formatOutput(mockPrompt, options.outputMode));
}
