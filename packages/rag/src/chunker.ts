/**
 * Note chunker — Sprint 1.3 T-1.3.1 wave 2.
 *
 * Splits a note body into chunks of roughly ≤ `maxTokens` tokens,
 * paragraph-bounded (we never split inside a paragraph). The default
 * 512 tokens matches common RAG tutorial defaults (LangChain
 * RecursiveCharacterTextSplitter) and fits comfortably inside bge-m3 /
 * MiniMax-M3 context windows.
 *
 * Token count is heuristic (whitespace-split) — accurate enough for sizing,
 * intentionally simple to keep this layer free of tokenizer libs.
 *
 * Output is a list of NoteChunk records with stable `charRange` offsets so
 * the UI can highlight the exact source range when answering (Sprint 1.3
 * follow-up).  Chunks always carry the originating `notePath` so retrieval
 * can surface it as a citation (goal.md R5 "sources 显示").
 */

import type { NoteChunk } from './types.js';

export interface ChunkerConfig {
  /** hard cap per chunk, default 512 tokens (whitespace-split heuristic) */
  maxTokens?: number;
  /** soft cap — chunks smaller than this merge with the next short paragraph */
  minTokens?: number;
}

const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_MIN_TOKENS = 32;

/**
 * Rough heuristic token count. We deliberately don't pull in a tokenizer
 * library — Sprint 1.3 workers stay 0-dep outside sql.js.
 *
 * Splits on whitespace + counts tokens >= 1 char. For CJK text this is a
 * bad estimate (it counts each character as a token), but it's still a
 * safe upper bound on chunk size — exactly the property chunkers need.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // collapse runs of whitespace
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

/**
 * Split a note body into NoteChunks. Paragraphs are detected by blank lines.
 *
 * Algorithm:
 *   1. Split body on /\n\s*\n/ into paragraphs.
 *   2. Walk paragraphs; accumulate until `maxTokens` is reached.
 *   3. If a single paragraph exceeds `maxTokens`, hard-split on sentence
 *      boundary (。！？. ! ?) — last-resort to avoid losing that paragraph.
 *   4. Emit NoteChunk with ordinal, charRange offsets, and tokenCount.
 */
export function chunkNote(
  body: string,
  notePath: string,
  config: ChunkerConfig = {},
): NoteChunk[] {
  const max = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  // `minTokens: 0` (or any value < 0) explicitly disables the trailing-
  // chunk merge step. Default 32 keeps small trailing sections merged.
  const minRaw = config.minTokens ?? DEFAULT_MIN_TOKENS;
  const min = minRaw > 0 ? minRaw : 0;
  if (max <= 0) throw new Error('chunker: maxTokens must be > 0');

  const chunks: NoteChunk[] = [];
  let ordinal = 0;

  // Track offsets in the ORIGINAL body string (don't trim; we want real
  // char offsets so the UI can highlight the cited range).
  let cursor = 0;

  const paragraphs = splitParagraphs(body);

  let buffer: { text: string; start: number; tokens: number } | null = null;
  const flush = (): void => {
    if (!buffer) return;
    chunks.push({
      id: generateStableId(notePath, ordinal),
      notePath,
      ordinal,
      text: buffer.text.trim(),
      tokenCount: buffer.tokens,
      charRange: [buffer.start, buffer.start + buffer.text.length],
    });
    ordinal += 1;
    buffer = null;
  };

  for (let i = 0; i < paragraphs.length; i += 1) {
    const p = paragraphs[i];
    if (!p) continue;
    const pStart = body.indexOf(p.text, cursor);
    if (pStart < 0) continue;
    cursor = pStart + p.text.length;
    const pTokens = estimateTokens(p.text);

    if (pTokens > max) {
      // oversize paragraph — flush whatever we had, then sentence-split this one
      flush();
      const sentences = splitSentences(p.text);
      let sCursor = pStart;
      for (const sentence of sentences) {
        const sTokens = estimateTokens(sentence);
        if (buffer && buffer.tokens + sTokens > max) flush();
        if (!buffer) {
          buffer = { text: sentence, start: sCursor, tokens: sTokens };
        } else {
          buffer.text += '\n' + sentence;
          buffer.tokens += sTokens;
        }
        sCursor += sentence.length + 1; // +1 for newline
      }
      // possibly oversize single sentence — keep as one chunk
      flush();
      continue;
    }

    if (buffer && buffer.tokens + pTokens > max) {
      flush();
    }

    if (!buffer) {
      buffer = { text: p.text, start: pStart, tokens: pTokens };
    } else {
      buffer.text += '\n\n' + p.text;
      buffer.tokens += pTokens;
    }
  }
  flush();

  // tiny chunk merge: if last chunk < minTokens and we have ≥ 2 chunks,
  // merge last into previous. Keeps small trailing sections together.
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (last && prev && last.tokenCount < min && last.tokenCount > 0) {
      const mergedText = prev.text + '\n\n' + last.text;
      const mergedStart = prev.charRange[0];
      const mergedEnd = last.charRange[1];
      const mergedTokens = prev.tokenCount + last.tokenCount;
      chunks.splice(chunks.length - 2, 2, {
        ...prev,
        text: mergedText.trim(),
        tokenCount: mergedTokens,
        charRange: [mergedStart, mergedEnd],
      });
    }
  }

  // re-issue ids in ordinal order to be safe after merge
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    if (c) {
      chunks[i] = { ...c, id: generateStableId(notePath, i), ordinal: i };
    }
  }

  return chunks;
}

interface Paragraph {
  text: string;
}

function splitParagraphs(body: string): Paragraph[] {
  // keep delimiters OFF the matched text (we reconstruct offsets from
  // body.indexOf, which expects the paragraph text verbatim)
  const parts = body.split(/\n\s*\n/);
  return parts
    .map((t) => ({ text: t.replace(/^\s+|\s+$/g, '') }))
    .filter((p) => p.text.length > 0);
}

/**
 * Sentence splitter that handles CJK + ASCII terminators. Last-resort split —
 * only invoked when a single paragraph exceeds maxTokens.
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  // Match . ! ? 。！？ with optional trailing quotes / whitespace
  const re = /[^。！？.!?\n]+[。！？.!?]?/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const seg = m[0];
    if (seg && seg.trim().length > 0) {
      out.push(seg);
    }
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  if (out.length === 0 && text.trim().length > 0) {
    out.push(text);
  }
  return out;
}

/**
 * Deterministic id — `notePath:ordinal`. Survives re-indexing as long as
 * chunk ordinal order is preserved (which is the contract).
 */
function generateStableId(notePath: string, ordinal: number): string {
  // replace ':' (would clash with our separator) but keep it readable
  return `${notePath.replace(/:/g, '_')}#${ordinal}`;
}
