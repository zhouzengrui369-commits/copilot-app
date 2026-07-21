/**
 * 2026-06-24 — Mobile priority UI: lightweight HTML→block renderer.
 *
 * The Mate60 build is React Native 0.85 without `react-native-webview`,
 * and the contract forbids changing build config / dependencies. We therefore
 * render HTML in pure RN by stripping dangerous blocks and walking the
 * remaining structure block-by-block. The goal is "readable on a phone", not
 * a full browser; the user can still toggle to raw source via the editor.
 *
 * This is intentionally a best-effort renderer, not a standards-compliant
 * HTML parser. It handles the common cases: headings, paragraphs, lists,
 * links, inline emphasis, code blocks, blockquotes, and horizontal rules.
 */

export type HtmlBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

const SKIP_BLOCKS = [
  /<script\b[^>]*>[\s\S]*?<\/script>/gi,
  /<style\b[^>]*>[\s\S]*?<\/style>/gi,
  /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
  /<head\b[^>]*>[\s\S]*?<\/head>/gi,
  /<!--[\s\S]*?-->/g,
];

function decodeEntities(input: string): string {
  if (!input) return input;
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&copy;/g, "©")
    .replace(/&amp;/g, "&");
}

function stripTags(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ");
}

function inlineToText(input: string): string {
  return stripTags(input)
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function splitBlocks(input: string): string[] {
  // 1. 把块级标签的开闭替换为块分隔符
  let normalized = input;
  for (const re of SKIP_BLOCKS) normalized = normalized.replace(re, "");
  normalized = normalized
    .replace(/<\/?(p|div|section|article|main|aside|header|footer|nav|li|tr|blockquote|pre|h[1-6])\b[^>]*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
  // 2. 切块
  return normalized
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function parseBlock(block: string): HtmlBlock | null {
  const trimmed = block.trim();
  if (!trimmed) return null;
  if (trimmed === "---") return { kind: "rule" };

  // heading
  const heading = trimmed.match(/^<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>$/i);
  if (heading) {
    const level = Math.min(6, Math.max(1, parseInt(heading[1], 10))) as 1 | 2 | 3 | 4 | 5 | 6;
    return { kind: "heading", level, text: inlineToText(heading[2]) };
  }

  // list
  const listOpen = trimmed.match(/^<(ul|ol)\b[^>]*>([\s\S]*)<\/\1>$/i);
  if (listOpen) {
    const tag = listOpen[1].toLowerCase();
    const inner = listOpen[2];
    const items = Array.from(inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)).map((m) => inlineToText(m[1])).filter(Boolean);
    if (items.length) return { kind: "list", ordered: tag === "ol", items };
  }

  // pre/code
  const preBlock = trimmed.match(/^<pre\b[^>]*>([\s\S]*?)<\/pre>$/i);
  if (preBlock) {
    const codeMatch = preBlock[1].match(/^<code\b[^>]*>([\s\S]*?)<\/code>$/i);
    return { kind: "code", text: inlineToText(codeMatch ? codeMatch[1] : preBlock[1]) };
  }

  // blockquote
  const quote = trimmed.match(/^<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>$/i);
  if (quote) {
    return { kind: "quote", text: inlineToText(quote[1]) };
  }

  // paragraph
  if (/^<(p|div|section|article|main|aside|header|footer|nav)\b/i.test(trimmed)) {
    return { kind: "paragraph", text: inlineToText(trimmed) };
  }

  // raw text
  const text = inlineToText(trimmed);
  if (text) return { kind: "paragraph", text };
  return null;
}

const MAX_PREVIEW_BLOCKS = 40;

export function parseHtml(input: string): HtmlBlock[] {
  if (!input) return [];
  const blocks: HtmlBlock[] = [];
  for (const chunk of splitBlocks(input)) {
    const parsed = parseBlock(chunk);
    if (parsed) blocks.push(parsed);
    if (blocks.length >= MAX_PREVIEW_BLOCKS) {
      blocks.push({
        kind: "paragraph",
        text: "…后续内容较长,请切换到源码查看完整 HTML",
      });
      break;
    }
  }
  return blocks;
}

export function stripHtml(input: string): string {
  if (!input) return "";
  const blocks = parseHtml(input);
  return blocks
    .map((block) => {
      if (block.kind === "heading") return `\n${block.text}\n`;
      if (block.kind === "list") return block.items.map((i) => `• ${i}`).join("\n");
      if (block.kind === "quote") return `「${block.text}」`;
      if (block.kind === "rule") return "---";
      if (block.kind === "code") return block.text;
      return block.text;
    })
    .join("\n\n")
    .trim();
}
