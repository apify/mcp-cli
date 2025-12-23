/**
 * Tests for shell command parsing
 */

import { parseShellCommand } from '../../src/cli/shell-parser.js';

describe('parseShellCommand', () => {
  it('returns empty command for empty string', () => {
    expect(parseShellCommand('')).toEqual({ command: '', args: [] });
  });

  it('returns empty command for whitespace-only string', () => {
    expect(parseShellCommand('   ')).toEqual({ command: '', args: [] });
  });

  it('parses single command without arguments', () => {
    expect(parseShellCommand('help')).toEqual({ command: 'help', args: [] });
  });

  it('parses command with single argument', () => {
    expect(parseShellCommand('tools-call search')).toEqual({
      command: 'tools-call',
      args: ['search'],
    });
  });

  it('parses command with multiple arguments', () => {
    expect(parseShellCommand('tools-call search --args query=hello')).toEqual({
      command: 'tools-call',
      args: ['search', '--args', 'query=hello'],
    });
  });

  it('handles double-quoted arguments', () => {
    expect(parseShellCommand('tools-call search --args "hello world"')).toEqual({
      command: 'tools-call',
      args: ['search', '--args', 'hello world'],
    });
  });

  it('handles single-quoted arguments', () => {
    expect(parseShellCommand("tools-call search --args 'hello world'")).toEqual({
      command: 'tools-call',
      args: ['search', '--args', 'hello world'],
    });
  });

  it('handles JSON in quotes', () => {
    expect(parseShellCommand('tools-call search --args \'{"query":"test"}\''))
      .toEqual({
        command: 'tools-call',
        args: ['search', '--args', '{"query":"test"}'],
      });
  });

  it('trims leading and trailing whitespace', () => {
    expect(parseShellCommand('  help  ')).toEqual({ command: 'help', args: [] });
  });

  it('handles multiple spaces between arguments', () => {
    expect(parseShellCommand('tools-call   search   --args')).toEqual({
      command: 'tools-call',
      args: ['search', '--args'],
    });
  });
});
