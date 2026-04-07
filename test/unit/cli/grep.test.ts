/**
 * Tests for grep command formatting utilities
 */

// Mock chalk to return plain strings (required because Jest can't handle chalk's ESM imports)
const chalkIdentity = (s: string) => s;
const chalkBold = Object.assign(chalkIdentity, { underline: chalkIdentity });
jest.mock('chalk', () => ({
  default: {
    cyan: chalkIdentity,
    yellow: chalkIdentity,
    red: chalkIdentity,
    dim: chalkIdentity,
    gray: chalkIdentity,
    bold: chalkBold,
    green: chalkIdentity,
    greenBright: chalkIdentity,
    blue: chalkIdentity,
    magenta: chalkIdentity,
    white: chalkIdentity,
  },
  cyan: chalkIdentity,
  yellow: chalkIdentity,
  red: chalkIdentity,
  dim: chalkIdentity,
  gray: chalkIdentity,
  bold: chalkBold,
  green: chalkIdentity,
  greenBright: chalkIdentity,
  blue: chalkIdentity,
  magenta: chalkIdentity,
  white: chalkIdentity,
}));

// Mock modules that grep.ts imports transitively
jest.mock('../../../src/lib/errors.js', () => ({
  ClientError: class ClientError extends Error {},
}));
jest.mock('../../../src/lib/utils.js', () => ({
  isProcessAlive: jest.fn(),
}));
jest.mock('../../../src/lib/sessions.js', () => ({
  consolidateSessions: jest.fn(),
  getSession: jest.fn(),
}));
jest.mock('../../../src/lib/bridge-manager.js', () => ({
  reconnectCrashedSessions: jest.fn(),
}));
jest.mock('../../../src/lib/session-client.js', () => ({
  withSessionClient: jest.fn(),
}));
jest.mock('../../../src/cli/helpers.js', () => ({
  withMcpClient: jest.fn(),
}));
jest.mock('../../../src/cli/output.js', () => ({
  formatJson: jest.fn(),
  formatToolLine: jest.fn(),
  inBackticks: (s: string) => `\`${s}\``,
}));
jest.mock('../../../src/cli/commands/sessions.js', () => ({
  getBridgeStatus: jest.fn(),
  formatBridgeStatus: jest.fn(),
}));

import { extractInstructionsSnippet } from '../../../src/cli/commands/grep.js';

describe('extractInstructionsSnippet', () => {
  it('returns false when pattern is not found', () => {
    const result = extractInstructionsSnippet('hello world', 'xyz', {});
    expect(result).toBe(false);
  });

  it('returns the full text when it is short enough', () => {
    const result = extractInstructionsSnippet('hello world', 'world', {});
    expect(result).toBe('hello world');
  });

  it('adds leading ellipsis when match is far from the start', () => {
    const text = 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp';
    const result = extractInstructionsSnippet(text, 'mmm', {});
    expect(result).toBeTruthy();
    expect(result).toContain('mmm');
    expect(result!.startsWith('\u2026')).toBe(true);
    // total length should be roughly pattern.length + 50
    expect(result!.length).toBeLessThanOrEqual('mmm'.length + 90);
  });

  it('adds trailing ellipsis when match is far from the end', () => {
    const text = 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp';
    const result = extractInstructionsSnippet(text, 'ccc', {});
    expect(result).toBeTruthy();
    expect(result).toContain('ccc');
    expect(result!.endsWith('\u2026')).toBe(true);
  });

  it('adds ellipsis on both sides for a match in the middle of long text', () => {
    const text =
      'In the early morning light the quick brown fox jumps gracefully over the lazy dog resting by the old oak tree near the river bank and then runs across the big open field';
    const result = extractInstructionsSnippet(text, 'lazy', {});
    expect(result).toBeTruthy();
    expect(result).toContain('lazy');
    expect(result!.startsWith('\u2026')).toBe(true);
    expect(result!.endsWith('\u2026')).toBe(true);
    expect(result!.length).toBeLessThanOrEqual('lazy'.length + 90);
  });

  it('normalizes whitespace including newlines', () => {
    const text = 'line one\n\nline two\n\nline three  with   spaces';
    const result = extractInstructionsSnippet(text, 'two', {});
    expect(result).toBeTruthy();
    expect(result).toContain('two');
    expect(result).not.toContain('\n');
  });

  it('handles case-insensitive search (default)', () => {
    const result = extractInstructionsSnippet('Hello World', 'hello', {});
    expect(result).toContain('Hello World');
  });

  it('respects case-sensitive option', () => {
    const resultLower = extractInstructionsSnippet('Hello World', 'hello', { caseSensitive: true });
    expect(resultLower).toBe(false);

    const resultUpper = extractInstructionsSnippet('Hello World', 'Hello', { caseSensitive: true });
    expect(resultUpper).toContain('Hello');
  });

  it('handles regex patterns', () => {
    const text = 'The price is 42 dollars for this item';
    const result = extractInstructionsSnippet(text, '\\d+', { regex: true });
    expect(result).toBeTruthy();
    expect(result).toContain('42');
  });

  it('returns false for invalid regex', () => {
    const result = extractInstructionsSnippet('hello', '[invalid', { regex: true });
    expect(result).toBe(false);
  });

  it('handles match at the very start', () => {
    const text =
      'START of a very long instructions text that goes on and on and keeps going further';
    const result = extractInstructionsSnippet(text, 'START', {});
    expect(result).toBeTruthy();
    expect(result).toContain('START');
    expect(result!.startsWith('\u2026')).toBe(false);
    expect(result!.endsWith('\u2026')).toBe(true);
  });

  it('handles match at the very end', () => {
    const text =
      'A very long instructions text that goes on and on and keeps going further until the END';
    const result = extractInstructionsSnippet(text, 'END', {});
    expect(result).toBeTruthy();
    expect(result).toContain('END');
    expect(result!.startsWith('\u2026')).toBe(true);
    expect(result!.endsWith('\u2026')).toBe(false);
  });

  it('produces a snippet whose length is bounded relative to the pattern', () => {
    const text =
      'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua';
    const pattern = 'consectetur';
    const result = extractInstructionsSnippet(text, pattern, {});
    expect(result).toBeTruthy();
    expect(result).toContain(pattern);
    // Snippet should be at most about pattern.length + 80 + 2 (for ellipsis chars)
    expect(result!.length).toBeLessThanOrEqual(pattern.length + 90);
  });

  it('handles case-insensitive regex', () => {
    const text = 'The Quick Brown Fox jumps over the lazy dog';
    const result = extractInstructionsSnippet(text, 'quick.*fox', {
      regex: true,
      caseSensitive: false,
    });
    expect(result).toBeTruthy();
    expect(result).toContain('Quick Brown Fox');
  });
});
