/**
 * OpenAI provider — chat/completions adapter.
 *
 * Wire-compatible with the OpenAI REST API:
 *   POST {baseUrl}/chat/completions
 *   Headers: Authorization: Bearer <apiKey>
 *   Body:    { model, messages, temperature, max_tokens, stream, ... }
 *
 * Used both for OpenAI direct (`https://api.openai.com/v1`) and any
 * self-hosted OpenAI-compatible deployment (Together, OpenRouter,
 * vLLM, etc.) — see `./custom.ts` for the relabeled factory surface.
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
  AuthError,
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
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

interface OpenAIRequestBody {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  user?: string;
  stop?: string[];
}

interface OpenAICompletionResp {
  id: string;
  model: string;
  choices: {
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  model: string;
  choices: {
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** OpenAI provider. */
export class OpenAIProvider implements LLMProvider {
  public readonly name = 'openai';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly logger?: ProviderLogger;

  constructor(cfg: ProviderConfig) {
    ensureProviderConfig(cfg, 'openai');
    this.apiKey = cfg.apiKey;
    this.baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultModel = cfg.defaultModel ?? DEFAULT_MODEL;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = cfg.logger;
  }

  countTokens(messages: ChatMessage[]): number {
    if (!Array.isArray(messages) || messages.length === 0) return 0;
    // Conservative approximation (no public tokenizer here) — same
    // formula as minimax so cross-provider counts stay comparable.
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
    const { response, ms } = await this.fetchWithTimeout('/chat/completions', body, req.signal);
    if (!response.ok) {
      await this.throwHttpError(response, ms);
    }
    let data: OpenAICompletionResp;
    try {
      data = (await response.json()) as OpenAICompletionResp;
    } catch (e) {
      throw new StreamError('[openai] failed to parse JSON response', e);
    }
    return this.toChatResponse(data);
  }

  async *chatStream(req: ChatRequest): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(req, true);
    const { response, ms } = await this.fetchWithTimeout('/chat/completions', body, req.signal);
    if (!response.ok) {
      await this.throwHttpError(response, ms);
    }
    if (!response.body) {
      throw new StreamError('[openai] streaming response missing body');
    }
    yield* this.parseSseStream(response.body);
  }

  // ───────────── private helpers ─────────────

  private buildRequestBody(req: ChatRequest, stream: boolean): OpenAIRequestBody {
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
      throw new BadRequestError('[openai] messages must be a non-empty array');
    }
    const model = req.model || this.defaultModel;
    return {
      model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.user !== undefined ? { user: req.user } : {}),
      ...(req.stop && req.stop.length ? { stop: req.stop } : {}),
    };
  }

  private toChatResponse(data: OpenAICompletionResp): ChatResponse {
    const choice = data.choices?.[0];
    if (!choice) {
      throw new StreamError('[openai] response has no choices');
    }
    return {
      content: choice.message?.content ?? '',
      model: data.model,
      finishReason: normalizeFinishReason(choice.finish_reason),
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      raw: data,
    };
  }

  private async fetchWithTimeout(
    path: string,
    body: OpenAIRequestBody,
    signal: AbortSignal | undefined,
  ) {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort('timeout'), this.timeoutMs);
    const onUserAbort = () => ac.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        throw new TimeoutError('[openai] caller aborted before send');
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
          Authorization: `Bearer ${this.apiKey}`,
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
        throw new TimeoutError(`[openai] request aborted after ${ms}ms`, e);
      }
      throw new NetworkError(`[openai] ${(e as Error).message || 'fetch failed'}`, e);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onUserAbort);
    }
  }

  private async throwHttpError(resp: Response, _ms: number): Promise<never> {
    const bodyText = await safeText(resp);
    if (resp.status === 401) {
      throw new AuthError(`[openai] 401 ${truncate(bodyText)}`, resp.status);
    }
    if (resp.status === 429) {
      const retryAfter = parseRetryAfter(resp.headers.get('retry-after'));
      throw new RateLimitError(`[openai] 429 ${truncate(bodyText)}`, retryAfter, 429);
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
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let data = '';
          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('data:')) {
              data += line.slice(5).trimStart();
            }
          }
          if (!data || data === '[DONE]') continue;
          let parsed: OpenAIStreamChunk;
          try {
            parsed = JSON.parse(data) as OpenAIStreamChunk;
          } catch (e) {
            throw new StreamError(`[openai] malformed SSE chunk: ${truncate(data, 80)}`, e);
          }
          const choice = parsed.choices?.[0];
          if (!choice) continue;
          const chunk: StreamChunk = {
            delta: choice.delta?.content ?? '',
            raw: parsed,
          };
          if (choice.finish_reason) {
            chunk.finishReason = normalizeFinishReason(choice.finish_reason);
          }
          if (parsed.usage) {
            chunk.usage = {
              promptTokens: parsed.usage.prompt_tokens,
              completionTokens: parsed.usage.completion_tokens,
              totalTokens: parsed.usage.total_tokens,
            };
          }
          yield chunk;
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

function normalizeFinishReason(r: string | null): ChatResponse['finishReason'] {
  switch (r) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
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