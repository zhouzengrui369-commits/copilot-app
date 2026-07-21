// 2026-07-02 — R5B-1: mobile recorder storage helpers.
// Pure DB-only module. No Fastify request/reply imports.
// Wire-up to HTTP routes happens in R5B-2 (apps/server/src/index.ts).

import { randomUUID } from "node:crypto";
import { nowIso } from "./config.js";
import type { Db } from "./db.js";

// ---------------------------------------------------------------------------
// Row shapes (mirror the schema in db.ts)
// ---------------------------------------------------------------------------

export type MobileRecordingSessionStatus =
  | "recording"
  | "paused"
  | "stopped"
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled";

export type MobileTranscriptSegmentSource = "stt" | "manual" | "hybrid";

export type MobileIngestionJobTarget =
  | "stt"
  | "knowledge"
  | "calendar"
  | "summary"
  | "summary_then_calendar"
  | "summary_then_knowledge";

export type MobileIngestionJobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "cancelled";

export type MobileRecordingSessionRow = {
  id: string;
  device_id: string;
  title: string;
  status: MobileRecordingSessionStatus | string;
  scene: string;
  language: string;
  network: string;
  battery_level: number | null;
  retention_hours: number;
  audio_dir: string;
  source: string;
  sample_rate: number;
  channel_count: number;
  duration_ms: number;
  total_chunks: number;
  total_bytes: number;
  last_segment_at: string | null;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
  completed_at: string | null;
  error: string;
  knowledge_entry_id: string | null;
  metadata: string;
};

export type MobileTranscriptSegmentRow = {
  id: string;
  session_id: string;
  device_id: string;
  segment_index: number;
  chunk_index: number;
  chunk_hash: string;
  text: string;
  status: string;
  start_ms: number;
  end_ms: number;
  language: string;
  source: MobileTranscriptSegmentSource | string;
  provider: string;
  confidence: number;
  audio_path: string;
  audio_mime: string;
  audio_bytes: number;
  created_at: string;
  updated_at: string;
  error: string;
  metadata: string;
};

