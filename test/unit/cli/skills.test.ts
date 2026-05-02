/**
 * Tests for the skills command module — implementation of the experimental
 * MCP skills extension (SEP-2640).
 */

// Mock chalk to return plain strings (Jest can't handle chalk's ESM imports)
jest.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    dim: (s: string) => s,
    gray: (s: string) => s,
    bold: (s: string) => s,
    green: (s: string) => s,
    greenBright: (s: string) => s,
    blue: (s: string) => s,
    magenta: (s: string) => s,
    white: (s: string) => s,
  },
  cyan: (s: string) => s,
  yellow: (s: string) => s,
  red: (s: string) => s,
  dim: (s: string) => s,
  gray: (s: string) => s,
  bold: (s: string) => s,
  green: (s: string) => s,
  greenBright: (s: string) => s,
  blue: (s: string) => s,
  magenta: (s: string) => s,
  white: (s: string) => s,
}));

// Mock sessions module to avoid loading session state during import
jest.mock('../../../src/lib/sessions.js', () => ({
  getSession: jest.fn().mockResolvedValue(null),
}));

import type { ReadResourceResult, Resource } from '@modelcontextprotocol/sdk/types.js';

import {
  SKILLS_INDEX_URI,
  SKILLS_EXTENSION_KEY,
  resolveSkillUri,
  parseIndex,
  skillsFromResources,
  extractTextContent,
  discoverSkills,
} from '../../../src/cli/commands/skills.js';
import { ServerError } from '../../../src/lib/errors.js';

describe('skills constants', () => {
  it('matches the spec', () => {
    expect(SKILLS_INDEX_URI).toBe('skill://index.json');
    expect(SKILLS_EXTENSION_KEY).toBe('io.modelcontextprotocol/skills');
  });
});

describe('resolveSkillUri', () => {
  it('resolves a bare name to skill://<name>/SKILL.md', () => {
    expect(resolveSkillUri('git-workflow')).toBe('skill://git-workflow/SKILL.md');
  });

  it('resolves a nested path', () => {
    expect(resolveSkillUri('acme/billing/refunds')).toBe('skill://acme/billing/refunds/SKILL.md');
  });

  it('passes through a full skill:// URI ending in a filename', () => {
    expect(resolveSkillUri('skill://git-workflow/SKILL.md')).toBe('skill://git-workflow/SKILL.md');
  });

  it('passes through a non-SKILL.md file URI unchanged', () => {
    expect(resolveSkillUri('skill://pdf/references/FORMS.md')).toBe(
      'skill://pdf/references/FORMS.md'
    );
  });

  it('appends SKILL.md when given a skill:// directory URI', () => {
    expect(resolveSkillUri('skill://git-workflow')).toBe('skill://git-workflow/SKILL.md');
    expect(resolveSkillUri('skill://acme/billing')).toBe('skill://acme/billing/SKILL.md');
  });

  it('appends SKILL.md when given a trailing-slash skill:// URI', () => {
    expect(resolveSkillUri('skill://git-workflow/')).toBe('skill://git-workflow/SKILL.md');
  });

  it('strips surrounding slashes from bare paths', () => {
    expect(resolveSkillUri('/git-workflow/')).toBe('skill://git-workflow/SKILL.md');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveSkillUri('  git-workflow  ')).toBe('skill://git-workflow/SKILL.md');
  });

  it('throws on empty input', () => {
    expect(() => resolveSkillUri('')).toThrow();
    expect(() => resolveSkillUri('   ')).toThrow();
  });

  it('throws when bare name resolves to nothing after stripping slashes', () => {
    expect(() => resolveSkillUri('//')).toThrow();
  });
});

