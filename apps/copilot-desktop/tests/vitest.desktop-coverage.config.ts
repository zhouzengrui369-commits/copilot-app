import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import { PHASE1_RELEASE_EXCLUSIONS } from './phase1-release-scope.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Phase 1 whole-product source coverage. Owner-deferred and superseded
 * historical fixtures are listed with explicit rationale in one shared scope.
 */
export default defineConfig({
  root: appRoot,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, ...PHASE1_RELEASE_EXCLUSIONS],
    minWorkers: 1,
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage/desktop',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        statements: 70,
        lines: 70,
        branches: 70,
        functions: 70,
      },
    },
  },
});
