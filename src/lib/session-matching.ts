/**
 * Pure session-matching helpers, extracted from CLI command handlers so they
 * can be unit-tested without pulling in chalk or other CLI-only deps.
 */

import type { SessionsStorage } from './types.js';
import { isValidSessionName, normalizeServerUrl } from './utils.js';

/**
 * Parsed-target shape consumed by matchSessionByTarget. Mirrors the union
 * accepted by parseServerArg + the inline-command branch from the CLI.
 */
export type ParsedTarget =
  | { type: 'url'; url: string }
  | { type: 'config'; file: string; entry: string }
  | { type: 'command'; command: string; args: string[]; env?: Record<string, string> };

/**
 * Find an existing session in `storage` that matches the given parsed target and
 * authentication settings. Pure function — no I/O, suitable for unit tests.
 *
 * Matching rules:
 *  - URL targets: normalized URL equality; profile and header-key set equality
 *  - Config targets: not matched here (caller falls back to name-based dedup)
 *  - Command targets: exact equality on command + args + env (after substitution)
 *
 * @returns The matching session name (e.g. "@apify"), or undefined if no match
 */
export function matchSessionByTarget(
  storage: SessionsStorage,
  parsed: ParsedTarget,
  options: { profile?: string; headers?: string[]; noProfile?: boolean }
): string | undefined {
  const sessions = Object.values(storage.sessions);
  if (sessions.length === 0) return undefined;

  const effectiveProfile = options.noProfile ? undefined : (options.profile ?? 'default');

  for (const session of sessions) {
    if (!session.server) continue;

    if (parsed.type === 'url') {
      if (!session.server.url) continue;
      try {
        const existingUrl = normalizeServerUrl(session.server.url);
        const newUrl = normalizeServerUrl(parsed.url);
        if (existingUrl !== newUrl) continue;
      } catch {
        continue;
      }
    } else if (parsed.type === 'command') {
      if (!session.server.command) continue;
      if (session.server.command !== parsed.command) continue;
      const existingArgs = session.server.args || [];
      if (existingArgs.length !== parsed.args.length) continue;
      let argsMatch = true;
      for (let i = 0; i < existingArgs.length; i++) {
        if (existingArgs[i] !== parsed.args[i]) {
          argsMatch = false;
          break;
        }
      }
      if (!argsMatch) continue;
      const existingEnv = session.server.env || {};
      const newEnv = parsed.env || {};
      const existingEnvKeys = Object.keys(existingEnv).sort();
      const newEnvKeys = Object.keys(newEnv).sort();
      if (existingEnvKeys.length !== newEnvKeys.length) continue;
      let envMatch = true;
      for (let i = 0; i < existingEnvKeys.length; i++) {
        const k = existingEnvKeys[i] as string;
        if (k !== newEnvKeys[i] || existingEnv[k] !== newEnv[k]) {
          envMatch = false;
          break;
        }
      }
      if (!envMatch) continue;
    } else {
      // Config entry: caller handles via name-based dedup.
      continue;
    }

    const sessionProfile = session.profileName ?? 'default';
    if (effectiveProfile !== sessionProfile) continue;

    const existingHeaderKeys = Object.keys(session.server.headers || {}).sort();
    const newHeaderKeys = (options.headers || [])
      .map((h) => h.split(':')[0]?.trim() || '')
      .filter(Boolean)
      .sort();
    if (existingHeaderKeys.join(',') !== newHeaderKeys.join(',')) continue;

    return session.name;
  }

  return undefined;
}

/**
 * Pick an available session name based on a candidate.
 *
 * @param storage         Loaded sessions storage to check for collisions.
 * @param candidate       Base session name (e.g. "@npx", "@apify").
 * @param alwaysSuffix    When true, always append "-N" starting at 1 (used for inline
 *                        stdio commands where the binary basename is rarely distinctive).
 *                        When false, try the bare candidate first, then "-2", "-3", ...
 * @returns The first available session name, or undefined if all 99 suffixes are taken.
 */
export function pickAvailableSessionName(
  storage: SessionsStorage,
  candidate: string,
  alwaysSuffix: boolean
): string | undefined {
  if (!alwaysSuffix && !(candidate in storage.sessions)) {
    return candidate;
  }

  const startIndex = alwaysSuffix ? 1 : 2;
  for (let i = startIndex; i <= 99; i++) {
    const suffixed = `${candidate}-${i}`;
    if (isValidSessionName(suffixed) && !(suffixed in storage.sessions)) {
      return suffixed;
    }
  }
  return undefined;
}
