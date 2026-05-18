/**
 * Tests for shell completion logic.
 *
 * The disk-touching helpers (loadSessions/loadAuthProfiles/completion cache)
 * are mocked so the tests are pure and fast.
 */

vi.mock('../../../src/lib/sessions.js', () => ({
  loadSessions: vi.fn(async () => ({
    sessions: {
      '@apify': {},
      '@local': {},
      '@notion': {},
    },
  })),
}));

vi.mock('../../../src/lib/auth/profiles.js', () => ({
  listAuthProfiles: vi.fn(async () => [
    { name: 'default', serverUrl: 'https://mcp.apify.com' },
    { name: 'work', serverUrl: 'https://mcp.apify.com' },
    { name: 'personal', serverUrl: 'https://other.example.com' },
  ]),
}));

// Cache reads return empty by default so tool-name suggestions don't bleed
// across tests. Individual tests can override per-call via the mock.
vi.mock('../../../src/lib/completion-cache.js', () => ({
  readCompletionCache: vi.fn(async () => []),
  writeCompletionCache: vi.fn(async () => undefined),
  deleteCompletionCache: vi.fn(async () => undefined),
}));

import {
  analyzeContext,
  suggestCompletions,
  generateBashScript,
  generateZshScript,
  generateFishScript,
  detectShell,
  getInstallPath,
  SUPPORTED_SHELLS,
} from '../../../src/cli/commands/completion.js';

describe('analyzeContext', () => {
  it('returns empty context when no words have been typed', () => {
    const ctx = analyzeContext([], '');
    expect(ctx.firstNonOption).toBeUndefined();
    expect(ctx.isSessionCommand).toBe(false);
    expect(ctx.previousToken).toBeUndefined();
  });

  it('detects a top-level command', () => {
    const ctx = analyzeContext(['connect'], '');
    expect(ctx.topLevelCommand).toBe('connect');
    expect(ctx.isSessionCommand).toBe(false);
  });

  it('detects a session command and its subcommand', () => {
    const ctx = analyzeContext(['@apify', 'tools-list'], '');
    expect(ctx.firstNonOption).toBe('@apify');
    expect(ctx.isSessionCommand).toBe(true);
    expect(ctx.sessionSubcommand).toBe('tools-list');
  });

  it('skips global flags when looking for the first non-option', () => {
    const ctx = analyzeContext(['--json', '--verbose', '@apify'], '');
    expect(ctx.firstNonOption).toBe('@apify');
    expect(ctx.isSessionCommand).toBe(true);
  });

  it('skips flag values for known value-taking flags', () => {
    const ctx = analyzeContext(['--profile', 'work', 'connect'], '');
    expect(ctx.topLevelCommand).toBe('connect');
  });

  it('exposes previousToken for flag-value completion', () => {
    const ctx = analyzeContext(['--profile'], '');
    expect(ctx.previousToken).toBe('--profile');
  });
});

describe('suggestCompletions — top-level slot', () => {
  it('suggests top-level commands and @session names with an empty partial', async () => {
    const ctx = analyzeContext([], '');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(expect.arrayContaining(['connect', 'login', 'completion']));
    expect(candidates).toEqual(expect.arrayContaining(['@apify', '@local', '@notion']));
  });

  it('filters by prefix', async () => {
    const ctx = analyzeContext([], 'co');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(['connect', 'completion']);
  });

  it('suggests only @session names when partial starts with @', async () => {
    const ctx = analyzeContext([], '@');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(expect.arrayContaining(['@apify', '@local', '@notion']));
    expect(candidates.every((c) => c.startsWith('@'))).toBe(true);
  });
});

describe('suggestCompletions — session subcommands', () => {
  it('suggests known session subcommands after a @session', async () => {
    const ctx = analyzeContext(['@apify'], '');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(
      expect.arrayContaining(['tools-list', 'tools-call', 'resources-list', 'ping'])
    );
  });

  it('filters session subcommands by prefix', async () => {
    const ctx = analyzeContext(['@apify'], 'tools');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(['tools-list', 'tools-get', 'tools-call']);
  });

  it('suggests log levels for logging-set-level', async () => {
    const ctx = analyzeContext(['@apify', 'logging-set-level'], '');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(expect.arrayContaining(['debug', 'info', 'warning', 'error']));
  });
});

