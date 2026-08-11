import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

/** Strict C6 gate for the main-process Shared Engine runtime adapter. */
export default defineConfig({
  root: appRoot,
  test: {
    environment: 'node',
    include: ['tests/shared-engine-runtime-adapter.test.ts'],
    minWorkers: 1,
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage/shared-engine-runtime',
      include: ['src/main/shared-engine-runtime-adapter.ts'],
      thresholds: {
        perFile: true,
        statements: 90,
        lines: 90,
        branches: 90,
        functions: 90,
      },
    },
  },
});
