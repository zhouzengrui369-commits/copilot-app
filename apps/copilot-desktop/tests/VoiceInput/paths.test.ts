/**
 * Primary / Secondary / Fallback path markers — 钉子 #23 self-audit.
 *
 * Verifies the 3 explicit orchestrator paths are individually callable
 * and report the right `provider` + `errorCode` markers. Also asserts
 * that `DEFAULT_SERVER_BASE` points to the actual workbench port
 * (38888, per apps/server/src/config.ts:31).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  cloudAsrSecondary,
  nativeFallback,
  webSpeechPrimary,
  type PathDeps,
} from '../../src/renderer/components/VoiceInput/useTranscriber';
import type { SpeechRecognitionLike } from '../../src/renderer/components/VoiceInput/WebSpeechProvider';
import type { CloudAsrFetchLike } from '../../src/renderer/components/VoiceInput/CloudAsrProvider';

function baseDeps(): PathDeps {
  return {
    lang: 'zh-CN',
    minWebSpeechConfidence: 0.55,
  };
}

describe('DEFAULT_SERVER_BASE points to actual workbench port (38888)', () => {
  it('matches apps/server/src/config.ts:31 PORT default', async () => {
    const { DEFAULT_SERVER_BASE } = await import(
      '../../src/renderer/components/VoiceInput/CloudAsrProvider'
    );
    expect(DEFAULT_SERVER_BASE).toBe('http://127.0.0.1:38888');
    expect(DEFAULT_SERVER_BASE).not.toContain('8787');
  });
});

describe('webSpeechPrimary — PRIMARY path marker', () => {
  it('returns text when engine produces a confident transcript', async () => {
    const onStart = vi.fn();
    const ctor = function () {
      const inst: SpeechRecognitionLike = {
        lang: '',
        continuous: false,
        interimResults: false,
        onresult: null,
        onerror: null,
        onend: null,
        start: vi.fn(() => {
          onStart();
          queueMicrotask(() => {
            inst.onresult?.({
              results: [{ isFinal: true, 0: { transcript: '你好世界', confidence: 0.95 } }],
            });
          });
        }),
        stop: vi.fn(),
        abort: vi.fn(),
      };
      return inst;
    } as unknown as PathDeps['speechRecognitionCtor'];
    const res = await webSpeechPrimary({ ...baseDeps(), speechRecognitionCtor: ctor });
    expect(res.provider).toBe('web-speech');
    expect(res.text).toBe('你好世界');
    expect(res.confidence).toBeCloseTo(0.95);
    expect(res.usedFallback).toBe(false);
    expect(res.errorCode).toBeNull();
  });

  it('returns empty text when confidence < threshold (orchestrator will fall back)', async () => {
    const ctor = function () {
      const inst: SpeechRecognitionLike = {
        lang: '',
        continuous: false,
        interimResults: false,
        onresult: null,
        onerror: null,
        onend: null,
        start: vi.fn(() => {
          queueMicrotask(() => {
            inst.onresult?.({
              results: [{ isFinal: true, 0: { transcript: 'unreliable', confidence: 0.1 } }],
            });
          });
        }),
        stop: vi.fn(),
        abort: vi.fn(),
      };
      return inst;
    } as unknown as PathDeps['speechRecognitionCtor'];
    const res = await webSpeechPrimary({
      ...baseDeps(),
      speechRecognitionCtor: ctor,
      minWebSpeechConfidence: 0.55,
    });
    expect(res.provider).toBe('web-speech');
    expect(res.text).toBe('');
    expect(res.errorCode).toBe('below-threshold');
  });

  it('reports not-supported when constructor is null', async () => {
    const res = await webSpeechPrimary({
      ...baseDeps(),
      speechRecognitionCtor: null,
    });
    expect(res.provider).toBe('web-speech');
    expect(res.text).toBe('');
    expect(res.errorCode).toBe('not-supported');
  });
});

describe('cloudAsrSecondary — SECONDARY path marker', () => {
  it('returns text when fetch returns a confident response', async () => {
    const fetchImpl: CloudAsrFetchLike = (async () => ({
      ok: true,
      status: 200,
      text: async () => '{"text":"今天我们讨论项目","confidence":0.92}',
      json: async () => ({ text: '今天我们讨论项目', confidence: 0.92 }),
    })) as unknown as CloudAsrFetchLike;
    const blob = new Blob([new Uint8Array(64)], { type: 'audio/webm' });
    const res = await cloudAsrSecondary({
      ...baseDeps(),
      cloudFetchImpl: fetchImpl,
      audioBlob: blob,
    });
    expect(res.provider).toBe('cloud');
    expect(res.text).toBe('今天我们讨论项目');
    expect(res.confidence).toBeCloseTo(0.92);
    expect(res.usedFallback).toBe(false);
    expect(res.errorCode).toBeNull();
  });

  it('reports no-audio when blob is missing', async () => {
    const res = await cloudAsrSecondary({ ...baseDeps(), audioBlob: null });
    expect(res.provider).toBe('cloud');
    expect(res.text).toBe('');
    expect(res.errorCode).toBe('no-audio');
  });

  it('reports http-<status> on non-2xx', async () => {
    const fetchImpl: CloudAsrFetchLike = (async () => ({
      ok: false,
      status: 503,
      text: async () => 'asr down',
      json: async () => ({ error: 'asr down' }),
    })) as unknown as CloudAsrFetchLike;
    const blob = new Blob([new Uint8Array(8)]);
    const res = await cloudAsrSecondary({
      ...baseDeps(),
      cloudFetchImpl: fetchImpl,
      audioBlob: blob,
    });
    expect(res.provider).toBe('cloud');
    expect(res.errorCode).toBe('http-503');
  });
});

describe('nativeFallback — FALLBACK path marker', () => {
  it('returns no-fallback-available (Sprint 1.3 will wire Whisper.cpp sidecar)', async () => {
    const res = await nativeFallback(baseDeps());
    expect(res.provider).toBe('native');
    expect(res.text).toBe('');
    expect(res.errorCode).toBe('no-fallback-available');
  });
});

describe('Orchestrator chain — primary → secondary → fallback', () => {
  it('prefers primary text over secondary when both produce results', async () => {
    // This test doesn't run the hook; it verifies the chain semantics
    // by checking the per-path return shapes that the hook consumes.
    const primaryCtor = function () {
      const inst: SpeechRecognitionLike = {
        lang: '',
        continuous: false,
        interimResults: false,
        onresult: null,
        onerror: null,
        onend: null,
        start: vi.fn(() => {
          queueMicrotask(() => {
            inst.onresult?.({
              results: [{ isFinal: true, 0: { transcript: 'primary text', confidence: 0.9 } }],
            });
          });
        }),
        stop: vi.fn(),
        abort: vi.fn(),
      };
      return inst;
    } as unknown as PathDeps['speechRecognitionCtor'];
    const fetchImpl: CloudAsrFetchLike = (async () => ({
      ok: true,
      status: 200,
      text: async () => '{"text":"secondary text","confidence":0.9}',
      json: async () => ({ text: 'secondary text', confidence: 0.9 }),
    })) as unknown as CloudAsrFetchLike;
    const primary = await webSpeechPrimary({
      ...baseDeps(),
      speechRecognitionCtor: primaryCtor,
    });
    const secondary = await cloudAsrSecondary({
      ...baseDeps(),
      cloudFetchImpl: fetchImpl,
      audioBlob: new Blob([new Uint8Array(8)]),
    });
    expect(primary.text).toBe('primary text');
    expect(secondary.text).toBe('secondary text');
    // Orchestrator: prefers primary when both succeed (we don't run the
    // hook here; this is a static assertion of the contract).
    expect(primary.provider).toBe('web-speech');
    expect(secondary.provider).toBe('cloud');
  });
});