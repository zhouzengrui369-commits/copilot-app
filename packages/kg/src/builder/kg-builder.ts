import type { ChatRequest, ChatResponse, LLMProvider } from '@copilot/llm-client';
import type {
  EntityInput,
  KgBuildOptions,
  KgBuildResult,
  KgKnowledgeSource,
  KgNoteBuildResult,
  KgNoteInput,
  RelationInput,
  TagInput,
  WikiFailureStage,
  WikiProjection,
} from '../types.js';
import type { KgStore } from '../store/sqlite-store.js';
import { EntityExtractor, type EntityExtractorLike } from './entity-extractor.js';
import { RelationExtractor, type RelationExtractorLike } from './relation-extractor.js';
import { Tagger, normalizeTag, type TaggerLike } from './tagger.js';
import {
  NoteSummarizer,
  NoteSummaryParseError,
  Summarizer,
  type NoteSummarizerLike,
  type NoteSummaryOutput,
  type SummarizerLike,
} from './summarizer.js';

export interface KgBuilderOptions {
  store: KgStore;
  source?: KgKnowledgeSource;
  provider?: LLMProvider;
  defaultModel?: string;
  entityExtractor?: EntityExtractorLike;
  relationExtractor?: RelationExtractorLike;
  tagger?: TaggerLike;
  summarizer?: SummarizerLike;
  noteSummarizer?: NoteSummarizerLike;
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
  private readonly noteSummarizer: NoteSummarizerLike;
  private readonly clock: () => number;
  private readonly providerName: string;
  private readonly defaultModel: string;

  constructor(options: KgBuilderOptions) {
    this.store = options.store;
    this.source = options.source;
    this.clock = options.clock ?? Date.now;
    this.providerName = options.provider?.name ?? 'injected';
    this.defaultModel = options.defaultModel ?? 'MiniMax-M3';
    const providerOptions = options.provider
      ? {
          provider: options.provider,
          defaultModel: this.defaultModel,
        }
      : null;
    this.entityExtractor = options.entityExtractor ?? requireProvider(
      providerOptions,
      (value) => new EntityExtractor({
        ...value,
        provider: withWikiSchemaValidation(value.provider, 'entities'),
      }),
      'entityExtractor',
    );
    this.relationExtractor = options.relationExtractor ?? requireProvider(
      providerOptions,
      (value) => new RelationExtractor({
        ...value,
        provider: withWikiSchemaValidation(value.provider, 'relations'),
      }),
      'relationExtractor',
    );
    this.tagger = options.tagger ?? requireProvider(
      providerOptions,
      (value) => new Tagger({
        ...value,
        provider: withWikiSchemaValidation(value.provider, 'tags'),
      }),
      'tagger',
    );
    this.summarizer = options.summarizer ?? requireProvider(
      providerOptions,
      (value) => new Summarizer({
        ...value,
        provider: withWikiSchemaValidation(value.provider, 'entity-summaries'),
      }),
      'summarizer',
    );
    this.noteSummarizer = options.noteSummarizer ?? (
      providerOptions
        ? new NoteSummarizer(providerOptions)
        : {
            summarizeNote: async () => {
              throw new Error('WIKI_NOTE_SUMMARIZER_UNAVAILABLE');
            },
          }
    );
  }

