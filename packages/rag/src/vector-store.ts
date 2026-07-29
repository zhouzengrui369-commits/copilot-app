/**
 * Vector store — sql.js (WASM SQLite) backed.
 *
 * Sprint 1.3 T-1.3.1 (worker β): the task instruction lists "sqlite-vss (本地
 * 优先)" but the active workspace env (T-1.3.0a finding: better-sqlite3@11.10.0
 * native build fails on Python 3.14 + node-gyp 9.4.1 due to distutils removal)
 * blocks the conventional better-sqlite3 + sqlite-vss extension combo. sql.js
 * compiles SQLite to WebAssembly — no native build, no node-gyp, runs in
 * Node 24 out of the box.
 *
 * We store embeddings as 4-byte-float BLOBs and run cosine similarity in
 * TypeScript — a brute-force scan over the chunk table. With a 5k-chunk cap
 * (typical KB corpus for an MVP), this is well under 50ms. When the env
 * stabilizes, the VectorStore interface exposes the same surface so callers
 * can swap in `SqliteVssVectorStore` without touching the rest of RAG.
 *
 * Schema (inside rag.db):
 *   chunks(
 *     id            TEXT PRIMARY KEY,
 *     note_path     TEXT NOT NULL,
 *     ordinal       INTEGER NOT NULL,
 *     text          TEXT NOT NULL,
 *     token_count   INTEGER NOT NULL,
 *     char_start    INTEGER NOT NULL,
 *     char_end      INTEGER NOT NULL,
 *     embedding     BLOB NOT NULL,           -- 4-byte-floats, dim*DIM bytes
 *     model         TEXT NOT NULL,
 *     embedded_at   INTEGER NOT NULL
 *   )
 *   CREATE INDEX idx_chunks_note_path ON chunks(note_path);
 *
 *   rag_index_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
 *     -- rows: ('schema_version', '1'), ('embedding_model', 'mxbai-embed-large')
 */

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

import type {
  NoteChunk,
  EmbeddedChunk,
  StoredChunk,
  RetrievalHit,
  RetrievalResult,
  VectorStoreConfig,
  VectorSearchOptions,
} from './types.js';

const SCHEMA_VERSION = '2';
let atomicWriteSequence = 0;