describe('suggestCompletions — top-level command args', () => {
  it('suggests clean resources after `clean`', async () => {
    const ctx = analyzeContext(['clean'], '');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(['sessions', 'profiles', 'logs', 'all']);
  });

  it('suggests @sessions after `connect`', async () => {
    const ctx = analyzeContext(['connect'], '@');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(expect.arrayContaining(['@apify', '@local', '@notion']));
  });

  it('suggests shell names after `completion`', async () => {
    const ctx = analyzeContext(['completion'], '');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(expect.arrayContaining(['bash', 'zsh', 'fish', 'install']));
  });

  it('suggests known servers after `login`', async () => {
    const ctx = analyzeContext(['login'], '');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(expect.arrayContaining(['mcp.apify.com', 'other.example.com']));
  });
});

describe('suggestCompletions — flags', () => {
  it('suggests global + command-specific flags when partial starts with --', async () => {
    const ctx = analyzeContext(['connect'], '--');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(
      expect.arrayContaining(['--proxy', '--stdio', '--json', '--verbose'])
    );
  });

  it('suggests only global flags before the first command', async () => {
    const ctx = analyzeContext([], '--');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(expect.arrayContaining(['--json', '--verbose']));
    expect(candidates).not.toEqual(expect.arrayContaining(['--proxy', '--stdio']));
  });

  it('deduplicates flags shared between global and command lists', async () => {
    const ctx = analyzeContext(['login'], '--profile');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates.filter((c) => c === '--profile').length).toBe(1);
  });

  // Drift guard: if `--header` / `--stdio` / `--proxy` get renamed in
  // index.ts, this test fails — catches accidental removals.
  it('picks up command-specific flags from Commander at runtime (no static list to drift)', async () => {
    const connectFlags = (await suggestCompletions(analyzeContext(['connect'], '--'))).candidates;
    expect(connectFlags).toEqual(expect.arrayContaining(['--header', '--stdio', '--proxy']));

    const sessionToolsFlags = (
      await suggestCompletions(analyzeContext(['@apify', 'tools-list'], '--'))
    ).candidates;
    expect(sessionToolsFlags).toEqual(expect.arrayContaining(['--full', '--help']));
  });

  it('marks value-taking flags so the previous-token check completes their values', async () => {
    // --profile takes a value; partial after it should suggest profile names,
    // not be treated as a free-form positional that gets command candidates.
    const ctx = analyzeContext(['--profile'], '');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(expect.arrayContaining(['default', 'work']));
    expect(candidates).not.toEqual(expect.arrayContaining(['connect', 'login']));
  });
});

describe('suggestCompletions — flag values', () => {
  it('completes profile names after --profile', async () => {
    const ctx = analyzeContext(['--profile'], '');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual(expect.arrayContaining(['default', 'work', 'personal']));
  });

  it('returns no candidates for unknown flag values (so shell falls back to files)', async () => {
    const ctx = analyzeContext(['-H'], '');
    const { candidates } = await suggestCompletions(ctx);
    expect(candidates).toEqual([]);
  });
});

describe('generated shell scripts', () => {
  it('bash script contains the registration line', () => {
    const script = generateBashScript();
    expect(script).toMatch(/complete .* -F _mcpc mcpc/);
    expect(script).toMatch(/mcpc __complete/);
  });

  it('zsh script declares compdef', () => {
    const script = generateZshScript();
    expect(script).toMatch(/^#compdef mcpc/);
    expect(script).toMatch(/compdef _mcpc mcpc/);
  });

  it('fish script uses complete -c mcpc', () => {
    const script = generateFishScript();
    expect(script).toMatch(/complete -c mcpc/);
    expect(script).toMatch(/mcpc __complete/);
  });
});

describe('detectShell', () => {
  const originalShell = process.env.SHELL;
  afterEach(() => {
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
  });

  it('detects bash', () => {
    process.env.SHELL = '/bin/bash';
    expect(detectShell()).toBe('bash');
  });

  it('detects zsh', () => {
    process.env.SHELL = '/usr/local/bin/zsh';
    expect(detectShell()).toBe('zsh');
  });

  it('detects fish', () => {
    process.env.SHELL = '/opt/homebrew/bin/fish';
    expect(detectShell()).toBe('fish');
  });

  it('returns undefined for unsupported shells', () => {
    process.env.SHELL = '/usr/bin/tcsh';
    expect(detectShell()).toBeUndefined();
  });

  it('returns undefined when $SHELL is unset', () => {
    delete process.env.SHELL;
    expect(detectShell()).toBeUndefined();
  });
});

describe('getInstallPath', () => {
  for (const shell of SUPPORTED_SHELLS) {
    it(`returns an absolute path for ${shell}`, () => {
      const path = getInstallPath(shell);
      expect(path.startsWith('/')).toBe(true);
      expect(path.length).toBeGreaterThan(5);
    });
  }
});
