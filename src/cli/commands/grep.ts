/**
 * Grep command handler - search tools, resources, and prompts
 */

import chalk from 'chalk';
import type { Tool, Resource, Prompt, CommandOptions, SessionData } from '../../lib/types.js';
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
import { getBridgeStatus, formatBridgeStatus } from './sessions.js';

export interface GrepOptions extends CommandOptions {
  tools?: boolean | undefined;
  resources?: boolean | undefined;
  prompts?: boolean | undefined;
  regex?: boolean | undefined;
  caseSensitive?: boolean | undefined;
  maxResults?: number | undefined;
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

interface SessionGrepSkipped {
  session: string;
  status: string;
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
 * Build the searchable text for a tool, including session context.
 * Format: "@session/tool-name <JSON schema>"
 */
function buildToolSearchText(tool: Tool, sessionName: string): string {
  return `${sessionName}/${tool.name} ${JSON.stringify(tool, null, 2)}`;
}

/**
 * Build the searchable text for a resource, including session context.
 * Format: "@session/resource-uri <JSON schema>"
 */
function buildResourceSearchText(resource: Resource, sessionName: string): string {
  return `${sessionName}/${resource.uri} ${JSON.stringify(resource, null, 2)}`;
}

/**
 * Build the searchable text for a prompt, including session context.
 * Format: "@session/prompt-name <JSON schema>"
 */
function buildPromptSearchText(prompt: Prompt, sessionName: string): string {
  return `${sessionName}/${prompt.name} ${JSON.stringify(prompt, null, 2)}`;
}

/**
 * Search a single MCP client for matching items
 */
async function searchClient(
  client: IMcpClient,
  matcher: (text: string) => boolean,
  options: GrepOptions,
  sessionName: string = ''
): Promise<GrepResult> {
  const { searchTools, searchResources, searchPrompts } = getSearchTypes(options);

  // Fetch all lists in parallel (only the types we need)
  const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
    searchTools ? client.listAllTools() : null,
    searchResources ? fetchAllResources(client) : null,
    searchPrompts ? fetchAllPrompts(client) : null,
  ]);

  // Filter tools
  const matchedTools = (toolsResult?.tools ?? []).filter((t) =>
    matcher(buildToolSearchText(t, sessionName))
  );

  // Filter resources
  const matchedResources = (resourcesResult ?? []).filter((r) =>
    matcher(buildResourceSearchText(r, sessionName))
  );

