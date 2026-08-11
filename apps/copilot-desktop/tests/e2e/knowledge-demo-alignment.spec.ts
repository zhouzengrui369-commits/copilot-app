/**
 * Knowledge Demo direct-source alignment R1 — focused Electron E2E.
 *
 * Sprint: 2026-07-24-knowledge-demo-direct-source-r1
 * Plan: tasks/openclaw/2026-07-24-knowledge-demo-direct-source-r1/PLAN.md
 * Gap authority:
 *   tasks/codex/2026-07-24-knowledge-demo-gap-audit-r1/KNOWLEDGE_GAP_MATRIX.md
 *
 * Focused Electron E2E for the MOC primary view and 2D secondary view.
 *
 * The spec runs against the REAL Electron app launched by
 * `tests/e2e/electron.fixture.js` (real `window.copilot.notes`
 * bridge, fresh worker-scoped user-data). It does NOT launch a
 * browser; it does NOT seed the database; it does NOT mock the
 * bridge.
 *
 * The only task-owned note path this spec touches is
 * `e2e/knowledge-demo-alignment-r1`. Each test:
 *
 *   1. removes that exact path (best-effort, catches ENOENT);
 *   2. creates a single real local note via `window.copilot.notes.create`;
 *   3. re-opens the Knowledge view, reloads, asserts MOC / reading
 *      path / topic cards / NoteDetail / 2D secondary / WIKI truth
 *      / no fixture strings;
 *   4. cleans the same path again in `test.afterAll` of each
 *      describe block so subsequent runs start clean; each
 *      test also calls the idempotent `ensureTaskNoteRemoved`
 *      before creating, so prior failures do not leak the
 *      unique path into the next test in the same describe.
 *
 * The spec does NOT assert `moc-total-count === '0'` or
 * `=== '1'`: real Electron user-data may carry other notes from
 * other suites (the runner wires one fresh worker user-data per
 * run, but the assertions must remain stable when other
 * task-owned notes exist or are removed by parallel suites).
 * Zero-data UI coverage stays in the focused Vitest unit tests.
 *
 * The spec is NOT release / MVP / RAG / ASR / KG source-navigation
 * evidence. It is a current-byte real-Electron navigation + UI
 * evidence gate only.
 *
 * Status: KNOWLEDGE_ELECTRON_SPEC_SOURCE_READY /
 *         REAL_ELECTRON_RUN_PENDING / MVP_NOT_COMPLETE.
 */

import { expect, openView, test } from './electron.fixture.js';
import type {
  FakeMiniMaxProfile,
  FakeMiniMaxProvider,
  FakeMiniMaxRequestReceipt,
} from './helpers/fake-minimax-provider.js';

test.describe.configure({ mode: 'serial' });

const TASK_NOTE_PATH = 'e2e/knowledge-demo-alignment-r1';
const TASK_NOTE_TITLE = 'Knowledge Electron Spec R1';
const TASK_NOTE_BODY = [
  '# Knowledge Electron Spec R1',
  '',
  'Real local note created by `tests/e2e/knowledge-demo-alignment.spec.ts`',
  'during the Knowledge Electron focused E2E run. This body line',
  'is the truth used by the focused tests; no fixture or mock.',
].join('\n');
const TASK_NOTE_TAGS = ['e2e', 'knowledge-demo-alignment-r1'];
const FORBIDDEN_FIXTURE_PATTERN = /DEMO FIXTURE|SIMULATED|3D 星辰大海/u;
const KNOWLEDGE_TIMEOUT = 20_000;

interface CopilotNotesBridge {
  list: () => Promise<unknown>;
  get: (path: string) => Promise<unknown>;
  create: (input: {
    path: string;
    title: string;
    body: string;
    tags: string[];
    type?: string;
    status?: string;
  }) => Promise<unknown>;
  createWithBuild: (input: {
    path: string;
    title: string;
    body: string;
    tags: string[];
    type?: string;
    status?: string;
  }) => Promise<any>;
  update: (input: {
    path: string;
    patch: { body?: string; title?: string };
  }) => Promise<unknown>;
  remove: (path: string) => Promise<unknown>;
}

interface WindowCopilot {
  notes?: CopilotNotesBridge;
  wiki?: {
    getForNote(path: string): Promise<any>;
  };
}

