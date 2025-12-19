/**
 * Session management
 * Provides functions to read and manage sessions stored in ~/.mcpc/sessions.json
 */

import { readFileSync } from 'fs';
import type { SessionData, SessionsStorage } from './types.js';
import { getSessionsFilePath, exists } from './utils.js';
import { createLogger } from './logger.js';

const logger = createLogger('sessions');

/**
 * Load sessions from storage file
 * Returns an empty sessions structure if file doesn't exist
 */
export async function loadSessions(): Promise<SessionsStorage> {
  const filePath = getSessionsFilePath();

  if (!(await exists(filePath))) {
    logger.debug('Sessions file does not exist, returning empty sessions');
    return { sessions: {} };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const storage = JSON.parse(content) as SessionsStorage;

    if (!storage.sessions || typeof storage.sessions !== 'object') {
      logger.warn('Invalid sessions file format, returning empty sessions');
      return { sessions: {} };
    }

    return storage;
  } catch (error) {
    logger.warn(`Failed to load sessions: ${(error as Error).message}`);
    return { sessions: {} };
  }
}

/**
 * Get all sessions as a flat list
 */
export async function listSessions(): Promise<SessionData[]> {
  const storage = await loadSessions();
  const sessions: SessionData[] = [];

  for (const sessionName in storage.sessions) {
    const session = storage.sessions[sessionName];
    if (session) {
      sessions.push(session);
    }
  }

  return sessions;
}

/**
 * Get a specific session by name
 */
export async function getSession(sessionName: string): Promise<SessionData | undefined> {
  const storage = await loadSessions();
  return storage.sessions[sessionName];
}
