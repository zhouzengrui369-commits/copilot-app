import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { Db } from "./db.js";
import { nowIso } from "./config.js";
import { repairTodoMacosSyncState, reminderSyncStatus, resolveReminderConflict, runReminderSync } from "./reminderSync.js";

const CALENDAR_PROVIDER = "macos_calendar";
const CALENDAR_MARKER_PREFIX = "openclaw:event:";
const MACOS_CALENDAR_APP = "/System/Applications/Calendar.app";
const CALENDAR_OSASCRIPT_TIMEOUT_MS = Math.max(2_000, Number(process.env.OPENCLAW_CALENDAR_OSASCRIPT_TIMEOUT_MS || 5_000));
const MACOS_BACKGROUND_SYNC_MS = Math.max(300_000, Number(process.env.OPENCLAW_WORKBENCH_REMINDER_SYNC_MS || 300_000));
const CALENDAR_PUSH_BATCH_SIZE = Math.min(16, Math.max(1, Number(process.env.OPENCLAW_CALENDAR_PUSH_BATCH_SIZE || 1)));
const CALENDAR_TIMEOUT_RETRY_STALE_MS = Math.max(60_000, Number(process.env.OPENCLAW_CALENDAR_TIMEOUT_RETRY_STALE_MS || 120_000));
const CALENDAR_TIMEOUT_RETRY_MAX_BATCH = Math.max(1, Number(process.env.OPENCLAW_CALENDAR_TIMEOUT_RETRY_BATCH || 2));
const CALENDAR_NON_TIMEOUT_MAX_BATCH = Math.max(1, Number(process.env.OPENCLAW_CALENDAR_NON_TIMEOUT_BATCH || 8));
const CALENDAR_SYNC_MAX_RETRIES = Math.max(1, Number(process.env.OPENCLAW_MACOS_SYNC_MAX_RETRIES || 3));

type EventLinkSchema = {
  hasRetryCount: boolean;
  hasLastErrorAt: boolean;
  hasLastErrorKind: boolean;
  hasBlocked: boolean;
};

type SyncRepairSummary = {
  repaired: number;
  details: string[];
};

type CalendarSyncInput = {
  apply?: boolean;
  trigger?: string;
  scope?: "todos" | "events" | "all";
  mode?: "push_pending" | "full_reconcile";
  batchSize?: number;
};

type EventRow = {
  id: string;
  title: string;
  start_at: string;
  end_at?: string | null;
  notes?: string | null;
  event_type?: string | null;
  status?: string | null;
  updated_at?: string | null;
};

type EventSyncLinkRow = {
  id: string;
  event_id: string;
  provider: string;
  external_id?: string | null;
  external_calendar: string;
  sync_hash: string;
  last_synced_at?: string | null;
  status: string;
  error: string;
  retry_count?: number;
  last_error_at?: string | null;
  last_error_kind?: string;
  blocked?: number;
  updated_at: string;
};

type EventSyncPayloadRow = {
  row: EventSyncLinkRow & EventRow & { event_status?: string; event_updated_at?: string | null };
  payload: ReturnType<typeof calendarEventPayload>;
};

type SyncFailureKind = "auth" | "timeout" | "upstream";

type SyncFailureSummary = {
  auth: number;
  timeout: number;
  upstream: number;
};

type RemoteCalendarEvent = {
  id: string;
  title: string;
  notes: string;
  startAt: string | null;
  endAt: string | null;
  calendarName: string;
  eventId?: string;
};

function eventSyncLinkSchema(db: Db): EventLinkSchema {
  const rows = db.prepare("PRAGMA table_info(event_sync_links)").all() as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  return {
    hasRetryCount: names.has("retry_count"),
    hasLastErrorAt: names.has("last_error_at"),
    hasLastErrorKind: names.has("last_error_kind"),
    hasBlocked: names.has("blocked"),
  };
}

function emptySyncFailureSummary(): SyncFailureSummary {
  return { auth: 0, timeout: 0, upstream: 0 };
}

function normalizeSyncFailureKind(value: string) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "auth") return "auth";
  if (normalized === "timeout") return "timeout";
  if (normalized === "upstream") return "upstream";
  return "upstream";
}

function collectEventSyncFailureSummary(rows: EventSyncLinkRow[], schema: EventLinkSchema) {
  const summary = emptySyncFailureSummary();
  for (const row of rows) {
    const isFailure = row.status === "error" || row.status === "blocked" || isEventLinkBlocked(row, schema);
    if (!isFailure) continue;
    const kind = normalizeSyncFailureKind(String(row.last_error_kind || syncFailureKind(row.error || "")));
    summary[kind] += 1;
  }
  return summary;
}

function isEventLinkBlocked(row: EventSyncLinkRow, schema: EventLinkSchema) {
  return schema.hasBlocked ? Number(row.blocked || 0) === 1 : false;
}

function eventFailureSetSql(schema: EventLinkSchema, options: { resetExternalId?: boolean } = {}) {
  const setSql = [
    "status = ?",
    "error = ?",
    "updated_at = ?",
  ];
  if (schema.hasLastErrorAt) setSql.push("last_error_at = ?");
  if (schema.hasLastErrorKind) setSql.push("last_error_kind = ?");
  if (schema.hasRetryCount) setSql.push("retry_count = ?");
  if (schema.hasBlocked) setSql.push("blocked = ?");
  if (options.resetExternalId) setSql.push("external_id = NULL");
  return setSql;
}

function eventRepairSet(db: Db, id: string, schema: EventLinkSchema, updates: {
  status?: string;
  error?: string;
  retryCount?: number | null;
  lastErrorAt?: string | null;
  lastErrorKind?: string;
  blocked?: number;
}) {
  const setSql: string[] = ["updated_at = ?"];
  const args: Array<string | number | null> = [nowIso()];
  if (updates.status !== undefined) {
    setSql.unshift("status = ?");
    args.unshift(updates.status);
  }
  if (updates.error !== undefined) {
    setSql.unshift("error = ?");
    args.unshift(updates.error);
  }
  if (schema.hasRetryCount && updates.retryCount !== undefined) {
    setSql.unshift("retry_count = ?");
    args.unshift(updates.retryCount);
  }
  if (schema.hasLastErrorAt && updates.lastErrorAt !== undefined) {
    setSql.unshift("last_error_at = ?");
    args.unshift(updates.lastErrorAt);
  }
  if (schema.hasLastErrorKind && updates.lastErrorKind !== undefined) {
    setSql.unshift("last_error_kind = ?");
    args.unshift(updates.lastErrorKind);
  }
  if (schema.hasBlocked && updates.blocked !== undefined) {
    setSql.unshift("blocked = ?");
    args.unshift(updates.blocked);
  }
  db.prepare(`UPDATE event_sync_links SET ${setSql.join(", ")} WHERE id = ?`).run(...args, id);
}