async function ensureTaskNoteRemoved(appPage: import('@playwright/test').Page): Promise<void> {
  await appPage.evaluate(async (path: string) => {
    const copilot = (window as unknown as { copilot?: WindowCopilot }).copilot;
    if (!copilot?.notes?.remove) return;
    try {
      await copilot.notes.remove(path);
    } catch {
      // ENOENT or not-found is fine; we only care that the path
      // is clean before the test creates it.
    }
  }, TASK_NOTE_PATH);
}

async function createTaskNote(appPage: import('@playwright/test').Page): Promise<void> {
  await appPage.evaluate(
    async ({ path, title, body, tags }: {
      path: string;
      title: string;
      body: string;
      tags: string[];
    }) => {
      const copilot = (window as unknown as { copilot?: WindowCopilot }).copilot;
      if (!copilot?.notes?.create) {
        throw new Error('BLOCKED_BRIDGE_MISSING: window.copilot.notes.create is unavailable');
      }
      await copilot.notes.create({ path, title, body, tags, type: 'note', status: 'active' });
    },
    { path: TASK_NOTE_PATH, title: TASK_NOTE_TITLE, body: TASK_NOTE_BODY, tags: TASK_NOTE_TAGS },
  );
}

async function reloadKnowledge(appPage: import('@playwright/test').Page): Promise<void> {
  // Reload the Electron renderer window before re-opening the
  // Knowledge view so that any persistent state created by a
  // previous test (e.g. the unique task-owned note) is reflected
  // through the fresh `window.copilot.notes` bridge query layer
  // used by KnowledgeWorkspace.
  await appPage.reload();
  await openView(appPage, 'knowledge');
  await appPage.waitForSelector('[data-testid="knowledge-moc-reader"]', { timeout: KNOWLEDGE_TIMEOUT });
}

test.describe('Knowledge Workspace — MOC primary view (K-01 / K-02)', () => {
  test.afterAll(async ({ appPage }) => {
    await ensureTaskNoteRemoved(appPage);
  });

  test('low-data MOC surfaces the single task-owned real local note (K-01)', async ({ appPage }) => {
    await ensureTaskNoteRemoved(appPage);
    await createTaskNote(appPage);
    await reloadKnowledge(appPage);

    // MOC reader is visible and the page contains the task-owned
    // title (real note, not a fixture).
    await expect(appPage.getByTestId('knowledge-moc-reader')).toBeVisible();
    await expect(appPage.getByTestId('moc-truth-chip')).toHaveText('LOCAL_DERIVED');

    // The reading path contains the task-owned title and its
    // truthful raw-note WIKI state.
    const step = appPage.getByTestId('moc-reading-step-0');
    await expect(step).toBeVisible();
    await expect(step).toContainText(TASK_NOTE_TITLE);
    await expect(step).toContainText('待 WIKI 整理');

    // Classification belongs to the real first-tag topic group;
    // the card contains the task-owned title and path action.
    const topicGroup = appPage.getByTestId(`moc-topic-${TASK_NOTE_TAGS[0]}`);
    await expect(topicGroup).toBeVisible();
    await expect(topicGroup).toContainText(TASK_NOTE_TAGS[0]);
    await expect(topicGroup).toContainText(TASK_NOTE_TITLE);
    const topicNote = topicGroup.getByTestId(`moc-topic-note-${TASK_NOTE_PATH}`);
    await expect(topicNote).toBeVisible();
    await expect(topicNote).toContainText(TASK_NOTE_TITLE);

    // No fixture / fake / 3D strings anywhere in the MOC area.
    const reader = appPage.getByTestId('knowledge-moc-reader');
    await expect(reader).not.toContainText(FORBIDDEN_FIXTURE_PATTERN);
  });

  test('NoteDetail right rail shows the real body excerpt (K-02)', async ({ appPage }) => {
    await ensureTaskNoteRemoved(appPage);
    await createTaskNote(appPage);
    await reloadKnowledge(appPage);

    // Click the topic-note button to open NoteDetail.
    await appPage.getByTestId(`moc-topic-note-${TASK_NOTE_PATH}`).click();

    await expect(appPage.getByTestId('note-detail-panel')).toBeVisible();
    await expect(appPage.getByTestId('note-detail-title')).toContainText(TASK_NOTE_TITLE);
    await expect(appPage.getByTestId('note-detail-close')).toBeVisible();
    await expect(appPage.getByLabel('关闭笔记详情')).toBeVisible();
    // Real path is exposed in the meta line.
    await expect(appPage.getByTestId('note-detail-meta')).toContainText(TASK_NOTE_PATH);

    // The body MUST contain a truth line from our real body;
    // we assert the long first sentence that the focused Vitest
    // tests also use, so any fixture drift is caught here too.
    const panel = appPage.getByTestId('note-detail-panel');
    await expect(panel).toContainText('Real local note created by');

    // No fixture strings inside the detail panel.
    await expect(panel).not.toContainText(FORBIDDEN_FIXTURE_PATTERN);
  });
});

