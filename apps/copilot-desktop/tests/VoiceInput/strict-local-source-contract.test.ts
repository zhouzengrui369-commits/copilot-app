import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as asrMetrics from '../../src/renderer/components/VoiceInput/CloudAsrProvider';
import {
  WebSpeechProvider,
  type SpeechRecognitionCtor,
  type SpeechRecognitionLike,
} from '../../src/renderer/components/VoiceInput/WebSpeechProvider';
import { CHROME_139_LOCAL_ASR_RUNTIME } from './local-asr-test-runtime';

function strictLocalCtor() {
  const instances: SpeechRecognitionLike[] = [];
  const ctor = function () {
    const inst = {
      lang: '',
      continuous: false,
      interimResults: false,
      processLocally: false,
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: vi.fn(() => {
        queueMicrotask(() => inst.onend?.());
      }),
      abort: vi.fn(),
    } as SpeechRecognitionLike & { processLocally: boolean };
    instances.push(inst);
    return inst;
  } as unknown as SpeechRecognitionCtor;
  ctor.available = vi.fn(async () => 'available' as const);
  return { ctor, instances };
}

describe('strict-local ASR source contract', () => {
  it('prepares one forced-local recognition instance and stop ends that same session', async () => {
    const { ctor, instances } = strictLocalCtor();
    const provider = new WebSpeechProvider(ctor, CHROME_139_LOCAL_ASR_RUNTIME);

    const availability = await (
      provider as unknown as { prepareLocal(language: string): Promise<string> }
    ).prepareLocal('zh-CN');
    expect(availability).toBe('available');

    const pending = provider.transcribe({ language: 'zh-CN' });
    expect(instances).toHaveLength(1);
    expect((instances[0] as unknown as { processLocally: boolean }).processLocally).toBe(true);

    (provider as unknown as { stop(): void }).stop();
    await expect(pending).resolves.toEqual({ text: '', confidence: -1 });
    expect(instances[0]?.stop).toHaveBeenCalledOnce();
    expect(instances[0]?.abort).not.toHaveBeenCalled();
    expect(instances).toHaveLength(1);
  });

  it('fails closed when the forced-local availability API is missing', async () => {
    const ctor = function () {
      return {
        lang: '',
        continuous: false,
        interimResults: false,
        onresult: null,
        onerror: null,
        onend: null,
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
      } as SpeechRecognitionLike;
    } as unknown as SpeechRecognitionCtor;
    const provider = new WebSpeechProvider(ctor, CHROME_139_LOCAL_ASR_RUNTIME);

    await expect(
      (provider as unknown as { prepareLocal(language: string): Promise<string> }).prepareLocal(
        'zh-CN',
      ),
    ).resolves.toBe('local-api-unavailable');
  });

  it('uses frozen NFC plus punctuation/whitespace removal and Levenshtein accuracy', () => {
    const api = asrMetrics as unknown as {
      normalizeAsrGateText?: (text: string) => string;
      evaluateAsrCorpus?: (samples: unknown[], threshold?: number) => {
        accuracy: number;
        criticalTokensPass: boolean;
        pass: boolean;
      };
    };
    expect(typeof api.normalizeAsrGateText).toBe('function');
    expect(typeof api.evaluateAsrCorpus).toBe('function');
    expect(api.normalizeAsrGateText?.(' cafe\u0301， 下午 3 点！')).toBe('café下午3点');

    const result = api.evaluateAsrCorpus?.(
      [
        {
          id: 'critical-token',
          reference: '下午三点提醒我开会',
          transcript: '下午四点提醒我开会',
          criticalTokens: ['三点'],
        },
      ],
      0.8,
    );
    expect(result?.accuracy).toBeCloseTo(8 / 9);
    expect(result?.criticalTokensPass).toBe(false);
    expect(result?.pass).toBe(false);
  });

  it('owns explicit microphone and speech-recognition purpose strings', () => {
    const configPath = `${process.cwd()}/electron-builder.yml`;
    const config = readFileSync(configPath, 'utf8');
    expect(config).toContain('NSMicrophoneUsageDescription:');
    expect(config).toContain('NSSpeechRecognitionUsageDescription:');
    expect(config).toContain('不会自动上传音频');
  });
});
