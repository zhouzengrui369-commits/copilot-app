import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

/** Per-file gate for KG extraction, construction, persistence and query. */
export default defineConfig({
  root: packageRoot,
  test: {
    include: [
      'tests/coverage-closure.test.ts',
      'tests/entity-extractor.test.ts',
      'tests/functional-runtime.test.ts',
      'tests/kg-builder.integration.test.ts',
      'tests/migration.test.ts',
      'tests/sqlite-store.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage/critical',
      include: [
        'src/builder/kg-builder.ts',
        'src/builder/entity-extractor.ts',
        'src/builder/relation-extractor.ts',
        'src/builder/summarizer.ts',
        'src/builder/tagger.ts',
        'src/store/sqlite-store.ts',
        'src/store/migration.ts',
        'src/api/query.ts',
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
