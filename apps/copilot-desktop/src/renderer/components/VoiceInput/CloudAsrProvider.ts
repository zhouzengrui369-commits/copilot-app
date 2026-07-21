/**
 * CloudAsrProvider.ts — POSTs recorded audio bytes to the server
 * `/api/asr/transcribe` route (v5 workbench already implements the
 * Tencent Cloud ASR proxy; the desktop process owns no ASR creds).
 *
 * Decision red line (rules.md): NO commercial ASR API in the desktop
 * process. All credentials stay on the workbench server.
 *
 * Sprint 1.2 / T-1.2.4.
 */

export interface CloudTranscript {
  text: string;
  confidence: number;
  /** Provider name as reported by the server, when available. */
  engine?: string;
  /** Server-reported duration in ms, when available. */
  durationMs?: number;
}

export interface CloudAsrError extends Error {
  code: string;
  status?: number;
}

export function makeCloudAsrError(
  code: string,
  message: string,
  status?: number,
): CloudAsrError {
  const err = new Error(message) as CloudAsrError;
  err.name = 'CloudAsrError';
  err.code = code;
  if (status !== undefined) err.status = status;
  return err;
}

export type CloudAsrFetchLike = (
  input: string,
  init?: {
    method?: string;
    body?: BodyInit | null;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/**
 * Default server URL is the workbench at localhost:38888 in dev.
 *
 * The port comes from `apps/server/src/config.ts:31` —
 *   export const PORT = Number(process.env.OPENCLAW_WORKBENCH_PORT || 38888);
 * Do NOT guess — always grep the workbench config before changing this.
 * (钉子 #23 self-audit discipline, 2026-07-10.)
 */
export const DEFAULT_SERVER_BASE = 'http://127.0.0.1:38888';

export interface CloudAsrOptions {
  serverBaseUrl?: string;
  fetchImpl?: CloudAsrFetchLike;
  language?: string;
  signal?: AbortSignal;
  /** Optional timeout in ms (default 15000). */
  timeoutMs?: number;
}

export interface CloudAsrResult extends CloudTranscript {
  raw?: unknown;
}

const ENDPOINT = '/api/asr/transcribe';

function awaitAbortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('aborted', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () =>
      finish(() => reject(new DOMException('aborted', 'AbortError')));
    signal.addEventListener('abort', onAbort, { once: true });
    void work.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export class CloudAsrProvider {
  readonly name = 'cloud' as const;
  private readonly serverBaseUrl: string;
  private readonly fetchImpl: CloudAsrFetchLike;
  private readonly timeoutMs: number;

  constructor(opts: CloudAsrOptions = {}) {
    this.serverBaseUrl = (opts.serverBaseUrl ?? DEFAULT_SERVER_BASE).replace(
      /\/$/,
      '',
    );
    this.fetchImpl =
      opts.fetchImpl ?? (globalThis.fetch as unknown as CloudAsrFetchLike);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /**
   * Send audio bytes (Blob or File) to the server. Returns the
   * final transcript or throws CloudAsrError.
   */
  async transcribe(
    audio: Blob | File,
    opts: { language?: string; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<CloudAsrResult> {
    if (!audio || audio.size === 0) {
      throw makeCloudAsrError('empty-audio', 'no audio to transcribe');
    }
    const url = `${this.serverBaseUrl}${ENDPOINT}`;
    const form = new FormData();
    form.append('audio', audio, 'recording.webm');
    if (opts.language) form.append('language', opts.language);

    const controller = new AbortController();
    let timedOut = false;
    let callerAborted = opts.signal?.aborted === true;
    const abortFromCaller = () => {
      callerAborted = true;
      controller.abort();
    };
    if (callerAborted) {
      throw makeCloudAsrError('aborted', 'cloud ASR cancelled');
    }
    opts.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      let resp;
      try {
        resp = await awaitAbortable(
          this.fetchImpl(url, {
            method: 'POST',
            body: form,
            signal: controller.signal,
          }),
          controller.signal,
        );
      } catch (err) {
        if (timedOut) {
          throw makeCloudAsrError('timeout', 'cloud ASR timed out');
        }
        if (callerAborted || opts.signal?.aborted) {
          throw makeCloudAsrError('aborted', 'cloud ASR cancelled');
        }
        throw makeCloudAsrError(
          'network',
          err instanceof Error ? err.message : 'network error',
        );
      }

      if (!resp.ok) {
        let detail = '';
        try {
          detail = await awaitAbortable(
            Promise.resolve().then(() => resp.text()),
            controller.signal,
          );
        } catch {
          if (timedOut) {
            throw makeCloudAsrError('timeout', 'cloud ASR timed out');
          }
          if (callerAborted || opts.signal?.aborted) {
            throw makeCloudAsrError('aborted', 'cloud ASR cancelled');
          }
          /* unreadable error bodies fall back to the HTTP status */
        }
        throw makeCloudAsrError(
          `http-${resp.status}`,
          detail || `cloud ASR returned ${resp.status}`,
          resp.status,
        );
      }

      let body: unknown;
      try {
        body = await awaitAbortable(
          Promise.resolve().then(() => resp.json()),
          controller.signal,
        );
      } catch (err) {
        if (timedOut) {
          throw makeCloudAsrError('timeout', 'cloud ASR timed out');
        }
        if (callerAborted || opts.signal?.aborted) {
          throw makeCloudAsrError('aborted', 'cloud ASR cancelled');
        }
        throw makeCloudAsrError(
          'bad-json',
          err instanceof Error ? err.message : 'invalid JSON',
          resp.status,
        );
      }

      return parseCloudResponse(body);
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  /** Health check; server may return 200/204 or 503 if ASR not configured. */
  async health(): Promise<{ ok: boolean; status: number }> {
    const url = `${this.serverBaseUrl}/api/asr/health`;
    try {
      const resp = await this.fetchImpl(url, { method: 'GET' });
      return { ok: resp.ok, status: resp.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }
}

/** Parse the server's JSON envelope. Tolerant of shape drift. */
export function parseCloudResponse(body: unknown): CloudAsrResult {
  if (!body || typeof body !== 'object') {
    throw makeCloudAsrError('bad-shape', 'response not an object');
  }
  const obj = body as Record<string, unknown>;
  const textRaw = obj.text ?? obj.result ?? obj.transcript;
  const text = typeof textRaw === 'string' ? textRaw.trim() : '';
  const confRaw = obj.confidence ?? obj.score ?? 1;
  const confidence =
    typeof confRaw === 'number' && Number.isFinite(confRaw) ? confRaw : 1;
  const engine =
    typeof obj.engine === 'string'
      ? obj.engine
      : typeof obj.provider === 'string'
        ? obj.provider
        : undefined;
  const durRaw = obj.duration_ms ?? obj.durationMs;
  const durationMs =
    typeof durRaw === 'number' && Number.isFinite(durRaw) ? durRaw : undefined;
  return {
    text,
    confidence,
    engine,
    durationMs,
    raw: body,
  };
}

/**
 * Character-level accuracy between expected and recognised text.
 * Used by the accuracy probe to enforce the ≥ 0.9 bar (PM discipline #6).
 * Counts normalised character overlap; ignores whitespace and case.
 */
export function characterAccuracy(expected: string, actual: string): number {
  const norm = (s: string): string =>
    s
      .replace(/\s+/g, '')
      .normalize('NFKC')
      .toLowerCase();
  const e = norm(expected);
  const a = norm(actual);
  if (!e) return a ? 0 : 1;
  if (!a) return 0;
  // Use LCS-based ratio (Rouge-L char level) for accuracy.
  const lcs = longestCommonSubsequence(e, a);
  const precision = lcs / a.length;
  const recall = lcs / e.length;
  if (precision + recall === 0) return 0;
  const f1 = (2 * precision * recall) / (precision + recall);
  return Math.max(0, Math.min(1, f1));
}

function longestCommonSubsequence(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  const prev = new Array<number>(n + 1).fill(0);
  const cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      cur[j] =
        a[i - 1] === b[j - 1]
          ? (prev[j - 1] ?? 0) + 1
          : Math.max(prev[j] ?? 0, cur[j - 1] ?? 0);
    }
    for (let j = 0; j <= n; j++) {
      prev[j] = cur[j] ?? 0;
      cur[j] = 0;
    }
  }
  return prev[n] ?? 0;
}

/** Frozen Phase-1 ASR gate normalization: NFC, then Unicode whitespace/punctuation removal. */
export function normalizeAsrGateText(text: string): string {
  return text.normalize('NFC').replace(/[\p{White_Space}\p{Punctuation}]/gu, '');
}

/** Unicode-code-point Levenshtein distance used by the release accuracy gate. */
export function levenshteinDistance(expected: string, actual: string): number {
  const a = Array.from(expected);
  const b = Array.from(actual);
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j] ?? 0;
  }
  return previous[b.length] ?? 0;
}

export interface AsrCorpusSample {
  id: string;
  reference: string;
  transcript: string;
  /** Tokens that must occur exactly after the same frozen normalization. */
  criticalTokens?: string[];
}

export interface AsrCorpusSampleResult {
  id: string;
  referenceCharacters: number;
  editDistance: number;
  criticalTokensPass: boolean;
  missingCriticalTokens: string[];
}

export interface AsrCorpusResult {
  accuracy: number;
  threshold: number;
  totalReferenceCharacters: number;
  totalEditDistance: number;
  criticalTokensPass: boolean;
  pass: boolean;
  samples: AsrCorpusSampleResult[];
}

/**
 * Frozen release gate: 1 - total Levenshtein edits / total reference chars,
 * plus exact critical-token presence. The legacy LCS helper above remains for
 * compatibility only and is deliberately not used here.
 */
export function evaluateAsrCorpus(
  samples: AsrCorpusSample[],
  threshold = 0.9,
): AsrCorpusResult {
  let totalReferenceCharacters = 0;
  let totalEditDistance = 0;
  const evaluated = samples.map((sample) => {
    const reference = normalizeAsrGateText(sample.reference);
    const transcript = normalizeAsrGateText(sample.transcript);
    const referenceCharacters = Array.from(reference).length;
    const editDistance = levenshteinDistance(reference, transcript);
    const missingCriticalTokens = (sample.criticalTokens ?? [])
      .map(normalizeAsrGateText)
      .filter((token) => token.length > 0 && !transcript.includes(token));
    totalReferenceCharacters += referenceCharacters;
    totalEditDistance += editDistance;
    return {
      id: sample.id,
      referenceCharacters,
      editDistance,
      criticalTokensPass: missingCriticalTokens.length === 0,
      missingCriticalTokens,
    };
  });
  const accuracy =
    totalReferenceCharacters === 0
      ? totalEditDistance === 0
        ? 1
        : 0
      : Math.max(0, 1 - totalEditDistance / totalReferenceCharacters);
  const criticalTokensPass = evaluated.every((sample) => sample.criticalTokensPass);
  return {
    accuracy,
    threshold,
    totalReferenceCharacters,
    totalEditDistance,
    criticalTokensPass,
    pass: accuracy >= threshold && criticalTokensPass,
    samples: evaluated,
  };
}