export function repairEventMacosSyncState(db: Db): SyncRepairSummary {
  const schema = eventSyncLinkSchema(db);
  const now = nowIso();
  const details: string[] = [];
  let repaired = 0;

  const missingEventLinks = db.prepare(`
    SELECT l.id, l.event_id, l.status, l.error
    FROM event_sync_links l
    LEFT JOIN events e ON e.id = l.event_id
    WHERE l.provider = ? AND e.id IS NULL
  `).all(CALENDAR_PROVIDER) as Array<{ id: string; event_id: string; status: string; error: string }>;

  for (const row of missingEventLinks) {
    eventRepairSet(db, row.id, schema, {
      status: "blocked",
      error: row.error || "event_not_found",
      retryCount: schema.hasRetryCount ? 0 : undefined,
      lastErrorAt: schema.hasLastErrorAt ? now : undefined,
      lastErrorKind: schema.hasLastErrorKind ? "upstream" : undefined,
      blocked: schema.hasBlocked ? 1 : undefined,
    });
    repaired += 1;
    details.push(`event_sync_link_orphan: ${row.id}`);
  }

  if (schema.hasLastErrorKind) {
    const rows = db.prepare(`
      SELECT id, error
      FROM event_sync_links
      WHERE provider = ? AND status = 'error' AND COALESCE(last_error_kind, '') = ''
    `).all(CALENDAR_PROVIDER) as Array<{ id: string; error: string }>;
    for (const row of rows) {
      eventRepairSet(db, row.id, schema, { lastErrorKind: syncFailureKind(row.error || "") });
      repaired += 1;
      details.push(`event_sync_link_repair_kind: ${row.id}`);
    }
  }

  if (schema.hasLastErrorAt) {
    const rows = db.prepare(`
      SELECT id
      FROM event_sync_links
      WHERE provider = ? AND status = 'error' AND last_error_at IS NULL
    `).all(CALENDAR_PROVIDER) as Array<{ id: string }>;
    for (const row of rows) {
      eventRepairSet(db, row.id, schema, { lastErrorAt: now });
      repaired += 1;
      details.push(`event_sync_link_repair_error_time: ${row.id}`);
    }
  }

  if (schema.hasRetryCount) {
    const rows = db.prepare(`
      SELECT id
      FROM event_sync_links
      WHERE provider = ? AND retry_count IS NULL
    `).all(CALENDAR_PROVIDER) as Array<{ id: string }>;
    for (const row of rows) {
      eventRepairSet(db, row.id, schema, { retryCount: 0 });
      repaired += 1;
      details.push(`event_sync_link_repair_retry_count: ${row.id}`);
    }
  }

  if (schema.hasBlocked) {
    const rows = db.prepare(`
      SELECT id
      FROM event_sync_links
      WHERE provider = ? AND status = 'blocked' AND COALESCE(blocked, 0) = 0
    `).all(CALENDAR_PROVIDER) as Array<{ id: string }>;
    for (const row of rows) {
      eventRepairSet(db, row.id, schema, { blocked: 1 });
      repaired += 1;
      details.push(`event_sync_link_repair_blocked: ${row.id}`);
    }
  }

  return { repaired, details };
}

function eventSuccessSetSql(schema: EventLinkSchema) {
  const setSql = [
    "external_id = ?",
    "external_calendar = ?",
    "sync_hash = ?",
    "last_synced_at = ?",
    "status = 'synced'",
    "error = ''",
    "updated_at = ?",
  ];
  if (schema.hasLastErrorAt) setSql.push("last_error_at = NULL");
  if (schema.hasLastErrorKind) setSql.push("last_error_kind = ''");
  if (schema.hasRetryCount) setSql.push("retry_count = 0");
  if (schema.hasBlocked) setSql.push("blocked = 0");
  return setSql;
}

function eventBlockedClause(schema: EventLinkSchema) {
  return schema.hasBlocked ? "AND (l.blocked IS NULL OR l.blocked = 0)" : "";
}

function eventPendingCountSql(schema: EventLinkSchema) {
  return schema.hasBlocked
    ? "SELECT COUNT(*) AS count FROM event_sync_links WHERE provider = ? AND (status = 'pending' OR (status = 'error' AND (blocked IS NULL OR blocked = 0)))"
    : "SELECT COUNT(*) AS count FROM event_sync_links WHERE provider = ? AND (status = 'pending' OR status = 'error')";
}

export function macosSyncStatus(db: Db) {
  const todos = reminderSyncStatus(db);
  const events = calendarSyncStatus(db);
  const todoStats = todos.stats || emptyStats();
  const eventStats = events.stats || emptyStats();
  const stats = combineStats(todoStats, eventStats);
  const lastSyncedAt = [todos.lastSyncedAt, events.lastSyncedAt].filter(Boolean).sort().at(-1) || null;
  const recentRun = latestMacosSyncRun(db);
  return {
    ok: true,
    provider: "macos_agenda",
    label: "macOS 日程管理",
    permissionStatus: "not_checked",
    mode: "双向审阅",
    runner: "OpenClaw Workbench",
    backgroundSync: {
      enabled: process.platform === "darwin" && process.env.OPENCLAW_WORKBENCH_REMINDER_SYNC !== "0",
      intervalMs: MACOS_BACKGROUND_SYNC_MS,
    },
    lastRunAt: recentRun.lastRunAt,
    lastRunOk: recentRun.lastRunOk,
    lastError: recentRun.lastError,
    lastDurationMs: recentRun.lastDurationMs,
    nextRunAt: recentRun.lastRunAt && process.platform === "darwin" && process.env.OPENCLAW_WORKBENCH_REMINDER_SYNC !== "0"
      ? new Date(new Date(recentRun.lastRunAt).getTime() + MACOS_BACKGROUND_SYNC_MS).toISOString()
      : null,
    stats,
    todos,
    events,
    pendingConflicts: [
      ...(todos.pendingConflicts || []).map((row: Record<string, unknown>) => prefixConflict("todo", row)),
      ...(events.pendingConflicts || []).map((row: Record<string, unknown>) => prefixConflict("event", row)),
    ],
    lists: todos.lists || [],
    calendars: events.calendars || [],
    lastSyncedAt,
    recentLinks: [
      ...(todos.recentLinks || []).map((row: Record<string, unknown>) => ({ ...row, sync_kind: "todo" })),
      ...(events.recentLinks || []).map((row: Record<string, unknown>) => ({ ...row, sync_kind: "event" })),
    ].slice(0, 16),
  };
}

