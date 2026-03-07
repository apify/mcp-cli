#!/usr/bin/env node

/**
 * Main CLI entry point for mcpc
 * Handles command parsing, routing, and output formatting
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { Command } from 'commander';
import { setVerbose, setJsonMode, closeFileLogger } from '../lib/index.js';
import { isMcpError, formatHumanError, ClientError } from '../lib/index.js';
import { formatJson, formatJsonError, rainbow } from './output.js';
import * as tools from './commands/tools.js';
import * as resources from './commands/resources.js';
import * as prompts from './commands/prompts.js';
import * as sessions from './commands/sessions.js';
import * as logging from './commands/logging.js';
import * as utilities from './commands/utilities.js';
import * as auth from './commands/auth.js';
import { handleX402Command } from './commands/x402.js';
import { clean } from './commands/clean.js';
import type { OutputMode } from '../lib/index.js';
import {
  extractOptions,
  getVerboseFromEnv,
  getJsonFromEnv,
  validateOptions,
  validateArgValues,
  parseServerArg,
  hasSubcommand,
  optionTakesValue,
  KNOWN_COMMANDS,
  KNOWN_SESSION_COMMANDS,
} from './parser.js';
import { createRequire } from 'module';
const { version: mcpcVersion } = createRequire(import.meta.url)('../../package.json') as {
  version: string;
};

// Set up HTTP proxy from environment variables (HTTPS_PROXY, HTTP_PROXY, NO_PROXY, and lowercase variants)
setGlobalDispatcher(new EnvHttpProxyAgent());

/**
 * Options passed to command handlers
 */
interface HandlerOptions {
  outputMode: OutputMode;
  headers?: string[];
  timeout?: number;
  verbose?: boolean;
  profile?: string;
  x402?: boolean;
  schema?: string;
  schemaMode?: 'strict' | 'compatible' | 'ignore';
  full?: boolean;
}

/**
 * Extract options from Commander's Command object
 * Used by command handlers to get parsed options in consistent format
 * Environment variables MCPC_VERBOSE and MCPC_JSON are used as defaults
 */