describe('parseIndex', () => {
  it('parses a well-formed index', () => {
    const text = JSON.stringify({
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: [
        {
          name: 'git-workflow',
          type: 'skill-md',
          description: 'Git workflow helpers',
          url: 'skill://git-workflow/SKILL.md',
        },
        {
          name: 'pdf',
          type: 'skill-md',
          description: 'Read PDFs',
          url: 'skill://pdf/SKILL.md',
        },
      ],
    });

    const skills = parseIndex(text);
    expect(skills).toHaveLength(2);
    expect(skills[0]).toEqual({
      name: 'git-workflow',
      type: 'skill-md',
      description: 'Git workflow helpers',
      url: 'skill://git-workflow/SKILL.md',
    });
    expect(skills[1]?.name).toBe('pdf');
  });

  it('preserves the type field including mcp-resource-template', () => {
    const text = JSON.stringify({
      skills: [
        {
          name: 'paramd',
          type: 'mcp-resource-template',
          description: 'Templates',
          url: 'skill://paramd/{id}/SKILL.md',
        },
      ],
    });
    const skills = parseIndex(text);
    expect(skills[0]?.type).toBe('mcp-resource-template');
  });

  it('omits the type field when absent', () => {
    const text = JSON.stringify({
      skills: [{ name: 'x', description: 'y', url: 'skill://x/SKILL.md' }],
    });
    const skills = parseIndex(text);
    expect(skills[0]).not.toHaveProperty('type');
  });

  it('treats missing description as empty string', () => {
    const text = JSON.stringify({
      skills: [{ name: 'x', url: 'skill://x/SKILL.md' }],
    });
    const skills = parseIndex(text);
    expect(skills[0]?.description).toBe('');
  });

  it('drops entries missing required name or url', () => {
    const text = JSON.stringify({
      skills: [
        { name: 'good', description: 'ok', url: 'skill://good/SKILL.md' },
        { description: 'no name', url: 'skill://x/SKILL.md' },
        { name: 'no-url', description: 'no url' },
        null,
        'not-an-object',
        { name: 123, url: 'skill://x/SKILL.md' }, // wrong type for name
      ],
    });
    const skills = parseIndex(text);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('good');
  });

  it('returns empty list when skills field is absent or non-array', () => {
    expect(parseIndex(JSON.stringify({}))).toEqual([]);
    expect(parseIndex(JSON.stringify({ skills: null }))).toEqual([]);
    expect(parseIndex(JSON.stringify({ skills: 'not-an-array' }))).toEqual([]);
  });

  it('throws ServerError on invalid JSON', () => {
    expect(() => parseIndex('{not json')).toThrow(ServerError);
    expect(() => parseIndex('{not json')).toThrow(/not valid JSON/);
  });

  it('throws ServerError when JSON is null or a primitive', () => {
    expect(() => parseIndex('"hello"')).toThrow(ServerError);
    expect(() => parseIndex('42')).toThrow(ServerError);
    expect(() => parseIndex('null')).toThrow(ServerError);
  });

  it('treats a top-level array as an object with no skills field', () => {
    // typeof [] === 'object' so the index-shape check passes, but the
    // `skills` field is absent — return empty rather than throwing, since
    // the spec asks hosts to be permissive about index shape.
    expect(parseIndex('[]')).toEqual([]);
  });
});

describe('skillsFromResources', () => {
  it('extracts skills from SKILL.md resource URIs', () => {
    const resources: Resource[] = [
      {
        uri: 'skill://git-workflow/SKILL.md',
        name: 'Git Workflow',
        description: 'Git helpers',
        mimeType: 'text/markdown',
      },
      {
        uri: 'skill://pdf/SKILL.md',
        name: 'PDF',
        description: 'PDFs',
        mimeType: 'text/markdown',
      },
    ];
    const skills = skillsFromResources(resources);
    expect(skills).toHaveLength(2);
    expect(skills[0]).toEqual({
      name: 'Git Workflow',
      description: 'Git helpers',
      type: 'skill-md',
      url: 'skill://git-workflow/SKILL.md',
    });
  });

  it('uses the final path segment as name when resource name is missing', () => {
    const resources: Resource[] = [
      { uri: 'skill://git-workflow/SKILL.md', name: '' },
    ] as Resource[];
    const skills = skillsFromResources(resources);
    expect(skills[0]?.name).toBe('git-workflow');
  });

  it('uses the final path segment for nested skill paths', () => {
    const resources: Resource[] = [{ uri: 'skill://acme/billing/refunds/SKILL.md' } as Resource];
    const skills = skillsFromResources(resources);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('refunds');
    expect(skills[0]?.url).toBe('skill://acme/billing/refunds/SKILL.md');
  });

  it('ignores non-skill URIs', () => {
    const resources: Resource[] = [
      { uri: 'file:///etc/hosts', name: 'hosts' } as Resource,
      { uri: 'skill://git-workflow/SKILL.md', name: 'gw' } as Resource,
      { uri: 'http://example.com', name: 'http' } as Resource,
    ];
    const skills = skillsFromResources(resources);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.url).toBe('skill://git-workflow/SKILL.md');
  });

  it('ignores non-SKILL.md files under skill:// prefix', () => {
    const resources: Resource[] = [
      { uri: 'skill://pdf/SKILL.md', name: 'pdf' } as Resource,
      { uri: 'skill://pdf/references/FORMS.md', name: 'forms' } as Resource,
      { uri: 'skill://index.json', name: 'index' } as Resource,
    ];
    const skills = skillsFromResources(resources);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.url).toBe('skill://pdf/SKILL.md');
  });
});