export function runMacosSync(db: Db, input: CalendarSyncInput = {}) {
  const scope = input.scope === "todos" || input.scope === "events" ? input.scope : "all";
  const todoResult = scope === "events" ? skippedSyncResult("todos", input) : runReminderSync(db, input);
  const eventResult = scope === "todos" ? skippedSyncResult("events", input) : runCalendarSync(db, input);
  const todoResultStats = todoResult as {
    processed?: number;
    failed?: number;
    remainingPending?: number;
    pendingBefore?: number;
    pendingAfter?: number;
    total?: number;
    kindSummary?: SyncFailureSummary;
  };
  const eventResultStats = eventResult as {
    processed?: number;
    failed?: number;
    remainingPending?: number;
    pendingBefore?: number;
    pendingAfter?: number;
    total?: number;
    kindSummary?: SyncFailureSummary;
  };
  const todoBefore = Number(todoResultStats.pendingBefore || 0);
  const eventBefore = Number(eventResultStats.pendingBefore || 0);
  const todoAfter = Number(todoResultStats.pendingAfter || todoResultStats.remainingPending || 0);
  const eventAfter = Number(eventResultStats.pendingAfter || eventResultStats.remainingPending || 0);
  const todoHasProgress = Number(todoResultStats.processed || 0) > 0 || todoAfter < todoBefore;
  const eventHasProgress = Number(eventResultStats.processed || 0) > 0 || eventAfter < eventBefore;
  const hasAnyProgress = todoHasProgress || eventHasProgress;
  const hasAnyWorkToSync = scope === "todos"
    ? todoResultStats.total || 0
    : scope === "events"
      ? eventResultStats.total || 0
      : Number(todoResultStats.total || 0) + Number(eventResultStats.total || 0);
  const hardFailure =
    (todoResult.ok === false || eventResult.ok === false)
    && !hasAnyProgress
    && hasAnyWorkToSync > 0;
  const ok = !hardFailure;
  const todoKindSummary = todoResultStats.kindSummary || (todoResult as { status?: { stats?: { kindSummary?: SyncFailureSummary } } }).status?.stats?.kindSummary;
  const eventKindSummary = eventResultStats.kindSummary || (eventResult as { status?: { stats?: { kindSummary?: SyncFailureSummary } } }).status?.stats?.kindSummary;
  const mergedKindSummary = {
    auth: Number(todoKindSummary?.auth || 0) + Number(eventKindSummary?.auth || 0),
    timeout: Number(todoKindSummary?.timeout || 0) + Number(eventKindSummary?.timeout || 0),
    upstream: Number(todoKindSummary?.upstream || 0) + Number(eventKindSummary?.upstream || 0),
  };
  const pendingBefore = todoBefore + eventBefore;
  const pendingAfter = todoAfter + eventAfter;
  const operations = [
    ...((todoResult as { operations?: unknown[] }).operations || []).map((row) => ({ ...(row as Record<string, unknown>), syncKind: "todo" })),
    ...((eventResult as { operations?: unknown[] }).operations || []).map((row) => ({ ...(row as Record<string, unknown>), syncKind: "event" })),
  ];
  return {
    ok,
    apply: Boolean(input.apply),
    provider: "macos_agenda",
    scope,
    mode: input.mode || "push_pending",
    processed: Number(todoResultStats.processed || 0) + Number(eventResultStats.processed || 0),
    failed: Number(todoResultStats.failed || 0) + Number(eventResultStats.failed || 0),
    remainingPending: Number(todoResultStats.remainingPending || 0) + Number(eventResultStats.remainingPending || 0),
    pendingBefore,
    pendingAfter,
    total: Number(todoResultStats.total || 0) + Number(eventResultStats.total || 0),
    kindSummary: mergedKindSummary,
    message: ok ? "" : [errorOf(todoResult), errorOf(eventResult)].filter(Boolean).join("；"),
    operations,
    todos: todoResult,
    events: eventResult,
    status: macosSyncStatus(db),
  };
}

export function resolveMacosSyncConflict(db: Db, conflictId: string, decision: "local" | "remote" | "dismiss") {
  const [kind, rawId] = parseConflictId(conflictId);
  if (kind === "todo") {
    const result = resolveReminderConflict(db, rawId, decision);
    return result.ok ? { ok: true, status: macosSyncStatus(db) } : result;
  }
  if (kind === "event") return resolveCalendarConflict(db, rawId, decision);
  const eventResult = resolveCalendarConflict(db, rawId, decision);
  if (eventResult.ok) return eventResult;
  const todoResult = resolveReminderConflict(db, rawId, decision);
  return todoResult.ok ? { ok: true, status: macosSyncStatus(db) } : todoResult;
}

export function markEventCalendarSyncPending(db: Db, eventId: string, calendarName?: string) {
  ensureEventCalendarSyncLink(db, eventId, calendarName, undefined, "pending");
}

export function ensureEventCalendarSyncLink(db: Db, eventId: string, calendarName?: string, syncHash?: string, status = "pending") {
  const schema = eventSyncLinkSchema(db);
  const existing = db.prepare("SELECT * FROM event_sync_links WHERE event_id = ? AND provider = ?").get(eventId, CALENDAR_PROVIDER) as EventSyncLinkRow | undefined;
  const calendar = normalizeCalendarName(calendarName || calendarNameForEvent());
  const now = nowIso();
  if (existing) {
    const setSql = [
      "external_calendar = ?",
      "status = ?",
      "error = ''",
      "updated_at = ?",
    ];
    if (schema.hasLastErrorAt) setSql.push("last_error_at = NULL");
    if (schema.hasLastErrorKind) setSql.push("last_error_kind = ''");
    if (schema.hasRetryCount) setSql.push("retry_count = 0");
    if (schema.hasBlocked) setSql.push("blocked = 0");
    const args: Array<string | number | null> = [calendar, status, now];
    args.push(existing.id);
    db.prepare(`UPDATE event_sync_links SET ${setSql.join(", ")} WHERE id = ?`).run(...args);
    return existing.id;
  }
  const id = randomUUID();
  const columns = ["id", "event_id", "provider", "external_id", "external_calendar", "sync_hash", "last_synced_at", "status", "error", "created_at", "updated_at"];
  const values = ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"];
  const params: Array<string | number | null> = [id, eventId, CALENDAR_PROVIDER, null, calendar, syncHash || "", null, status, "", now, now];
  if (schema.hasRetryCount) {
    columns.push("retry_count");
    values.push("?");
    params.push(0);
  }
  if (schema.hasLastErrorAt) {
    columns.push("last_error_at");
    values.push("?");
    params.push(null);
  }
  if (schema.hasLastErrorKind) {
    columns.push("last_error_kind");
    values.push("?");
    params.push("");
  }
  if (schema.hasBlocked) {
    columns.push("blocked");
    values.push("?");
    params.push(0);
  }
  db.prepare(`INSERT INTO event_sync_links (${columns.join(", ")}) VALUES (${values.join(", ")})`).run(...params);
  return id;
}

export function calendarSyncStatus(db: Db) {
  const schema = eventSyncLinkSchema(db);
  const links = db.prepare("SELECT * FROM event_sync_links WHERE provider = ? ORDER BY updated_at DESC").all(CALENDAR_PROVIDER) as EventSyncLinkRow[];
  const conflicts = db.prepare("SELECT * FROM event_sync_conflicts WHERE provider = ? AND status = 'pending' ORDER BY updated_at DESC").all(CALENDAR_PROVIDER);
  const retryableErrors = links.filter((row) => row.status === "error" && !isEventLinkBlocked(row, schema)).length;
  const blockedErrors = links.filter((row) => row.status === "blocked" || isEventLinkBlocked(row, schema)).length;
  const kindSummary = collectEventSyncFailureSummary(links, schema);
  const stats = {
    total: links.length,
    pending: links.filter((row) => row.status === "pending").length,
    synced: links.filter((row) => row.status === "synced").length,
    conflict: links.filter((row) => row.status === "conflict").length,
    retryable: retryableErrors,
    blocked: blockedErrors,
    retryableError: retryableErrors,
    blockedError: blockedErrors,
    error: retryableErrors + blockedErrors,
    kindSummary,
  };
  return {
    ok: true,
    provider: CALENDAR_PROVIDER,
    permissionStatus: "not_checked",
    mode: "双向审阅",
    runner: "OpenClaw Workbench",
    backgroundSync: {
      enabled: process.platform === "darwin" && process.env.OPENCLAW_WORKBENCH_REMINDER_SYNC !== "0",
      intervalMs: MACOS_BACKGROUND_SYNC_MS,
    },
    stats,
    pendingConflicts: conflicts,
    calendars: [...new Set(links.map((row) => row.external_calendar).filter(Boolean))].sort(),
    lastSyncedAt: links.map((row) => row.last_synced_at || "").filter(Boolean).sort().at(-1) || null,
    recentLinks: links.slice(0, 12),
  };
}