function getOptionsFromCommand(command: Command): HandlerOptions {
  const opts = command.optsWithGlobals ? command.optsWithGlobals() : command.opts();

  // Check for verbose from flag or environment variable
  const verbose = opts.verbose || getVerboseFromEnv();
  if (verbose) setVerbose(true);

  // Check for JSON mode from flag or environment variable
  const json = opts.json || getJsonFromEnv();
  if (json) setJsonMode(true);

  const options: HandlerOptions = {
    outputMode: (json ? 'json' : 'human') as OutputMode,
  };

  // Only include optional properties if they're present
  if (opts.header) {
    // Commander stores repeated options as arrays, but single values as strings
    // Always convert to array for consistent handling
    options.headers = Array.isArray(opts.header) ? opts.header : [opts.header];
  }
  if (opts.timeout) {
    const timeout = parseInt(opts.timeout as string, 10);
    if (isNaN(timeout) || timeout <= 0) {
      throw new Error(
        `Invalid --timeout value: "${opts.timeout as string}". Must be a positive number (seconds).`
      );
    }
    options.timeout = timeout;
  }
  if (opts.profile) options.profile = opts.profile;
  if (verbose) options.verbose = verbose;
  if (opts.x402) options.x402 = true;
  if (opts.schema) options.schema = opts.schema;
  if (opts.schemaMode) {
    const mode = opts.schemaMode as string;
    if (mode !== 'strict' && mode !== 'compatible' && mode !== 'ignore') {
      throw new Error(`Invalid --schema-mode value: "${mode}". Valid modes are: strict, compatible, ignore`);
    }
    options.schemaMode = mode;
  }
  if (opts.full) options.full = opts.full;

  return options;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Set up cleanup handlers for graceful shutdown
  const handleExit = (): void => {
    void closeFileLogger().then(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', handleExit);
  process.on('SIGINT', handleExit);
  process.on('exit', () => {
    // Synchronous cleanup on exit (file logger handles this gracefully)
    void closeFileLogger();
  });

  // Check for version flag - handle JSON output specially
  if (args.includes('--version') || args.includes('-v')) {
    const options = extractOptions(args);
    if (options.json) {
      setJsonMode(true);
      console.log(formatJson({ version: mcpcVersion }));
    } else {
      console.log(mcpcVersion);
    }
    return;
  }

  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    const program = createTopLevelProgram();
    await program.parseAsync(process.argv);
    return;
  }

  // Validate all options are known (before any processing)
  // Argument validation errors are always plain text - --json only applies to command output
  try {
    validateOptions(args);
    validateArgValues(args);
  } catch (error) {
    console.error(formatHumanError(error as Error, false));
    process.exit(1);
  }

  // Find the first non-option argument to determine routing
  let firstNonOption: string | undefined;
  let firstNonOptionIndex = -1;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg.startsWith('-')) {
      if (optionTakesValue(arg) && !arg.includes('=') && i + 1 < args.length) {
        i++; // skip value
      }
      continue;
    }
    firstNonOption = arg;
    firstNonOptionIndex = i;
    break;
  }

  // No args → list sessions
  if (!firstNonOption) {
    const { json } = extractOptions(args);
    if (json) setJsonMode(true);
    await sessions.listSessionsAndAuthProfiles({ outputMode: json ? 'json' : 'human' });
    if (!json) {
      console.log('\nRun "mcpc --help" for usage information.\n');
    }
    await closeFileLogger();
    return;
  }

  // Session command: @name [subcommand]
  if (firstNonOption.startsWith('@')) {
    const session = firstNonOption;
    const modifiedArgs = [
      ...process.argv.slice(0, 2),
      ...args.slice(0, firstNonOptionIndex),
      ...args.slice(firstNonOptionIndex + 1),
    ];

    try {
      await handleSessionCommands(session, modifiedArgs);
    } catch (error) {
      if (isMcpError(error)) {
        const opts = extractOptions(args);
        const outputMode: OutputMode = opts.json ? 'json' : 'human';
        if (outputMode === 'json') {
          console.error(formatJsonError(error, error.code));
        } else {
          console.error(formatHumanError(error, opts.verbose));
        }
        process.exit(error.code);
      }
      throw error;
    } finally {
      await closeFileLogger();
    }

    // Flush stdout before exiting
    await flushStdout();
    process.exit(0);
  }

  // Top-level commands: login, logout, connect, clean, help, x402
  if (KNOWN_COMMANDS.includes(firstNonOption)) {
    // Handle x402 separately (legacy standalone handler)
    if (firstNonOption === 'x402') {
      const x402Args = args.slice(firstNonOptionIndex + 1);
      await handleX402Command(x402Args);
      await closeFileLogger();
      return;
    }

    try {
      const program = createTopLevelProgram();
      await program.parseAsync(process.argv);
    } catch (error) {
      if (isMcpError(error)) {
        const opts = extractOptions(args);
        const outputMode: OutputMode = opts.json ? 'json' : 'human';
        if (outputMode === 'json') {
          console.error(formatJsonError(error, error.code));
        } else {
          console.error(formatHumanError(error, opts.verbose));
        }
        process.exit(error.code);
      }
      throw error;
    } finally {
      await closeFileLogger();
    }
    return;
  }

  // Unknown command — provide helpful error
  const opts = extractOptions(args);
  const outputMode: OutputMode = opts.json ? 'json' : 'human';

  const allCommands = [...KNOWN_COMMANDS, ...KNOWN_SESSION_COMMANDS];
  if (allCommands.includes(firstNonOption)) {
    // It's a session subcommand used without @session
    if (outputMode === 'json') {
      console.error(
        formatJsonError(new Error(`Missing session target for command: ${firstNonOption}`), 1)
      );
    } else {
      console.error(`Error: Missing session target for command: ${firstNonOption}`);
      console.error(`\nDid you mean: mcpc <@session> ${firstNonOption}`);
      console.error(`Run "mcpc --help" for usage information.\n`);
    }
  } else {
    if (outputMode === 'json') {
      console.error(formatJsonError(new Error(`Unknown command: ${firstNonOption}`), 1));
    } else {
      console.error(`Error: Unknown command: ${firstNonOption}`);
      console.error(`Run "mcpc --help" for usage information.\n`);
    }
  }
  await closeFileLogger();
  process.exit(1);
}

/**
 * Create the top-level Commander program with global commands
 * (login, logout, connect, clean, help)
 */
