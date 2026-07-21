/**
 * Copilot Cloud Server — environment configuration.
 *
 * Production configuration is fail-closed. Validation errors expose stable
 * reason codes only; secrets and rejected values never enter error messages.
 */
import { isIP } from 'node:net';
import path from 'node:path';
import type { BackupAuthBinding, BackupCosSigningConfig } from './backup/backup-a-presign.js';

export type TrustProxyContract = 'none' | 'hops' | 'cidrs' | 'invalid';
export type TrustProxyValue = false | number | string[];

export const READINESS_REASON_CODES = [
  'NODE_ENV_INVALID',
  'PORT_INVALID',
  'AUTH_DISABLED',
  'CLIENT_TOKENS_MISSING',
  'LLM_API_KEY_MISSING',
  'LLM_BASE_URL_INVALID',
  'CORS_ORIGINS_MISSING',
  'CORS_ORIGIN_WILDCARD',
  'CORS_ORIGIN_INVALID',
  'TRUST_PROXY_MISSING',
  'TRUST_PROXY_INVALID',
  'RATE_LIMIT_MAX_INVALID',
  'RATE_LIMIT_WINDOW_INVALID',
  'LLM_TIMEOUT_INVALID',
  'BACKUP_AUTH_BINDINGS_MISSING',
  'BACKUP_AUTH_BINDINGS_INVALID',
  'BACKUP_COS_REGION_MISSING',
  'BACKUP_COS_BUCKET_MISSING',
  'BACKUP_COS_SECRET_ID_MISSING',
  'BACKUP_COS_SECRET_KEY_MISSING',
  'BACKUP_COS_CONFIG_INVALID',
  'REMOTE_ISSUER_PROVIDER_MISSING',
  'REMOTE_ISSUER_PROVIDER_INVALID',
  'REMOTE_ISSUER_PROVIDER_NOT_READY',
] as const;

export type ReadinessReasonCode = (typeof READINESS_REASON_CODES)[number];

export class ProductionConfigError extends Error {
  readonly code: ReadinessReasonCode;

  constructor(code: ReadinessReasonCode) {
    super(code);
    this.name = 'ProductionConfigError';
    this.code = code;
  }
}

export interface RemoteAuthorityConfig {
  issuerKeyPath: string;
  providerState: 'missing' | 'invalid' | 'valid';
  maxSessions: number;
  maxUsedRequests: number;
  sessionTtlMs: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  version: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  corsOrigins: string[];
  trustProxy: TrustProxyValue;
  trustProxyContract: TrustProxyContract;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  auth: {
    enabled: boolean;
    sharedTokens: string[];
  };
  llm: {
    baseUrl: string;
    apiKey: string;
    chatPath: string;
    embeddingsPath: string;
    timeoutMs: number;
  };
  cloudbase: {
    relayEnabled: boolean;
    relayPath: string;
  };
  remote: {
    enabled: boolean;
    path: string;
    /** Optional external-secret authority. Missing/invalid always composes deny-all. */
    authority?: RemoteAuthorityConfig;
  };
  backup: {
    enabled: boolean;
    path: string;
    authBindings: BackupAuthBinding[];
    authBindingsState: 'missing' | 'invalid' | 'valid';
    cos: BackupCosSigningConfig;
  };
}

function parseInt10(value: string | undefined, fallback: number, strict: boolean): number {
  if (value === undefined || value === '') return fallback;
  if (!/^-?\d+$/.test(value.trim())) return strict ? Number.NaN : fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : strict ? Number.NaN : fallback;
}

function isNodeEnvironment(value: unknown): value is ServerConfig['nodeEnv'] {
  return value === 'development' || value === 'test' || value === 'production';
}

