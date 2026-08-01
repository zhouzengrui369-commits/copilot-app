import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import { PHASE1_RELEASE_EXCLUSIONS } from './phase1-release-scope.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

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
  },
});
