/**
 * Prompts command handlers
 */

import type { CommandOptions } from '../../lib/types.js';
import { formatOutput, truncateOutput } from '../output.js';
import { withMcpClient } from '../helpers.js';
import { parseCommandArgs, hasStdinData, readStdinArgs } from '../parser.js';

/**
 * List available prompts
 * Automatically fetches all pages if pagination is present
 */
export async function listPrompts(target: string, options: CommandOptions): Promise<void> {
  await withMcpClient(target, options, async (client, _context) => {
    // Fetch all prompts across all pages
    const allPrompts = [];
    let cursor: string | undefined = undefined;

    do {
      const result = await client.listPrompts(cursor);
      allPrompts.push(...result.prompts);
      cursor = result.nextCursor;
    } while (cursor);

    console.log(formatOutput(allPrompts, options.outputMode));
  });
}

/**
 * Get a prompt by name
 * Arguments can be provided via:
 * 1. Positional args: key:=value pairs or inline JSON
 * 2. Stdin: pipe JSON input (echo '{"key":"value"}' | mcpc ...)
 */
export async function getPrompt(
  target: string,
  name: string,
  options: CommandOptions & {
    args?: string[];
  }
): Promise<void> {
  // Parse args from positional arguments or stdin
  let parsedArgs: Record<string, unknown>;

  // Prefer positional arguments; only read stdin if no args provided and stdin has data
  if (options.args && options.args.length > 0) {
    // Parse from positional arguments (key:=value pairs or inline JSON)
    parsedArgs = parseCommandArgs(options.args);
  } else if (hasStdinData()) {
    // Read arguments from stdin (piped JSON)
    parsedArgs = await readStdinArgs();
  } else {
    // No arguments provided
    parsedArgs = {};
  }

  // Convert all args to strings for prompt API
  const promptArgs: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsedArgs)) {
    promptArgs[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  await withMcpClient(target, options, async (client, _context) => {
    const result = await client.getPrompt(name, promptArgs);

    let output = formatOutput(result, options.outputMode);
    if (options.maxChars) {
      output = truncateOutput(output, options.maxChars);
    }
    console.log(output);
  });
}
