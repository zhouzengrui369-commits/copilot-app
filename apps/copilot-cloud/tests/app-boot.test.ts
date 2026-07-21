/**
 * Sanity: ensure the Fastify app boots end-to-end without errors.
 */
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/index.js';
import { buildTestConfig } from './helpers.js';

describe('app boot', () => {
  it('boots successfully with test config', async () => {
    const app = await buildApp({ config: buildTestConfig() });
    await app.ready();
    expect(app).toBeDefined();
    await app.close();
  });

  it('boots successfully with minimal config (auth disabled)', async () => {
    const app = await buildApp({
      config: buildTestConfig({
        auth: { enabled: false, sharedTokens: [] },
      }),
    });
    await app.ready();
    expect(app).toBeDefined();
    await app.close();
  });
});