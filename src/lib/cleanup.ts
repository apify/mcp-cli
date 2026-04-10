/**
 * Shared cleanup utilities
 */

import { readdir, unlink, stat } from 'fs/promises';
import { join } from 'path';
import { getLogsDir, getBridgesDir, getSocketPath, fileExists } from './utils.js';
import { createLogger } from './logger.js';

const logger = createLogger('cleanup');

/**
 * Clean up orphaned log files (logs for sessions that no longer exist)
 * Only deletes files older than the specified age to avoid removing recent debug logs
 *
 * @param activeSessions - Map of active session names (used to check if session exists)
 * @param options - Cleanup options
 * @param options.maxAgeDays - Only delete files older than this many days (default: 7)
 * @param options.skipSession - Session name to skip (e.g., current session in bridge)
 * @returns Number of files deleted
 */
export async function cleanupOrphanedLogFiles(
  activeSessions: Record<string, unknown>,
  options: { maxAgeDays?: number; skipSession?: string } = {}
): Promise<number> {
  const { maxAgeDays = 7, skipSession } = options;

  let deletedCount = 0;
  const logsDir = getLogsDir();

  if (!(await fileExists(logsDir))) {
    return 0;
  }

  const files = await readdir(logsDir);

  // Match bridge log files: bridge-@session.log, bridge-@session.log.1, etc.
  const bridgeLogPattern = /^bridge-(@.+?)\.log(?:\.\d+)?$/;

  // Calculate cutoff date
  const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  logger.debug(`Cleaning orphaned logs older than ${maxAgeDays} days`);

  for (const file of files) {
    const match = file.match(bridgeLogPattern);
    if (!match || !match[1]) continue;

    const sessionName = match[1];

    // Skip the specified session (e.g., current session in bridge)
    if (skipSession && sessionName === skipSession) {
      logger.debug(`Skipping current session's log file: ${file}`);
      continue;
    }

    // Only clean logs for sessions that no longer exist
    if (!activeSessions[sessionName]) {
      const filePath = join(logsDir, file);

      try {
        const fileStats = await stat(filePath);
        const fileAge = fileStats.mtime.getTime();
        const ageInDays = Math.floor((Date.now() - fileAge) / (24 * 60 * 60 * 1000));

        // Only delete if older than cutoff
        if (fileAge < cutoffTime) {
          await unlink(filePath);
          deletedCount++;
          logger.debug(`Removed orphaned log file: ${file} (age: ${ageInDays} days)`);
        } else {
          logger.debug(`Keeping recent orphaned log file: ${file} (age: ${ageInDays} days)`);
        }
      } catch {
        // Ignore stat/unlink errors
        logger.debug(`Failed to process log file: ${file}`);
      }
    }
  }

  return deletedCount;
}

/**
 * Clean up orphaned socket files in the bridges directory.
 * With PID-based socket paths (@session.1234.sock), stale sockets can accumulate
 * when a bridge exits without cleanup (e.g. SIGKILL, crash, or orphaned background restart).
 *
 * A socket is considered orphaned if it doesn't match any active session's current PID.
 * Only sockets older than `minAgeSeconds` are removed to avoid racing with a bridge
 * that was just spawned but hasn't updated sessions.json yet.
 *
 * @param activeSessions - Map of session names to session data (with optional pid)
 * @param options.minAgeSeconds - Only delete sockets older than this (default: 300 = 5 min)
 * @returns Number of socket files deleted
 */
export async function cleanupOrphanedSockets(
  activeSessions: Record<string, { pid?: number } | undefined>,
  options: { minAgeSeconds?: number } = {}
): Promise<number> {
  const { minAgeSeconds = 300 } = options;

  if (process.platform === 'win32') {
    return 0; // Windows named pipes don't leave files
  }

  const bridgesDir = getBridgesDir();
  if (!(await fileExists(bridgesDir))) {
    return 0;
  }

  // Build set of active socket paths for fast lookup
  const activeSocketPaths = new Set<string>();
  for (const [name, session] of Object.entries(activeSessions)) {
    if (session?.pid) {
      activeSocketPaths.add(getSocketPath(name, session.pid));
    }
  }

  const cutoffTime = Date.now() - minAgeSeconds * 1000;
  let deletedCount = 0;

  const files = await readdir(bridgesDir);
  for (const file of files) {
    if (!file.endsWith('.sock')) continue;

    const filePath = join(bridgesDir, file);

    // Skip sockets that belong to a known active session+PID
    if (activeSocketPaths.has(filePath)) continue;

    try {
      const fileStats = await stat(filePath);
      if (fileStats.mtime.getTime() < cutoffTime) {
        await unlink(filePath);
        deletedCount++;
        logger.debug(`Removed orphaned socket: ${file}`);
      }
    } catch {
      // Ignore stat/unlink errors
    }
  }

  return deletedCount;
}