function createTopLevelProgram(): Command {
  const program = new Command();

  // Configure help output width to avoid wrapping (default is 80)
  program.configureOutput({
    outputError: (str, write) => write(str),
    getOutHelpWidth: () => 100,
    getErrHelpWidth: () => 100,
  });

  // Strip [options] from the commands list (options are shown per-command via `mcpc help <cmd>`)
  program.configureHelp({
    subcommandTerm: (cmd) =>
      `${cmd.name()} ${cmd.usage()}`.replace(/^\[options\]\s*|\s*\[options\]/g, '').trim(),
  });

  // Use raw Markdown URL for pipes (AI agents), GitHub UI for TTY (humans)
  const docsUrl = process.stdout.isTTY
    ? `https://github.com/apify/mcpc/tree/v${mcpcVersion}`
    : `https://raw.githubusercontent.com/apify/mcpc/v${mcpcVersion}/README.md`;

  program
    .name('mcpc')
    .description(
      `${rainbow('Universal')} command-line client for the Model Context Protocol (MCP).`
    )
    .usage('[options] [<@session>] [<command>]')
    .option('-j, --json', 'Output in JSON format for scripting')
    .option('-H, --header <header>', 'HTTP header (can be repeated)')
    .option('--verbose', 'Enable debug logging')
    .option('--profile <name>', 'OAuth profile for the server ("default" if not provided)')
    .option('--schema <file>', 'Validate tool/prompt schema against expected schema')
    .option('--schema-mode <mode>', 'Schema validation mode: strict, compatible (default), ignore')
    .option('--timeout <seconds>', 'Request timeout in seconds (default: 300)')
    .version(mcpcVersion, '-v, --version', 'Output the version number')
    .helpOption('-h, --help', 'Display help');

  program.addHelpText(
    'after',
    `
Session commands (after connecting):
  <@session>                   Show MCP server info and capabilities
  <@session> shell             Open interactive shell
  <@session> close             Close the session
  <@session> restart           Kill and restart the session
  <@session> tools-list        List MCP tools
  <@session> tools-get <name>
  <@session> tools-call <name> [arg:=val ... | <json> | <stdin]
  <@session> prompts-list
  <@session> prompts-get <name> [arg:=val ... | <json> | <stdin]
  <@session> resources-list
  <@session> resources-read <uri>
  <@session> resources-subscribe <uri>
  <@session> resources-unsubscribe <uri>
  <@session> resources-templates-list
  <@session> logging-set-level <level>
  <@session> ping

Run "mcpc" without arguments to show active sessions and OAuth profiles.

Full docs: ${docsUrl}`
  );

  // connect command: mcpc connect <server> @<name>
  program
    .command('connect [server] [@session]')
    .usage('<server> <@session>')
    .description('Connect to an MCP server and start a new named @session')
    .option('--profile <name>', 'OAuth profile to use ("default" if skipped)')
    .option('--proxy <[host:]port>', 'Start proxy MCP server for session')
    .option('--proxy-bearer-token <token>', 'Require authentication for access to proxy server')
    .option('--x402', 'Enable x402 auto-payment using the configured wallet')
    .addHelpText(
      'after',
      `
Server formats:
  mcp.apify.com                 Remote HTTP server (https:// added automatically)
  ~/.vscode/mcp.json:puppeteer  Config file entry (file:entry)
`
    )
    .action(async (server, sessionName, opts, command) => {
      if (!server) {
        throw new ClientError(
          'Missing required argument: server\n\nExample: mcpc connect mcp.apify.com @myapp'
        );
      }
      if (!sessionName) {
        throw new ClientError(
          'Missing required argument: @session\n\nExample: mcpc connect mcp.apify.com @myapp'
        );
      }
      const globalOpts = getOptionsFromCommand(command);
      const parsed = parseServerArg(server);

      if (!parsed) {
        throw new ClientError(
          `Invalid server: "${server}"\n\n` +
            `Expected a URL (e.g. mcp.apify.com) or a config file entry (e.g. ~/.vscode/mcp.json:filesystem)`
        );
      }

      if (parsed.type === 'config') {
        // Config file entry: pass entry name as target with config file path
        await sessions.connectSession(parsed.entry, sessionName, {
          ...globalOpts,
          config: parsed.file,
          proxy: opts.proxy,
          proxyBearerToken: opts.proxyBearerToken,
          x402: opts.x402,
        });
      } else {
        await sessions.connectSession(server, sessionName, {
          ...globalOpts,
          proxy: opts.proxy,
          proxyBearerToken: opts.proxyBearerToken,
          x402: opts.x402,
        });
      }
    });

  // close command: mcpc close @<session>
  program
    .command('close [@session]', { hidden: true })
    .usage('<@session>')
    .description('Close a session')
    .action(async (sessionName, _opts, command) => {
      if (!sessionName) {
        throw new ClientError('Missing required argument: @session\n\nExample: mcpc close @myapp');
      }
      await sessions.closeSession(sessionName, getOptionsFromCommand(command));
    });

  // restart command: mcpc restart @<session>
  program
    .command('restart [@session]', { hidden: true })
    .usage('<@session>')
    .description('Restart a session')
    .action(async (sessionName, _opts, command) => {
      if (!sessionName) {
        throw new ClientError(
          'Missing required argument: @session\n\nExample: mcpc restart @myapp'
        );
      }
      await sessions.restartSession(sessionName, getOptionsFromCommand(command));
    });

  // shell command: mcpc shell @<session>
  program
    .command('shell [@session]', { hidden: true })
    .usage('<@session>')
    .description('Open interactive shell for a session')
    .action(async (sessionName) => {
      if (!sessionName) {
        throw new ClientError('Missing required argument: @session\n\nExample: mcpc shell @myapp');
      }
      await sessions.openShell(sessionName);
    });

  // login command: mcpc login <server>
  program
    .command('login [server]')
    .usage('<server>')
    .description('Authenticate to server using OAuth and save the profile')
    .option('--profile <name>', 'Profile name (default: "default")')
    .option('--scope <scope>', 'OAuth scope(s) to request')
    .action(async (server, opts, command) => {
      if (!server) {
        throw new ClientError(
          'Missing required argument: server\n\nExample: mcpc login mcp.apify.com'
        );
      }
      await auth.login(server, {
        profile: opts.profile,
        scope: opts.scope,
        ...getOptionsFromCommand(command),
      });
    });

  // logout command: mcpc logout <server>
  program
    .command('logout [server]')
    .usage('<server>')
    .description('Delete an authentication profile for a server')
    .option('--profile <name>', 'Profile name (default: "default")')
    .action(async (server, opts, command) => {
      if (!server) {
        throw new ClientError(
          'Missing required argument: server\n\nExample: mcpc logout mcp.apify.com'
        );
      }
      await auth.logout(server, {
        profile: opts.profile,
        ...getOptionsFromCommand(command),
      });
    });

  // clean command: mcpc clean [resources...]
  program
    .command('clean [resources...]')
    .description('Clean up mcpc data (sessions, profiles, logs, all)')
    .addHelpText(
      'after',
      `
Resources:
  sessions    Remove stale/crashed session records
  profiles    Remove authentication profiles
  logs        Remove bridge log files
  all         Remove all of the above

Without arguments, performs safe cleanup of stale data only.
`
    )
    .action(async (resources: string[], _opts, command) => {
      const globalOpts = getOptionsFromCommand(command);

      // Validate clean types
      const VALID_CLEAN_TYPES = ['sessions', 'profiles', 'logs', 'all'];
      for (const r of resources) {
        if (!VALID_CLEAN_TYPES.includes(r)) {
          throw new ClientError(
            `Invalid clean resource: "${r}". Valid resources are: ${VALID_CLEAN_TYPES.join(', ')}`
          );
        }
      }

      await clean({
        outputMode: globalOpts.outputMode,
        sessions: resources.includes('sessions'),
        profiles: resources.includes('profiles'),
        logs: resources.includes('logs'),
        all: resources.includes('all'),
      });
    });

  // x402 command: mcpc x402 <subcommand>
  // Note: x402 is handled before Commander in main() — this registration exists only for help text
  program
    .command('x402 [subcommand] [args...]')
    .description('Configure an x402 payment wallet (EXPERIMENTAL)')
    .addHelpText(
      'after',
      `
Subcommands:
  init          Create a new x402 wallet
  import <key>  Import wallet from private key
  info          Show wallet info
  sign -r <b64> Sign payment from PAYMENT-REQUIRED header
  remove        Remove the wallet
`
    )
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .action(() => {});

  // help command: mcpc help [command]
  program
    .command('help [command]')
    .description('Show help for a specific command')
    .action((cmdName?: string) => {
      if (!cmdName) {
        program.outputHelp();
        return;
      }

      // Check top-level commands
      const topLevelCmd = program.commands.find(
        (c) => c.name() === cmdName || c.aliases().includes(cmdName)
      );
      if (topLevelCmd) {
        topLevelCmd.outputHelp();
        return;
      }

      // Check session subcommands
      const dummyProgram = new Command();
      registerSessionCommands(dummyProgram, '@dummy');
      const sessionCmd = dummyProgram.commands.find(
        (c) => c.name() === cmdName || c.aliases().includes(cmdName)
      );
      if (sessionCmd) {
        sessionCmd.outputHelp();
        return;
      }

      console.error(`Unknown command: ${cmdName}`);
      console.error(`Run "mcpc --help" for usage information.`);
      process.exit(1);
    });

  // Default action (no args) — list sessions
  program.action(async () => {
    const opts = program.opts();
    const json = opts.json || getJsonFromEnv();
    if (json) setJsonMode(true);
    await sessions.listSessionsAndAuthProfiles({ outputMode: json ? 'json' : 'human' });
    if (!json) {
      console.log('\nRun "mcpc --help" for usage information.\n');
    }
  });

  return program;
}

