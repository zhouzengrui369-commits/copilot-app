/**
 * WikilinkHandler — unit tests for the parser.
 *
 * Pure-function tests; no React, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import { extractWikilinks, splitByWikilinks } from '../src/renderer/components/NoteDetail/WikilinkHandler.js';

describe('extractWikilinks', () => {
  it('returns an empty array for text without links', () => {
    expect(extractWikilinks('Hello world.')).toEqual([]);
    expect(extractWikilinks('')).toEqual([]);
  });

  it('parses a single [[path]] link', () => {
    const [tok] = extractWikilinks('See [[notes/a]] for more.');
    expect(tok?.label).toBe('notes/a');
    expect(tok?.target).toBe('notes/a');
    expect(tok?.start).toBe(4);
  });

  it('parses a single [[path|alias]] link with the alias as label', () => {
    const [tok] = extractWikilinks('See [[notes/a|the A note]] for more.');
    expect(tok?.label).toBe('the A note');
    expect(tok?.target).toBe('notes/a');
  });

  it('parses multiple links in document order', () => {
    const toks = extractWikilinks('[[a]] then [[b|alias]] then [[c]]');
    expect(toks.map((t) => t.target)).toEqual(['a', 'b', 'c']);
    expect(toks.map((t) => t.label)).toEqual(['a', 'alias', 'c']);
  });

  it('skips unterminated or empty [[]]', () => {
    expect(extractWikilinks('empty [[]] and stray [[ not closed')).toEqual([]);
  });

  it('returns no match for malformed brackets with a stray inner `]`', () => {
    // `[[a[b]c]]` is malformed because paths cannot contain `[` or `]`.
    // The regex correctly returns zero tokens rather than trying to
    // balance brackets — paths are intentionally restricted.
    const toks = extractWikilinks('[[a[b]c]] is weird');
    expect(toks.length).toBe(0);
  });
});

describe('splitByWikilinks', () => {
  it('returns the original text when there are no links', () => {
    expect(splitByWikilinks('plain text')).toEqual([{ kind: 'text', text: 'plain text' }]);
  });

  it('interleaves text and wikilink fragments in order', () => {
    const parts = splitByWikilinks('pre [[x]] mid [[y|alias]] post');
    expect(parts).toEqual([
      { kind: 'text', text: 'pre ' },
      {
        kind: 'wikilink',
        token: expect.objectContaining({ label: 'x', target: 'x' }),
      },
      { kind: 'text', text: ' mid ' },
      {
        kind: 'wikilink',
        token: expect.objectContaining({ label: 'alias', target: 'y' }),
      },
      { kind: 'text', text: ' post' },
    ]);
  });
});