export function runCalendarSync(db: Db, input: CalendarSyncInput = {}) {
  const apply = Boolean(input.apply);
  const mode: "push_pending" | "full_reconcile" = input.mode === "full_reconcile" ? "full_reconcile" : "push_pending";
  const batchSize = calendarBatchSize(input.batchSize);
  const pendingBefore = eventPendingCount(db);
  if (apply && mode === "full_reconcile") reminderBackfillEventSyncLinks(db, Math.max(batchSize * 3, 24));
  const links = mode === "full_reconcile" ? selectEventSyncLinks(db) : selectCalendarPendingBatch(db, batchSize);
  const operations: Array<Record<string, unknown>> = [];
  if (!apply) {
    for (const row of links) operations.push({ action: row.external_id ? "compare" : "create", eventId: row.event_id, title: row.title, calendar: row.external_calendar, status: row.status });
    return {
      ok: true,
      apply: false,
      provider: CALENDAR_PROVIDER,
      mode,
      batchSize,
      processed: 0,
      failed: 0,
      remainingPending: eventPendingCount(db),
      pendingBefore,
      pendingAfter: eventPendingCount(db),
      kindSummary: emptySyncFailureSummary(),
      emptyQueue: links.length === 0,
      message: links.length === 0 ? "没有待同步日程。请先新建或修改日程。" : "",
      operations,
      status: calendarSyncStatus(db),
    };
  }
  if (!links.length) {
    return {
      ok: true,
      apply: true,
      provider: CALENDAR_PROVIDER,
      mode,
      batchSize,
      processed: 0,
      failed: 0,
      remainingPending: eventPendingCount(db),
      pendingBefore,
      pendingAfter: eventPendingCount(db),
      kindSummary: emptySyncFailureSummary(),
      operations,
      emptyQueue: true,
      message: "没有待同步日程。请先新建或修改日程。",
      status: calendarSyncStatus(db),
    };
  }
  if (mode === "push_pending") return runCalendarPushPending(db, links, batchSize, pendingBefore);
  return runCalendarFullReconcile(db, links, pendingBefore);
}

function runCalendarPushPending(db: Db, links: Array<EventSyncLinkRow & EventRow & { event_status?: string; event_updated_at?: string | null }>, batchSize: number, pendingBefore = 0) {
  const payloadRows = links.map((row) => ({ row, payload: calendarEventPayload(linkEventRow(row), row.external_calendar, row.external_id) }));
  const timeoutRows = payloadRows.filter(({ row }) => String(row.last_error_kind || "") === "timeout");
  const normalRows = payloadRows.filter(({ row }) => String(row.last_error_kind || "") !== "timeout");
  const operations = payloadRows.map(({ row }) => ({ action: row.external_id ? "push" : "create", eventId: row.event_id, title: row.title, calendar: row.external_calendar, status: row.status }));
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];
  const now = nowIso();
  const normalChunkSize = Math.max(1, Math.min(batchSize, CALENDAR_PUSH_BATCH_SIZE));
  const normalChunks = chunkArray(normalRows, normalChunkSize);
  const total = payloadRows.length;
  const processChunk = (chunk: typeof payloadRows) => {
    if (!chunk.length) return;
    const upsertResult = upsertRemoteCalendarEvents(chunk.map((row) => row.payload));
    if (!upsertResult.ok) {
      if (chunk.length > 1) {
        for (const chunkRow of chunk) {
          const [ok, error] = syncSingleCalendarPayload(db, chunkRow, now);
          if (ok) {
            processed += 1;
          } else {
            failed += 1;
            errors.push(`${chunkRow.payload.title || "未命名日程"}: ${error}`);
          }
        }
        return;
      }
      const chunkRow = chunk[0];
      const [ok, error] = syncSingleCalendarPayload(db, chunkRow, now);
      if (ok) {
        processed += 1;
      } else {
        failed += 1;
        errors.push(`${chunkRow.payload.title || "未命名日程"}: ${error}`);
      }
      return;
    }
    for (const remote of upsertResult.events || []) {
      if (!remote.eventId) continue;
      const event = db.prepare("SELECT * FROM events WHERE id = ?").get(remote.eventId) as EventRow | undefined;
      const link = db.prepare("SELECT * FROM event_sync_links WHERE event_id = ? AND provider = ?").get(remote.eventId, CALENDAR_PROVIDER) as EventSyncLinkRow | undefined;
      if (!link) continue;
      markEventSyncSuccess(db, link, remote, event, now);
      processed += 1;
    }
  }

  for (const chunk of normalChunks) processChunk(chunk);
  for (const timeoutRow of timeoutRows) {
    const [ok, error] = syncSingleCalendarPayload(db, timeoutRow, now);
    if (ok) {
      processed += 1;
    } else {
      failed += 1;
      errors.push(`${timeoutRow.payload.title || "未命名日程"}: ${error}`);
    }
  }

  const remaining = eventPendingCount(db);
  const syncStats = calendarSyncStatus(db).stats || emptyStats();
  return {
    ok: true,
    apply: true,
    provider: CALENDAR_PROVIDER,
    mode: "push_pending",
    batchSize,
    processed,
    failed,
    total,
    remainingPending: remaining,
    pendingBefore,
    pendingAfter: remaining,
    kindSummary: {
      auth: syncStats.kindSummary?.auth || 0,
      timeout: syncStats.kindSummary?.timeout || 0,
      upstream: syncStats.kindSummary?.upstream || 0,
    },
    error: processed > 0 ? "" : errors[0] || "",
    operations,
    message: remaining ? `本轮已同步 ${processed} 条，失败 ${failed} 条，仍有 ${remaining} 条待推送。` : `本轮已同步 ${processed} 条，失败 ${failed} 条，待推送队列已清空。`,
    status: calendarSyncStatus(db),
  };
}

function runCalendarPushSingle(db: Db, row: EventSyncPayloadRow, now: string) {
  const hasErrorRequiringExternalReset = (error: string) => {
    const normalized = String(error || "").toLowerCase();
    return normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("not authorized") || normalized.includes("unauthorized") || normalized.includes("permission") || normalized.includes("kerror") || normalized.includes("error");
  };

  const syncResult = upsertRemoteCalendarEvents([row.payload]);
  if (syncResult.ok) {
    const remote = (syncResult.events || [])[0];
    if (remote?.eventId) {
      const event = db.prepare("SELECT * FROM events WHERE id = ?").get(remote.eventId) as EventRow | undefined;
      const link = db.prepare("SELECT * FROM event_sync_links WHERE event_id = ? AND provider = ?").get(remote.eventId, CALENDAR_PROVIDER) as EventSyncLinkRow | undefined;
      if (link) {
        markEventSyncSuccess(db, link, remote, event, now);
      }
      return [true, ""] as const;
    }
    markEventSyncFailure(db, row.row, now, "calendar_upsert_no_event", {});
    return [false, "calendar_upsert_no_event"] as const;
  }

  const firstError = String(syncResult.error || "calendar_upsert_failed");
  if (String(row.row.last_error_kind || "") === "timeout") {
    markEventSyncFailure(db, row.row, now, firstError, {});
    return [false, firstError] as const;
  }

  const shouldRetryWithoutExternalId = Boolean(row.payload.externalId);
  if (!shouldRetryWithoutExternalId) {
    markEventSyncFailure(db, row.row, now, firstError, {});
    return [false, firstError] as const;
  }

  const fallbackPayload = { ...row.payload, externalId: null };
  const fallbackResult = upsertRemoteCalendarEvents([fallbackPayload]);
  if (!fallbackResult.ok) {
    const fallbackError = String(fallbackResult.error || "calendar_upsert_failed");
    const shouldResetExternal = hasErrorRequiringExternalReset(firstError) || hasErrorRequiringExternalReset(fallbackError);
    if (shouldResetExternal) {
      markEventSyncFailure(db, row.row, now, `${firstError}; fallback_no_external_id_${fallbackError}`, { resetExternalId: true });
      return [false, `${firstError}; fallback_no_external_id_${fallbackError}; external_id_reset`] as const;
    }
    markEventSyncFailure(db, row.row, now, `${firstError}; fallback_no_external_id_${fallbackError}`);
    return [false, `${firstError}; fallback_no_external_id_${fallbackError}`] as const;
  }

  const fallbackRemote = (fallbackResult.events || [])[0];
  if (fallbackRemote?.eventId) {
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(fallbackRemote.eventId) as EventRow | undefined;
    const link = db.prepare("SELECT * FROM event_sync_links WHERE event_id = ? AND provider = ?").get(fallbackRemote.eventId, CALENDAR_PROVIDER) as EventSyncLinkRow | undefined;
    if (link) {
      markEventSyncSuccess(db, link, fallbackRemote, event, now);
    }
    return [true, ""] as const;
  }
  markEventSyncFailure(db, row.row, now, "calendar_upsert_no_event", {});
  return [false, "calendar_upsert_no_event"] as const;
}

