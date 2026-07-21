import { RemoteError } from './protocol.js';

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface CredentialCipherStore {
  get(name: string): string | null;
  set(name: string, ciphertextBase64: string): void;
  delete(name: string): void;
}

/**
 * Fail-closed OS secure-storage boundary. Electron safeStorage uses macOS
 * Keychain and Windows DPAPI. DPAPI is not Windows Credential Manager and this
 * adapter deliberately makes no such claim. Linux is outside the Phase 1
 * desktop target and is rejected rather than accepting weaker basic_text mode.
 */
export class ElectronSafeStorageCredentialAdapter {
  constructor(
    private readonly safeStorage: SafeStoragePort,
    private readonly ciphertextStore: CredentialCipherStore,
    private readonly platform: NodeJS.Platform,
  ) {}

  async read(name: 'relay-token'): Promise<string | null> {
    this.assertAvailable();
    const ciphertext = this.ciphertextStore.get(name);
    if (!ciphertext) return null;
    try {
      const value = this.safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
      return value.length > 0 ? value : null;
    } catch {
      throw new RemoteError('AUTH_INVALID', 'secure relay credential could not be decrypted');
    }
  }

  write(name: 'relay-token', value: string): void {
    this.assertAvailable();
    if (!value) throw new RemoteError('AUTH_INVALID', 'secure relay credential is empty');
    const encrypted = this.safeStorage.encryptString(value);
    this.ciphertextStore.set(name, encrypted.toString('base64'));
  }

  clearSession(): void {
    // The long-lived relay token remains OS-protected. Ephemeral session keys
    // live only inside the crypto/session implementation and are cleared there.
  }

  private assertAvailable(): void {
    if ((this.platform !== 'darwin' && this.platform !== 'win32') || !this.safeStorage.isEncryptionAvailable()) {
      throw new RemoteError('AUTH_REQUIRED', 'OS secure credential storage is unavailable');
    }
  }
}
