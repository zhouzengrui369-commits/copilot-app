import { expect, openView, test } from './electron.fixture.js';

test.describe.configure({ mode: 'serial' });

let todoId: string | number;
let reminderId: string | number;

test.describe('Schedule local CRUD, reminders, and persistence', () => {
  test('65 Schedule workspace renders inside Electron', async ({ appPage }) => {
    await openView(appPage, 'schedule');
    await expect(appPage.getByTestId('schedule-workspace')).toBeVisible();
  });

  test('66 add-todo form exposes title, time, and note link', async ({ appPage }) => {
    await appPage.getByRole('button', { name: '+ 新增待办' }).click();
    const dialog = appPage.getByRole('dialog', { name: '新增待办' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: '待办标题' })).toBeEditable();
    await expect(dialog.getByRole('button', { name: '选择日期与提醒' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: '搜索关联笔记' })).toBeEditable();
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('67 typed bridge creates a pending linked todo', async ({ appPage }) => {
    const todo = await appPage.evaluate(() => (window as any).copilot.todos.create({
      title: 'E2E prepare materials',
      status: 'pending',
      note_links: ['e2e/reference'],
    }));
    todoId = todo.id;
    expect(todo).toMatchObject({ title: 'E2E prepare materials', status: 'pending' });
    expect(todo.note_links).toEqual(['e2e/reference']);
  });

  test('68 todos.list returns the created record', async ({ appPage }) => {
    const todos = await appPage.evaluate(() => (window as any).copilot.todos.list());
    expect(todos.some((todo: any) => todo.id === todoId)).toBe(true);
  });

  test('69 created todo appears after renderer reload', async ({ appPage }) => {
    await appPage.reload();
    await openView(appPage, 'schedule');
    await expect(appPage.getByText('E2E prepare materials', { exact: true })).toBeVisible();
  });

  test('70 linked note is rendered as a navigation control', async ({ appPage }) => {
    await expect(appPage.getByRole('button', { name: 'e2e/reference' })).toBeVisible();
  });

  test('71 todo status updates to done through main IPC', async ({ appPage }) => {
    const todo = await appPage.evaluate(
      ({ id }) => (window as any).copilot.todos.update({ id, patch: { status: 'done' } }),
      { id: todoId },
    );
    expect(todo.status).toBe('done');
  });

  test('72 status filter returns only completed todos', async ({ appPage }) => {
    const todos = await appPage.evaluate(() => (window as any).copilot.todos.list({ status: 'done' }));
    expect(todos.some((todo: any) => todo.id === todoId)).toBe(true);
    expect(todos.every((todo: any) => todo.status === 'done')).toBe(true);
  });

  test('73 creates a due reminder with a real past epoch', async ({ appPage }) => {
    const todo = await appPage.evaluate(
      ({ remindAt }) => (window as any).copilot.todos.create({
        title: 'E2E due reminder',
        status: 'pending',
        remind_at_ms: remindAt,
        due_at_ms: remindAt,
      }),
      { remindAt: Date.now() - 1_000 },
    );
    reminderId = todo.id;
    expect(todo.remind_at_ms).toBeGreaterThan(0);
  });

  test('74 listDue returns the due reminder', async ({ appPage }) => {
    const due = await appPage.evaluate(() => (window as any).copilot.todos.listDue(Date.now()));
    expect(due.some((todo: any) => todo.id === reminderId)).toBe(true);
  });

  test('75 markReminderFired removes the reminder from the due queue', async ({ appPage }) => {
    await appPage.evaluate((id) => (window as any).copilot.todos.markReminderFired(id), reminderId);
    const due = await appPage.evaluate(() => (window as any).copilot.todos.listDue(Date.now()));
    expect(due.some((todo: any) => todo.id === reminderId)).toBe(false);
  });

  test('76 Schedule switches between accessible list and calendar views', async ({ appPage }) => {
    await appPage.reload();
    await openView(appPage, 'schedule');
    const list = appPage.getByRole('button', { name: '列表视图' });
    const calendar = appPage.getByRole('button', { name: '日历视图' });
    await expect(list).toHaveAttribute('aria-pressed', 'true');
    await calendar.click();
    await expect(calendar).toHaveAttribute('aria-pressed', 'true');
    await expect(appPage.getByRole('region', { name: '日历视图' })).toBeVisible();
    await list.click();
    await expect(appPage.getByRole('list', { name: '待办列表' })).toBeVisible();
  });

  test('77 calendar separates dated and undated local todos', async ({ appPage }) => {
    const dueAt = new Date(2026, 6, 15, 10, 30).getTime();
    const ids = await appPage.evaluate(async ({ dueAtMs }) => {
      const todos = (window as any).copilot.todos;
      const dated = await todos.create({ title: 'E2E calendar dated', status: 'pending', due_at_ms: dueAtMs });
      const undated = await todos.create({ title: 'E2E calendar undated', status: 'pending' });
      return [dated.id, undated.id];
    }, { dueAtMs: dueAt });
    try {
      await appPage.reload();
      await openView(appPage, 'schedule');
      await appPage.getByRole('button', { name: '日历视图' }).click();
      const calendar = appPage.getByRole('region', { name: '日历视图' });
      await expect(calendar.getByRole('group', { name: '2026年7月15日' }).getByText('E2E calendar dated')).toBeVisible();
      await expect(calendar.getByRole('group', { name: '无日期' }).getByText('E2E calendar undated')).toBeVisible();
    } finally {
      await appPage.evaluate(async (todoIds) => {
        await Promise.all(todoIds.map((id) => (window as any).copilot.todos.remove(id)));
      }, ids);
    }
  });

  test('78 linked note control navigates within the Electron app', async ({ appPage }) => {
    await openView(appPage, 'schedule');
    await appPage.getByRole('button', { name: 'e2e/reference' }).click();
    await expect(appPage.getByTestId('view-knowledge')).toBeVisible();
  });

  test('79 todo delete removes the first persisted record', async ({ appPage }) => {
    expect(await appPage.evaluate((id) => (window as any).copilot.todos.remove(id), todoId)).toBe(true);
    const todos = await appPage.evaluate(() => (window as any).copilot.todos.list());
    expect(todos.some((todo: any) => todo.id === todoId)).toBe(false);
  });

  test('80 reminder cleanup removes its persisted system record', async ({ appPage }) => {
    expect(await appPage.evaluate((id) => (window as any).copilot.todos.remove(id), reminderId)).toBe(true);
  });

  test('81 empty todo title is rejected safely', async ({ appPage }) => {
    const message = await appPage.evaluate(async () => {
      try {
        await (window as any).copilot.todos.create({ title: '' });
        return '';
      } catch (error) {
        return String(error);
      }
    });
    expect(message).toContain('INVALID_ARGUMENT');
  });
});

test.describe('Privacy and local context isolation', () => {
  test('82 cloud backup remains OFF after local feature CRUD', async ({ appPage }) => {
    const settings = await appPage.evaluate(() => (window as any).copilot.settings.get());
    expect(settings.cloudBackupEnabled).toBe(false);
  });

  test('83 settings bridge never returns API key plaintext', async ({ appPage }) => {
    const settings = await appPage.evaluate(() => (window as any).copilot.settings.get());
    expect(settings.modelApi.apiKey).toBe('');
  });

  test('84 preload exposes neither filesystem nor raw ipcRenderer', async ({ appPage }) => {
    const keys = await appPage.evaluate(() => Object.keys((window as any).copilot));
    expect(keys).not.toContain('fs');
    expect(keys).not.toContain('ipcRenderer');
  });

  test('85 Electron main uses the isolated per-execution user-data directory', async ({ electronApp }) => {
    const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    expect(userDataPath).toContain('njx-copilot-e2e-run-');
    expect(userDataPath).toContain('user-data');
  });

  test('86 note list metadata omits all note bodies', async ({ appPage }) => {
    const notes = await appPage.evaluate(() => (window as any).copilot.notes.list({ limit: 100 }));
    expect(notes.items.every((note: any) => !Object.prototype.hasOwnProperty.call(note, 'body'))).toBe(true);
  });
});
