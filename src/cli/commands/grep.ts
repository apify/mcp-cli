/**
 * Grep command handler - search tools, resources, and prompts
 */

import chalk from 'chalk';
import type { Tool, Resource, Prompt, CommandOptions } from '../../lib/types.js';
import { ClientError } from '../../lib/errors.js';
import { isProcessAlive } from '../../lib/utils.js';
import { consolidateSessions } from '../../lib/sessions.js';
import { withSessionClient } from '../../lib/session-client.js';
import { withMcpClient } from '../helpers.js';
import {
  formatJson,
  formatToolParamsInline,
  formatToolAnnotations,
  grayBacktick,
  inBackticks,
} from '../output.js';
import type { IMcpClient } from '../../lib/types.js';

export interface GrepOptions extends CommandOptions {
  tools?: boolean | undefined;
  resources?: boolean | undefined;
  prompts?: boolean | undefined;
  regex?: boolean | undefined;
  caseSensitive?: boolean | undefined;
}

interface GrepResult {
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
}

interface SessionGrepResult {
  session: string;
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
}

interface SessionGrepError {
  session: string;
  error: string;
}

/**
 * Build a match function from the pattern and options
 */
function buildMatcher(pattern: string, options: GrepOptions): (text: string) => boolean {
  if (options.regex) {
    let re: RegExp;
    try {
      re = new RegExp(pattern, options.caseSensitive ? '' : 'i');
    } catch (err) {
      throw new ClientError(
        `Invalid regex pattern: ${pattern}\n${err instanceof Error ? err.message : String(err)}`
      );
    }
    return (text: string) => re.test(text);
  }

  if (options.caseSensitive) {
    return (text: string) => text.includes(pattern);
  }

  const lowerPattern = pattern.toLowerCase();
  return (text: string) => text.toLowerCase().includes(lowerPattern);
}

/**
 * Determine which types to search based on flags.
 * If no type flags are given, defaults to tools only.
 * If any type flag is given, search exactly the specified types.
 */
function getSearchTypes(options: GrepOptions): {
  searchTools: boolean;
  searchResources: boolean;
  searchPrompts: boolean;
} {
  const anyFilter = options.tools || options.resources || options.prompts;
  return {
    searchTools: anyFilter ? !!options.tools : true,
    searchResources: !!options.resources,
    searchPrompts: !!options.prompts,
  };
}

/**
 * Search a single MCP client for matching items
 */
async function searchClient(
  client: IMcpClient,
  matcher: (text: string) => boolean,
  options: GrepOptions
): Promise<GrepResult> {
  const { searchTools, searchResources, searchPrompts } = getSearchTypes(options);

  // Fetch all lists in parallel (only the types we need)
  const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
    searchTools ? client.listAllTools() : null,
    searchResources ? fetchAllResources(client) : null,
    searchPrompts ? fetchAllPrompts(client) : null,
  ]);

  // Filter tools
  const matchedTools = (toolsResult?.tools ?? []).filter(
    (t) => matcher(t.name) || (t.description && matcher(t.description))
  );

  // Filter resources (also match on URI)
  const matchedResources = (resourcesResult ?? []).filter(
    (r) =>
      matcher(r.uri) || (r.name && matcher(r.name)) || (r.description && matcher(r.description))
  );

  // Filter prompts
  const matchedPrompts = (promptsResult ?? []).filter(
    (p) => matcher(p.name) || (p.description && matcher(p.description))
  );

  return {
    tools: matchedTools,
    resources: matchedResources,
    prompts: matchedPrompts,
  };
}

/**
 * Fetch all resources with pagination
 */
async function fetchAllResources(client: IMcpClient): Promise<Resource[]> {
  const all: Resource[] = [];
  let cursor: string | undefined;
  do {
    const result = await client.listResources(cursor);
    all.push(...result.resources);
    cursor = result.nextCursor;
  } while (cursor);
  return all;
}

/**
 * Fetch all prompts with pagination
 */
async function fetchAllPrompts(client: IMcpClient): Promise<Prompt[]> {
  const all: Prompt[] = [];
  let cursor: string | undefined;
  do {
    const result = await client.listPrompts(cursor);
    all.push(...result.prompts);
    cursor = result.nextCursor;
  } while (cursor);
  return all;
}

// ─── Output formatting ──────────────────────────────────────────────

function countMatches(result: GrepResult): number {
  return result.tools.length + result.resources.length + result.prompts.length;
}

/**
 * Format a single tool as a compact bullet line (same style as tools-list)
 */
function formatToolLine(tool: Tool): string {
  const bullet = chalk.dim('*');
  const params = formatToolParamsInline(tool.inputSchema as Record<string, unknown>);
  const parts: string[] = [];
  const annotationsStr = formatToolAnnotations(tool.annotations);
  if (annotationsStr) parts.push(annotationsStr);
  const toolAny = tool as Record<string, unknown>;
  const execution = toolAny.execution as Record<string, unknown> | undefined;
  const taskSupport = execution?.taskSupport as string | undefined;
  if (taskSupport) parts.push(`task:${taskSupport}`);
  const suffix = parts.length > 0 ? ` ${chalk.gray(`[${parts.join(', ')}]`)}` : '';
  return `${bullet} ${grayBacktick()}${chalk.cyan(tool.name)}${params}${grayBacktick()}${suffix}`;
}

/**
 * Format a single resource as a compact bullet line
 */
function formatResourceLine(resource: Resource): string {
  const bullet = chalk.dim('*');
  return `${bullet} ${inBackticks(resource.uri)}`;
}

