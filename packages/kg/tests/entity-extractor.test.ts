/**
 * EntityExtractor tests (wave 1 — 3 cases per T-1.2.1 contract).
 *
 * Covers parseEntityResponse + EntityExtractor over:
 *   1. person extraction (Chinese name)
 *   2. org extraction
 *   3. concept extraction (multi-entity note)
 */

import { describe, it, expect } from 'vitest';
import {
  buildEntityExtractionPrompt,
  parseEntityResponse,
  makeEntityId,
  EntityExtractor,
} from '../src/builder/entity-extractor.js';
import type { LLMProvider, ChatRequest, ChatResponse } from '@copilot/llm-client';

class StubLLM implements LLMProvider {
  readonly name = 'stub-llm';
  /** Last request the extractor sent — useful for assertions. */
  public lastRequest: ChatRequest | undefined;
  constructor(public readonly reply: string) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.lastRequest = req;
    return {
      content: this.reply,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: 'stub',
      finishReason: 'stop',
    };
  }
  async *chatStream() {
    yield { delta: this.reply, finishReason: 'stop' as const };
  }
  countTokens() {
    return 0;
  }
}

describe('makeEntityId', () => {
  it('normalises ASCII names with whitespace and dashes', () => {
    expect(makeEntityId('person', 'Marie Curie')).toBe('person:marie-curie');
    expect(makeEntityId('person', 'Alan  Turing')).toBe('person:alan-turing');
    expect(makeEntityId('person', 'Ada--Lovelace')).toBe('person:ada-lovelace');
    expect(makeEntityId('person', '  unknown  ')).toBe('person:unknown');
    expect(makeEntityId('person', '')).toBe('person:unnamed');
  });

  it('preserves normalized CJK names so distinct entities do not collapse', () => {
    expect(makeEntityId('person', '张三')).toBe('person:张三');
    expect(makeEntityId('org', '腾讯')).toBe('org:腾讯');
  });
});

describe('buildEntityExtractionPrompt', () => {
  it('produces system + user messages with title and body', () => {
    const msgs = buildEntityExtractionPrompt({
      note_path: 'inbox/test',
      note_title: 'Test note',
      note_body: 'Foo bar',
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[1]?.role).toBe('user');
    expect(msgs[1]?.content).toContain('Test note');
    expect(msgs[1]?.content).toContain('Foo bar');
  });

  it('truncates runaway bodies at ~6000 chars', () => {
    const big = 'x'.repeat(10_000);
    const msgs = buildEntityExtractionPrompt({
      note_path: 'p',
      note_title: 't',
      note_body: big,
    });
    expect(msgs[1]?.content).toContain('[…truncated…]');
    expect((msgs[1]?.content ?? '').length).toBeLessThan(big.length);
  });
});

describe('parseEntityResponse — person / org / concept (wave 1 三件套)', () => {
  it('case 1: extracts a single person with alias + skips low-confidence', () => {
    const raw = JSON.stringify([
      {
        type: 'person',
        name: '张三',
        aliases: ['老张', 'Founder Z'],
        confidence: 0.92,
      },
      {
        type: 'person',
        name: 'Nobody',
        confidence: 0.4, // dropped
      },
    ]);
    const out = parseEntityResponse(raw, 'note/1');
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('person');
    expect(out[0]?.name).toBe('张三');
    expect(out[0]?.entity_id.startsWith('person:')).toBe(true);
    expect(out[0]?.source_note).toBe('note/1');
    expect(out[0]?.confidence).toBe(0.92);
    expect(out[0]?.aliases).toEqual(['老张', 'Founder Z']);
  });

  it('case 2: extracts an org + sanitises non-allowed type', () => {
    const raw = JSON.stringify([
      { type: 'organisation', name: 'OpenAI', confidence: 0.88 }, // typo → other
      { type: 'org', name: 'Anthropic', aliases: ['Anthropic PBC'], confidence: 0.71 },
    ]);
    const out = parseEntityResponse(raw, 'note/org');
    // Two distinct names kept, both type-normalised.
    const byName = new Map(out.map((e) => [e.name, e]));
    expect(byName.get('OpenAI')?.type).toBe('other'); // unknown → other
    expect(byName.get('Anthropic')?.type).toBe('org');
    expect(byName.get('Anthropic')?.aliases).toEqual(['Anthropic PBC']);
  });

  it('case 3: extracts multiple concepts and deduplicates near-duplicates', () => {
    const raw = JSON.stringify([
      { type: 'concept', name: 'Knowledge Graph', confidence: 0.95 },
      { type: 'concept', name: 'knowledge graph', confidence: 0.6 }, // canonical dup
      { type: 'concept', name: 'RAG', confidence: 0.83 },
      { type: 'topic', name: 'AI safety', confidence: 0.66 },
    ]);
    const out = parseEntityResponse(raw, 'note/c');
    const names = out.map((e) => e.name);
    expect(names).toContain('Knowledge Graph');
    expect(names).toContain('RAG');
    expect(names).toContain('AI safety');
    // The lowercase duplicate is collapsed
    const kgCount = out.filter((e) => e.name.toLowerCase() === 'knowledge graph').length;
    expect(kgCount).toBe(1);
  });

  it('handles markdown fences + trailing commas from sloppy LLM responses', () => {
    const raw = '```json\n[\n  { "type": "person", "name": "Ada", "confidence": 0.81, },\n  { "type": "person", "name": "Alan", "confidence": 0.74, }\n]\n```';
    const out = parseEntityResponse(raw, 'note/3');
    expect(out.map((e) => e.name).sort()).toEqual(['Ada', 'Alan']);
  });

  it('returns empty array on garbage input without throwing', () => {
    expect(parseEntityResponse('', 'p')).toEqual([]);
    expect(parseEntityResponse('not json at all', 'p')).toEqual([]);
    expect(parseEntityResponse('{"not": "an array"}', 'p')).toEqual([]);
  });
});

describe('EntityExtractor integration (with stubbed LLM)', () => {
  it('forwards note title+body to LLM and parses the response', async () => {
    const llm = new StubLLM(
      JSON.stringify([{ type: 'person', name: 'Grace Hopper', confidence: 0.99 }]),
    );
    const ex = new EntityExtractor({ provider: llm, defaultModel: 'stub' });
    const out = await ex.extract({
      note_path: 'inbox/gh',
      note_title: 'Grace Hopper',
      note_body: 'Grace Hopper invented the compiler.',
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('Grace Hopper');
    expect(llm.lastRequest?.messages[1]?.content).toContain('Grace Hopper');
  });

  it('returns empty list when LLM returns malformed JSON (no throw)', async () => {
    const llm = new StubLLM('garbage not even attempting json');
    const ex = new EntityExtractor({ provider: llm, defaultModel: 'stub' });
    const out = await ex.extract({
      note_path: 'p',
      note_title: 't',
      note_body: 'b',
    });
    expect(out).toEqual([]);
  });
});