test.describe('Knowledge Workspace — current MOC and post-MVP 3D boundary (K-03)', () => {
  test.afterAll(async ({ appPage }) => {
    await ensureTaskNoteRemoved(appPage);
  });

  test('keeps 2D MOC active and exposes 3D node visualization only as disabled post-MVP', async ({ appPage }) => {
    await ensureTaskNoteRemoved(appPage);
    await createTaskNote(appPage);
    await reloadKnowledge(appPage);

    await expect(appPage.getByRole('tab', { name: '2D MOC 阅读' }))
      .toHaveAttribute('aria-selected', 'true');
    await expect(appPage.getByTestId('knowledge-moc-reader')).toBeVisible();
    const postMvpGraph = appPage.getByText(
      '3D 节点可视化知识图谱 · MVP 后',
      { exact: true },
    );
    await expect(postMvpGraph).toBeVisible();
    await expect(postMvpGraph).toHaveAttribute('aria-disabled', 'true');
    await expect(appPage.getByTestId('knowledge-graph-view')).toHaveCount(0);
  });
});

test.describe('Knowledge Workspace — WIKI truth inspector (K-02)', () => {
  test.afterAll(async ({ appPage }) => {
    await ensureTaskNoteRemoved(appPage);
  });

  test('keeps WIKI inspector missing after a raw local note exists', async ({ appPage }) => {
    await ensureTaskNoteRemoved(appPage);
    await createTaskNote(appPage);
    await reloadKnowledge(appPage);

    await expect(appPage.getByTestId('wiki-truth-chip')).toHaveText('MISSING');
    await expect(appPage.getByTestId('wiki-truth-summary')).toHaveText('NO_PROJECTION');
    await expect(appPage.getByTestId('wiki-truth-tags')).toHaveText('NO_PROJECTION');
    await expect(appPage.getByTestId('wiki-truth-entities')).toHaveText('NO_PROJECTION');
    await expect(appPage.getByTestId('wiki-truth-relations')).toHaveText('NO_PROJECTION');
  });
});

async function removeDciNote(
  appPage: import('@playwright/test').Page,
  notePath: string,
): Promise<void> {
  await appPage.evaluate(async (path: string) => {
    await (window as any).copilot.notes.remove(path).catch(() => false);
  }, notePath);
}

async function openDciWikiInspector(
  appPage: import('@playwright/test').Page,
  notePath: string,
): Promise<void> {
  await reloadKnowledge(appPage);
  await appPage.getByTestId(`moc-topic-note-${notePath}`).click();
}

function expectProviderReceipt(
  receipt: FakeMiniMaxRequestReceipt,
  profile: FakeMiniMaxProfile,
): void {
  expect(receipt).toMatchObject({
    method: 'POST',
    path: '/v1/chat/completions',
    profile,
  });
  expect(receipt.body.validJsonObject).toBe(true);
  expect(receipt.body.modelType).toBe('string');
  expect(receipt.body.stream).toBe(false);
  expect(receipt.body.messageCount).toBe(2);
  expect(receipt.body.messageRoles).toEqual(['system', 'user']);
}

async function takeProviderReceipts(
  provider: FakeMiniMaxProvider,
  count: number,
  profile: FakeMiniMaxProfile,
): Promise<FakeMiniMaxRequestReceipt[]> {
  const receipts: FakeMiniMaxRequestReceipt[] = [];
  for (let index = 0; index < count; index += 1) {
    const receipt = await provider.waitForRequest(KNOWLEDGE_TIMEOUT);
    expectProviderReceipt(receipt, profile);
    receipts.push(receipt);
  }
  expect(provider.getReceipts()).toHaveLength(count);
  return receipts;
}

