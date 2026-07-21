/**
 * Anthropic Claude provider — Messages API adapter.
 *
 * Wire format (different from OpenAI):
 *   POST {baseUrl}/v1/messages
 *   Headers:
 *     x-api-key: <apiKey>
 *     anthropic-version: 2023-06-01
 *     Content-Type: application/json
 *   Body:
 *     {
 *       model: "claude-3-5-sonnet-20241022",
 *       system: "..." | [...],
 *       messages: [{ role: "user"|"assistant", content: "..." }],
 *       max_tokens: 1024,
 *       temperature?: 0..1,
 *       stream?: true
 *     }
 *
 * Streaming uses SSE with named events:
 *   - message_start
 *   - content_block_start
 *   - content_block_delta  ← we collect text deltas from these
 *   - content_block_stop
 *   - message_delta         ← carries stop_reason
 *   - message_stop
 *
 * Sprint 1.2 T-1.2.6 (settings panel + multi-provider).
 */

import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LLMProvider,
  StreamChunk,
} from '../types.js';
import {
  BadRequestError,
  NetworkError,
  RateLimitError,
  ServerError,
  StreamError,
  TimeoutError,
  errorFromHttpStatus,
  isLLMError,
} from '../util/errors.js';
import { type ProviderConfig, type ProviderLogger, ensureProviderConfig } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';
const ANTHROPIC_VERSION = '2023-06-01';

interface ClaudeRequestBody {
  model: string;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  max_tokens: number;
  temperature?: number;
  stream?: boolean;
}

interface ClaudeResponse {
  id: string;
  type: 'message';
  model: string;
  role: 'assistant';
  content: { type: 'text'; text: string }[];
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface ClaudeStreamEvent {
  type:
    | 'message_start'
    | 'content_block_start'
    | 'content_block_delta'
    | 'content_block_stop'
    | 'message_delta'
    | 'message_stop'
    | 'ping'
    | 'error';
  // content_block_delta
  delta?: { type: 'text_delta'; text: string };
  // message_delta
  message?: { stop_reason?: string | null };
  // error
  error?: { type?: string; message?: string };
}

/** Anthropic Claude provider. */
export class ClaudeProvider implements LLMProvider {
  public readonly name = 'claude';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;
  private readonly timeoutMs: number;
  private readonly logger?: ProviderLogger;

  constructor(cfg: ProviderConfig) {
    ensureProviderConfig(cfg, 'claude');
    this.apiKey = cfg.apiKey;
    this.baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultModel = cfg.defaultModel ?? DEFAULT_MODEL;
    this.defaultMaxTokens = (cfg as ProviderConfig & { defaultMaxTokens?: number }).defaultMaxTokens ?? 1024;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = cfg.logger;
  }

  countTokens(messages: ChatMessage[]): number {
    if (!Array.isArray(messages) || messages.length === 0) return 0;
    let total = 0;
    for (const m of messages) {
      const text = (m.content || '').trim();
      const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
      const other = text.length - cjk;
      total += Math.max(1, Math.round(cjk * 1.5 + other * 0.25)) + 4;
    }
    return total;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = this.buildRequestBody(req, false);
    const { response, ms } = await this.fetchWithTimeout('/v1/messages', body, req.signal);
    if (!response.ok) {
      await this.throwHttpError(response, ms);
    }
    let data: ClaudeResponse;
    try {
      data = (await response.json()) as ClaudeResponse;
    } catch (e) {
      throw new StreamError('[claude] failed to parse JSON response', e);
    }
    return this.toChatResponse(data);
  }

  async *chatStream(req: ChatRequest): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(req, true);
    const { response, ms } = await this.fetchWithTimeout('/v1/messages', body, req.signal);
    if (!response.ok) {
      await this.throwHttpError(response, ms);
    }
    if (!response.body) {
      throw new StreamError('[claude] streaming response missing body');
    }
    yield* this.parseSseStream(response.body);
  }

  // ───────────── private helpers ─────────────

