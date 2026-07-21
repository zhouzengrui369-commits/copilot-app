import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { electronE2eJsonReportPath } from './tests/support/playwright-reporting.js';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: './test-results/electron-e2e-artifacts',
  reporter: [
    ['line'],
    ['json', { outputFile: electronE2eJsonReportPath(appRoot) }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
