import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/release-identity-evidence.test.ts',
      'tests/post-package-evidence.test.ts',
    ],
    maxWorkers: 2,
    minWorkers: 1,
    fileParallelism: true,
  },
});
