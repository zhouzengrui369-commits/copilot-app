import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManagedPairingExchangePort } from '../../src/main/remote/pairing-file-port.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  const fs = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function root() {
  const value = await mkdtemp(path.join(tmpdir(), 'copilot-pairing-exchange-r1-'));
  roots.push(value);
  await chmod(value, 0o700);
  return value;
}

describe('managed Pairing exchange r1', () => {
  it('writes exact request wx/0600 and atomically commits the exact pending response', async () => {
    const directory = await root();
    const requestId = randomUUID();
    const port = new ManagedPairingExchangePort(directory, 'darwin');
    const request = Buffer.from(`${JSON.stringify({ schemaVersion: 1, requestId })}\n`);
    await expect(port.saveRequest(request)).resolves.toBe(true);
    const requestPath = path.join(directory, `${requestId}.copilot-pair-request`);
    expect(await readFile(requestPath)).toEqual(request);
    expect((await lstat(requestPath)).mode & 0o777).toBe(0o600);
    await expect(port.saveRequest(request)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    const responsePath = path.join(directory, `${requestId}.copilot-pairing`);
    await writeFile(responsePath, '{"schemaVersion":2}', { mode: 0o600 });
    const selected = await port.pickResponse(requestId);
    await expect(lstat(responsePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(Buffer.from(selected.bytes).toString()).toBe('{"schemaVersion":2}');
    await selected.commit();
    expect((await import('node:fs/promises')).readdir(directory)).resolves.toEqual([`${requestId}.copilot-pair-request`]);
  });

  it('rolls a claimed response back after failed durable activation and rejects wrong IDs/unsafe dirs', async () => {
    const directory = await root();
    const requestId = randomUUID();
    const responsePath = path.join(directory, `${requestId}.copilot-pairing`);
    await writeFile(responsePath, '{}', { mode: 0o600 });
    const port = new ManagedPairingExchangePort(directory, 'darwin');
    const selected = await port.pickResponse(requestId);
    await selected.rollback();
    await expect(lstat(responsePath)).resolves.toMatchObject({ size: 2 });
    await expect(port.pickResponse(randomUUID())).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    await chmod(directory, 0o755);
    expect(() => new ManagedPairingExchangePort(directory, 'darwin')).toThrow();
    expect(() => new ManagedPairingExchangePort(directory, 'win32')).toThrow();
    const link = `${directory}-link`;
    roots.push(link);
    await symlink(directory, link);
    expect(() => new ManagedPairingExchangePort(link, 'darwin')).toThrow();
  });

  it('rejects hardlinks, non-regular files, zero/oversize bytes, unsafe mode, and symlink responses', async () => {
    const directory = await root();
    const port = new ManagedPairingExchangePort(directory, 'darwin');
    const responsePath = (requestId: string) => path.join(directory, `${requestId}.copilot-pairing`);
    const expectRejected = async (requestId: string) => {
      await expect(port.pickResponse(requestId)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    };

    const hardlinkId = randomUUID();
    const hardlinkBacking = path.join(directory, 'hardlink-backing');
    await writeFile(hardlinkBacking, '{}', { mode: 0o600 });
    await link(hardlinkBacking, responsePath(hardlinkId));
    await expectRejected(hardlinkId);

    const nonRegularId = randomUUID();
    await mkdir(responsePath(nonRegularId), { mode: 0o700 });
    await expectRejected(nonRegularId);

    const zeroId = randomUUID();
    await writeFile(responsePath(zeroId), Buffer.alloc(0), { mode: 0o600 });
    await expectRejected(zeroId);

    const oversizeId = randomUUID();
    await writeFile(responsePath(oversizeId), Buffer.alloc((16 * 1024) + 1), { mode: 0o600 });
    await expectRejected(oversizeId);

    const unsafeModeId = randomUUID();
    await writeFile(responsePath(unsafeModeId), '{}', { mode: 0o600 });
    await chmod(responsePath(unsafeModeId), 0o644);
    await expectRejected(unsafeModeId);

    const symlinkId = randomUUID();
    const symlinkTarget = path.join(directory, 'symlink-target');
    await writeFile(symlinkTarget, '{}', { mode: 0o600 });
    await symlink(symlinkTarget, responsePath(symlinkId));
    await expectRejected(symlinkId);
  });

  it.each(['partial-write', 'fsync'] as const)('removes a partially published request after %s failure', async (failure) => {
    const directory = await root();
    const requestId = randomUUID();
    const requestPath = path.join(directory, `${requestId}.copilot-pair-request`);
    const actualOpen = fs.promises.open.bind(fs.promises) as typeof fs.promises.open;
    vi.spyOn(fs.promises, 'open').mockImplementation((async (...args: Parameters<typeof fs.promises.open>) => {
      const handle = await (actualOpen as (...openArgs: Parameters<typeof fs.promises.open>) => ReturnType<typeof fs.promises.open>)(...args);
      if (args[1] === 'wx') {
        const mutable = handle as unknown as {
          writeFile: (...writeArgs: unknown[]) => Promise<void>;
          sync: () => Promise<void>;
        };
        if (failure === 'partial-write') {
          const writeFileExactly = mutable.writeFile.bind(handle);
          mutable.writeFile = async (...writeArgs) => {
            await writeFileExactly(...writeArgs);
            throw new Error('simulated partial write failure');
          };
        } else {
          mutable.sync = async () => { throw new Error('simulated fsync failure'); };
        }
      }
      return handle;
    }) as typeof fs.promises.open);

    const port = new ManagedPairingExchangePort(directory, 'darwin');
    const request = Buffer.from(`${JSON.stringify({ schemaVersion: 1, requestId })}\n`);
    await expect(port.saveRequest(request)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(lstat(requestPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('claims the original atomically and refuses rollback over a replacement collision', async () => {
    const directory = await root();
    const requestId = randomUUID();
    const responsePath = path.join(directory, `${requestId}.copilot-pairing`);
    await writeFile(responsePath, 'original', { mode: 0o600 });
    const port = new ManagedPairingExchangePort(directory, 'darwin');
    const selected = await port.pickResponse(requestId);
    await writeFile(responsePath, 'replacement', { mode: 0o600 });

    expect(Buffer.from(selected.bytes).toString()).toBe('original');
    await expect(selected.rollback()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(await readFile(responsePath, 'utf8')).toBe('replacement');
    const claim = (await readdir(directory)).find((name) => name.includes('.consuming.'));
    expect(claim).toBeDefined();
    expect(await readFile(path.join(directory, claim!), 'utf8')).toBe('original');
  });

  it('fails closed and preserves the claimed response when durable commit unlink fails', async () => {
    const directory = await root();
    const requestId = randomUUID();
    const responsePath = path.join(directory, `${requestId}.copilot-pairing`);
    await writeFile(responsePath, '{}', { mode: 0o600 });
    const port = new ManagedPairingExchangePort(directory, 'darwin');
    const selected = await port.pickResponse(requestId);
    vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(new Error('simulated unlink failure'));

    await expect(selected.commit()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(lstat(responsePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(directory)).some((name) => name.includes('.consuming.'))).toBe(true);
  });
});