describe('extractTextContent', () => {
  it('returns the text of the first text content block', () => {
    const result: ReadResourceResult = {
      contents: [{ uri: 'skill://x/SKILL.md', mimeType: 'text/markdown', text: 'hello' }],
    };
    expect(extractTextContent(result)).toBe('hello');
  });

  it('returns undefined when there is no text content', () => {
    const result: ReadResourceResult = {
      contents: [{ uri: 'skill://x/SKILL.md', mimeType: 'application/octet-stream', blob: 'aGk=' }],
    };
    expect(extractTextContent(result)).toBeUndefined();
  });

  it('skips blob entries to find a later text entry', () => {
    const result: ReadResourceResult = {
      contents: [
        { uri: 'skill://x/SKILL.md', mimeType: 'application/octet-stream', blob: 'aGk=' },
        { uri: 'skill://x/extra.md', mimeType: 'text/markdown', text: 'second' },
      ],
    };
    expect(extractTextContent(result)).toBe('second');
  });
});

/**
 * Build a minimal mock IMcpClient covering only the methods discoverSkills
 * touches. Returned object is cast to IMcpClient via `unknown`.
 */
function makeMockClient(opts: {
  /** Body returned from readResource(skill://index.json), or null to throw. */
  index?: string | null;
  /** Resources returned by listResources (single page). */
  resources?: Resource[];
  /** Multiple pages of resources, simulating pagination. */
  resourcePages?: Array<{ resources: Resource[]; nextCursor?: string }>;
}): {
  client: import('../../../src/lib/types.js').IMcpClient;
  readResourceCalls: string[];
  listResourcesCalls: Array<string | undefined>;
} {
  const readResourceCalls: string[] = [];
  const listResourcesCalls: Array<string | undefined> = [];

  const readResource = jest.fn(async (uri: string): Promise<ReadResourceResult> => {
    readResourceCalls.push(uri);
    if (uri === 'skill://index.json') {
      if (opts.index === null) {
        throw new Error('not found');
      }
      if (typeof opts.index === 'string') {
        return {
          contents: [{ uri, mimeType: 'application/json', text: opts.index }],
        };
      }
    }
    throw new Error(`unexpected uri: ${uri}`);
  });

  const listResources = jest.fn(async (cursor?: string) => {
    listResourcesCalls.push(cursor);
    if (opts.resourcePages) {
      const page = opts.resourcePages.shift();
      if (!page) return { resources: [] };
      return page;
    }
    return { resources: opts.resources ?? [] };
  });

  const client = {
    readResource,
    listResources,
  } as unknown as import('../../../src/lib/types.js').IMcpClient;

  return { client, readResourceCalls, listResourcesCalls };
}

describe('discoverSkills', () => {
  it('returns parsed index when skill://index.json is available', async () => {
    const indexBody = JSON.stringify({
      skills: [
        {
          name: 'git-workflow',
          type: 'skill-md',
          description: 'Git helpers',
          url: 'skill://git-workflow/SKILL.md',
        },
      ],
    });
    const { client, readResourceCalls, listResourcesCalls } = makeMockClient({
      index: indexBody,
    });

    const skills = await discoverSkills(client);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('git-workflow');

    // Only the index was read; no resource fallback when index succeeds
    expect(readResourceCalls).toEqual(['skill://index.json']);
    expect(listResourcesCalls).toHaveLength(0);
  });

  it('falls back to scanning resources when index read throws', async () => {
    const { client, readResourceCalls, listResourcesCalls } = makeMockClient({
      index: null, // throw
      resources: [
        { uri: 'skill://git-workflow/SKILL.md', name: 'GW' } as Resource,
        { uri: 'file:///other', name: 'other' } as Resource,
      ],
    });

    const skills = await discoverSkills(client);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.url).toBe('skill://git-workflow/SKILL.md');
    expect(readResourceCalls).toEqual(['skill://index.json']);
    expect(listResourcesCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('drains all pages of resources during fallback', async () => {
    const { client, listResourcesCalls } = makeMockClient({
      index: null,
      resourcePages: [
        {
          resources: [{ uri: 'skill://a/SKILL.md', name: 'a' } as Resource],
          nextCursor: 'cursor1',
        },
        {
          resources: [{ uri: 'skill://b/SKILL.md', name: 'b' } as Resource],
        },
      ],
    });

    const skills = await discoverSkills(client);
    expect(skills.map((s) => s.name).sort()).toEqual(['a', 'b']);
    // Two pages consumed, with the second call passing the cursor
    expect(listResourcesCalls).toEqual([undefined, 'cursor1']);
  });

  it('returns empty list when neither index nor matching resources exist', async () => {
    const { client } = makeMockClient({
      index: null,
      resources: [{ uri: 'file:///nope', name: 'nope' } as Resource],
    });
    const skills = await discoverSkills(client);
    expect(skills).toEqual([]);
  });
});
