/**
 * Indexer pipeline — Sprint 1.3 T-1.3.1 wave 2.
 *
 * Two public entry points:
 *   - `indexNotes()` — one-shot bulk index from a list of `{ path, body }`
 *     items (caller queries whatever source they want; we keep RAG
 *     decoupled from @copilot/kb runtime to avoid the better-sqlite3
 *     native-binding rabbit hole).
 *   - `indexOneNote()` — incremental add for a single note.
 *
 * Pipeline per chunk:
 *   1. chunk text (chunker.ts, 512-token paragraph-bound)
 *   2. embed (Ollama /api/embeddings)
 *   3. insert into VectorStore
 *
 * On chunk-embed error: skip the bad chunk and continue (RAG is
 * best-effort — losing one chunk should not break indexing of the
 * remaining notes). Errors are recorded in the returned IndexerReport.
 */

import { chunkNote, type ChunkerConfig } from './chunker.js';
import type { Embedder } from './embedder.js';
import type {
  EmbeddedChunk,
  NoteChunk,
  ProviderStatus,
} from './types.js';
import type { VectorStore } from './vector-store.js';

export interface NoteInput {
  /** @copilot/kb Note.path — surface verbatim into the citation UI */
  path: string;
  /** Markdown body */
  body: string;
  /** Optional title (recorded in diagnostics only) */
  title?: string;
}

export interface IndexerOptions {
  chunker?: ChunkerConfig;
  /** Skip chunks whose text matches this predicate (e.g. trivial frontmatter) */
  shouldSkip?: (chunk: NoteChunk) => boolean;
  /** Override embedder model id at index time; otherwise uses Embedder default */
  embedModel?: string;
}

export interface IndexerReport {
  notes: number;
  chunksAttempted: number;
  chunksInserted: number;
  /** Chunks with a successful, persisted vector. */
  vectorChunksInserted: number;
  /** Honest vector coverage/provider status; local text does not imply `ok`. */
  vectorStatus: ProviderStatus;
  chunksSkipped: number;
  /** Per-error record so the verifier / UI can show what failed */
  errors: Array<{ path: string; ordinal: number; reason: string }>;
  /** Embedder model id actually used — written to rag_index_meta */
  embeddingModel: string;
  /** unix-ms timestamp of index start */
  startedAt: number;
  /** unix-ms timestamp of index end */
  finishedAt: number;
}

export class Indexer {
  private readonly embedder: Embedder;
  private readonly store: VectorStore;

  constructor(embedder: Embedder, store: VectorStore) {
    this.embedder = embedder;
    this.store = store;
  }

  async indexNotes(
    notes: readonly NoteInput[],
    options: IndexerOptions = {},
  ): Promise<IndexerReport> {
    const startedAt = Date.now();
    let chunksAttempted = 0;
    let chunksInserted = 0;
    let vectorChunksInserted = 0;
    let chunksSkipped = 0;
    let unavailableFailures = 0;
    let providerFailures = 0;
    let storeFailures = 0;
    const errors: IndexerReport['errors'] = [];

    for (const note of notes) {
      const chunks = chunkNote(note.body, note.path, options.chunker);
      const textChunks: NoteChunk[] = [];
      const embeddedChunks: EmbeddedChunk[] = [];
      for (const c of chunks) {
        if (options.shouldSkip?.(c)) {
          chunksSkipped += 1;
          continue;
        }
        chunksAttempted += 1;
        textChunks.push(c);
        try {
          const embedding = await this.embedder.embed(c.text);
          const embedded: EmbeddedChunk = {
            ...c,
            embedding,
            model: this.embedder.modelId,
            embeddedAt: Date.now(),
          };
          embeddedChunks.push(embedded);
        } catch (err) {
          if (isProviderUnavailable(err)) unavailableFailures += 1;
          else providerFailures += 1;
          errors.push({
            path: note.path,
            ordinal: c.ordinal,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
      try {
        await this.store.replaceNoteIndex(note.path, textChunks, embeddedChunks);
        chunksInserted += textChunks.length;
        vectorChunksInserted += embeddedChunks.length;
      } catch (err) {
        storeFailures += 1;
        errors.push({
          path: note.path,
          ordinal: -1,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      notes: notes.length,
      chunksAttempted,
      chunksInserted,
      vectorChunksInserted,
      vectorStatus: vectorStatusForReport({
        chunksAttempted,
        chunksInserted,
        vectorChunksInserted,
        unavailableFailures,
        providerFailures,
        storeFailures,
      }),
      chunksSkipped,
      errors,
      embeddingModel: this.embedder.modelId,
      startedAt,
      finishedAt: Date.now(),
    };
  }

  async indexOneNote(
    note: NoteInput,
    options: IndexerOptions = {},
  ): Promise<IndexerReport> {
    return this.indexNotes([note], options);
  }

  async deleteNote(notePath: string): Promise<void> {
    await this.store.deleteNote(notePath);
  }
}

function vectorStatusForReport(input: {
  chunksAttempted: number;
  chunksInserted: number;
  vectorChunksInserted: number;
  unavailableFailures: number;
  providerFailures: number;
  storeFailures: number;
}): ProviderStatus {
  if (input.storeFailures > 0) return 'failed';
  if (
    input.chunksInserted > 0 &&
    input.vectorChunksInserted === input.chunksInserted &&
    input.chunksInserted === input.chunksAttempted
  ) {
    return 'ok';
  }
  if (input.vectorChunksInserted > 0) return 'degraded';
  if (input.providerFailures > 0) return 'failed';
  return 'unavailable';
}

function isProviderUnavailable(error: unknown): boolean {
  const record = isRecord(error) ? error : {};
  const cause = isRecord(record.cause) ? record.cause : {};
  const code = String(record.code ?? cause.code ?? '').toUpperCase();
  const name = String(record.name ?? '').toLowerCase();
  const causeName = String(cause.name ?? '').toLowerCase();
  const message = `${String(record.message ?? '')} ${String(cause.message ?? '')}`.toLowerCase();
  return (
    name === 'networkerror' ||
    causeName === 'networkerror' ||
    name === 'providerunavailableerror' ||
    causeName === 'providerunavailableerror' ||
    ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(code) ||
    /unavailable|not configured|fetch failed|connection refused|timed out/u.test(message)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