function isValidPort(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 65_535;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseRemoteAuthority(env: NodeJS.ProcessEnv): RemoteAuthorityConfig {
  const issuerKeyPath = env.REMOTE_PAIRING_ISSUER_KEY_PATH?.trim() ?? '';
  const rawMaxSessions = env.REMOTE_PAIRING_MAX_SESSIONS;
  const rawMaxUsedRequests = env.REMOTE_PAIRING_MAX_USED_REQUESTS;
  const rawSessionTtl = env.REMOTE_PAIRING_SESSION_TTL_MS;
  const parsedMaxSessions = parseInt10(rawMaxSessions, 1_000, true);
  const parsedMaxUsedRequests = parseInt10(rawMaxUsedRequests, parsedMaxSessions, true);
  const parsedSessionTtl = parseInt10(rawSessionTtl, 15 * 60_000, true);
  const numbersValid = Number.isSafeInteger(parsedMaxSessions)
    && parsedMaxSessions >= 1
    && parsedMaxSessions <= 10_000
    && Number.isSafeInteger(parsedMaxUsedRequests)
    && parsedMaxUsedRequests >= 1
    && parsedMaxUsedRequests <= 10_000
    && Number.isSafeInteger(parsedSessionTtl)
    && parsedSessionTtl >= 1
    && parsedSessionTtl <= 15 * 60_000;
  const pathValid = issuerKeyPath.length > 0
    && issuerKeyPath.length <= 4_096
    && path.isAbsolute(issuerKeyPath)
    && !/[\r\n\u0000]/u.test(issuerKeyPath);
  const providerState = !issuerKeyPath
    ? 'missing'
    : pathValid && numbersValid
      ? 'valid'
      : 'invalid';
  return {
    issuerKeyPath: pathValid ? issuerKeyPath : '',
    providerState,
    maxSessions: numbersValid ? parsedMaxSessions : 1_000,
    maxUsedRequests: numbersValid ? parsedMaxUsedRequests : 1_000,
    sessionTtlMs: numbersValid ? parsedSessionTtl : 15 * 60_000,
  };
}

const BACKUP_HASH_PATTERN = /^[a-f0-9]{64}$/;
const BACKUP_REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const BACKUP_BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}-[0-9]{5,20}$/;

function areBackupBindingsValid(bindings: BackupAuthBinding[]): boolean {
  if (bindings.length < 1 || bindings.length > 100) return false;
  const tokens = new Set<string>();
  return bindings.every((binding) => {
    const valid =
      typeof binding.token === 'string' &&
      binding.token.length >= 16 &&
      binding.token.length <= 512 &&
      !/[\r\n]/.test(binding.token) &&
      !tokens.has(binding.token) &&
      BACKUP_HASH_PATTERN.test(binding.ownerHash) &&
      BACKUP_HASH_PATTERN.test(binding.targetHash);
    tokens.add(binding.token);
    return valid;
  });
}

function parseBackupAuthBindings(value: string | undefined): {
  authBindings: BackupAuthBinding[];
  authBindingsState: 'missing' | 'invalid' | 'valid';
} {
  if (!value?.trim()) return { authBindings: [], authBindingsState: 'missing' };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
      return { authBindings: [], authBindingsState: 'invalid' };
    }
    const bindings: BackupAuthBinding[] = [];
    const tokens = new Set<string>();
    for (const entry of parsed) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        Array.isArray(entry) ||
        Object.keys(entry).sort().join(',') !== 'ownerHash,targetHash,token'
      ) {
        return { authBindings: [], authBindingsState: 'invalid' };
      }
      const candidate = entry as Record<string, unknown>;
      if (
        typeof candidate.token !== 'string' ||
        candidate.token.length < 16 ||
        candidate.token.length > 512 ||
        /[\r\n]/.test(candidate.token) ||
        tokens.has(candidate.token) ||
        typeof candidate.ownerHash !== 'string' ||
        !BACKUP_HASH_PATTERN.test(candidate.ownerHash) ||
        typeof candidate.targetHash !== 'string' ||
        !BACKUP_HASH_PATTERN.test(candidate.targetHash)
      ) {
        return { authBindings: [], authBindingsState: 'invalid' };
      }
      tokens.add(candidate.token);
      bindings.push({
        token: candidate.token,
        ownerHash: candidate.ownerHash,
        targetHash: candidate.targetHash,
      });
    }
    return { authBindings: bindings, authBindingsState: 'valid' };
  } catch {
    return { authBindings: [], authBindingsState: 'invalid' };
  }
}

function isValidCidR(value: string): boolean {
  const match = /^(.+)\/(\d+)$/.exec(value);
  if (!match) return false;
  const address = match[1] ?? '';
  const prefix = Number.parseInt(match[2] ?? '', 10);
  const family = isIP(address);
  return family === 4 ? prefix >= 0 && prefix <= 32 : family === 6 && prefix >= 0 && prefix <= 128;
}

