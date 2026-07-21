import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

/** Per-file release gate for the stateless cloud trust boundary. */
export default defineConfig({
  root: packageRoot,
  test: {
    globals: false,
    environment: 'node',
    include: [
      'tests/auth-rate-limit.test.ts',
      'tests/production-security.test.ts',
      'tests/route-edge.test.ts',
      'tests/v1-chat.test.ts',
      'tests/v1-embeddings.test.ts',
      'tests/cloudbase-relay.test.ts',
      'tests/backup-a-presign.test.ts',
      'tests/integration/backup-a-stateless-boundary.integration.test.ts',
      'tests/remote-a-relay.test.ts',
      'tests/integration/stateless-boundary.integration.test.ts',
    ],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage/critical',
      include: [
        'src/middleware/auth.ts',
        'src/routes/proxy-errors.ts',
        'src/routes/request-contract.ts',
        'src/routes/v1-chat.ts',
        'src/routes/v1-embeddings.ts',
        'src/relay/cloudbase-handler.ts',
        'src/backup/backup-a-presign.ts',
        'src/backup/backup-a-route.ts',
        'src/remote/remote-a-relay.ts',
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
