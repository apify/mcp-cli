/**
 * Per-session completion cache (~/.mcpc/completion/<session>.json).
 *
 * Populated opportunistically when the user runs `tools-list`, `resources-list`,
 * or `prompts-list` — those code paths already talked to the server, so we
 * mirror the names to disk for the next TAB. Reads on the completion hot path
 * never trigger network calls; if the cache is missing or stale, completion
 * silently falls through to no suggestions.
 *
 * Why on disk rather than from the bridge: shell completion is a separate
 * process from the bridge, so the in-memory `cachedTools` map is unreachable.
 * A short JSON read (≪ 1 ms) keeps TAB snappy.
 */
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { atomicRename, fileExists, getMcpcHome } from './utils.js';

const COMPLETION_CACHE_DIRNAME = 'completion';

/** Kinds of items we cache per session. Matches MCP's three primitive lists. */
export type CompletionKind = 'tools' | 'resources' | 'prompts';

/** On-disk cache file shape. Backwards-compatible: missing fields are treated as []. */
interface CompletionCacheFile {
  tools?: string[];
  resources?: string[];
  prompts?: string[];
  /** ISO timestamp of the last write — informational; not used to invalidate. */
  updatedAt?: string;
}

function getCacheDir(): string {
  return join(getMcpcHome(), COMPLETION_CACHE_DIRNAME);
}

/** Resolve the on-disk path for a session's cache file. */
function getCachePath(sessionName: string): string {
  // Session names are constrained to `@name` shape (alphanumeric + dash, plus
  // the leading `@`) by the same rules that gate sessions.json keys, so they
  // are safe to use as filename stems without further escaping.
  return join(getCacheDir(), `${sessionName}.json`);
}

/**
 * Remove a session's cache file. Best-effort: missing files are ignored.
 * Intended for `mcpc clean sessions` so we don't leave dead cache files
 * behind after a session is removed.
 */
export async function deleteCompletionCache(sessionName: string): Promise<void> {
  try {
    await unlink(getCachePath(sessionName));
  } catch {
    // Missing file or permission issue — nothing to do.
  }
}

/**
 * Read cached names for a kind. Returns [] on any error — completion must
 * never freeze the shell because of a malformed or missing cache file.
 */
export async function readCompletionCache(
  sessionName: string,
  kind: CompletionKind
): Promise<string[]> {
  try {
    const content = await readFile(getCachePath(sessionName), 'utf-8');
    const parsed = JSON.parse(content) as CompletionCacheFile;
    return parsed[kind] ?? [];
  } catch {
    return [];
  }
}

/**
 * Merge new names into the cache for a kind. Other kinds in the file are
 * preserved (read-then-write). Errors are swallowed so a broken cache never
 * fails the user-facing list command.
 *
 * Targets that aren't `@session` names (e.g. raw URLs, `file:entry`) have
 * no stable key to cache under and are silently skipped.
 *
 * Concurrency: the read-then-write window is not atomic, only the final
 * file swap is (via `atomicRename`). Two list commands racing in different
 * shells can stomp on each other's update for the *other* kind; worst case
 * the user runs that list command again. Acceptable for a UX cache the
 * user warms by hand.
 */
export async function writeCompletionCache(
  sessionName: string,
  kind: CompletionKind,
  names: readonly string[]
): Promise<void> {
  if (!sessionName.startsWith('@')) return;
  try {
    const cachePath = getCachePath(sessionName);
    await mkdir(getCacheDir(), { recursive: true });

    let existing: CompletionCacheFile = {};
    if (await fileExists(cachePath)) {
      try {
        existing = JSON.parse(await readFile(cachePath, 'utf-8')) as CompletionCacheFile;
      } catch {
        // Corrupted cache → overwrite from scratch.
      }
    }

    const next: CompletionCacheFile = {
      ...existing,
      [kind]: [...names],
      updatedAt: new Date().toISOString(),
    };

    const tempFile = join(getCacheDir(), `.${sessionName}-${Date.now()}-${process.pid}.tmp`);
    await writeFile(tempFile, JSON.stringify(next, null, 2), 'utf-8');
    try {
      await atomicRename(tempFile, cachePath);
    } catch (renameError) {
      // Clean up the orphaned temp file before propagating.
      try {
        await unlink(tempFile);
      } catch {
        // Temp file already moved or never created.
      }
      throw renameError;
    }
  } catch {
    // Best-effort write; a missing cache just degrades to no suggestions.
  }
}