/**
 * Format a single prompt as a compact bullet line
 */
function formatPromptLine(prompt: Prompt): string {
  const bullet = chalk.dim('*');
  return `${bullet} ${inBackticks(prompt.name)}`;
}

/**
 * Format a grep result section (tools/resources/prompts) with a type header
 */
function formatResultSection(
  label: string,
  items: unknown[],
  formatLine: (item: never) => string,
  indent: string
): string[] {
  if (items.length === 0) return [];
  const lines: string[] = [];
  lines.push(`${indent}${chalk.bold(`${label} (${items.length}):`)}`);
  for (const item of items) {
    lines.push(`${indent}  ${formatLine(item as never)}`);
  }
  return lines;
}

/**
 * Format human output for a single session's grep results
 */
function formatGrepResultHuman(result: GrepResult, indent: string = ''): string[] {
  const lines: string[] = [];
  lines.push(
    ...formatResultSection('Tools', result.tools, formatToolLine as (item: never) => string, indent)
  );
  lines.push(
    ...formatResultSection(
      'Resources',
      result.resources,
      formatResourceLine as (item: never) => string,
      indent
    )
  );
  lines.push(
    ...formatResultSection(
      'Prompts',
      result.prompts,
      formatPromptLine as (item: never) => string,
      indent
    )
  );
  return lines;
}

// ─── Single-session grep ─────────────────────────────────────────────

/**
 * Search a single session for matching tools, resources, and prompts.
 * Returns exit code (0 = matches found, 1 = no matches).
 */
export async function grepSession(
  session: string,
  pattern: string,
  options: GrepOptions
): Promise<number> {
  const matcher = buildMatcher(pattern, options);

  return await withMcpClient(session, options, async (client) => {
    const result = await searchClient(client, matcher, options);
    const total = countMatches(result);

    if (options.outputMode === 'json') {
      console.log(
        formatJson({
          tools: result.tools,
          resources: result.resources,
          prompts: result.prompts,
          totalMatches: total,
        })
      );
    } else {
      if (total === 0) {
        console.log('No matches found.');
      } else {
        const lines = formatGrepResultHuman(result);
        lines.push('');
        lines.push(chalk.dim(`${total} ${total === 1 ? 'match' : 'matches'}.`));
        console.log(lines.join('\n'));
      }
    }

    return total > 0 ? 0 : 1;
  });
}

// ─── Multi-session grep ──────────────────────────────────────────────

/**
 * Search all active sessions for matching tools, resources, and prompts.
 * Returns exit code (0 = matches found, 1 = no matches).
 */
export async function grepAllSessions(pattern: string, options: GrepOptions): Promise<number> {
  const matcher = buildMatcher(pattern, options);

  // Load active sessions
  const { sessions } = await consolidateSessions(false);
  const sessionEntries = Object.values(sessions).filter((s) => s.pid && isProcessAlive(s.pid));

  if (sessionEntries.length === 0) {
    if (options.outputMode === 'json') {
      console.log(formatJson({ results: [], errors: [], totalMatches: 0 }));
    } else {
      console.log(chalk.bold('No active sessions.'));
      console.log(chalk.dim('  \u21B3 run: mcpc connect mcp.example.com @test'));
    }
    return 1;
  }

  // Ensure session name has @ prefix
  const toSessionRef = (name: string): string => (name.startsWith('@') ? name : `@${name}`);

  // Query all sessions in parallel
  const settled = await Promise.allSettled(
    sessionEntries.map(async (session): Promise<SessionGrepResult> => {
      const sessionName = toSessionRef(session.name);
      const result = await withSessionClient(sessionName, async (client) => {
        return searchClient(client, matcher, options);
      });
      return {
        session: sessionName,
        ...result,
      };
    })
  );

  // Separate successes and failures
  const results: SessionGrepResult[] = [];
  const errors: SessionGrepError[] = [];

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === 'fulfilled') {
      const r = outcome.value;
      // Only include sessions with matches
      if (countMatches(r) > 0) {
        results.push(r);
      }
    } else {
      const reason: unknown = outcome.reason;
      errors.push({
        session: toSessionRef(sessionEntries[i]!.name),
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  const totalMatches = results.reduce((sum, r) => sum + countMatches(r), 0);

  if (options.outputMode === 'json') {
    const jsonOutput: Record<string, unknown> = {
      results: results.map((r) => ({
        session: r.session,
        tools: r.tools,
        resources: r.resources,
        prompts: r.prompts,
      })),
      totalMatches,
    };
    if (errors.length > 0) {
      jsonOutput.errors = errors;
    }
    console.log(formatJson(jsonOutput));
  } else {
    const lines: string[] = [];

    for (const r of results) {
      const matchCount = countMatches(r);
      lines.push(
        `${chalk.cyan(r.session)} ${chalk.dim(`(${matchCount} ${matchCount === 1 ? 'match' : 'matches'})`)}`
      );
      lines.push(...formatGrepResultHuman(r, '  '));
      lines.push('');
    }

    // Show warnings for failed sessions
    for (const err of errors) {
      lines.push(chalk.yellow(`Warning: ${err.session} \u2014 ${err.error}`));
    }

    if (totalMatches === 0) {
      console.log('No matches found.');
    } else {
      const sessionCount = results.length;
      lines.push(
        chalk.dim(
          `${totalMatches} ${totalMatches === 1 ? 'match' : 'matches'} across ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}.`
        )
      );
      console.log(lines.join('\n'));
    }
  }

  return totalMatches > 0 ? 0 : 1;
}
