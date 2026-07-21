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
  test('60 Voice workspace renders inside Electron', async ({ appPage }) => {
    await openView(appPage, 'voice');
    await expect(appPage.getByTestId('voice-workspace')).toBeVisible();
  });

  test('61 Voice explains automatic local note and KG indexing', async ({ appPage }) => {
    await expect(appPage.getByText(/自动创建本地笔记/)).toBeVisible();
  });

  test('62 recorder is visible and keyboard reachable', async ({ appPage }) => {
    const button = appPage.getByTestId('voice-recorder-button');
    await expect(button).toBeVisible();
    await button.focus();
    await expect(button).toBeFocused();
  });

  test('63 no fake transcript or provider badge exists before capture', async ({ appPage }) => {
    await expect(appPage.getByTestId('voice-transcript')).toHaveCount(0);
    await expect(appPage.getByTestId('voice-provider-badge')).toHaveCount(0);
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
