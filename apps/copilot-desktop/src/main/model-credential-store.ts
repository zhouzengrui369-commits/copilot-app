import Store from 'electron-store';
import { createHash, timingSafeEqual } from 'node:crypto';

export type CredentialProviderId = 'minimax' | 'openai' | 'claude' | 'custom';
export type CredentialStatus =
  | 'configured'
  | 'not-configured'
  | 'migration-required'
  | 'protection-unavailable';

export interface NormalizedModelEndpoint {
  endpoint: string;
  origin: string;
  loopback: boolean;
}

export interface ModelCredentialBinding {
  provider: CredentialProviderId;
  origin: string;
}

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface CredentialRecord {
  schemaVersion: 1;
  provider: CredentialProviderId;
  origin: string;
  ciphertextBase64: string;
}

export interface CredentialPersistence {
  read(id: string): CredentialRecord | null;
  write(id: string, record: CredentialRecord): void;
  remove(id: string): void;
  clear(): void;
}

export type ModelCredentialErrorCode =
  | 'CREDENTIAL_PROTECTION_UNAVAILABLE'
  | 'CREDENTIAL_MIGRATION_REQUIRED'
  | 'CREDENTIAL_BINDING_INVALID'
  | 'CREDENTIAL_WRITE_FAILED';

export class ModelCredentialError extends Error {
  constructor(public readonly code: ModelCredentialErrorCode) {
    super(code);
    this.name = 'ModelCredentialError';
  }
}

/**
 * Strict URL normalization used before any credential lookup.  The accepted
 * loopback grammar is exactly localhost, 127.0.0.1, or [::1] with an optional
 * decimal port.  Parser aliases, userinfo, control bytes, escaped authority,
 * IPv4-mapped IPv6, and non-HTTPS remote origins fail closed.
 */
export function normalizeModelEndpoint(input: string): NormalizedModelEndpoint {
  if (typeof input !== 'string' || input.length === 0 || input !== input.trim()) {
    throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
  }
  if (/[\u0000-\u001f\u007f\\]/u.test(input)) {
    throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
  }
  const authorityMatch = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/u.exec(input);
  if (!authorityMatch || authorityMatch[1].length === 0) {
    throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
  }
  const authority = authorityMatch[1];
  if (authority.includes('@') || authority.includes('%')) {
    throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
  }
  if (
    parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
  ) {
    throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
  }

  const rawHost = parseRawHost(authority);
  const loopback = rawHost === 'localhost' || rawHost === '127.0.0.1' || rawHost === '[::1]';
  const parsedHost = parsed.hostname.toLowerCase();
  const parsedAsCanonicalLoopback = parsedHost === 'localhost' || parsedHost === '127.0.0.1' || parsedHost === '[::1]';
  if (
    parsedAsCanonicalLoopback !== loopback
    || (!loopback && rawHost.includes('localhost'))
    || /^\[::ffff:/u.test(rawHost)
  ) {
    throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
  }
  if (!loopback && parsed.protocol !== 'https:') {
    throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
  }
  if (loopback && parsedHost !== rawHost) {
    throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
  }

  parsed.pathname = parsed.pathname.replace(/\/{2,}/gu, '/').replace(/\/+$/u, '') || '/';
  const endpoint = parsed.toString().replace(/\/$/u, parsed.pathname === '/' ? '' : '/');
  return { endpoint, origin: parsed.origin, loopback };
}

function parseRawHost(authority: string): string {
  if (authority.startsWith('[')) {
    const match = /^(\[[^\]]+\])(?::[0-9]+)?$/u.exec(authority);
    if (!match) throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
    return match[1].toLowerCase();
  }
  const match = /^([^:]+)(?::[0-9]+)?$/u.exec(authority);
  if (!match) throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
  return match[1].toLowerCase();
}

export function credentialBinding(
  provider: CredentialProviderId,
  baseUrl: string,
): { binding: ModelCredentialBinding; endpoint: NormalizedModelEndpoint } {
  const endpoint = normalizeModelEndpoint(baseUrl);
  return { binding: { provider, origin: endpoint.origin }, endpoint };
}

export class ModelCredentialStore {
  constructor(
    private readonly persistence: CredentialPersistence,
    private readonly protection: SafeStoragePort,
  ) {}

  status(binding: ModelCredentialBinding): CredentialStatus {
    const record = this.readBoundRecord(binding);
    if (!record) return 'not-configured';
    return this.protection.isEncryptionAvailable() ? 'configured' : 'protection-unavailable';
  }