function runCalendarFullReconcile(db: Db, links: Array<EventSyncLinkRow & EventRow & { event_status?: string; event_updated_at?: string | null }>, pendingBefore = 0) {
  const operations: Array<Record<string, unknown>> = [];
  const total = links.length;
  const remoteResult = readRemoteCalendarEvents();
  if (!remoteResult.ok) {
    return {
      ok: false,
      apply: true,
      provider: CALENDAR_PROVIDER,
      mode: "full_reconcile",
      pendingBefore,
      pendingAfter: eventPendingCount(db),
      total,
      processed: 0,
      failed: 1,
      remainingPending: eventPendingCount(db),
      kindSummary: collectEventSyncFailureSummary(links, eventSyncLinkSchema(db)),
      error: remoteResult.error || "macos_calendar_unavailable",
      operations: [{ action: "failed_read_remote", reason: remoteResult.error || "macos_calendar_unavailable" }],
      status: calendarSyncStatus(db),
    };
  }
  const remoteByEvent = new Map((remoteResult.events || []).filter((row) => row.eventId).map((row) => [row.eventId as string, row]));
  const upserts: Array<{ row: EventSyncPayloadRow["row"]; payload: ReturnType<typeof calendarEventPayload> }> = [];
  const now = nowIso();

  for (const row of links) {
    const event = linkEventRow(row);
    const localHash = eventHash(event, row.external_calendar);
    const remote = remoteByEvent.get(row.external_id || row.event_id);
    if (remote) {
      const remoteHash = remoteCalendarEventHash(remote);
      const localChanged = Boolean(row.sync_hash) && localHash !== row.sync_hash;
      const remoteChanged = Boolean(row.sync_hash) && remoteHash !== row.sync_hash;
      if (localChanged && remoteChanged) {
        const conflictId = upsertCalendarConflict(db, row.event_id, remote.id, "record", JSON.stringify(eventConflictShape(event, row.external_calendar)), JSON.stringify(remoteEventConflictShape(remote)), "人工审阅后合并");
        db.prepare("UPDATE event_sync_links SET external_id = ?, external_calendar = ?, status = 'conflict', error = '', updated_at = ? WHERE id = ?")
          .run(remote.id, remote.calendarName, now, row.id);
        operations.push({ action: "conflict", conflictId, eventId: row.event_id, title: row.title });
        continue;
      }
      if (remoteChanged && !localChanged) {
        db.prepare("UPDATE events SET title = ?, start_at = ?, end_at = ?, notes = ?, status = ?, updated_at = ? WHERE id = ?")
          .run(remote.title || row.title, remote.startAt || row.start_at, remote.endAt || null, remote.notes || "", "confirmed", now, row.event_id);
        const updatedEvent = db.prepare("SELECT * FROM events WHERE id = ?").get(row.event_id) as EventRow;
        db.prepare("SELECT * FROM event_sync_links WHERE id = ?").get(row.id) as EventSyncLinkRow | undefined;
        markEventSyncSuccess(db, row, remote, updatedEvent, now);
        operations.push({ action: "pull", eventId: row.event_id, title: remote.title });
        continue;
      }
    if (localChanged) {
        upserts.push({ row, payload: calendarEventPayload(event, row.external_calendar || remote.calendarName, row.external_id || remote.id) });
        operations.push({ action: "push", eventId: row.event_id, title: row.title });
        continue;
      }
      db.prepare("SELECT * FROM event_sync_links WHERE id = ?").get(row.id) as EventSyncLinkRow | undefined;
      markEventSyncSuccess(db, row, remote, event, now);
      operations.push({ action: "noop", eventId: row.event_id, title: row.title });
      continue;
    }
    upserts.push({ row, payload: calendarEventPayload(event, row.external_calendar) });
    operations.push({ action: "create", eventId: row.event_id, title: row.title, calendar: row.external_calendar });
  }
  let failed = 0;
  if (upserts.length) {
    for (const upsertItem of upserts) {
      const [ok, error] = runCalendarPushSingle(db, { row: upsertItem.row, payload: upsertItem.payload }, now);
      if (!ok) {
        failed += 1;
        operations.push({ action: "failed", eventId: upsertItem.row.event_id, title: upsertItem.row.title, reason: error });
      }
    }
    const remaining = eventPendingCount(db);
    const syncStats = calendarSyncStatus(db).stats || emptyStats();
    return {
      ok: true,
      apply: true,
      provider: CALENDAR_PROVIDER,
      mode: "full_reconcile",
      batchSize: total,
      processed: links.length - failed,
      failed,
      total,
      remainingPending: remaining,
      pendingBefore,
      pendingAfter: remaining,
      kindSummary: {
        auth: syncStats.kindSummary?.auth || 0,
        timeout: syncStats.kindSummary?.timeout || 0,
        upstream: syncStats.kindSummary?.upstream || 0,
      },
      operations,
      status: calendarSyncStatus(db),
    };
  }
  const remaining = eventPendingCount(db);
  const syncStats = calendarSyncStatus(db).stats || emptyStats();
  return {
    ok: true,
    apply: true,
    provider: CALENDAR_PROVIDER,
    mode: "full_reconcile",
    batchSize: total,
    processed: total - failed,
    failed: 0,
    total,
    remainingPending: remaining,
    pendingBefore,
    pendingAfter: remaining,
    kindSummary: {
      auth: syncStats.kindSummary?.auth || 0,
      timeout: syncStats.kindSummary?.timeout || 0,
      upstream: syncStats.kindSummary?.upstream || 0,
    },
    operations,
    status: calendarSyncStatus(db),
  };
}

function syncSingleCalendarPayload(db: Db, row: EventSyncPayloadRow, now: string) {
  return runCalendarPushSingle(db, row, now);
}

function runCalendarPushSingleWithRecovery(db: Db, row: EventSyncPayloadRow, now: string) {
  return runCalendarPushSingle(db, row, now);
}

function markEventSyncFailure(db: Db, row: EventSyncLinkRow, now: string, error: string, options: { resetExternalId?: boolean } = {}) {
  const schema = eventSyncLinkSchema(db);
  const nextRetry = Number(row.retry_count || 0) + 1;
  const shouldBlock = nextRetry >= CALENDAR_SYNC_MAX_RETRIES;
  const status = shouldBlock ? "blocked" : "error";
  const blockedValue = shouldBlock ? 1 : 0;
  const reason = sanitizeError(error || "calendar_upsert_failed");
  const kind = syncFailureKind(reason);
  const setSql = eventFailureSetSql(schema, options);
  const args: Array<string | number | null> = [status, reason, now];
  if (schema.hasLastErrorAt) args.push(now);
  if (schema.hasLastErrorKind) args.push(kind);
  if (schema.hasRetryCount) args.push(nextRetry);
  if (schema.hasBlocked) args.push(blockedValue);
  args.push(row.id);
  db.prepare(`UPDATE event_sync_links SET ${setSql.join(", ")} WHERE id = ?`).run(...args);
}