/**
 * Register all session subcommands on a Commander program
 * Extracted so it can be reused for both execution and help lookup
 */
function registerSessionCommands(program: Command, session: string): void {
  // Help command
  program
    .command('help')
    .description('Show server instructions and available capabilities')
    .action(async (_options, command) => {
      await sessions.showHelp(session, getOptionsFromCommand(command));
    });

  // Shell command
  program
    .command('shell')
    .description('Interactive shell for the session')
    .action(async () => {
      await sessions.openShell(session);
    });

  // Close command
  program
    .command('close')
    .description('Close the session')
    .action(async (_options, command) => {
      await sessions.closeSession(session, getOptionsFromCommand(command));
    });

  // Restart command
  program
    .command('restart')
    .description('Restart the session (stop and start the bridge)')
    .action(async (_options, command) => {
      await sessions.restartSession(session, getOptionsFromCommand(command));
    });

  // Tools commands
  program
    .command('tools')
    .description('List available tools (shorthand for tools-list)')
    .option('--full', 'Show full tool details including complete input schema')
    .action(async (_options, command) => {
      await tools.listTools(session, getOptionsFromCommand(command));
    });

  program
    .command('tools-list')
    .description('List available tools')
    .option('--full', 'Show full tool details including complete input schema')
    .action(async (_options, command) => {
      await tools.listTools(session, getOptionsFromCommand(command));
    });

  program
    .command('tools-get <name>')
    .description('Get information about a specific tool')
    .action(async (name, _options, command) => {
      await tools.getTool(session, name, getOptionsFromCommand(command));
    });

  program
    .command('tools-call <name> [args...]')
    .description('Call a tool with arguments (key:=value pairs or JSON)')
    .action(async (name, args, _options, command) => {
      await tools.callTool(session, name, {
        args,
        ...getOptionsFromCommand(command),
      });
    });

  // Resources commands
  program
    .command('resources')
    .description('List available resources (shorthand for resources-list)')
    .action(async (_options, command) => {
      await resources.listResources(session, getOptionsFromCommand(command));
    });

  program
    .command('resources-list')
    .description('List available resources')
    .action(async (_options, command) => {
      await resources.listResources(session, getOptionsFromCommand(command));
    });

  program
    .command('resources-read <uri>')
    .description('Get a resource by URI')
    .option('-o, --output <file>', 'Write resource to file')
    .option('--max-size <bytes>', 'Maximum resource size in bytes')
    .action(async (uri, options, command) => {
      await resources.getResource(session, uri, {
        output: options.output,
        maxSize: options.maxSize,
        ...getOptionsFromCommand(command),
      });
    });

  program
    .command('resources-subscribe <uri>')
    .description('Subscribe to resource updates')
    .action(async (uri, _options, command) => {
      await resources.subscribeResource(session, uri, getOptionsFromCommand(command));
    });

  program
    .command('resources-unsubscribe <uri>')
    .description('Unsubscribe from resource updates')
    .action(async (uri, _options, command) => {
      await resources.unsubscribeResource(session, uri, getOptionsFromCommand(command));
    });

  program
    .command('resources-templates-list')
    .description('List available resource templates')
    .action(async (_options, command) => {
      await resources.listResourceTemplates(session, getOptionsFromCommand(command));
    });

  // Prompts commands
  program
    .command('prompts')
    .description('List available prompts (shorthand for prompts-list)')
    .action(async (_options, command) => {
      await prompts.listPrompts(session, getOptionsFromCommand(command));
    });

  program
    .command('prompts-list')
    .description('List available prompts')
    .action(async (_options, command) => {
      await prompts.listPrompts(session, getOptionsFromCommand(command));
    });

  program
    .command('prompts-get <name> [args...]')
    .description('Get a prompt by name with arguments (key:=value pairs or JSON)')
    .action(async (name, args, _options, command) => {
      await prompts.getPrompt(session, name, {
        args,
        ...getOptionsFromCommand(command),
      });
    });

  // Logging commands
  program
    .command('logging-set-level <level>')
    .description(
      'Set server logging level (debug, info, notice, warning, error, critical, alert, emergency)'
    )
    .action(async (level, _options, command) => {
      await logging.setLogLevel(session, level, getOptionsFromCommand(command));
    });

  // Server commands
  program
    .command('ping')
    .description('Ping the MCP server to check if it is alive')
    .action(async (_options, command) => {
      await utilities.ping(session, getOptionsFromCommand(command));
    });
}

