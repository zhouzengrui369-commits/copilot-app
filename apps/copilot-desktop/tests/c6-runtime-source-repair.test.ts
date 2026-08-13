import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerDomainIpc } from '../src/main/domain-ipc.js';
import type { LocalKnowledgeService } from '../src/main/local-knowledge-service.js';
import { IPC_CHANNELS } from '../src/shared/ipc-channels.js';

type Handler = (event: unknown, payload?: unknown) => Promise<unknown>;

const tempRoots: string[] = [];

function resolveAppRoot(cwd = process.cwd()): string {
  const workspace = path.join(cwd, 'apps/copilot-desktop');
  return cwd.endsWith(path.join('apps', 'copilot-desktop')) ? cwd : workspace;
}

const appRoot = resolveAppRoot();

function runtimeIdentity() {
  return {
    schemaVersion: 1,
    source: 'launched-electron-main-process',
    electron: '38.8.6',
    chrome: '140.0.7339.249',
    node: '22.22.0',
    modules: '139',
    napi: '10',
    arch: 'arm64',
    platform: 'darwin',
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('C6 runtime source repair', () => {
  it('preserves INVALID_ARGUMENT for an empty RAG ask at the main-process IPC boundary', async () => {
    const handlers = new Map<string, Handler>();
    const ask = vi.fn(async () => ({ text: 'provider must not run', sources: [] }));
    const service = { rag: { ask } } as unknown as LocalKnowledgeService;

    registerDomainIpc(
      { handle: (channel, listener) => handlers.set(channel, listener as Handler) },
      () => service,
    );

    await expect(handlers.get(IPC_CHANNELS.RAG_ASK)!({}, '')).rejects.toThrow(
      '[INVALID_ARGUMENT] question is required',
    );
    await expect(handlers.get(IPC_CHANNELS.RAG_ASK)!({}, '   ')).rejects.toThrow(
      '[INVALID_ARGUMENT] question is required',
    );
    expect(ask).not.toHaveBeenCalled();
  });

  it('aggregates multiple launch-scoped runtime identities without requiring a shared wx target', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'c6-runtime-identity-'));
    tempRoots.push(root);
    const basePath = path.join(root, 'runtime-identity.json');
    const firstPath = path.join(root, 'runtime-identity-worker-0-pid-111-first.json');
    const secondPath = path.join(root, 'runtime-identity-worker-0-pid-222-second.json');
    await writeFile(firstPath, `${JSON.stringify(runtimeIdentity())}\n`, { flag: 'wx' });
    await writeFile(secondPath, `${JSON.stringify(runtimeIdentity())}\n`, { flag: 'wx' });

    const runner = await import(pathToFileURL(path.join(appRoot, 'scripts/run-electron-e2e.mjs')).href);
    const evidence = await runner.readElectronRuntimeIdentityEvidence(basePath, 'current-source');

    expect(evidence).toHaveLength(2);
    expect(new Set(evidence.map((entry: { path: string }) => entry.path))).toEqual(
      new Set([firstPath, secondPath]),
    );
    expect(evidence.every((entry: { identity: { electron: string; modules: string } }) =>
      entry.identity.electron === '38.8.6' && entry.identity.modules === '139')).toBe(true);
    await expect(readFile(basePath, 'utf8')).rejects.toThrow();
  });

  it('keeps fixture writes launch-unique instead of overwriting the shared runtime identity base path', async () => {
    const fixture = await readFile(path.join(appRoot, 'tests/e2e/electron.fixture.ts'), 'utf8');
    expect(fixture).toContain('launchScopedRuntimeIdentityPath');
    expect(fixture).toContain('workerInfo.workerIndex');
    expect(fixture).toContain('randomUUID()');
    expect(fixture).toContain("flag: 'wx'");
    expect(fixture).not.toContain('writeFile(runtimeIdentityBasePath');
  });
});
