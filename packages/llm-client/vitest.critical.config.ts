import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

/** Per-file gate for LLM failure handling and streaming correctness. */
export default defineConfig({
  root: packageRoot,
  test: {
    environment: 'node',
    globals: false,
    include: [
      'tests/retry.test.ts',
      'tests/token-limit.test.ts',
      'tests/stream-parser.test.ts',
      'tests/errors.test.ts',
      'tests/stream-and-errors-edge.test.ts',
    ],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage/critical',
      include: [
        'src/middleware/retry.ts',
        'src/middleware/token-limit.ts',
        'src/middleware/stream-parser.ts',
        'src/util/errors.ts',
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
