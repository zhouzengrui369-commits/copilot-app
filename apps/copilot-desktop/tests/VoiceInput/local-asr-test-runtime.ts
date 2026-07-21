import type { LocalAsrRuntimeContext } from '../../src/renderer/components/VoiceInput/WebSpeechProvider';

/** Explicit browser fixture for legacy strict-local tests; production never imports this. */
export const CHROME_139_LOCAL_ASR_RUNTIME = {
  trustedMeta: null,
  userAgent: 'Mozilla/5.0 AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36',
} satisfies LocalAsrRuntimeContext;
