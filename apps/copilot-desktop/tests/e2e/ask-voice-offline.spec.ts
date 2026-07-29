import type { RagStreamEvent } from '../../src/shared/domain-api.js';
import { expect, openView, test } from './electron.fixture.js';

test.describe.configure({ mode: 'serial' });

test.describe('RAG sources, safe errors, and cancellation', () => {
  test('51 Ask workspace renders inside Electron', async ({ appPage }) => {
    await openView(appPage, 'ask');
    await expect(appPage.getByTestId('ask-workspace')).toBeVisible();
  });

  test('52 an empty question cannot be submitted', async ({ appPage }) => {
    await expect(appPage.getByRole('button', { name: '提问' })).toBeDisabled();
  });

  test('53 Chinese question input preserves exact text', async ({ appPage }) => {
    const input = appPage.getByLabel('问题');
    await input.fill('OPC 是什么？');
    await expect(input).toHaveValue('OPC 是什么？');
  });

  test('54 empty RAG request is rejected by main, not a browser mock', async ({ appPage }) => {
    const message = await appPage.evaluate(async () => {
      try {
        await (window as any).copilot.rag.ask('');
        return '';
      } catch (error) {
        return String(error);
      }
    });
    expect(message).toContain('INVALID_ARGUMENT');
  });

  test('55 real RAG terminal is aligned sources or an explicit safe provider error', async ({ appPage }) => {
    const result = await appPage.evaluate(async () => {
      try {
        return { answer: await (window as any).copilot.rag.ask('E2E local source alignment probe'), error: '' };
      } catch (error) {
        return { answer: null, error: String(error) };
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/sk-[a-z0-9]/i);
    if (result.answer) {
      expect(result.answer.sources).toEqual(expect.any(Array));
      const details = result.answer.sourceDetails ?? [];
      expect(details.map((source: any) => source.notePath)).toEqual(result.answer.sources);
      expect(details.every((source: any) => Array.isArray(source.evidence))).toBe(true);
    } else {
      expect(result.error).toMatch(/\[(OFFLINE|CONFIG_REQUIRED|INTERNAL)\]/);
    }
  });

  test('56 Ask UI leaves loading and renders answer or bounded error', async ({ appPage }) => {
    await appPage.getByLabel('问题').fill('E2E offline probe');
    await appPage.getByRole('button', { name: '提问' }).click();
    await expect(appPage.getByRole('button', { name: '检索中…' })).toHaveCount(0, { timeout: 15_000 });
    const terminal = appPage.locator('[data-testid="rag-answer"], [data-testid="workspace-state-error"]');
    await expect(terminal).toHaveCount(1);

    if (await appPage.getByTestId('rag-answer').count()) {
      const answer = appPage.getByTestId('rag-answer');
      await expect(appPage.getByRole('button', { name: '复制回答' })).toBeVisible();
      expect(await answer.evaluate((element) => getComputedStyle(element).userSelect)).toBe('text');
      const truth = appPage.getByTestId('answer-source-truth');
      await expect(truth).toBeVisible();
      expect(['CHECKING', 'LOCAL_PRESENT', 'UNKNOWN', 'UNAVAILABLE', 'NO_SOURCE'])
        .toContain(await truth.getAttribute('data-truth-state'));
      const receipts = appPage.locator('[data-testid^="source-receipt-"]');
      for (let index = 0; index < await receipts.count(); index += 1) {
        const receipt = receipts.nth(index);
        const state = await receipt.getAttribute('data-truth-state');
        expect(['CHECKING', 'LOCAL_PRESENT', 'MISSING', 'UNAVAILABLE', 'UNKNOWN']).toContain(state);
        const openSource = receipt.locator('button').first();
        if (state === 'LOCAL_PRESENT') await expect(openSource).toBeEnabled();
        else await expect(openSource).toBeDisabled();
      }
      await expect(appPage.getByRole('button', { name: '复制来源诊断' })).toBeVisible();
    } else {
      await expect(appPage.getByRole('button', { name: '重试' })).toBeVisible();
      await expect(appPage.getByRole('button', { name: '复制诊断' })).toBeVisible();
    }
  });

  test('57 preload exposes stream start, cancel, and exact-listener cleanup', async ({ appPage }) => {
    const types = await appPage.evaluate(() => ({
      start: typeof (window as any).copilot.rag.startStream,
      cancel: typeof (window as any).copilot.rag.cancelStream,
      subscribe: typeof (window as any).copilot.rag.onStreamEvent,
    }));
    expect(types).toEqual({ start: 'function', cancel: 'function', subscribe: 'function' });
  });

  test('58 start-cancel race emits exactly one terminal event and no late delta', async ({ appPage }) => {
    const result = await appPage.evaluate(async () => {
      const requestId = crypto.randomUUID();
      const eventTypes: string[] = [];
      let resolveTerminal!: () => void;
      const terminal = new Promise<void>((resolve) => { resolveTerminal = resolve; });
      const cleanup = (window as any).copilot.rag.onStreamEvent((event: RagStreamEvent) => {
        if (event.requestId !== requestId) return;
        eventTypes.push(event.type);
        if (['final', 'error', 'cancel'].includes(event.type)) resolveTerminal();
      });
      let timeout = 0;
      try {
        const started = await (window as any).copilot.rag.startStream({
          requestId,
          question: 'cancel immediately',
        });
        const cancelled = await (window as any).copilot.rag.cancelStream(requestId);
        await Promise.race([
          terminal,
          new Promise<never>((_resolve, reject) => {
            timeout = window.setTimeout(() => reject(new Error('RAG cancellation did not terminate')), 15_000);
          }),
        ]);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
        return { started, cancelled, eventTypes };
      } finally {
        if (timeout) window.clearTimeout(timeout);
        cleanup();
      }
    });
    expect(result.started).toMatchObject({ accepted: true });
    expect(typeof result.cancelled.cancelled).toBe('boolean');
    const terminalEvents = result.eventTypes.filter((type) => ['final', 'error', 'cancel'].includes(type));
    expect(terminalEvents).toHaveLength(1);
    const terminalIndex = result.eventTypes.findIndex((type) => ['final', 'error', 'cancel'].includes(type));
    expect(result.eventTypes.slice(terminalIndex + 1)).toEqual([]);
    if (result.cancelled.cancelled) expect(terminalEvents).toEqual(['cancel']);
  });

  test('59 removed stream listener receives no later Electron IPC event', async ({ appPage }) => {
    const result = await appPage.evaluate(async () => {
      let removedDeliveries = 0;
      const cleanup = (window as any).copilot.rag.onStreamEvent(() => { removedDeliveries += 1; });
      cleanup();
      const requestId = crypto.randomUUID();
      await (window as any).copilot.rag.startStream({ requestId, question: 'listener cleanup probe' });
      await (window as any).copilot.rag.cancelStream(requestId);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
      return removedDeliveries;
    });
    expect(result).toBe(0);
  });
});

test.describe('Voice failure-safe capture surface', () => {
  test('60 Today exposes embedded local voice with no standalone Voice navigation', async ({ appPage }) => {
    await openView(appPage, 'schedule');
    const captureCard = appPage.getByTestId('today-capture-card');
    await expect(captureCard).toBeVisible();
    await expect(captureCard.getByText('开始本地语音', { exact: true })).toBeVisible();
    await expect(appPage.getByTestId('nav-voice')).toHaveCount(0);
    await captureCard.getByText('开始本地语音', { exact: true }).click();
    await expect(captureCard.getByTestId('voice-input-root')).toBeVisible();
  });

  test('61 draft becomes a local note only after confirmed save', async ({ appPage }) => {
    const captureCard = appPage.getByTestId('today-capture-card');
    const before = await appPage.evaluate(async () => (await (window as any).copilot.notes.list({ limit: 1000 })).total);
    const draft = captureCard.getByTestId('today-capture-draft');
    await draft.fill('AC61 用户确认保存 ' + String(Date.now()));
    const whileDrafting = await appPage.evaluate(async () => (await (window as any).copilot.notes.list({ limit: 1000 })).total);
    expect(whileDrafting).toBe(before);
    await expect(captureCard.getByText('已保存到本地笔记。', { exact: true })).toHaveCount(0);

    const draftText = await draft.inputValue();
    await captureCard.getByRole('button', { name: '保存为本地笔记' }).click();
    const saveReceipt = captureCard.locator('[role="status"]').filter({ hasText: '已保存到本地笔记。' });
    await expect(saveReceipt).toBeVisible();
    const receiptPath = (await saveReceipt.locator('code').innerText()).trim();
    expect(receiptPath).not.toBe('');
    const savedNote = await appPage.evaluate(
      async (notePath) => (window as any).copilot.notes.get(notePath),
      receiptPath,
    );
    expect(savedNote.note.path).toBe(receiptPath);
    expect(savedNote.body).toBe(draftText);
    await expect(draft).toHaveValue('');
    await expect.poll(() => appPage.evaluate(async () => (await (window as any).copilot.notes.list({ limit: 1000 })).total)).toBe(before + 1);
  });

  test('62 recorder is keyboard reachable and typed draft remains editable', async ({ appPage }) => {
    await openView(appPage, 'schedule');
    const captureCard = appPage.getByTestId('today-capture-card');
    const voiceDetails = captureCard.locator('details').filter({ hasText: '开始本地语音' });
    if (!(await voiceDetails.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await voiceDetails.locator('summary').click();
    }
    await expect(voiceDetails).toHaveJSProperty('open', true);
    const voiceInput = voiceDetails.getByTestId('voice-input-root');
    await expect(voiceInput).toBeVisible();
    const button = voiceInput.getByTestId('voice-recorder-button');
    await expect(button).toBeVisible();
    await button.focus();
    await expect(button).toBeFocused();
    const draft = captureCard.getByTestId('today-capture-draft');
    await expect(draft).toBeEditable();
    await draft.fill('AC62 文字录入保持可用');
    await expect(draft).toHaveValue('AC62 文字录入保持可用');
  });

  test('63 NOT_READY shows no fake transcript, provider, or cloud switch', async ({ appPage }) => {
    await openView(appPage, 'schedule');
    const captureCard = appPage.getByTestId('today-capture-card');
    const voiceDetails = captureCard.locator('details').filter({ hasText: '开始本地语音' });
    if (!(await voiceDetails.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await voiceDetails.locator('summary').click();
    }
    await expect(voiceDetails).toHaveJSProperty('open', true);
    const voiceInput = voiceDetails.getByTestId('voice-input-root');
    await expect(voiceInput).toBeVisible();
    await expect(captureCard.getByText('LOCAL ASR · NOT_READY', { exact: true }).first()).toBeVisible();
    await expect(voiceInput.getByTestId('voice-transcript')).toHaveCount(0);
    await expect(voiceInput.getByTestId('voice-provider-badge')).toHaveCount(0);
    await expect(voiceInput.getByTestId('voice-provider-transitions')).toHaveCount(0);
    await expect(voiceInput.getByText(/云端 ASR|切换云端|云切换/u)).toHaveCount(0);
    await expect(voiceInput.getByText(/(?:DECODE|NO-EGRESS).*PASS/u)).toHaveCount(0);
  });

  test('64 microphone attempt reaches a bounded state without crashing the app', async ({ appPage }) => {
    await appPage.getByTestId('voice-recorder-button').click();
    await appPage.waitForTimeout(500);
    await expect(appPage.getByTestId('app-root')).toBeVisible();
    const status = await appPage.getByTestId('voice-input-root').getAttribute('data-status');
    expect(['arming', 'armed', 'recording', 'error', 'unsupported']).toContain(status);
    const cancel = appPage.getByTestId('voice-recorder-cancel');
    if (await cancel.count()) await cancel.click();
  });
});

const B3_TIMEOUT = 30_000;

async function removeB3Note(
  appPage: import('@playwright/test').Page,
  notePath: string,
): Promise<void> {
  await appPage.evaluate(async (path: string) => {
    await (window as any).copilot.notes.remove(path).catch(() => false);
  }, notePath);
}

async function saveTodayCapture(
  appPage: import('@playwright/test').Page,
  body: string,
): Promise<string> {
  await openView(appPage, 'schedule');
  const captureCard = appPage.getByTestId('today-capture-card');
  await captureCard.getByTestId('today-capture-draft').fill(body);
  await captureCard.getByRole('button', { name: '保存为本地笔记' }).click();
  const localReceipt = captureCard.locator('[role="status"]').filter({
    hasText: '已保存到本地笔记。',
  });
  await expect(localReceipt).toBeVisible({ timeout: B3_TIMEOUT });
  const notePath = (await localReceipt.locator('code').innerText()).trim();
  expect(notePath).not.toBe('');
  return notePath;
}

test.describe('B3 P0 — capture, WIKI, and grounded RAG semantics', () => {
  test('102 Today exposes LOCAL_SAVED before deferred provider release, then reaches digest-current and reloads', async ({
    appPage,
    fakeMiniMaxProvider,
  }) => {
    fakeMiniMaxProvider.reset('deferred-success');
    const beforeTotal = await appPage.evaluate(
      async () => (await (window as any).copilot.notes.list({ limit: 1000 })).total,
    );
    const notePath = await saveTodayCapture(
      appPage,
      `B3 deferred current ${Date.now()} exact local bytes`,
    );
    try {
      const firstProviderRequest = await fakeMiniMaxProvider.waitForRequest(B3_TIMEOUT);
      expect(firstProviderRequest).toMatchObject({
        profile: 'deferred-success',
        path: '/v1/chat/completions',
        body: { stream: false },
      });
      expect(fakeMiniMaxProvider.getDeferredRequestCount()).toBe(1);

      const truth = appPage.getByTestId('capture-index-truth');
      await expect(truth).toContainText(/WIKI (QUEUED|RUNNING)/u);
      expect(await truth.getAttribute('class')).not.toMatch(/captureSuccess/u);
      expect(await appPage.evaluate(
        async (path: string) => (window as any).copilot.notes.get(path),
        notePath,
      )).toMatchObject({
        note: { path: notePath },
      });

      expect(fakeMiniMaxProvider.releaseDeferredSuccess()).toBe(1);
      await expect.poll(
        () => fakeMiniMaxProvider.getReceipts().length,
        { timeout: B3_TIMEOUT },
      ).toBe(3);
      await expect(truth).toContainText('WIKI CURRENT', { timeout: B3_TIMEOUT });
      expect(await truth.getAttribute('class')).toMatch(/captureSuccess/u);
      await expect.poll(
        () => appPage.evaluate(
          async (path: string) => (window as any).copilot.wiki.getForNote(path),
          notePath,
        ),
        { timeout: B3_TIMEOUT },
      ).toMatchObject({
        truth: 'current',
        notePath,
        knowledgeBuild: { state: 'ready' },
      });

      await appPage.reload();
      const reloaded = await appPage.evaluate(
        async (path: string) => ({
          document: await (window as any).copilot.notes.get(path),
          wiki: await (window as any).copilot.wiki.getForNote(path),
        }),
        notePath,
      );
      expect(reloaded.document).toMatchObject({ note: { path: notePath } });
      expect(reloaded.wiki).toMatchObject({
        truth: 'current',
        notePath,
        knowledgeBuild: { state: 'ready' },
      });
      expect(await appPage.evaluate(
        async () => (await (window as any).copilot.notes.list({ limit: 1000 })).total,
      )).toBe(beforeTotal + 1);
    } finally {
      await removeB3Note(appPage, notePath);
    }
  });

  test('103 provider failure retains LOCAL_SAVED, blocks pre-current RAG ingest, and retries the exact path without duplicate create', async ({
    appPage,
    fakeMiniMaxProvider,
  }) => {
    fakeMiniMaxProvider.reset('provider-failure');
    const beforeTotal = await appPage.evaluate(
      async () => (await (window as any).copilot.notes.list({ limit: 1000 })).total,
    );
    const uniqueToken = `B3NoIngest${Date.now()}`;
    const notePath = await saveTodayCapture(
      appPage,
      `${uniqueToken} remains local when WIKI provider fails`,
    );
    try {
      const failedRequest = await fakeMiniMaxProvider.waitForRequest(B3_TIMEOUT);
      expect(failedRequest.profile).toBe('provider-failure');
      const truth = appPage.getByTestId('capture-index-truth');
      await expect(truth).toContainText('WIKI FAILED', { timeout: B3_TIMEOUT });
      expect(await truth.getAttribute('class')).not.toMatch(/captureSuccess/u);
      expect(await appPage.evaluate(
        async (path: string) => (window as any).copilot.notes.get(path),
        notePath,
      )).toMatchObject({
        note: { path: notePath },
        body: expect.stringContaining(uniqueToken),
      });

      const preCurrentAnswer = await appPage.evaluate(
        async (question: string) => (window as any).copilot.rag.ask(question),
        uniqueToken,
      );
      expect(preCurrentAnswer.sources).not.toContain(notePath);
      const failedReceipts = fakeMiniMaxProvider.getReceipts();
      expect(fakeMiniMaxProvider.host).toBe('127.0.0.1');
      expect(failedReceipts).toHaveLength(4);
      failedReceipts.forEach((receipt) => {
        expect(receipt).toMatchObject({
          method: 'POST',
          path: '/v1/chat/completions',
          profile: 'provider-failure',
        });
      });

      fakeMiniMaxProvider.reset('success');
      await appPage.getByRole('button', { name: '重试 WIKI' }).click();
      await expect(truth).toContainText('WIKI CURRENT', { timeout: B3_TIMEOUT });
      await expect.poll(
        () => appPage.evaluate(
          async (path: string) => (window as any).copilot.wiki.getForNote(path),
          notePath,
        ),
        { timeout: B3_TIMEOUT },
      ).toMatchObject({
        truth: 'current',
        notePath,
        knowledgeBuild: { state: 'ready' },
      });
      expect(await appPage.evaluate(
        async () => (await (window as any).copilot.notes.list({ limit: 1000 })).total,
      )).toBe(beforeTotal + 1);

      await appPage.reload();
      expect(await appPage.evaluate(
        async (path: string) => (window as any).copilot.notes.get(path),
        notePath,
      )).toMatchObject({
        note: { path: notePath },
        body: expect.stringContaining(uniqueToken),
      });
    } finally {
      await removeB3Note(appPage, notePath);
    }
  });

  test('106 a digest-current note yields a grounded streamed answer with exact LOCAL_PRESENT source, copy, and navigation', async ({
    appPage,
    fakeMiniMaxProvider,
  }) => {
    const notePath = 'e2e/b3-grounded-rag-source';
    const sourceToken = `B3GroundedCitation${Date.now()}`;
    await removeB3Note(appPage, notePath);
    fakeMiniMaxProvider.reset('success');
    try {
      const localCommit = await appPage.evaluate(
        async ({ path, token }: { path: string; token: string }) =>
          (window as any).copilot.notes.create({
            path,
            title: 'B3 grounded source',
            body: `${token} is only present in this exact local note.`,
            tags: ['e2e', 'b3-grounded-rag'],
          }),
        { path: notePath, token: sourceToken },
      );
      expect(localCommit).toMatchObject({
        path: notePath,
        localState: 'LOCAL_SAVED',
      });
      await expect.poll(
        () => appPage.evaluate(
          async (path: string) => (window as any).copilot.wiki.getForNote(path),
          notePath,
        ),
        { timeout: B3_TIMEOUT },
      ).toMatchObject({
        truth: 'current',
        notePath,
        knowledgeBuild: { state: 'ready' },
      });

      fakeMiniMaxProvider.reset('grounded-rag');
      await openView(appPage, 'ask');
      await appPage.getByLabel('问题').fill(sourceToken);
      await appPage.getByRole('button', { name: '提问' }).click();
      await expect(appPage.getByTestId('rag-answer')).toContainText('仅依据已完成索引', {
        timeout: B3_TIMEOUT,
      });
      const ragRequest = await fakeMiniMaxProvider.waitForRequest(B3_TIMEOUT);
      expect(ragRequest).toMatchObject({
        profile: 'grounded-rag',
        body: { stream: true },
      });
      await expect(appPage.getByTestId('answer-source-truth')).toHaveAttribute(
        'data-truth-state',
        'LOCAL_PRESENT',
      );
      const sourceReceipt = appPage.locator('[data-testid^="source-receipt-"]').filter({
        hasText: notePath,
      }).first();
      await expect(sourceReceipt).toHaveAttribute('data-truth-state', 'LOCAL_PRESENT');
      await sourceReceipt.getByRole('button', {
        name: `复制来源凭据 ${notePath}`,
      }).click();
      await expect(sourceReceipt.getByText('COPIED', { exact: true })).toBeVisible();
      await sourceReceipt.locator('button').filter({ hasText: notePath }).first().click();
      await expect(appPage.getByTestId('knowledge-workspace')).toBeVisible();
      await expect(appPage.getByTestId('note-detail-meta')).toContainText(notePath);
    } finally {
      await removeB3Note(appPage, notePath);
    }
  });
});
