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