  private buildRequestBody(req: ChatRequest, stream: boolean): ClaudeRequestBody {
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
      throw new BadRequestError('[claude] messages must be a non-empty array');
    }
    let systemPrompt: string | undefined;
    const userMessages: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const m of req.messages) {
      if (m.role === 'system') {
        // Claude uses a top-level `system` field — concatenate if multiple.
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${m.content}` : m.content;
        continue;
      }
      if (m.role === 'user' || m.role === 'assistant') {
        userMessages.push({ role: m.role, content: m.content });
      }
    }
    if (userMessages.length === 0) {
      throw new BadRequestError('[claude] requires at least one user/assistant message');
    }
    // Anthropic requires alternating user/assistant starting with user. If the
    // first message is assistant, prepend a tiny user turn so the API accepts it.
    if (userMessages[0]?.role === 'assistant') {
      userMessages.unshift({ role: 'user', content: '(continuation)' });
    }
    const model = req.model || this.defaultModel;
    const body: ClaudeRequestBody = {
      model,
      messages: userMessages,
      max_tokens: req.maxTokens ?? this.defaultMaxTokens,
      stream,
    };
    if (systemPrompt) body.system = systemPrompt;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    return body;
  }

  private toChatResponse(data: ClaudeResponse): ChatResponse {
    const text = (data.content || [])
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
    return {
      content: text,
      model: data.model,
      finishReason: normalizeFinishReason(data.stop_reason),
      usage: {
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      raw: data,
    };
  }

  private async fetchWithTimeout(
    path: string,
    body: ClaudeRequestBody,
    signal: AbortSignal | undefined,
  ) {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort('timeout'), this.timeoutMs);
    const onUserAbort = () => ac.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        throw new TimeoutError('[claude] caller aborted before send');
      }
      signal.addEventListener('abort', onUserAbort, { once: true });
    }
    const start = Date.now();
    try {
      this.logger?.({ event: 'http_start', provider: this.name, url, model: body.model });
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const ms = Date.now() - start;
      this.logger?.({ event: 'http_done', provider: this.name, url, status: resp.status, ms });
      return { response: resp, ms };
    } catch (e) {
      const ms = Date.now() - start;
      this.logger?.({ event: 'http_error', provider: this.name, url, ms, error: String(e) });
      if (isLLMError(e)) throw e;
      if ((e as { name?: string })?.name === 'AbortError') {
        throw new TimeoutError(`[claude] request aborted after ${ms}ms`, e);
      }
      throw new NetworkError(`[claude] ${(e as Error).message || 'fetch failed'}`, e);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onUserAbort);
    }
  }

  private async throwHttpError(resp: Response, _ms: number): Promise<never> {
    const bodyText = await safeText(resp);
    if (resp.status === 429) {
      const retryAfter = parseRetryAfter(resp.headers.get('retry-after'));
      throw new RateLimitError(`[claude] 429 ${truncate(bodyText)}`, retryAfter, 429);
    }
    const err = errorFromHttpStatus(resp.status, bodyText, this.name);
    if (err instanceof ServerError) throw err;
    throw err;
  }

  private async *parseSseStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<StreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finishReason: StreamChunk['finishReason'];
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = rawEvent.split('\n');
          let eventName = '';
          let dataLine = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLine += line.slice(5).trimStart();
          }
          if (!dataLine) continue;
          let parsed: ClaudeStreamEvent;
          try {
            parsed = JSON.parse(dataLine) as ClaudeStreamEvent;
          } catch {
            continue;
          }
          if (eventName === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            yield { delta: parsed.delta.text, raw: parsed };
            continue;
          }
          if (eventName === 'message_delta' && parsed.message?.stop_reason) {
            finishReason = normalizeFinishReason(parsed.message.stop_reason);
            continue;
          }
          if (eventName === 'message_stop') {
            yield {
              delta: '',
              finishReason: finishReason ?? 'stop',
              usage: { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens },
            };
            return;
          }
          if (parsed.type === 'error' || eventName === 'error') {
            throw new StreamError(
              `[claude] stream error: ${parsed.error?.message ?? 'unknown'}`,
            );
          }
          // message_start carries input_tokens, but we only have it after
          // JSON-parse — keep it simple by tracking via raw payload.
          if (parsed.type === 'message_start') {
            const startUsage = (parsed as unknown as { message?: { usage?: { input_tokens?: number } } })
              .message?.usage;
            if (startUsage?.input_tokens) inputTokens = startUsage.input_tokens;
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore double-release
      }
    }
  }
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const seconds = Number(h);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const ms = Date.parse(h);
  if (Number.isFinite(ms)) return Math.max(0, ms - Date.now());
  return undefined;
}

function normalizeFinishReason(r: string | null | undefined): ChatResponse['finishReason'] {
  switch (r) {
    case 'end_turn':
    case 'stop':
      return 'stop';
    case 'max_tokens':
    case 'length':
      return 'length';
    case 'tool_use':
    case 'tool_calls':
      return 'tool_calls';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'stop';
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}

function truncate(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}