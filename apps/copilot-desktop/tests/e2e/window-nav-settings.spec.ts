import { expect, openView, test } from './electron.fixture.js';

test.describe.configure({ mode: 'serial' });

test.describe('Electron shell and navigation', () => {
  test('01 app root is visible in the Electron renderer', async ({ appPage }) => {
    await expect(appPage.getByTestId('app-root')).toBeVisible();
  });

  test('02 BrowserWindow title identifies the desktop product', async ({ electronApp }) => {
    const title = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle());
    expect(title).toBe('njx-copilot-v6');
  });

  test('03 local-first Phase 1 subtitle is visible', async ({ appPage }) => {
    await expect(appPage.getByText('v6.2 · local-first personal copilot')).toBeVisible();
  });

  for (const [index, view] of ['schedule', 'knowledge', 'ask', 'settings'].entries()) {
    test(`${String(index + 4).padStart(2, '0')} ${view} navigation opens the real desktop view`, async ({ appPage }) => {
      await openView(appPage, view);
    });
  }

  test('08 Today embeds a truthful local voice capture surface', async ({ appPage }) => {
    await openView(appPage, 'schedule');
    await expect(appPage.getByTestId('view-schedule')).toBeVisible();
    await expect(appPage.getByTestId('schedule-workspace')).toBeVisible();

    const captureCard = appPage.getByTestId('today-capture-card');
    await expect(captureCard).toBeVisible();
    const draft = captureCard.getByTestId('today-capture-draft');
    await expect(draft).toBeEditable();
    await draft.fill('AC08 本地草稿');
    await expect(draft).toHaveValue('AC08 本地草稿');

    await captureCard.getByText('开始本地语音', { exact: true }).click();
    const voiceInput = captureCard.getByTestId('voice-input-root');
    const recorder = voiceInput.getByTestId('voice-recorder-button');
    await expect(voiceInput).toBeVisible();
    await expect(recorder).toBeVisible();
    await recorder.focus();
    await expect(recorder).toBeFocused();

    await expect(appPage.getByTestId('nav-voice')).toHaveCount(0);
    await expect(captureCard.getByText('LOCAL ASR · NOT_READY', { exact: true }).first()).toBeVisible();
    await expect(voiceInput.getByTestId('voice-transcript')).toHaveCount(0);
    await expect(voiceInput.getByTestId('voice-provider-badge')).toHaveCount(0);
    expect(await captureCard.innerText()).not.toMatch(/(?:DECODE|NO-EGRESS)[^\n]{0,24}\bPASS\b/iu);
  });

  test('09 Today is the default view after renderer reload', async ({ appPage }) => {
    await appPage.reload();
    await expect(appPage.getByTestId('view-schedule')).toBeVisible();
    await expect(appPage.getByTestId('schedule-workspace')).toBeVisible();
    await expect(appPage.getByTestId('nav-voice')).toHaveCount(0);
  });

  test('10 renderer context isolation removes CommonJS require', async ({ appPage }) => {
    expect(await appPage.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
  });

  test('11 renderer does not expose the Node process API', async ({ appPage }) => {
    expect(await appPage.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');
  });

  test('12 BrowserWindow enforces minimum dimensions', async ({ electronApp }) => {
    const bounds = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds());
    expect(bounds?.width).toBeGreaterThanOrEqual(720);
    expect(bounds?.height).toBeGreaterThanOrEqual(480);
  });

  test('13 preload exposes truthful product and platform metadata', async ({ appPage }) => {
    const meta = await appPage.evaluate(() => (window as any).copilot.meta);
    expect(meta).toMatchObject({ productName: 'njx-copilot-v6' });
    expect(['darwin', 'win32', 'linux']).toContain(meta.platform);
  });

  test('14 renderer is loaded from a local file, not a browser-hosted Web app', async ({ appPage }) => {
    expect(await appPage.evaluate(() => location.protocol)).toBe('file:');
  });

  test('15 bridge presence does not masquerade as fresh health', async ({ appPage }) => {
    await expect(appPage.getByTestId('status-product-api')).toContainText('PRESENT · HEALTH NOT_PROBED');
  });

  test('16 preload exposes bounded domain APIs and no raw Node primitives', async ({ appPage }) => {
    const keys = await appPage.evaluate(() => Object.keys((window as any).copilot).sort());
    expect(keys).toEqual(expect.arrayContaining(['kg', 'meta', 'notes', 'rag', 'settings', 'startup', 'todos', 'window']));
    expect(keys).not.toEqual(expect.arrayContaining(['fs', 'ipcRenderer', 'require', 'process']));
  });
});