async function writeDatabaseAtomically(dbPath: string, data: Uint8Array): Promise<void> {
  const directory = dirname(dbPath);
  await mkdir(directory, { recursive: true });
  atomicWriteSequence += 1;
  const tempPath = join(directory, `.${basename(dbPath)}.${process.pid}.${atomicWriteSequence}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, dbPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

// Resolve sql.js's bundled WASM via Node's module loader so the locateFile
// callback always returns an absolute path. (sql.js ships sql-wasm.wasm
// next to sql-wasm.js inside its own dist/ — colocating is the documented
// stable layout.)  createRequire(import.meta.url) works in ESM modules.
const require = createRequire(import.meta.url);
let sqlWasmDir: string | null = null;
try {
  const sqlJsEntry = require.resolve('sql.js/dist/sql-wasm.js');
  sqlWasmDir = dirname(sqlJsEntry);
} catch {
  sqlWasmDir = null;
}

let sqlPromise: Promise<SqlJsStatic> | null = null;
async function loadSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => {
        if (!sqlWasmDir) throw new Error('rag: sql.js dist not resolvable (npm install sql.js)');
        return resolve(sqlWasmDir, file);
      },
    });
  }
  return sqlPromise;
}

export interface VectorStore {
  /** idem — write the in-memory db to disk if non-volatile path. */
  close(): Promise<void>;
  insert(chunk: EmbeddedChunk): Promise<void>;
  insertMany(chunks: readonly EmbeddedChunk[]): Promise<void>;
  /** Atomically replace the complete chunk set for one note. */
  replaceNote(notePath: string, chunks: readonly EmbeddedChunk[]): Promise<void>;
  /** Atomically replace local text truth and its successful vector subset. */
  replaceNoteIndex(
    notePath: string,
    textChunks: readonly NoteChunk[],
    vectorChunks: readonly EmbeddedChunk[],
  ): Promise<void>;
  /** Atomically remove every chunk belonging to one note. */
  deleteNote(notePath: string): Promise<void>;
  /** top-k cosine similarity search. */
  search(
    queryEmbedding: Float32Array,
    options?: VectorSearchOptions,
  ): Promise<RetrievalResult>;
  /** count of chunks currently indexed (for diagnostics + board entry) */
  count(): number;
  /** count of durable local-text chunks. */
  textCount(): number;
  /** count of chunks with a real embedding. */
  vectorCount(): number;
  /** diagnostic — list distinct notePaths */
  listNotePaths(): string[];
  /** Return the complete stored records for one note in stable order. */
  listChunksForNote(notePath: string): StoredChunk[];
  /** diagnostic — return the schema version row */
  schemaVersion(): string;
}

class SqlJsVectorStore implements VectorStore {
  private readonly db: Database;
  private readonly dbPath: string | null;
  private readonly dimensions: number;
  private dirty = false;
  private mutationVersion = 0;
  private persistedVersion = 0;
  private persistTail: Promise<void> = Promise.resolve();
  private readonly migrationRequired: boolean;

  private constructor(
    db: Database,
    dbPath: string | null,
    dimensions: number,
  ) {
    this.db = db;
    this.dbPath = dbPath;
    this.dimensions = dimensions;
    this.migrationRequired = this.init();
  }

  static async create(config: VectorStoreConfig = {}): Promise<SqlJsVectorStore> {
    const SQL = await loadSql();
    const dbPath = config.dbPath && config.dbPath !== ':memory:'
      ? config.dbPath
      : null;
    let bytes: Uint8Array | undefined;
    let db: Database;
    if (dbPath) {
      try {
        bytes = await readFile(dbPath);
      } catch {
        bytes = undefined;
      }
      await mkdir(dirname(dbPath), { recursive: true });
    }
    db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    const store = new SqlJsVectorStore(db, dbPath, config.dimensions ?? 1024);
    if (bytes && store.migrationRequired) {
      await store.persistCommittedMutation();
    }
    return store;
  }

  private init(): boolean {
    const hadMeta = this.tableExists('rag_index_meta');
    const previousVersion = hadMeta ? this.metaValue('schema_version') : null;
    const hadTextChunks = this.tableExists('text_chunks');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id            TEXT PRIMARY KEY,
        note_path     TEXT NOT NULL,
        ordinal       INTEGER NOT NULL,
        text          TEXT NOT NULL,
        token_count   INTEGER NOT NULL,
        char_start    INTEGER NOT NULL,
        char_end      INTEGER NOT NULL,
        embedding     BLOB NOT NULL,
        model         TEXT NOT NULL,
        embedded_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_note_path ON chunks(note_path);
      CREATE TABLE IF NOT EXISTS text_chunks (
        id            TEXT PRIMARY KEY,
        note_path     TEXT NOT NULL,
        ordinal       INTEGER NOT NULL,
        text          TEXT NOT NULL,
        token_count   INTEGER NOT NULL,
        char_start    INTEGER NOT NULL,
        char_end      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_text_chunks_note_path
        ON text_chunks(note_path);
      CREATE TABLE IF NOT EXISTS rag_index_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.db.exec(`
      INSERT OR IGNORE INTO text_chunks(
        id, note_path, ordinal, text, token_count, char_start, char_end
      )
      SELECT id, note_path, ordinal, text, token_count, char_start, char_end
        FROM chunks;
    `);
    const backfilled = this.db.getRowsModified() > 0;
    this.upsertMeta('schema_version', SCHEMA_VERSION);
    return !hadTextChunks || previousVersion !== SCHEMA_VERSION || backfilled;
  }

  private tableExists(name: string): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 AS present
         FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1`,
    );
    stmt.bind([name]);
    const found = stmt.step();
    stmt.free();
    return found;
  }

  private metaValue(key: string): string | null {
    const stmt = this.db.prepare(
      `SELECT value FROM rag_index_meta WHERE key = ? LIMIT 1`,
    );
    stmt.bind([key]);
    let value: string | null = null;
    if (stmt.step()) {
      const row = stmt.getAsObject() as { value: string };
      value = row.value;
    }
    stmt.free();
    return value;
  }

  private upsertMeta(key: string, value: string): void {
    const stmt = this.db.prepare(
      `INSERT INTO rag_index_meta(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    stmt.run([key, value]);
    stmt.free();
  }

  private toBytes(arr: Float32Array): Uint8Array {
    // 4 bytes per float; allocate exact buffer.
    const buf = new ArrayBuffer(arr.byteLength);
    new Float32Array(buf).set(arr);
    return new Uint8Array(buf);
  }

  private fromBytes(buf: Uint8Array): Float32Array {
    // Make a defensive copy so callers can't mutate the stored vector.
    // .slice() copies into a fresh ArrayBuffer, breaking the alias with `buf`.
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
  }

  async insert(chunk: EmbeddedChunk): Promise<void> {
    this.validateChunk(chunk);
    this.db.exec('BEGIN TRANSACTION');
    try {
      this.writeTextChunk(chunk);
      this.writeChunk(chunk);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    await this.persistCommittedMutation();
  }

  private validateTextChunk(chunk: NoteChunk, expectedNotePath?: string): void {
    if (!chunk.id || !chunk.notePath) {
      throw new Error('VectorStore: chunk id and notePath are required');
    }
    if (expectedNotePath !== undefined && chunk.notePath !== expectedNotePath) {
      throw new Error(
        `VectorStore.replaceNote: chunk notePath ${chunk.notePath} does not match ${expectedNotePath}`,
      );
    }
  }

  private validateChunk(chunk: EmbeddedChunk, expectedNotePath?: string): void {
    this.validateTextChunk(chunk, expectedNotePath);
    if (chunk.embedding.length !== this.dimensions) {
      throw new Error(
        `VectorStore.insert: dim mismatch ${chunk.embedding.length} vs ${this.dimensions}`,
      );
    }
  }

  private writeTextChunk(chunk: NoteChunk, upsert = true): void {
    const conflictClause = upsert
      ? `ON CONFLICT(id) DO UPDATE SET
           note_path = excluded.note_path,
           ordinal = excluded.ordinal,
           text = excluded.text,
           token_count = excluded.token_count,
           char_start = excluded.char_start,
           char_end = excluded.char_end`
      : '';
    const stmt = this.db.prepare(
      `INSERT INTO text_chunks(
        id, note_path, ordinal, text, token_count, char_start, char_end
      ) VALUES(?, ?, ?, ?, ?, ?, ?)
      ${conflictClause}`,
    );
    stmt.run([
      chunk.id,
      chunk.notePath,
      chunk.ordinal,
      chunk.text,
      chunk.tokenCount,
      chunk.charRange[0],
      chunk.charRange[1],
    ]);
    stmt.free();
  }

  private writeChunk(chunk: EmbeddedChunk, upsert = true): void {
    const conflictClause = upsert
      ? `ON CONFLICT(id) DO UPDATE SET
           note_path = excluded.note_path,
           ordinal = excluded.ordinal,
           text = excluded.text,
           token_count = excluded.token_count,
           char_start = excluded.char_start,
           char_end = excluded.char_end,
           embedding = excluded.embedding,
           model = excluded.model,
           embedded_at = excluded.embedded_at`
      : '';
    const stmt = this.db.prepare(
      `INSERT INTO chunks(id, note_path, ordinal, text, token_count, char_start, char_end, embedding, model, embedded_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ${conflictClause}`,
    );
    stmt.run([
      chunk.id,
      chunk.notePath,
      chunk.ordinal,
      chunk.text,
      chunk.tokenCount,
      chunk.charRange[0],
      chunk.charRange[1],
      this.toBytes(chunk.embedding),
      chunk.model,
      chunk.embeddedAt,
    ]);
    stmt.free();
  }

  private async persistCommittedMutation(): Promise<void> {
    this.dirty = true;
    if (!this.dbPath) return;
    const version = ++this.mutationVersion;
    const snapshot = this.db.export();
    const persistence = this.persistTail.then(async () => {
      await writeDatabaseAtomically(this.dbPath!, snapshot);
      this.persistedVersion = Math.max(this.persistedVersion, version);
      this.dirty = this.persistedVersion < this.mutationVersion;
    });
    this.persistTail = persistence.catch(() => undefined);
    await persistence;
  }

  async insertMany(chunks: readonly EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    for (const chunk of chunks) this.validateChunk(chunk);
    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const chunk of chunks) {
        this.writeTextChunk(chunk);
        this.writeChunk(chunk);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    await this.persistCommittedMutation();
  }

  async replaceNote(notePath: string, chunks: readonly EmbeddedChunk[]): Promise<void> {
    return this.replaceNoteIndex(notePath, chunks, chunks);
  }

  async replaceNoteIndex(
    notePath: string,
    textChunks: readonly NoteChunk[],
    vectorChunks: readonly EmbeddedChunk[],
  ): Promise<void> {
    if (!notePath.trim()) throw new Error('VectorStore.replaceNote: notePath is required');
    const ids = new Set<string>();
    const textById = new Map<string, NoteChunk>();
    for (const chunk of textChunks) {
      this.validateTextChunk(chunk, notePath);
      if (ids.has(chunk.id)) throw new Error(`VectorStore.replaceNote: duplicate chunk id ${chunk.id}`);
      ids.add(chunk.id);
      textById.set(chunk.id, chunk);
    }
    const vectorIds = new Set<string>();
    for (const chunk of vectorChunks) {
      this.validateChunk(chunk, notePath);
      if (vectorIds.has(chunk.id)) {
        throw new Error(`VectorStore.replaceNote: duplicate vector chunk id ${chunk.id}`);
      }
      vectorIds.add(chunk.id);
      const textChunk = textById.get(chunk.id);
      if (!textChunk || !sameChunkText(textChunk, chunk)) {
        throw new Error(
          `VectorStore.replaceNote: vector chunk ${chunk.id} is not aligned with local text`,
        );
      }
    }
    this.db.exec('BEGIN TRANSACTION');
    try {
      const removeVectors = this.db.prepare('DELETE FROM chunks WHERE note_path = ?');
      removeVectors.run([notePath]);
      removeVectors.free();
      const removeText = this.db.prepare('DELETE FROM text_chunks WHERE note_path = ?');
      removeText.run([notePath]);
      removeText.free();
      for (const chunk of textChunks) this.writeTextChunk(chunk, false);
      for (const chunk of vectorChunks) this.writeChunk(chunk, false);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    await this.persistCommittedMutation();
  }

  async deleteNote(notePath: string): Promise<void> {
    if (!notePath.trim()) throw new Error('VectorStore.deleteNote: notePath is required');
    this.db.exec('BEGIN TRANSACTION');
    try {
      const vectors = this.db.prepare('DELETE FROM chunks WHERE note_path = ?');
      vectors.run([notePath]);
      vectors.free();
      const text = this.db.prepare('DELETE FROM text_chunks WHERE note_path = ?');
      text.run([notePath]);
      text.free();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    await this.persistCommittedMutation();
  }

  async search(
    queryEmbedding: Float32Array,
    options: VectorSearchOptions = {},
  ): Promise<RetrievalResult> {
    if (queryEmbedding.length !== this.dimensions) {
      throw new Error(
        `VectorStore.search: query dim mismatch ${queryEmbedding.length} vs ${this.dimensions}`,
      );
    }
    const topK = options.topK ?? 5;
    const minScore = options.minScore ?? -1;

    const stmt = this.db.prepare(
      `SELECT id, note_path, ordinal, text, token_count, char_start, char_end, embedding
         FROM chunks`,
    );
    type Row = {
      id: string;
      note_path: string;
      ordinal: number;
      text: string;
      token_count: number;
      char_start: number;
      char_end: number;
      embedding: Uint8Array;
    };
    const hits: RetrievalHit[] = [];
    let candidates = 0;
    const qNorm = l2norm(queryEmbedding);
    if (qNorm === 0) {
      stmt.free();
      throw new Error('VectorStore.search: query embedding has zero norm');
    }
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as Row;
      candidates += 1;
      const emb = this.fromBytes(row.embedding);
      const s = cosineSimilarity(queryEmbedding, qNorm, emb);
      if (s >= minScore) {
        hits.push({
          chunk: {
            id: row.id,
            notePath: row.note_path,
            ordinal: row.ordinal,
            text: row.text,
            tokenCount: row.token_count,
            charRange: [row.char_start, row.char_end],
          },
          score: s,
        });
      }
    }
    stmt.free();
    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, topK);
    return {
      query: '',
      queryEmbedding,
      hits: top,
      candidates,
    };
  }

  count(): number {
    return this.vectorCount();
  }

  textCount(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) AS c FROM text_chunks`);
    stmt.step();
    const row = stmt.getAsObject() as { c: number };
    stmt.free();
    return Number(row.c);
  }

  vectorCount(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) AS c FROM chunks`);
    stmt.step();
    const row = stmt.getAsObject() as { c: number };
    stmt.free();
    return Number(row.c);
  }

  listNotePaths(): string[] {
    const stmt = this.db.prepare(
      `SELECT DISTINCT note_path FROM text_chunks ORDER BY note_path`,
    );
    const out: string[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as { note_path: string };
      out.push(row.note_path);
    }
    stmt.free();
    return out;
  }

  listChunksForNote(notePath: string): StoredChunk[] {
    const stmt = this.db.prepare(
      `SELECT
         text.id,
         text.note_path,
         text.ordinal,
         text.text,
         text.token_count,
         text.char_start,
         text.char_end,
         vectors.embedding,
         vectors.model,
         vectors.embedded_at
       FROM text_chunks AS text
       LEFT JOIN chunks AS vectors ON vectors.id = text.id
       WHERE text.note_path = ?
       ORDER BY text.ordinal, text.id`,
    );
    stmt.bind([notePath]);
    type Row = {
      id: string;
      note_path: string;
      ordinal: number;
      text: string;
      token_count: number;
      char_start: number;
      char_end: number;
      embedding: Uint8Array | null;
      model: string | null;
      embedded_at: number | null;
    };
    const chunks: StoredChunk[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as Row;
      const textChunk: NoteChunk = {
        id: row.id,
        notePath: row.note_path,
        ordinal: row.ordinal,
        text: row.text,
        tokenCount: row.token_count,
        charRange: [row.char_start, row.char_end],
      };
      if (
        row.embedding instanceof Uint8Array &&
        typeof row.model === 'string' &&
        typeof row.embedded_at === 'number'
      ) {
        chunks.push({
          ...textChunk,
          embedding: this.fromBytes(row.embedding),
          model: row.model,
          embeddedAt: row.embedded_at,
        });
      } else {
        chunks.push(textChunk);
      }
    }
    stmt.free();
    return chunks;
  }

  schemaVersion(): string {
    const stmt = this.db.prepare(
      `SELECT value FROM rag_index_meta WHERE key = 'schema_version'`,
    );
    let v = SCHEMA_VERSION;
    if (stmt.step()) {
      const row = stmt.getAsObject() as { value: string };
      v = row.value;
    }
    stmt.free();
    return v;
  }

  async close(): Promise<void> {
    await this.persistTail;
    if (this.dbPath && this.dirty) {
      await this.persistCommittedMutation();
    }
    this.db.close();
  }
}

function sameChunkText(a: NoteChunk, b: NoteChunk): boolean {
  return (
    a.id === b.id &&
    a.notePath === b.notePath &&
    a.ordinal === b.ordinal &&
    a.text === b.text &&
    a.tokenCount === b.tokenCount &&
    a.charRange[0] === b.charRange[0] &&
    a.charRange[1] === b.charRange[1]
  );
}

function l2norm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i += 1) {
    const x = v[i] ?? 0;
    s += x * x;
  }
  return Math.sqrt(s);
}

function cosineSimilarity(
  a: Float32Array,
  aNorm: number,
  b: Float32Array,
): number {
  if (a.length !== b.length) {
    throw new Error(
      `VectorStore.cosine: dimension mismatch ${a.length} vs ${b.length}`,
    );
  }
  let dot = 0;
  let bSumSq = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    bSumSq += y * y;
  }
  const bNorm = Math.sqrt(bSumSq);
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (aNorm * bNorm);
}

/** Factory — same shape as the future sqlite-vss-backed impl will use. */
export async function createVectorStore(
  config?: VectorStoreConfig,
): Promise<VectorStore> {
  return SqlJsVectorStore.create(config);
}

/** utility — generate a v4-ish random id without bringing in uuid as a dep */
export function generateChunkId(): string {
  const rnd = (n: number): string =>
    Math.floor(Math.random() * n).toString(16).padStart(2, '0');
  return [
    rnd(256) + rnd(256),
    rnd(256) + rnd(256),
    rnd(256) + rnd(256),
    rnd(256) + rnd(256),
  ].join('');
}
