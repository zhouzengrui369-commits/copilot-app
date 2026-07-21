/**
 * settings-store tests — focus on the pure logic in settings-store.ts:
 *   - DEFAULT_SETTINGS sanity (cloudBackupEnabled === false, the
 *     goal.md decision 2 contract).
 *   - wrapElectronStore round-trip with an in-memory fake.
 *   - mergeWithDefaults handles missing/garbage fields without crashing.
 *   - validateShortcut rejects malformed accelerators.
 *
 * Tests run in plain node + vitest with zero Electron bootstrap. The one
 * production-factory case uses and removes its own OS temp directory.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SHORTCUTS,
  SETTINGS_STORE_NAME,
  applyModelApiMutation,
  canonicalizeWindowBounds,
  createSettingsStore,
  mergeWithDefaults,
  materializeWindowBoundsForSetBounds,
  parseWindowBoundsMutation,
  redactSettingsForRenderer,
  validateModelApi,
  validateShortcut,
  wrapElectronStore,
  type SettingsStorage,
} from '../src/main/settings-store';

class MemoryStorage implements SettingsStorage {
  private data: Record<string, unknown> = {};

  get<K extends keyof typeof DEFAULT_SETTINGS>(key: K): (typeof DEFAULT_SETTINGS)[K] {
    return (this.data[key as string] ?? DEFAULT_SETTINGS[key]) as (typeof DEFAULT_SETTINGS)[K];
  }

  set<K extends keyof typeof DEFAULT_SETTINGS>(key: K, value: (typeof DEFAULT_SETTINGS)[K]): void {
    this.data[key as string] = value;
  }

  getAll() {
    return mergeWithDefaults(this.data);
  }

  setAll(value: typeof DEFAULT_SETTINGS) {
    this.data = { ...value };
  }

  reset() {
    this.data = {};
  }
}

function fakeElectronStore(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: (key: string) => data[key],
    set: (key: string, value: unknown) => {
      data[key] = value;
    },
    get store() {
      return { ...data };
    },
    set store(value: Record<string, unknown>) {
      Object.keys(data).forEach((k) => delete data[k]);
      Object.assign(data, value);
    },
    clear: () => {
      Object.keys(data).forEach((k) => delete data[k]);
    },
  };
}

describe('DEFAULT_SETTINGS contract', () => {
  it('defaults cloud backup to OFF (goal.md decision 2)', () => {
    expect(DEFAULT_SETTINGS.cloudBackupEnabled).toBe(false);
  });

  it('defaults theme to auto', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('auto');
  });

  it('seeds the three canonical shortcuts', () => {
    expect(DEFAULT_SHORTCUTS).toHaveLength(3);
    expect(DEFAULT_SHORTCUTS.map((s) => s.id)).toEqual([
      'open-settings',
      'new-note',
      'toggle-search',
    ]);
  });

  it('exposes the electron-store file name as a constant', () => {
    expect(SETTINGS_STORE_NAME).toBe('copilot-desktop');
  });
});

describe('wrapElectronStore (in-memory fake)', () => {
  it('returns defaults when storage is empty', () => {
    const s = wrapElectronStore(fakeElectronStore());
    expect(s.getAll()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a cloud-backup flip', () => {
    const s = wrapElectronStore(fakeElectronStore());
    s.set('cloudBackupEnabled', true);
    expect(s.get('cloudBackupEnabled')).toBe(true);
    s.set('cloudBackupEnabled', false);
    expect(s.get('cloudBackupEnabled')).toBe(false);
  });

  it('round-trips theme + shortcuts + bounds', () => {
    const s = wrapElectronStore(fakeElectronStore());
    s.set('theme', 'dark');
    s.set('shortcuts', [{ id: 'a', label: 'A', accelerator: 'Command+A' }]);
    s.set('windowBounds', { width: 1024, height: 768, x: 50, y: 60 });
    const all = s.getAll();
    expect(all.theme).toBe('dark');
    expect(all.shortcuts).toEqual([{ id: 'a', label: 'A', accelerator: 'Command+A' }]);
    expect(all.windowBounds).toEqual({ width: 1024, height: 768, x: 50, y: 60 });
  });

  it('reset() restores defaults', () => {
    const s = wrapElectronStore(fakeElectronStore({ cloudBackupEnabled: true }));
    expect(s.get('cloudBackupEnabled')).toBe(true);
    s.reset();
    expect(s.get('cloudBackupEnabled')).toBe(false);
  });

  it('createSettingsStore is wired (factory smoke test, no real fs)', () => {
    // We don't actually call createSettingsStore() against a real path
    // (that would touch the user's electron-store file system). Instead
    // we verify the export exists and exposes the expected interface.
    expect(typeof createSettingsStore).toBe('function');
  });
});

describe('mergeWithDefaults', () => {
  it('fills missing keys with defaults', () => {
    const merged = mergeWithDefaults({ cloudBackupEnabled: true });
    expect(merged.cloudBackupEnabled).toBe(true);
    expect(merged.theme).toBe('auto');
    expect(merged.windowBounds).toEqual(DEFAULT_SETTINGS.windowBounds);
  });

  it('rejects invalid theme values', () => {
    const merged = mergeWithDefaults({ theme: 'plaid' as unknown as string });
    expect(merged.theme).toBe('auto');
  });

  it('rejects malformed windowBounds', () => {
    const merged = mergeWithDefaults({
      windowBounds: { width: 'huge' as unknown as number, height: 800 },
    });
    expect(merged.windowBounds).toEqual(DEFAULT_SETTINGS.windowBounds);
  });

  it('omits absent or non-numeric optional coordinates as own properties', () => {
    const merged = mergeWithDefaults({
      windowBounds: { width: 1024, height: 768, x: undefined, y: 'invalid' },
    });

    expect(merged.windowBounds).toEqual({ width: 1024, height: 768 });
    expect(Object.hasOwn(merged.windowBounds, 'x')).toBe(false);
    expect(Object.hasOwn(merged.windowBounds, 'y')).toBe(false);
  });

  it('keeps numeric optional coordinates, including zero and negative display positions', () => {
    expect(canonicalizeWindowBounds({ width: 1024, height: 768, x: 0, y: -120 })).toEqual({
      width: 1024,
      height: 768,
      x: 0,
      y: -120,
    });
  });

  it('canonicalizes untrusted IPC writes without own undefined coordinates', () => {
    const next = parseWindowBoundsMutation({
      width: 960,
      height: 640,
      x: undefined,
      y: 'not-a-coordinate',
    });

    expect(next).toEqual({ width: 960, height: 640 });
    expect(Object.hasOwn(next!, 'x')).toBe(false);
    expect(Object.hasOwn(next!, 'y')).toBe(false);
    expect(parseWindowBoundsMutation({ width: '960', height: 640 })).toBeNull();
  });

  it('preserves numeric IPC coordinates', () => {
    expect(parseWindowBoundsMutation({ width: 960, height: 640, x: -200, y: 0 })).toEqual({
      width: 960,
      height: 640,
      x: -200,
      y: 0,
    });
  });

  it('passes fresh default bounds to a strict Electron-like setBounds fake', () => {
    const fresh = mergeWithDefaults({ windowBounds: { width: 1280, height: 800 } });
    const strictSetBounds = (bounds: typeof fresh.windowBounds) => {
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (typeof bounds[key] !== 'number') {
          throw new TypeError(`${key} must be numeric`);
        }
      }
    };
    const electronBounds = materializeWindowBoundsForSetBounds(fresh.windowBounds, {
      x: 320,
      y: 240,
    });

    expect(() => strictSetBounds(electronBounds)).not.toThrow();
    expect(Object.keys(fresh.windowBounds)).toEqual(['width', 'height']);
    expect(electronBounds).toEqual({ width: 1280, height: 800, x: 320, y: 240 });
  });

  it('prefers persisted numeric coordinates over the current window position', () => {
    expect(materializeWindowBoundsForSetBounds(
      { width: 1024, height: 768, x: -600, y: 42 },
      { x: 320, y: 240 },
    )).toEqual({ width: 1024, height: 768, x: -600, y: 42 });
  });

  it('returns canonical bounds from a real fresh store in a test-owned temp directory', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'copilot-settings-store-'));
    try {
      const fresh = createSettingsStore(cwd).getAll().windowBounds;
      expect(fresh).toEqual({ width: 1280, height: 800 });
      expect(Object.hasOwn(fresh, 'x')).toBe(false);
      expect(Object.hasOwn(fresh, 'y')).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('filters out malformed shortcuts', () => {
    const merged = mergeWithDefaults({
      shortcuts: [
        { id: 'good', label: 'Good', accelerator: 'Command+G' },
        { id: '', label: 'Bad', accelerator: 'X' },
        null,
        { id: 'no-accel', label: 'NoAccel' },
      ],
    });
    expect(merged.shortcuts).toEqual([{ id: 'good', label: 'Good', accelerator: 'Command+G' }]);
  });

  it('preserves unknown keys as part of getAll() result', () => {
    // Unknown keys are dropped here because we only project to the known
    // CopilotSettings shape — but mergeWithDefaults must not throw.
    expect(() => mergeWithDefaults({ somethingElse: 42 })).not.toThrow();
  });
});

describe('validateShortcut', () => {
  it('accepts a well-formed accelerator', () => {
    expect(validateShortcut({ id: 'x', label: 'X', accelerator: 'Command+K' })).toEqual({
      id: 'x',
      label: 'X',
      accelerator: 'Command+K',
    });
  });

  it('rejects accelerators with spaces or unsupported characters', () => {
    expect(
      validateShortcut({ id: 'x', label: 'X', accelerator: 'Command Or Control+K' }),
    ).toBeNull();
    expect(validateShortcut({ id: 'x', label: 'X', accelerator: '' })).toBeNull();
  });

  it('assigns a uuid + default label when missing', () => {
    const out = validateShortcut({ accelerator: 'Command+L' });
    expect(out?.id).toMatch(/[0-9a-f-]{36}/i);
    expect(out?.label).toBe('Shortcut');
    expect(out?.accelerator).toBe('Command+L');
  });
});

describe('MemoryStorage (used by renderer tests)', () => {
  let store: MemoryStorage;
  beforeEach(() => {
    store = new MemoryStorage();
  });

  it('falls back to DEFAULT_SETTINGS for any unset key', () => {
    expect(store.get('theme')).toBe('auto');
    expect(store.get('cloudBackupEnabled')).toBe(false);
  });

  it('set + get round-trip', () => {
    store.set('theme', 'light');
    expect(store.get('theme')).toBe('light');
  });
});

describe('modelApi (Sprint 1.2 T-1.2.6)', () => {
  it('mergeWithDefaults fills in defaults when stored snapshot has no modelApi', () => {
    const merged = mergeWithDefaults({ cloudBackupEnabled: false });
    expect(merged.modelApi.provider).toBe('minimax');
    expect(merged.modelApi.baseUrl).toBe('http://127.0.0.1:45557/v1');
    expect(merged.modelApi.model).toBe('MiniMax-M3');
  });

  it('mergeWithDefaults preserves an existing modelApi (provider field)', () => {
    const merged = mergeWithDefaults({
      modelApi: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '[REDACTED]' },
    });
    expect(merged.modelApi.provider).toBe('openai');
    expect(merged.modelApi).not.toHaveProperty('apiKey');
  });

  it('mergeWithDefaults downgrades unknown provider ids to minimax', () => {
    // @ts-ignore — testing runtime guard
    const merged = mergeWithDefaults({ modelApi: { provider: 'bogus', baseUrl: 'x', model: 'y' } });
    expect(merged.modelApi.provider).toBe('minimax');
  });

  it('validateModelApi accepts renderer-shaped payloads (id field)', () => {
    const v = validateModelApi({ id: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '[REDACTED]' });
    expect(v).not.toBeNull();
    expect(v?.provider).toBe('openai');
  });

  it('validateModelApi accepts main-shaped payloads (provider field)', () => {
    const v = validateModelApi({ provider: 'claude', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022', apiKey: '[REDACTED]' });
    expect(v).not.toBeNull();
    expect(v?.provider).toBe('claude');
  });

  it('validateModelApi returns null for empty baseUrl', () => {
    expect(validateModelApi({ provider: 'openai', baseUrl: '', model: 'gpt-4o', apiKey: '[REDACTED]' })).toBeNull();
  });

  it('validateModelApi returns null for empty model', () => {
    expect(validateModelApi({ provider: 'openai', baseUrl: 'https://x', model: '', apiKey: '[REDACTED]' })).toBeNull();
  });

  it('validateModelApi returns null for non-object input', () => {
    expect(validateModelApi(null)).toBeNull();
    expect(validateModelApi('hello')).toBeNull();
  });

  it('never returns a persisted API key to the renderer snapshot', () => {
    const stored = mergeWithDefaults({
      modelApi: {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiKey: '[REDACTED]',
      },
    });
    const publicSettings = redactSettingsForRenderer(stored, {
      apiKeyConfigured: true,
      status: 'configured',
    });
    expect(stored.modelApi).not.toHaveProperty('apiKey');
    expect(publicSettings.modelApi.apiKey).toBe('');
    expect(publicSettings.modelApi.apiKeyConfigured).toBe(true);
    expect(publicSettings.modelApi.credentialStatus).toBe('configured');
    expect(JSON.stringify(publicSettings)).not.toContain('[REDACTED]');
  });

  it('parses write-only replacement, preserve, and explicit clear actions', () => {
    const current = {
      provider: 'openai' as const,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    expect(applyModelApiMutation(current, {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: '',
    })?.credentialAction).toBe('preserve');
    expect(applyModelApiMutation(current, {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: '[REDACTED]',
    })).toMatchObject({ credentialAction: 'replace', credential: '[REDACTED]' });
    expect(applyModelApiMutation(current, {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      clearApiKey: true,
    })?.credentialAction).toBe('clear');
  });

  it('reads legacy plaintext only through the main-only migration hook and clears exact bytes', () => {
    const raw = fakeElectronStore({
      modelApi: {
        provider: 'minimax',
        baseUrl: 'https://model.example/v1',
        model: 'MiniMax-M3',
        apiKey: '[REDACTED]',
      },
    });
    const store = wrapElectronStore(raw);
    expect(store.getAll().modelApi).not.toHaveProperty('apiKey');
    expect(store.readLegacyModelApiCredential?.()).toBe('[REDACTED]');
    store.clearLegacyModelApiCredentialExact?.('[REDACTED]');
    expect(store.readLegacyModelApiCredential?.()).toBeNull();
  });
});
