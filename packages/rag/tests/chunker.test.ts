/**
 * Chunker unit tests (Sprint 1.3 T-1.3.1 wave 2).
 *
 * Pure-function tests — no Ollama, no VectorStore.
 */

import { describe, expect, it } from 'vitest';
import { chunkNote, estimateTokens } from '../src/chunker.js';

describe('estimateTokens', () => {
  it('returns 0 on empty / whitespace-only', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('   \n\t  ')).toBe(0);
  });

  it('splits on whitespace and counts tokens', () => {
    expect(estimateTokens('hello world')).toBe(2);
    expect(estimateTokens('  hello   world  foo  ')).toBe(3);
  });

  it('returns 1 for CJK without spaces (heuristic treats as one chunk)', () => {
    // Our heuristic splits on whitespace only. CJK strings without spaces
    // are treated as ONE chunk, which is a known upper-bound weakness of
    // the heuristic — see SCHEMA-FROZEN-1.2.md §5. Operators can replace
    // this with a real tokenizer (gpt-tokenizer / cl100k) when needed.
    expect(estimateTokens('你好世界')).toBe(1);
  });
});

describe('chunkNote', () => {
  it('returns one chunk for a short body', () => {
    const body = '短正文。';
    const chunks = chunkNote(body, 'inbox/a');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.notePath).toBe('inbox/a');
    expect(chunks[0]?.text).toBe(body.trim());
    expect(chunks[0]?.ordinal).toBe(0);
  });

  it('keeps paragraphs intact when under maxTokens', () => {
    const body = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    // maxTokens=2 (each paragraph is 2 tokens) forces each paragraph into its own chunk.
    // minTokens: 0 disables the trailing-chunk merge so each stands alone.
    const chunks = chunkNote(body, 'inbox/multi', { maxTokens: 2, minTokens: 0 });
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.text).toBe('First paragraph.');
    expect(chunks[1]?.text).toBe('Second paragraph.');
    expect(chunks[2]?.text).toBe('Third paragraph.');
    expect(body.substring(chunks[0]!.charRange[0], chunks[0]!.charRange[1])).toBe('First paragraph.');
  });

  it('packs paragraphs up to maxTokens then flushes', () => {
    // 4 paragraphs × 4 words = 16 words total
    const body = 'a a a a\n\nb b b b\n\nc c c c\n\nd d d d';
    const chunks = chunkNote(body, 'inbox/pack', { maxTokens: 10, minTokens: 0 });
    // 4 paragraphs × 4 words = 16 words; maxTokens=10 → two chunks: [8w, 8w]
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.length).toBeLessThanOrEqual(4);
    const joined = chunks.map((c) => c.text).join(' ');
    // every paragraph should be preserved exactly
    expect(joined).toContain('a a a a');
    expect(joined).toContain('b b b b');
    expect(joined).toContain('c c c c');
    expect(joined).toContain('d d d d');
  });

  it('handles oversize paragraph by sentence-splitting', () => {
    const longSent = 'This is sentence one. '.repeat(60).trim(); // ~ 60*4 = 240 words
    const chunks = chunkNote(longSent, 'inbox/big', { maxTokens: 30, minTokens: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.notePath).toBe('inbox/big');
  });

  it('emits ordinals 0..N-1 in order, with stable ids', () => {
    const body = 'a\n\nb\n\nc\n\nd';
    const chunks = chunkNote(body, 'calendar/2026-07-10', { maxTokens: 2 });
    const ordinals = chunks.map((c) => c.ordinal);
    expect(ordinals).toEqual(ordinals.map((_, i) => i));
    const ids = chunks.map((c) => c.id);
    expect(ids).toContain('calendar/2026-07-10#0');
    if (chunks.length > 1) {
      expect(ids[1]).toBe('calendar/2026-07-10#1');
    }
  });

  it('survives 0-paragraph input', () => {
    const chunks = chunkNote('   \n\n\n   ', 'inbox/empty');
    expect(chunks).toEqual([]);
  });
});