  async buildNote(
    note: KgNoteInput,
    options: KgBuildOptions = {},
    signal?: AbortSignal,
  ): Promise<KgNoteBuildResult> {
    const started = this.clock();
    if (!note.path.trim()) throw new Error('KgBuilder.buildNote: note path is required');
    const contentDigest = this.store.computeNoteContentDigest({
      title: note.title,
      body: note.body,
      tags: note.tags,
      metadata: digestMetadata(note),
    });
    const cached = this.store.findCurrentWikiProjection(note.path, contentDigest);
    if (cached) {
      return currentBuildResult(cached, started, this.clock());
    }

    const hasContent = Boolean(note.title.trim() || note.body.trim());
    if (options.skipLlm || !hasContent) {
      return this.persistFailedBuild(
        note,
        contentDigest,
        options.skipLlm ? 'provider' : 'parse',
        options.skipLlm ? 'WIKI_PROVIDER_SKIPPED' : 'WIKI_EMPTY_NOTE',
        started,
      );
    }

    let entities: Awaited<ReturnType<EntityExtractorLike['extract']>> = [];
    let relations: Awaited<ReturnType<RelationExtractorLike['extract']>> = [];
    let tags = (note.tags ?? []).map((name) => ({ name }));
    let summaries = new Map<string, string>();
    let noteSummary: NoteSummaryOutput;
    try {
      entities = await this.entityExtractor.extract({
        note_path: note.path,
        note_title: note.title,
        note_body: note.body,
        note_meta: note.metadata,
      }, signal);
      [relations, tags, summaries, noteSummary] = await Promise.all([
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
        this.noteSummarizer.summarizeNote({
          note_path: note.path,
          note_title: note.title,
          note_body: note.body,
          existing_tags: note.tags,
          note_meta: digestMetadata(note),
        }, signal),
      ]);
      validateProjectionParts(entities, relations, tags, summaries, noteSummary, note.path);
    } catch (error) {
      const stage = projectionFailureStage(error);
      return this.persistFailedBuild(
        note,
        contentDigest,
        stage,
        stage === 'parse' ? 'WIKI_SCHEMA_VALIDATION_FAILED' : 'WIKI_PROVIDER_FAILED',
        started,
      );
    }

    tags = tags
      .map((tag) => ({ name: normalizeTag(tag.name) }))
      .filter((tag) => Boolean(tag.name));
    const generatedAt = this.clock();
    let committed: {
      graph: ReturnType<KgStore['replaceNoteGraph']>;
      wiki: ReturnType<KgStore['upsertWikiProjection']>;
    };
    try {
      committed = this.store.transaction(() => {
        const graph = this.store.replaceNoteGraph({
          note_path: note.path,
          entities,
          relations,
          tags,
          summaries,
        }, generatedAt);
        const wiki = this.store.upsertWikiProjection({
          note_path: note.path,
          content_digest: contentDigest,
          summary: noteSummary.summary,
          tags: tags.map((tag) => tag.name),
          entity_ids: entities.map((entity) => entity.entity_id),
          relation_signatures: relations.map(relationSignature),
          provenance: {
            provider: noteSummary.provider,
            model: noteSummary.model,
            generated_at: generatedAt,
          },
          status: 'current',
        }, generatedAt);
        return { graph, wiki };
      });
    } catch {
      return this.persistFailedBuild(
        note,
        contentDigest,
        'persist',
        'WIKI_PERSIST_FAILED',
        started,
      );
    }
    return {
      note_path: note.path,
      entitiesAdded: committed.graph.entitiesAdded,
      relationsAdded: committed.graph.relationsAdded,
      tagsTouched: new Set(tags.map((tag) => tag.name)).size,
      elapsedMs: Math.max(0, this.clock() - started),
      status: 'done',
      entitiesTotal: entities.length,
      relationsTotal: relations.length,
      tagsTotal: tags.length,
      wiki: wikiBuildOutcome(committed.wiki.projection, {
        isCurrent: committed.wiki.isCurrent,
        priorMarkedStale: committed.wiki.priorMarkedStale,
      }),
    };
  }

