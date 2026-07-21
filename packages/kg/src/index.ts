/**
 * @copilot/kg — public package surface (Sprint 1.2 T-1.2.1 wave 1+).
 *
 * Cross-Sprint contract (see `SCHEMA-FROZEN-1.2.md` at end of wave 3):
 *   wave 1: `KgStore` + `EntityExtractor` + KB bridge primitives
 *   wave 2: `RelationExtractor` + `Tagger` + `Summarizer`
 *   wave 3: `KgBuilder` + `IncrementalRunner` + `queryKg` + Electron
 *           integration + performance baseline.
 *
 * KG is 100% local (decision red line #2 in goal.md v6.2). LLM calls go
 * through `@copilot/llm-client` directly to the local MiniMax-M3 endpoint;
 * nothing is sent to the Tencent cloud server.
 *
 * Usage:
 *   import { KgStore, EntityExtractor } from '@copilot/kg';
 *
 *   const kg = new KgStore({ dbPath: '/abs/kg.sqlite' });
 *   const extractor = new EntityExtractor({ provider: llm.provider, defaultModel: 'MiniMax-M3' });
 *   const entities = await extractor.extract({ note_path, note_title, note_body });
 *   for (const e of entities) kg.upsertEntity(e, Date.now());
 */

export { KgStore, KG_SCHEMA_SQL, KG_SCHEMA_VERSION } from './store/sqlite-store.js';
export type {
  KgStoreOptions,
  ReplaceNoteGraphInput,
  ReplaceNoteGraphResult,
} from './store/sqlite-store.js';

export { runKgMigrations, KG_MIGRATIONS } from './store/migration.js';
export type { KgMigrationStep } from './store/migration.js';

export { EntityExtractor } from './builder/entity-extractor.js';
export type { EntityExtractInput, EntityExtractorLike } from './builder/entity-extractor.js';

export { RelationExtractor } from './builder/relation-extractor.js';
export type { RelationExtractInput, RelationExtractorLike } from './builder/relation-extractor.js';

export { Tagger, normalizeTag } from './builder/tagger.js';
export type { TaggerExtractInput, TaggerLike } from './builder/tagger.js';

export { Summarizer } from './builder/summarizer.js';
export type { SummarizeInput, SummarizerLike } from './builder/summarizer.js';

export { KgBuilder } from './builder/kg-builder.js';
export type { KgBuilderOptions } from './builder/kg-builder.js';

export { KgQuery, queryKg } from './api/query.js';

export type {
  EntityType,
  Entity,
  EntityInput,
  RelationType,
  Relation,
  RelationInput,
  Tag,
  TagInput,
  NoteEntityLink,
  KgBuildOptions,
  KgBuildResult,
  KgBuildError,
  KgNoteInput,
  KgNoteBuildResult,
  KgKnowledgeSource,
  IncrementalStats,
  QueryRequest,
  QueryResult,
  Subgraph,
  SearchNodesOptions,
} from './types.js';
