import type { ChatMessage, LLMProvider } from '@copilot/llm-client';
import type { TagInput } from '../types.js';

export interface TaggerExtractInput {
  note_path: string;
  note_title: string;
  note_body: string;
  existing_tags?: string[];
}

export interface TaggerLike {
  extract(input: TaggerExtractInput, signal?: AbortSignal): Promise<TagInput[]>;
}

const BLOCKED_TAGS = new Set(['general', 'misc', 'untagged', 'todo', 'tbd', 'unsorted']);
const MAX_TAGS = 8;

export class Tagger implements TaggerLike {
  constructor(private readonly options: {
    provider: LLMProvider;
    defaultModel: string;
    temperature?: number;
  }) {}

  async extract(input: TaggerExtractInput, signal?: AbortSignal): Promise<TagInput[]> {
    const response = await this.options.provider.chat({
      model: this.options.defaultModel,
      messages: buildTaggerPrompt(input),
      temperature: this.options.temperature ?? 0,
      maxTokens: 256,
      ...(signal ? { signal } : {}),
    });
    return mergeTags(parseTaggerResponse(response.content), input.existing_tags ?? []);
  }
}

export function buildTaggerPrompt(input: TaggerExtractInput): ChatMessage[] {
  const body = input.note_body.length > 4000
    ? `${input.note_body.slice(0, 4000)}\n[…truncated…]`
    : input.note_body;
  return [
    {
      role: 'system',
      content:
        `Choose at most ${MAX_TAGS} specific topic tags. Return ONLY a JSON array of strings ` +
        'or {"name": string} objects. Prefer accurate existing tags and avoid filler categories.',
    },
    {
      role: 'user',
      content: `Title: ${input.note_title}\nExisting tags: ${(input.existing_tags ?? []).join(', ')}\nBody:\n${body}`,
    },
  ];
}

export function parseTaggerResponse(raw: string): TagInput[] {
  if (!raw) return [];
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) text = fenced.trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    const parsed: unknown = JSON.parse(text.replace(/,\s*([\]}])/g, '$1'));
    if (!Array.isArray(parsed)) return [];
    return mergeTags(parsed.map((value) => {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        const name = (value as Record<string, unknown>)['name'];
        return typeof name === 'string' ? name : '';
      }
      return '';
    }), []);
  } catch {
    return [];
  }
}

export function normalizeTag(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function mergeTags(extracted: Array<TagInput | string>, existing: string[]): TagInput[] {
  const seen = new Set<string>();
  const output: TagInput[] = [];
  for (const value of [...existing, ...extracted]) {
    const name = normalizeTag(typeof value === 'string' ? value : value.name);
    if (!name || BLOCKED_TAGS.has(name) || seen.has(name)) continue;
    seen.add(name);
    output.push({ name });
    if (output.length >= MAX_TAGS) break;
  }
  return output;
}