function parseTrustProxy(env: NodeJS.ProcessEnv): {
  trustProxy: TrustProxyValue;
  trustProxyContract: TrustProxyContract;
} {
  const rawHops = env.TRUST_PROXY_HOPS?.trim();
  const cidrs = parseList(env.TRUST_PROXY_CIDRS);
  const hasHops = Boolean(rawHops);
  const hasCidrs = cidrs.length > 0;

  if (hasHops && hasCidrs) {
    return { trustProxy: false, trustProxyContract: 'invalid' };
  }
  if (hasHops) {
    const hops = Number(rawHops);
    if (!Number.isSafeInteger(hops) || hops < 1 || hops > 10) {
      return { trustProxy: false, trustProxyContract: 'invalid' };
    }
    return { trustProxy: hops, trustProxyContract: 'hops' };
  }
  if (hasCidrs) {
    if (!cidrs.every(isValidCidR)) {
      return { trustProxy: false, trustProxyContract: 'invalid' };
    }
    return { trustProxy: cidrs, trustProxyContract: 'cidrs' };
  }
  if (env.TRUST_PROXY_HOPS !== undefined || env.TRUST_PROXY_CIDRS !== undefined) {
    return { trustProxy: false, trustProxyContract: 'invalid' };
  }
  return { trustProxy: false, trustProxyContract: 'none' };
}

function isTrustProxyInvariantValid(config: ServerConfig): boolean {
  switch (config.trustProxyContract) {
    case 'none':
      return config.trustProxy === false;
    case 'hops':
      return (
        typeof config.trustProxy === 'number' &&
        Number.isSafeInteger(config.trustProxy) &&
        config.trustProxy >= 1 &&
        config.trustProxy <= 10
      );
    case 'cidrs':
      return (
        Array.isArray(config.trustProxy) &&
        config.trustProxy.length > 0 &&
        config.trustProxy.every(isValidCidR)
      );
    case 'invalid':
      return false;
    default:
      return false;
  }
}

function isSafeUpstreamBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function classifyCorsOrigin(origin: string): ReadinessReasonCode | null {
  if (origin === '*') return 'CORS_ORIGIN_WILDCARD';
  try {
    const url = new URL(origin);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return 'CORS_ORIGIN_INVALID';
    }
    return null;
  } catch {
    return 'CORS_ORIGIN_INVALID';
  }
}

export function readinessReasons(config: ServerConfig): ReadinessReasonCode[] {
  const reasons: ReadinessReasonCode[] = [];
  if (!isNodeEnvironment(config.nodeEnv)) reasons.push('NODE_ENV_INVALID');
  if (!isValidPort(config.port)) reasons.push('PORT_INVALID');
  if (!config.auth.enabled) reasons.push('AUTH_DISABLED');
  if (config.auth.sharedTokens.length === 0 || config.auth.sharedTokens.some((token) => !token.trim())) {
    reasons.push('CLIENT_TOKENS_MISSING');
  }
  if (!config.llm.apiKey.trim()) reasons.push('LLM_API_KEY_MISSING');
  if (!isSafeUpstreamBaseUrl(config.llm.baseUrl)) reasons.push('LLM_BASE_URL_INVALID');
  if (config.corsOrigins.length === 0) {
    reasons.push('CORS_ORIGINS_MISSING');
  } else {
    for (const origin of config.corsOrigins) {
      const reason = classifyCorsOrigin(origin);
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    }
  }
  if (config.trustProxyContract === 'none' && config.trustProxy === false) {
    reasons.push('TRUST_PROXY_MISSING');
  } else if (!isTrustProxyInvariantValid(config)) {
    reasons.push('TRUST_PROXY_INVALID');
  }
  if (!Number.isSafeInteger(config.rateLimitMax) || config.rateLimitMax < 1) {
    reasons.push('RATE_LIMIT_MAX_INVALID');
  }
  if (!Number.isSafeInteger(config.rateLimitWindowMs) || config.rateLimitWindowMs < 1) {
    reasons.push('RATE_LIMIT_WINDOW_INVALID');
  }
  if (!Number.isSafeInteger(config.llm.timeoutMs) || config.llm.timeoutMs < 1) {
    reasons.push('LLM_TIMEOUT_INVALID');
  }
  if (config.backup.enabled) {
    if (config.backup.authBindingsState === 'missing') {
      reasons.push('BACKUP_AUTH_BINDINGS_MISSING');
    } else if (
      config.backup.authBindingsState !== 'valid' ||
      !areBackupBindingsValid(config.backup.authBindings)
    ) {
      reasons.push('BACKUP_AUTH_BINDINGS_INVALID');
    }
    if (!config.backup.cos.region.trim()) reasons.push('BACKUP_COS_REGION_MISSING');
    if (!config.backup.cos.bucket.trim()) reasons.push('BACKUP_COS_BUCKET_MISSING');
    if (!config.backup.cos.secretId.trim()) reasons.push('BACKUP_COS_SECRET_ID_MISSING');
    if (!config.backup.cos.secretKey.trim()) reasons.push('BACKUP_COS_SECRET_KEY_MISSING');
    if (
      config.backup.cos.region &&
      config.backup.cos.bucket &&
      (!BACKUP_REGION_PATTERN.test(config.backup.cos.region) ||
        !BACKUP_BUCKET_PATTERN.test(config.backup.cos.bucket) ||
        /[\s\u0000-\u001f\u007f]/.test(config.backup.cos.secretId) ||
        /[\s\u0000-\u001f\u007f]/.test(config.backup.cos.secretKey) ||
        /[\s\u0000-\u001f\u007f]/.test(config.backup.cos.securityToken))
    ) {
      reasons.push('BACKUP_COS_CONFIG_INVALID');
    }
  }
  return reasons;
}

