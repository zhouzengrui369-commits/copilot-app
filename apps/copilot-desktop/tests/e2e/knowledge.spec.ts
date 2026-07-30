import path from 'node:path';
import { _electron as electron, type ElectronApplication } from '@playwright/test';
import {
  APP_ROOT,
  createElectronReceiptRecorder,
  expect,
  openView,
  resolveElectronLaunchContract,
  test,
} from './electron.fixture.js';

test.describe.configure({ mode: 'serial' });

const notePath = 'e2e/knowledge-primary';
const noteTitle = 'E2E Knowledge Primary';

function noteListRow(appPage: Parameters<typeof openView>[0], path: string) {
  return appPage.locator('.note-list li').filter({
    has: appPage.getByText(path, { exact: true }),
  });
}

function noteListPrimaryAction(appPage: Parameters<typeof openView>[0], path: string) {
  return noteListRow(appPage, path).locator('button').first();
}

function launchCase97Electron(userDataPath: string): Promise<ElectronApplication> {
  const launchContract = resolveElectronLaunchContract({
    appRoot: APP_ROOT,
    e2eUserData: userDataPath,
    configuredExecutablePath: process.env.COPILOT_E2E_EXECUTABLE_PATH,
    e2eMode: process.env.COPILOT_E2E_MODE,
    platform: process.platform,
    nodeEnv: 'test',
    copilotE2E: '1',
  });
  return electron.launch({
    executablePath: launchContract.executablePath,
    args: launchContract.args,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      COPILOT_E2E: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeout: 30_000,
  });
}

