/**
 * Unit tests for the log-reader module.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  listLogFiles,
  parseDuration,
  parseLogLine,
  readRecentLogLines,
  resolveSince,
} from '../../../src/lib/log-reader';

describe('parseLogLine', () => {
  it('parses a well-formed line with context', () => {
    const rec = parseLogLine(
      '[2026-04-28T12:01:14.231Z] [INFO] [bridge-manager] Started bridge for @apify'
    );
    expect(rec.ts).toBe('2026-04-28T12:01:14.231Z');
    expect(rec.level).toBe('info');
    expect(rec.context).toBe('bridge-manager');
    expect(rec.message).toBe('Started bridge for @apify');
    expect(rec.raw).toBeUndefined();
  });

  it('parses a line without context', () => {
    const rec = parseLogLine('[2026-04-28T12:01:14.231Z] [WARN] something happened');
    expect(rec.level).toBe('warn');
    expect(rec.context).toBeNull();
    expect(rec.message).toBe('something happened');
  });

  it('falls back to raw for non-matching lines', () => {
    const rec = parseLogLine('========================================');
    expect(rec.ts).toBeNull();
    expect(rec.level).toBeNull();
    expect(rec.context).toBeNull();
    expect(rec.raw).toBe('========================================');
  });
});

describe('parseDuration', () => {
  it('parses common shortforms', () => {
    expect(parseDuration('30s')).toBe(30 * 1000);
    expect(parseDuration('5m')).toBe(5 * 60 * 1000);
    expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
    expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration('1w')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('parses long unit names', () => {
    expect(parseDuration('30sec')).toBe(30 * 1000);
    expect(parseDuration('5mins')).toBe(5 * 60 * 1000);
    expect(parseDuration('2hrs')).toBe(2 * 60 * 60 * 1000);
  });

  it('returns null for garbage', () => {
    expect(parseDuration('1y')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
});

describe('resolveSince', () => {
  it('treats durations as relative to now', () => {
    const now = Date.now();
    const d = resolveSince('1h');
    expect(d).not.toBeNull();
    const diff = now - d!.getTime();
    // Allow up to 1 second of slack between captures.
    expect(diff).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
    expect(diff).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });

  it('parses ISO 8601 timestamps', () => {
    const d = resolveSince('2026-04-28T12:00:00Z');
    expect(d?.toISOString()).toBe('2026-04-28T12:00:00.000Z');
  });

  it('returns null for invalid input', () => {
    expect(resolveSince('not a date')).toBeNull();
  });
});

describe('listLogFiles + readRecentLogLines', () => {
  let homeDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'mcpc-logs-test-'));
    originalHome = process.env.MCPC_HOME_DIR;
    process.env.MCPC_HOME_DIR = homeDir;
    await mkdir(join(homeDir, 'logs'), { recursive: true });
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.MCPC_HOME_DIR;
    else process.env.MCPC_HOME_DIR = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  });

  it('returns [] when no log files exist', async () => {
    const files = await listLogFiles('@nope');
    expect(files).toEqual([]);
    const lines = await readRecentLogLines('@nope');
    expect(lines).toEqual([]);
  });

  it('orders rotated files oldest-first, then current last', async () => {
    const dir = join(homeDir, 'logs');
    await writeFile(join(dir, 'bridge-@x.log'), 'current\n');
    await writeFile(join(dir, 'bridge-@x.log.1'), 'one\n');
    await writeFile(join(dir, 'bridge-@x.log.2'), 'two\n');
    await writeFile(join(dir, 'bridge-@x.log.5'), 'five\n');
    const files = await listLogFiles('@x');
    expect(files.map((f) => f.split('/').pop())).toEqual([
      'bridge-@x.log.5',
      'bridge-@x.log.2',
      'bridge-@x.log.1',
      'bridge-@x.log',
    ]);
  });

  it('tail returns the last N lines, spanning rotations when needed', async () => {
    const dir = join(homeDir, 'logs');
    // Older rotated file has lines 1-5, current has 6-8 → tail 6 should be lines 3-8.
    await writeFile(join(dir, 'bridge-@x.log.1'), 'line1\nline2\nline3\nline4\nline5\n');
    await writeFile(join(dir, 'bridge-@x.log'), 'line6\nline7\nline8\n');
    const lines = await readRecentLogLines('@x', { tail: 6 });
    expect(lines).toEqual(['line3', 'line4', 'line5', 'line6', 'line7', 'line8']);
  });

  it('tail does not read older files when current alone has enough lines', async () => {
    const dir = join(homeDir, 'logs');
    await writeFile(join(dir, 'bridge-@x.log.1'), 'old1\nold2\n');
    await writeFile(join(dir, 'bridge-@x.log'), 'a\nb\nc\nd\ne\n');
    const lines = await readRecentLogLines('@x', { tail: 3 });
    expect(lines).toEqual(['c', 'd', 'e']);
  });

  it('--since filters by timestamp and keeps unparseable lines', async () => {
    const dir = join(homeDir, 'logs');
    const old = '[2026-04-28T10:00:00.000Z] [INFO] old line';
    const banner = '========================================';
    const newer = '[2026-04-28T13:00:00.000Z] [INFO] new line';
    await writeFile(join(dir, 'bridge-@x.log'), `${old}\n${banner}\n${newer}\n`);
    const lines = await readRecentLogLines('@x', {
      since: new Date('2026-04-28T12:00:00.000Z'),
    });
    // Old line is filtered out; banner kept (no parseable ts); newer kept.
    expect(lines).toEqual([banner, newer]);
  });
});
