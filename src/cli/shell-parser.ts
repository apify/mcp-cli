/**
 * Shell command parsing utilities
 * Separated from shell.ts to allow unit testing without ESM dependencies
 */

/**
 * Parse a shell command line into command and arguments
 */
export function parseShellCommand(line: string): { command: string; args: string[] } {
  const trimmed = line.trim();
  if (!trimmed) {
    return { command: '', args: [] };
  }

  // Simple parsing: split on spaces, handle quotes
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuote) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  return {
    command: parts[0] || '',
    args: parts.slice(1),
  };
}
