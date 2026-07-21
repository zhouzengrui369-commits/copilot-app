import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetSettingsStoreForTests } from '../src/renderer/stores/settings';

// jsdom does not implement window.confirm by default — SettingsPanel calls
// it from the Reset button click handler. A noop stub is enough because the
// component uses it as a boolean gate.
if (typeof window !== 'undefined' && typeof window.confirm !== 'function') {
  window.confirm = () => true;
}

beforeEach(() => {
  // Reset the Zustand store between tests so prior hydrate() calls don't
  // leak hydrated=true into the next test (jsdom shares the module
  // registry and therefore the same store singleton).
  resetSettingsStoreForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});