function markEventSyncSuccess(db: Db, row: EventSyncLinkRow, remote: { id?: string; calendarName?: string | null; eventId?: string | null }, event: EventRow | undefined, now: string) {
  const schema = eventSyncLinkSchema(db);
  const safeCalendar = normalizeCalendarName(remote.calendarName || row.external_calendar || "OpenClaw");
  const syncHash = eventHash(event, safeCalendar);
  const setSql = eventSuccessSetSql(schema);
  db.prepare(`
    UPDATE event_sync_links
    SET ${setSql.join(", ")}
    WHERE event_id = ? AND provider = ?
  `).run(remote.id || null, safeCalendar, syncHash, now, now, row.event_id, CALENDAR_PROVIDER);
}

function syncFailureKind(error: string) {
  const normalized = String(error || "").toLowerCase();
  if (normalized.includes("not authorized") || normalized.includes("unauthorized") || normalized.includes("permission") || normalized.includes("kerror") || normalized.includes("kerror")) return "auth";
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "timeout";
  return "upstream";
}

function eventPendingCount(db: Db) {
  const schema = eventSyncLinkSchema(db);
  const row = db.prepare(eventPendingCountSql(schema)).get(CALENDAR_PROVIDER) as { count?: number } | undefined;
  return Number(row?.count || 0);
}

function selectEventSyncLinks(db: Db, options: {
  statuses?: string[];
  limit?: number;
  external?: "missing" | "present";
  includeBlocked?: boolean;
  errorKind?: "timeout" | "not_timeout";
  timeoutRetryWindowMs?: number;
  now?: string;
} = {}) {
  const schema = eventSyncLinkSchema(db);
  const statuses = (options.statuses || []).filter(Boolean);
  const statusSql = statuses.length ? `AND l.status IN (${statuses.map(() => "?").join(", ")})` : "";
  const externalSql = options.external === "missing"
    ? "AND (l.external_id IS NULL OR l.external_id = '')"
    : options.external === "present"
      ? "AND (l.external_id IS NOT NULL AND l.external_id != '')"
      : "";
  const errorKindSql = !schema.hasLastErrorKind || !options.errorKind
    ? ""
    : options.errorKind === "timeout"
      ? "AND COALESCE(l.last_error_kind, '') = 'timeout'"
      : "AND (COALESCE(l.last_error_kind, '') != 'timeout')";
  const timeoutWindowSql = options.errorKind !== "timeout" || !schema.hasLastErrorAt || !options.timeoutRetryWindowMs || !options.now
    ? ""
    : "AND (l.last_error_at IS NOT NULL AND l.last_error_at <= ?)";
  const blockedSql = options.includeBlocked ? "" : eventBlockedClause(schema);
  const limitSql = options.limit ? "LIMIT ?" : "";
  const args: Array<string | number> = [CALENDAR_PROVIDER, ...statuses];
  if (timeoutWindowSql) {
    const now = options.now || nowIso();
    const timeoutWindowMs = Number(options.timeoutRetryWindowMs || 0);
    const cutoff = new Date(new Date(now).getTime() - timeoutWindowMs).toISOString();
    args.push(cutoff);
  }
  if (options.limit) args.push(options.limit);
  return db.prepare(`
    SELECT l.*, e.title, e.start_at, e.end_at, e.notes, e.event_type, e.status event_status, e.updated_at event_updated_at
    FROM event_sync_links l
    JOIN events e ON e.id = l.event_id
    WHERE l.provider = ?
      ${statusSql}
      ${externalSql}
      ${errorKindSql}
      ${timeoutWindowSql}
      ${blockedSql}
    ORDER BY CASE WHEN l.external_id IS NULL OR l.external_id = '' THEN 0 ELSE 1 END, l.updated_at ASC
    ${limitSql}
  `).all(...args) as Array<EventSyncLinkRow & EventRow & { event_status?: string; event_updated_at?: string | null }>;
}

function calendarBatchSize(value?: number) {
  const parsed = Number(value || CALENDAR_PUSH_BATCH_SIZE);
  if (!Number.isFinite(parsed)) return CALENDAR_PUSH_BATCH_SIZE;
  return Math.min(20, Math.max(1, Math.floor(parsed)));
}

function reminderBackfillEventSyncLinks(db: Db, limit = 80) {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = db.prepare(`
    SELECT e.id
    FROM events e
    LEFT JOIN event_sync_links l ON l.event_id = e.id AND l.provider = ?
    WHERE l.id IS NULL
    ORDER BY e.updated_at DESC
    LIMIT ?
  `).all(CALENDAR_PROVIDER, safeLimit) as Array<{ id: string }>;
  for (const row of rows) {
    ensureEventCalendarSyncLink(db, row.id);
  }
  return rows.length;
}

function selectCalendarPendingBatch(db: Db, batchSize: number) {
  const now = nowIso();
  const nonTimeoutSlots = Math.max(1, Math.min(batchSize, CALENDAR_NON_TIMEOUT_MAX_BATCH));
  const timeoutSlots = Math.max(1, Math.min(batchSize - nonTimeoutSlots, CALENDAR_TIMEOUT_RETRY_MAX_BATCH));

  const fresh = selectEventSyncLinks(db, { statuses: ["pending"], limit: nonTimeoutSlots, external: "missing" });
  if (fresh.length >= nonTimeoutSlots) return fresh;
  const remaining = nonTimeoutSlots - fresh.length;
  const withExternal = selectEventSyncLinks(db, { statuses: ["pending"], limit: remaining, external: "present" });
  if (fresh.length + withExternal.length >= nonTimeoutSlots) return [...fresh, ...withExternal];

  const remainingForErrors = nonTimeoutSlots - fresh.length - withExternal.length;
  const retryErrors = selectEventSyncLinks(db, {
    statuses: ["error"],
    limit: remainingForErrors,
    external: "missing",
    errorKind: "not_timeout",
  });
  if (fresh.length + withExternal.length + retryErrors.length >= nonTimeoutSlots) return [...fresh, ...withExternal, ...retryErrors];

  const remainingErrorsWithExternal = nonTimeoutSlots - fresh.length - withExternal.length - retryErrors.length;
  const retryErrorsWithExternal = selectEventSyncLinks(db, {
    statuses: ["error"],
    limit: remainingErrorsWithExternal,
    external: "present",
    errorKind: "not_timeout",
  });

  const timeoutRowsMissingExternal = selectEventSyncLinks(db, {
    statuses: ["error"],
    limit: timeoutSlots,
    external: "missing",
    errorKind: "timeout",
    timeoutRetryWindowMs: CALENDAR_TIMEOUT_RETRY_STALE_MS,
    now,
  });
  const timeoutRowsWithExternal = timeoutRowsMissingExternal.length >= timeoutSlots
    ? []
    : selectEventSyncLinks(db, {
      statuses: ["error"],
      limit: timeoutSlots - timeoutRowsMissingExternal.length,
      external: "present",
      errorKind: "timeout",
      timeoutRetryWindowMs: CALENDAR_TIMEOUT_RETRY_STALE_MS,
      now,
    });

  return [
    ...fresh,
    ...withExternal,
    ...retryErrors,
    ...retryErrorsWithExternal,
    ...timeoutRowsMissingExternal,
    ...timeoutRowsWithExternal,
  ].slice(0, batchSize);
}

