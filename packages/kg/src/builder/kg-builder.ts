import type { LLMProvider } from '@copilot/llm-client';
import type {
  KgBuildOptions,
  KgBuildResult,
  KgKnowledgeSource,
  KgNoteBuildResult,
  KgNoteInput,
} from '../types.js';
import type { KgStore } from '../store/sqlite-store.js';
import { EntityExtractor, type EntityExtractorLike } from './entity-extractor.js';
import { RelationExtractor, type RelationExtractorLike } from './relation-extractor.js';
import { Tagger, normalizeTag, type TaggerLike } from './tagger.js';
import { Summarizer, type SummarizerLike } from './summarizer.js';

export interface KgBuilderOptions {
  store: KgStore;
  source?: KgKnowledgeSource;
  provider?: LLMProvider;
  defaultModel?: string;
  entityExtractor?: EntityExtractorLike;
  relationExtractor?: RelationExtractorLike;
  tagger?: TaggerLike;
  summarizer?: SummarizerLike;
  clock?: () => number;
}

/** Local-first LLM WIKI builder with atomic per-note replacement. */
export class KgBuilder {
  private readonly store: KgStore;
  private readonly source?: KgKnowledgeSource;
  private readonly entityExtractor: EntityExtractorLike;
  private readonly relationExtractor: RelationExtractorLike;
  private readonly tagger: TaggerLike;
  private readonly summarizer: SummarizerLike;
  private readonly clock: () => number;

  constructor(options: KgBuilderOptions) {
    this.store = options.store;
    this.source = options.source;
    this.clock = options.clock ?? Date.now;
    const providerOptions = options.provider
      ? { provider: options.provider, defaultModel: options.defaultModel ?? 'MiniMax-M3' }
      : null;
    this.entityExtractor = options.entityExtractor ?? requireProvider(
      providerOptions,
      (value) => new EntityExtractor(value),
      'entityExtractor',
    );
    this.relationExtractor = options.relationExtractor ?? requireProvider(
      providerOptions,
      (value) => new RelationExtractor(value),
      'relationExtractor',
    );
    this.tagger = options.tagger ?? requireProvider(
      providerOptions,
      (value) => new Tagger(value),
      'tagger',
    );
    this.summarizer = options.summarizer ?? requireProvider(
      providerOptions,
      (value) => new Summarizer(value),
      'summarizer',
    );
  }

  async buildNote(
    note: KgNoteInput,
    options: KgBuildOptions = {},
    signal?: AbortSignal,
  ): Promise<KgNoteBuildResult> {
    const started = this.clock();
    if (!note.path.trim()) throw new Error('KgBuilder.buildNote: note path is required');
    const hasContent = Boolean(note.title.trim() || note.body.trim());
    let entities: Awaited<ReturnType<EntityExtractorLike['extract']>> = [];
    let relations: Awaited<ReturnType<RelationExtractorLike['extract']>> = [];
    let tags = (note.tags ?? []).map((name) => ({ name }));
    let summaries = new Map<string, string>();

    if (!options.skipLlm && hasContent) {
      entities = await this.entityExtractor.extract({
        note_path: note.path,
        note_title: note.title,
        note_body: note.body,
        note_meta: note.metadata,
      }, signal);
      [relations, tags, summaries] = await Promise.all([
        this.relationExtractor.extract({
          note_path: note.path,
          note_title: note.title,
          note_body: note.body,
          entities,
        }, signal),
        this.tagger.extract({
          note_path: note.path,
          note_title: note.title,
          note_body: note.body,
          existing_tags: note.tags,
        }, signal),
        this.summarizer.summarize({
          note_title: note.title,
          note_body: note.body,
          entities,
        }, signal),
      ]);
    }

    tags = tags
      .map((tag) => ({ name: normalizeTag(tag.name) }))
      .filter((tag) => Boolean(tag.name));
    const persisted = this.store.replaceNoteGraph({
      note_path: note.path,
      entities,
      relations,
      tags,
      summaries,
    }, this.clock());
    return {
      note_path: note.path,
      entitiesAdded: persisted.entitiesAdded,
      relationsAdded: persisted.relationsAdded,
      tagsTouched: new Set(tags.map((tag) => tag.name)).size,
      elapsedMs: Math.max(0, this.clock() - started),
      status: 'done',
      entitiesTotal: entities.length,
      relationsTotal: relations.length,
      tagsTotal: tags.length,
    };
  }

  async buildPending(options: KgBuildOptions = {}): Promise<KgBuildResult> {
    if (!this.source) throw new Error('KgBuilder.buildPending: source is required');
    const started = this.clock();
    const pending = this.source.listKgPending('pending').slice(0, options.maxNotes ?? 50);
    const failed: Array<{ path: string; reason: string }> = [];
    let processed = 0;
    let entitiesAdded = 0;
    let relationsAdded = 0;
    let tagsAdded = 0;
    for (const entry of pending) {
      this.source.setKgStatus(entry.note_path, 'processing');
      const controller = new AbortController();
      try {
        const read = this.source.readNote(entry.note_path);
        if (!read) throw new Error('note not found');
        const result = await withTimeout(
          this.buildNote({
            path: read.note.path,
            title: read.note.title,
            body: read.body,
            tags: read.note.tags,
            related: read.note.related,
          }, options, controller.signal),
          options.perNoteTimeoutMs ?? 30_000,
          controller,
        );
        this.source.setKgStatus(entry.note_path, 'done');
        processed += 1;
        entitiesAdded += result.entitiesAdded;
        relationsAdded += result.relationsAdded;
        tagsAdded += result.tagsTouched;
      } catch (error) {
        controller.abort();
        this.source.setKgStatus(entry.note_path, 'failed');
        failed.push({ path: entry.note_path, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return {
      processed,
      failed,
      entitiesAdded,
      relationsAdded,
      tagsAdded,
      elapsedMs: Math.max(0, this.clock() - started),
      nodeCount: this.store.countNodes(),
      edgeCount: this.store.countEdges(),
    };
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('invalid timeout'));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`KG note build timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function requireProvider<T>(
  value: { provider: LLMProvider; defaultModel: string } | null,
  create: (options: { provider: LLMProvider; defaultModel: string }) => T,
  name: string,
): T {
  if (!value) throw new Error(`KgBuilder: ${name} or provider is required`);
  return create(value);
}
