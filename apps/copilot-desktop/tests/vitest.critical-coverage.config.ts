import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

/** Strict baseline gate for the local service, IPC and renderer adapter. */
export default defineConfig({
  root: appRoot,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/**/*.test.{ts,tsx}',
      'tests/backup/**/*.test.{ts,tsx}',
      'tests/remote/**/*.test.{ts,tsx}',
      'tests/integration/reversible-trash-source-r1.integration.test.ts',
    ],
    minWorkers: 1,
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage/critical',
      include: [
        'src/main/local-knowledge-service.ts',
        'src/main/domain-ipc.ts',
        'src/main/media-permission.ts',
        'src/main/preload.ts',
        'src/main/backup-integration/manager.ts',
        'src/main/backup-integration/repository.ts',
        'src/main/backup-integration/native-keyring-credential-store.ts',
        'src/main/backup-integration/safe-storage-credential-store.ts',
        'src/main/backup-integration/production-runtime.ts',
        'src/main/remote/pairing.ts',
        'src/main/remote/session-crypto.ts',
        'src/main/remote/desktop-signer.ts',
        'src/main/remote/native-credential-store.ts',
        'src/main/remote/online-client.ts',
        'src/main/remote/controller.ts',
        'src/main/remote/production-runtime.ts',
        'src/main/remote/local-adapter.ts',
        'src/renderer/components/NoteDetail/MarkdownRenderer.tsx',
        'src/renderer/components/VoiceInput/audio-pcm.ts',
        'src/renderer/components/VoiceInput/useLocalAsrCapture.ts',
        'src/renderer/components/VoiceInput/index.tsx',
        'src/renderer/lib/copilot-api.ts',
        'src/renderer/workspaces/AskWorkspace.tsx',
        'src/renderer/workspaces/ScheduleWorkspace.tsx',
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
