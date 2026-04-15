/**
 * Unit tests for matchSessionByTarget (pure session-reuse logic).
 *
 * Covers the inline-stdio-command branch: exact match on command + args + env.
 * The function is pure (no I/O), so we just feed it controlled SessionsStorage objects.
 */

import {
  matchSessionByTarget,
  pickAvailableSessionName,
} from '../../../src/lib/session-matching.js';
import type { SessionData, SessionsStorage } from '../../../src/lib/types.js';

function makeStorage(sessions: Record<string, SessionData>): SessionsStorage {
  return { sessions };
}

function makeStdioSession(
  name: string,
  command: string,
  args: string[],
  env?: Record<string, string>
): SessionData {
  return {
    name,
    server: {
      command,
      args,
      ...(env && { env }),
    },
    createdAt: new Date().toISOString(),
  };
}

describe('matchSessionByTarget — inline command targets', () => {
  it('returns existing session when command + args match exactly', () => {
    const storage = makeStorage({
      '@npx-1': makeStdioSession('@npx-1', 'npx', ['-y', 'foo']),
    });

    const result = matchSessionByTarget(
      storage,
      { type: 'command', command: 'npx', args: ['-y', 'foo'] },
      {}
    );
    expect(result).toBe('@npx-1');
  });

  it('returns undefined when command differs', () => {
    const storage = makeStorage({
      '@npx-1': makeStdioSession('@npx-1', 'npx', ['-y', 'foo']),
    });

    const result = matchSessionByTarget(
      storage,
      { type: 'command', command: 'node', args: ['-y', 'foo'] },
      {}
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when one arg differs', () => {
    const storage = makeStorage({
      '@npx-1': makeStdioSession('@npx-1', 'npx', ['-y', 'foo']),
    });

    const result = matchSessionByTarget(
      storage,
      { type: 'command', command: 'npx', args: ['-y', 'bar'] },
      {}
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when arg count differs', () => {
    const storage = makeStorage({
      '@npx-1': makeStdioSession('@npx-1', 'npx', ['-y', 'foo']),
    });

    const result = matchSessionByTarget(
      storage,
      { type: 'command', command: 'npx', args: ['-y', 'foo', 'extra'] },
      {}
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when arg order differs', () => {
    const storage = makeStorage({
      '@node-1': makeStdioSession('@node-1', 'node', ['a', 'b']),
    });

    const result = matchSessionByTarget(
      storage,
      { type: 'command', command: 'node', args: ['b', 'a'] },
      {}
    );
    expect(result).toBeUndefined();
  });

  it('matches sessions with identical env vars', () => {
    const storage = makeStorage({
      '@node-1': makeStdioSession('@node-1', 'node', ['dist/foo.js'], { API_KEY: 'secret' }),
    });

    const result = matchSessionByTarget(
      storage,
      {
        type: 'command',
        command: 'node',
        args: ['dist/foo.js'],
        env: { API_KEY: 'secret' },
      },
      {}
    );
    expect(result).toBe('@node-1');
  });

  it('returns undefined when env value differs', () => {
    const storage = makeStorage({
      '@node-1': makeStdioSession('@node-1', 'node', ['dist/foo.js'], { API_KEY: 'secret' }),
    });

    const result = matchSessionByTarget(
      storage,
      {
        type: 'command',
        command: 'node',
        args: ['dist/foo.js'],
        env: { API_KEY: 'different' },
      },
      {}
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when env keys differ', () => {
    const storage = makeStorage({
      '@node-1': makeStdioSession('@node-1', 'node', ['dist/foo.js'], { API_KEY: 'secret' }),
    });

    const result = matchSessionByTarget(
      storage,
      {
        type: 'command',
        command: 'node',
        args: ['dist/foo.js'],
        env: { OTHER_KEY: 'secret' },
      },
      {}
    );
    expect(result).toBeUndefined();
  });

  it('treats absent env as empty env (matches stored session with no env)', () => {
    const storage = makeStorage({
      '@npx-1': makeStdioSession('@npx-1', 'npx', ['-y', 'foo']),
    });

    const result = matchSessionByTarget(
      storage,
      { type: 'command', command: 'npx', args: ['-y', 'foo'] },
      {}
    );
    expect(result).toBe('@npx-1');
  });

  it('does not match when existing session is URL-based', () => {
    const storage = makeStorage({
      '@apify': {
        name: '@apify',
        server: { url: 'https://mcp.apify.com' },
        createdAt: new Date().toISOString(),
      },
    });

    const result = matchSessionByTarget(
      storage,
      { type: 'command', command: 'npx', args: ['-y', 'foo'] },
      {}
    );
    expect(result).toBeUndefined();
  });

  it('does not match URL parsed when only stdio sessions exist', () => {
    const storage = makeStorage({
      '@npx-1': makeStdioSession('@npx-1', 'npx', ['-y', 'foo']),
    });

    const result = matchSessionByTarget(storage, { type: 'url', url: 'https://mcp.apify.com' }, {});
    expect(result).toBeUndefined();
  });

  it('picks the matching session when multiple stdio sessions share the binary', () => {
    const storage = makeStorage({
      '@npx-1': makeStdioSession('@npx-1', 'npx', ['-y', 'foo']),
      '@npx-2': makeStdioSession('@npx-2', 'npx', ['-y', 'bar']),
    });

    const result = matchSessionByTarget(
      storage,
      { type: 'command', command: 'npx', args: ['-y', 'bar'] },
      {}
    );
    expect(result).toBe('@npx-2');
  });

  it('returns undefined when storage is empty', () => {
    const storage = makeStorage({});
    const result = matchSessionByTarget(
      storage,
      { type: 'command', command: 'npx', args: ['-y', 'foo'] },
      {}
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined for config-entry parsed targets (caller falls back to name dedup)', () => {
    const storage = makeStorage({
      '@filesystem': makeStdioSession('@filesystem', 'npx', [
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '/tmp',
      ]),
    });

    const result = matchSessionByTarget(
      storage,
      { type: 'config', file: './mcp.json', entry: 'filesystem' },
      {}
    );
    expect(result).toBeUndefined();
  });
});

describe('matchSessionByTarget — URL targets (regression)', () => {
  it('matches normalized URLs', () => {
    const storage = makeStorage({
      '@apify': {
        name: '@apify',
        server: { url: 'https://mcp.apify.com' },
        createdAt: new Date().toISOString(),
      },
    });

    expect(matchSessionByTarget(storage, { type: 'url', url: 'https://mcp.apify.com' }, {})).toBe(
      '@apify'
    );
    expect(matchSessionByTarget(storage, { type: 'url', url: 'mcp.apify.com' }, {})).toBe('@apify');
  });

  it('does not match different URLs', () => {
    const storage = makeStorage({
      '@apify': {
        name: '@apify',
        server: { url: 'https://mcp.apify.com' },
        createdAt: new Date().toISOString(),
      },
    });
    expect(matchSessionByTarget(storage, { type: 'url', url: 'https://example.com' }, {})).toBe(
      undefined
    );
  });

  it('matches when profile is "default" by default', () => {
    const storage = makeStorage({
      '@apify': {
        name: '@apify',
        server: { url: 'https://mcp.apify.com' },
        profileName: 'default',
        createdAt: new Date().toISOString(),
      },
    });
    expect(matchSessionByTarget(storage, { type: 'url', url: 'https://mcp.apify.com' }, {})).toBe(
      '@apify'
    );
  });

  it('does not match when profile differs', () => {
    const storage = makeStorage({
      '@apify': {
        name: '@apify',
        server: { url: 'https://mcp.apify.com' },
        profileName: 'work',
        createdAt: new Date().toISOString(),
      },
    });
    expect(
      matchSessionByTarget(storage, { type: 'url', url: 'https://mcp.apify.com' }, {})
    ).toBeUndefined();
    expect(
      matchSessionByTarget(
        storage,
        { type: 'url', url: 'https://mcp.apify.com' },
        { profile: 'work' }
      )
    ).toBe('@apify');
  });

  it('matches header key sets', () => {
    const storage = makeStorage({
      '@apify': {
        name: '@apify',
        server: {
          url: 'https://mcp.apify.com',
          headers: { 'X-Test': '<redacted>' },
        },
        createdAt: new Date().toISOString(),
      },
    });
    expect(
      matchSessionByTarget(
        storage,
        { type: 'url', url: 'https://mcp.apify.com' },
        { headers: ['X-Test: foo'] }
      )
    ).toBe('@apify');
    expect(
      matchSessionByTarget(
        storage,
        { type: 'url', url: 'https://mcp.apify.com' },
        { headers: ['Y-Other: foo'] }
      )
    ).toBeUndefined();
  });
});

describe('pickAvailableSessionName', () => {
  describe('alwaysSuffix=false (URL/config behaviour)', () => {
    it('returns bare candidate when not taken', () => {
      expect(pickAvailableSessionName(makeStorage({}), '@apify', false)).toBe('@apify');
    });

    it('returns -2 when bare candidate is taken', () => {
      const storage = makeStorage({
        '@apify': {
          name: '@apify',
          server: { url: 'https://mcp.apify.com' },
          createdAt: new Date().toISOString(),
        },
      });
      expect(pickAvailableSessionName(storage, '@apify', false)).toBe('@apify-2');
    });

    it('returns -3 when bare and -2 are taken', () => {
      const storage = makeStorage({
        '@apify': {
          name: '@apify',
          server: { url: 'https://mcp.apify.com' },
          createdAt: new Date().toISOString(),
        },
        '@apify-2': {
          name: '@apify-2',
          server: { url: 'https://mcp.apify.com' },
          createdAt: new Date().toISOString(),
        },
      });
      expect(pickAvailableSessionName(storage, '@apify', false)).toBe('@apify-3');
    });
  });

  describe('alwaysSuffix=true (inline command behaviour)', () => {
    it('returns -1 even when bare candidate is free', () => {
      // Per design decision 3: every inline-command session always gets a numeric suffix.
      expect(pickAvailableSessionName(makeStorage({}), '@npx', true)).toBe('@npx-1');
    });

    it('returns -2 when -1 is taken', () => {
      const storage = makeStorage({
        '@npx-1': {
          name: '@npx-1',
          server: { command: 'npx', args: ['-y', 'foo'] },
          createdAt: new Date().toISOString(),
        },
      });
      expect(pickAvailableSessionName(storage, '@npx', true)).toBe('@npx-2');
    });

    it('returns -3 when -1 and -2 are taken', () => {
      const storage = makeStorage({
        '@npx-1': {
          name: '@npx-1',
          server: { command: 'npx', args: ['-y', 'a'] },
          createdAt: new Date().toISOString(),
        },
        '@npx-2': {
          name: '@npx-2',
          server: { command: 'npx', args: ['-y', 'b'] },
          createdAt: new Date().toISOString(),
        },
      });
      expect(pickAvailableSessionName(storage, '@npx', true)).toBe('@npx-3');
    });

    it('does not return bare @npx when alwaysSuffix=true, even if @npx exists', () => {
      const storage = makeStorage({
        '@npx': {
          name: '@npx',
          server: { command: 'npx', args: [] },
          createdAt: new Date().toISOString(),
        },
      });
      // The bare @npx is taken too, so it picks -1.
      expect(pickAvailableSessionName(storage, '@npx', true)).toBe('@npx-1');
    });

    it('returns undefined when all 99 suffixes are taken', () => {
      const sessions: Record<string, SessionData> = {};
      for (let i = 1; i <= 99; i++) {
        const name = `@npx-${i}`;
        sessions[name] = {
          name,
          server: { command: 'npx', args: [String(i)] },
          createdAt: new Date().toISOString(),
        };
      }
      expect(pickAvailableSessionName(makeStorage(sessions), '@npx', true)).toBeUndefined();
    });
  });
});
