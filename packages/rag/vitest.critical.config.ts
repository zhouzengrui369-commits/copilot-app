import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: packageRoot,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      enabled: true,
      provider: 'v8',
      include: [
        'src/answerer.ts',
        'src/indexer.ts',
        'src/vector-store.ts',
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage/critical',
      thresholds: {
        perFile: true,
        branches: 90,
        lines: 90,
      },
    },
  },
});