  read(binding: ModelCredentialBinding): string | null {
    const record = this.readBoundRecord(binding);
    if (!record) return null;
    this.requireProtection();
    try {
      return this.protection.decryptString(Buffer.from(record.ciphertextBase64, 'base64'));
    } catch {
      throw new ModelCredentialError('CREDENTIAL_MIGRATION_REQUIRED');
    }
  }

  write(binding: ModelCredentialBinding, value: string): void {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ModelCredentialError('CREDENTIAL_WRITE_FAILED');
    }
    this.requireProtection();
    const id = bindingId(binding);
    const previous = this.persistence.read(id);
    try {
      const ciphertext = this.protection.encryptString(value);
      this.persistence.write(id, {
        schemaVersion: 1,
        provider: binding.provider,
        origin: binding.origin,
        ciphertextBase64: ciphertext.toString('base64'),
      });
      const roundTrip = this.read(binding);
      if (roundTrip === null || !sameBytes(roundTrip, value)) {
        throw new ModelCredentialError('CREDENTIAL_WRITE_FAILED');
      }
    } catch {
      if (previous) this.persistence.write(id, previous);
      else this.persistence.remove(id);
      throw new ModelCredentialError('CREDENTIAL_WRITE_FAILED');
    }
  }

  clear(binding: ModelCredentialBinding): void {
    const record = this.readBoundRecord(binding);
    if (record) this.persistence.remove(bindingId(binding));
  }

  reset(): void {
    this.persistence.clear();
  }

  /**
   * Recoverable legacy migration.  Existing encrypted state plus legacy bytes
   * is ambiguous and never auto-resolved.  The old bytes are cleared only after
   * encrypted write, exact binding, decrypt round-trip, and non-secret metadata
   * commit all succeed.
   */
  migrateLegacy(
    binding: ModelCredentialBinding,
    legacyValue: string,
    commitMetadata: () => void,
    clearLegacyExact: (expected: string) => void,
  ): void {
    if (typeof legacyValue !== 'string' || legacyValue.length === 0) return;
    if (this.readBoundRecord(binding)) {
      throw new ModelCredentialError('CREDENTIAL_MIGRATION_REQUIRED');
    }
    this.requireProtection();
    const id = bindingId(binding);
    try {
      this.write(binding, legacyValue);
      const verified = this.read(binding);
      if (verified === null || !sameBytes(verified, legacyValue)) {
        throw new ModelCredentialError('CREDENTIAL_MIGRATION_REQUIRED');
      }
      commitMetadata();
      clearLegacyExact(legacyValue);
    } catch {
      this.persistence.remove(id);
      throw new ModelCredentialError('CREDENTIAL_MIGRATION_REQUIRED');
    }
  }

  private readBoundRecord(binding: ModelCredentialBinding): CredentialRecord | null {
    const record = this.persistence.read(bindingId(binding));
    if (!record) return null;
    if (
      record.schemaVersion !== 1
      || record.provider !== binding.provider
      || record.origin !== binding.origin
      || typeof record.ciphertextBase64 !== 'string'
      || record.ciphertextBase64.length === 0
    ) {
      throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
    }
    return record;
  }

  private requireProtection(): void {
    if (!this.protection.isEncryptionAvailable()) {
      throw new ModelCredentialError('CREDENTIAL_PROTECTION_UNAVAILABLE');
    }
  }
}

function sameBytes(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function bindingId(binding: ModelCredentialBinding): string {
  if (!binding.origin || !/^https?:\/\//u.test(binding.origin)) {
    throw new ModelCredentialError('CREDENTIAL_BINDING_INVALID');
  }
  return createHash('sha256')
    .update(`${binding.provider}\u0000${binding.origin}`, 'utf8')
    .digest('hex');
}

interface CredentialStoreShape {
  records: Record<string, CredentialRecord>;
}

export function createPersistentModelCredentialStore(
  cwd: string,
  protection: SafeStoragePort,
): ModelCredentialStore {
  const store = new Store<CredentialStoreShape>({
    name: 'copilot-model-credentials',
    cwd,
    defaults: { records: {} },
    clearInvalidConfig: false,
  });
  const persistence: CredentialPersistence = {
    read(id) {
      const record = store.get('records')[id];
      return record ? { ...record } : null;
    },
    write(id, record) {
      store.set('records', { ...store.get('records'), [id]: { ...record } });
    },
    remove(id) {
      const next = { ...store.get('records') };
      delete next[id];
      store.set('records', next);
    },
    clear() {
      store.set('records', {});
    },
  };
  return new ModelCredentialStore(persistence, protection);
}
