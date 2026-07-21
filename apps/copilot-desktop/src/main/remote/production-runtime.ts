import Store from 'electron-store';
import WebSocket from 'ws';
import type {
  RemoteApprovalResponse,
  RemoteClientState,
} from '../../shared/remote-management.js';
import { PersistentRemoteAuditStore } from './audit.js';
import { RemoteCommandEngine } from './controller.js';
import { ProductionDesktopSigner } from './desktop-signer.js';
import type { DesktopApprovalBroker, RemoteRuntime } from './ipc.js';
import { ProductionRemoteLocalAdapter } from './local-adapter.js';
import {
  NativeRemoteCredentialVault,
  loadProductionRemoteKeyringFactory,
} from './native-credential-store.js';
import { RemoteOnlineClient, type RemoteSocket, type RemoteSocketFactory } from './online-client.js';
import {
  PairingManager,
  PRODUCTION_PAIRING_ROOT_ED25519_SPKI_BASE64,
  type RemoteCredentialVault,
  type RemotePairingRepository,
  type RemotePairingRepositoryState,
} from './pairing.js';
import { DEFAULT_REMOTE_PREFERENCE, normalizePreference, type RemotePreferenceStore } from './preferences.js';
import { RemoteError } from './protocol.js';
import { ProductionRemoteSessionCrypto } from './session-crypto.js';
import type { LocalKnowledgeService } from '../local-knowledge-service.js';
import type { PairingBundleSelection } from './pairing-file-port.js';

