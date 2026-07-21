import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEAD = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const CANDIDATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const OPERATIONS = new Set([
  'notes.list', 'notes.get', 'notes.create', 'notes.update', 'notes.remove', 'notes.backlinks',
  'kg.view', 'kg.reindex', 'rag.ask', 'rag.stream', 'todos.list', 'todos.create',
  'todos.update', 'todos.remove', 'todos.due', 'todos.reminder-fired',
]);
const DIAGNOSTICS = new Set(['startup', 'crash', 'offline', 'renderer-gone', 'renderer-unresponsive']);
let sqlPromise;

export function validateAndCollectTelemetrySource({ bytes, identity, window }) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error('telemetry source bytes are invalid');
  validateIdentity(identity);
  const range = validateWindow(window);
  let events;
  try {
    const text = Buffer.from(bytes).toString('utf8');
    events = text.trim() ? text.trimEnd().split(/\r?\n/).map((line) => JSON.parse(line)) : [];
  } catch {
    throw new Error('telemetry source contains invalid JSONL');
  }
  const allStartups = new Map();
  const windowStartups = new Map();
  const seen = new Set();
  let previous = Number.NEGATIVE_INFINITY;
  let operationEvents = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    validateEvent(event, identity, index + 1);
    const timestamp = Date.parse(event.timestamp);
    if (timestamp <= previous) throw new Error(`telemetry line ${index + 1} violates strict total timestamp order`);
    previous = timestamp;
    const eventKey = canonicalJson(event);
    if (seen.has(eventKey)) throw new Error(`telemetry line ${index + 1} is duplicated`);
    seen.add(eventKey);
    if (event.kind === 'startup') {
      if (allStartups.has(event.sessionId)) throw new Error('telemetry session has duplicate startup');
      allStartups.set(event.sessionId, timestamp);
      if (timestamp >= range.startMs && timestamp < range.endMs) windowStartups.set(event.sessionId, timestamp);
    } else {
      const startup = allStartups.get(event.sessionId);
      if (startup === undefined || timestamp <= startup) throw new Error(`telemetry ${event.kind} occurs before startup`);
      if (event.kind === 'operation' && timestamp >= range.startMs && timestamp < range.endMs) {
        if (!windowStartups.has(event.sessionId)) throw new Error('telemetry counted operation has no startup inside window');
        operationEvents += 1;
      }
    }
  }
  return { events, uniqueStartupSessions: windowStartups.size, operationEvents };
}

export async function queryKbKgSources({ kbBytes, kgBytes, window }) {
  const range = validateWindow(window);
  const SQL = await loadSql();
  const kb = new SQL.Database(kbBytes);
  const kg = new SQL.Database(kgBytes);
  try {
    requireMeta(kb, 'schema_meta', 'version', '0', 'KB');
    requireTableColumns(kb, 'notes', ['path', 'type', 'tags', 'created_at'], 'KB');
    const rows = query(kb, 'SELECT path, type, tags, created_at FROM notes');
    const ns2Rows = rows.values.flatMap((row) => {
      const createdAt = Number(row[3]);
      if (!Number.isSafeInteger(createdAt)) throw new Error('KB created_at must be a safe integer');
      if (createdAt < range.startMs || createdAt >= range.endMs) return [];
      let tags;
      try { tags = row[2] == null || row[2] === '' ? [] : JSON.parse(String(row[2])); }
      catch { throw new Error('KB tags contain invalid JSON'); }
      if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) throw new Error('KB tags are invalid');
      const noteId = String(row[0]);
      return [{ noteId, createdAt, isSystemTodo: noteId.startsWith('system/todos/') || tags.includes('__copilot_todo__') }];
    });
    requireMeta(kg, 'kg_schema_meta', 'version', '0', 'KG');
    requireTableColumns(kg, 'kg_nodes', ['entity_id'], 'KG');
    const kgRows = query(kg, 'SELECT entity_id FROM kg_nodes ORDER BY entity_id');
    const kgNodes = kgRows.values.map((row) => ({ nodeId: String(row[0]) }));
    return { ns2Rows, kgNodes };
  } catch (error) {
    if (error instanceof Error && /^(?:KB|KG)/.test(error.message)) throw error;
    throw new Error('KB/KG SQLite schema/query failed');
  } finally {
    kb.close();
    kg.close();
  }
}

export async function queryRagSource({ ragBytes, embeddingModel }) {
  const SQL = await loadSql();
  const db = new SQL.Database(ragBytes);
  try {
    requireMeta(db, 'rag_index_meta', 'schema_version', '1', 'RAG');
    requireTableColumns(db, 'chunks', ['note_path', 'embedding', 'model'], 'RAG');
    const meta = new Map(query(db, 'SELECT key, value FROM rag_index_meta ORDER BY key').values
      .map((row) => [String(row[0]), String(row[1])]));
    const model = meta.get('embedding_model');
    if (!model || model !== embeddingModel) throw new Error('RAG embedding model mismatch');
    const rows = query(db, 'SELECT note_path, embedding, model FROM chunks').values;
    let dimensions = null;
    const chunks = rows.map((row) => {
      if (String(row[2]) !== model || !(row[1] instanceof Uint8Array) || row[1].byteLength % 4 !== 0) {
        throw new Error('RAG chunk model/vector is invalid');
      }
      const raw = row[1];
      const embedding = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      dimensions ??= embedding.length;
      validateVector(embedding, dimensions);
      const notePath = String(row[0]);
      if (!safePath(notePath)) throw new Error('RAG note path is unsafe');
      return { notePath, embedding, model };
    });
    if (chunks.length === 0) throw new Error('RAG contains no chunks');
    return { model, dimensions, chunks };
  } catch (error) {
    if (error instanceof Error && /^RAG/.test(error.message)) throw error;
    throw new Error('RAG SQLite schema/query failed');
  } finally { db.close(); }
}

