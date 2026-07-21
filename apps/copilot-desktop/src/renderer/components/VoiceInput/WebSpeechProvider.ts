/**
 * WebSpeechProvider.ts — Promise-based wrapper around the platform's
 * SpeechRecognition (Chromium / WebKit / Electron renderer).
 *
 * Sprint 1.2 / T-1.2.4 — voice input. End-side ASR (zh-CN default).
 * The desktop process owns no ASR credentials — this provider runs
 * entirely in the renderer and uses the OS engine (macOS Siri).
 *
 * Design contract (kept small so tests can mock it cleanly):
 *   - `transcribe(opts)` resolves with `{text, confidence}` when the
 *     engine emits a final result, or rejects with `WebSpeechError`.
 *   - `isAvailable()` is pure feature detection.
 *   - The class is single-use per session (the underlying API is
 *     stateful). Construct a fresh one per recording.
 */

import {
  ELECTRON_LOCAL_ASR_BINDER_V1,
  type ElectronRuntimeMeta,
} from '../../../shared/runtime-meta';

export { ELECTRON_LOCAL_ASR_BINDER_V1 };

export const LOCAL_ASR_RUNTIME_UNAVAILABLE =
  'LOCAL_ASR_RUNTIME_UNAVAILABLE' as const;

export interface LocalAsrRuntimeContext {
  /** Present only when supplied by the isolated Electron preload. */
  trustedMeta?: ElectronRuntimeMeta | null;
  /** UA is fallback evidence for a real non-Electron Chrome browser only. */
  userAgent?: string | null;
}

export interface Transcript {
  /** Final transcript text. Empty string = no speech detected. */
  text: string;
  /** Engine-reported confidence in [0,1]. -1 when the engine omitted it. */
  confidence: number;
}

export interface TranscribeOptions {
  /** BCP-47 tag. Default 'zh-CN'. */
  language?: string;
  /** Fire onPartial for interim results. Default false. */
  interim?: boolean;
  onPartial?: (text: string) => void;
  /** AbortSignal for in-flight cancel. */
  signal?: AbortSignal;
  /** Require a previously prepared, forced-local recognition instance. */
  strictLocal?: boolean;
  /** Bound a recognition session so stop/end races cannot hang forever. */
  timeoutMs?: number;
}

