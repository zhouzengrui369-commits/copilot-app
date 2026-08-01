import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import { PHASE1_RELEASE_EXCLUSIONS } from './phase1-release-scope.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

/** Strict per-file gate for the Phase 1 local-first product boundary. */
export default defineConfig({
  root: appRoot,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, ...PHASE1_RELEASE_EXCLUSIONS],
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
