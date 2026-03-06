/**
 * Command-line argument parsing utilities
 * Pure functions with no external dependencies for easy testing
 */
import { existsSync } from 'fs';
import { ClientError, resolvePath } from '../lib/index.js';

/**
 * Check if an environment variable is set to a truthy value
 * Truthy values: '1', 'true', 'yes' (case-insensitive)
 */
function isEnvTrue(envVar: string | undefined): boolean {
  if (!envVar) return false;
  const normalized = envVar.toLowerCase().trim();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/**
 * Get verbose flag from environment variable
 */
export function getVerboseFromEnv(): boolean {
  return isEnvTrue(process.env.MCPC_VERBOSE);
}

/**
 * Get JSON mode flag from environment variable
 */
export function getJsonFromEnv(): boolean {
  return isEnvTrue(process.env.MCPC_JSON);
}

// Options that take a value (not boolean flags)
const OPTIONS_WITH_VALUES = [
  '-H',
  '--header',
  '--timeout',
  '--profile',
  '--schema',
  '--schema-mode',
  '--proxy',
  '--proxy-bearer-token',
];

// All known options (both boolean flags and value options)
// Includes both global options and command-specific options
const KNOWN_OPTIONS = [
  ...OPTIONS_WITH_VALUES,
  '-j',
  '--json',
  '-v',
  '--version',
  '-h',
  '--help',
  '--verbose',
  '--full',
  '--x402',
];

// Valid --schema-mode values
const VALID_SCHEMA_MODES = ['strict', 'compatible', 'ignore'];

/**
 * All known top-level commands
 */
export const KNOWN_COMMANDS = [
  'help',
  'login',
  'logout',
  'connect',
  'clean',
  'x402',
];

/**
 * All known session subcommands (used in help and error messages)
 */
export const KNOWN_SESSION_COMMANDS = [
  'help',
  'shell',
  'close',
  'restart',
  'tools',
  'tools-list',
  'tools-get',
  'tools-call',
  'resources',
  'resources-list',
  'resources-read',
  'resources-subscribe',
  'resources-unsubscribe',
  'resources-templates-list',
  'prompts',
  'prompts-list',
  'prompts-get',
  'logging-set-level',
  'ping',
];

/**
 * Check if an option always takes a value
 */
export function optionTakesValue(arg: string): boolean {
  const optionName = arg.includes('=') ? arg.substring(0, arg.indexOf('=')) : arg;
  return OPTIONS_WITH_VALUES.includes(optionName);
}

/**
 * Check if an option is known
 */
function isKnownOption(arg: string): boolean {
  // Extract option name (before = if present)
  const optionName = arg.includes('=') ? arg.substring(0, arg.indexOf('=')) : arg;
  return KNOWN_OPTIONS.includes(optionName);
}

/**
 * Validate that all options in args are known
 * @throws ClientError if unknown option is found
 */
export function validateOptions(args: string[]): void {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    // Only check arguments that start with -
    if (arg.startsWith('-')) {
      if (!isKnownOption(arg)) {
        throw new ClientError(`Unknown option: ${arg}`);
      }
      // Skip the value for options that take values
      if (optionTakesValue(arg) && !arg.includes('=') && i + 1 < args.length) {
        i++;
      }
    }
  }
}

/**
 * Validate argument values (--schema-mode, --timeout, etc.)
 * @throws ClientError if invalid value is found
 */
export function validateArgValues(args: string[]): void {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (!arg) continue;

    // Validate --schema-mode value
    if (arg === '--schema-mode' && nextArg) {
      if (!VALID_SCHEMA_MODES.includes(nextArg)) {
        throw new ClientError(
          `Invalid --schema-mode value: "${nextArg}". Valid modes are: ${VALID_SCHEMA_MODES.join(', ')}`
        );
      }
    }

    // Validate --timeout is a number
    if (arg === '--timeout' && nextArg) {
      const timeout = parseInt(nextArg, 10);
      if (isNaN(timeout) || timeout <= 0) {
        throw new ClientError(
          `Invalid --timeout value: "${nextArg}". Must be a positive number (seconds).`
        );
      }
    }

    // Validate --schema file exists
    if (arg === '--schema' && nextArg) {
      const schemaPath = resolvePath(nextArg);
      if (!existsSync(schemaPath)) {
        throw new ClientError(`Schema file not found: ${nextArg}`);
      }
    }

    // Validate --proxy format (but don't parse yet, just check basic format)
    if (arg === '--proxy' && nextArg) {
      // Basic validation - just check it's not empty
      // Full parsing with better error messages is done in parseProxyArg
      if (!nextArg.trim()) {
        throw new ClientError('--proxy requires a value in format [HOST:]PORT');
      }
    }
  }
}

