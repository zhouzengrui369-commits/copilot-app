export interface RemotePreference {
  enabled: boolean;
  ownerConsentAtMs: number | null;
}

export const DEFAULT_REMOTE_PREFERENCE: Readonly<RemotePreference> = Object.freeze({
  enabled: false,
  ownerConsentAtMs: null,
});

export interface RemotePreferenceStore {
  get(): RemotePreference;
  set(value: RemotePreference): void;
  reset(): void;
}

export class InMemoryRemotePreferenceStore implements RemotePreferenceStore {
  private value: RemotePreference;

  constructor(initial: RemotePreference = DEFAULT_REMOTE_PREFERENCE) {
    this.value = normalizePreference(initial);
  }

  get(): RemotePreference {
    return { ...this.value };
  }

  set(value: RemotePreference): void {
    this.value = normalizePreference(value);
  }

  reset(): void {
    this.value = { ...DEFAULT_REMOTE_PREFERENCE };
  }
}

export function normalizePreference(value: unknown): RemotePreference {
  if (!value || typeof value !== 'object') return { ...DEFAULT_REMOTE_PREFERENCE };
  const candidate = value as Partial<RemotePreference>;
  if (candidate.enabled !== true || !Number.isSafeInteger(candidate.ownerConsentAtMs)) {
    return { ...DEFAULT_REMOTE_PREFERENCE };
  }
  return { enabled: true, ownerConsentAtMs: candidate.ownerConsentAtMs as number };
}
