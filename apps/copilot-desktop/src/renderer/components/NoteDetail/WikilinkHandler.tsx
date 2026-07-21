/**
 * WikilinkHandler — parses `[[note_path]]` tokens from raw markdown
 * text into structured tokens the React renderer can turn into
 * clickable links.
 *
 * Why hand-rolled: the popular `remark-wiki-link` plugin pulls in a
 * large micromark extension tree and we only need a single regex
 * pass for the desktop preview. We intentionally treat the content
 * inside the brackets as opaque (no nested parsing) to keep the
 * surface small and XSS-safe.
 */

export interface WikilinkToken {
  /** The visible text (alias if `[[path|alias]]`, else the path). */
  label: string;
  /** The note path to navigate to when the link is clicked. */
  target: string;
  /** Start index of the match in the original text. */
  start: number;
  /** End index of the match (exclusive) in the original text. */
  end: number;
}

/**
 * Match `[[path]]` or `[[path|alias]]`. Path cannot contain `]` or `|`.
 * The regex is intentionally non-greedy and stops at the first `]]`.
 */
const WIKILINK_RE = /\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

/**
 * Extract every wikilink occurrence from a markdown string. Returns
 * an empty array when no wikilinks are present. Order matches the
 * text scan order so callers can reconstruct the document.
 */
export function extractWikilinks(markdown: string): WikilinkToken[] {
  if (!markdown) return [];
  const out: WikilinkToken[] = [];
  for (const match of markdown.matchAll(WIKILINK_RE)) {
    const target = match[1]?.trim();
    if (!target) continue;
    const alias = match[2]?.trim();
    const label = alias && alias.length > 0 ? alias : target;
    out.push({
      label,
      target,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return out;
}

/**
 * Split a markdown string around wikilink tokens so the renderer
 * can interleave plain text + clickable spans. Useful when you want
 * to wrap links in custom UI (e.g. badges) without re-running the
 * full markdown pipeline.
 */
export function splitByWikilinks(
  markdown: string,
): Array<{ kind: 'text'; text: string } | { kind: 'wikilink'; token: WikilinkToken }> {
  const tokens = extractWikilinks(markdown);
  if (tokens.length === 0) return [{ kind: 'text', text: markdown }];
  const out: Array<
    { kind: 'text'; text: string } | { kind: 'wikilink'; token: WikilinkToken }
  > = [];
  let cursor = 0;
  for (const tok of tokens) {
    if (tok.start > cursor) {
      out.push({ kind: 'text', text: markdown.slice(cursor, tok.start) });
    }
    out.push({ kind: 'wikilink', token: tok });
    cursor = tok.end;
  }
  if (cursor < markdown.length) {
    out.push({ kind: 'text', text: markdown.slice(cursor) });
  }
  return out;
}
