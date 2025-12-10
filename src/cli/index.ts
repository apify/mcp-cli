#!/usr/bin/env node

/**
 * Main CLI entry point for mcpc
 * Handles command parsing, routing, and output formatting
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { Command } from 'commander';
import { setVerbose } from '../lib/logger.js';
import { isMcpError, formatError } from '../lib/errors.js';
import { formatJsonError } from './output.js';
import * as tools from './commands/tools.js';
import * as resources from './commands/resources.js';
import * as prompts from './commands/prompts.js';
import * as sessions from './commands/sessions.js';
import type { OutputMode } from '../lib/types.js';

// Get version from package.json
const packageJson = { version: '0.1.0' }; // TODO: Import dynamically

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('mcpc')
    .description('Command-line client for the Model Context Protocol (MCP)')
    .version(packageJson.version, '-v, --version', 'Output the version number')
    .option('-j, --json', 'Output in JSON format')
    .option('--verbose', 'Enable verbose logging')
    .option('-c, --config <path>', 'Path to configuration file');

  // Connect command
  program
    .command('connect <name> <target>')
    .description('Connect to an MCP server and create a session')
    .action(async (name, target, _options, command) => {
      const opts = command.optsWithGlobals();
      if (opts.verbose) setVerbose(true);

      await sessions.connectSession(name, target, {
        outputMode: opts.json ? 'json' : 'human',
      });
    });

  // Sessions command
  program
    .command('sessions')
    .description('List active sessions')
    .action(async (_options, command) => {
      const opts = command.optsWithGlobals();
      if (opts.verbose) setVerbose(true);

      await sessions.listSessions({
        outputMode: opts.json ? 'json' : 'human',
      });
    });

  // Tools commands
  const toolsCmd = program.command('tools').description('Manage MCP tools');

  toolsCmd
    .command('list')
    .description('List available tools')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async (options, command) => {
      const opts = command.optsWithGlobals();
      if (opts.verbose) setVerbose(true);

      await tools.listTools({
        cursor: options.cursor,
        outputMode: opts.json ? 'json' : 'human',
      });
    });

  toolsCmd
    .command('get <name>')
    .description('Get information about a specific tool')
    .action(async (name, _options, command) => {
      const opts = command.optsWithGlobals();
      if (opts.verbose) setVerbose(true);

      await tools.getTool(name, {
        outputMode: opts.json ? 'json' : 'human',
      });
    });

  toolsCmd
    .command('call <name>')
    .description('Call a tool with arguments')
    .option('-a, --args <json>', 'Tool arguments as JSON')
    .action(async (name, options, command) => {
      const opts = command.optsWithGlobals();
      if (opts.verbose) setVerbose(true);

      await tools.callTool(name, {
        args: options.args,
        outputMode: opts.json ? 'json' : 'human',
      });
    });

  // Resources commands
  const resourcesCmd = program.command('resources').description('Manage MCP resources');

  resourcesCmd
    .command('list')
    .description('List available resources')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async (options, command) => {
      const opts = command.optsWithGlobals();
      if (opts.verbose) setVerbose(true);

      await resources.listResources({
        cursor: options.cursor,
        outputMode: opts.json ? 'json' : 'human',
      });
    });

  resourcesCmd
    .command('get <uri>')
    .description('Get a resource by URI')
    .action(async (uri, _options, command) => {
      const opts = command.optsWithGlobals();
      if (opts.verbose) setVerbose(true);

      await resources.getResource(uri, {
        outputMode: opts.json ? 'json' : 'human',
      });
    });

  resourcesCmd
    .command('subscribe <uri>')
    .description('Subscribe to resource updates')
    .action(async (uri, _options, command) => {
      const opts = command.optsWithGlobals();
      if (opts.verbose) setVerbose(true);

      await resources.subscribeResource(uri, {
        outputMode: opts.json ? 'json' : 'human',
      });
    });

  resourcesCmd
    .command('unsubscribe <uri>')
    .description('Unsubscribe from resource updates')
    .action(async (uri, _options, command) => {
      const opts = command.optsWithGlobals();
      if (opts.verbose) setVerbose(true);

      await resources.unsubscribeResource(uri, {
        outputMode: opts.json ? 'json' : 'human',
      });
    });

  // Prompts commands
  const promptsCmd = program.command('prompts').description('Manage MCP prompts');

  promptsCmd
    .command('list')
    .description('List available prompts')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async (options, command) => {
      const opts = command.optsWithGlobals();
      if (opts.verbose) setVerbose(true);

      await prompts.listPrompts({
        cursor: options.cursor,
        outputMode: opts.json ? 'json' : 'human',
      });
    });

  promptsCmd
    .command('get <name>')
    .description('Get a prompt by name')
    .option('-a, --args <json>', 'Prompt arguments as JSON')
    .action(async (name, options, command) => {
      const opts = command.optsWithGlobals();
      if (opts.verbose) setVerbose(true);

      await prompts.getPrompt(name, {
        args: options.args,
        outputMode: opts.json ? 'json' : 'human',
      });
    });

  // Parse and execute
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const opts = program.opts();
    const outputMode: OutputMode = opts.json ? 'json' : 'human';

    if (isMcpError(error)) {
      if (outputMode === 'json') {
        console.error(formatJsonError(error, error.code));
      } else {
        console.error(formatError(error, opts.verbose));
      }
      process.exit(error.code);
    }

    // Unknown error
    console.error(
      outputMode === 'json'
        ? formatJsonError(error as Error, 1)
        : formatError(error as Error, opts.verbose)
    );
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