function chunkArray<T>(items: T[], size: number) {
  const safeSize = Math.max(1, Math.floor(size) || 1);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) chunks.push(items.slice(i, i + safeSize));
  return chunks;
}

function resolveCalendarConflict(db: Db, conflictId: string, decision: "local" | "remote" | "dismiss") {
  const row = db.prepare("SELECT * FROM event_sync_conflicts WHERE id = ? AND provider = ?").get(conflictId, CALENDAR_PROVIDER) as { event_id?: string | null; remote_value: string; status: string } | undefined;
  if (!row) return { ok: false, error: "not_found" };
  const now = nowIso();
  if (decision === "remote" && row.event_id) {
    const remote = parseJson<Record<string, unknown>>(row.remote_value, {});
    db.prepare("UPDATE events SET title = ?, start_at = ?, end_at = ?, notes = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(String(remote.title || "未命名日程"), String(remote.startAt || "") || now, String(remote.endAt || "") || null, String(remote.notes || ""), "confirmed", now, row.event_id);
    const updatedEvent = db.prepare("SELECT * FROM events WHERE id = ?").get(row.event_id) as EventRow | undefined;
    db.prepare("UPDATE event_sync_links SET sync_hash = ?, status = 'pending', error = '', updated_at = ? WHERE event_id = ? AND provider = ?")
      .run(eventHash(updatedEvent, String(remote.calendarName || "OpenClaw")), now, row.event_id, CALENDAR_PROVIDER);
  } else if (decision === "local" && row.event_id) {
    db.prepare("UPDATE event_sync_links SET status = 'pending', error = '', updated_at = ? WHERE event_id = ? AND provider = ?").run(now, row.event_id, CALENDAR_PROVIDER);
  }
  db.prepare("UPDATE event_sync_conflicts SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?").run(decision, now, now, conflictId);
  return { ok: true, status: macosSyncStatus(db) };
}

function upsertRemoteCalendarEvents(items: Array<Record<string, unknown>>) {
  const script = `
function run(argv) {
  const payload = JSON.parse(argv[0] || "[]");
  const app = Application("${MACOS_CALENDAR_APP}");
  app.includeStandardAdditions = true;
  function ensureCalendar(name) {
    const calendars = app.calendars();
    for (let i = 0; i < calendars.length; i++) {
      if (calendars[i].name() === name) return calendars[i];
    }
    const calendar = app.Calendar({ name });
    app.calendars.push(calendar);
    return app.calendars.byName(name);
  }
  function markerFor(eventId) { return "${CALENDAR_MARKER_PREFIX}" + eventId; }
  function cleanDescription(value) {
    return String(value || "").split("\\n").filter(function(line) { return line.indexOf("${CALENDAR_MARKER_PREFIX}") !== 0; }).join("\\n").trim();
  }
  function eventExternalId(event, fallback) {
    try { return event.uid(); } catch (_) {}
    try { return event.id(); } catch (_) {}
    return fallback;
  }
  function findEvent(eventId, targetCalendar) {
    const marker = markerFor(eventId);
    const calendars = targetCalendar ? [ensureCalendar(targetCalendar)] : app.calendars();
    for (let c = 0; c < calendars.length; c++) {
      const events = calendars[c].events();
      for (let i = 0; i < events.length; i++) {
        let description = "";
        try { description = events[i].description(); } catch (_) {}
        if (String(description || "").indexOf(marker) >= 0) return events[i];
      }
    }
    return null;
  }
  function iso(value) {
    if (!value) return null;
    try { return new Date(value).toISOString(); } catch (_) { return null; }
  }
  function endDateFor(item) {
    if (item.endAt) return new Date(item.endAt);
    const start = item.startAt ? new Date(item.startAt) : new Date();
    return new Date(start.getTime() + 60 * 60 * 1000);
  }
  const out = [];
  for (let i = 0; i < payload.length; i++) {
    const item = payload[i];
    const calendar = ensureCalendar(item.calendarName || "OpenClaw");
    let event = findEvent(item.eventId, item.calendarName);
    const description = [cleanDescription(item.notes || ""), markerFor(item.eventId)].filter(Boolean).join("\\n");
    if (!event) {
      event = app.Event({ summary: item.title || "OpenClaw 日程", startDate: new Date(item.startAt || new Date()), endDate: endDateFor(item), description });
      calendar.events.push(event);
    }
    event.summary = item.title || "OpenClaw 日程";
    event.startDate = new Date(item.startAt || new Date());
    event.endDate = endDateFor(item);
    event.description = description;
    out.push({ id: eventExternalId(event, markerFor(item.eventId)), title: event.summary(), notes: cleanDescription(event.description()), startAt: iso(event.startDate()), endAt: iso(event.endDate()), calendarName: calendar.name(), eventId: item.eventId });
  }
  return JSON.stringify(out);
}`;
  return runCalendarJxa<RemoteCalendarEvent[]>(script, items);
}

function readRemoteCalendarEvents() {
  const script = `
function run() {
  const app = Application("${MACOS_CALENDAR_APP}");
  app.includeStandardAdditions = true;
  function iso(value) {
    if (!value) return null;
    try { return new Date(value).toISOString(); } catch (_) { return null; }
  }
  function cleanDescription(value) {
    return String(value || "").split("\\n").filter(function(line) { return line.indexOf("${CALENDAR_MARKER_PREFIX}") !== 0; }).join("\\n").trim();
  }
  function eventExternalId(event, fallback) {
    try { return event.uid(); } catch (_) {}
    try { return event.id(); } catch (_) {}
    return fallback;
  }
  const out = [];
  const calendars = app.calendars();
  for (let c = 0; c < calendars.length; c++) {
    const calendarName = calendars[c].name();
    if (String(calendarName).indexOf("OpenClaw") !== 0) continue;
    const events = calendars[c].events();
    for (let i = 0; i < events.length; i++) {
      let description = "";
      try { description = events[i].description(); } catch (_) {}
      const marker = String(description || "").match(/${CALENDAR_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\s]+)/);
      if (!marker) continue;
      out.push({ id: eventExternalId(events[i], marker[1]), title: events[i].summary(), notes: cleanDescription(description), startAt: iso(events[i].startDate()), endAt: iso(events[i].endDate()), calendarName, eventId: marker[1] });
    }
  }
  return JSON.stringify(out);
}`;
  return runCalendarJxa<RemoteCalendarEvent[]>(script, []);
}

function runCalendarJxa<T>(script: string, payload: unknown) {
  const args = ["-l", "JavaScript", "-e", script];
  if (Array.isArray(payload) ? payload.length : payload) args.push(JSON.stringify(payload));
  const result = spawnSync("osascript", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: CALENDAR_OSASCRIPT_TIMEOUT_MS, killSignal: "SIGTERM" });
  if (result.error && "code" in result.error && result.error.code === "ETIMEDOUT") return { ok: false as const, error: `macos_calendar_timeout_${CALENDAR_OSASCRIPT_TIMEOUT_MS}ms` };
  if (result.status !== 0) return { ok: false as const, error: sanitizeError(result.stderr || result.error?.message || "osascript_failed") };
  try {
    return { ok: true as const, events: JSON.parse(result.stdout || "[]") as T };
  } catch (err) {
    return { ok: false as const, error: sanitizeError(err instanceof Error ? err.message : String(err)) };
  }
}

