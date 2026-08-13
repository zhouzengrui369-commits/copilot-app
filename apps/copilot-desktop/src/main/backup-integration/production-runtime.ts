import type { safeStorage as ElectronSafeStorage } from 'electron';

import { MetadataOnlyPresignClient, BackupProtocolError } from '../backup/index.js';
import type { BackupManagementRuntimeBridge, BackupManagementState } from '../../shared/backup-management.js';
import type { SettingsStorage } from '../settings-store.js';
import type { LocalKnowledgeService } from '../local-knowledge-service.js';
import { CloudBackupPresignTransport, FetchDirectCiphertextAdapter, InMemoryPresignGrantRegistry } from './cloud-adapters.js';
import type { BackupApprovalPort } from './approval.js';
import { BackupIntegrationManager, BackupRecoveryRequiredError } from './manager.js';
import { selectProductionBackupCredentialStore } from './native-keyring-credential-store.js';
import { FileBackupRepository } from './repository.js';
import { LocalKnowledgeBackupSource } from './source.js';

export interface ProductionBackupRuntime extends BackupManagementRuntimeBridge {
  replaceCurrent(): Promise<never>;
}

export function createProductionBackupRuntime(options: {
  userDataPath: string;
  settings: SettingsStorage;
  getService: () => Promise<LocalKnowledgeService>;
  safeStorage: typeof ElectronSafeStorage;
  env: NodeJS.ProcessEnv;
  appVersion: string;
  approval: BackupApprovalPort;
  managedProfileNamespace?: string;
}): ProductionBackupRuntime {
  const repository = new FileBackupRepository(options.userDataPath);
  const source = new LocalKnowledgeBackupSource(options.getService, options.settings, options.appVersion);
  const config = readConfig(options.env);
  if (!config) return new UnconfiguredBackupRuntime(
    options.settings,
    options.env.COPILOT_BACKUP_COS_REGION ?? 'not configured',
    repository,
    source,
  );

  const registry = new InMemoryPresignGrantRegistry({ objectOrigin: config.objectOrigin });
  let abortController: AbortController | null = null;
  let networkEnabled = false;
  const stopped = new AbortController();
  stopped.abort();
  const signal = () => {
    if (!networkEnabled) return stopped.signal;
    if (!abortController || abortController.signal.aborted) abortController = new AbortController();
    return abortController.signal;
  };
  const abortAndClear = () => {
    networkEnabled = false;
    abortController?.abort();
    abortController = null;
    registry.clear();
  };
  const resumeNetwork = () => {
    if (networkEnabled) return;
    networkEnabled = true;
    abortController = new AbortController();
  };
  const transport = new CloudBackupPresignTransport({ endpoint: config.endpoint, token: config.token, registry, signal });
  const presignClient = new MetadataOnlyPresignClient(transport);
  const directAdapter = new FetchDirectCiphertextAdapter(fetch, registry, signal);
  const credentials = selectProductionBackupCredentialStore({
    userDataPath: options.userDataPath,
    safeStorage: options.safeStorage,
    managedProfileNamespace: options.managedProfileNamespace,
  });
  return new BackupIntegrationManager({
    settings: {
      get: () => options.settings.get('cloudBackupEnabled'),
      set: (value) => options.settings.set('cloudBackupEnabled', value),
    },
    consentStore: {
      getReceipt: () => options.settings.get('backupConsentReceipt'),
      setReceipt: (receipt) => options.settings.set('backupConsentReceipt', structuredClone(receipt)),
      clearReceipt: () => options.settings.set('backupConsentReceipt', null),
      getGeneration: () => options.settings.get('backupConsentGeneration'),
      setGeneration: (generation) => options.settings.set('backupConsentGeneration', generation),
    },
    recoveryStore: {
      get: () => options.settings.get('backupRecoveryMarker'),
      set: (marker) => options.settings.set('backupRecoveryMarker', structuredClone(marker)),
      clear: () => options.settings.set('backupRecoveryMarker', null),
    },
    approval: options.approval,
    source,
    repository,
    credentialStore: credentials.store,
    platformProtection: credentials.platformProtection,
    presignClient,
    directAdapter,
    target: config.target,
    abortAndClear,
    resumeNetwork,
  });
}

