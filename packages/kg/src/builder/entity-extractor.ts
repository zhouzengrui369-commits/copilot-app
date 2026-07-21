/**
 * Entity extractor (wave 1).
 *
 * Drives an LLM (via `@copilot/llm-client`) to extract entities + aliases +
 * confidence from a single note's body. Output is consumed by `KgBuilder`
 * which then calls `KgStore.upsertEntity` to merge into the graph.
 *
 * The extractor is intentionally *pluggable*: subclasses (or test doubles)
 * can override the `extract(input)` call. The default `LocalKgExtractor` in
 * `./local-extractor.ts` is what production uses — see that file for the
 * full `extract()` implementation.
 *
 * Extraction rules (enforced by both prompt + post-parse filter):
 *   - types: person / org / concept / event / place / product / document /
 *            topic / other (anything else → "other")
 *   - confidence: < 0.5 dropped silently
 *   - aliases: at most 5, de-duplicated against `name`
 *   - entity_id: `"<type>:<lowercased-collapsed-name>"` so cross-note merges
 *     naturally happen at `KgStore.upsertEntity`.
 */

import type { ChatMessage, LLMProvider } from '@copilot/llm-client';
import type { Entity, EntityInput, EntityType } from '../types.js';

export interface EntityExtractInput {
  note_path: string;
  note_title: string;
  note_body: string;
  /** Optional extra context (e.g. tags, type) — passed verbatim. */
  note_meta?: Record<string, unknown>;
}

export interface LlmEntity {
  type: string;
  name: string;
  aliases?: string[];
  confidence: number;
}

/** Pluggable extraction contract. */
export interface EntityExtractorLike {
  extract(input: EntityExtractInput, signal?: AbortSignal): Promise<EntityInput[]>;
}

/**
 * Default extractor that calls an LLM. Subclasses (or vitest mocks) can
 * override `.extract()` to test the surrounding glue without any LLM.
 */
export class EntityExtractor implements EntityExtractorLike {
  private readonly provider: LLMProvider;
  private readonly defaultModel: string;
  /** Per-call temperature. 0 keeps entity merges stable across reruns. */
  private readonly temperature: number;

  constructor(opts: {
    provider: LLMProvider;
    defaultModel: string;
    temperature?: number;
  }) {
    this.provider = opts.provider;
    this.defaultModel = opts.defaultModel;
    this.temperature = opts.temperature ?? 0;
  }