function linkEventRow(row: EventSyncLinkRow & EventRow & { event_status?: string; event_updated_at?: string | null }): EventRow {
  return {
    id: row.event_id,
    title: row.title,
    start_at: row.start_at,
    end_at: row.end_at || null,
    notes: row.notes || "",
    event_type: row.event_type || "schedule",
    status: row.event_status || row.status || "confirmed",
    updated_at: row.event_updated_at || row.updated_at,
  };
}

function calendarEventPayload(event: EventRow, calendarName?: string, externalId?: string | null) {
  return {
    eventId: event.id,
    externalId: externalId || null,
    title: event.title || "OpenClaw 日程",
    notes: event.notes || "",
    startAt: event.start_at || nowIso(),
    endAt: event.end_at || null,
    calendarName: normalizeCalendarName(calendarName || "OpenClaw"),
  };
}

function eventHash(event: EventRow | undefined, calendarName?: string) {
  if (!event) return "";
  return hashJson({
    title: event.title || "",
    startAt: normalizeDateTime(event.start_at),
    endAt: normalizeDateTime(event.end_at),
    notes: String(event.notes || "").trim(),
    calendarName: normalizeCalendarName(calendarName || "OpenClaw"),
  });
}

function remoteCalendarEventHash(remote: RemoteCalendarEvent) {
  return hashJson({
    title: remote.title || "",
    startAt: normalizeDateTime(remote.startAt),
    endAt: normalizeDateTime(remote.endAt),
    notes: String(remote.notes || "").trim(),
    calendarName: normalizeCalendarName(remote.calendarName || "OpenClaw"),
  });
}

function upsertCalendarConflict(db: Db, eventId: string, externalId: string, field: string, localValue: string, remoteValue: string, recommendation: string) {
  const existing = db.prepare("SELECT id FROM event_sync_conflicts WHERE event_id = ? AND provider = ? AND external_id = ? AND field = ? AND status = 'pending'")
    .get(eventId, CALENDAR_PROVIDER, externalId, field) as { id: string } | undefined;
  const now = nowIso();
  if (existing) {
    db.prepare("UPDATE event_sync_conflicts SET local_value = ?, remote_value = ?, recommendation = ?, updated_at = ? WHERE id = ?")
      .run(localValue, remoteValue, recommendation, now, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare("INSERT INTO event_sync_conflicts (id, event_id, provider, external_id, field, local_value, remote_value, status, recommendation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, eventId, CALENDAR_PROVIDER, externalId, field, localValue, remoteValue, "pending", recommendation, now, now);
  return id;
}

function eventConflictShape(event: EventRow, calendarName?: string) {
  return { title: event.title || "", startAt: event.start_at || null, endAt: event.end_at || null, notes: event.notes || "", calendarName: normalizeCalendarName(calendarName || "OpenClaw") };
}

function remoteEventConflictShape(remote: RemoteCalendarEvent) {
  return { title: remote.title || "", startAt: remote.startAt || null, endAt: remote.endAt || null, notes: remote.notes || "", calendarName: normalizeCalendarName(remote.calendarName || "OpenClaw") };
}

function calendarNameForEvent() {
  return "OpenClaw";
}

function normalizeCalendarName(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "OpenClaw";
  if (raw === "OpenClaw" || raw.startsWith("OpenClaw-")) return raw;
  return `OpenClaw-${raw}`;
}

function normalizeDateTime(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const date = new Date(raw.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? raw.slice(0, 16) : date.toISOString().slice(0, 16);
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value || "")) as T;
  } catch {
    return fallback;
  }
}

function sanitizeError(value: unknown) {
  return String(value || "unknown_error")
    .replace(/\s+/g, " ")
    .replace(/\/Users\/[^ ]+/g, "[path]")
    .slice(0, 800);
}

function emptyStats() {
  return {
    total: 0,
    pending: 0,
    synced: 0,
    conflict: 0,
    error: 0,
    retryable: 0,
    blocked: 0,
    retryableError: 0,
    blockedError: 0,
    kindSummary: emptySyncFailureSummary(),
  };
}

function combineStats(a: ReturnType<typeof emptyStats>, b: ReturnType<typeof emptyStats>) {
  const normalize = (value: number | undefined) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const aRetryable = normalize(a.retryable);
  const bRetryable = normalize(b.retryable);
  const aBlocked = normalize(a.blocked);
  const bBlocked = normalize(b.blocked);
  const aError = normalize(a.error);
  const bError = normalize(b.error);
  const aKind = a.kindSummary || emptySyncFailureSummary();
  const bKind = b.kindSummary || emptySyncFailureSummary();
  return {
    total: normalize(a.total) + normalize(b.total),
    pending: normalize(a.pending) + normalize(b.pending),
    synced: normalize(a.synced) + normalize(b.synced),
    conflict: normalize(a.conflict) + normalize(b.conflict),
    retryable: aRetryable + bRetryable,
    blocked: aBlocked + bBlocked,
    retryableError: aRetryable + bRetryable,
    blockedError: aBlocked + bBlocked,
    error: aError + bError,
    kindSummary: {
      auth: Number(aKind.auth || 0) + Number(bKind.auth || 0),
      timeout: Number(aKind.timeout || 0) + Number(bKind.timeout || 0),
      upstream: Number(aKind.upstream || 0) + Number(bKind.upstream || 0),
    },
  };
}

function prefixConflict(kind: "todo" | "event", row: Record<string, unknown>) {
  const rawId = String(row.id || "");
  return { ...row, id: `${kind}:${rawId}`, conflict_id: rawId, kind };
}

function parseConflictId(conflictId: string): ["todo" | "event" | "", string] {
  if (conflictId.startsWith("todo:")) return ["todo", conflictId.slice(5)];
  if (conflictId.startsWith("event:")) return ["event", conflictId.slice(6)];
  return ["", conflictId];
}

function skippedSyncResult(kind: "todos" | "events", input: CalendarSyncInput) {
  return {
    ok: true,
    apply: Boolean(input.apply),
    provider: kind === "todos" ? "macos_reminders" : "macos_calendar",
    processed: 0,
    failed: 0,
    remainingPending: 0,
    pendingBefore: 0,
    pendingAfter: 0,
    kindSummary: emptySyncFailureSummary(),
    total: 0,
    skipped: true,
    operations: [],
    message: "",
  };
}

function latestMacosSyncRun(db: Db) {
  const rows = db.prepare(`
    SELECT ts, action, details
    FROM audit_logs
    WHERE action IN ('macos.sync.run', 'macos.sync.background_completed', 'macos.sync.background_partial', 'macos.sync.background_failed')
    ORDER BY ts DESC
    LIMIT 20
  `).all() as Array<{ ts?: string; action?: string; details?: string }>;
  const row = rows.find((candidate) => {
    if (candidate.action !== "macos.sync.run") return true;
    const details = parseJson<Record<string, unknown>>(candidate.details, {});
    return details.apply === true;
  });
  if (!row) return { lastRunAt: null, lastRunOk: null, lastError: null, lastDurationMs: null };
  const details = parseJson<Record<string, unknown>>(row.details, {});
  const ok = typeof details.ok === "boolean"
    ? details.ok
    : row.action === "macos.sync.background_completed" || row.action === "macos.sync.background_partial";
  const duration = Number(details.durationMs || details.lastDurationMs || 0);
  return {
    lastRunAt: row.ts || null,
    lastRunOk: ok,
    lastError: ok ? null : String(details.error || details.message || "sync_failed"),
    lastDurationMs: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

function errorOf(result: unknown) {
  const row = result as { ok?: boolean; error?: unknown; message?: unknown };
  return row?.ok === false ? String(row.error || row.message || "sync_failed") : "";
}