test.describe('DCI Core 1 — digest-bound WIKI truth cases 98–101', () => {
  test('98 current truth displays digest-bound facets and success provenance', async ({
    appPage,
    fakeMiniMaxProvider,
  }) => {
    const notePath = 'e2e/dci-core-1-current';
    await removeDciNote(appPage, notePath);
    try {
      const truth = await appPage.evaluate(async (path: string) => {
        const copilot = (window as any).copilot;
        const receipt = await copilot.notes.createWithBuild({
          path,
          title: 'DCI current',
          body: 'Configured provider produces current WIKI truth.',
          tags: ['e2e', 'dci-current'],
        });
        return { receipt, wiki: await copilot.wiki.getForNote(path) };
      }, notePath);
      const providerReceipts = await takeProviderReceipts(
        fakeMiniMaxProvider,
        3,
        'success',
      );
      expect(truth.receipt.localState).toBe('LOCAL_SAVED');
      expect(truth.receipt.build.kg).toMatchObject({
        state: 'ready',
        entitiesAdded: 0,
        entitiesLinked: 0,
      });
      expect(truth.receipt.build.wiki.truth).toBe('current');
      expect(truth.wiki.truth).toBe('current');
      expect(truth.wiki.current?.summary).toContain('受控 MiniMax 测试提供方');
      expect(truth.wiki.current?.tags).toEqual(
        expect.arrayContaining(['e2e', 'local-first']),
      );
      expect(
        new Set(providerReceipts.map((receipt) => receipt.body.messageContentLengths[0])).size,
      ).toBe(3);
      await openDciWikiInspector(appPage, notePath);
      await expect(appPage.getByTestId('wiki-truth-chip')).toHaveText('CURRENT');
      await expect(appPage.getByTestId('wiki-truth-provenance')).toBeVisible();
    } finally {
      await removeDciNote(appPage, notePath);
    }
  });

  test('99 changed local bytes demote the old projection to stale', async ({
    appPage,
    fakeMiniMaxProvider,
  }) => {
    const notePath = 'e2e/dci-core-1-stale';
    await removeDciNote(appPage, notePath);
    try {
      const result = await appPage.evaluate(async (path: string) => {
        const copilot = (window as any).copilot;
        const built = await copilot.notes.createWithBuild({
          path,
          title: 'DCI stale',
          body: 'Initial bytes with a current projection.',
          tags: ['e2e', 'dci-stale'],
        });
        if (built.build.wiki.truth !== 'current') {
          throw new Error(`BLOCKED_CURRENT_WIKI_PREREQUISITE:${built.build.wiki.truth}`);
        }
        await copilot.notes.update({
          path,
          patch: { body: 'Changed local bytes without rebuilding.' },
        });
        return { built, wiki: await copilot.wiki.getForNote(path) };
      }, notePath);
      const providerReceipts = await takeProviderReceipts(
        fakeMiniMaxProvider,
        3,
        'success',
      );
      expect(result.built.localState).toBe('LOCAL_SAVED');
      expect(result.built.build.wiki.truth).toBe('current');
      expect(result.built.build.wiki.current?.summary).toContain(
        '受控 MiniMax 测试提供方',
      );
      expect(result.built.build.wiki.current?.tags).toEqual(
        expect.arrayContaining(['e2e', 'local-first']),
      );
      expect(result.wiki.truth).toBe('stale');
      expect(
        new Set(providerReceipts.map((receipt) => receipt.body.messageContentLengths[0])).size,
      ).toBe(3);
      await openDciWikiInspector(appPage, notePath);
      await expect(appPage.getByTestId('wiki-truth-chip')).toHaveText('STALE');
      await expect(appPage.getByTestId('wiki-truth-provenance')).toBeVisible();
    } finally {
      await removeDciNote(appPage, notePath);
    }
  });

  test('100 provider failure remains failed while LOCAL_SAVED stays readable', async ({
    appPage,
    fakeMiniMaxProvider,
  }) => {
    const notePath = 'e2e/dci-core-1-failed';
    await removeDciNote(appPage, notePath);
    fakeMiniMaxProvider.reset('provider-failure');
    try {
      const result = await appPage.evaluate(async (path: string) => {
        const copilot = (window as any).copilot;
        const receipt = await copilot.notes.createWithBuild({
          path,
          title: 'DCI failed',
          body: 'The controlled provider-failure profile must not roll back these bytes.',
          tags: ['e2e', 'dci-failed'],
        });
        return {
          receipt,
          document: await copilot.notes.get(path),
          wiki: await copilot.wiki.getForNote(path),
        };
      }, notePath);
      const [providerReceipt] = await takeProviderReceipts(
        fakeMiniMaxProvider,
        1,
        'provider-failure',
      );
      expect(providerReceipt).toBeDefined();
      expect(result.receipt.localState).toBe('LOCAL_SAVED');
      expect(result.receipt.build.state).toBe('BUILD_FAILED');
      expect(result.document.body).toContain('must not roll back');
      expect(result.wiki.truth).toBe('failed');
      expect(result.wiki.current).toBeNull();
      expect(result.wiki.provenance).toBeNull();
      await openDciWikiInspector(appPage, notePath);
      await expect(appPage.getByTestId('wiki-truth-chip')).toHaveText('FAILED');
      await expect(appPage.getByTestId('wiki-truth-provenance')).toHaveCount(0);
    } finally {
      await removeDciNote(appPage, notePath);
    }
  });

  test('101 raw local create has missing truth and no success facets or provenance', async ({ appPage }) => {
    const notePath = 'e2e/dci-core-1-missing';
    await removeDciNote(appPage, notePath);
    try {
      const wiki = await appPage.evaluate(async (path: string) => {
        const copilot = (window as any).copilot;
        await copilot.notes.create({
          path,
          title: 'DCI missing',
          body: 'Saved without invoking the additive build operation.',
          tags: ['e2e', 'dci-missing'],
        });
        return copilot.wiki.getForNote(path);
      }, notePath);
      expect(wiki.truth).toBe('missing');
      await openDciWikiInspector(appPage, notePath);
      await expect(appPage.getByTestId('wiki-truth-chip')).toHaveText('MISSING');
      await expect(appPage.getByTestId('wiki-truth-summary')).toHaveText('NO_PROJECTION');
      await expect(appPage.getByTestId('wiki-truth-provenance')).toHaveCount(0);
    } finally {
      await removeDciNote(appPage, notePath);
    }
  });
});

