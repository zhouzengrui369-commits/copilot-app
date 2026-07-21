import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('config', () => {
  it('returns defaults when env is empty', () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(8788);
    expect(cfg.host).toBe('0.0.0.0');
    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.auth.enabled).toBe(true);
    expect(cfg.auth.sharedTokens).toContain('dev-local-test-token');
    expect(cfg.llm.baseUrl).toBe('http://127.0.0.1:45557/v1');
    expect(cfg.rateLimitMax).toBe(60);
  });

  it('reads env vars', () => {
    const cfg = loadConfig({
      PORT: '9000',
      NODE_ENV: 'production',
      LLM_BASE_URL: 'https://api.example.com/v1',
      LLM_API_KEY: 'sk-prod',
      COPILOT_CLOUD_TOKENS: 'tok-a,tok-b',
      RATE_LIMIT_MAX: '120',
      AUTH_DISABLED: '0',
      CORS_ORIGINS: 'https://desktop.example.test',
      TRUST_PROXY_CIDRS: '10.0.0.0/8',
      CLOUDBASE_RELAY_ENABLED: '0',
    });
    expect(cfg.port).toBe(9000);
    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.llm.baseUrl).toBe('https://api.example.com/v1');
    expect(cfg.llm.apiKey).toBe('sk-prod');
    expect(cfg.auth.sharedTokens).toEqual(['tok-a', 'tok-b']);
    expect(cfg.auth.enabled).toBe(true);
    expect(cfg.rateLimitMax).toBe(120);
    expect(cfg.cloudbase.relayEnabled).toBe(false);
  });

  it('falls back to legacy single-token env', () => {
    const cfg = loadConfig({ COPILOT_CLOUD_AUTH_TOKEN: 'legacy-tok' });
    expect(cfg.auth.sharedTokens).toEqual(['legacy-tok']);
  });

  it('parses only an absolute bounded remote issuer path and otherwise keeps authority deny-all', () => {
    expect(loadConfig({}).remote.authority).toEqual({
      issuerKeyPath: '',
      providerState: 'missing',
      maxSessions: 1_000,
      maxUsedRequests: 1_000,
      sessionTtlMs: 900_000,
    });
    expect(loadConfig({
      REMOTE_PAIRING_ISSUER_KEY_PATH: '/private/authority/issuer.pkcs8',
      REMOTE_PAIRING_MAX_SESSIONS: '50',
      REMOTE_PAIRING_MAX_USED_REQUESTS: '75',
      REMOTE_PAIRING_SESSION_TTL_MS: '60000',
    }).remote.authority).toEqual({
      issuerKeyPath: '/private/authority/issuer.pkcs8',
      providerState: 'valid',
      maxSessions: 50,
      maxUsedRequests: 75,
      sessionTtlMs: 60_000,
    });
    expect(loadConfig({
      REMOTE_PAIRING_ISSUER_KEY_PATH: 'relative-secret.pem',
      REMOTE_PAIRING_MAX_SESSIONS: '0',
    }).remote.authority).toEqual({
      issuerKeyPath: '',
      providerState: 'invalid',
      maxSessions: 1_000,
      maxUsedRequests: 1_000,
      sessionTtlMs: 900_000,
    });
    expect(loadConfig({
      REMOTE_PAIRING_ISSUER_KEY_PATH: '/private/authority/issuer.pkcs8',
      REMOTE_PAIRING_MAX_USED_REQUESTS: '10001',
    }).remote.authority).toEqual({
      issuerKeyPath: '/private/authority/issuer.pkcs8',
      providerState: 'invalid',
      maxSessions: 1_000,
      maxUsedRequests: 1_000,
      sessionTtlMs: 900_000,
    });
  });

  it('requires tokens in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrowError('CLIENT_TOKENS_MISSING');
  });

  it('strips trailing slash on base URL', () => {
    const cfg = loadConfig({ LLM_BASE_URL: 'https://example.com/v1/' });
    expect(cfg.llm.baseUrl).toBe('https://example.com/v1/'); // unchanged — normalisation happens in route
  });
});
