import type { ChatMessage, LLMProvider } from '@copilot/llm-client';
import type { EntityInput, RelationInput } from '../types.js';

export interface RelationExtractInput {
  note_path: string;
  note_title: string;
  note_body: string;
  entities: EntityInput[];
}

export interface RelationExtractorLike {
  extract(input: RelationExtractInput, signal?: AbortSignal): Promise<RelationInput[]>;
}

const RELATIONS = new Set([
  'works_at', 'founded', 'located_in', 'part_of', 'related_to', 'depends_on',
  'cites', 'follows_up', 'defines', 'mentions', 'tagged_with', 'attends',
  'created_by', 'other',
]);

export class RelationExtractor implements RelationExtractorLike {
  constructor(private readonly options: {
    provider: LLMProvider;
    defaultModel: string;
    temperature?: number;
  }) {}

  async extract(input: RelationExtractInput, signal?: AbortSignal): Promise<RelationInput[]> {
    if (input.entities.length < 2) return [];
    const response = await this.options.provider.chat({
      model: this.options.defaultModel,
      messages: buildRelationExtractionPrompt(input),
      temperature: this.options.temperature ?? 0,
      maxTokens: 1024,
      ...(signal ? { signal } : {}),
    });
    return parseRelationResponse(response.content, input);
  }
}

export function buildRelationExtractionPrompt(input: RelationExtractInput): ChatMessage[] {
  const body = input.note_body.length > 5000
    ? `${input.note_body.slice(0, 5000)}\n[…truncated…]`
    : input.note_body;
  const entities = input.entities
    .map((entity) => `${entity.entity_id}\t${entity.name}\t${entity.type}`)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        'Extract only directed relations explicitly supported by the note. Return ONLY JSON: ' +
        '[{"from_entity_id":string,"to_entity_id":string,"rel":string,"weight":number}]. ' +
        `Use supplied entity ids. Allowed rel values: ${[...RELATIONS].join(', ')}.`,
    },
    { role: 'user', content: `Title: ${input.note_title}\nEntities:\n${entities}\nBody:\n${body}` },
  ];
}

export function parseRelationResponse(raw: string, input: RelationExtractInput): RelationInput[] {
  const parsed = parseArray(raw);
  if (!parsed) return [];
  const references = new Map<string, string>();
  for (const entity of input.entities) {
    references.set(entity.entity_id.toLocaleLowerCase(), entity.entity_id);
    references.set(entity.name.toLocaleLowerCase(), entity.entity_id);
    for (const alias of entity.aliases ?? []) references.set(alias.toLocaleLowerCase(), entity.entity_id);
  }

  const seen = new Set<string>();
  const output: RelationInput[] = [];
  for (const value of parsed) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const from = resolveEndpoint(row['from_entity_id'] ?? row['from'], references);
    const to = resolveEndpoint(row['to_entity_id'] ?? row['to'], references);
    if (!from || !to || from === to) continue;
    const requested = typeof row['rel'] === 'string'
      ? row['rel'].trim().toLocaleLowerCase().replace(/[\s-]+/g, '_')
      : 'other';
    const rel = RELATIONS.has(requested) ? requested : 'other';
    const requestedWeight = typeof row['weight'] === 'number' ? row['weight'] : 0.5;
    const weight = Number.isFinite(requestedWeight)
      ? Math.max(0, Math.min(1, requestedWeight))
      : 0.5;
    const key = `${from}\u0000${to}\u0000${rel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      from_entity_id: from,
      to_entity_id: to,
      rel,
      weight,
      evidence_note: input.note_path,
    });
  }
  return output;
}

function resolveEndpoint(value: unknown, known: ReadonlyMap<string, string>): string | null {
  return typeof value === 'string'
    ? (known.get(value.trim().toLocaleLowerCase()) ?? null)
    : null;
}

function parseArray(raw: string): unknown[] | null {
  if (!raw) return null;
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) text = fenced.trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    const parsed: unknown = JSON.parse(text.replace(/,\s*([\]}])/g, '$1'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