  private persistFailedBuild(
    note: KgNoteInput,
    contentDigest: string,
    stage: WikiFailureStage,
    reason: string,
    started: number,
  ): KgNoteBuildResult {
    const generatedAt = this.clock();
    let failed: ReturnType<KgStore['upsertWikiProjection']>;
    try {
      failed = this.store.upsertWikiProjection({
        note_path: note.path,
        content_digest: contentDigest,
        summary: null,
        tags: [],
        entity_ids: [],
        relation_signatures: [],
        provenance: {
          provider: this.providerName,
          model: this.defaultModel,
          generated_at: generatedAt,
        },
        status: 'failed',
        failure_reason: reason,
        failure_stage: stage,
      }, generatedAt);
    } catch (error) {
      throw new Error(
        `KgBuilder.buildNote: ${reason}; failed projection could not be persisted`,
        { cause: error },
      );
    }
    return {
      note_path: note.path,
      entitiesAdded: 0,
      relationsAdded: 0,
      tagsTouched: 0,
      elapsedMs: Math.max(0, this.clock() - started),
      status: 'failed',
      reason,
      entitiesTotal: 0,
      relationsTotal: 0,
      tagsTotal: 0,
      wiki: wikiBuildOutcome(failed.projection, {
        isCurrent: false,
        priorMarkedStale: failed.priorMarkedStale,
      }),
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
        if (result.status === 'failed') {
          this.source.setKgStatus(entry.note_path, 'failed');
          failed.push({
            path: entry.note_path,
            reason: result.reason ?? 'WIKI_PROJECTION_FAILED',
          });
          continue;
        }
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

class ProjectionSchemaError extends Error {
  override readonly name = 'ProjectionSchemaError';
}

function projectionFailureStage(error: unknown): WikiFailureStage {
  return error instanceof NoteSummaryParseError || error instanceof ProjectionSchemaError
    ? 'parse'
    : 'provider';
}

function digestMetadata(note: KgNoteInput): Record<string, unknown> {
  return {
    ...(note.metadata ?? {}),
    related: [...(note.related ?? [])].map(String).sort(),
  };
}

function currentBuildResult(
  projection: WikiProjection,
  started: number,
  finished: number,
): KgNoteBuildResult {
  return {
    note_path: projection.note_path,
    entitiesAdded: 0,
    relationsAdded: 0,
    tagsTouched: 0,
    elapsedMs: Math.max(0, finished - started),
    status: 'done',
    entitiesTotal: projection.entity_ids.length,
    relationsTotal: projection.relation_signatures.length,
    tagsTotal: projection.tags.length,
    wiki: wikiBuildOutcome(projection, {
      isCurrent: false,
      priorMarkedStale: 0,
    }),
  };
}

function wikiBuildOutcome(
  projection: WikiProjection,
  receipt: { isCurrent: boolean; priorMarkedStale: number },
): KgNoteBuildResult['wiki'] {
  return {
    truth: projection.status === 'current' ? 'current' : 'failed',
    content_digest: projection.content_digest,
    projection_id: projection.id,
    provider: projection.provider,
    model: projection.model,
    generated_at: projection.generated_at,
    is_current: projection.status === 'current',
    inserted_current: receipt.isCurrent,
    prior_marked_stale: receipt.priorMarkedStale,
  };
}

function relationSignature(relation: RelationInput): string {
  return `${relation.from_entity_id}|${relation.rel}|${relation.to_entity_id}`;
}

function validateProjectionParts(
  entities: EntityInput[],
  relations: RelationInput[],
  tags: TagInput[],
  summaries: Map<string, string>,
  noteSummary: NoteSummaryOutput,
  notePath: string,
): void {
  if (!Array.isArray(entities) || !Array.isArray(relations) || !Array.isArray(tags)) {
    throw new ProjectionSchemaError('WIKI_COLLECTION_SCHEMA_INVALID');
  }
  const entityIds = new Set<string>();
  for (const entity of entities) {
    if (
      !entity ||
      typeof entity.entity_id !== 'string' ||
      !entity.entity_id.trim() ||
      typeof entity.name !== 'string' ||
      !entity.name.trim() ||
      entity.source_note !== notePath ||
      entityIds.has(entity.entity_id)
    ) {
      throw new ProjectionSchemaError('WIKI_ENTITY_SCHEMA_INVALID');
    }
    entityIds.add(entity.entity_id);
  }
  for (const relation of relations) {
    if (
      !relation ||
      !entityIds.has(relation.from_entity_id) ||
      !entityIds.has(relation.to_entity_id) ||
      relation.from_entity_id === relation.to_entity_id ||
      typeof relation.rel !== 'string' ||
      !relation.rel.trim()
    ) {
      throw new ProjectionSchemaError('WIKI_RELATION_SCHEMA_INVALID');
    }
  }
  for (const tag of tags) {
    if (!tag || typeof tag.name !== 'string' || !normalizeTag(tag.name)) {
      throw new ProjectionSchemaError('WIKI_TAG_SCHEMA_INVALID');
    }
  }
  if (!(summaries instanceof Map)) {
    throw new ProjectionSchemaError('WIKI_ENTITY_SUMMARY_SCHEMA_INVALID');
  }
  for (const [entityId, summary] of summaries) {
    if (
      !entityIds.has(entityId) ||
      typeof summary !== 'string' ||
      !summary.trim()
    ) {
      throw new ProjectionSchemaError('WIKI_ENTITY_SUMMARY_SCHEMA_INVALID');
    }
  }
  if (
    !noteSummary ||
    typeof noteSummary.summary !== 'string' ||
    noteSummary.summary.trim().length === 0 ||
    [...noteSummary.summary].length > 240 ||
    typeof noteSummary.provider !== 'string' ||
    !noteSummary.provider.trim() ||
    typeof noteSummary.model !== 'string' ||
    !noteSummary.model.trim()
  ) {
    throw new ProjectionSchemaError('WIKI_NOTE_SUMMARY_SCHEMA_INVALID');
  }
}

type ProjectionProviderSchema = 'entities' | 'relations' | 'tags' | 'entity-summaries';

function withWikiSchemaValidation(
  provider: LLMProvider,
  schema: ProjectionProviderSchema,
): LLMProvider {
  return {
    name: provider.name,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const response = await provider.chat(request);
      validateProviderResponse(schema, response);
      return response;
    },
    chatStream: (request) => provider.chatStream(request),
    countTokens: (messages) => provider.countTokens(messages),
  };
}

function validateProviderResponse(
  schema: ProjectionProviderSchema,
  response: ChatResponse,
): void {
  if (response.finishReason !== 'stop' || !response.model.trim()) {
    throw new ProjectionSchemaError('WIKI_PROVIDER_RESPONSE_INCOMPLETE');
  }
  if (schema === 'entities') {
    const rows = parseProviderJson(response.content, '[', ']');
    if (
      !Array.isArray(rows) ||
      !rows.every((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const row = value as Record<string, unknown>;
        return (
          typeof row['type'] === 'string' &&
          typeof row['name'] === 'string' &&
          row['name'].trim().length > 0 &&
          typeof row['confidence'] === 'number' &&
          Number.isFinite(row['confidence']) &&
          row['confidence'] >= 0 &&
          row['confidence'] <= 1 &&
          (row['aliases'] === undefined ||
            (Array.isArray(row['aliases']) &&
              row['aliases'].every((alias) => typeof alias === 'string')))
        );
      })
    ) {
      throw new ProjectionSchemaError('WIKI_ENTITY_PROVIDER_SCHEMA_INVALID');
    }
    return;
  }
  if (schema === 'relations') {
    const rows = parseProviderJson(response.content, '[', ']');
    if (
      !Array.isArray(rows) ||
      !rows.every((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const row = value as Record<string, unknown>;
        const from = row['from_entity_id'] ?? row['from'];
        const to = row['to_entity_id'] ?? row['to'];
        return (
          typeof from === 'string' &&
          from.trim().length > 0 &&
          typeof to === 'string' &&
          to.trim().length > 0 &&
          typeof row['rel'] === 'string' &&
          row['rel'].trim().length > 0 &&
          (row['weight'] === undefined ||
            (typeof row['weight'] === 'number' && Number.isFinite(row['weight'])))
        );
      })
    ) {
      throw new ProjectionSchemaError('WIKI_RELATION_PROVIDER_SCHEMA_INVALID');
    }
    return;
  }
  if (schema === 'tags') {
    const rows = parseProviderJson(response.content, '[', ']');
    if (
      !Array.isArray(rows) ||
      rows.length > 8 ||
      !rows.every(
        (value) =>
          (typeof value === 'string' && value.trim().length > 0) ||
          (Boolean(value) &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            typeof (value as Record<string, unknown>)['name'] === 'string' &&
            ((value as Record<string, unknown>)['name'] as string).trim().length > 0),
      )
    ) {
      throw new ProjectionSchemaError('WIKI_TAG_PROVIDER_SCHEMA_INVALID');
    }
    return;
  }
  if (schema === 'entity-summaries') {
    const value = parseProviderJson(response.content, '{', '}');
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !Object.values(value as Record<string, unknown>).every(
        (summary) => typeof summary === 'string' && summary.trim().length > 0,
      )
    ) {
      throw new ProjectionSchemaError('WIKI_ENTITY_SUMMARY_PROVIDER_SCHEMA_INVALID');
    }
  }
}

function parseProviderJson(raw: string, open: '[' | '{', close: ']' | '}'): unknown {
  if (!raw.trim()) throw new ProjectionSchemaError('WIKI_PROVIDER_JSON_EMPTY');
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) text = fenced.trim();
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start < 0 || end <= start) {
    throw new ProjectionSchemaError('WIKI_PROVIDER_JSON_MISSING');
  }
  try {
    return JSON.parse(text.slice(start, end + 1).replace(/,\s*([\]}])/g, '$1'));
  } catch {
    throw new ProjectionSchemaError('WIKI_PROVIDER_JSON_INVALID');
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
