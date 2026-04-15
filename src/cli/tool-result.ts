/**
 * Utility functions for handling MCP tool results
 */

/**
 * If `data` is a tool call result whose `content` is a non-empty array
 * containing only `type: "text"` items, return the texts joined with
 * newlines. Otherwise return undefined.
 *
 * When this returns a string, the caller should render only the text and
 * skip `structuredContent` — the text representation already contains the
 * canonical, human-readable view.
 */
export function extractAllTextContent(data: unknown): string | undefined {
  if (
    !data ||
    typeof data !== 'object' ||
    !('content' in data) ||
    !Array.isArray((data as Record<string, unknown>).content)
  ) {
    return undefined;
  }

  const content = (data as Record<string, unknown>).content as unknown[];
  if (content.length === 0) return undefined;

  const texts: string[] = [];
  for (const item of content) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('type' in item) ||
      (item as Record<string, unknown>).type !== 'text' ||
      typeof (item as Record<string, unknown>).text !== 'string'
    ) {
      return undefined;
    }
    texts.push((item as Record<string, unknown>).text as string);
  }

  return texts.join('\n');
}