export function assertProductionConfig(config: ServerConfig): void {
  if (!isNodeEnvironment(config.nodeEnv)) {
    throw new ProductionConfigError('NODE_ENV_INVALID');
  }
  if (config.nodeEnv !== 'production') return;
  const [reason] = readinessReasons(config);
  if (reason) throw new ProductionConfigError(reason);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!isNodeEnvironment(nodeEnv)) {
    throw new ProductionConfigError('NODE_ENV_INVALID');
  }
  const isProduction = nodeEnv === 'production';
  const tokens = parseList(env.COPILOT_CLOUD_TOKENS);
  const legacyToken = env.COPILOT_CLOUD_AUTH_TOKEN?.trim();
  const sharedTokens = tokens.length > 0
    ? tokens
    : legacyToken
      ? [legacyToken]
      : isProduction
        ? []
        : ['dev-local-test-token'];
  const trustProxy = parseTrustProxy(env);
  const backupAuth = parseBackupAuthBindings(env.BACKUP_AUTH_BINDINGS);
  const remoteAuthority = parseRemoteAuthority(env);

  const config: ServerConfig = {
    port: parseInt10(env.PORT, 8788, true),
    host: env.HOST ?? '0.0.0.0',
    nodeEnv,
    version: env.npm_package_version ?? '0.1.0',
    logLevel: (env.LOG_LEVEL as ServerConfig['logLevel']) ?? (isProduction ? 'info' : 'debug'),
    corsOrigins: parseList(env.CORS_ORIGINS),
    ...trustProxy,
    rateLimitMax: parseInt10(env.RATE_LIMIT_MAX, 60, isProduction),
    rateLimitWindowMs: parseInt10(env.RATE_LIMIT_WINDOW_MS, 60_000, isProduction),
    auth: {
      enabled: env.AUTH_DISABLED !== '1' && env.AUTH_DISABLED !== 'true',
      sharedTokens,
    },
    llm: {
      baseUrl: env.LLM_BASE_URL ?? 'http://127.0.0.1:45557/v1',
      apiKey: env.LLM_API_KEY ?? '',
      chatPath: env.LLM_CHAT_PATH ?? '/chat/completions',
      embeddingsPath: env.LLM_EMBEDDINGS_PATH ?? '/embeddings',
      timeoutMs: parseInt10(env.LLM_TIMEOUT_MS, 60_000, isProduction),
    },
    cloudbase: {
      relayEnabled: env.CLOUDBASE_RELAY_ENABLED !== '0',
      relayPath: env.CLOUDBASE_RELAY_PATH ?? '/cloudbase-relay',
    },
    remote: {
      // Exact opt-in only. Missing, reset, migration, and misspelled values stay OFF.
      enabled: env.REMOTE_RELAY_ENABLED === '1',
      path: '/v1/remote/ws',
      authority: remoteAuthority,
    },
    backup: {
      // Exact opt-in only. Missing, reset, migration and alternate spellings stay OFF.
      enabled: env.BACKUP_ENABLED === '1',
      path: '/v1/backup/presign',
      ...backupAuth,
      cos: {
        region: env.COPILOT_BACKUP_COS_REGION ?? '',
        bucket: env.COPILOT_BACKUP_COS_BUCKET ?? '',
        secretId: env.COPILOT_BACKUP_COS_SECRET_ID ?? '',
        secretKey: env.COPILOT_BACKUP_COS_SECRET_KEY ?? '',
        securityToken: env.COPILOT_BACKUP_COS_SECURITY_TOKEN ?? '',
      },
    },
  };

  if (!isValidPort(config.port)) {
    throw new ProductionConfigError('PORT_INVALID');
  }
  assertProductionConfig(config);
  return config;
}

export const STARTED_AT = Date.now();
