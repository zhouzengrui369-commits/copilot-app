import type { ChatMessage, LLMProvider } from '@copilot/llm-client';
import type { EntityInput } from '../types.js';

export interface SummarizeInput {
  note_title: string;
  note_body: string;
  entities: EntityInput[];
}

export interface SummarizerLike {
  summarize(input: SummarizeInput, signal?: AbortSignal): Promise<Map<string, string>>;
}

/** Independent note-level input for the persisted WIKI projection. */
export interface NoteSummaryInput {
  note_path: string;
  note_title: string;
  note_body: string;
  existing_tags?: string[];
  note_meta?: Record<string, unknown>;
}

/** Provider truth returned alongside a schema-valid note summary. */
export interface NoteSummaryOutput {
  summary: string;
  provider: string;
  model: string;
}

export interface NoteSummarizerLike {
  summarizeNote(input: NoteSummaryInput, signal?: AbortSignal): Promise<NoteSummaryOutput>;
}

/** Stable parse error used by KgBuilder to persist a fail-closed attempt. */
export class NoteSummaryParseError extends Error {
  override readonly name = 'NoteSummaryParseError';
}

export class Summarizer implements SummarizerLike {
  constructor(private readonly options: {
    provider: LLMProvider;
    defaultModel: string;
    temperature?: number;
  }) {}

  async summarize(input: SummarizeInput, signal?: AbortSignal): Promise<Map<string, string>> {
    if (input.entities.length === 0) return new Map();
    const response = await this.options.provider.chat({
      model: this.options.defaultModel,
      messages: buildSummarizePrompt(input),
      temperature: this.options.temperature ?? 0,
      maxTokens: 1024,
      ...(signal ? { signal } : {}),
    });
    return parseSummarizeResponse(response.content, input.entities);
  }
}

/**
 * Dedicated note-level summarizer.
 *
 * This is intentionally separate from `Summarizer`, whose output is a map
 * of entity summaries used only to enrich graph nodes. A graph/entity
 * summary must never be published as a note WIKI summary.
 */
export class NoteSummarizer implements NoteSummarizerLike {
  constructor(private readonly options: {
    provider: LLMProvider;
    defaultModel: string;
    temperature?: number;
  }) {}

  async summarizeNote(
    input: NoteSummaryInput,
    signal?: AbortSignal,
  ): Promise<NoteSummaryOutput> {
    const response = await this.options.provider.chat({
      model: this.options.defaultModel,
      messages: buildNoteSummaryPrompt(input),
      temperature: this.options.temperature ?? 0,
      maxTokens: 384,
      ...(signal ? { signal } : {}),
    });
    if (response.finishReason !== 'stop' || !response.model.trim()) {
      throw new NoteSummaryParseError('WIKI_NOTE_SUMMARY_INCOMPLETE_RESPONSE');
    }
    return {
      summary: parseNoteSummaryResponse(response.content),
      provider: this.options.provider.name,
      model: response.model.trim(),
    };
  }
}

export function buildSummarizePrompt(input: SummarizeInput): ChatMessage[] {
  const body = input.note_body.length > 4000
    ? `${input.note_body.slice(0, 4000)}\n[…truncated…]`
    : input.note_body;
  const entities = input.entities
    .map((entity) => `${entity.entity_id}\t${entity.name}`)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        'Summarize each supplied entity using only facts in the note. Return ONLY a JSON object ' +
        'mapping entity_id to a concise summary of at most 60 characters. Do not invent facts.',
    },
    { role: 'user', content: `Title: ${input.note_title}\nEntities:\n${entities}\nBody:\n${body}` },
  ];
}

/** Strict prompt for a single note-level WIKI summary. */
export function buildNoteSummaryPrompt(input: NoteSummaryInput): ChatMessage[] {
  const body = input.note_body.length > 6000
    ? `${input.note_body.slice(0, 6000)}\n[…truncated…]`
    : input.note_body;
  const metadata = input.note_meta
    ? `\nMetadata: ${JSON.stringify(input.note_meta)}`
    : '';
  return [
    {
      role: 'system',
      content:
        'COPILOT_NOTE_WIKI_SUMMARY_V1. Summarize the complete note, not an entity. ' +
        'Use only facts supported by the note. Return ONLY one JSON object with exactly this ' +
        'schema: {"summary": string}. summary must be non-empty and at most 240 Unicode ' +
        'characters. No markdown, tags, entities, relations, confidence, or commentary.',
    },
    {
      role: 'user',
      content:
        `Path: ${input.note_path}\nTitle: ${input.note_title}\n` +
        `Existing tags: ${(input.existing_tags ?? []).join(', ')}${metadata}\nBody:\n${body}`,
    },
  ];
}

/**
 * Parse a note summary without silently accepting malformed provider output.
 * Invalid JSON, extra schema fields, empty text, or an overlong summary are
 * hard parse failures so callers cannot publish a green projection.
 */
export function parseNoteSummaryResponse(raw: string): string {
  if (!raw.trim()) {
    throw new NoteSummaryParseError('WIKI_NOTE_SUMMARY_EMPTY_RESPONSE');
  }
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) text = fenced.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new NoteSummaryParseError('WIKI_NOTE_SUMMARY_JSON_OBJECT_REQUIRED');
  }
  text = text.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new NoteSummaryParseError('WIKI_NOTE_SUMMARY_INVALID_JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NoteSummaryParseError('WIKI_NOTE_SUMMARY_SCHEMA_INVALID');
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    typeof record['summary'] !== 'string'
  ) {
    throw new NoteSummaryParseError('WIKI_NOTE_SUMMARY_SCHEMA_INVALID');
  }
  const summary = record['summary'].trim().replace(/\s+/gu, ' ');
  const length = [...summary].length;
  if (length === 0 || length > 240) {
    throw new NoteSummaryParseError('WIKI_NOTE_SUMMARY_LENGTH_INVALID');
  }
  return summary;
}

export function parseSummarizeResponse(
  raw: string,
  entities: EntityInput[],
): Map<string, string> {
  const output = new Map<string, string>();
  if (!raw) return output;
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) text = fenced.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/,\s*([\]}])/g, '$1'));
  } catch {
    return output;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return output;
  const known = new Set(entities.map((entity) => entity.entity_id));
  for (const [entityId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!known.has(entityId) || typeof value !== 'string') continue;
    const summary = [...value.trim().replace(/[。.!！?？\s]+$/u, '')].slice(0, 60).join('');
    if (summary) output.set(entityId, summary);
  }
  return output;
}