/**
 * Extract option values from args
 * Environment variables MCPC_VERBOSE and MCPC_JSON are used as defaults
 */
export function extractOptions(args: string[]): {
  headers?: string[];
  timeout?: number;
  profile?: string;
  x402?: boolean;
  verbose: boolean;
  json: boolean;
} {
  const options = {
    verbose: args.includes('--verbose') || getVerboseFromEnv(),
    json: args.includes('--json') || args.includes('-j') || getJsonFromEnv(),
  };

  // Extract --header (can be repeated)
  const headers: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if ((arg === '--header' || arg === '-H') && nextArg) {
      headers.push(nextArg);
    }
  }

  // Extract --timeout
  const timeoutIndex = args.findIndex((arg) => arg === '--timeout');
  const timeoutValue =
    timeoutIndex >= 0 && timeoutIndex + 1 < args.length ? args[timeoutIndex + 1] : undefined;
  const timeout = timeoutValue ? parseInt(timeoutValue, 10) : undefined;

  // Extract --profile
  const profileIndex = args.findIndex((arg) => arg === '--profile');
  const profile =
    profileIndex >= 0 && profileIndex + 1 < args.length ? args[profileIndex + 1] : undefined;

  // Extract --x402 (boolean flag)
  const x402 = args.includes('--x402') || undefined;

  return {
    ...options,
    ...(headers.length > 0 && { headers }),
    ...(timeout !== undefined && { timeout }),
    ...(profile && { profile }),
    ...(x402 && { x402 }),
  };
}

/**
 * Parse a server argument: URL or config file entry (file.json:entry)
 *
 * Config format: <file-path>:<entry-name>
 * - Must contain `:` but NOT `://`
 * - The part before `:` must look like a file path:
 *   starts with `~`, `/`, `.`, or has a `.json`/`.yaml`/`.yml` extension
 *
 * URL format: anything else (normalised to https:// if no scheme)
 */
export function parseServerArg(
  arg: string
): { type: 'url'; url: string } | { type: 'config'; file: string; entry: string } {
  // Check if it could be a config file entry (contains : but not ://)
  const colonIndex = arg.indexOf(':');
  if (colonIndex > 0 && !arg.includes('://')) {
    const beforeColon = arg.substring(0, colonIndex);
    const afterColon = arg.substring(colonIndex + 1);

    // Check if the part before colon looks like a file path
    const looksLikeFilePath =
      beforeColon.startsWith('~') ||
      beforeColon.startsWith('/') ||
      beforeColon.startsWith('.') ||
      /\.(json|yaml|yml)$/.test(beforeColon);

    if (looksLikeFilePath && afterColon.length > 0) {
      return { type: 'config', file: beforeColon, entry: afterColon };
    }
  }

  // Otherwise treat as URL
  return { type: 'url', url: arg };
}

/**
 * Auto-parse a value: try JSON.parse, if fails treat as string
 * This allows natural CLI usage like: count:=10, enabled:=true, name:=hello
 */
function autoParseValue(value: string): unknown {
  // Try to parse as JSON (handles numbers, booleans, null, arrays, objects)
  try {
    return JSON.parse(value);
  } catch {
    // Not valid JSON, treat as string
    return value;
  }
}

/**
 * Parse command arguments (positional args after tool/prompt name)
 * Supports two formats:
 * 1. Inline JSON: '{"key":"value"}' or '[...]'
 * 2. Key:=value pairs: key:=value (auto-parsed as JSON or string)
 *
 * @param args - Array of positional argument strings
 * @returns Parsed arguments as key-value object
 * @throws ClientError if arguments are invalid
 */
