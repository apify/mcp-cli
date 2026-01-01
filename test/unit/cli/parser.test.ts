/**
 * Tests for argument parsing utilities
 */

import { parseCommandArgs, getVerboseFromEnv, getJsonFromEnv } from '../../../src/cli/parser.js';
import { ClientError } from '../../../src/lib/errors.js';

describe('parseCommandArgs', () => {
  describe('empty or undefined input', () => {
    it('should return empty object for undefined args', () => {
      const result = parseCommandArgs(undefined);
      expect(result).toEqual({});
    });

    it('should return empty object for empty array', () => {
      const result = parseCommandArgs([]);
      expect(result).toEqual({});
    });
  });

  describe('inline JSON format', () => {
    it('should parse inline JSON object', () => {
      const result = parseCommandArgs(['{"query":"hello","limit":10}']);
      expect(result).toEqual({ query: 'hello', limit: 10 });
    });

    it('should parse inline JSON array', () => {
      const result = parseCommandArgs(['[1,2,3]']);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should parse nested JSON object', () => {
      const result = parseCommandArgs(['{"config":{"key":"value"},"items":[1,2,3]}']);
      expect(result).toEqual({ config: { key: 'value' }, items: [1, 2, 3] });
    });

    it('should throw error when multiple arguments provided with inline JSON', () => {
      expect(() => {
        parseCommandArgs(['{"query":"hello"}', 'extra']);
      }).toThrow(ClientError);
      expect(() => {
        parseCommandArgs(['{"query":"hello"}', 'extra']);
      }).toThrow('When using inline JSON, only one argument is allowed');
    });

    it('should throw error for invalid JSON', () => {
      expect(() => {
        parseCommandArgs(['{invalid json}']);
      }).toThrow(ClientError);
      expect(() => {
        parseCommandArgs(['{invalid json}']);
      }).toThrow('Invalid JSON');
    });

    it('should throw error for strings not starting with { or [', () => {
      // Strings that don't start with { or [ are treated as invalid key:=value format
      expect(() => {
        parseCommandArgs(['"just a string"']);
      }).toThrow(ClientError);
      expect(() => {
        parseCommandArgs(['"just a string"']);
      }).toThrow('Invalid argument format');
    });

    it('should throw error for literal null not starting with { or [', () => {
      // "null" without quotes is treated as invalid key:=value format
      expect(() => {
        parseCommandArgs(['null']);
      }).toThrow(ClientError);
      expect(() => {
        parseCommandArgs(['null']);
      }).toThrow('Invalid argument format');
    });
  });

  describe('key:=value format (auto-parsed values)', () => {
    it('should parse number value', () => {
      const result = parseCommandArgs(['limit:=10']);
      expect(result).toEqual({ limit: 10 });
    });

    it('should parse boolean true', () => {
      const result = parseCommandArgs(['enabled:=true']);
      expect(result).toEqual({ enabled: true });
    });

    it('should parse boolean false', () => {
      const result = parseCommandArgs(['enabled:=false']);
      expect(result).toEqual({ enabled: false });
    });

    it('should parse null', () => {
      const result = parseCommandArgs(['value:=null']);
      expect(result).toEqual({ value: null });
    });

    it('should parse JSON object', () => {
      const result = parseCommandArgs(['config:={"key":"value"}']);
      expect(result).toEqual({ config: { key: 'value' } });
    });

    it('should parse JSON array', () => {
      const result = parseCommandArgs(['items:=[1,2,3]']);
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('should parse string value (non-JSON)', () => {
      // Auto-parsing: if not valid JSON, treat as string
      const result = parseCommandArgs(['query:=hello']);
      expect(result).toEqual({ query: 'hello' });
    });

    it('should parse quoted string as string', () => {
      const result = parseCommandArgs(['query:="hello world"']);
      expect(result).toEqual({ query: 'hello world' });
    });

    it('should parse numeric string as string when quoted', () => {
      const result = parseCommandArgs(['id:="123"']);
      expect(result).toEqual({ id: '123' });
    });

    it('should throw error for empty key', () => {
      expect(() => {
        parseCommandArgs([':=123']);
      }).toThrow(ClientError);
      expect(() => {
        parseCommandArgs([':=123']);
      }).toThrow('Invalid argument');
    });
  });

  describe('only key:=value syntax supported', () => {
    it('should throw error for key=value format', () => {
      expect(() => {
        parseCommandArgs(['query=hello']);
      }).toThrow(ClientError);
      expect(() => {
        parseCommandArgs(['query=hello']);
      }).toThrow('Invalid argument format');
    });

    it('should throw error for bare key without value', () => {
      expect(() => {
        parseCommandArgs(['query']);
      }).toThrow(ClientError);
      expect(() => {
        parseCommandArgs(['query']);
      }).toThrow('Invalid argument format');
    });
  });

  describe('multiple key:=value pairs', () => {
    it('should parse multiple pairs', () => {
      const result = parseCommandArgs(['query:=hello', 'limit:=10', 'enabled:=true']);
      expect(result).toEqual({ query: 'hello', limit: 10, enabled: true });
    });

    it('should handle complex mixed arguments', () => {
      const result = parseCommandArgs([
        'name:=test',
        'count:=42',
        'active:=true',
        'tags:=["a","b"]',
        'config:={"x":1}',
      ]);
      expect(result).toEqual({
        name: 'test',
        count: 42,
        active: true,
        tags: ['a', 'b'],
        config: { x: 1 },
      });
    });
  });

  describe('edge cases', () => {
    it('should handle keys with numbers', () => {
      const result = parseCommandArgs(['key1:=value1', 'key2:=123']);
      expect(result).toEqual({ key1: 'value1', key2: 123 });
    });

    it('should handle keys with underscores', () => {
      const result = parseCommandArgs(['some_key:=value']);
      expect(result).toEqual({ some_key: 'value' });
    });

    it('should handle keys with hyphens', () => {
      const result = parseCommandArgs(['some-key:=value']);
      expect(result).toEqual({ 'some-key': 'value' });
    });

    it('should allow overwriting keys', () => {
      const result = parseCommandArgs(['key:=first', 'key:=second']);
      expect(result).toEqual({ key: 'second' });
    });

    it('should handle values with := in them', () => {
      // Only first := is used as separator
      const result = parseCommandArgs(['expr:=a:=b']);
      expect(result).toEqual({ expr: 'a:=b' });
    });

    it('should handle empty string value', () => {
      const result = parseCommandArgs(['key:=""']);
      expect(result).toEqual({ key: '' });
    });

    it('should treat unquoted empty value as empty string', () => {
      const result = parseCommandArgs(['key:=']);
      expect(result).toEqual({ key: '' });
    });
  });
});

describe('getVerboseFromEnv', () => {
  const originalEnv = process.env.MCPC_VERBOSE;

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv === undefined) {
      delete process.env.MCPC_VERBOSE;
    } else {
      process.env.MCPC_VERBOSE = originalEnv;
    }
  });

  it('should return false when not set', () => {
    delete process.env.MCPC_VERBOSE;
    expect(getVerboseFromEnv()).toBe(false);
  });

  it('should return true when set to "1"', () => {
    process.env.MCPC_VERBOSE = '1';
    expect(getVerboseFromEnv()).toBe(true);
  });

  it('should return true when set to "true"', () => {
    process.env.MCPC_VERBOSE = 'true';
    expect(getVerboseFromEnv()).toBe(true);
  });

  it('should return true when set to "yes"', () => {
    process.env.MCPC_VERBOSE = 'yes';
    expect(getVerboseFromEnv()).toBe(true);
  });

  it('should be case-insensitive', () => {
    process.env.MCPC_VERBOSE = 'TRUE';
    expect(getVerboseFromEnv()).toBe(true);
    process.env.MCPC_VERBOSE = 'Yes';
    expect(getVerboseFromEnv()).toBe(true);
  });

  it('should trim whitespace', () => {
    process.env.MCPC_VERBOSE = '  true  ';
    expect(getVerboseFromEnv()).toBe(true);
  });

  it('should return false for other values', () => {
    process.env.MCPC_VERBOSE = '0';
    expect(getVerboseFromEnv()).toBe(false);
    process.env.MCPC_VERBOSE = 'false';
    expect(getVerboseFromEnv()).toBe(false);
    process.env.MCPC_VERBOSE = 'no';
    expect(getVerboseFromEnv()).toBe(false);
    process.env.MCPC_VERBOSE = 'random';
    expect(getVerboseFromEnv()).toBe(false);
  });
});

describe('getJsonFromEnv', () => {
  const originalEnv = process.env.MCPC_JSON;

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv === undefined) {
      delete process.env.MCPC_JSON;
    } else {
      process.env.MCPC_JSON = originalEnv;
    }
  });

  it('should return false when not set', () => {
    delete process.env.MCPC_JSON;
    expect(getJsonFromEnv()).toBe(false);
  });

  it('should return true when set to "1"', () => {
    process.env.MCPC_JSON = '1';
    expect(getJsonFromEnv()).toBe(true);
  });

  it('should return true when set to "true"', () => {
    process.env.MCPC_JSON = 'true';
    expect(getJsonFromEnv()).toBe(true);
  });

  it('should return true when set to "yes"', () => {
    process.env.MCPC_JSON = 'yes';
    expect(getJsonFromEnv()).toBe(true);
  });

  it('should be case-insensitive', () => {
    process.env.MCPC_JSON = 'TRUE';
    expect(getJsonFromEnv()).toBe(true);
  });

  it('should return false for other values', () => {
    process.env.MCPC_JSON = '0';
    expect(getJsonFromEnv()).toBe(false);
    process.env.MCPC_JSON = 'false';
    expect(getJsonFromEnv()).toBe(false);
  });
});
