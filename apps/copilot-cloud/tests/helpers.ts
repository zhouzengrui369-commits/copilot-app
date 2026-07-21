/**
 * Test fixtures + helpers.
 */
import type { ServerConfig } from '../src/config.js';

export function buildTestConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    version: '0.1.0-test',
    logLevel: 'error',
    corsOrigins: ['https://test-client.example'],
    trustProxy: false,
    trustProxyContract: 'none',
    rateLimitMax: 1000,
    rateLimitWindowMs: 60_000,
    auth: {
      enabled: true,
      sharedTokens: ['test-token-1', 'test-token-2'],
    },
    llm: {
      baseUrl: 'http://fake-llm.test/v1',
      apiKey: 'sk-test-12345',
      chatPath: '/chat/completions',
      embeddingsPath: '/embeddings',
      timeoutMs: 5_000,
    },
    cloudbase: {
      relayEnabled: true,
      relayPath: '/cloudbase-relay',
    },
    remote: {
      enabled: false,
      path: '/v1/remote/ws',
    },
    backup: {
      enabled: false,
      path: '/v1/backup/presign',
      authBindings: [],
      authBindingsState: 'missing',
      cos: {
        region: '',
        bucket: '',
        secretId: '',
        secretKey: '',
        securityToken: '',
      },
    },
    ...overrides,
  };
}

export const AUTH_HEADER = { authorization: 'Bearer test-token-1' };
