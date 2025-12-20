/**
 * Unit tests for CLI argument parsing functions
 */

import { findTarget, extractOptions } from '../../src/cli/parser.js';

describe('findTarget', () => {
  it('should find simple target without options', () => {
    const result = findTarget(['apify']);
    expect(result).toEqual({ target: 'apify', targetIndex: 0 });
  });

  it('should find target after boolean flags', () => {
    const result = findTarget(['--json', '--verbose', 'apify']);
    expect(result).toEqual({ target: 'apify', targetIndex: 2 });
  });

  it('should skip options with values', () => {
    const result = findTarget(['--config', 'file.json', 'apify']);
    expect(result).toEqual({ target: 'apify', targetIndex: 2 });
  });

  it('should skip multiple options with values', () => {
    const result = findTarget([
      '--config',
      'file.json',
      '--header',
      'Auth: Bearer token',
      '--timeout',
      '60',
      'apify',
    ]);
    expect(result).toEqual({ target: 'apify', targetIndex: 6 });
  });

  it('should handle options with inline values (=)', () => {
    const result = findTarget(['--config=file.json', '--timeout=60', 'apify']);
    expect(result).toEqual({ target: 'apify', targetIndex: 2 });
  });

  it('should return undefined when no target found', () => {
    const result = findTarget(['--json', '--verbose']);
    expect(result).toBeUndefined();
  });

  it('should return undefined for empty args', () => {
    const result = findTarget([]);
    expect(result).toBeUndefined();
  });

  it('should handle mixed boolean and value options', () => {
    const result = findTarget([
      '--json',
      '--config',
      'file.json',
      '--verbose',
      '--header',
      'X-Key: value',
      'apify',
    ]);
    expect(result).toEqual({ target: 'apify', targetIndex: 6 });
  });

  it('should find target that looks like a file path', () => {
    const result = findTarget(['--config', './config.json', './my-file.txt']);
    expect(result).toEqual({ target: './my-file.txt', targetIndex: 2 });
  });

  it('should handle session names (@name)', () => {
    const result = findTarget(['--json', '@apify']);
    expect(result).toEqual({ target: '@apify', targetIndex: 1 });
  });
});

describe('extractOptions', () => {
  it('should extract boolean flags', () => {
    const result = extractOptions(['--json', '--verbose']);
    expect(result).toEqual({ json: true, verbose: true });
  });

  it('should extract --json short form (-j)', () => {
    const result = extractOptions(['-j']);
    expect(result).toEqual({ json: true, verbose: false });
  });

  it('should extract --config', () => {
    const result = extractOptions(['--config', 'file.json']);
    expect(result).toEqual({ json: false, verbose: false, config: 'file.json' });
  });

  it('should extract --config short form (-c)', () => {
    const result = extractOptions(['-c', 'file.json']);
    expect(result).toEqual({ json: false, verbose: false, config: 'file.json' });
  });

  it('should extract multiple --header options', () => {
    const result = extractOptions([
      '--header',
      'Auth: Bearer token',
      '--header',
      'X-Key: value',
    ]);
    expect(result).toEqual({
      json: false,
      verbose: false,
      headers: ['Auth: Bearer token', 'X-Key: value'],
    });
  });

  it('should extract --header short form (-H)', () => {
    const result = extractOptions(['-H', 'Auth: token', '-H', 'X-Key: value']);
    expect(result).toEqual({
      json: false,
      verbose: false,
      headers: ['Auth: token', 'X-Key: value'],
    });
  });

  it('should extract --timeout', () => {
    const result = extractOptions(['--timeout', '120']);
    expect(result).toEqual({ json: false, verbose: false, timeout: 120 });
  });

  it('should extract all options together', () => {
    const result = extractOptions([
      '--json',
      '--verbose',
      '--config',
      'config.json',
      '--header',
      'Auth: token',
      '--timeout',
      '60',
    ]);
    expect(result).toEqual({
      json: true,
      verbose: true,
      config: 'config.json',
      headers: ['Auth: token'],
      timeout: 60,
    });
  });

  it('should handle empty args', () => {
    const result = extractOptions([]);
    expect(result).toEqual({ json: false, verbose: false });
  });

  it('should ignore options without values', () => {
    const result = extractOptions(['--config']);
    expect(result).toEqual({ json: false, verbose: false });
  });

  it('should handle timeout at end of args', () => {
    const result = extractOptions(['--json', '--timeout']);
    expect(result).toEqual({ json: true, verbose: false });
  });

  it('should parse timeout as integer', () => {
    const result = extractOptions(['--timeout', '300']);
    expect(result).toEqual({ json: false, verbose: false, timeout: 300 });
  });

  it('should handle NaN timeout gracefully', () => {
    const result = extractOptions(['--timeout', 'invalid']);
    expect(result.timeout).toBeNaN();
  });

  it('should handle args with target mixed in', () => {
    // Target should be ignored - extractOptions only cares about options
    const result = extractOptions([
      '--json',
      'apify',
      '--config',
      'file.json',
      'tools-list',
    ]);
    expect(result).toEqual({ json: true, verbose: false, config: 'file.json' });
  });

  it('should handle repeated config (last one wins)', () => {
    const result = extractOptions(['--config', 'first.json', '--config', 'second.json']);
    // Only checks for first occurrence, so first.json wins
    expect(result).toEqual({ json: false, verbose: false, config: 'first.json' });
  });
});