function readConfig(env: NodeJS.ProcessEnv) {
  const endpoint = env.COPILOT_BACKUP_ENDPOINT ?? '';
  const token = env.COPILOT_BACKUP_TOKEN ?? '';
  const region = env.COPILOT_BACKUP_COS_REGION ?? '';
  const bucket = env.COPILOT_BACKUP_COS_BUCKET ?? '';
  const ownerHash = env.COPILOT_BACKUP_OWNER_HASH ?? '';
  const targetHash = env.COPILOT_BACKUP_TARGET_HASH ?? '';
  const objectOrigin = env.COPILOT_BACKUP_OBJECT_ORIGIN || undefined;
  if (!endpoint || !token || !region || !bucket || !/^[a-f0-9]{64}$/.test(ownerHash) || !/^[a-f0-9]{64}$/.test(targetHash)) return null;
  return { endpoint, token, objectOrigin, target: { region, bucket, ownerHash, targetHash } };
}

class UnconfiguredBackupRuntime implements ProductionBackupRuntime {
  constructor(
    private readonly settings: SettingsStorage,
    private readonly region: string,
    private readonly repository: FileBackupRepository,
    private readonly source: LocalKnowledgeBackupSource,
  ) {}
  async getState(): Promise<BackupManagementState> {
    await this.recoverRestoreImports();
    return {
      enabled: false,
      configured: false,
      region: this.region,
      platformProtection: 'OS-protected local key store unavailable',
      catalog: [], allowedScopes: [], activeOperation: null, schedulingAvailable: false, replaceCurrentAvailable: false,
      recoveryRequired: await this.hasRecoveryIntent(),
    };
  }
  async disable() {
    this.settings.set('cloudBackupEnabled', false);
    this.settings.set('backupConsentGeneration', this.settings.get('backupConsentGeneration') + 1);
    this.settings.set('backupConsentReceipt', null);
    await this.assertRecovered();
    return this.getState();
  }
  async prepareEnable(): Promise<never> { return this.reject('COS_UNAVAILABLE'); }
  async enable(): Promise<never> { return this.reject('COS_UNAVAILABLE'); }
  async create(): Promise<never> { return this.reject('BACKUP_DISABLED'); }
  async upload(): Promise<never> { return this.reject('BACKUP_DISABLED'); }
  async downloadVerify(): Promise<never> { return this.reject('BACKUP_DISABLED'); }
  async restorePreview(): Promise<never> { return this.reject('BACKUP_DISABLED'); }
  async restoreApply(): Promise<never> { return this.reject('BACKUP_DISABLED'); }
  async deleteRemote(): Promise<never> { return this.reject('BACKUP_DISABLED'); }
  async replaceCurrent(): Promise<never> { return this.reject('RESTORE_CONFLICT'); }

  private async assertRecovered(): Promise<void> {
    await this.recoverRestoreImports();
    if (await this.hasRecoveryIntent()) throw new BackupRecoveryRequiredError();
  }

  private async reject(code: ConstructorParameters<typeof BackupProtocolError>[0]): Promise<never> {
    await this.assertRecovered();
    throw new BackupProtocolError(code);
  }

  private async hasRecoveryIntent(): Promise<boolean> {
    if (this.settings.get('backupRecoveryMarker')) return true;
    try {
      return (await this.repository.listRecoveryIntents()).length > 0
        || (await this.repository.listRestoreImportIntents()).length > 0;
    } catch {
      return true;
    }
  }

  private async recoverRestoreImports(): Promise<void> {
    let intents;
    try {
      intents = await this.repository.listRestoreImportIntents();
      if (intents.length > 0) this.persistRecoveryOffBoundary();
      for (const intent of intents) {
        await this.source.rollbackRestoreImport(intent);
        await this.repository.removeRestoreImportIntent(intent.operationId);
      }
    } catch {
      throw new BackupRecoveryRequiredError();
    }
  }

  /**
   * Missing cloud configuration must not weaken configured recovery. Persist
   * revocation before touching imported objects. Receipt generation makes the
   * sequence retry-safe if a settings write fails between steps.
   */
  private persistRecoveryOffBoundary(): void {
    const wasEnabled = this.settings.get('cloudBackupEnabled');
    const receipt = this.settings.get('backupConsentReceipt');
    const generation = this.settings.get('backupConsentGeneration');
    this.settings.set('cloudBackupEnabled', false);
    if (wasEnabled || receipt !== null) {
      const receiptGeneration = receipt?.generation;
      const revokedGeneration = receiptGeneration === undefined
        ? generation + 1
        : Math.max(generation, receiptGeneration + 1);
      if (generation < revokedGeneration) this.settings.set('backupConsentGeneration', revokedGeneration);
    }
    this.settings.set('backupConsentReceipt', null);
  }
}
