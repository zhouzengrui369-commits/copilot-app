import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ELECTRON_LOCAL_ASR_BINDER_V1,
  LOCAL_ASR_RUNTIME_UNAVAILABLE,
  WebSpeechProvider,
  type LocalAsrRuntimeContext,
  type SpeechRecognitionCtor,
  type SpeechRecognitionLike,
} from '../../src/renderer/components/VoiceInput/WebSpeechProvider';
import { useTranscriber } from '../../src/renderer/components/VoiceInput/useTranscriber';

const CHROME_139_UA =
  'Mozilla/5.0 AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36';
const ELECTRON_38_UA =
  'Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.7339.249 Electron/38.8.6 Safari/537.36';

function trustedElectron(
  capabilities: readonly (typeof ELECTRON_LOCAL_ASR_BINDER_V1)[] = [],
): LocalAsrRuntimeContext {
  return {
    trustedMeta: {
      source: 'electron-preload-process-versions',
      shell: 'electron',
      electronVersion: '38.8.6',
      chromiumVersion: '140.0.7339.249',
      localAsrCapabilities: capabilities,
    },
    userAgent: CHROME_139_UA,
  };
}

function browser139(): LocalAsrRuntimeContext {
  return { trustedMeta: null, userAgent: CHROME_139_UA };
}

function guardedCtor() {
  const available = vi.fn(async () => 'available' as const);
  const install = vi.fn(async () => true);
  const start = vi.fn();
  const ctor: SpeechRecognitionCtor = function () {
    return {
      lang: '',
      continuous: false,
      interimResults: false,
      processLocally: false,
      onresult: null,
      onerror: null,
      onend: null,
      start,
      stop: vi.fn(),
      abort: vi.fn(),
    } satisfies SpeechRecognitionLike;
  } as unknown as SpeechRecognitionCtor;
  ctor.available = available;
  ctor.install = install;
  return { ctor, available, install, start };
}

describe('ASR R4 Electron crash guard', () => {
  it('blocks Electron from touching available/install/start even when the API surface exists', async () => {
    const harness = guardedCtor();
    const provider = new WebSpeechProvider(harness.ctor, trustedElectron());

    await expect(provider.prepareLocal('zh-CN')).resolves.toBe(
      LOCAL_ASR_RUNTIME_UNAVAILABLE,
    );
    await expect(
      provider.transcribe({ strictLocal: true }),
    ).rejects.toMatchObject({ code: LOCAL_ASR_RUNTIME_UNAVAILABLE });
    expect(harness.available).not.toHaveBeenCalled();
    expect(harness.install).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
  });

  it('prevents getUserMedia and leaves renderer state resettable after a blocked start', async () => {
    const harness = guardedCtor();
    const getUserMediaImpl = vi.fn();
    const hook = renderHook(() =>
      useTranscriber({
        speechRecognitionCtor: harness.ctor,
        getUserMediaImpl,
        localAsrRuntimeContext: trustedElectron(),
      }),
    );

    await act(async () => hook.result.current.start());
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    expect(hook.result.current.result?.errorCode).toBe(
      LOCAL_ASR_RUNTIME_UNAVAILABLE,
    );
    expect(harness.available).not.toHaveBeenCalled();
    expect(harness.install).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
    expect(getUserMediaImpl).not.toHaveBeenCalled();

    act(() => hook.result.current.reset());
    expect(hook.result.current.status).toBe('idle');
    expect(hook.result.current.result).toBeNull();
  });

  it.each([
    ['Electron UA without trusted metadata', { trustedMeta: null, userAgent: ELECTRON_38_UA }],
    ['unknown runtime', { trustedMeta: null, userAgent: 'unknown-shell/1.0' }],
    ['Chrome 138', { trustedMeta: null, userAgent: 'Chrome/138.0.0.0' }],
  ] satisfies Array<[string, LocalAsrRuntimeContext]>)('%s fails closed', async (_label, runtime) => {
    const harness = guardedCtor();
    await expect(
      new WebSpeechProvider(harness.ctor, runtime).prepareLocal(),
    ).resolves.toBe(LOCAL_ASR_RUNTIME_UNAVAILABLE);
    expect(harness.available).not.toHaveBeenCalled();
  });

  it('trusted Electron metadata outranks a spoofed Chrome 139 UA', async () => {
    const harness = guardedCtor();
    await expect(
      new WebSpeechProvider(harness.ctor, trustedElectron()).prepareLocal(),
    ).resolves.toBe(LOCAL_ASR_RUNTIME_UNAVAILABLE);
    expect(harness.available).not.toHaveBeenCalled();
  });

  it('preserves Chrome 139+ non-Electron strict-local available probing', async () => {
    const harness = guardedCtor();
    await expect(
      new WebSpeechProvider(harness.ctor, browser139()).prepareLocal('zh-CN'),
    ).resolves.toBe('available');
    expect(harness.available).toHaveBeenCalledWith({
      langs: ['zh-CN'],
      processLocally: true,
    });
  });

  it('allows a future Electron binder only through the explicit trusted capability allowlist', async () => {
    const harness = guardedCtor();
    await expect(
      new WebSpeechProvider(
        harness.ctor,
        trustedElectron([ELECTRON_LOCAL_ASR_BINDER_V1]),
      ).prepareLocal('zh-CN'),
    ).resolves.toBe('available');
    expect(harness.available).toHaveBeenCalledTimes(1);
  });
});