export function parseCommandArgs(args: string[] | undefined): Record<string, unknown> {
  if (!args || args.length === 0) {
    return {};
  }

  // Check if first arg is inline JSON object/array
  const firstArg = args[0];
  if (firstArg && (firstArg.startsWith('{') || firstArg.startsWith('['))) {
    // Parse as inline JSON
    if (args.length > 1) {
      throw new ClientError('When using inline JSON, only one argument is allowed');
    }
    try {
      const parsedArgs: unknown = JSON.parse(firstArg);
      if (typeof parsedArgs !== 'object' || parsedArgs === null) {
        throw new ClientError('Inline JSON must be an object or array');
      }
      return parsedArgs as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ClientError) {
        throw error;
      }
      throw new ClientError(`Invalid JSON: ${(error as Error).message}`);
    }
  }

  // Parse key:=value pairs (only := syntax supported)
  const parsedArgs: Record<string, unknown> = {};
  for (const pair of args) {
    if (!pair.includes(':=')) {
      throw new ClientError(
        `Invalid argument format: "${pair}". Use key:=value pairs or inline JSON.\n` +
          `Examples: name:=hello count:=10 enabled:=true '{"key":"value"}'`
      );
    }

    // Split only at the first occurrence of :=
    const colonEqualIndex = pair.indexOf(':=');
    const key = pair.substring(0, colonEqualIndex);
    const rawValue = pair.substring(colonEqualIndex + 2);

    if (!key) {
      throw new ClientError(`Invalid argument: "${pair}" - missing key before :=`);
    }

    // Auto-parse: try JSON, fallback to string
    parsedArgs[key] = autoParseValue(rawValue);
  }

  return parsedArgs;
}

/**
 * Check if stdin has data available (non-TTY, piped input)
 */
export function hasStdinData(): boolean {
  return !process.stdin.isTTY;
}

/**
 * Read and parse JSON from stdin
 * Used when arguments are piped: echo '{"key":"value"}' | mcpc @server tools-call my-tool
 *
 * @returns Promise resolving to parsed arguments
 * @throws ClientError if stdin cannot be read or contains invalid JSON
 */
export async function readStdinArgs(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      if (!data.trim()) {
        resolve({});
        return;
      }

      try {
        const parsed: unknown = JSON.parse(data);
        if (typeof parsed !== 'object' || parsed === null) {
          reject(new ClientError('Stdin must contain a JSON object'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch (error) {
        reject(new ClientError(`Invalid JSON from stdin: ${(error as Error).message}`));
      }
    });

    process.stdin.on('error', (error) => {
      reject(new ClientError(`Failed to read stdin: ${error.message}`));
    });

    // Start reading
    process.stdin.resume();
  });
}

/**
 * Parse --header CLI flags into a headers object
 * Format: "Key: Value" (colon-separated)
 */
export function parseHeaderFlags(headerFlags: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (headerFlags) {
    for (const header of headerFlags) {
      const colonIndex = header.indexOf(':');
      if (colonIndex < 1) {
        throw new ClientError(`Invalid header format: ${header}. Use "Key: Value"`);
      }
      const key = header.substring(0, colonIndex).trim();
      const value = header.substring(colonIndex + 1).trim();
      headers[key] = value;
    }
  }
  return headers;
}

/**
 * Parse --proxy argument in format [HOST:]PORT
 * Returns { host, port } with default host 127.0.0.1
 *
 * Examples:
 *   "8080" -> { host: "127.0.0.1", port: 8080 }
 *   "0.0.0.0:8080" -> { host: "0.0.0.0", port: 8080 }
 *   "localhost:3000" -> { host: "localhost", port: 3000 }
 */
export function parseProxyArg(value: string): { host: string; port: number } {
  const DEFAULT_HOST = '127.0.0.1';

  // Check if value contains a colon (host:port format)
  const lastColonIndex = value.lastIndexOf(':');

  if (lastColonIndex === -1) {
    // No colon - just port
    const port = parseInt(value, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      throw new ClientError(
        `Invalid --proxy port: "${value}". Must be a number between 1 and 65535.`
      );
    }
    return { host: DEFAULT_HOST, port };
  }

  // Has colon - host:port format
  const host = value.substring(0, lastColonIndex);
  const portStr = value.substring(lastColonIndex + 1);
  const port = parseInt(portStr, 10);

  if (!host) {
    throw new ClientError(`Invalid --proxy format: "${value}". Host cannot be empty.`);
  }

  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new ClientError(
      `Invalid --proxy port: "${portStr}". Must be a number between 1 and 65535.`
    );
  }

  return { host, port };
}
