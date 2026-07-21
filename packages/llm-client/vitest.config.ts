import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/types.ts',
        'src/providers/types.ts',
      ],
      thresholds: {
        // Global gate. The separate critical config enforces ≥90% per file for
        // retry, token limiting, error mapping and streaming parsing.
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
