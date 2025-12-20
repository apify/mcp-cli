/**
 * Command-line argument parsing utilities
 * Pure functions with no external dependencies for easy testing
 */

// Options that take a value (not boolean flags)
const OPTIONS_WITH_VALUES = [
  '-c',
  '--config',
  '-H',
  '--header',
  '--timeout',
  '--protocol-version',
  '--schema',
  '--schema-mode',
];

/**
 * Check if an option takes a value
 */
export function optionTakesValue(arg: string): boolean {
  const optionName = arg.includes('=') ? arg.substring(0, arg.indexOf('=')) : arg;
  return OPTIONS_WITH_VALUES.includes(optionName);
}

/**
 * Find the first non-option argument (the target)
 * Returns { target, targetIndex } or undefined if no target found
 */
export function findTarget(args: string[]): { target: string; targetIndex: number } | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    // Skip options and their values
    if (arg.startsWith('-')) {
      // If option takes a value and value is not inline (no =), skip next arg
      if (optionTakesValue(arg) && !arg.includes('=') && i + 1 < args.length) {
        i++; // Skip the value
      }
      continue;
    }

    // Found first non-option argument
    return { target: arg, targetIndex: i };
  }

  return undefined;
}

/**
 * Extract option values from args
 */
export function extractOptions(args: string[]): {
  config?: string;
  headers?: string[];
  timeout?: number;
  verbose: boolean;
  json: boolean;
} {
  const options = {
    verbose: args.includes('--verbose'),
    json: args.includes('--json') || args.includes('-j'),
  };

  // Extract --config
  const configIndex = args.findIndex((arg) => arg === '--config' || arg === '-c');
  const config = configIndex >= 0 && configIndex + 1 < args.length ? args[configIndex + 1] : undefined;

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
  const timeoutValue = timeoutIndex >= 0 && timeoutIndex + 1 < args.length ? args[timeoutIndex + 1] : undefined;
  const timeout = timeoutValue ? parseInt(timeoutValue, 10) : undefined;

  return {
    ...options,
    ...(config && { config }),
    ...(headers.length > 0 && { headers }),
    ...(timeout !== undefined && { timeout }),
  };
}

/**
 * Check if there's a command after the target in args
 */
export function hasCommandAfterTarget(args: string[]): boolean {
  // Start from index 2 (skip node and script path)
  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    // Skip options and their values
    if (arg.startsWith('-')) {
      if (optionTakesValue(arg) && !arg.includes('=')) {
        i++; // Skip the value
      }
      continue;
    }

    // Found a non-option arg (this is a command)
    return true;
  }
  return false;
}