export type MobileIngestionJobRow = {
  id: string;
  session_id: string;
  device_id: string;
  target: MobileIngestionJobTarget | string;
  status: MobileIngestionJobStatus | string;
  knowledge_entry_id: string | null;
  calendar_note_id: string | null;
  markdown_path: string;
  html_path: string;
  attempts: number;
  max_attempts: number;
  last_error: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  payload: string;
  result: string;
  rollback_ref: string;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Sanitizers — JSON-parse metadata, normalize nulls, drop empty strings where
// the SQL column is nullable. Keep the public shape close to the row shape so
// HTTP layers don't need to re-normalize.
// ---------------------------------------------------------------------------

function safeJsonParse(text: string | null | undefined, fallback: unknown = {}) {
  if (text == null || text === "") return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function sanitizeMobileRecordingSession(row: MobileRecordingSessionRow | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id,
    title: row.title || "",
    status: row.status || "recording",
    scene: row.scene || "",
    language: row.language || "zh-CN",
    network: row.network || "",
    batteryLevel: row.battery_level == null ? null : Number(row.battery_level),
    retentionHours: Number(row.retention_hours || 24),
    audioDir: row.audio_dir || "",
    source: row.source || "mobile_app",
    sampleRate: Number(row.sample_rate || 0),
    channelCount: Number(row.channel_count || 0),
    durationMs: Number(row.duration_ms || 0),
    totalChunks: Number(row.total_chunks || 0),
    totalBytes: Number(row.total_bytes || 0),
    lastSegmentAt: row.last_segment_at || null,
    startedAt: row.started_at,
    endedAt: row.ended_at || null,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    error: row.error || "",
    knowledgeEntryId: row.knowledge_entry_id || null,
    metadata: safeJsonParse(row.metadata, {}),
  };
}

export function sanitizeMobileTranscriptSegment(row: MobileTranscriptSegmentRow | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    deviceId: row.device_id || "",
    segmentIndex: Number(row.segment_index || 0),
    chunkIndex: Number(row.chunk_index || 0),
    chunkHash: row.chunk_hash || "",
    text: row.text || "",
    status: row.status || "partial",
    startMs: Number(row.start_ms || 0),
    endMs: Number(row.end_ms || 0),
    language: row.language || "zh-CN",
    source: row.source || "stt",
    provider: row.provider || "",
    confidence: Number(row.confidence || 0),
    audioPath: row.audio_path || "",
    audioMime: row.audio_mime || "",
    audioBytes: Number(row.audio_bytes || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error || "",
    metadata: safeJsonParse(row.metadata, {}),
  };
}

export function sanitizeMobileIngestionJob(row: MobileIngestionJobRow | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    deviceId: row.device_id || "",
    target: row.target,
    status: row.status || "pending",
    knowledgeEntryId: row.knowledge_entry_id || null,
    calendarNoteId: row.calendar_note_id || null,
    markdownPath: row.markdown_path || "",
    htmlPath: row.html_path || "",
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 3),
    lastError: row.last_error || "",
    scheduledAt: row.scheduled_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    payload: safeJsonParse(row.payload, {}),
    result: safeJsonParse(row.result, {}),
    rollbackRef: row.rollback_ref || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type CreateMobileRecordingSessionInput = {
  id?: string;
  deviceId: string;
  title?: string;
  status?: MobileRecordingSessionStatus | string;
  scene?: string;
  language?: string;
  network?: string;
  batteryLevel?: number | null;
  retentionHours?: number;
  audioDir?: string;
  source?: string;
  sampleRate?: number;
  channelCount?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  startedAt?: string;
};

export type UpdateMobileRecordingSessionInput = {
  id: string;
  title?: string;
  status?: MobileRecordingSessionStatus | string;
  scene?: string;
  language?: string;
  network?: string;
  batteryLevel?: number | null;
  retentionHours?: number;
  audioDir?: string;
  sampleRate?: number;
  channelCount?: number;
  durationMs?: number;
  totalChunks?: number;
  totalBytes?: number;
  lastSegmentAt?: string | null;
  endedAt?: string | null;
  completedAt?: string | null;
  error?: string;
  knowledgeEntryId?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateMobileIngestionJobInput = {
  id?: string;
  sessionId: string;
  deviceId?: string;
  target: MobileIngestionJobTarget | string;
  status?: MobileIngestionJobStatus | string;
  attempts?: number;
  maxAttempts?: number;
  scheduledAt?: string | null;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  rollbackRef?: string;
};

export type InsertMobileTranscriptSegmentInput = {
  id?: string;
  sessionId: string;
  deviceId: string;
  segmentIndex: number;
  chunkIndex: number;
  chunkHash: string;
  text?: string;
  status?: string;
  startMs?: number;
  endMs?: number;
  language?: string;
  source?: MobileTranscriptSegmentSource | string;
  provider?: string;
  confidence?: number;
  audioPath?: string;
  audioMime?: string;
  audioBytes?: number;
  metadata?: Record<string, unknown>;
  error?: string;
};

// ---------------------------------------------------------------------------
// CRUD — sessions
// ---------------------------------------------------------------------------

export function createMobileRecordingSession(db: Db, input: CreateMobileRecordingSessionInput) {
  const now = nowIso();
  const row: MobileRecordingSessionRow = {
    id: input.id || randomUUID(),
    device_id: input.deviceId,
    title: input.title || "",
    status: input.status || "recording",
    scene: input.scene || "",
    language: input.language || "zh-CN",
    network: input.network || "",
    battery_level: input.batteryLevel == null ? null : Number(input.batteryLevel),
    retention_hours: Number(input.retentionHours || 24),
    audio_dir: input.audioDir || "",
    source: input.source || "mobile_app",
    sample_rate: Number(input.sampleRate || 0),
    channel_count: Number(input.channelCount || 1),
    duration_ms: Number(input.durationMs || 0),
    total_chunks: 0,
    total_bytes: 0,
    last_segment_at: null,
    started_at: input.startedAt || now,
    ended_at: null,
    updated_at: now,
    completed_at: null,
    error: "",
    knowledge_entry_id: null,
    metadata: JSON.stringify(input.metadata || {}),
  };
  db.prepare(
    `INSERT INTO mobile_recording_sessions (
      id, device_id, title, status, language, source, sample_rate, channel_count,
      scene, network, battery_level, retention_hours, audio_dir,
      duration_ms, total_chunks, total_bytes, last_segment_at, started_at,
      ended_at, updated_at, completed_at, error, knowledge_entry_id, metadata
    ) VALUES (
      @id, @device_id, @title, @status, @language, @source, @sample_rate, @channel_count,
      @scene, @network, @battery_level, @retention_hours, @audio_dir,
      @duration_ms, @total_chunks, @total_bytes, @last_segment_at, @started_at,
      @ended_at, @updated_at, @completed_at, @error, @knowledge_entry_id, @metadata
    )`,
  ).run(row);
  return sanitizeMobileRecordingSession(row);
}

// 2026-07-03 — R7 hardening: the named-param `UPDATE` statement is the single source of
// truth for which columns the binder may pass through to node:sqlite. We rebuild the
// existing DB row by sampling ONLY those columns (never spread `...existing` into the
// binder). This blocks `Unknown named parameter '<X>'` for any column that we add in the
// future (e.g. device_id, started_at, source) without revisiting every UPDATE in this
// file.
const MOBILE_RECORDING_SESSION_UPDATE_PARAM_KEYS = [
  "id",
  "title",
  "status",
  "scene",
  "language",
  "network",
  "battery_level",
  "retention_hours",
  "audio_dir",
  "sample_rate",
  "channel_count",
  "duration_ms",
  "total_chunks",
  "total_bytes",
  "last_segment_at",
  "ended_at",
  "completed_at",
  "error",
  "knowledge_entry_id",
  "metadata",
  "updated_at",
] as const;

export function updateMobileRecordingSession(db: Db, input: UpdateMobileRecordingSessionInput) {
  const existing = getMobileRecordingSessionRow(db, input.id);
  if (!existing) return null;
  const next: MobileRecordingSessionRow = {
    ...existing,
    title: input.title ?? existing.title,
    status: input.status ?? existing.status,
    scene: input.scene ?? existing.scene,
    language: input.language ?? existing.language,
    network: input.network ?? existing.network,
    battery_level: input.batteryLevel === undefined ? existing.battery_level : input.batteryLevel,
    retention_hours: input.retentionHours ?? existing.retention_hours,
    audio_dir: input.audioDir ?? existing.audio_dir,
    sample_rate: input.sampleRate ?? existing.sample_rate,
    channel_count: input.channelCount ?? existing.channel_count,
    duration_ms: input.durationMs ?? existing.duration_ms,
    total_chunks: input.totalChunks ?? existing.total_chunks,
    total_bytes: input.totalBytes ?? existing.total_bytes,
    last_segment_at: input.lastSegmentAt === undefined ? existing.last_segment_at : input.lastSegmentAt,
    ended_at: input.endedAt === undefined ? existing.ended_at : input.endedAt,
    completed_at: input.completedAt === undefined ? existing.completed_at : input.completedAt,
    error: input.error ?? existing.error,
    knowledge_entry_id: input.knowledgeEntryId === undefined ? existing.knowledge_entry_id : input.knowledgeEntryId,
    metadata: input.metadata ? JSON.stringify(input.metadata) : existing.metadata,
    updated_at: nowIso(),
  };
  // Project `next` down to ONLY the columns this UPDATE references. Spreading
  // `...existing` (or any future DB row that adds `device_id`, `source`, `started_at`,
  // etc.) would otherwise leak as extra named parameters into node:sqlite and trigger
  // `Unknown named parameter '<column>'` (the original R7 Mate60 bug).
  const bind: Record<string, string | number | null> = {};
  for (const key of MOBILE_RECORDING_SESSION_UPDATE_PARAM_KEYS) {
    bind[key] = (next as Record<string, string | number | null>)[key];
  }
  db.prepare(
    `UPDATE mobile_recording_sessions SET
      title = @title,
      status = @status,
      scene = @scene,
      language = @language,
      network = @network,
      battery_level = @battery_level,
      retention_hours = @retention_hours,
      audio_dir = @audio_dir,
      sample_rate = @sample_rate,
      channel_count = @channel_count,
      duration_ms = @duration_ms,
      total_chunks = @total_chunks,
      total_bytes = @total_bytes,
      last_segment_at = @last_segment_at,
      ended_at = @ended_at,
      completed_at = @completed_at,
      error = @error,
      knowledge_entry_id = @knowledge_entry_id,
      metadata = @metadata,
      updated_at = @updated_at
     WHERE id = @id`,
  ).run(bind);
  return sanitizeMobileRecordingSession(next);
}

function getMobileRecordingSessionRow(db: Db, id: string) {
  return db
    .prepare(`SELECT * FROM mobile_recording_sessions WHERE id = ?`)
    .get(id) as MobileRecordingSessionRow | undefined;
}

export function getMobileRecordingSession(db: Db, id: string) {
  const row = getMobileRecordingSessionRow(db, id);
  return sanitizeMobileRecordingSession(row);
}

export function listMobileRecordingSessions(db: Db, deviceId: string, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const rows = db.prepare(`
    SELECT *
    FROM mobile_recording_sessions
    WHERE device_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(deviceId, safeLimit) as MobileRecordingSessionRow[];
  return rows.map(sanitizeMobileRecordingSession);
}

// ---------------------------------------------------------------------------
// CRUD — transcript segments
// ---------------------------------------------------------------------------

export function insertMobileTranscriptSegment(db: Db, input: InsertMobileTranscriptSegmentInput) {
  if (input.chunkHash) {
    const existing = db.prepare(`
      SELECT *
      FROM mobile_transcript_segments
      WHERE session_id = ? AND chunk_index = ? AND chunk_hash = ?
      LIMIT 1
    `).get(input.sessionId, input.chunkIndex, input.chunkHash) as MobileTranscriptSegmentRow | undefined;
    if (existing) return sanitizeMobileTranscriptSegment(existing);
  }

  const now = nowIso();
  const row: MobileTranscriptSegmentRow = {
    id: input.id || randomUUID(),
    session_id: input.sessionId,
    device_id: input.deviceId,
    segment_index: Number(input.segmentIndex || 0),
    chunk_index: Number(input.chunkIndex || 0),
    chunk_hash: input.chunkHash || "",
    text: input.text || "",
    status: input.status || "partial",
    start_ms: Number(input.startMs || 0),
    end_ms: Number(input.endMs || 0),
    language: input.language || "zh-CN",
    source: input.source || "stt",
    provider: input.provider || "",
    confidence: Number(input.confidence || 0),
    audio_path: input.audioPath || "",
    audio_mime: input.audioMime || "",
    audio_bytes: Number(input.audioBytes || 0),
    created_at: now,
    updated_at: now,
    error: input.error || "",
    metadata: JSON.stringify(input.metadata || {}),
  };
  db.prepare(`
    INSERT INTO mobile_transcript_segments (
      id, session_id, device_id, segment_index, chunk_index, chunk_hash,
      text, status, start_ms, end_ms, language, source, provider, confidence,
      audio_path, audio_mime, audio_bytes, created_at, updated_at, error, metadata
    ) VALUES (
      @id, @session_id, @device_id, @segment_index, @chunk_index, @chunk_hash,
      @text, @status, @start_ms, @end_ms, @language, @source, @provider, @confidence,
      @audio_path, @audio_mime, @audio_bytes, @created_at, @updated_at, @error, @metadata
    )
  `).run(row);
  return sanitizeMobileTranscriptSegment(row);
}

export function listMobileTranscriptSegments(db: Db, sessionId: string) {
  const rows = db.prepare(`
    SELECT *
    FROM mobile_transcript_segments
    WHERE session_id = ?
    ORDER BY segment_index ASC, chunk_index ASC, created_at ASC
    LIMIT 2000
  `).all(sessionId) as MobileTranscriptSegmentRow[];
  return rows.map(sanitizeMobileTranscriptSegment);
}

// ---------------------------------------------------------------------------
// CRUD — ingestion jobs
// ---------------------------------------------------------------------------

export function getMobileIngestionJobBySessionTarget(db: Db, sessionId: string, target: string) {
  const row = db.prepare(`
    SELECT *
    FROM mobile_ingestion_jobs
    WHERE session_id = ? AND target = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId, target) as MobileIngestionJobRow | undefined;
  return sanitizeMobileIngestionJob(row);
}

export function createMobileIngestionJob(db: Db, input: CreateMobileIngestionJobInput) {
  const now = nowIso();
  const row: MobileIngestionJobRow = {
    id: input.id || randomUUID(),
    session_id: input.sessionId,
    device_id: input.deviceId || "",
    target: input.target,
    status: input.status || "pending",
    knowledge_entry_id: null,
    calendar_note_id: null,
    markdown_path: "",
    html_path: "",
    attempts: Number(input.attempts || 0),
    max_attempts: Number(input.maxAttempts || 3),
    last_error: "",
    scheduled_at: input.scheduledAt || null,
    started_at: null,
    completed_at: null,
    payload: JSON.stringify(input.payload || {}),
    result: JSON.stringify(input.result || {}),
    rollback_ref: input.rollbackRef || "",
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO mobile_ingestion_jobs (
      id, session_id, device_id, target, status, knowledge_entry_id, calendar_note_id,
      markdown_path, html_path, attempts, max_attempts, last_error,
      scheduled_at, started_at, completed_at, payload, result, rollback_ref, created_at, updated_at
    ) VALUES (
      @id, @session_id, @device_id, @target, @status, @knowledge_entry_id, @calendar_note_id,
      @markdown_path, @html_path, @attempts, @max_attempts, @last_error,
      @scheduled_at, @started_at, @completed_at, @payload, @result, @rollback_ref, @created_at, @updated_at
    )`,
  ).run(row);
  return sanitizeMobileIngestionJob(row);
}
