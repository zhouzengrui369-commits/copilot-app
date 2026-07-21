// vitest config for @copilot/rag — minimal, uses Node test environment.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    reporters: ['default'],
  },
});