test.describe('Persisted settings through the Electron bridge', () => {
  test('17 Settings panel loads from the desktop route', async ({ appPage }) => {
    await openView(appPage, 'settings');
    await expect(appPage.getByTestId('settings-panel')).toBeVisible();
  });

  test('18 cloud backup defaults OFF in a fresh isolated profile', async ({ appPage }) => {
    await expect(appPage.getByTestId('settings-post-mvp-boundary')).toContainText('OFF · POST-MVP');
    const settings = await appPage.evaluate(() => (window as any).copilot.settings.get());
    expect(settings.cloudBackupEnabled).toBe(false);
  });

  test('19 metadata-only cloud boundary is reported as unavailable', async ({ appPage }) => {
    await expect(appPage.getByTestId('status-cloud-backup')).toContainText('OFF · POST-MVP');
  });

  test('20 unsupported cloud opt-in fails closed and remains OFF', async ({ appPage }) => {
    const result = await appPage.evaluate(async () => {
      try {
        await (window as any).copilot.settings.setCloudBackup(true);
        return { error: '', settings: await (window as any).copilot.settings.get() };
      } catch (error) {
        return { error: String(error), settings: await (window as any).copilot.settings.get() };
      }
    });
    expect(result.error).toContain('UNAVAILABLE');
    expect(result.settings.cloudBackupEnabled).toBe(false);
  });

  for (const [index, theme] of ['dark', 'light', 'auto'].entries()) {
    test(`${index + 21} theme ${theme} persists through the typed bridge`, async ({ appPage }) => {
      await appPage.getByTestId(`theme-radio-${theme}`).check();
      await expect(appPage.locator('html')).toHaveAttribute('data-theme', theme);
      const stored = await appPage.evaluate(() => (window as any).copilot.settings.get());
      expect(stored.theme).toBe(theme);
    });
  }

  test('24 model API key field is a password input', async ({ appPage }) => {
    await expect(appPage.getByTestId('model-api-key')).toHaveAttribute('type', 'password');
  });

  test('25 model selector exposes the four extensible provider choices', async ({ appPage }) => {
    const values = await appPage.getByTestId('model-provider-select').locator('option').evaluateAll(
      (options) => options.map((option) => (option as HTMLOptionElement).value),
    );
    expect(values).toEqual(expect.arrayContaining(['minimax', 'openai', 'claude', 'custom']));
  });

  test('26 default MiniMax config uses the local proxy boundary', async ({ appPage }) => {
    await expect(appPage.getByTestId('model-provider-select')).toHaveValue('minimax');
    await expect(appPage.getByTestId('model-base-url')).toHaveValue('http://127.0.0.1:45557/v1');
    await expect(appPage.getByTestId('model-name')).toHaveValue('MiniMax-M3');
  });

  test('27 settings responses redact a persisted credential', async ({ appPage }) => {
    const safe = await appPage.evaluate(async () => {
      const settings = (window as any).copilot.settings;
      await settings.setModelApi({
        provider: 'minimax',
        baseUrl: 'http://127.0.0.1:45557/v1',
        model: 'MiniMax-M3',
        apiKey: 'sk-e2e-must-never-render',
      });
      const result = await settings.get();
      await settings.setModelApi({
        provider: 'minimax',
        baseUrl: 'http://127.0.0.1:45557/v1',
        model: 'MiniMax-M3',
        clearApiKey: true,
      });
      return result;
    });
    expect(safe.modelApi.apiKey).toBe('');
    expect(safe.modelApi.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(safe)).not.toContain('sk-e2e-must-never-render');
  });

  test('28 reset requires two clicks and restores Phase 1 defaults', async ({ appPage }) => {
    const button = appPage.getByTestId('settings-reset-button');
    await button.click();
    await expect(button).toHaveAttribute('data-armed', 'true');
    appPage.once('dialog', (dialog) => dialog.accept());
    await button.click();
    await expect(button).toHaveAttribute('data-armed', 'false');
    await expect(appPage.getByTestId('settings-post-mvp-boundary')).toContainText('OFF · POST-MVP');
    await expect(appPage.getByTestId('theme-radio-auto')).toBeChecked();
  });
});