  async extract(input: EntityExtractInput, signal?: AbortSignal): Promise<EntityInput[]> {
    const messages = buildEntityExtractionPrompt(input);
    const response = await this.provider.chat({
      model: this.defaultModel,
      messages,
      temperature: this.temperature,
      maxTokens: 1024,
      ...(signal ? { signal } : {}),
    });
    return parseEntityResponse(response.content, input.note_path);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Prompt + parse helpers (exported for tests + LocalKgExtractor)
// ──────────────────────────────────────────────────────────────────────

const ENTITY_TYPE_SET = new Set<EntityType>([
  'person',
  'org',
  'concept',
  'event',
  'place',
  'product',
  'document',
  'topic',
  'other',
]);

/**
 * Build the chat messages for entity extraction. The system prompt enforces
 * strict JSON output; the user prompt carries the note title + body.
 */
export function buildEntityExtractionPrompt(input: EntityExtractInput): ChatMessage[] {
  const { note_title, note_body, note_meta } = input;
  const metaLine = note_meta
    ? `\n\nNote metadata (auxiliary, may help disambiguate): ${JSON.stringify(note_meta)}`
    : '';
  // Truncate bodies so a runaway 10 MB note doesn't blow the prompt budget.
  // ~6000 chars ≈ ~2000 tokens which leaves headroom for the response.
  const safeBody = note_body.length > 6000 ? note_body.slice(0, 6000) + '\n[…truncated…]' : note_body;
  return [
    {
      role: 'system',
      content:
        'You extract structured entities from notes. Output ONLY a JSON array. ' +
        'No commentary, no markdown fences.\n' +
        'Schema: [{"type": string, "name": string, "aliases"?: string[], "confidence": number}].\n' +
        'Allowed types: person, org, concept, event, place, product, document, topic, other.\n' +
        'Rules:\n' +
        '  - Extract every distinct person, organisation, concept, event, place, product,\n' +
        '    document, or topic that appears in the note body.\n' +
        '  - Confidence must be 0..1. Be conservative — 0.5 means "probably there".\n' +
        '  - aliases may include nicknames / alternative spellings (max 5).\n' +
        '  - Do not fabricate. Skip names you cannot tie to the body.',
    },
    {
      role: 'user',
      content: `Title: ${note_title}${metaLine}\n\nBody:\n${safeBody}\n\nJSON array only.`,
    },
  ];
}

/**
 * Parse the LLM's JSON response into `EntityInput[]`. Robust to:
 *   - Markdown fences (```json ... ```)
 *   - Trailing commas
 *   - Extra top-level prose around the array
 *   - Wrong field names (common LLM halucinations — we map them defensively)
 *
 * Filters out: low-confidence (< 0.5), empty names, duplicate names,
 * non-allowed types (coerced to "other").
 */
export function parseEntityResponse(raw: string, note_path: string): EntityInput[] {
  if (!raw || typeof raw !== 'string') return [];
  const cleaned = stripFencesAndProse(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const out: EntityInput[] = [];

  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== 'object') continue;
    const c = candidate as Record<string, unknown>;
    const rawType = typeof c['type'] === 'string' ? (c['type'] as string).toLowerCase() : 'other';
    const type: EntityType = ENTITY_TYPE_SET.has(rawType as EntityType)
      ? (rawType as EntityType)
      : 'other';
    const name = typeof c['name'] === 'string' ? (c['name'] as string).trim() : '';
    if (!name) continue;
    const confidenceRaw = typeof c['confidence'] === 'number' ? (c['confidence'] as number) : 0;
    if (!Number.isFinite(confidenceRaw) || confidenceRaw < 0.5) continue;
    const aliases = Array.isArray(c['aliases'])
      ? (c['aliases'] as unknown[])
          .filter((a): a is string => typeof a === 'string')
          .map((a) => a.trim())
          .filter(Boolean)
          .filter((a) => a.toLowerCase() !== name.toLowerCase())
          .slice(0, 5)
      : [];

    const canonical = name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(canonical)) continue;
    seen.add(canonical);

    out.push({
      entity_id: makeEntityId(type, name),
      type,
      name,
      aliases,
      confidence: clamp01(confidenceRaw),
      source_note: note_path,
    });
  }

  return out;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Produce a stable, mergeable id from type + name. */
export function makeEntityId(type: string, name: string): string {
  const t = type.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'other';
  const n = name
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${t}:${n || 'unnamed'}`;
}

function stripFencesAndProse(raw: string): string {
  let s = raw.trim();
  // Drop ```json ... ``` fences
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    s = fenceMatch[1].trim();
  }
  // If prose wraps the JSON, isolate the first `[…]` span.
  const firstBracket = s.indexOf('[');
  const lastBracket = s.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    s = s.slice(firstBracket, lastBracket + 1);
  }
  // Strip trailing commas (basic, single-pass).
  s = s.replace(/,\s*([\]\}])/g, '$1');
  return s;
}

/**
 * Build `Entity` for the response — exposed for unit tests that want to
 * check post-merging fields.
 */
export function buildEntityView(input: EntityInput, nowMs: number): Omit<Entity, 'id'> {
  return {
    entity_id: input.entity_id,
    type: (input.type as EntityType) ?? 'other',
    name: input.name,
    aliases: input.aliases ?? [],
    summary: input.summary ?? null,
    confidence: input.confidence ?? null,
    source_notes: [input.source_note],
    created_at: nowMs,
    updated_at: nowMs,
  };
}
