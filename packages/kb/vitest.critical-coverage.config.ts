import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

/** Strict baseline gate for both tracked Phase-1 local persistence stores. */
export default defineConfig({
  root: packageRoot,
  test: {
    include: [
      'tests/md-file-store.test.ts',
      'tests/md-file-store-edge.test.ts',
      'tests/sqlite-store.test.ts',
      'tests/body-integrity-fail-closed.test.ts',
      'tests/write-integrity-fail-closed.test.ts',
      'tests/reversible-trash.test.ts',
      'tests/reversible-trash-r2-integrity.test.ts',
      'tests/reversible-trash-r3-lease-integrity.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage/critical',
      include: ['src/store/md-file-store.ts', 'src/store/sqlite-store.ts'],
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