test.describe('B3 P0 — Knowledge failure truth remains local and non-green', () => {
  test('105 real Knowledge UI keeps failed WIKI non-green while reloaded MOC remains LOCAL_DERIVED and current-only', async ({
    appPage,
    fakeMiniMaxProvider,
  }) => {
    const notePath = 'e2e/b3-knowledge-ui-failed';
    const body = `B3KnowledgeFailure${Date.now()} local bytes survive provider failure`;
    await removeDciNote(appPage, notePath);
    fakeMiniMaxProvider.reset('provider-failure');
    try {
      await openView(appPage, 'knowledge');
      await appPage.getByRole('button', { name: '新建笔记' }).click();
      await appPage.getByLabel('笔记标题').fill('B3 Knowledge failed');
      await appPage.getByLabel('笔记路径').fill(notePath);
      await appPage.getByLabel('笔记标签').fill('e2e, b3-failed');
      await appPage.getByLabel('笔记正文').fill(body);
      await appPage.getByRole('button', { name: '保存到本地' }).click();

      await expect(appPage.getByTestId('knowledge-save-receipt')).toContainText('LOCAL_SAVED');
      await expect(appPage.getByTestId('knowledge-save-path')).toHaveText(notePath);
      const failedRequest = await fakeMiniMaxProvider.waitForRequest(KNOWLEDGE_TIMEOUT);
      expectProviderReceipt(failedRequest, 'provider-failure');
      await expect(appPage.getByTestId('wiki-truth-chip')).toHaveText('FAILED', {
        timeout: KNOWLEDGE_TIMEOUT,
      });
      await expect(appPage.getByTestId('wiki-truth-block')).toHaveAttribute(
        'data-wiki-state',
        'failed',
      );
      expect(await appPage.getByTestId('wiki-truth-chip').getAttribute('class'))
        .not.toMatch(/wikiTruthCurrent/u);
      await expect(appPage.getByTestId('moc-truth-chip')).toHaveText('LOCAL_DERIVED');
      await expect(appPage.getByTestId('moc-wiki-current')).toHaveCount(0);
      await expect(appPage.getByTestId('moc-wiki-not-current')).toContainText('保持隐藏');
      expect(await appPage.evaluate(
        async (path: string) => (window as any).copilot.notes.get(path),
        notePath,
      )).toMatchObject({
        note: { path: notePath },
        body,
      });

      await openDciWikiInspector(appPage, notePath);
      await expect(appPage.getByTestId('moc-truth-chip')).toHaveText('LOCAL_DERIVED');
      await expect(appPage.getByTestId('wiki-truth-chip')).toHaveText('FAILED');
      expect(await appPage.getByTestId('wiki-truth-chip').getAttribute('class'))
        .not.toMatch(/wikiTruthCurrent/u);
      await expect(appPage.getByTestId('wiki-truth-provenance')).toHaveCount(0);
    } finally {
      await removeDciNote(appPage, notePath);
    }
  });
});