/**
 * Create a Commander program for session subcommands
 * Separate from top-level program to avoid command name conflicts
 */
function createSessionProgram(): Command {
  const program = new Command();

  program.configureOutput({
    outputError: (str, write) => write(str),
    getOutHelpWidth: () => 100,
    getErrHelpWidth: () => 100,
  });

  program
    .name('mcpc <@session>')
    .helpOption('-h, --help', 'Display help')
    .option('-j, --json', 'Output in JSON format for scripting and code mode')
    .option('-H, --header <header>', 'Custom HTTP header (can be repeated)')
    .option('--verbose', 'Enable debug logging')
    .option('--profile <name>', 'OAuth profile override')
    .option('--schema <file>', 'Validate tool/prompt schema against expected schema')
    .option('--schema-mode <mode>', 'Schema validation mode: strict, compatible (default), ignore')
    .option('--timeout <seconds>', 'Request timeout in seconds (default: 300)');

  return program;
}

/**
 * Handle commands for a session target (@name)
 */
async function handleSessionCommands(session: string, args: string[]): Promise<void> {
  // Check if no subcommand provided - show server info
  if (!hasSubcommand(args)) {
    const options = extractOptions(args);
    if (options.verbose) setVerbose(true);
    if (options.json) setJsonMode(true);

    await sessions.showServerDetails(session, {
      outputMode: options.json ? 'json' : 'human',
      ...(options.verbose && { verbose: true }),
      ...(options.timeout !== undefined && { timeout: options.timeout }),
    });
    return;
  }

  const program = createSessionProgram();

  // Register all session subcommands
  registerSessionCommands(program, session);

  // Parse and execute
  try {
    await program.parseAsync(args);
  } catch (error) {
    const opts = program.opts();
    const outputMode: OutputMode = opts.json ? 'json' : 'human';

    if (isMcpError(error)) {
      if (outputMode === 'json') {
        console.error(formatJsonError(error, error.code));
      } else {
        console.error(formatHumanError(error, opts.verbose));
      }
      process.exit(error.code);
    }

    // Unknown error
    console.error(
      outputMode === 'json'
        ? formatJsonError(error as Error, 1)
        : formatHumanError(error as Error, opts.verbose)
    );
    process.exit(1);
  }
}

/**
 * Flush stdout before exiting to prevent truncation with pipes
 */
async function flushStdout(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (process.stdout.writableFinished) {
      resolve();
    } else {
      process.stdout.once('finish', resolve);
      process.stdout.end();
    }
  });
}

// Run main function
main().catch(async (error) => {
  console.error('Fatal error:', error);
  await closeFileLogger();
  process.exit(1);
});
