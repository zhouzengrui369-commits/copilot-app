import { describe, expect, it } from 'vitest';
import {
  ModelCredentialError,
  ModelCredentialStore,
  credentialBinding,
  normalizeModelEndpoint,
  type CredentialPersistence,
  type CredentialRecord,
  type SafeStoragePort,
} from '../src/main/model-credential-store.js';

const CREDENTIAL = '[REDACTED]';

class MemoryPersistence implements CredentialPersistence {
  readonly records = new Map<string, CredentialRecord>();
  read(id: string) { return this.records.get(id) ?? null; }
  write(id: string, record: CredentialRecord) { this.records.set(id, { ...record }); }
  remove(id: string) { this.records.delete(id); }
  clear() { this.records.clear(); }
}

function protection(available = true): SafeStoragePort {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from([...value].reverse().join(''), 'utf8'),
    decryptString: (value) => [...value.toString('utf8')].reverse().join(''),
  };
}

describe('canonical endpoint grammar', () => {
  it.each([
    ['http://localhost:45557/v1', true],
    ['https://127.0.0.1/v1/', true],
    ['http://[::1]:45557/v1', true],
    ['https://model.example/v1', false],
  ])('accepts canonical endpoint %s', (value, loopback) => {
    expect(normalizeModelEndpoint(value)).toMatchObject({ loopback });
  });

  it.each([
    'http://localhost.evil/v1',
    'http://user@localhost/v1',
    'http://local%68ost/v1',
    'http://2130706433/v1',
    'http://0x7f000001/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'http://model.example/v1',
    'ftp://localhost/v1',
    'http://localhost\\evil/v1',
    'http://localhost/v1?redirect=https://model.example',
    ' http://localhost/v1',
  ])('fails closed for ambiguous or unsafe endpoint %s', (value) => {
    expect(() => normalizeModelEndpoint(value)).toThrow(ModelCredentialError);
  });
});

describe('provider + normalized-origin credential isolation', () => {
  it('stores ciphertext metadata and reads only the exact binding', () => {
    const persistence = new MemoryPersistence();
    const store = new ModelCredentialStore(persistence, protection());
    const first = credentialBinding('minimax', 'https://model.example/v1').binding;
    const otherProvider = credentialBinding('openai', 'https://model.example/v1').binding;
    const otherOrigin = credentialBinding('minimax', 'https://other.example/v1').binding;

    store.write(first, CREDENTIAL);
    expect(store.read(first)).toBe(CREDENTIAL);
    expect(store.read(otherProvider)).toBeNull();
    expect(store.read(otherOrigin)).toBeNull();
    expect(JSON.stringify([...persistence.records.values()])).not.toContain(CREDENTIAL);
  });

  it('clears only the exact provider/origin binding', () => {
    const persistence = new MemoryPersistence();
    const store = new ModelCredentialStore(persistence, protection());
    const first = credentialBinding('minimax', 'https://model.example/v1').binding;
    const second = credentialBinding('openai', 'https://model.example/v1').binding;
    store.write(first, CREDENTIAL);
    store.write(second, CREDENTIAL);
    store.clear(first);
    expect(store.read(first)).toBeNull();
    expect(store.read(second)).toBe(CREDENTIAL);
  });
});

describe('recoverable fail-closed legacy migration', () => {
  it('commits non-secret metadata before clearing recoverable legacy bytes', () => {
    const store = new ModelCredentialStore(new MemoryPersistence(), protection());
    const binding = credentialBinding('minimax', 'https://model.example/v1').binding;
    const order: string[] = [];
    let legacy = CREDENTIAL;
    store.migrateLegacy(
      binding,
      legacy,
      () => order.push('metadata'),
      (expected) => { expect(expected).toBe(legacy); order.push('clear'); legacy = ''; },
    );
    expect(order).toEqual(['metadata', 'clear']);
    expect(legacy).toBe('');
    expect(store.read(binding)).toBe(CREDENTIAL);
  });

  it('retains legacy bytes and writes nothing when protection is unavailable', () => {
    const persistence = new MemoryPersistence();
    const store = new ModelCredentialStore(persistence, protection(false));
    const binding = credentialBinding('minimax', 'https://model.example/v1').binding;
    let legacy = CREDENTIAL;
    expect(() => store.migrateLegacy(binding, legacy, () => undefined, () => { legacy = ''; }))
      .toThrow(ModelCredentialError);
    expect(legacy).toBe(CREDENTIAL);
    expect(persistence.records.size).toBe(0);
  });

  it('rolls back encrypted state when metadata commit fails', () => {
    const persistence = new MemoryPersistence();
    const store = new ModelCredentialStore(persistence, protection());
    const binding = credentialBinding('minimax', 'https://model.example/v1').binding;
    let legacy = CREDENTIAL;
    expect(() => store.migrateLegacy(
      binding,
      legacy,
      () => { throw new Error('safe commit failure'); },
      () => { legacy = ''; },
    )).toThrow(ModelCredentialError);
    expect(legacy).toBe(CREDENTIAL);
    expect(persistence.records.size).toBe(0);
  });
});
