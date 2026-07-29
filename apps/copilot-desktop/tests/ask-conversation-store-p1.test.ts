import { constants } from 'node:fs';
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AskConversationStore,
  type StoredAskConversationSnapshot,
} from '../src/main/ask-conversation-store.js';

const roots: string[] = [];

async function root(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'copilot-ask-store-'));
  roots.push(created);
  return created;
}

function snapshot(): StoredAskConversationSnapshot {
  return {
    schemaVersion: 1,
    exchangeId: 'exchange-1',
    phase: 'completed',
    question: '本地问题',
    answer: {
      text: '本地回答',
      sources: ['notes/source.md'],
      sourceDetails: [{
        notePath: 'notes/source.md',
        evidence: ['vector'],
        score: 0.9,
      }],
    },
    sourceBindings: [{
      notePath: 'notes/source.md',
      updatedAt: 10,
      bodyDigest: 'a'.repeat(64),
    }],
    todoReceipt: null,
    completedAt: 20,
  };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('AskConversationStore', () => {
  it('atomically saves and reads the bounded latest completed exchange with 0600 mode', async () => {
    const userData = await root();
    const store = new AskConversationStore(userData);
    await store.save(snapshot());
    await expect(store.load()).resolves.toEqual(snapshot());

    const file = store.filePath;
    const { stat } = await import('node:fs/promises');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(snapshot());
  });

  it('fails closed for unknown schema, oversize, symlink, nonregular, and multilink targets', async () => {
    const userData = await root();
    const store = new AskConversationStore(userData);
    await mkdir(store.directoryPath, { recursive: true });

    await writeFile(store.filePath, JSON.stringify({ ...snapshot(), schemaVersion: 2 }), { mode: 0o600 });
    await expect(store.load()).rejects.toThrow('ASK_CONVERSATION_STORE_INVALID');

    await writeFile(store.filePath, 'x'.repeat(300_000));
    await expect(store.load()).rejects.toThrow('ASK_CONVERSATION_STORE_INVALID');

    const safe = join(userData, 'safe.json');
    await writeFile(safe, JSON.stringify(snapshot()), { mode: 0o600 });
    await import('node:fs/promises').then(({ rm }) => rm(store.filePath, { force: true }));
    await symlink(safe, store.filePath);
    await expect(store.load()).rejects.toThrow('ASK_CONVERSATION_STORE_UNSAFE');

    await import('node:fs/promises').then(({ rm }) => rm(store.filePath, { force: true }));
    await mkdir(store.filePath);
    await expect(store.load()).rejects.toThrow('ASK_CONVERSATION_STORE_UNSAFE');

    await import('node:fs/promises').then(({ rm }) => rm(store.filePath, { recursive: true, force: true }));
    await writeFile(store.filePath, JSON.stringify(snapshot()), { mode: 0o600 });
    await link(store.filePath, join(userData, 'second-link.json'));
    await expect(store.load()).rejects.toThrow('ASK_CONVERSATION_STORE_UNSAFE');
    await chmod(store.filePath, 0o600);
  });

  it('rejects nonterminal and ungrounded snapshots without replacing the previous value', async () => {
    const userData = await root();
    const store = new AskConversationStore(userData);
    await store.save(snapshot());
    await expect(store.save({ ...snapshot(), phase: 'streaming' } as never))
      .rejects.toThrow('ASK_CONVERSATION_STORE_INVALID');
    await expect(store.save({
      ...snapshot(),
      answer: { text: 'answer', sources: [], sourceDetails: [] },
      sourceBindings: [],
    })).rejects.toThrow('ASK_CONVERSATION_STORE_INVALID');
    await expect(store.load()).resolves.toEqual(snapshot());
  });

  it('rejects a snapshot file readable by group or other users', async () => {
    const userData = await root();
    const store = new AskConversationStore(userData);
    await store.save(snapshot());
    await chmod(store.filePath, 0o640);
    await expect(store.load()).rejects.toThrow('ASK_CONVERSATION_STORE_UNSAFE');
  });

  it('fails closed from the same O_NOFOLLOW handle when the pathname is replaced', async () => {
    const userData = await root();
    let openedFlags: number | null = null;
    let replaceAfterOpen = false;
    let replacementPath = '';
    const store = new AskConversationStore(userData, async (path, flags) => {
      const handle = await open(path, flags);
      openedFlags = flags;
      if (replaceAfterOpen) {
        replaceAfterOpen = false;
        await rename(replacementPath, path);
      }
      return handle;
    });
    const original = snapshot();
    const replacement = {
      ...snapshot(),
      exchangeId: 'replacement',
      question: '替换后的路径内容',
    };
    await store.save(original);
    replacementPath = join(userData, 'replacement.json');
    await writeFile(replacementPath, JSON.stringify(replacement), { mode: 0o600 });

    replaceAfterOpen = true;

    await expect(store.load()).rejects.toThrow('ASK_CONVERSATION_STORE_UNSAFE');
    expect((openedFlags ?? 0) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(replacement);
  });
});
