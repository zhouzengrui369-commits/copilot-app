/**
 * SQLite-backed Knowledge Graph store.
 *
 * `KgStore` owns four tables:
 *   - `kg_nodes`      — entities (person / org / concept / ...)
 *   - `kg_edges`      — relations between entities
 *   - `note_entities` — reverse index: which notes mention each entity
 *   - `kg_tags`       — per-tag note counts (filled in wave 2)
 *
 * Schema is **v0**; migrations go through `./migration.ts`. Cross-Sprint
 * contract — see `SCHEMA-FROZEN-1.2.md` at end of wave 3.
 *
 * Storage location: `<userData>/kg.sqlite` (next to the KB's `kb.sqlite`).
 * Sync model: synchronous SQLite via `better-sqlite3` 11.10.0, WAL mode.
 *
 * KG is 100% local (decision red line #2 in goal.md v6.2). The store never
 * POSTs to any cloud endpoint.
 */

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import type {
  Entity,
  EntityInput,
  EntityType,
  NoteEntityLink,
  Relation,
  RelationInput,
  Tag,
  TagInput,
} from '../types.js';

export const KG_SCHEMA_VERSION = 0;

export const KG_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kg_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT,
  summary TEXT,
  confidence REAL,
  source_notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_type ON kg_nodes(type);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_name ON kg_nodes(name);

