/**
 * CloudAsrProvider tests — mock fetch and verify POST shape, error
 * mapping, character-accuracy computation, and parse tolerance.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CloudAsrProvider,
  type CloudAsrFetchLike,
  characterAccuracy,
  makeCloudAsrError,
  parseCloudResponse,
} from '../../src/renderer/components/VoiceInput/CloudAsrProvider';

function makeFetch(impl: CloudAsrFetchLike): CloudAsrFetchLike {
  return impl;
}

describe('CloudAsrProvider', () => {
  it('POSTs to /api/asr/transcribe and returns parsed text', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { body?: FormData }) => {
      // verify form-data was attached
      expect(init?.body).toBeInstanceOf(FormData);
      return {
        ok: true,
        status: 200,
        text: async () => '{"text":"你好世界","confidence":0.97,"engine":"tencent"}',
        json: async () => ({ text: '你好世界', confidence: 0.97, engine: 'tencent' }),
      };
    }) as unknown as CloudAsrFetchLike;
    const p = new CloudAsrProvider({
      fetchImpl: makeFetch(fetchMock),
      serverBaseUrl: 'http://127.0.0.1:8787',
    });
    const blob = new Blob([new Uint8Array(64)], { type: 'audio/webm' });
    const res = await p.transcribe(blob, { language: 'zh-CN' });
    expect(res.text).toBe('你好世界');
    expect(res.confidence).toBeCloseTo(0.97);
    expect(res.engine).toBe('tencent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on empty audio', async () => {
    const fetchMock = vi.fn();
    const p = new CloudAsrProvider({ fetchImpl: makeFetch(fetchMock) });
    await expect(p.transcribe(new Blob([], { type: 'audio/webm' }))).rejects.toMatchObject({
      code: 'empty-audio',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps non-2xx to http-<status> error', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => 'asr disabled',
      json: async () => ({ error: 'asr disabled' }),
    }));
    const p = new CloudAsrProvider({ fetchImpl: makeFetch(fetchMock) });
    await expect(
      p.transcribe(new Blob([new Uint8Array(8)])),
    ).rejects.toMatchObject({ code: 'http-503', status: 503 });
  });

  it('maps network error to network code', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const p = new CloudAsrProvider({ fetchImpl: makeFetch(fetchMock) });
    await expect(
      p.transcribe(new Blob([new Uint8Array(8)])),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('maps invalid JSON to bad-json code', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'not-json',
      json: async () => {
        throw new Error('parse fail');
      },
    }));
    const p = new CloudAsrProvider({ fetchImpl: makeFetch(fetchMock) });
    await expect(
      p.transcribe(new Blob([new Uint8Array(8)])),
    ).rejects.toMatchObject({ code: 'bad-json' });
  });

  it('health() returns ok=false on network error', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline');
    });
    const p = new CloudAsrProvider({ fetchImpl: makeFetch(fetchMock) });
    const h = await p.health();
    expect(h.ok).toBe(false);
  });
});

describe('parseCloudResponse', () => {
  it('parses the standard envelope', () => {
    expect(parseCloudResponse({ text: 'hi', confidence: 0.8 })).toMatchObject({
      text: 'hi',
      confidence: 0.8,
    });
  });
  it('falls back to transcript/result keys', () => {
    expect(parseCloudResponse({ transcript: 'B', result: 'C' })).toMatchObject({
      text: 'C',
    });
  });
  it('throws on non-object', () => {
    expect(() => parseCloudResponse('hi')).toThrow();
  });
  it('builds a CloudAsrError', () => {
    const e = makeCloudAsrError('x', 'y', 503);
    expect(e.code).toBe('x');
    expect(e.status).toBe(503);
    expect(e.name).toBe('CloudAsrError');
  });
});

describe('characterAccuracy', () => {
  it('returns 1 for identical strings', () => {
    expect(characterAccuracy('你好世界', '你好世界')).toBe(1);
  });
  it('is case + whitespace insensitive', () => {
    expect(characterAccuracy('Hello World', 'hello  world')).toBe(1);
  });
  it('returns 0 when expected is non-empty but actual is empty', () => {
    expect(characterAccuracy('hello', '')).toBe(0);
  });
  it('returns 1 when both empty', () => {
    expect(characterAccuracy('', '')).toBe(1);
  });
  it('handles Chinese (NFKC) normalisation', () => {
    expect(characterAccuracy('你好', '你好')).toBe(1);
  });
  it('penalises partial matches gracefully', () => {
    const a = characterAccuracy('今天的会议重点', '今天的会议');
    expect(a).toBeGreaterThan(0.6);
    expect(a).toBeLessThan(1);
  });
});