export interface ProductionRemoteRuntimeOptions {
  userDataPath: string;
  getService: () => LocalKnowledgeService | Promise<LocalKnowledgeService>;
  approval: DesktopApprovalBroker;
  /** Main-only picker returns verified selected-file bytes, never a path to renderer. */
  pickPairingBundle?: (pendingRequestId?: string) => Promise<Uint8Array | PairingBundleSelection | null>;
  /** Main-only writer owns the public request bytes and destination. */
  savePairingRequest?: (bytes: Uint8Array) => Promise<boolean>;
  pairingRootPublicKeySpki?: Uint8Array | string | null;
  pairingRepository?: RemotePairingRepository;
  credentialVault?: RemoteCredentialVault;
  socketFactory?: RemoteSocketFactory;
  platform?: NodeJS.Platform;
  clock?: () => number;
  managedProfileNamespace?: string;
  /** Kept only for source compatibility; production trust/config never reads env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Target-side production composition. Relay endpoint, identities and session
 * binding come only from a root-verified pairing record. No environment or
 * safeStorage secret fallback is accepted.
 */
export function createProductionRemoteRuntime(options: ProductionRemoteRuntimeOptions): RemoteRuntime {
  const clock = options.clock ?? Date.now;
  const preferenceStore = new Store<Record<string, unknown>>({
    name: 'copilot-remote-preferences',
    cwd: options.userDataPath,
    defaults: { preference: DEFAULT_REMOTE_PREFERENCE },
  });
  const preferences: RemotePreferenceStore = {
    get: () => normalizePreference(preferenceStore.get('preference')),
    set: (value) => preferenceStore.set('preference', value),
    reset: () => preferenceStore.set('preference', DEFAULT_REMOTE_PREFERENCE),
  };
  const pairingStore = new Store<Record<string, unknown>>({
    name: 'copilot-remote-pairing',
    cwd: options.userDataPath,
    defaults: {},
  });
  const repository: RemotePairingRepository = options.pairingRepository ?? {
    get: () => {
      const value = pairingStore.get('state');
      return value && typeof value === 'object'
        ? structuredClone(value as RemotePairingRepositoryState)
        : null;
    },
    compareAndSet: (expectedRevision, value) => {
      const current = pairingStore.get('state');
      const revision = current && typeof current === 'object'
        ? (current as Partial<RemotePairingRepositoryState>).revision
        : 0;
      if (revision !== expectedRevision) return false;
      pairingStore.set('state', structuredClone(value));
      return true;
    },
  };
  const credentials = options.credentialVault ?? new NativeRemoteCredentialVault(
    loadProductionRemoteKeyringFactory(),
    options.platform ?? process.platform,
    options.managedProfileNamespace,
  );
  const pairing = new PairingManager({
    rootPublicKeySpki: options.pairingRootPublicKeySpki
      ?? Buffer.from(PRODUCTION_PAIRING_ROOT_ED25519_SPKI_BASE64, 'base64'),
    repository,
    credentials,
    clock,
  });
  const auditStore = new Store<Record<string, unknown>>({
    name: 'copilot-remote-audit',
    cwd: options.userDataPath,
    defaults: { entries: [], identities: [] },
  });
  const audit = new PersistentRemoteAuditStore({
    get: () => auditStore.get('entries'),
    set: (entries) => auditStore.set('entries', entries),
  }, 5_000, {
    get: () => auditStore.get('identities'),
    set: (entries) => auditStore.set('identities', entries),
  });

  let client: RemoteOnlineClient | null = null;

  const state = (): RemoteClientState => ({
    ...(client?.state() ?? unavailableRemoteState()),
    pairing: pairing.status(),
  });

  const disable = async (): Promise<RemoteClientState> => {
    const current = client;
    client = null;
    if (current) await current.disable();
    else preferences.reset();
    options.approval.cancelAll();
    return state();
  };

  const buildClient = async (): Promise<RemoteOnlineClient> => {
    const record = pairing.active();
    if (!record) throw new RemoteError('AUTH_REQUIRED', 'verified remote pairing is unavailable');
    if (record.expiresAtMs <= clock()) {
      throw new RemoteError('SESSION_EXPIRED', 'paired remote session expired');
    }
    const crypto = await ProductionRemoteSessionCrypto.create(record, credentials);
    let signer: ProductionDesktopSigner;
    try {
      signer = await ProductionDesktopSigner.create(record, credentials);
    } catch (error) {
      crypto.clearSession();
      throw error;
    }
    const engine = new RemoteCommandEngine({
      ownerId: record.ownerId,
      controllerId: record.controllerId,
      targetId: record.targetId,
      sessionId: record.sessionId,
      crypto,
      signer,
      local: new ProductionRemoteLocalAdapter(options.getService),
      audit,
      approval: options.approval,
      clock,
    });
    return new RemoteOnlineClient({
      engine,
      preferences,
      credentials: {
        async read() {
          const secret = await credentials.get(record.pairingId, record.keyEpoch, 'relay-token');
          if (!secret) return null;
          try {
            const token = Buffer.from(secret).toString('utf8');
            if (!/^[A-Za-z0-9_-]{43,512}$/.test(token)) {
              throw new RemoteError('AUTH_INVALID', 'relay credential is invalid');
            }
            return token;
          } finally {
            secret.fill(0);
          }
        },
        clearSession() {
          // The long-lived token remains only in the OS vault. The online
          // client holds no token field; engine.disable zeroes session keys.
        },
      },
      socketFactory: options.socketFactory ?? createNodeSocket,
      endpoint: record.relayUrl,
      binding: {
        ownerId: record.ownerId,
        sessionId: record.sessionId,
        targetId: record.targetId,
      },
      clock,
      sessionExpiresAtMs: record.expiresAtMs,
    });
  };

  return {
    getState: async () => state(),
    enable: async (request) => {
      await disable();
      const candidate = await buildClient();
      try {
        const enabled = await candidate.enable(request);
        client = candidate;
        return { ...enabled, pairing: pairing.status() };
      } catch (error) {
        await candidate.disable().catch(() => undefined);
        throw error;
      }
    },
    disable,
    createPairingRequest: async () => {
      await disable();
      if (!options.savePairingRequest) {
        throw new RemoteError('AUTH_REQUIRED', 'main-process pairing request writer is unavailable');
      }
      const request = await pairing.createPairingRequest();
      const bytes = Buffer.from(`${JSON.stringify(request)}\n`, 'utf8');
      if (bytes.byteLength > 16 * 1024) {
        throw new RemoteError('PAYLOAD_TOO_LARGE', 'pairing request exceeds 16 KiB');
      }
      try {
        await options.savePairingRequest(bytes);
        return state();
      } finally {
        bytes.fill(0);
      }
    },
    importPairing: async () => {
      await disable();
      if (!options.pickPairingBundle) {
        throw new RemoteError('AUTH_REQUIRED', 'main-process pairing picker is unavailable');
      }
      const pendingRequestId = pairing.pendingRequestId();
      if (!pendingRequestId) throw new RemoteError('AUTH_REQUIRED', 'active pairing request is unavailable');
      const selected = await options.pickPairingBundle(pendingRequestId);
      if (!selected) return state();
      const managed = isManagedSelection(selected) ? selected : null;
      const bytes: Uint8Array = managed ? managed.bytes : selected as Uint8Array;
      try {
        await pairing.importBytes(bytes);
        await managed?.commit();
        return state();
      } catch (error) {
        await managed?.rollback().catch(() => undefined);
        throw error;
      } finally {
        bytes.fill(0);
      }
    },
    revokePairing: async () => {
      await disable();
      await pairing.revoke();
      return state();
    },
    respondApproval: async (response: RemoteApprovalResponse) => options.approval.respond(response),
  };
}

function isManagedSelection(value: Uint8Array | PairingBundleSelection): value is PairingBundleSelection {
  return !(value instanceof Uint8Array)
    && typeof value === 'object'
    && value !== null
    && value.bytes instanceof Uint8Array
    && typeof value.commit === 'function'
    && typeof value.rollback === 'function';
}

const createNodeSocket: RemoteSocketFactory = (endpoint, headers) => {
  return new WebSocket(endpoint, {
    headers: { ...headers },
    followRedirects: false,
  }) as unknown as RemoteSocket;
};

export function unavailableRemoteState(): RemoteClientState {
  return {
    enabled: false,
    ownerConsentAtMs: null,
    connection: 'disabled',
    queuedCommands: 0,
    lastErrorCode: null,
  };
}
