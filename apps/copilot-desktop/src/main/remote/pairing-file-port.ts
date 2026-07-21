import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { RemoteError } from './protocol.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAIRING_BYTES = 16 * 1024;

export interface PairingBundleSelection {
  bytes: Uint8Array;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Main-only managed exchange; renderer sees only intent and sanitized state. */
export class ManagedPairingExchangePort {
  readonly directory!: string;

  constructor(
    configuredDirectory: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    if (!path.isAbsolute(configuredDirectory) || path.resolve(configuredDirectory) !== configuredDirectory) fail();
    let canonical: string;
    let stat: fs.Stats;
    try {
      canonical = fs.realpathSync(configuredDirectory);
      stat = fs.lstatSync(configuredDirectory);
    } catch {
      return fail();
    }
    if (canonical !== configuredDirectory || !stat.isDirectory() || stat.isSymbolicLink()) fail();
    // Node mode bits do not prove Windows ACL ownership. Keep managed exchange
    // unavailable there until a native owner-only ACL verifier is composed.
    if (platform === 'win32') fail();
    if ((stat.mode & 0o777) !== 0o700) fail();
    this.directory = canonical;
  }

  async saveRequest(bytes: Uint8Array): Promise<boolean> {
    const requestId = parseRequestId(bytes);
    const file = this.requestFile(requestId);
    let handle: fs.promises.FileHandle | null = null;
    let created = false;
    try {
      handle = await fs.promises.open(file, 'wx', 0o600);
      created = true;
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      if (this.platform !== 'win32') await fs.promises.chmod(file, 0o600);
      return true;
    } catch {
      await handle?.close().catch(() => undefined);
      if (created) await fs.promises.unlink(file).catch(() => undefined);
      return fail();
    }
  }

  async pickResponse(pendingRequestId: string): Promise<PairingBundleSelection> {
    requireRequestId(pendingRequestId);
    const expected = this.responseFile(pendingRequestId);
    const claimed = path.join(
      this.directory,
      `.${pendingRequestId}.copilot-pairing.consuming.${randomUUID()}`,
    );
    try {
      await fs.promises.rename(expected, claimed);
    } catch {
      return fail();
    }

    let handle: fs.promises.FileHandle | null = null;
    try {
      handle = await fs.promises.open(claimed, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      const claimedStat = await fs.promises.lstat(claimed);
      if (
        !stat.isFile()
        || claimedStat.isSymbolicLink()
        || stat.nlink !== 1
        || stat.dev !== claimedStat.dev
        || stat.ino !== claimedStat.ino
        || stat.size < 1
        || stat.size > MAX_PAIRING_BYTES
        || (this.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      ) fail();
      const bytes = await handle.readFile();
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_PAIRING_BYTES) fail();
      await handle.close();
      handle = null;
      let settled = false;
      return {
        bytes,
        commit: async () => {
          if (settled) return fail();
          settled = true;
          await fs.promises.unlink(claimed).catch(() => fail());
        },
        rollback: async () => {
          if (settled) return;
          settled = true;
          try {
            await fs.promises.lstat(expected);
            fail();
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          await fs.promises.rename(claimed, expected).catch(() => fail());
        },
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      try {
        await fs.promises.lstat(expected);
      } catch (missing) {
        if ((missing as NodeJS.ErrnoException).code === 'ENOENT') {
          await fs.promises.rename(claimed, expected).catch(() => undefined);
        }
      }
      if (error instanceof RemoteError) throw error;
      return fail();
    }
  }

  private requestFile(requestId: string): string {
    requireRequestId(requestId);
    return path.join(this.directory, `${requestId}.copilot-pair-request`);
  }

  private responseFile(requestId: string): string {
    requireRequestId(requestId);
    return path.join(this.directory, `${requestId}.copilot-pairing`);
  }
}

function parseRequestId(bytes: Uint8Array): string {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_PAIRING_BYTES) fail();
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as { requestId?: unknown };
    if (!value || typeof value !== 'object' || typeof value.requestId !== 'string') fail();
    requireRequestId(value.requestId);
    return value.requestId;
  } catch (error) {
    if (error instanceof RemoteError) throw error;
    return fail();
  }
}

function requireRequestId(value: string): void {
  if (!UUID_V4.test(value)) fail();
}

function fail(): never {
  throw new RemoteError('AUTH_REQUIRED', 'managed pairing exchange is unavailable');
}