  // Filter prompts
  const matchedPrompts = (promptsResult ?? []).filter((p) =>
    matcher(buildPromptSearchText(p, sessionName))
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
 * Truncate a GrepResult to at most `limit` total items (tools first, then resources, then prompts).
 * Returns the truncated result and how many items were dropped.
 */
function truncateResult(
  result: GrepResult,
  limit: number
): { result: GrepResult; truncated: number } {
  const total = countMatches(result);
  if (total <= limit) return { result, truncated: 0 };

  let remaining = limit;
  const tools = result.tools.slice(0, remaining);
  remaining -= tools.length;
  const resources = result.resources.slice(0, remaining);
  remaining -= resources.length;
  const prompts = result.prompts.slice(0, remaining);

  return {
    result: { tools, resources, prompts },
    truncated: total - limit,
  };
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

  const sessionRef = session.startsWith('@') ? session : `@${session}`;

  return await withMcpClient(session, options, async (client) => {
    const fullResult = await searchClient(client, matcher, options, sessionRef);
    const total = countMatches(fullResult);

    const { result, truncated } =
      options.maxResults != null
        ? truncateResult(fullResult, options.maxResults)
        : { result: fullResult, truncated: 0 };

    if (options.outputMode === 'json') {
      const jsonOutput: Record<string, unknown> = {
        tools: result.tools,
        resources: result.resources,
        prompts: result.prompts,
        totalMatches: total,
      };
      if (truncated > 0) {
        jsonOutput.truncated = truncated;
      }
      console.log(formatJson(jsonOutput));
    } else {
      if (total === 0) {
        console.log('No matches found.');
      } else {
        const lines = formatGrepResultHuman(result);
        lines.push('');
        const suffix = truncated > 0 ? ` (showing ${countMatches(result)})` : '';
        lines.push(chalk.dim(`${total} ${total === 1 ? 'match' : 'matches'}${suffix}.`));
        console.log(lines.join('\n'));
      }
    }

    return total > 0 ? 0 : 1;
  });
}

// ─── Multi-session grep ──────────────────────────────────────────────

/**
 * Format a skipped (unavailable) session line for human output.
 * Example: "@testx ○ crashed"
 */
function formatSkippedSession(skipped: SessionGrepSkipped): string {
  const { dot, text } = formatBridgeStatus(skipped.status as 'crashed');
  return `${chalk.cyan(skipped.session)} ${dot} ${text}`;
}

/**
 * Determine if a session is queryable (bridge process alive)
 */
function isSessionQueryable(session: SessionData): boolean {
  return !!session.pid && isProcessAlive(session.pid);
}

/**
 * Search all sessions for matching tools, resources, and prompts.
 * Shows unavailable sessions with their status.
 * Returns exit code (0 = matches found, 1 = no matches).
 */
export async function grepAllSessions(pattern: string, options: GrepOptions): Promise<number> {
  const matcher = buildMatcher(pattern, options);

  // Load all sessions
  const { sessions } = await consolidateSessions(false);
  const allSessionEntries = Object.values(sessions);

  if (allSessionEntries.length === 0) {
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

  // Separate queryable sessions from unavailable ones
  const queryableSessions: SessionData[] = [];
  const skippedSessions: SessionGrepSkipped[] = [];

  for (const session of allSessionEntries) {
    if (isSessionQueryable(session)) {
      queryableSessions.push(session);
    } else {
      const status = getBridgeStatus(session);
      skippedSessions.push({
        session: toSessionRef(session.name),
        status,
      });
    }
  }

  // Query all queryable sessions in parallel
  const settled = await Promise.allSettled(
    queryableSessions.map(async (session): Promise<SessionGrepResult> => {
      const sessionName = toSessionRef(session.name);
      const result = await withSessionClient(sessionName, async (client) => {
        return searchClient(client, matcher, options, sessionName);
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
        session: toSessionRef(queryableSessions[i]!.name),
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  const totalMatches = results.reduce((sum, r) => sum + countMatches(r), 0);

  // Apply max-results limit across all sessions
  let displayResults = results;
  let totalTruncated = 0;
  if (options.maxResults != null) {
    let remaining = options.maxResults;
    displayResults = [];
    for (const r of results) {
      if (remaining <= 0) {
        totalTruncated += countMatches(r);
        continue;
      }
      const { result: truncR, truncated } = truncateResult(r, remaining);
      remaining -= countMatches(truncR);
      totalTruncated += truncated;
      displayResults.push({ ...r, ...truncR });
    }
  }

  if (options.outputMode === 'json') {
    const jsonOutput: Record<string, unknown> = {
      results: displayResults.map((r) => ({
        session: r.session,
        tools: r.tools,
        resources: r.resources,
        prompts: r.prompts,
      })),
      totalMatches,
    };
    if (totalTruncated > 0) {
      jsonOutput.truncated = totalTruncated;
    }
    if (errors.length > 0) {
      jsonOutput.errors = errors;
    }
    if (skippedSessions.length > 0) {
      jsonOutput.skipped = skippedSessions;
    }
    console.log(formatJson(jsonOutput));
  } else {
    const lines: string[] = [];

    // Show unavailable sessions first
    for (const skipped of skippedSessions) {
      lines.push(formatSkippedSession(skipped));
    }

    for (const r of displayResults) {
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

    if (totalMatches === 0 && skippedSessions.length === 0) {
      console.log('No matches found.');
    } else {
      if (totalMatches > 0) {
        const sessionCount = results.length;
        const showing = totalMatches - totalTruncated;
        const suffix = totalTruncated > 0 ? ` (showing ${showing})` : '';
        lines.push(
          chalk.dim(
            `${totalMatches} ${totalMatches === 1 ? 'match' : 'matches'} across ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}${suffix}.`
          )
        );
      } else if (lines.length > 0) {
        lines.push('');
        lines.push('No matches found.');
      }
      console.log(lines.join('\n'));
    }
  }

  return totalMatches > 0 ? 0 : 1;
}
