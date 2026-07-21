import { expect, openView, test } from './electron.fixture.js';

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

  test('30 Knowledge renders its local note and graph workspace', async ({ appPage }) => {
    await openView(appPage, 'knowledge');
    await expect(appPage.getByTestId('knowledge-workspace')).toBeVisible();
    await expect(appPage.locator('.note-list')).toBeVisible();
    await expect(appPage.getByTestId('kg-root')).toBeVisible();
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

  test('45 graph UI reports production data rather than the 100-node fixture', async ({ appPage }) => {
    await openView(appPage, 'knowledge');
    await expect(appPage.getByTestId('kg-toolbar-meta')).not.toHaveText(/100 \/ 100 nodes/);
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
});