CREATE TABLE IF NOT EXISTS kg_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  rel TEXT NOT NULL,
  weight REAL,
  evidence TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (from_entity_id, to_entity_id, rel)
);
CREATE INDEX IF NOT EXISTS idx_kg_edges_from ON kg_edges(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_to ON kg_edges(to_entity_id);

CREATE TABLE IF NOT EXISTS note_entities (
  note_path TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (note_path, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_note_entities_note ON note_entities(note_path);
CREATE INDEX IF NOT EXISTS idx_note_entities_entity ON note_entities(entity_id);

CREATE TABLE IF NOT EXISTS kg_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  note_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kg_tags_name ON kg_tags(name);

CREATE TABLE IF NOT EXISTS note_tags (
  note_path TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  PRIMARY KEY (note_path, tag_name)
);
CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_path);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_name);

CREATE TABLE IF NOT EXISTS kg_schema_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

interface KgNodeRow {
  id: number;
  entity_id: string;
  type: string;
  name: string;
  aliases: string | null;
  summary: string | null;
  confidence: number | null;
  source_notes: string | null;
  created_at: number;
  updated_at: number;
}

interface KgEdgeRow {
  id: number;
  from_entity_id: string;
  to_entity_id: string;
  rel: string;
  weight: number | null;
  evidence: string | null;
  created_at: number;
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToEntity(row: KgNodeRow): Entity {
  return {
    id: row.id,
    entity_id: row.entity_id,
    type: row.type as EntityType,
    name: row.name,
    aliases: parseJsonArray(row.aliases),
    summary: row.summary,
    confidence: row.confidence,
    source_notes: parseJsonArray(row.source_notes),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToRelation(row: KgEdgeRow): Relation {
  return {
    id: row.id,
    from_entity_id: row.from_entity_id,
    to_entity_id: row.to_entity_id,
    rel: row.rel,
    weight: row.weight,
    evidence: parseJsonArray(row.evidence),
    created_at: row.created_at,
  };
}

export interface KgStoreOptions {
  /** Absolute path to the SQLite file. Parent dir is created if missing. */
  dbPath: string;
  /** When true (default), enable WAL mode for concurrent reads. */
  wal?: boolean;
  /** When true (default), apply schema + run pending migrations on open. */
  migrate?: boolean;
}

export interface ReplaceNoteGraphInput {
  note_path: string;
  entities: EntityInput[];
  relations: RelationInput[];
  tags: TagInput[];
  summaries?: ReadonlyMap<string, string>;
}

export interface ReplaceNoteGraphResult {
  entitiesAdded: number;
  relationsAdded: number;
  tagsAdded: number;
}

export class KgStore {
  private db: DatabaseType;
  private closed = false;
  private readonly migratorRan: boolean;

  constructor(opts: KgStoreOptions) {
    const { dbPath, wal = true, migrate = true } = opts;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    if (wal) this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    if (migrate) {
      this.db.exec(KG_SCHEMA_SQL);
      this.ensureSchemaVersion();
      this.migratorRan = true;
    } else {
      this.migratorRan = false;
    }
  }

  /** Native binding handle (used by migration runner + tests). */
  get raw(): DatabaseType {
    return this.db;
  }

  /** Current schema version. */
  get schemaVersion(): number {
    const row = this.db
      .prepare<[], { v: string }>(`SELECT v FROM kg_schema_meta WHERE k='version'`)
      .get();
    return row ? Number(row.v) : KG_SCHEMA_VERSION;
  }

  private ensureSchemaVersion(): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO kg_schema_meta (k, v) VALUES ('version', ?)`)
      .run(String(KG_SCHEMA_VERSION));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  /** Execute one local graph mutation atomically. */
  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  // ──────────────────────────────────────────────────────────────────────
  // kg_nodes CRUD
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Upsert an entity keyed by `entity_id`. On conflict: merge aliases and
   * source_notes (deduplicated), update summary only if the new value is
   * non-null and the existing was null. Returns true when a new row was
   * inserted, false on update.
   */
  upsertEntity(input: EntityInput, now: number): { entity: Entity; created: boolean } {
    const existing = this.getEntityByIdString(input.entity_id);
    const mergedAliases = existing
      ? Array.from(new Set([...existing.aliases, ...(input.aliases ?? [])])).filter(Boolean)
      : Array.from(new Set([...(input.aliases ?? [])])).filter(Boolean);

    let mergedSourceNotes: string[];
    let summary: string | null;
    let confidence: number | null;

    if (existing) {
      const existingNotes = new Set(existing.source_notes);
      existingNotes.add(input.source_note);
      mergedSourceNotes = [...existingNotes];
      summary = input.summary ?? existing.summary ?? null;
      // Confidence: take the max if both present.
      if (existing.confidence != null && input.confidence != null) {
        confidence = Math.max(existing.confidence, input.confidence);
      } else {
        confidence = existing.confidence ?? input.confidence ?? null;
      }
    } else {
      mergedSourceNotes = [input.source_note];
      summary = input.summary ?? null;
      confidence = input.confidence ?? null;
    }

    const aliasesJson = JSON.stringify(mergedAliases);
    const sourceNotesJson = JSON.stringify(mergedSourceNotes);

    if (existing) {
      this.db
        .prepare(
          `UPDATE kg_nodes SET aliases = ?, summary = ?, confidence = ?, source_notes = ?, updated_at = ? WHERE entity_id = ?`,
        )
        .run(aliasesJson, summary, confidence, sourceNotesJson, now, input.entity_id);
      const updated = this.getEntityByIdString(input.entity_id);
      if (!updated) throw new Error('KgStore.upsertEntity: missing after update');
      return { entity: updated, created: false };
    }

    const info = this.db
      .prepare(
        `INSERT INTO kg_nodes (entity_id, type, name, aliases, summary, confidence, source_notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.entity_id,
        String(input.type),
        input.name,
        aliasesJson,
        summary,
        confidence,
        sourceNotesJson,
        now,
        now,
      );
    const row = this.db
      .prepare<[number | bigint], KgNodeRow>(`SELECT * FROM kg_nodes WHERE id = ?`)
      .get(info.lastInsertRowid);
    if (!row) throw new Error('KgStore.upsertEntity: row missing after insert');
    return { entity: rowToEntity(row), created: true };
  }

  getEntityByIdString(entity_id: string): Entity | null {
    const row = this.db
      .prepare<[string], KgNodeRow>(`SELECT * FROM kg_nodes WHERE entity_id = ?`)
      .get(entity_id);
    return row ? rowToEntity(row) : null;
  }

  getEntityById(id: number): Entity | null {
    const row = this.db
      .prepare<[number], KgNodeRow>(`SELECT * FROM kg_nodes WHERE id = ?`)
      .get(id);
    return row ? rowToEntity(row) : null;
  }

  listNodes(filter?: { type?: EntityType }): Entity[] {
    const rows = filter?.type
      ? this.db
          .prepare<[string], KgNodeRow>(
            `SELECT * FROM kg_nodes WHERE type = ? ORDER BY name ASC`,
          )
          .all(filter.type)
      : this.db
          .prepare<[], KgNodeRow>(`SELECT * FROM kg_nodes ORDER BY name ASC`)
          .all();
    return rows.map(rowToEntity);
  }

  countNodes(filter?: { type?: EntityType }): number {
    const row = filter?.type
      ? this.db
          .prepare<[string], { c: number }>(`SELECT COUNT(*) AS c FROM kg_nodes WHERE type = ?`)
          .get(filter.type)
      : this.db
          .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM kg_nodes`)
          .get();
    return row?.c ?? 0;
  }

  // ──────────────────────────────────────────────────────────────────────
  // kg_edges CRUD
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Upsert a relation. Unique key = (from_entity_id, to_entity_id, rel) —
   * enforced by `UNIQUE (from_entity_id, to_entity_id, rel)` + `INSERT OR
   * IGNORE` semantics (a sibling surrogate `id` is kept for cheap updates).
   *
   * On conflict: merge evidence (dedup), bump weight to max, created_at is
   * NOT touched (relation's "first-seen" semantic).
   */
  upsertRelation(input: RelationInput, now: number): { relation: Relation; created: boolean } {
    const inserted = this.db
      .prepare(
        `INSERT OR IGNORE INTO kg_edges (from_entity_id, to_entity_id, rel, weight, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.from_entity_id,
        input.to_entity_id,
        input.rel,
        input.weight ?? null,
        JSON.stringify([input.evidence_note]),
        now,
      );

    if (inserted.changes > 0) {
      const row = this.db
        .prepare<[number | bigint], KgEdgeRow>(`SELECT * FROM kg_edges WHERE id = ?`)
        .get(inserted.lastInsertRowid);
      if (!row) throw new Error('KgStore.upsertRelation: missing after insert');
      return { relation: rowToRelation(row), created: true };
    }

    // Conflict — merge into the existing row.
    const existing = this.db
      .prepare<
        [string, string, string],
        KgEdgeRow
      >(`SELECT * FROM kg_edges WHERE from_entity_id = ? AND to_entity_id = ? AND rel = ?`)
      .get(input.from_entity_id, input.to_entity_id, input.rel);
    if (!existing) throw new Error('KgStore.upsertRelation: conflict path but row missing');

    const evidence = parseJsonArray(existing.evidence);
    if (!evidence.includes(input.evidence_note)) evidence.push(input.evidence_note);
    const weight =
      existing.weight != null && input.weight != null
        ? Math.max(existing.weight, input.weight)
        : (existing.weight ?? input.weight ?? null);
    this.db
      .prepare(`UPDATE kg_edges SET evidence = ?, weight = ? WHERE id = ?`)
      .run(JSON.stringify(evidence), weight, existing.id);
    const refreshed = this.db
      .prepare<[number], KgEdgeRow>(`SELECT * FROM kg_edges WHERE id = ?`)
      .get(existing.id);
    if (!refreshed) throw new Error('KgStore.upsertRelation: missing after update');
    return { relation: rowToRelation(refreshed), created: false };
  }

  listEdges(): Relation[] {
    const rows = this.db
      .prepare<[], KgEdgeRow>(`SELECT * FROM kg_edges ORDER BY created_at ASC`)
      .all();
    return rows.map(rowToRelation);
  }

  countEdges(): number {
    const row = this.db
      .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM kg_edges`)
      .get();
    return row?.c ?? 0;
  }

  edgesFrom(entity_id: string): Relation[] {
    const rows = this.db
      .prepare<[string], KgEdgeRow>(
        `SELECT * FROM kg_edges WHERE from_entity_id = ? ORDER BY created_at ASC`,
      )
      .all(entity_id);
    return rows.map(rowToRelation);
  }

  edgesTo(entity_id: string): Relation[] {
    const rows = this.db
      .prepare<[string], KgEdgeRow>(
        `SELECT * FROM kg_edges WHERE to_entity_id = ? ORDER BY created_at ASC`,
      )
      .all(entity_id);
    return rows.map(rowToRelation);
  }

  // ──────────────────────────────────────────────────────────────────────
  // note_entities (bridge table)
  // ──────────────────────────────────────────────────────────────────────

  linkNoteEntity(note_path: string, entity_id: string): boolean {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO note_entities (note_path, entity_id) VALUES (?, ?)`,
      )
      .run(note_path, entity_id);
    return info.changes > 0;
  }

  /**
   * Replace the set of entity links for a note in one transaction.
   * Used by `IncrementalRunner` when a note is updated and some entities
   * no longer apply.
   */
  setNoteEntities(note_path: string, entity_ids: string[]): NoteEntityLink[] {
    const tx = this.db.transaction((path: string, ids: string[]) => {
      this.db.prepare(`DELETE FROM note_entities WHERE note_path = ?`).run(path);
      const ins = this.db.prepare(
        `INSERT INTO note_entities (note_path, entity_id) VALUES (?, ?)`,
      );
      for (const eid of ids) ins.run(path, eid);
    });
    tx(note_path, entity_ids);
    return entity_ids.map((entity_id) => ({ note_path, entity_id }));
  }

  entitiesForNote(note_path: string): Entity[] {
    const rows = this.db
      .prepare<[string], KgNodeRow>(
        `SELECT n.* FROM kg_nodes n
         INNER JOIN note_entities ne ON ne.entity_id = n.entity_id
         WHERE ne.note_path = ?
         ORDER BY n.name ASC`,
      )
      .all(note_path);
    return rows.map(rowToEntity);
  }

  notesForEntity(entity_id: string): string[] {
    const rows = this.db
      .prepare<[string], { note_path: string }>(
        `SELECT note_path FROM note_entities WHERE entity_id = ? ORDER BY note_path ASC`,
      )
      .all(entity_id);
    return rows.map((r) => r.note_path);
  }

  // ──────────────────────────────────────────────────────────────────────
  // kg_tags CRUD (filled in wave 2 — stub here for type completeness)
  // ──────────────────────────────────────────────────────────────────────

  upsertTag(input: TagInput, now: number): { tag: Tag; created: boolean } {
    const existing = this.db
      .prepare<[string], { id: number; name: string; note_count: number; created_at: number }>(
        `SELECT id, name, note_count, created_at FROM kg_tags WHERE name = ?`,
      )
      .get(input.name);
    if (existing) {
      return {
        tag: {
          id: existing.id,
          name: existing.name,
          note_count: existing.note_count,
          created_at: existing.created_at,
        },
        created: false,
      };
    }
    const info = this.db
      .prepare(
        `INSERT INTO kg_tags (name, note_count, created_at) VALUES (?, ?, ?)`,
      )
      .run(input.name, input.note_count ?? 0, now);
    const row = this.db
      .prepare<[number | bigint], { id: number; name: string; note_count: number; created_at: number }>(
        `SELECT id, name, note_count, created_at FROM kg_tags WHERE id = ?`,
      )
      .get(info.lastInsertRowid);
    if (!row) throw new Error('KgStore.upsertTag: missing after insert');
    return {
      tag: {
        id: row.id,
        name: row.name,
        note_count: row.note_count,
        created_at: row.created_at,
      },
      created: true,
    };
  }

  incrementTagCount(name: string, delta: number): void {
    this.db
      .prepare(`UPDATE kg_tags SET note_count = note_count + ? WHERE name = ?`)
      .run(delta, name);
  }

  listTags(): Tag[] {
    const rows = this.db
      .prepare<[], { id: number; name: string; note_count: number; created_at: number }>(
        `SELECT id, name, note_count, created_at FROM kg_tags ORDER BY note_count DESC, name ASC`,
      )
      .all();
    return rows;
  }

  tagsForNote(note_path: string): Tag[] {
    return this.db
      .prepare<[string], Tag>(
        `SELECT t.id, t.name, t.note_count, t.created_at
           FROM kg_tags t
           INNER JOIN note_tags nt ON nt.tag_name = t.name
          WHERE nt.note_path = ?
          ORDER BY t.name ASC`,
      )
      .all(note_path);
  }

  /**
   * Replace one note's complete graph contribution in a single transaction.
   * This prevents stale edges, entity links, summaries, or tag counts after
   * an incremental re-index.
   */
  replaceNoteGraph(input: ReplaceNoteGraphInput, now: number): ReplaceNoteGraphResult {
    if (!input.note_path.trim()) throw new Error('KgStore.replaceNoteGraph: note_path is required');
    return this.transaction(() => {
      const nodesBefore = this.countNodes();
      const edgesBefore = this.countEdges();
      const tagsBefore = this.listTags().length;
      this.detachNote(input.note_path, now);

      const entityIds = new Set<string>();
      for (const entity of input.entities) {
        const summary = input.summaries?.get(entity.entity_id) ?? entity.summary;
        this.upsertEntity({ ...entity, summary, source_note: input.note_path }, now);
        entityIds.add(entity.entity_id);
      }
      this.setNoteEntities(input.note_path, [...entityIds]);

      for (const relation of input.relations) {
        if (!entityIds.has(relation.from_entity_id) || !entityIds.has(relation.to_entity_id)) continue;
        this.upsertRelation({ ...relation, evidence_note: input.note_path }, now);
      }

      const tagNames = new Set(input.tags.map((tag) => tag.name.trim()).filter(Boolean));
      for (const name of tagNames) {
        this.upsertTag({ name }, now);
        this.db
          .prepare(`INSERT OR IGNORE INTO note_tags (note_path, tag_name) VALUES (?, ?)`)
          .run(input.note_path, name);
      }
      this.refreshTagCounts();
      return {
        entitiesAdded: Math.max(0, this.countNodes() - nodesBefore),
        relationsAdded: Math.max(0, this.countEdges() - edgesBefore),
        tagsAdded: Math.max(0, this.listTags().length - tagsBefore),
      };
    });
  }

  /** Remove every persisted contribution owned only by a deleted note. */
  removeNoteGraph(note_path: string, now: number = Date.now()): void {
    if (!note_path.trim()) throw new Error('KgStore.removeNoteGraph: note_path is required');
    this.transaction(() => {
      this.detachNote(note_path, now);
      this.refreshTagCounts();
    });
  }

  private detachNote(note_path: string, now: number): void {
    const oldEntityIds = this.db
      .prepare<[string], { entity_id: string }>(
        `SELECT entity_id FROM note_entities WHERE note_path = ?`,
      )
      .all(note_path)
      .map((row) => row.entity_id);

    this.db.prepare(`DELETE FROM note_entities WHERE note_path = ?`).run(note_path);
    this.db.prepare(`DELETE FROM note_tags WHERE note_path = ?`).run(note_path);

    for (const edge of this.listEdges()) {
      if (!edge.evidence.includes(note_path)) continue;
      const evidence = edge.evidence.filter((path) => path !== note_path);
      if (evidence.length === 0) {
        this.db.prepare(`DELETE FROM kg_edges WHERE id = ?`).run(edge.id);
      } else {
        this.db.prepare(`UPDATE kg_edges SET evidence = ? WHERE id = ?`)
          .run(JSON.stringify(evidence), edge.id);
      }
    }

    for (const entityId of oldEntityIds) {
      const entity = this.getEntityByIdString(entityId);
      if (!entity) continue;
      const sourceNotes = entity.source_notes.filter((path) => path !== note_path);
      if (sourceNotes.length === 0) {
        this.db.prepare(`DELETE FROM kg_edges WHERE from_entity_id = ? OR to_entity_id = ?`)
          .run(entityId, entityId);
        this.db.prepare(`DELETE FROM kg_nodes WHERE entity_id = ?`).run(entityId);
      } else {
        this.db.prepare(`UPDATE kg_nodes SET source_notes = ?, updated_at = ? WHERE entity_id = ?`)
          .run(JSON.stringify(sourceNotes), now, entityId);
      }
    }
  }

  private refreshTagCounts(): void {
    this.db.exec(`
      UPDATE kg_tags
         SET note_count = (
           SELECT COUNT(*) FROM note_tags WHERE note_tags.tag_name = kg_tags.name
         );
      DELETE FROM kg_tags WHERE note_count <= 0;
    `);
  }
}
