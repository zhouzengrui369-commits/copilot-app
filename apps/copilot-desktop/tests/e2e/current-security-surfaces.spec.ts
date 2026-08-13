import { expect, openView, test } from './electron.fixture.js';

test.describe.configure({ mode: 'serial' });

test.describe('Current-source Electron and reachable security surfaces', () => {
  test('87 launched main process reports the current Electron 38 runtime identity', async ({ electronApp }) => {
    const identity = await electronApp.evaluate(() => ({
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      modules: process.versions.modules,
      napi: process.versions.napi,
      arch: process.arch,
      platform: process.platform,
    }));

    expect(identity.electron).toBe('38.8.6');
    expect(identity.modules).toBe('139');
    expect(identity.chrome).toMatch(/^140\./);
    expect(identity.node).toMatch(/^22\./);
    expect(identity.napi).toMatch(/^\d+$/);
    expect(['arm64', 'x64']).toContain(identity.arch);
    expect(['darwin', 'win32']).toContain(identity.platform);
  });

  test('88 fresh profile shows encrypted backup OFF and unconfigured', async ({ appPage }) => {
    await openView(appPage, 'settings');
    const group = appPage.getByTestId('backup-management');
    await expect(group).toBeVisible();
    await expect(group).toContainText('State: OFF');
    await expect(group.getByRole('status')).toContainText('endpoint/token and COS owner binding are not configured');
  });

  test('89 backup owner consent starts empty and cannot proceed without configuration', async ({ appPage }) => {
    const consent = appPage.getByTestId('backup-owner-consent');
    await expect(consent.locator('input[type="checkbox"]')).toHaveCount(3);
    for (const checkbox of await consent.locator('input[type="checkbox"]').all()) {
      await expect(checkbox).not.toBeChecked();
    }
    await expect(consent.getByRole('button', { name: 'Review owner consent' })).toBeDisabled();
    await expect(appPage.getByTestId('backup-manual-actions')).toHaveCount(0);
  });

  test('90 real backup bridge exposes a redacted fail-closed state', async ({ appPage }) => {
    const state = await appPage.evaluate(() => (window as any).copilot.backup.getState());
    expect(state).toMatchObject({
      enabled: false,
      configured: false,
      catalog: [],
      allowedScopes: [],
      activeOperation: null,
      schedulingAvailable: false,
      replaceCurrentAvailable: false,
      recoveryRequired: false,
    });
    expect(JSON.stringify(state)).not.toMatch(/token|secret|credential|ciphertext/i);
  });

  test('91 real backup commands fail closed without creating upload or restore affordances', async ({ appPage }) => {
    const result = await appPage.evaluate(async () => {
      const backup = (window as any).copilot.backup;
      const capture = async (action: () => Promise<unknown>) => {
        try {
          await action();
          return 'unexpected success';
        } catch (error) {
          return String(error);
        }
      };
      return {
        prepare: await capture(() => backup.prepareEnable(['note-markdown', 'note-metadata'])),
        create: await capture(() => backup.create({ selectedScopes: ['note-markdown', 'note-metadata'] })),
        restoreApply: await capture(() => backup.restoreApply({
          snapshotId: '11111111-1111-4111-8111-111111111111',
          selectedScopes: ['note-markdown', 'note-metadata'],
          previewDigest: 'a'.repeat(64),
          generation: 0,
        })),
        state: await backup.getState(),
      };
    });

    expect(result.prepare).toContain('COS_UNAVAILABLE');
    expect(result.create).toContain('BACKUP_DISABLED');
    expect(result.restoreApply).toContain('BACKUP_DISABLED');
    expect(result.state.enabled).toBe(false);
    expect(result.state.catalog).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\/|authorization|bearer|ciphertext/i);
  });

  test('92 backup OFF and unconfigured state survives renderer reload', async ({ appPage }) => {
    await appPage.reload();
    await openView(appPage, 'settings');
    const group = appPage.getByTestId('backup-management');
    await expect(group).toContainText('State: OFF');
    await expect(group.getByRole('status')).toContainText('not configured');
  });

  test('93 fresh profile shows remote management OFF with pairing required', async ({ appPage }) => {
    const group = appPage.getByTestId('settings-remote-management-group');
    await expect(group).toBeVisible();
    await expect(appPage.getByTestId('remote-management-state')).toContainText('State: OFF');
    await expect(appPage.getByTestId('remote-management-state')).toContainText('Queued commands: 0');
    await expect(appPage.getByTestId('remote-pairing-status')).toContainText('Pairing: required');
  });

  test('94 import revoke and enable stay disabled before a verified pairing', async ({ appPage }) => {
    const group = appPage.getByTestId('settings-remote-management-group');
    await expect(group.getByRole('button', { name: 'Create public pairing request' })).toBeEnabled();
    await expect(group.getByRole('button', { name: 'Import encrypted signed response' })).toBeDisabled();
    await expect(group.getByRole('button', { name: 'Revoke pairing' })).toBeDisabled();
    await expect(group.getByRole('button', { name: 'Enable with owner consent' })).toBeDisabled();
  });

  test('95 real remote bridge rejects enable without pairing and remains OFF', async ({ appPage }) => {
    const result = await appPage.evaluate(async () => {
      const remote = (window as any).copilot.remote;
      let error = '';
      try {
        await remote.enable({ ownerConsent: true });
      } catch (caught) {
        error = String(caught);
      }
      return { error, state: await remote.getState() };
    });

    expect(result.error).toContain('AUTH_REQUIRED');
    expect(result.state).toMatchObject({
      enabled: false,
      connection: 'disabled',
      queuedCommands: 0,
      pairing: { configured: false, pendingRequest: false, recoveryRequired: false },
    });
    expect(JSON.stringify(result)).not.toMatch(/relayToken|privateKey|sessionKey|bearer/i);
  });

  test('96 preload exposes bounded bridges and preserves invalid RAG IPC errors', async ({ appPage }) => {
    const result = await appPage.evaluate(async () => {
      const api = (window as any).copilot;
      let ragError = '';
      try {
        await api.rag.ask('');
      } catch (error) {
        ragError = String(error);
      }
      return {
        surface: {
          backup: Object.keys(api.backup).sort(),
          remote: Object.keys(api.remote).sort(),
          root: Object.keys(api).sort(),
        },
        ragError,
      };
    });

    expect(result.surface.backup).toEqual([
      'create', 'deleteRemote', 'disable', 'downloadVerify', 'enable', 'getState',
      'onApprovalLifecycle', 'onApprovalRequest', 'prepareEnable', 'respondApproval',
      'restoreApply', 'restorePreview', 'upload',
    ]);
    expect(result.surface.remote).toEqual([
      'createPairingRequest', 'disable', 'enable', 'getState', 'importPairing',
      'onApprovalLifecycle', 'onApprovalRequest', 'respondApproval', 'revokePairing',
    ]);
    expect(result.surface.root).not.toEqual(expect.arrayContaining(['ipcRenderer', 'fs', 'process', 'require', 'trash']));
    expect(result.ragError).toContain('INVALID_ARGUMENT');
    expect(result.ragError).not.toContain('[INTERNAL]');
  });
});
