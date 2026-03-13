/**
 * Tools command handlers
 */

import ora from 'ora';
import chalk from 'chalk';
import { formatOutput, formatToolDetail, formatSuccess, formatWarning } from '../output.js';
import { ClientError } from '../../lib/errors.js';
import type { CommandOptions, TaskUpdate } from '../../lib/types.js';
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
    const result = await client.listAllTools();
    console.log(
      formatOutput(result.tools, options.outputMode, options.full ? { full: true } : undefined)
    );
  });
}

/**
 * Get information about a specific tool
 */
export async function getTool(
  target: string,
  name: string,
  options: CommandOptions
): Promise<void> {
  // Load expected schema if provided
  let expectedSchema: ToolSchema | undefined;
  if (options.schema) {
    expectedSchema = (await loadSchemaFromFile(options.schema)) as ToolSchema;
  }

  await withMcpClient(target, options, async (client, _context) => {
    // List all tools and find the matching one
    // TODO: It is wasteful to always re-fetch the full list (applies also to prompts).
    //  We should use the bridge's cached tools list (getCachedTools) to make this more efficient
    const result = await client.listAllTools();
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
 * Format elapsed time as M:SS or H:MM:SS
 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Check if task-augmented execution should be used for a tool call.
 * Async tasks are opt-in via --async or --detach flags.
 */
async function shouldUseTask(
  client: import('../../lib/types.js').IMcpClient,
  async_: boolean | undefined
): Promise<boolean> {
  if (!async_) return false;
  const details = await client.getServerDetails();
  return !!details.capabilities?.tasks?.requests?.tools?.call;
}

/**
 * Call a tool with arguments
 * Arguments can be provided via:
 * 1. Positional args: key:=value pairs or inline JSON
 * 2. Stdin: pipe JSON input (echo '{"key":"value"}' | mcpc ...)
 *
 * Use --async for task-augmented execution with progress spinner.
 * Use --detach to start an async task and return the task ID immediately.
 */
export async function callTool(
  target: string,
  name: string,
  options: CommandOptions & {
    args?: string[];
    async?: boolean;
    detach?: boolean;
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

      const validation = validateToolSchema(
        actualTool as ToolSchema,
        expectedSchema,
        schemaMode,
        parsedArgs
      );

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

    // --detach implies --async
    const useAsync = options.detach || options.async;
    // Check if we should use task-augmented execution
    const useTask = await shouldUseTask(client, useAsync);

    // Warn if --async/--detach was requested but server doesn't support tasks
    if (useAsync && !useTask) {
      if (options.outputMode === 'human') {
        console.log(
          formatWarning(
            'Server does not support async tasks, falling back to synchronous execution'
          )
        );
      }
    }

    let result;

    if (useTask && options.detach) {
      // Detached execution: start async task and return task ID immediately
      const taskUpdate = await client.callToolDetached(name, parsedArgs);

      if (options.outputMode === 'human') {
        console.log(formatSuccess(`Task started: ${taskUpdate.taskId}`));
      } else {
        console.log(formatOutput({ taskId: taskUpdate.taskId, status: taskUpdate.status }, 'json'));
      }
      return;
    } else if (useTask) {
      // Task-augmented execution with progress display
      const startTime = Date.now();
      let spinner: ReturnType<typeof ora> | null = null;
      let timerInterval: ReturnType<typeof setInterval> | null = null;
      let lastStatusMessage: string | undefined;

      const updateSpinnerText = (): void => {
        if (!spinner) return;
        const elapsed = formatElapsed(Date.now() - startTime);
        const statusSuffix = lastStatusMessage ? ` ${chalk.dim(lastStatusMessage)}` : '';
        spinner.text = `Running tool ${chalk.bold(name)}... (${elapsed})${statusSuffix}`;
      };

      if (options.outputMode === 'human') {
        spinner = ora({
          text: `Running tool ${chalk.bold(name)}... (0:00)`,
          color: 'cyan',
        }).start();
        timerInterval = setInterval(updateSpinnerText, 1000);
      }

      const onUpdate = (update: TaskUpdate): void => {
        if (update.statusMessage) {
          lastStatusMessage = update.statusMessage;
        }
        if (spinner) {
          updateSpinnerText();
        }
      };

      try {
        result = await client.callToolWithTask(name, parsedArgs, onUpdate);
        const elapsed = formatElapsed(Date.now() - startTime);
        if (spinner) {
          spinner.succeed(`Tool ${chalk.bold(name)} executed successfully (${elapsed})`);
        }
      } catch (error) {
        const elapsed = formatElapsed(Date.now() - startTime);
        if (spinner) {
          spinner.fail(`Tool ${chalk.bold(name)} failed (${elapsed})`);
        }
        throw error;
      } finally {
        if (timerInterval) clearInterval(timerInterval);
      }
    } else {
      // Synchronous execution (default)
      result = await client.callTool(name, parsedArgs);
      if (options.outputMode === 'human') {
        console.log(formatSuccess(`Tool ${name} executed successfully`));
      }
    }

    if (options.outputMode === 'human') {
      console.log(formatOutput(result, 'human'));
    } else {
      console.log(formatOutput(result, 'json'));
    }
  });
}
