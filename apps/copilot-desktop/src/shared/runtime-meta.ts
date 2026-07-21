/**
 * Renderer-safe runtime facts supplied by the isolated Electron preload.
 * Capabilities are deny-by-default: observing a Chromium API surface is not
 * sufficient evidence that Electron registered the matching Mojo binder.
 */
export const ELECTRON_LOCAL_ASR_BINDER_V1 =
  'electron-local-asr-binder-v1' as const;

export type ElectronRuntimeCapability =
  typeof ELECTRON_LOCAL_ASR_BINDER_V1;

export interface ElectronRuntimeMeta {
  source: 'electron-preload-process-versions';
  shell: 'electron';
  electronVersion: string;
  chromiumVersion: string;
  localAsrCapabilities: readonly ElectronRuntimeCapability[];
}
