import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Whole-workspace production gate. Keep every executable TypeScript source in
 * scope so the headline percentage cannot be inflated by selecting only the
 * renderer or already-tested modules. Declaration files contain no executable
 * statements and are the only source files omitted.
 */
export default defineConfig({
  root: appRoot,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
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