/** Minimal engine event we depend on. */
export interface SpeechRecognitionResultEvent {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence: number };
  }>;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  /** Chrome 139+ forced on-device WebSpeech flag (absent in Electron 33). */
  processLocally?: boolean;
  onresult: ((evt: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((evt: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
  available?(options: {
    langs: string[];
    processLocally: true;
  }): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  install?(options: {
    langs: string[];
    processLocally: true;
  }): Promise<boolean>;
}

export type LocalSpeechAvailability =
  | 'available'
  | 'local-api-unavailable'
  | 'local-model-downloadable'
  | 'local-model-downloading'
  | 'local-model-unavailable'
  | 'local-availability-error'
  | 'local-prepare-aborted'
  | typeof LOCAL_ASR_RUNTIME_UNAVAILABLE;

export class WebSpeechError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'WebSpeechError';
    this.code = code;
  }
}

function pickCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function readRuntimeContext(): LocalAsrRuntimeContext {
  if (typeof window === 'undefined') {
    return { trustedMeta: null, userAgent: null };
  }
  const trustedMeta = (
    window as unknown as {
      copilot?: { meta?: { runtime?: ElectronRuntimeMeta } };
    }
  ).copilot?.meta?.runtime;
  return {
    trustedMeta: trustedMeta ?? null,
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
  };
}

/**
 * Fail closed unless the environment is either a proven non-Electron
 * Chrome/Chromium 139+ browser, or a future Electron build whose trusted
 * preload explicitly allowlists the local-speech binder capability.
 */
export function isLocalAsrRuntimeAllowed(
  context: LocalAsrRuntimeContext,
): boolean {
  const trusted = context.trustedMeta;
  if (trusted) {
    return (
      trusted.source === 'electron-preload-process-versions' &&
      trusted.shell === 'electron' &&
      trusted.localAsrCapabilities.includes(ELECTRON_LOCAL_ASR_BINDER_V1)
    );
  }

  const userAgent = context.userAgent ?? '';
  if (/\bElectron\//i.test(userAgent)) return false;
  const chrome = userAgent.match(/\b(?:Chrome|Chromium)\/(\d+)(?:\.|\b)/i);
  return chrome !== null && Number(chrome[1]) >= 139;
}

export class WebSpeechProvider {
  readonly name = 'webspeech' as const;
  private readonly ctor: SpeechRecognitionCtor | null;
  private readonly runtimeContext: LocalAsrRuntimeContext;
  private instance: SpeechRecognitionLike | null = null;
  private signalListener: (() => void) | null = null;
  private settleAbort: (() => void) | null = null;

  constructor(
    ctor?: SpeechRecognitionCtor | null,
    runtimeContext?: LocalAsrRuntimeContext,
  ) {
    this.ctor = ctor === undefined ? pickCtor() : ctor;
    this.runtimeContext = runtimeContext ?? readRuntimeContext();
  }

  isAvailable(): boolean {
    return this.ctor !== null;
  }

  /**
   * Prove forced-local support before microphone capture. The instance created
   * here is the exact instance later started by transcribe(); no probe session
   * is discarded and no remote WebSpeech fallback is permitted.
   */
  async prepareLocal(
    language = 'zh-CN',
    signal?: AbortSignal,
  ): Promise<LocalSpeechAvailability> {
    if (!isLocalAsrRuntimeAllowed(this.runtimeContext)) {
      return LOCAL_ASR_RUNTIME_UNAVAILABLE;
    }
    if (signal?.aborted) return 'local-prepare-aborted';
    if (!this.ctor || typeof this.ctor.available !== 'function') {
      return 'local-api-unavailable';
    }
    let availability: 'available' | 'downloadable' | 'downloading' | 'unavailable';
    try {
      availability = await this.ctor.available({
        langs: [language],
        processLocally: true,
      });
    } catch {
      return 'local-availability-error';
    }
    if (signal?.aborted) return 'local-prepare-aborted';
    if (availability !== 'available') {
      return `local-model-${availability}` as LocalSpeechAvailability;
    }
    let inst: SpeechRecognitionLike;
    try {
      inst = new this.ctor();
    } catch {
      return 'local-api-unavailable';
    }
    if (!('processLocally' in inst)) {
      return 'local-api-unavailable';
    }
    inst.processLocally = true;
    this.instance = inst;
    return 'available';
  }

  /**
   * Run one recognition session. Resolves on the first `isFinal`
   * result, or rejects on error/abort.
   */
  transcribe(opts: TranscribeOptions = {}): Promise<Transcript> {
    if (opts.strictLocal && !isLocalAsrRuntimeAllowed(this.runtimeContext)) {
      return Promise.reject(
        new WebSpeechError(
          LOCAL_ASR_RUNTIME_UNAVAILABLE,
          'local ASR is unavailable in this runtime',
        ),
      );
    }
    if (!this.ctor) {
      return Promise.reject(
        new WebSpeechError('not-supported', 'SpeechRecognition unavailable'),
      );
    }
    const inst = this.instance ?? new this.ctor();
    if (opts.strictLocal && inst.processLocally !== true) {
      return Promise.reject(
        new WebSpeechError(
          'local-api-unavailable',
          'forced local SpeechRecognition unavailable',
        ),
      );
    }
    this.instance = inst;
    inst.lang = opts.language ?? 'zh-CN';
    inst.continuous = false;
    inst.interimResults = opts.interim === true;
    inst.onerror = null;
    inst.onresult = null;
    inst.onend = null;

    return new Promise<Transcript>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timeout !== null) clearTimeout(timeout);
        if (opts.signal && this.signalListener) {
          opts.signal.removeEventListener('abort', this.signalListener);
          this.signalListener = null;
        }
        this.settleAbort = null;
        try {
          inst.onresult = null;
          inst.onerror = null;
          inst.onend = null;
        } catch {
          /* mock may not be assignable */
        }
        fn();
      };

      inst.onresult = (evt: SpeechRecognitionResultEvent) => {
        // Process all entries: fire onPartial for any interim result,
        // then resolve on the first final one.
        let lastFinal: { text: string; confidence: number } | null = null;
        for (let i = 0; i < evt.results.length; i++) {
          const r = evt.results[i];
          if (!r) continue;
          const alt = r[0];
          if (!alt) continue;
          if (r.isFinal) {
            lastFinal = {
              text: (alt.transcript ?? '').trim(),
              confidence: typeof alt.confidence === 'number' ? alt.confidence : -1,
            };
          } else if (inst.interimResults && opts.onPartial) {
            opts.onPartial(alt.transcript);
          }
        }
        if (lastFinal) {
          finish(() => resolve(lastFinal!));
        }
      };

      inst.onerror = (evt: { error?: string; message?: string }) => {
        finish(() =>
          reject(new WebSpeechError(evt.error ?? 'error', evt.message)),
        );
      };

      inst.onend = () => {
        // Some engines fire onend without a final result (e.g. silence).
        // Resolve with empty text so the orchestrator can fall back.
        finish(() => resolve({ text: '', confidence: -1 }));
      };

      if (opts.signal) {
        const listener = () => {
          try {
            inst.abort();
          } catch {
            /* ignore */
          }
          finish(() => reject(new WebSpeechError('aborted', 'aborted')));
        };
        if (opts.signal.aborted) {
          listener();
          return;
        }
        opts.signal.addEventListener('abort', listener);
        this.signalListener = listener;
      }

      this.settleAbort = () => {
        finish(() => reject(new WebSpeechError('aborted', 'aborted')));
      };

      const timeoutMs = opts.timeoutMs ?? 15_000;
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timeout = setTimeout(() => {
          finish(() =>
            reject(new WebSpeechError('recognition-timeout', 'recognition timed out')),
          );
          try {
            inst.stop();
          } catch {
            /* ignore */
          }
        }, timeoutMs);
      }

      try {
        inst.start();
      } catch (err) {
        finish(() =>
          reject(
            new WebSpeechError(
              'start-failed',
              err instanceof Error ? err.message : 'start failed',
            ),
          ),
        );
      }

    });
  }

  /** End the active session and let its own onresult/onend settle the promise. */
  stop(): void {
    if (!this.instance) return;
    try {
      this.instance.stop();
    } catch {
      /* idempotent stop */
    }
  }

  /** Cancel an in-flight session. Idempotent. */
  abort(): void {
    if (this.instance) {
      try {
        this.instance.abort();
      } catch {
        /* ignore */
      }
    }
    this.settleAbort?.();
  }
}