test.describe('Knowledge local-first persistence and graph boundary', () => {
  test('29 notes.list returns the real paged local response', async ({ appPage }) => {
    const result = await appPage.evaluate(() => (window as any).copilot.notes.list({ limit: 20 }));
    expect(result).toEqual(expect.objectContaining({
      items: expect.any(Array),
      total: expect.any(Number),
      limit: expect.any(Number),
      offset: expect.any(Number),
    }));
  });

  test('30 Knowledge renders its local MOC and disabled post-MVP 3D boundary', async ({ appPage }) => {
    await openView(appPage, 'knowledge');
    await expect(appPage.getByTestId('knowledge-workspace')).toBeVisible();
    await expect(appPage.locator('.note-list')).toBeVisible();
    await expect(appPage.getByTestId('knowledge-moc-reader')).toBeVisible();
    await expect(appPage.getByRole('tab', { name: '2D MOC 阅读' }))
      .toHaveAttribute('aria-selected', 'true');
    const postMvpGraph = appPage.getByText(
      '3D 节点可视化知识图谱 · MVP 后',
      { exact: true },
    );
    await expect(postMvpGraph).toBeVisible();
    await expect(postMvpGraph).toHaveAttribute('aria-disabled', 'true');
    await expect(appPage.getByTestId('knowledge-graph-view')).toHaveCount(0);
  });

  test('31 New note starts from a clean editor', async ({ appPage }) => {
    await appPage.getByRole('button', { name: '新建笔记' }).click();
    await expect(appPage.getByLabel('笔记标题')).toHaveValue('');
    await expect(appPage.getByLabel('笔记正文')).toHaveValue('');
  });

  test('32 editor title is editable', async ({ appPage }) => {
    await expect(appPage.getByLabel('笔记标题')).toBeEditable();
  });

  test('33 editor exposes a deterministic optional path', async ({ appPage }) => {
    await expect(appPage.getByLabel('笔记路径')).toHaveAttribute('placeholder', /inbox/);
  });

  test('34 editor Markdown body is editable', async ({ appPage }) => {
    await expect(appPage.getByLabel('笔记正文')).toBeEditable();
  });

  test('35 editor tags are editable', async ({ appPage }) => {
    await expect(appPage.getByLabel('笔记标签')).toBeEditable();
  });

  test('36 typed Electron bridge creates a local note', async ({ appPage }) => {
    const created = await appPage.evaluate(async ({ path, title }) => {
      const notes = (window as any).copilot.notes;
      await notes.remove(path).catch(() => false);
      return notes.create({
        path,
        title,
        body: '# E2E\n\nPersistent body.',
        tags: ['e2e', 'knowledge'],
        type: 'note',
        status: 'active',
      });
    }, { path: notePath, title: noteTitle });
    expect(created).toMatchObject({ path: notePath, title: noteTitle, tags: ['e2e', 'knowledge'] });
  });

  test('37 note body is read back from local disk-backed storage', async ({ appPage }) => {
    const document = await appPage.evaluate((path) => (window as any).copilot.notes.get(path), notePath);
    expect(document.note.path).toBe(notePath);
    expect(document.body).toContain('Persistent body');
  });

  test('38 created note appears after renderer reload', async ({ appPage }) => {
    await appPage.reload();
    const persisted = await appPage.evaluate(async ({ path, title }) => {
      const result = await (window as any).copilot.notes.list({ limit: 1000 });
      const target = result.items.find((note: any) => note.path === path);
      return {
        target,
        expectedTitle: title,
        visiblePaths: result.items.map((note: any) => note.path),
      };
    }, { path: notePath, title: noteTitle });
    expect(
      persisted.target,
      `reloaded main-process note list did not contain ${notePath}; paths=${JSON.stringify(persisted.visiblePaths)}`,
    ).toMatchObject({ path: notePath, title: noteTitle });

    await openView(appPage, 'knowledge');

    const row = noteListRow(appPage, notePath);
    await expect(row).toHaveCount(1);
    const button = noteListPrimaryAction(appPage, notePath);
    const accessibilitySnapshot = await button.ariaSnapshot();
    await test.info().attach('test-38-accessibility.txt', {
      body: accessibilitySnapshot,
      contentType: 'text/plain',
    });
    expect(accessibilitySnapshot).toContain(noteTitle);
    await expect(button).toContainText(noteTitle);
    await expect(button).toBeVisible();
  });

  test('39 selecting the note opens its real detail panel', async ({ appPage }) => {
    const button = noteListPrimaryAction(appPage, notePath);
    await button.click();
    await expect(appPage.getByTestId('note-detail-panel')).toBeVisible();
    await expect(appPage.getByTestId('note-detail-panel')).toContainText('Persistent body');
  });

  test('40 detail panel exposes path and local tags', async ({ appPage }) => {
    await expect(appPage.getByTestId('note-detail-meta')).toContainText(notePath);
    await expect(appPage.getByTestId('note-tag')).toHaveCount(2);
  });

  test('41 typed bridge updates title and body atomically', async ({ appPage }) => {
    const updated = await appPage.evaluate(
      ({ path }) => (window as any).copilot.notes.update({
        path,
        patch: { title: 'E2E Knowledge Updated', body: '# Updated\n\nStill local.' },
      }),
      { path: notePath },
    );
    expect(updated).toMatchObject({ path: notePath, title: 'E2E Knowledge Updated' });
  });

  test('42 updated note survives renderer reload', async ({ appPage }) => {
    await appPage.reload();
    await openView(appPage, 'knowledge');
    const button = noteListPrimaryAction(appPage, notePath);
    await expect(button).toContainText('E2E Knowledge Updated');
    await expect(button).toBeVisible();
    const document = await appPage.evaluate((path) => (window as any).copilot.notes.get(path), notePath);
    expect(document.body.trim()).toBe('# Updated\n\nStill local.');
  });

  test('43 backlinks response does not expose note bodies', async ({ appPage }) => {
    const backlinks = await appPage.evaluate((path) => (window as any).copilot.notes.getBacklinks(path), notePath);
    expect(backlinks).toEqual(expect.any(Array));
    expect(JSON.stringify(backlinks)).not.toContain('Still local');
  });

  test('44 KG endpoint returns the real graph contract', async ({ appPage }) => {
    const graph = await appPage.evaluate(() => (window as any).copilot.kg.getSubgraph({ maxNodes: 100 }));
    expect(graph).toEqual(expect.objectContaining({
      nodes: expect.any(Array),
      edges: expect.any(Array),
      degree: expect.any(Object),
    }));
  });

  test('45 Knowledge UI does not restore the retired graph or 100-node fixture', async ({ appPage }) => {
    await openView(appPage, 'knowledge');
    await expect(appPage.getByRole('tab', { name: '2D MOC 阅读' }))
      .toHaveAttribute('aria-selected', 'true');
    await expect(appPage.getByText('3D 节点可视化知识图谱 · MVP 后', { exact: true }))
      .toHaveAttribute('aria-disabled', 'true');
    await expect(appPage.getByTestId('kg-toolbar-meta')).toHaveCount(0);
    await expect(appPage.getByTestId('knowledge-graph-view')).toHaveCount(0);
  });

  test('46 invalid empty note is rejected by main with a curated error', async ({ appPage }) => {
    const message = await appPage.evaluate(async () => {
      try {
        await (window as any).copilot.notes.create({ path: '', title: '', body: '' });
        return '';
      } catch (error) {
        return String(error);
      }
    });
    expect(message).toContain('INVALID_ARGUMENT');
    expect(message).not.toContain(' at ');
  });

  test('47 system todo records stay hidden from public note listing', async ({ appPage }) => {
    const result = await appPage.evaluate(async () => {
      const todo = await (window as any).copilot.todos.create({ title: 'E2E hidden system todo' });
      const notes = await (window as any).copilot.notes.list({ limit: 1000 });
      await (window as any).copilot.todos.remove(todo.id);
      return { todoId: String(todo.id), paths: notes.items.map((note: any) => note.path) };
    });
    expect(result.paths.some((value: string) => value.includes(result.todoId))).toBe(false);
  });

  test('48 remove deletes the persisted note and associated local indexes', async ({ appPage }) => {
    expect(await appPage.evaluate((path) => (window as any).copilot.notes.remove(path), notePath)).toBe(true);
    expect(await appPage.evaluate((path) => (window as any).copilot.notes.get(path), notePath)).toBeNull();
  });

  test('49 an unknown public note returns null without a filesystem path', async ({ appPage }) => {
    const result = await appPage.evaluate(() => (window as any).copilot.notes.get('e2e/does-not-exist'));
    expect(result).toBeNull();
  });

  test('50 Markdown note renders through the production detail renderer', async ({ appPage }) => {
    const path = 'e2e/markdown-renderer';
    await appPage.evaluate(async (notePath) => {
      const notes = (window as any).copilot.notes;
      await notes.remove(notePath).catch(() => false);
      await notes.create({
        path: notePath,
        title: 'E2E Markdown Renderer',
        body: '# Markdown survives\n\n**Bold markdown**\n\n- first\n- second',
        tags: ['e2e', 'markdown'],
        type: 'note',
        status: 'active',
      });
    }, path);
    try {
      await appPage.reload();
      await openView(appPage, 'knowledge');
      const button = noteListPrimaryAction(appPage, path);
      await expect(button).toContainText('E2E Markdown Renderer');
      await button.click();
      const renderer = appPage.getByTestId('markdown-renderer');
      await expect(renderer.getByRole('heading', { name: 'Markdown survives' })).toBeVisible();
      await expect(renderer.locator('strong')).toHaveText('Bold markdown');
      await expect(renderer.getByText('first', { exact: true })).toBeVisible();
    } finally {
      await appPage.evaluate((notePath) => (window as any).copilot.notes.remove(notePath).catch(() => false), path);
    }
  });

  test('97 create-with-build keeps LOCAL_SAVED after a full Electron relaunch', async ({ e2eUserData }) => {
    const isolatedUserData = path.join(e2eUserData, 'dci-core-1-case-97');
    const pathOwned = 'e2e/dci-core-1-local-commit';
    const recorder = createElectronReceiptRecorder('knowledge-case-97');
    let first: ElectronApplication | null = null;
    let second: ElectronApplication | null = null;
    try {
      first = await launchCase97Electron(isolatedUserData);
      await recorder.recordRuntime(first);
      try {
        const page = await first.firstWindow();
        await page.waitForLoadState('domcontentloaded');
        const receipt = await page.evaluate(async (notePath) => {
          const notes = (window as any).copilot.notes;
          await notes.remove(notePath).catch(() => false);
          return notes.createWithBuild({
            path: notePath,
            title: 'DCI local commit',
            body: 'Local bytes survive regardless of build outcome.',
            tags: ['e2e', 'dci-core-1'],
          });
        }, pathOwned);
        expect(receipt).toMatchObject({
          localState: 'LOCAL_SAVED',
          note: { path: pathOwned },
        });
      } finally {
        const firstExit = await recorder.closeAndRecord(first);
        first = null;
        expect(firstExit).toMatchObject({
          clean: true,
          exitCode: 0,
          signalCode: null,
          error: null,
        });
      }

      second = await launchCase97Electron(isolatedUserData);
      await recorder.recordRuntime(second);
      const page = await second.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await expect.poll(
        () => page.evaluate(
          (notePath) => (window as any).copilot.notes.get(notePath),
          pathOwned,
        ),
      ).toMatchObject({
        note: { path: pathOwned },
        body: expect.stringContaining('Local bytes survive'),
      });
    } finally {
      if (second) await recorder.closeAndRecord(second);
      if (first) await recorder.closeAndRecord(first);
      await recorder.flush();
    }
  });

  test('104 Knowledge UI submit persists exact bytes, reaches current, and survives renderer reload as LOCAL_DERIVED MOC truth', async ({
    appPage,
    fakeMiniMaxProvider,
  }) => {
    const uiPath = 'e2e/b3-knowledge-ui-submit';
    const uiTitle = 'B3 Knowledge UI submit';
    const uiBody = `B3KnowledgeUi${Date.now()} exact local body`;
    await appPage.evaluate(async (path: string) => {
      await (window as any).copilot.notes.remove(path).catch(() => false);
    }, uiPath);
    fakeMiniMaxProvider.reset('success');
    try {
      await openView(appPage, 'knowledge');
      await appPage.getByRole('button', { name: '新建笔记' }).click();
      await appPage.getByLabel('笔记标题').fill(uiTitle);
      await appPage.getByLabel('笔记路径').fill(uiPath);
      await appPage.getByLabel('笔记标签').fill('e2e, b3-ui');
      await appPage.getByLabel('笔记正文').fill(uiBody);
      await appPage.getByRole('button', { name: '保存到本地' }).click();

      await expect(appPage.getByTestId('knowledge-save-receipt')).toContainText('LOCAL_SAVED');
      await expect(appPage.getByTestId('knowledge-save-path')).toHaveText(uiPath);
      expect(await appPage.evaluate(
        async (path: string) => (window as any).copilot.notes.get(path),
        uiPath,
      )).toMatchObject({
        note: { path: uiPath, title: uiTitle },
        body: `${uiBody}\n`,
      });
      await expect(appPage.getByTestId('wiki-truth-chip')).toHaveText('CURRENT', {
        timeout: 30_000,
      });
      await expect(appPage.getByTestId('wiki-truth-block')).toHaveAttribute(
        'data-wiki-state',
        'current',
      );

      await appPage.reload();
      await openView(appPage, 'knowledge');
      await expect(appPage.getByTestId('moc-truth-chip')).toHaveText('LOCAL_DERIVED');
      const reloadedNote = noteListPrimaryAction(appPage, uiPath);
      await expect(reloadedNote).toContainText(uiTitle);
      await reloadedNote.click();
      await expect(appPage.getByTestId('note-detail-meta')).toContainText(uiPath);
      await expect(appPage.getByTestId('note-detail-panel')).toContainText(uiBody);
      await expect(appPage.getByTestId('wiki-truth-chip')).toHaveText('CURRENT', {
        timeout: 30_000,
      });
    } finally {
      await appPage.evaluate(async (path: string) => {
        await (window as any).copilot.notes.remove(path).catch(() => false);
      }, uiPath);
    }
  });
});
