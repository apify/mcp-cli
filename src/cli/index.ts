#!/usr/bin/env node

/**
 * Main CLI entry point for mcpc
 * Handles command parsing, routing, and output formatting
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { initProxy } from '../lib/proxy.js';
import { Command, Help } from 'commander';
import { setVerbose, setJsonMode, closeFileLogger } from '../lib/index.js';
import { isMcpError, formatHumanError, ClientError } from '../lib/index.js';
import chalk from 'chalk';
import { formatJson, formatJsonError, rainbow } from './output.js';
import * as tools from './commands/tools.js';
import * as resources from './commands/resources.js';
import * as prompts from './commands/prompts.js';
import * as sessions from './commands/sessions.js';
import * as logging from './commands/logging.js';
import * as utilities from './commands/utilities.js';
import * as auth from './commands/auth.js';
import * as tasks from './commands/tasks.js';
import * as grepCmd from './commands/grep.js';
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
  suggestCommand,
  KNOWN_COMMANDS,
  KNOWN_SESSION_COMMANDS,
} from './parser.js';
import { createRequire } from 'module';
const { version: mcpcVersion } = createRequire(import.meta.url)('../../package.json') as {
  version: string;
};

// Set up HTTP proxy from environment variables (HTTPS_PROXY, HTTP_PROXY, NO_PROXY, and lowercase variants)
// Also handle --insecure flag to disable TLS certificate verification (for self-signed certs)
{
  const insecure = process.argv.includes('--insecure');
  initProxy({ insecure });
}

/**
 * Options passed to command handlers
 */
interface HandlerOptions {
  outputMode: OutputMode;
  headers?: string[];
  timeout?: number;
  verbose?: boolean;
  profile?: string;
  noProfile?: boolean;
  x402?: boolean;
  insecure?: boolean;
  schema?: string;
  schemaMode?: 'strict' | 'compatible' | 'ignore';
  full?: boolean;
  maxChars?: number;
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
  if (opts.timeout) {
    const timeout = parseInt(opts.timeout as string, 10);
    if (isNaN(timeout) || timeout <= 0) {
      throw new Error(
        `Invalid --timeout value: "${opts.timeout as string}". Must be a positive number (seconds).`
      );
    }
    options.timeout = timeout;
  }
  if (opts.profile === false) {
    options.noProfile = true;
  } else if (opts.profile) {
    options.profile = opts.profile;
  }
  if (verbose) options.verbose = verbose;
  if (opts.x402) options.x402 = true;
  if (opts.insecure) options.insecure = true;
  if (opts.schema) options.schema = opts.schema;
  if (opts.schemaMode) {
    const mode = opts.schemaMode as string;
    if (mode !== 'strict' && mode !== 'compatible' && mode !== 'ignore') {
      throw new Error(
        `Invalid --schema-mode value: "${mode}". Valid modes are: strict, compatible, ignore`
      );
    }
    options.schemaMode = mode;
  }
  if (opts.full) options.full = opts.full;
  if (opts.maxChars) {
    const maxChars = parseInt(opts.maxChars as string, 10);
    if (isNaN(maxChars) || maxChars <= 0) {
      throw new Error(
        `Invalid --max-chars value: "${opts.maxChars as string}". Must be a positive number (characters).`
      );
    }
    options.maxChars = maxChars;
  }

  return options;
}

/**
 * Format a JSON output help line with backtick-style Markdown formatting.
 * Optional schemaUrl adds a "Schema:" link for AI agents.
 */
function jsonHelp(description: string, shape?: string, schemaUrl?: string): string {
  const line = shape ? `  ${description}: ${shape}` : `  ${description}`;
  const link = schemaUrl ? `\n  Schema: ${schemaUrl}` : '';
  return `\n${chalk.bold('JSON output (--json):')}\n${line}${link}\n`;
}

