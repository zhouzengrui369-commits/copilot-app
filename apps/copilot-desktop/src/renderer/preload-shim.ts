/**
 * preload-shim.ts — type-only re-export of the preload contract so the
 * renderer can `import type { CopilotBridge }` without bundling electron.
 * The actual runtime object is injected by the main process via
 * contextBridge under `window.copilot`.
 */
import type { CopilotBridge } from '../main/preload';

declare global {
  interface Window {
    copilot?: CopilotBridge;
  }
}

export type { CopilotBridge };