function validateEvent(event, identity, line) {
  if (!plain(event) || event.schemaVersion !== 2 || !validIso(event.timestamp)
      || !UUID_V4.test(String(event.sessionId ?? ''))
      || !['main', 'renderer'].includes(event.process)
      || !sameIdentity(event.release, identity)) throw new Error(`telemetry line ${line} identity/schema is invalid`);
  if (event.kind === 'operation') {
    if (!exact(event, ['schemaVersion', 'timestamp', 'kind', 'process', 'sessionId', 'release', 'operation'])
        || !OPERATIONS.has(event.operation)) throw new Error(`telemetry line ${line} operation schema/enum is invalid`);
  } else if (!DIAGNOSTICS.has(event.kind)
      || !exact(event, ['schemaVersion', 'timestamp', 'kind', 'process', 'sessionId', 'release', 'detail'])
      || !validDetail(event.detail)) throw new Error(`telemetry line ${line} diagnostic schema is invalid`);
}

function validateIdentity(value) {
  if (!plain(value) || !exact(value, ['schemaVersion', 'candidate', 'sourceHead', 'sourceSnapshotSha256'])
      || value.schemaVersion !== 1 || !CANDIDATE.test(String(value.candidate ?? ''))
      || !HEAD.test(String(value.sourceHead ?? '')) || !SHA256.test(String(value.sourceSnapshotSha256 ?? ''))) {
    throw new Error('telemetry release identity is invalid');
  }
}

function validateWindow(value) {
  if (!plain(value) || !validIso(value.start) || !validIso(value.end)) throw new Error('seven-day window is invalid');
  const startMs = Date.parse(value.start); const endMs = Date.parse(value.end);
  if (endMs - startMs !== SEVEN_DAYS_MS) throw new Error('seven-day window is invalid');
  return { startMs, endMs };
}

function requireMeta(db, table, key, expected, label) {
  requireTableColumns(db, table, table === 'rag_index_meta' ? ['key', 'value'] : ['k', 'v'], label);
  const columns = table === 'rag_index_meta' ? ['key', 'value'] : ['k', 'v'];
  const rows = query(db, `SELECT ${columns[0]}, ${columns[1]} FROM ${table}`).values;
  const meta = new Map(rows.map((row) => [String(row[0]), String(row[1])]));
  if (meta.get(key) !== expected) throw new Error(`${label} SQLite schema_meta/version mismatch`);
}

function requireTableColumns(db, table, required, label) {
  const result = db.exec(`PRAGMA table_info(${table})`);
  const columns = (result[0]?.values ?? []).map((row) => String(row[1]));
  if (required.some((name) => !columns.includes(name))) throw new Error(`${label} SQLite schema required columns are missing`);
}

function query(db, sql) {
  const result = db.exec(sql)[0];
  if (!result) return { columns: [], values: [] };
  return result;
}

function validateVector(vector, dimensions) {
  if (!(vector instanceof Float32Array) || vector.length !== dimensions || vector.length < 1 || vector.length > 4096) throw new Error('RAG vector dimension is invalid');
  let norm = 0;
  for (const value of vector) { if (!Number.isFinite(value)) throw new Error('RAG vector is non-finite'); norm += value * value; }
  if (!Number.isFinite(norm) || norm <= 0) throw new Error('RAG vector norm is invalid');
}

async function loadSql() {
  sqlPromise ??= import('sql.js').then(({ default: init }) => {
    const entry = require.resolve('sql.js/dist/sql-wasm.js');
    return init({ locateFile: (file) => path.join(path.dirname(entry), file) });
  });
  return sqlPromise;
}

function sameIdentity(left, right) { return plain(left) && exact(left, ['schemaVersion', 'candidate', 'sourceHead', 'sourceSnapshotSha256']) && canonicalJson(left) === canonicalJson(right); }
function validDetail(value) { return plain(value) && Object.entries(value).every(([key, child]) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) && !/body|content|transcript|prompt|authorization|question|secret|credential|api.?key|payload|provider|path/i.test(key) && (child === null || typeof child === 'boolean' || (typeof child === 'number' && Number.isFinite(child)) || (typeof child === 'string' && child.length <= 500))); }
function safePath(value) { return typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && value.split(/[\\/]/).every((part) => part && part !== '.' && part !== '..'); }
function validIso(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value, keys) { return plain(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort()); }
function canonicalJson(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`; }
