import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

/** Strict per-file gate for the v0.3 C1 storage-neutral contract boundary. */
export default defineConfig({
  root: packageRoot,
  test: {
    include: ['tests/shared-engine-*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage/shared-engine',
      include: [
        'src/shared-engine/adapters.ts',
        'src/shared-engine/contract.ts',
        'src/shared-engine/identity.ts',
        'src/shared-engine/policy.ts',
        'src/shared-engine/write-proposal.ts',
      ],
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
