/**
 * MiniMax-M3 provider — OpenAI-compatible adapter.
 *
 * MiniMax-M3 (per sprint 1.1 plan + minimax-primary-gpt-fallback skill) talks to the
 * local minimax proxy at `http://127.0.0.1:45557/v1` and exposes an OpenAI-compatible
 * chat/completions endpoint. This adapter speaks that dialect so we can swap in
 * OpenAI/Claude later by writing sibling files.
 *
 * Transport: Node 24 `fetch` (zero deps). When streaming, we parse the SSE wire
 * protocol ourselves — see `middleware/stream-parser.ts`.
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
  ConfigError,
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

/** OpenAI-compatible /chat/completions payload fields we send. */
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
  object: string;
  created: number;
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
  object: string;
  created: number;
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

/** MiniMax-specific token count approximation. CJK-heavy text uses different ratio. */
export function approximateTokenCount(message: string): number {
  if (!message) return 0;
  // Strip very long whitespace runs.
  const trimmed = message.trim();
  if (!trimmed) return 0;
  // Detect CJK fraction — Chinese/Japanese/Korean characters as ~1.5 tokens per char,
  // latin/digit as ~0.25 tokens per char.
  const cjkChars = (trimmed.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const otherChars = trimmed.length - cjkChars;
  return Math.max(1, Math.round(cjkChars * 1.5 + otherChars * 0.25));
}

/** MiniMax-M3 provider. */
export class MiniMaxProvider implements LLMProvider {
  public readonly name = 'minimax';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly logger?: ProviderLogger;

  constructor(cfg: ProviderConfig) {
    ensureProviderConfig(cfg, 'minimax');
    this.apiKey = cfg.apiKey;
    // Trim trailing slash for clean URL concatenation.
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    // `??` so explicit empty string from caller stays empty (lets config-validation throw).
    this.defaultModel = cfg.defaultModel ?? 'MiniMax-M3';
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = cfg.logger;
  }

  /** Synchronous approximation across a message list. */
  countTokens(messages: ChatMessage[]): number {
    if (!Array.isArray(messages) || messages.length === 0) return 0;
    let total = 0;
    for (const m of messages) {
      // Add ~4 tokens per message for role tags & delimiters.
      total += approximateTokenCount(m.content) + 4;
    }
    return total;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = this.buildRequestBody(req, /* stream */ false);
    const { response, ms } = await this.fetchWithTimeout(
      '/chat/completions',
      body,
      req.signal ?? undefined,
    );
    if (!response.ok) {
      await this.throwHttpError(response, ms);
    }
    let data: OpenAICompletionResp;
    try {
      data = (await response.json()) as OpenAICompletionResp;
    } catch (e) {
      throw new StreamError(`[minimax] failed to parse JSON response`, e);
    }
    return this.toChatResponse(data);
  }

  async *chatStream(req: ChatRequest): AsyncIterable<StreamChunk> {
    const body = this.buildRequestBody(req, /* stream */ true);
    const { response, ms } = await this.fetchWithTimeout(
      '/chat/completions',
      body,
      req.signal ?? undefined,
    );
    if (!response.ok) {
      await this.throwHttpError(response, ms);
    }
    if (!response.body) {
      throw new StreamError('[minimax] streaming response missing body');
    }
    yield* this.parseSseStream(response.body);
  }

  // ───────────── private helpers ─────────────

  private buildRequestBody(req: ChatRequest, stream: boolean): OpenAIRequestBody {
    const model = req.model || this.defaultModel;
    if (!model) {
      throw new ConfigError('[minimax] model id missing');
    }
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
      throw new BadRequestError('[minimax] messages must be a non-empty array');
    }
    // Filter out any extras whose key collides with OpenAI fields.
    const body: OpenAIRequestBody = {
      model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.user !== undefined ? { user: req.user } : {}),
      ...(req.stop && req.stop.length ? { stop: req.stop } : {}),
    };
    return body;
  }

  private toChatResponse(data: OpenAICompletionResp): ChatResponse {
    const choice = data.choices?.[0];
    if (!choice) {
      throw new StreamError('[minimax] response has no choices');
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

  /** Issue POST /chat/completions with a hard timeout; returns elapsed ms for logging. */
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
        throw new TimeoutError('[minimax] caller aborted before send');
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
        throw new TimeoutError(`[minimax] request aborted after ${ms}ms`, e);
      }
      throw new NetworkError(`[minimax] ${(e as Error).message || 'fetch failed'}`, e);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onUserAbort);
    }
  }

  private async throwHttpError(resp: Response, _ms: number): Promise<never> {
    const bodyText = await safeText(resp);
    if (resp.status === 429) {
      const retryAfter = parseRetryAfter(resp.headers.get('retry-after'));
      throw new RateLimitError(`[minimax] 429 ${truncate(bodyText)}`, retryAfter, 429);
    }
    const err = errorFromHttpStatus(resp.status, bodyText, this.name);
    if (err instanceof ServerError) {
      throw err;
    }
    // AuthError / BadRequestError / unknown — surface as-is.
    throw err;
  }

  /** Parse SSE bytes into a stream of deltas. Throws StreamError on corrupt JSON. */
  private async *parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Process events separated by blank line (\n\n).
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = rawEvent.split('\n');
          let data = '';
          for (const line of lines) {
            if (line.startsWith('data:')) {
              data += line.slice(5).trimStart();
            }
            // We deliberately ignore event:/id:/retry: — OpenAI/MiniMax wire only uses `data:`.
          }
          if (!data) continue;
          if (data === '[DONE]') {
            return; // graceful end
          }
          let parsed: OpenAIStreamChunk;
          try {
            parsed = JSON.parse(data) as OpenAIStreamChunk;
          } catch (e) {
            throw new StreamError(`[minimax] malformed SSE chunk: ${truncate(data, 80)}`, e);
          }
          const choice = parsed.choices?.[0];
          if (!choice) continue; // usage-only chunks are skipped here
          const delta = choice.delta?.content ?? '';
          const chunk: StreamChunk = {
            delta,
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
      // Drain any trailing data line.
      if (buffer.trim().length > 0) {
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trimStart();
            if (data && data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data) as OpenAIStreamChunk;
                const choice = parsed.choices?.[0];
                if (choice) {
                  yield {
                    delta: choice.delta?.content ?? '',
                    finishReason: choice.finish_reason
                      ? normalizeFinishReason(choice.finish_reason)
                      : undefined,
                    raw: parsed,
                  };
                }
              } catch {
                // ignore trailing garbage
              }
            }
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
  // HTTP-date form — try Date.parse.
  const ms = Date.parse(h);
  if (Number.isFinite(ms)) {
    return Math.max(0, ms - Date.now());
  }
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
