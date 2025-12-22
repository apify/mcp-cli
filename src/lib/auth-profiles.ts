/**
 * Authentication profiles management
 * Provides functions to read and manage auth profiles stored in ~/.mcpc/auth-profiles.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { AuthProfile, AuthProfilesStorage } from './types.js';
import { getAuthProfilesFilePath, fileExists } from './utils.js';
import { createLogger } from './logger.js';

const logger = createLogger('auth-profiles');

/**
 * Load auth profiles from storage file
 * Returns an empty profiles structure if file doesn't exist
 */
export async function loadAuthProfiles(): Promise<AuthProfilesStorage> {
  const filePath = getAuthProfilesFilePath();

  if (!(await fileExists(filePath))) {
    logger.debug('Auth profiles file does not exist, returning empty profiles');
    return { profiles: {} };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const storage = JSON.parse(content) as AuthProfilesStorage;

    if (!storage.profiles || typeof storage.profiles !== 'object') {
      logger.warn('Invalid auth profiles file format, returning empty profiles');
      return { profiles: {} };
    }

    return storage;
  } catch (error) {
    logger.warn(`Failed to load auth profiles: ${(error as Error).message}`);
    return { profiles: {} };
  }
}

/**
 * Get all auth profiles as a flat list
 */
export async function listAuthProfiles(): Promise<AuthProfile[]> {
  const storage = await loadAuthProfiles();
  const profiles: AuthProfile[] = [];

  for (const serverUrl in storage.profiles) {
    const serverProfiles = storage.profiles[serverUrl];
    if (serverProfiles) {
      for (const profileName in serverProfiles) {
        const profile = serverProfiles[profileName];
        if (profile) {
          profiles.push(profile);
        }
      }
    }
  }

  return profiles;
}

/**
 * Get auth profiles for a specific server URL
 */
export async function getAuthProfilesForServer(serverUrl: string): Promise<AuthProfile[]> {
  const storage = await loadAuthProfiles();
  const serverProfiles = storage.profiles[serverUrl];

  if (!serverProfiles) {
    return [];
  }

  return Object.values(serverProfiles).filter((p): p is AuthProfile => p !== undefined);
}

/**
 * Get a specific auth profile by server URL and profile name
 */
export async function getAuthProfile(
  serverUrl: string,
  profileName: string
): Promise<AuthProfile | undefined> {
  const storage = await loadAuthProfiles();
  return storage.profiles[serverUrl]?.[profileName];
}

/**
 * Save auth profiles to storage file
 */
export async function saveAuthProfiles(storage: AuthProfilesStorage): Promise<void> {
  const filePath = getAuthProfilesFilePath();

  // Ensure directory exists
  const dir = dirname(filePath);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    // Ignore if directory already exists
  }

  // Write to file with restricted permissions
  try {
    const content = JSON.stringify(storage, null, 2);
    writeFileSync(filePath, content, { encoding: 'utf-8', mode: 0o600 });
    logger.debug('Auth profiles saved successfully');
  } catch (error) {
    logger.error(`Failed to save auth profiles: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Save or update a single auth profile
 */
export async function saveAuthProfile(profile: AuthProfile): Promise<void> {
  const storage = await loadAuthProfiles();

  // Ensure server entry exists
  if (!storage.profiles[profile.serverUrl]) {
    storage.profiles[profile.serverUrl] = {};
  }

  // Update profile
  storage.profiles[profile.serverUrl]![profile.name] = profile;

  await saveAuthProfiles(storage);
  logger.info(`Saved auth profile: ${profile.name} for ${profile.serverUrl}`);
}

/**
 * Delete a specific auth profile
 */
export async function deleteAuthProfile(serverUrl: string, profileName: string): Promise<boolean> {
  const storage = await loadAuthProfiles();

  const serverProfiles = storage.profiles[serverUrl];
  if (!serverProfiles || !serverProfiles[profileName]) {
    return false;
  }

  delete serverProfiles[profileName];

  // Clean up empty server entries
  if (Object.keys(serverProfiles).length === 0) {
    delete storage.profiles[serverUrl];
  }

  await saveAuthProfiles(storage);
  logger.info(`Deleted auth profile: ${profileName} for ${serverUrl}`);
  return true;
}