const SCHEMA_BASE = 'https://modelcontextprotocol.io/specification/2025-11-25/schema';

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
  // x402 has its own Commander program with full subcommand help, so pass --help through
  // Session commands (@name ...) also handle --help via their own Commander program
  if (args.includes('--help') || args.includes('-h')) {
    // Check if this is a session command — let it fall through to session handling
    const hasSessionArg = args.some((a) => a.startsWith('@') && !a.startsWith('--'));
    if (hasSessionArg) {
      // Fall through — handleSessionCommands will parse --help via Commander
    } else if (args.includes('x402')) {
      const x402Index = args.indexOf('x402');
      const x402Args = args.slice(x402Index + 1);
      await handleX402Command(x402Args);
      await closeFileLogger();
      return;
    } else {
      // Check if the user is asking for help on a session subcommand (e.g. mcpc resources-list --help)
      const helpTarget = args.find(
        (a) => a !== '--help' && a !== '-h' && !a.startsWith('-') && !a.startsWith('@')
      );
      if (helpTarget && KNOWN_SESSION_COMMANDS.includes(helpTarget)) {
        showSessionCommandHelp(helpTarget);
        return;
      }
      const program = createTopLevelProgram();
      await program.parseAsync(process.argv);
      return;
    }
  }

  // Validate all options are known (before any processing)
  // Argument validation errors are always plain text - --json only applies to command output
  try {
    validateOptions(args);
    validateArgValues(args);
  } catch (error) {
    console.error(chalk.red(formatHumanError(error as Error, false)));
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
          console.error(chalk.red(formatHumanError(error, opts.verbose)));
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
          console.error(chalk.red(formatHumanError(error, opts.verbose)));
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
    // Try to suggest the closest matching command
    const suggestion = suggestCommand(firstNonOption, allCommands);
    if (outputMode === 'json') {
      console.error(formatJsonError(new Error(`Unknown command: ${firstNonOption}`), 1));
    } else {
      console.error(`Error: Unknown command: ${firstNonOption}`);
      if (suggestion) {
        if (KNOWN_SESSION_COMMANDS.includes(suggestion)) {
          console.error(`\nDid you mean: mcpc <@session> ${suggestion}`);
        } else {
          console.error(`\nDid you mean: mcpc ${suggestion}`);
        }
      }
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
  // Show Commands before Options in top-level help for better discoverability
  program.configureHelp({
    subcommandTerm: (cmd) =>
      `${cmd.name()} ${cmd.usage()}`.replace(/^\[options\]\s*|\s*\[options\]/g, '').trim(),
    styleTitle: (str) => chalk.bold(str),
    styleSubcommandText: (str) => chalk.cyan(str),
    formatHelp: (cmd, helper) => {
      const output = Help.prototype.formatHelp.call(helper, cmd, helper);
      // Swap Options and Commands sections (separated by blank lines)
      const sections = output.split('\n\n');
      const optIdx = sections.findIndex((s: string) => s.includes('Options:'));
      const cmdIdx = sections.findIndex((s: string) => s.includes('Commands:'));
      if (optIdx >= 0 && cmdIdx >= 0 && optIdx < cmdIdx) {
        const tmp = sections[optIdx] as string;
        sections[optIdx] = sections[cmdIdx] as string;
        sections[cmdIdx] = tmp;
      }
      return (
        sections
          .map((s: string) => s.trimEnd())
          .filter((s: string) => s !== '')
          .join('\n\n') + '\n'
      );
    },
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
    .usage('[<@session>] [<command>] [options]')
    .option('--json', 'Output in JSON format for scripting')
    .option('--verbose', 'Enable debug logging')
    .option('--profile <name>', 'OAuth profile for the server ("default" if not provided)')
    .option('--schema <file>', 'Validate tool/prompt schema against expected schema')
    .option('--schema-mode <mode>', 'Schema validation mode: strict, compatible (default), ignore')
    .option('--timeout <seconds>', 'Request timeout in seconds (default: 300)')
    .option('--max-chars <n>', 'Truncate tool/prompt output to this many characters')
    .option('--insecure', 'Skip TLS certificate verification (for self-signed certs)')
    .version(mcpcVersion, '-v, --version', 'Output the version number')
    .helpOption('-h, --help', 'Display help');

  program.addHelpText(
    'after',
    `
${chalk.bold('MCP session commands (after connecting):')}
  <@session>                   Show MCP server info, capabilities, and tools
  <@session> ${chalk.cyan('grep')} <pattern>    Search tools and instructions
  <@session> ${chalk.cyan('tools-list')}        List all server tools
  <@session> ${chalk.cyan('tools-get')} <name>  Get tool details and schema
  <@session> ${chalk.cyan('tools-call')} <name> [arg:=val ... | <json> | <stdin]
  <@session> ${chalk.cyan('prompts-list')}
  <@session> ${chalk.cyan('prompts-get')} <name> [arg:=val ... | <json> | <stdin]
  <@session> ${chalk.cyan('resources-list')}
  <@session> ${chalk.cyan('resources-read')} <uri>
  <@session> ${chalk.cyan('resources-subscribe')} <uri>
  <@session> ${chalk.cyan('resources-unsubscribe')} <uri>
  <@session> ${chalk.cyan('resources-templates-list')}
  <@session> ${chalk.cyan('tasks-list')}
  <@session> ${chalk.cyan('tasks-get')} <taskId>
  <@session> ${chalk.cyan('tasks-cancel')} <taskId>
  <@session> ${chalk.cyan('logging-set-level')} <level>
  <@session> ${chalk.cyan('ping')}

Run "mcpc" without arguments to show active sessions and OAuth profiles.

Full docs: ${docsUrl}`
  );

  // connect command: mcpc connect <server> [@<name>]
  program
    .command('connect [server] [@session]')
    .usage('<server> [@session]')
    .description(
      'Connect to an MCP server and start a named @session (name auto-generated if omitted)'
    )
    .option('-H, --header <header>', 'HTTP header (can be repeated)')
    .option('--profile <name>', 'OAuth profile to use ("default" if skipped)')
    .option('--no-profile', 'Skip OAuth profile (connect anonymously)')
    .option('--proxy <[host:]port>', 'Start proxy MCP server for session')
    .option('--proxy-bearer-token <token>', 'Require authentication for access to proxy server')
    .option('--x402', 'Enable x402 auto-payment using the configured wallet')
    .addHelpText(
      'after',
      `
${chalk.bold('Server formats:')}
  mcp.apify.com                 Remote HTTP server (https:// added automatically)
  ~/.vscode/mcp.json:puppeteer  Config file entry (file:entry)

${chalk.bold('Session name:')}
  If @session is omitted, a name is auto-generated from the server hostname
  (e.g. mcp.apify.com → @apify) or config entry name. If a session for the
  same server already exists, it is reused (restarted if not live).
${jsonHelp('`InitializeResult`', '`{ protocolVersion, capabilities, serverInfo, instructions?, tools? }`', `${SCHEMA_BASE}#initializeresult`)}`
    )
    .action(async (server, sessionName, opts, command) => {
      if (!server) {
        throw new ClientError(
          'Missing required argument: server\n\nExample: mcpc connect mcp.apify.com @myapp'
        );
      }
      const globalOpts = getOptionsFromCommand(command);
      const parsed = parseServerArg(server);

      // Extract --header from connect-specific opts
      const headers: string[] | undefined = opts.header
        ? Array.isArray(opts.header)
          ? (opts.header as string[])
          : [opts.header as string]
        : undefined;

      if (!parsed) {
        throw new ClientError(
          `Invalid server: "${server}"\n\n` +
            `Expected a URL (e.g. mcp.apify.com) or a config file entry (e.g. ~/.vscode/mcp.json:filesystem)`
        );
      }

      // Auto-generate session name if not provided
      if (!sessionName) {
        sessionName = await sessions.resolveSessionName(parsed, {
          outputMode: globalOpts.outputMode,
          ...(globalOpts.profile && { profile: globalOpts.profile }),
          ...(headers && { headers }),
          ...(globalOpts.noProfile && { noProfile: globalOpts.noProfile }),
        });
      }

      if (parsed.type === 'config') {
        // Config file entry: pass entry name as target with config file path
        await sessions.connectSession(parsed.entry, sessionName, {
          ...globalOpts,
          ...(headers && { headers }),
          config: parsed.file,
          proxy: opts.proxy,
          proxyBearerToken: opts.proxyBearerToken,
          x402: opts.x402,
          ...(globalOpts.insecure && { insecure: true }),
        });
      } else {
        await sessions.connectSession(server, sessionName, {
          ...globalOpts,
          ...(headers && { headers }),
          proxy: opts.proxy,
          proxyBearerToken: opts.proxyBearerToken,
          x402: opts.x402,
          ...(globalOpts.insecure && { insecure: true }),
        });
      }
    });

  // close command: mcpc close @<session>
  program
    .command('close [@session]')
    .usage('<@session>')
    .description('Close a session')
    .addHelpText('after', jsonHelp('`{ sessionName, closed: true }`'))
    .action(async (sessionName, _opts, command) => {
      if (!sessionName) {
        throw new ClientError('Missing required argument: @session\n\nExample: mcpc close @myapp');
      }
      await sessions.closeSession(sessionName, getOptionsFromCommand(command));
    });

  // restart command: mcpc restart @<session>
  program
    .command('restart [@session]')
    .usage('<@session>')
    .description('Restart a session (losing all state)')
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
    .command('shell [@session]')
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
    .description('Interactively login to a server using OAuth and save profile')
    .option('--profile <name>', 'Profile name (default: "default")')
    .option(
      '--scope <scopes>',
      'OAuth scopes to request, quoted and space-separated (e.g. --scope "read write")'
    )
    .option('--client-id <id>', 'OAuth client ID (for servers without dynamic client registration)')
    .option(
      '--client-secret <secret>',
      'OAuth client secret (for servers without dynamic client registration)'
    )
    .addHelpText('after', jsonHelp('`{ profile, serverUrl, scopes }`'))
    .action(async (server, opts, command) => {
      if (!server) {
        throw new ClientError(
          'Missing required argument: server\n\nExample: mcpc login mcp.apify.com'
        );
      }
      await auth.login(server, {
        profile: opts.profile,
        scope: opts.scope,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        ...getOptionsFromCommand(command),
      });
    });

  // logout command: mcpc logout <server>
  program
    .command('logout [server]')
    .usage('<server>')
    .description('Delete an OAuth profile for a server')
    .option('--profile <name>', 'Profile name (default: "default")')
    .addHelpText('after', jsonHelp('`{ profile, serverUrl, deleted: true, affectedSessions }`'))
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
${chalk.bold('Resources:')}
  sessions    Remove stale/crashed session records
  profiles    Remove authentication profiles
  logs        Remove bridge log files
  all         Remove all of the above

Without arguments, performs safe cleanup of stale data only.
${jsonHelp('`{ crashedBridges, expiredSessions, orphanedBridgeLogs, sessions, profiles, logs }`')}`
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

  // grep command: mcpc grep <pattern>
  program
    .command('grep [pattern]')
    .usage('<pattern> [options]')
    .description('Search tools and instructions across all active sessions')
    .option('--tools', 'Search tools')
    .option('--resources', 'Search resources')
    .option('--prompts', 'Search prompts')
    .option('--instructions', 'Search server instructions')
    .option('-E, --regex', 'Treat pattern as a regular expression')
    .option('-s, --case-sensitive', 'Case-sensitive matching')
    .option('-m, --max-results <n>', 'Limit the number of results')
    .addHelpText(
      'after',
      `
${chalk.bold('Type filters:')}
  By default, tools and instructions are searched. Use --resources or --prompts
  to search those instead. Combine flags to search multiple types (e.g. --tools --resources).

${chalk.bold('Examples:')}
  mcpc grep "search"                        Search tools and instructions in all sessions
  mcpc grep "search" --resources            Search resources only
  mcpc grep "search" --tools --prompts      Search tools and prompts
  mcpc grep "search|find" -E                Regex search across tools and instructions
  mcpc @apify grep "actor"                  Search within a single session
  mcpc grep "file" --json                   JSON output for scripting
  mcpc grep "actor" -m 5                    Show at most 5 results
${jsonHelp('`[{ sessionName, tools?: Tool[], resources?: Resource[], prompts?: Prompt[], instructions?: string[] }]`')}`
    )
    .action(async (pattern, opts, command) => {
      if (!pattern) {
        throw new ClientError(
          'Missing required argument: pattern\n\nUsage: mcpc grep <pattern>\n\nExample: mcpc grep "search"'
        );
      }
      const globalOpts = getOptionsFromCommand(command);
      const maxResults = opts.maxResults ? parseInt(opts.maxResults as string, 10) : undefined;
      const exitCode = await grepCmd.grepAllSessions(pattern, {
        tools: opts.tools as boolean | undefined,
        resources: opts.resources as boolean | undefined,
        prompts: opts.prompts as boolean | undefined,
        instructions: opts.instructions as boolean | undefined,
        regex: opts.regex as boolean | undefined,
        caseSensitive: opts.caseSensitive as boolean | undefined,
        maxResults,
        ...globalOpts,
      });
      process.exit(exitCode);
    });

  // x402 command: mcpc x402 <subcommand>
  // Note: x402 is handled before Commander in main() — this registration exists only for help text
  program
    .command('x402 [subcommand] [args...]')
    .description('Configure an x402 payment wallet (EXPERIMENTAL)')
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .action(() => {});

  // help command: mcpc help [command] (supports "help x402 sign" etc.)
  program
    .command('help [command] [subcommand]')
    .description('Show help for a specific command')
    .action(async (cmdName?: string, subcommand?: string) => {
      if (!cmdName) {
        program.outputHelp();
        return;
      }

      // x402 has its own Commander program with full subcommand help
      if (cmdName === 'x402') {
        const helpArgs = subcommand ? [subcommand, '--help'] : ['--help'];
        await handleX402Command(helpArgs);
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
      if (showSessionCommandHelp(cmdName)) return;

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
 * Show help for a session subcommand by name.
 * Returns true if the command was found and help was displayed.
 */
function showSessionCommandHelp(cmdName: string): boolean {
  const dummyProgram = createSessionProgram();
  registerSessionCommands(dummyProgram, '<@session>');
  for (const cmd of dummyProgram.commands) {
    cmd.option('--json', 'Output in JSON format');
    cmd.helpOption('-h, --help', 'Display help');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const helpOpt = (cmd as any)._getHelpOption?.();
    if (helpOpt) helpOpt.hidden = true;
  }
  const sessionCmd = dummyProgram.commands.find(
    (c) => c.name() === cmdName || c.aliases().includes(cmdName)
  );
  if (sessionCmd) {
    sessionCmd.outputHelp();
    return true;
  }
  return false;
}

/**
 * Register all session subcommands on a Commander program
 * Extracted so it can be reused for both execution and help lookup
 */
function registerSessionCommands(program: Command, session: string): void {
  // Help command
  program
    .command('help')
    .description('Show MCP server info, capabilities, and tools.')
    .addHelpText(
      'after',
      jsonHelp(
        '`InitializeResult`',
        '`{ protocolVersion, capabilities, serverInfo, instructions?, tools? }`',
        `${SCHEMA_BASE}#initializeresult`
      )
    )
    .action(async (_options, command) => {
      await sessions.showHelp(session, getOptionsFromCommand(command));
    });

  // Shell command
  program
    .command('shell')
    .description('Launch interactive MCP shell.')
    .action(async () => {
      await sessions.openShell(session);
    });

  // Close command
  program
    .command('close', { hidden: true })
    .description('Close MCP session.')
    .action(async (_options, command) => {
      await sessions.closeSession(session, getOptionsFromCommand(command));
    });

  // Restart command
  program
    .command('restart')
    .description('Restart MCP session (losing all state).')
    .action(async (_options, command) => {
      await sessions.restartSession(session, getOptionsFromCommand(command));
    });

  // Tools commands
  program
    .command('tools')
    .description('List MCP tools (shorthand for tools-list).')
    .option('--full', 'Show full tool details including complete input schema')
    .addHelpText(
      'after',
      jsonHelp(
        'Array of `Tool` objects',
        '`[{ name, description?, inputSchema, annotations? }, ...]`',
        `${SCHEMA_BASE}#tool`
      )
    )
    .action(async (_options, command) => {
      await tools.listTools(session, getOptionsFromCommand(command));
    });

  program
    .command('tools-list')
    .description('List all MCP tools.')
    .option('--full', 'Show full tool details including complete input schema')
    .addHelpText(
      'after',
      jsonHelp(
        'Array of `Tool` objects',
        '`[{ name, description?, inputSchema, annotations? }, ...]`',
        `${SCHEMA_BASE}#tool`
      )
    )
    .action(async (_options, command) => {
      await tools.listTools(session, getOptionsFromCommand(command));
    });

  program
    .command('tools-get <name>')
    .description('Get details and schema for an MCP tool.')
    .addHelpText(
      'after',
      jsonHelp(
        '`Tool` object',
        '`{ name, description?, inputSchema, annotations? }`',
        `${SCHEMA_BASE}#tool`
      )
    )
    .action(async (name, _options, command) => {
      await tools.getTool(session, name, getOptionsFromCommand(command));
    });

  program
    .command('tools-call <name> [args...]')
    .description('Call an MCP tool with arguments.')
    .helpOption(false) // Disable built-in --help so we can intercept it for tool schema
    .option('--task', 'Use async task execution (experimental)')
    .option('--detach', 'Start task and return immediately with task ID (implies --task)')
    .addHelpText(
      'after',
      `
${chalk.bold('Arguments:')}
  key:=value pairs    mcpc ${session} tools-call search query:=hello limit:=10
  Inline JSON         mcpc ${session} tools-call search '{"query":"hello"}'
  Stdin pipe          echo '{"query":"hello"}' | mcpc ${session} tools-call search

  Values are auto-parsed: strings, numbers, booleans, JSON objects/arrays.
  To force a string, wrap in quotes: id:='"123"'
${jsonHelp('`CallToolResult`', '`{ content: [{ type, text?, ... }], isError?, structuredContent? }`', `${SCHEMA_BASE}#calltoolresult`)}`
    )
    .action(async (name, args, options, command) => {
      // Intercept --help: with helpOption(false) Commander won't catch it.
      // "tools-call --help" (no tool name) → name is '--help', show command help.
      // "tools-call search --help" → show tool parameter schema (shortcut for tools-get).
      if (name === '--help' || name === '-h') {
        command.help();
        return;
      }
      if (args.includes('--help') || args.includes('-h')) {
        await tools.getTool(session, name, getOptionsFromCommand(command));
        return;
      }
      await tools.callTool(session, name, {
        args,
        task: options.task,
        detach: options.detach,
        ...getOptionsFromCommand(command),
      });
    });

  // Tasks commands
  program
    .command('tasks-list')
    .description('List all MCP tasks.')
    .addHelpText(
      'after',
      jsonHelp(
        '`{ tasks: Task[] }`',
        '`{ tasks: [{ taskId, status, ttl, createdAt, lastUpdatedAt, statusMessage?, pollInterval? }] }`',
        `${SCHEMA_BASE}#task`
      )
    )
    .action(async (_options, command) => {
      await tasks.listTasks(session, getOptionsFromCommand(command));
    });

  program
    .command('tasks-get <taskId>')
    .description('Get MCP task status.')
    .addHelpText(
      'after',
      jsonHelp(
        '`Task` object',
        '`{ taskId, status, ttl, createdAt, lastUpdatedAt, statusMessage?, pollInterval? }`',
        `${SCHEMA_BASE}#task`
      )
    )
    .action(async (taskId, _options, command) => {
      await tasks.getTask(session, taskId, getOptionsFromCommand(command));
    });

  program
    .command('tasks-cancel <taskId>')
    .description('Cancel an MCP task.')
    .addHelpText(
      'after',
      jsonHelp(
        '`Task` object',
        '`{ taskId, status, ttl, createdAt, lastUpdatedAt, statusMessage?, pollInterval? }`',
        `${SCHEMA_BASE}#task`
      )
    )
    .action(async (taskId, _options, command) => {
      await tasks.cancelTask(session, taskId, getOptionsFromCommand(command));
    });

  // Resources commands
  program
    .command('resources')
    .description('List MCP resources (shorthand for resources-list).')
    .addHelpText(
      'after',
      jsonHelp(
        'Array of `Resource` objects',
        '`[{ uri, name?, description?, mimeType? }, ...]`',
        `${SCHEMA_BASE}#resource`
      )
    )
    .action(async (_options, command) => {
      await resources.listResources(session, getOptionsFromCommand(command));
    });

  program
    .command('resources-list')
    .description('List all MCP resources.')
    .addHelpText(
      'after',
      jsonHelp(
        'Array of `Resource` objects',
        '`[{ uri, name?, description?, mimeType? }, ...]`',
        `${SCHEMA_BASE}#resource`
      )
    )
    .action(async (_options, command) => {
      await resources.listResources(session, getOptionsFromCommand(command));
    });

  program
    .command('resources-read <uri>')
    .description('Read an MCP resource by URI.')
    .option('-o, --output <file>', 'Write resource to file')
    .option('--max-size <bytes>', 'Maximum resource size in bytes')
    .addHelpText(
      'after',
      jsonHelp(
        '`ReadResourceResult`',
        '`{ contents: [{ uri, mimeType?, text? | blob? }] }`',
        `${SCHEMA_BASE}#readresourceresult`
      )
    )
    .action(async (uri, options, command) => {
      await resources.getResource(session, uri, {
        output: options.output,
        maxSize: options.maxSize,
        ...getOptionsFromCommand(command),
      });
    });

  program
    .command('resources-subscribe <uri>')
    .description('Subscribe to MCP resource updates.')
    .addHelpText('after', jsonHelp('`{ subscribed: true, uri: string }`'))
    .action(async (uri, _options, command) => {
      await resources.subscribeResource(session, uri, getOptionsFromCommand(command));
    });

  program
    .command('resources-unsubscribe <uri>')
    .description('Unsubscribe from MCP resource updates.')
    .addHelpText('after', jsonHelp('`{ unsubscribed: true, uri: string }`'))
    .action(async (uri, _options, command) => {
      await resources.unsubscribeResource(session, uri, getOptionsFromCommand(command));
    });

  program
    .command('resources-templates-list')
    .description('List MCP resource templates.')
    .addHelpText(
      'after',
      jsonHelp(
        'Array of `ResourceTemplate` objects',
        '`[{ uriTemplate, name?, description?, mimeType? }, ...]`',
        `${SCHEMA_BASE}#resourcetemplate`
      )
    )
    .action(async (_options, command) => {
      await resources.listResourceTemplates(session, getOptionsFromCommand(command));
    });

  // Prompts commands
  program
    .command('prompts')
    .description('List MCP prompts (shorthand for prompts-list).')
    .addHelpText(
      'after',
      jsonHelp(
        'Array of `Prompt` objects',
        '`[{ name, description?, arguments?: [{ name, required? }] }, ...]`',
        `${SCHEMA_BASE}#prompt`
      )
    )
    .action(async (_options, command) => {
      await prompts.listPrompts(session, getOptionsFromCommand(command));
    });

  program
    .command('prompts-list')
    .description('List all MCP prompts.')
    .addHelpText(
      'after',
      jsonHelp(
        'Array of `Prompt` objects',
        '`[{ name, description?, arguments?: [{ name, required? }] }, ...]`',
        `${SCHEMA_BASE}#prompt`
      )
    )
    .action(async (_options, command) => {
      await prompts.listPrompts(session, getOptionsFromCommand(command));
    });

  program
    .command('prompts-get <name> [args...]')
    .description('Get an MCP prompt with arguments.')
    .addHelpText(
      'after',
      jsonHelp(
        '`GetPromptResult`',
        '`{ description?, messages: [{ role, content: { type, text?, ... } }] }`',
        `${SCHEMA_BASE}#getpromptresult`
      )
    )
    .action(async (name, args, _options, command) => {
      await prompts.getPrompt(session, name, {
        args,
        ...getOptionsFromCommand(command),
      });
    });

  // Logging commands
  program
    .command('logging-set-level <level>')
    .description('Set MCP server logging level.')
    .addHelpText('after', jsonHelp('`{ level: string }`'))
    .action(async (level, _options, command) => {
      await logging.setLogLevel(session, level, getOptionsFromCommand(command));
    });

  // Server commands
  program
    .command('ping')
    .description('Ping the MCP server.')
    .addHelpText('after', jsonHelp('`{ success: true, durationMs: number }`'))
    .action(async (_options, command) => {
      await utilities.ping(session, getOptionsFromCommand(command));
    });

  // Grep command: @session grep <pattern>
  program
    .command('grep <pattern>')
    .usage('<pattern> [options]')
    .description('Search MCP session objects.')
    .option('--tools', 'Search tools')
    .option('--resources', 'Search resources')
    .option('--prompts', 'Search prompts')
    .option('--instructions', 'Search server instructions')
    .option('-E, --regex', 'Treat pattern as a regular expression')
    .option('-s, --case-sensitive', 'Case-sensitive matching')
    .option('-m, --max-results <n>', 'Limit the number of results')
    .addHelpText(
      'after',
      `
${chalk.bold('Type filters:')}
  By default, tools and instructions are searched. Use --resources or --prompts
  to search those instead. Combine flags to search multiple types.

${chalk.bold('Examples:')}
  mcpc ${session} grep "search"                  Search tools and instructions
  mcpc ${session} grep "search" --resources      Search resources only
  mcpc ${session} grep "search|find" -E          Regex search
${jsonHelp('`{ tools?: Tool[], resources?: Resource[], prompts?: Prompt[], instructions?: string[] }`')}`
    )
    .action(async (pattern, opts, command) => {
      const globalOpts = getOptionsFromCommand(command);
      const maxResults = opts.maxResults ? parseInt(opts.maxResults as string, 10) : undefined;
      const exitCode = await grepCmd.grepSession(session, pattern, {
        tools: opts.tools as boolean | undefined,
        resources: opts.resources as boolean | undefined,
        prompts: opts.prompts as boolean | undefined,
        instructions: opts.instructions as boolean | undefined,
        regex: opts.regex as boolean | undefined,
        caseSensitive: opts.caseSensitive as boolean | undefined,
        maxResults,
        ...globalOpts,
      });
      process.exit(exitCode);
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

  // Match the top-level help styling: bold titles, cyan subcommand text
  program.configureHelp({
    styleTitle: (str) => chalk.bold(str),
    styleSubcommandText: (str) => chalk.cyan(str),
  });

  program
    .name('mcpc <@session>')
    .description('Execute MCP commands on a connected session.')
    .helpOption('-h, --help', 'Display help')
    .option('--json', 'Output in JSON format for scripting and code mode')
    .option('--verbose', 'Enable debug logging')
    .option('--profile <name>', 'OAuth profile override')
    .option('--schema <file>', 'Validate tool/prompt schema against expected schema')
    .option('--schema-mode <mode>', 'Schema validation mode: strict, compatible (default), ignore')
    .option('--timeout <seconds>', 'Request timeout in seconds (default: 300)')
    .option('--max-chars <n>', 'Truncate tool/prompt output to this many characters')
    .option('--insecure', 'Skip TLS certificate verification (for self-signed certs)');

  return program;
}

/**
 * Handle commands for a session target (@name)
 */
async function handleSessionCommands(session: string, args: string[]): Promise<void> {
  // Check if no subcommand provided - show server info (unless --help is requested)
  const argsSlice = args.slice(2);
  if (!hasSubcommand(args) && !argsSlice.includes('--help') && !argsSlice.includes('-h')) {
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

  // Tune sub-command help display:
  // - Show --json so users/agents know it's available
  // - Hide the redundant -h/--help (you already need it to see this screen)
  for (const cmd of program.commands) {
    cmd.option('--json', 'Output in JSON format');
    cmd.helpOption('-h, --help', 'Display help');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const helpOpt = (cmd as any)._getHelpOption?.();
    if (helpOpt) helpOpt.hidden = true;
  }

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
        console.error(chalk.red(formatHumanError(error, opts.verbose)));
      }
      process.exit(error.code);
    }

    // Unknown error
    console.error(
      outputMode === 'json'
        ? formatJsonError(error as Error, 1)
        : chalk.red(formatHumanError(error as Error, opts.verbose))
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
