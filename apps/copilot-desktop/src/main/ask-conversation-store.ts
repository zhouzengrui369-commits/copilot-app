import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AskConversationSaveRequest,
  RagRetrievalEvidence,
  TodoRecord,
} from '../shared/domain-api.js';

const MAX_BYTES = 256 * 1024;
const MAX_QUESTION = 16 * 1024;
const MAX_ANSWER = 96 * 1024;
const MAX_SOURCES = 16;
const MAX_PATH = 500;
const DIGEST = /^[0-9a-f]{64}$/u;
const EVIDENCE = new Set<RagRetrievalEvidence>(['vector', 'kg-entity', 'kg-neighbor']);

export interface AskConversationSourceBinding {
  notePath: string;
  updatedAt: number;
  bodyDigest: string;
}

export interface StoredAskConversationSnapshot extends AskConversationSaveRequest {
  schemaVersion: 1;
  sourceBindings: AskConversationSourceBinding[];
}

export interface AskConversationPersistence {
  save(snapshot: StoredAskConversationSnapshot): Promise<void>;
  load(): Promise<StoredAskConversationSnapshot | null>;
  clear(): Promise<void>;
}

type LoadFileOpener = (
  path: string,
  flags: number,
) => ReturnType<typeof open>;

export class AskConversationStore implements AskConversationPersistence {
  readonly directoryPath: string;
  readonly filePath: string;

  constructor(
    userDataPath: string,
    private readonly openForLoad: LoadFileOpener = open,
  ) {
    this.directoryPath = join(userDataPath, 'ask-conversation');
    this.filePath = join(this.directoryPath, 'latest-completed-v1.json');
  }

  async save(snapshot: StoredAskConversationSnapshot): Promise<void> {
    assertStoredAskConversationSnapshot(snapshot);
    const bytes = Buffer.from(JSON.stringify(snapshot), 'utf8');
    if (bytes.byteLength > MAX_BYTES) invalid();
    await this.ensureSafeDirectory();
    await assertSafeExistingFile(this.filePath, true);
    const temporary = join(this.directoryPath, `.latest-${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.chmod(0o600);
      await handle.close();
      handle = null;
      await rename(temporary, this.filePath);
      await chmod(this.filePath, 0o600);
      await assertSafeExistingFile(this.filePath, false);
    } catch {
      await handle?.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new Error('ASK_CONVERSATION_STORE_WRITE_FAILED');
    }
  }

  async load(): Promise<StoredAskConversationSnapshot | null> {
    await this.ensureSafeDirectory();
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await this.openForLoad(
        this.filePath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if (isMissing(error)) return null;
      unsafe();
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) unsafe();
      const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
      if (currentUid !== undefined && info.uid !== currentUid) unsafe();
      if ((info.mode & 0o077) !== 0) unsafe();
      if (info.size > MAX_BYTES) invalid();
      const bytes = await handle.readFile();
      if (bytes.byteLength > MAX_BYTES) invalid();
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString('utf8'));
      } catch {
        invalid();
      }
      assertStoredAskConversationSnapshot(parsed);
      return parsed;
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async clear(): Promise<void> {
    await this.ensureSafeDirectory();
    const info = await assertSafeExistingFile(this.filePath, true);
    if (!info) return;
    await rm(this.filePath);
  }

  private async ensureSafeDirectory(): Promise<void> {
    await mkdir(this.directoryPath, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directoryPath);
    if (!info.isDirectory() || info.isSymbolicLink()) unsafe();
    await chmod(this.directoryPath, 0o700);
  }
}

async function assertSafeExistingFile(
  path: string,
  missingAllowed: boolean,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    if (missingAllowed && isMissing(error)) return null;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) unsafe();
  return info;
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

export function assertStoredAskConversationSnapshot(
  value: unknown,
): asserts value is StoredAskConversationSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.phase !== 'completed') invalid();
  assertString(value.exchangeId, 1, 128);
  assertString(value.question, 1, MAX_QUESTION);
  if (!Number.isSafeInteger(value.completedAt) || (value.completedAt as number) <= 0) invalid();
  assertAnswer(value.answer);
  if (!Array.isArray(value.sourceBindings) || value.sourceBindings.length === 0) invalid();
  const answer = value.answer as { sources: string[] };
  if (value.sourceBindings.length !== answer.sources.length) invalid();
  value.sourceBindings.forEach((binding, index) => {
    if (!isRecord(binding)) invalid();
    assertPath(binding.notePath);
    if (binding.notePath !== answer.sources[index]) invalid();
    if (!Number.isSafeInteger(binding.updatedAt) || (binding.updatedAt as number) < 0) invalid();
    if (typeof binding.bodyDigest !== 'string' || !DIGEST.test(binding.bodyDigest)) invalid();
  });
  if (value.todoReceipt !== null) assertTodo(value.todoReceipt);
}

function assertAnswer(value: unknown): void {
  if (!isRecord(value)) invalid();
  assertString(value.text, 1, MAX_ANSWER);
  if (!Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > MAX_SOURCES) invalid();
  if (!Array.isArray(value.sourceDetails) || value.sourceDetails.length !== value.sources.length) invalid();
  const sources = value.sources;
  const sourceDetails = value.sourceDetails;
  sources.forEach((path) => assertPath(path));
  sourceDetails.forEach((detail, index) => {
    if (!isRecord(detail) || detail.notePath !== sources[index]) invalid();
    if (!Array.isArray(detail.evidence) || detail.evidence.some((item) => !EVIDENCE.has(item as RagRetrievalEvidence))) invalid();
    if (typeof detail.score !== 'number' || !Number.isFinite(detail.score)) invalid();
  });
}

function assertTodo(value: unknown): asserts value is TodoRecord {
  if (!isRecord(value)) invalid();
  if ((typeof value.id !== 'string' && typeof value.id !== 'number') || !String(value.id)) invalid();
  assertString(value.title, 1, 500);
  if (typeof value.body !== 'string' || value.body.length > MAX_ANSWER) invalid();
  if (!Array.isArray(value.note_links) || value.note_links.some((path) => {
    try { assertPath(path); return false; } catch { return true; }
  })) invalid();
  if (!['pending', 'done', 'cancelled'].includes(String(value.status))) invalid();
}

function assertPath(value: unknown): asserts value is string {
  assertString(value, 1, MAX_PATH);
  if (/[\u0000-\u001f\u007f]/u.test(value as string)) invalid();
}

function assertString(value: unknown, min: number, max: number): asserts value is string {
  if (typeof value !== 'string' || value.length < min || value.length > max || value !== value.trim()) invalid();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function invalid(): never {
  throw new Error('ASK_CONVERSATION_STORE_INVALID');
}

function unsafe(): never {
  throw new Error('ASK_CONVERSATION_STORE_UNSAFE');
}
