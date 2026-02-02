/**
 * Tools command handlers
 */

import { formatOutput, formatToolDetail, formatSuccess, formatWarning } from '../output.js';
import { ClientError } from '../../lib/errors.js';
import type { CommandOptions } from '../../lib/types.js';
import { withMcpClient } from '../helpers.js';
import { parseCommandArgs, hasStdinData, readStdinArgs } from '../parser.js';
import {
  loadSchemaFromFile,
  validateToolSchema,
  formatValidationError,
  type ToolSchema,
  type SchemaMode,
} from '../../lib/schema-validator.js';


/**
 * List available tools
 * Automatically fetches all pages if pagination is present
 * By default shows compact format; use --full for complete details
 */
export async function listTools(
  target: string,
  options: CommandOptions & { full?: boolean }
): Promise<void> {
  await withMcpClient(target, options, async (client, _context) => {
    // Fetch all tools across all pages
    const allTools = [];
    let cursor: string | undefined = undefined;

    do {
      const result = await client.listTools(cursor);
      allTools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);

    console.log(formatOutput(allTools, options.outputMode, options.full ? { full: true } : undefined));
  });
}

/**
 * Get information about a specific tool
 */
export async function getTool(target: string, name: string, options: CommandOptions): Promise<void> {
  // Load expected schema if provided
  let expectedSchema: ToolSchema | undefined;
  if (options.schema) {
    expectedSchema = (await loadSchemaFromFile(options.schema)) as ToolSchema;
  }

  await withMcpClient(target, options, async (client, _context) => {
    // List all tools and find the matching one
    // TODO: It is wasteful to always re-fetch the full list (applies also to prompts),
    //  especially considering that MCP SDK client caches these.
    //  We should use SDK's or our own cache on bridge to make this more efficient
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === name);

    if (!tool) {
      throw new ClientError(`Tool not found: ${name}`);
    }

    // Validate schema if provided
    if (expectedSchema) {
      const schemaMode: SchemaMode = options.schemaMode || 'compatible';
      const validation = validateToolSchema(tool as ToolSchema, expectedSchema, schemaMode);

      if (!validation.valid) {
        throw new ClientError(formatValidationError(validation, `tool "${name}"`));
      }

      // Show warnings in human mode
      if (validation.warnings.length > 0 && options.outputMode === 'human') {
        for (const warning of validation.warnings) {
          console.log(formatWarning(`Schema warning: ${warning}`));
        }
      }
    }

    if (options.outputMode === 'human') {
      console.log(formatToolDetail(tool));
    } else {
      console.log(formatOutput(tool, 'json'));
    }
  });
}

/**
 * Call a tool with arguments
 * Arguments can be provided via:
 * 1. Positional args: key:=value pairs or inline JSON
 * 2. Stdin: pipe JSON input (echo '{"key":"value"}' | mcpc ...)
 */
export async function callTool(
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

  // Load expected schema if provided
  let expectedSchema: ToolSchema | undefined;
  if (options.schema) {
    expectedSchema = (await loadSchemaFromFile(options.schema)) as ToolSchema;
  }

  await withMcpClient(target, options, async (client, _context) => {
    // Validate schema if provided (skip entirely in ignore mode)
    const schemaMode: SchemaMode = options.schemaMode || 'compatible';
    if (expectedSchema && schemaMode !== 'ignore') {
      const result = await client.listTools();
      const actualTool = result.tools.find((t) => t.name === name);

      if (!actualTool) {
        throw new ClientError(`Tool not found: ${name}`);
      }

      const validation = validateToolSchema(actualTool as ToolSchema, expectedSchema, schemaMode, parsedArgs);

      if (!validation.valid) {
        throw new ClientError(formatValidationError(validation, `tool "${name}"`));
      }

      // Show warnings in human mode
      if (validation.warnings.length > 0 && options.outputMode === 'human') {
        for (const warning of validation.warnings) {
          console.log(formatWarning(`Schema warning: ${warning}`));
        }
      }
    }

    const result = await client.callTool(name, parsedArgs);

    if (options.outputMode === 'human') {
      console.log(formatSuccess(`Tool ${name} executed successfully`));
      console.log(formatOutput(result, 'human'));
    } else {
      console.log(formatOutput(result, 'json'));
    }
  });
}
