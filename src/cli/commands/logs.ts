/**
 * `mcpc @<session> logs` — show or follow bridge log files.
 */

import { stat } from 'fs/promises';
import chalk from 'chalk';
import { ClientError } from '../../lib/errors.js';
import { getSession } from '../../lib/sessions.js';
import {
  followLog,
  getBridgeLogPath,
  listLogFiles,
  parseLogLine,
  readRecentLogLines,
  resolveSince,
  type LogRecord,
} from '../../lib/log-reader.js';
import { formatJson } from '../output.js';
import type { CommandOptions } from '../../lib/types.js';

const DEFAULT_TAIL = 50;

export interface LogsCommandOptions extends CommandOptions {
  tail?: number;
  follow?: boolean;
  since?: string;
}

/**
 * Implementation of `mcpc @<session> logs`.
 *
 * `target` is the session name including the leading "@" (e.g. "@apify").
 */
export async function showLogs(target: string, options: LogsCommandOptions): Promise<void> {
  if (!target.startsWith('@')) {
    throw new ClientError(
      `logs requires a session target (e.g. mcpc @<session> logs). Got: ${target}`
    );
  }

  const session = await getSession(target);
  if (!session) {
    throw new ClientError(
      `Session not found: ${target}\n\n` +
        `List sessions with: mcpc\nCreate one with: mcpc connect <server> ${target}`
    );
  }

  const logPath = getBridgeLogPath(target);
  const files = await listLogFiles(target);

  let since: Date | undefined;
  if (options.since) {
    const resolved = resolveSince(options.since);
    if (!resolved) {
      throw new ClientError(
        `Invalid --since value: "${options.since}". ` +
          `Use a duration (e.g. 30s, 5m, 2h, 1d, 1w) or an ISO 8601 timestamp.`
      );
    }
    since = resolved;
  }

  // Default tail: 50 in non-follow mode, also used as the backlog size when --follow is set.
  const tail = options.tail ?? DEFAULT_TAIL;

  const emitOpts: EmitOpts = {
    tail,
    ...(since && { since }),
    ...(options.follow && { follow: true }),
  };

  if (options.outputMode === 'json') {
    await emitJson(target, logPath, files, emitOpts);
    return;
  }

  await emitHuman(target, logPath, files, emitOpts);
}

interface EmitOpts {
  tail: number;
  since?: Date;
  follow?: boolean;
}

async function emitHuman(
  sessionName: string,
  logPath: string,
  files: string[],
  opts: EmitOpts
): Promise<void> {
  const header = await buildHeader(sessionName, logPath, files, opts);
  for (const line of header) {
    console.error(line);
  }

  const backlog = await readRecentLogLines(sessionName, {
    tail: opts.tail,
    ...(opts.since && { since: opts.since }),
  });
  for (const line of backlog) {
    console.log(line);
  }

  if (!opts.follow) {
    return;
  }

  await new Promise<void>((resolve) => {
    const sub = followLog(sessionName, (line) => {
      console.log(line);
    });
    const onSignal = (): void => {
      void sub.stop().finally(resolve);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });
}

async function emitJson(
  sessionName: string,
  logPath: string,
  files: string[],
  opts: EmitOpts
): Promise<void> {
  const backlog = await readRecentLogLines(sessionName, {
    tail: opts.tail,
    ...(opts.since && { since: opts.since }),
  });
  const records = backlog.map(parseLogLine);

  if (!opts.follow) {
    console.log(formatJson(records));
    return;
  }

  // Streaming mode: emit NDJSON (one record per line). A JSON array can't be streamed.
  for (const rec of records) {
    process.stdout.write(JSON.stringify(rec) + '\n');
  }

  await new Promise<void>((resolve) => {
    const sub = followLog(sessionName, (line) => {
      const rec: LogRecord = parseLogLine(line);
      process.stdout.write(JSON.stringify(rec) + '\n');
    });
    const onSignal = (): void => {
      void sub.stop().finally(resolve);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });

  // Suppress unused-parameter warnings for parameters kept for symmetry with emitHuman.
  void logPath;
  void files;
}

async function buildHeader(
  sessionName: string,
  logPath: string,
  files: string[],
  opts: EmitOpts
): Promise<string[]> {
  const lines: string[] = [];
  let size = 0;
  let exists = false;
  try {
    const st = await stat(logPath);
    size = st.size;
    exists = true;
  } catch {
    // file doesn't exist yet
  }

  const fileCount = files.length;
  const sizeStr = formatBytes(size);
  const tailLabel = opts.follow
    ? `following (backlog ${opts.tail} lines)`
    : opts.since
      ? `since ${opts.since.toISOString()}, last ${opts.tail} lines`
      : `last ${opts.tail} lines`;

  lines.push(chalk.dim(`Session ${sessionName}  ·  ${logPath}  ·  ${tailLabel}`));
  if (fileCount > 1) {
    lines.push(chalk.dim(`  ${fileCount} files (current + ${fileCount - 1} rotated), ${sizeStr}`));
  } else if (exists) {
    lines.push(chalk.dim(`  ${sizeStr}`));
  } else {
    lines.push(chalk.dim(`  no logs yet for ${sessionName}`));
  }
  lines.push('');
  return lines;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
