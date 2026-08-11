/**
 * preload-shim.ts — type-only re-export of the preload contract so the
 * renderer can `import type { CopilotBridge }` without bundling electron.
 * The actual runtime object is injected by the main process via
 * contextBridge under `window.copilot`.
 */
import type { CopilotBridge } from '../main/preload';
import type { CopilotProductApi } from './lib/copilot-api.js';

export type BrowserPrototypeScenario = 'ready' | 'empty' | 'failure';

export interface BrowserPrototypeRuntime {
  api: CopilotProductApi;
  scenario: BrowserPrototypeScenario;
  label: 'PROTOTYPE / NOT_RUNTIME_PROOF';
}

declare global {
  interface Window {
    copilot?: CopilotBridge;
    __COPILOT_BROWSER_PROTOTYPE__?: BrowserPrototypeRuntime;
  }
}

export type { CopilotBridge };
