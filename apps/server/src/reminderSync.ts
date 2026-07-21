import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { Db } from "./db.js";
import { nowIso } from "./config.js";

const REMINDERS_PROVIDER = "macos_reminders";
const IMPORT_MARKER_PREFIX = "openclaw:import:";
const TODO_MARKER_PREFIX = "openclaw:todo:";
const DEFAULT_WORK_PLAN_PATH = "/Volumes/南极熊-1/01人生规划/自我修炼/年度工作计划20260522.xlsx";
const DEFAULT_PERSONAL_PATH = "/Volumes/南极熊-1/01人生规划/自我修炼/个人事项20260522.xlsx";
const MACOS_REMINDERS_APP = "/System/Applications/Reminders.app";
const REMINDERS_OSASCRIPT_TIMEOUT_MS = Math.max(8_000, Number(process.env.OPENCLAW_REMINDERS_OSASCRIPT_TIMEOUT_MS || 60_000));
const REMINDERS_PUSH_BATCH_SIZE = Math.min(20, Math.max(1, Number(process.env.OPENCLAW_REMINDERS_PUSH_BATCH_SIZE || 8)));
const REMINDER_TIMEOUT_RETRY_STALE_MS = Math.max(60_000, Number(process.env.OPENCLAW_REMINDER_TIMEOUT_RETRY_STALE_MS || 120_000));
const REMINDER_TIMEOUT_RETRY_MAX_BATCH = Math.max(1, Number(process.env.OPENCLAW_REMINDER_TIMEOUT_RETRY_BATCH || 1));
const REMINDER_NON_TIMEOUT_MAX_BATCH = Math.max(1, Number(process.env.OPENCLAW_REMINDER_NON_TIMEOUT_BATCH || 8));
const REMINDER_SYNC_MAX_RETRIES = Math.max(1, Number(process.env.OPENCLAW_MACOS_SYNC_MAX_RETRIES || 3));

type ImportPreviewInput = {
  workPlanPath?: string;
  personalPath?: string;
  include2025?: boolean;
  includeCompletedPersonal?: boolean;
};

type CommitInput = ImportPreviewInput & {
  itemKeys?: string[];
};

type ImportItem = {
  key: string;
  sourceFile: string;
  sheet: string;
  rowIndex: number;
  itemType: "work_plan" | "personal_todo" | "life_plan";
  planType?: "work" | "life";
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  agentId: string;
  listName: string;
  tags: string[];
  notes: string;
  rawFields: Record<string, string>;
  fieldOrder: string[];
  externalList: string;
  importHash: string;
  existingTodoId?: string;
  existingPlanItemId?: string;
  planItemId?: string;
  action: "create" | "update" | "duplicate" | "skipped";
  reason?: string;
};

type TodoRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_at?: string | null;
  tags?: string | null;
  list_name?: string | null;
  agent_id?: string | null;
  notes?: string | null;
  updated_at?: string | null;
};

type SyncLinkRow = {
  id: string;
  todo_id: string;
  provider: string;
  external_id?: string | null;
  external_list: string;
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

type SyncTodoLinkRow = SyncLinkRow & TodoRow & { todo_status: string; todo_updated_at?: string | null };

type RemoteReminder = {
  id: string;
  title: string;
  body: string;
  dueAt: string | null;
  completed: boolean;
  listName: string;
  modifiedAt?: string | null;
  todoId?: string;
};

type ReminderSyncInput = {
  apply?: boolean;
  trigger?: string;
  mode?: "push_pending" | "full_reconcile";
  batchSize?: number;
  scope?: string;
};

type SyncFailureKind = "auth" | "timeout" | "upstream";

type SyncFailureSummary = {
  auth: number;
  timeout: number;
  upstream: number;
};

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

function collectSyncFailureSummary(rows: SyncLinkRow[], schema: LinkSchema) {
  const summary = emptySyncFailureSummary();
  for (const row of rows) {
    const isFailure = row.status === "error" || row.status === "blocked" || isTodoLinkBlocked(row, schema);
    if (!isFailure) continue;
    const kind = normalizeSyncFailureKind(String(row.last_error_kind || syncFailureKind(row.error || "")));
    summary[kind] += 1;
  }
  return summary;
}

type LinkSchema = {
  hasRetryCount: boolean;
  hasLastErrorAt: boolean;
  hasLastErrorKind: boolean;
  hasBlocked: boolean;
};

type SyncRepairSummary = {
  repaired: number;
  details: string[];
};

function syncRepairSet(db: Db, id: string, schema: LinkSchema, updates: {
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
  db.prepare(`UPDATE todo_sync_links SET ${setSql.join(", ")} WHERE id = ?`).run(...args, id);
}

export function repairTodoMacosSyncState(db: Db): SyncRepairSummary {
  const schema = reminderSyncLinkSchema(db);
  const now = nowIso();
  const details: string[] = [];
  let repaired = 0;

  const missingTodoLinks = db.prepare(`
    SELECT l.id, l.todo_id, l.status, l.error, l.retry_count
    FROM todo_sync_links l
    LEFT JOIN todos t ON t.id = l.todo_id
    WHERE l.provider = ? AND t.id IS NULL
  `).all(REMINDERS_PROVIDER) as Array<SyncLinkRow>;
  for (const row of missingTodoLinks) {
    syncRepairSet(db, row.id, schema, {
      status: "blocked",
      error: row.error || "todo_not_found",
      retryCount: schema.hasRetryCount ? 0 : undefined,
      lastErrorKind: schema.hasLastErrorKind ? "upstream" : undefined,
      lastErrorAt: schema.hasLastErrorAt ? now : undefined,
      blocked: schema.hasBlocked ? 1 : undefined,
    });
    repaired += 1;
    details.push(`todo_sync_link_orphan: ${row.id}`);
  }

  if (schema.hasLastErrorKind) {
    const rows = db.prepare(`
      SELECT id, error
      FROM todo_sync_links
      WHERE provider = ? AND status = 'error' AND COALESCE(last_error_kind, '') = ''
    `).all(REMINDERS_PROVIDER) as Array<{ id: string; error: string }>;
    for (const row of rows) {
      const kind = syncFailureKind(row.error || "");
      syncRepairSet(db, row.id, schema, { lastErrorKind: kind });
      repaired += 1;
      details.push(`todo_sync_link_repair_kind: ${row.id}`);
    }
  }

  if (schema.hasLastErrorAt) {
    const rows = db.prepare(`
      SELECT id
      FROM todo_sync_links
      WHERE provider = ? AND status = 'error' AND last_error_at IS NULL
    `).all(REMINDERS_PROVIDER) as Array<{ id: string }>;
    for (const row of rows) {
      syncRepairSet(db, row.id, schema, { lastErrorAt: now });
      repaired += 1;
      details.push(`todo_sync_link_repair_error_time: ${row.id}`);
    }
  }

  if (schema.hasRetryCount) {
    const rows = db.prepare(`
      SELECT id
      FROM todo_sync_links
      WHERE provider = ? AND retry_count IS NULL
    `).all(REMINDERS_PROVIDER) as Array<{ id: string }>;
    for (const row of rows) {
      syncRepairSet(db, row.id, schema, { retryCount: 0 });
      repaired += 1;
      details.push(`todo_sync_link_repair_retry_count: ${row.id}`);
    }
  }

  if (schema.hasBlocked) {
    const rows = db.prepare(`
      SELECT id
      FROM todo_sync_links
      WHERE provider = ? AND status = 'blocked' AND COALESCE(blocked, 0) = 0
    `).all(REMINDERS_PROVIDER) as Array<{ id: string }>;
    for (const row of rows) {
      syncRepairSet(db, row.id, schema, { blocked: 1 });
      repaired += 1;
      details.push(`todo_sync_link_repair_blocked: ${row.id}`);
    }
  }

  return { repaired, details };
}

export function reminderImportDefaults() {
  return {
    workPlanPath: DEFAULT_WORK_PLAN_PATH,
    personalPath: DEFAULT_PERSONAL_PATH,
  };
}

function reminderSyncLinkSchema(db: Db): LinkSchema {
  const rows = db.prepare("PRAGMA table_info(todo_sync_links)").all() as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  return {
    hasRetryCount: names.has("retry_count"),
    hasLastErrorAt: names.has("last_error_at"),
    hasLastErrorKind: names.has("last_error_kind"),
    hasBlocked: names.has("blocked"),
  };
}

function isTodoLinkBlocked(row: SyncLinkRow, schema: LinkSchema) {
  return schema.hasBlocked ? Number(row.blocked || 0) === 1 : false;
}

function todoLinkBlockedClause(schema: LinkSchema) {
  return schema.hasBlocked ? "AND (l.blocked IS NULL OR l.blocked = 0)" : "";
}

function todoPendingCountSql(schema: LinkSchema) {
  return schema.hasBlocked
    ? "SELECT COUNT(*) AS count FROM todo_sync_links WHERE provider = ? AND (status = 'pending' OR (status = 'error' AND (blocked IS NULL OR blocked = 0)))"
    : "SELECT COUNT(*) AS count FROM todo_sync_links WHERE provider = ? AND (status = 'pending' OR status = 'error')";
}

function todoFailureSetSql(schema: LinkSchema, options: { resetExternalId?: boolean } = {}) {
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

function todoSuccessSetSql(schema: LinkSchema) {
  const setSql = [
    "external_id = ?",
    "external_list = ?",
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

export function previewReminderImport(db: Db, input: ImportPreviewInput = {}) {
  const items = buildImportItems(input);
  const classified = classifyImportItems(db, items);
  return buildImportPreview(classified);
}

export function commitReminderImport(db: Db, input: CommitInput = {}) {
  const allItems = classifyImportItems(db, buildImportItems(input));
  const selected = new Set(input.itemKeys || []);
  const importable = allItems.filter((item) => item.action !== "skipped" && item.action !== "duplicate" && (!selected.size || selected.has(item.key)));
  const now = nowIso();
  const created: TodoRow[] = [];
  const updated: TodoRow[] = [];
  const skipped: ImportItem[] = [];
  const insertTodo = db.prepare("INSERT INTO todos (id, title, status, priority, due_at, project_id, created_at, updated_at, tags, list_name, agent_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const updateTodo = db.prepare("UPDATE todos SET title = ?, status = ?, priority = ?, due_at = ?, tags = ?, list_name = ?, agent_id = ?, notes = ?, updated_at = ? WHERE id = ?");
  const insertPlanItem = db.prepare(`
    INSERT INTO plan_items (id, plan_type, import_key, import_hash, source_file, source_sheet, source_row, title, status, priority, due_at, agent_id, list_name, tags, raw_fields, field_order, todo_id, followed, sync_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updatePlanItem = db.prepare(`
    UPDATE plan_items SET import_hash = ?, source_file = ?, source_sheet = ?, source_row = ?, title = ?, status = ?, priority = ?, due_at = ?, agent_id = ?, list_name = ?, tags = ?, raw_fields = ?, field_order = ?, todo_id = ?, sync_status = ?, updated_at = ? WHERE id = ?
  `);
  for (const item of allItems) {
    if (item.action === "skipped" || item.action === "duplicate" || (selected.size && !selected.has(item.key))) {
      skipped.push(item);
      continue;
    }
    const notes = appendImportMarkers(item.notes, item.key, item.importHash);
    const planId = item.planType ? (item.existingPlanItemId || randomUUID()) : "";
    let todoId = item.existingTodoId || "";
    if (item.action === "update" && todoId) {
      updateTodo.run(item.title, item.status, item.priority, item.dueAt, JSON.stringify(item.tags), item.listName, item.agentId, notes, now, todoId);
      ensureTodoReminderSyncLink(db, todoId, item.externalList, item.importHash, "pending");
      const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(todoId) as TodoRow;
      updated.push(row);
    } else {
      todoId = randomUUID();
      insertTodo.run(todoId, item.title, item.status, item.priority, item.dueAt, null, now, now, JSON.stringify(item.tags), item.listName, item.agentId, notes);
      ensureTodoReminderSyncLink(db, todoId, item.externalList, item.importHash, "pending");
      const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(todoId) as TodoRow;
      created.push(row);
    }
    if (item.planType) {
      const planArgs = [
        item.importHash,
        item.sourceFile,
        item.sheet,
        item.rowIndex,
        item.title,
        item.status,
        item.priority,
        item.dueAt,
        item.agentId,
        item.listName,
        JSON.stringify(item.tags),
        JSON.stringify(item.rawFields || {}),
        JSON.stringify(item.fieldOrder || []),
        todoId,
        "pending",
      ];
      if (item.existingPlanItemId) updatePlanItem.run(...planArgs, now, item.existingPlanItemId);
      else insertPlanItem.run(planId, item.planType, item.key, ...planArgs, 0, now, now);
      item.planItemId = item.existingPlanItemId || planId;
    }
  }
  return {
    ok: true,
    created,
    updated,
    skipped: skipped.length,
    preview: buildImportPreview(classifyImportItems(db, buildImportItems(input))),
  };
}

export function reminderSyncStatus(db: Db) {
  const schema = reminderSyncLinkSchema(db);
  const links = db.prepare("SELECT * FROM todo_sync_links WHERE provider = ? ORDER BY updated_at DESC").all(REMINDERS_PROVIDER) as SyncLinkRow[];
  const conflicts = db.prepare("SELECT * FROM todo_sync_conflicts WHERE provider = ? AND status = 'pending' ORDER BY updated_at DESC").all(REMINDERS_PROVIDER);
  const retryableErrors = links.filter((row) => row.status === "error" && !isTodoLinkBlocked(row, schema)).length;
  const blockedErrors = links.filter((row) => row.status === "blocked" || isTodoLinkBlocked(row, schema)).length;
  const timeoutErrors = links.filter((row) => row.status === "error" && String(row.last_error_kind || "") === "timeout").length;
  const kindSummary = collectSyncFailureSummary(links, schema);
  const stats = {
    total: links.length,
    pending: links.filter((row) => row.status === "pending").length,
    retryable: retryableErrors,
    timeoutRetryable: timeoutErrors,
    blocked: blockedErrors,
    timeout: timeoutErrors,
    retryableError: retryableErrors,
    timeoutRetryableError: timeoutErrors,
    blockedError: blockedErrors,
    synced: links.filter((row) => row.status === "synced").length,
    conflict: links.filter((row) => row.status === "conflict").length,
    error: retryableErrors + blockedErrors,
    kindSummary,
  };
  const lastSyncedAt = links.map((row) => row.last_synced_at || "").filter(Boolean).sort().at(-1) || null;
  const lists = [...new Set(links.map((row) => row.external_list).filter(Boolean))].sort();
  return {
    ok: true,
    provider: REMINDERS_PROVIDER,
    permissionStatus: "not_checked",
    mode: "双向审阅",
    runner: "OpenClaw Workbench",
    backgroundSync: {
      enabled: process.platform === "darwin" && process.env.OPENCLAW_WORKBENCH_REMINDER_SYNC !== "0",
      intervalMs: Math.max(300_000, Number(process.env.OPENCLAW_WORKBENCH_REMINDER_SYNC_MS || 300_000)),
    },
    stats,
    pendingConflicts: conflicts,
    lists,
    lastSyncedAt,
    recentLinks: links.slice(0, 12),
  };
}

export function ensureTodoReminderSyncLink(db: Db, todoId: string, externalList?: string, syncHash?: string, status = "pending") {
  const schema = reminderSyncLinkSchema(db);
  const now = nowIso();
  const existing = db.prepare("SELECT * FROM todo_sync_links WHERE todo_id = ? AND provider = ?").get(todoId, REMINDERS_PROVIDER) as SyncLinkRow | undefined;
  const list = normalizeReminderListName(externalList || listNameForTodo(db, todoId));
  const hash = syncHash || todoHash(db.prepare("SELECT * FROM todos WHERE id = ?").get(todoId) as TodoRow | undefined);
  if (existing) {
    const setSql = ["external_list = ?", "status = ?", "error = ''", "updated_at = ?"];
    if (schema.hasLastErrorAt) setSql.push("last_error_at = NULL");
    if (schema.hasLastErrorKind) setSql.push("last_error_kind = ''");
    if (schema.hasRetryCount) setSql.push("retry_count = 0");
    if (schema.hasBlocked) setSql.push("blocked = 0");
    db.prepare(`UPDATE todo_sync_links SET ${setSql.join(", ")} WHERE id = ?`).run(list, status, now, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  const columns = ["id", "todo_id", "provider", "external_id", "external_list", "sync_hash", "last_synced_at", "status", "error", "created_at", "updated_at"];
  const values = ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"];
  const params: Array<string | number | null> = [id, todoId, REMINDERS_PROVIDER, null, list, hash, null, status, "", now, now];
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
  db.prepare(`INSERT INTO todo_sync_links (${columns.join(", ")}) VALUES (${values.join(", ")})`).run(...params);
  return id;
}

export function markTodoReminderSyncPending(db: Db, todoId: string, externalList?: string) {
  ensureTodoReminderSyncLink(db, todoId, externalList, undefined, "pending");
}

function reminderBatchSize(value?: number) {
  const parsed = Number(value || REMINDERS_PUSH_BATCH_SIZE);
  if (!Number.isFinite(parsed)) return REMINDERS_PUSH_BATCH_SIZE;
  return Math.min(20, Math.max(1, Math.floor(parsed)));
}

function reminderBackfillLinks(db: Db, limit = 60) {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = db.prepare(`
    SELECT t.id
    FROM todos t
    LEFT JOIN todo_sync_links l ON l.todo_id = t.id AND l.provider = ?
    WHERE l.id IS NULL
    ORDER BY t.updated_at DESC
    LIMIT ?
  `).all(REMINDERS_PROVIDER, safeLimit) as Array<{ id: string }>;
  for (const row of rows) ensureTodoReminderSyncLink(db, row.id);
  return rows.length;
}

function syncFailureKind(error: string) {
  const normalized = String(error || "").toLowerCase();
  if (normalized.includes("not authorized") || normalized.includes("unauthorized") || normalized.includes("permission") || normalized.includes("kerror") || normalized.includes("kerror")) return "auth";
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "timeout";
  return "upstream";
}

function markTodoSyncFailure(db: Db, row: SyncTodoLinkRow, now: string, error: string, options: { resetExternalId?: boolean } = {}) {
  const schema = reminderSyncLinkSchema(db);
  const nextRetry = Number(row.retry_count || 0) + 1;
  const shouldBlock = nextRetry >= REMINDER_SYNC_MAX_RETRIES;
  const status = shouldBlock ? "blocked" : "error";
  const blockedValue = shouldBlock ? 1 : 0;
  const reason = sanitizeError(error || "reminders_upsert_failed");
  const kind = syncFailureKind(reason);
  const setSql = todoFailureSetSql(schema, options);
  const args: Array<string | number | null> = [status, reason, now];
  if (schema.hasLastErrorAt) args.push(now);
  if (schema.hasLastErrorKind) args.push(kind);
  if (schema.hasRetryCount) args.push(nextRetry);
  if (schema.hasBlocked) args.push(blockedValue);
  args.push(row.id);
  db.prepare(`
    UPDATE todo_sync_links
    SET ${setSql.join(", ")}
    WHERE id = ?
  `).run(...args);
}

function markTodoSyncSuccess(db: Db, row: SyncTodoLinkRow, remote: { id?: string; listName?: string | null }, todo: TodoRow | undefined, now: string) {
  const schema = reminderSyncLinkSchema(db);
  const safeList = normalizeReminderListName(remote.listName || row.external_list || "OpenClaw");
  const syncHash = todoHash(todo);
  const setSql = todoSuccessSetSql(schema);
  const args: Array<string | number | null> = [remote.id || null, safeList, syncHash, now, now];
  args.push(row.todo_id, REMINDERS_PROVIDER);
  db.prepare(`
    UPDATE todo_sync_links
    SET ${setSql.join(", ")}
    WHERE todo_id = ? AND provider = ?
  `).run(...args);
}

function selectReminderPendingBatch(db: Db, batchSize: number) {
  const now = nowIso();
  const nonTimeoutSlots = Math.max(1, Math.min(batchSize, REMINDER_NON_TIMEOUT_MAX_BATCH));
  const timeoutSlots = Math.max(1, Math.min(batchSize - nonTimeoutSlots, REMINDER_TIMEOUT_RETRY_MAX_BATCH));
  const fresh = selectReminderLinks(db, { statuses: ["pending"], includeBlocked: false, limit: nonTimeoutSlots, external: "missing" });
  if (fresh.length >= nonTimeoutSlots) return fresh;
  const remaining = nonTimeoutSlots - fresh.length;
  const withExternal = selectReminderLinks(db, { statuses: ["pending"], includeBlocked: false, limit: remaining, external: "present" });
  const nonTimeoutSlotsLeft = nonTimeoutSlots - fresh.length - withExternal.length;
  if (nonTimeoutSlotsLeft <= 0) return [...fresh, ...withExternal];

  const retryErrors = selectReminderLinks(db, {
    statuses: ["error"],
    includeBlocked: false,
    limit: nonTimeoutSlotsLeft,
    external: "missing",
    errorKind: "not_timeout",
  });
  if (fresh.length + withExternal.length + retryErrors.length >= nonTimeoutSlots) return [...fresh, ...withExternal, ...retryErrors];
  const remainingErrorsWithExternal = nonTimeoutSlots - fresh.length - withExternal.length - retryErrors.length;
  const retryErrorsWithExternal = selectReminderLinks(db, {
    statuses: ["error"],
    includeBlocked: false,
    limit: remainingErrorsWithExternal,
    external: "present",
    errorKind: "not_timeout",
  });
  const timeoutRowsMissingExternal = selectReminderLinks(db, {
    statuses: ["error"],
    includeBlocked: false,
    limit: timeoutSlots,
    external: "missing",
    errorKind: "timeout",
    timeoutRetryWindowMs: REMINDER_TIMEOUT_RETRY_STALE_MS,
    now,
  });
  const timeoutRowsWithExternal = timeoutRowsMissingExternal.length >= timeoutSlots
    ? []
    : selectReminderLinks(db, {
      statuses: ["error"],
      includeBlocked: false,
      limit: timeoutSlots - timeoutRowsMissingExternal.length,
      external: "present",
      errorKind: "timeout",
      timeoutRetryWindowMs: REMINDER_TIMEOUT_RETRY_STALE_MS,
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

function selectReminderLinks(db: Db, options: {
  statuses?: string[];
  limit?: number;
  external?: "missing" | "present";
  includeBlocked?: boolean;
  errorKind?: "timeout" | "not_timeout";
  timeoutRetryWindowMs?: number;
  now?: string;
} = {}) {
  const schema = reminderSyncLinkSchema(db);
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
  const blockedSql = options.includeBlocked || !schema.hasBlocked ? "" : "AND (l.blocked IS NULL OR l.blocked = 0)";
  const limitSql = options.limit ? "LIMIT ?" : "";
  const args: Array<string | number> = [REMINDERS_PROVIDER, ...statuses];
  if (timeoutWindowSql) {
    const now = options.now || nowIso();
    const timeoutWindowMs = Number(options.timeoutRetryWindowMs || 0);
    const cutoff = new Date(new Date(now).getTime() - timeoutWindowMs).toISOString();
    args.push(cutoff);
  }
  if (options.limit) args.push(options.limit);
  return db.prepare(`
    SELECT l.*, t.title, t.status todo_status, t.priority, t.due_at, t.tags, t.list_name, t.agent_id, t.notes, t.updated_at todo_updated_at
    FROM todo_sync_links l
    JOIN todos t ON t.id = l.todo_id
    WHERE l.provider = ?
      ${statusSql}
      ${externalSql}
      ${errorKindSql}
      ${timeoutWindowSql}
      ${blockedSql}
    ORDER BY CASE WHEN l.external_id IS NULL OR l.external_id = '' THEN 0 ELSE 1 END, l.updated_at ASC
    ${limitSql}
  `).all(...args) as SyncTodoLinkRow[];
}

function reminderPendingCount(db: Db) {
  const schema = reminderSyncLinkSchema(db);
  const row = db.prepare(todoPendingCountSql(schema)).get(REMINDERS_PROVIDER) as { count?: number } | undefined;
  return Number(row?.count || 0);
}

export function runReminderSync(db: Db, input: ReminderSyncInput = {}) {
  const apply = Boolean(input.apply);
  const mode = input.mode === "full_reconcile" ? "full_reconcile" : "push_pending";
  const batchSize = reminderBatchSize(input.batchSize);
  const pendingBefore = reminderPendingCount(db);
  const links = mode === "push_pending" ? selectReminderPendingBatch(db, batchSize) : selectReminderLinks(db);
  const operations: Array<Record<string, unknown>> = [];
  if (!apply) {
    for (const row of links) {
      operations.push({ action: row.external_id ? "compare" : "create", todoId: row.todo_id, title: row.title, list: row.external_list, status: row.status });
    }
    const pending = reminderPendingCount(db);
    return {
      ok: true,
      apply: false,
      provider: REMINDERS_PROVIDER,
      mode,
      batchSize,
      processed: 0,
      failed: 0,
      remainingPending: pending,
      pendingBefore,
      pendingAfter: pending,
      kindSummary: emptySyncFailureSummary(),
      operations,
      emptyQueue: pending === 0,
      message: pending === 0 ? "没有待同步事项。请先在导入预览里确认导入，或新建/修改待办。" : "",
      status: reminderSyncStatus(db),
    };
  }
  if (!links.length) {
    return {
      ok: true,
      apply: true,
      provider: REMINDERS_PROVIDER,
      mode,
      batchSize,
      processed: 0,
      failed: 0,
      remainingPending: 0,
      pendingBefore,
      pendingAfter: reminderPendingCount(db),
      kindSummary: emptySyncFailureSummary(),
      operations,
      emptyQueue: true,
      message: "没有待同步事项。请先在导入预览里确认导入，或新建/修改待办。",
      status: reminderSyncStatus(db),
    };
  }
  if (mode === "push_pending") return runReminderPushPending(db, links, batchSize, pendingBefore);
  return runReminderFullReconcile(db, links);
}

function runReminderPushPending(db: Db, links: SyncTodoLinkRow[], batchSize: number, pendingBefore = 0) {
  const payloads = links.map((row) => ({
    row,
    payload: remotePayload(linkTodoRow(row), row.external_list, row.external_id || null),
  }));
  const timeoutRows = payloads.filter(({ row }) => String(row.last_error_kind || "") === "timeout");
  const normalRows = payloads.filter(({ row }) => String(row.last_error_kind || "") !== "timeout");
  const operations = payloads.map(({ row, payload }) => ({
    action: payload.externalId ? "push" : "create",
    todoId: row.todo_id,
    title: row.title,
    list: row.external_list,
    status: row.status,
  }));
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];
  const now = nowIso();
  const normalChunkSize = Math.max(1, Math.min(batchSize, REMINDERS_PUSH_BATCH_SIZE));
  const timeoutChunkSize = 1;
  const normalChunks = chunkArray(normalRows, normalChunkSize);
  const timeoutChunks = chunkArray(timeoutRows, timeoutChunkSize);
  const total = payloads.length;
  const processChunk = (chunk: typeof payloads, chunkLabel: "normal" | "timeout") => {
    if (!chunk.length) return;
    if (chunkLabel === "timeout") {
      const row = chunk[0];
      if (!row) return;
      const [ok, error] = syncSingleReminderPayload(db, row, now);
      if (ok) {
        processed += 1;
      } else {
        failed += 1;
        errors.push(`${row.row.title}: ${error}`);
      }
      return;
    }
    const upsertResult = upsertRemoteReminders(chunk.map((row) => row.payload));
    if (!upsertResult.ok) {
      if (chunk.length > 1) {
        for (const row of chunk) {
          const [ok, error] = syncSingleReminderPayload(db, row, now);
          if (ok) {
            processed += 1;
          } else {
            failed += 1;
            errors.push(`${row.row.title}: ${error}`);
          }
        }
        return;
      }
      const row = chunk[0];
      const [ok, error] = syncSingleReminderPayload(db, row, now);
      if (!ok) {
        failed += 1;
        errors.push(`${row.row.title}: ${error}`);
      } else {
        processed += 1;
      }
      return;
    }
    for (const remote of upsertResult.reminders || []) {
      if (!remote.todoId) continue;
      const updatedTodo = db.prepare("SELECT * FROM todos WHERE id = ?").get(remote.todoId) as TodoRow | undefined;
      const link = db.prepare("SELECT * FROM todo_sync_links WHERE todo_id = ? AND provider = ?").get(remote.todoId, REMINDERS_PROVIDER) as SyncTodoLinkRow | undefined;
      if (link) markTodoSyncSuccess(db, link, remote, updatedTodo, now);
      processed += 1;
    }
  };
  for (const chunk of normalChunks) {
    processChunk(chunk, "normal");
  }
  for (const chunk of timeoutChunks) {
    processChunk(chunk, "timeout");
  }
  const remainingPending = reminderPendingCount(db);
  const resultStats = reminderSyncStatus(db).stats || emptySyncFailureSummary();
  return {
    ok: true,
    apply: true,
    provider: REMINDERS_PROVIDER,
    mode: "push_pending",
    batchSize,
    processed,
    failed,
    total,
    pendingBefore,
    remainingPending,
    pendingAfter: remainingPending,
    kindSummary: {
      auth: resultStats.kindSummary?.auth || 0,
      timeout: resultStats.kindSummary?.timeout || 0,
      upstream: resultStats.kindSummary?.upstream || 0,
    },
    error: processed > 0 ? "" : errors[0] || "",
    operations,
    message: remainingPending ? `本轮已同步 ${processed} 条，失败 ${failed} 条，仍有 ${remainingPending} 条待推送。` : `本轮已同步 ${processed} 条，失败 ${failed} 条，待推送队列已清空。`,
    status: reminderSyncStatus(db),
  };
}

function syncSingleReminderPayload(db: Db, row: { row: SyncTodoLinkRow; payload: ReturnType<typeof remotePayload> }, now: string) {
  const hasErrorRequiringExternalReset = (error: string) => {
    const normalized = String(error || "").toLowerCase();
    return normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("not authorized") || normalized.includes("unauthorized") || normalized.includes("permission") || normalized.includes("kterror") || normalized.includes("kerror");
  };

  const syncResult = upsertRemoteReminders([row.payload]);
  if (syncResult.ok) {
    const remote = (syncResult.reminders || [])[0];
    if (remote?.todoId) {
      const updatedTodo = db.prepare("SELECT * FROM todos WHERE id = ?").get(remote.todoId) as TodoRow | undefined;
      markTodoSyncSuccess(db, row.row, remote, updatedTodo, now);
      return [true, ""] as const;
    }
    markTodoSyncFailure(db, row.row, now, "reminders_upsert_no_todo", {});
    return [false, "reminders_upsert_no_todo"] as const;
  }

  const firstError = String(syncResult.error || "reminders_upsert_failed");
  if (row.row.last_error_kind === "timeout") {
    markTodoSyncFailure(db, row.row, now, firstError, {});
    return [false, firstError] as const;
  }
  const shouldRetryNoExternal = Boolean(row.payload.externalId);
  if (!shouldRetryNoExternal) {
    markTodoSyncFailure(db, row.row, now, firstError, {});
    return [false, firstError] as const;
  }

  const fallbackPayload = { ...row.payload, externalId: null };
  const fallbackResult = upsertRemoteReminders([fallbackPayload]);
  if (!fallbackResult.ok) {
    const fallbackError = String(fallbackResult.error || "reminders_upsert_failed");
    const shouldResetExternal = hasErrorRequiringExternalReset(firstError) || hasErrorRequiringExternalReset(fallbackError);
    if (shouldResetExternal) {
      markTodoSyncFailure(db, row.row, now, `${firstError}; fallback_no_external_id_${fallbackError}`, { resetExternalId: true });
      return [false, `${firstError}; fallback_no_external_id_${fallbackError}; external_id_reset`] as const;
    }
    markTodoSyncFailure(db, row.row, now, `${firstError}; fallback_no_external_id_${fallbackError}`);
    return [false, `${firstError}; fallback_no_external_id_${fallbackError}`] as const;
  }

  const fallbackRemote = (fallbackResult.reminders || [])[0];
  if (fallbackRemote?.todoId) {
    const updatedTodo = db.prepare("SELECT * FROM todos WHERE id = ?").get(fallbackRemote.todoId) as TodoRow | undefined;
    markTodoSyncSuccess(db, row.row, fallbackRemote, updatedTodo, now);
    return [true, ""] as const;
  }

  markTodoSyncFailure(db, row.row, now, "reminders_upsert_no_todo", {});
  return [false, "reminders_upsert_no_todo"] as const;
}

function runReminderFullReconcile(db: Db, links: SyncTodoLinkRow[]) {
  const pendingBefore = reminderPendingCount(db);
  const operations: Array<Record<string, unknown>> = [];
  const remoteResult = readRemoteReminders();
  if (!remoteResult.ok) {
    return { ok: false, error: remoteResult.error || "reminders_unavailable", status: reminderSyncStatus(db) };
  }
  const remoteByTodo = new Map((remoteResult.reminders || []).filter((row) => row.todoId).map((row) => [row.todoId as string, row]));
  const upserts: Array<Record<string, unknown>> = [];
  const now = nowIso();

  for (const row of links) {
    const todo = linkTodoRow(row);
    const localHash = todoHash(todo);
    const remote = remoteByTodo.get(row.todo_id);
    if (remote) {
      const remoteHash = remoteReminderHash(remote);
      const localChanged = Boolean(row.sync_hash) && localHash !== row.sync_hash;
      const remoteChanged = Boolean(row.sync_hash) && remoteHash !== row.sync_hash;
      if (localChanged && remoteChanged) {
        const conflictId = upsertReminderConflict(db, row.todo_id, remote.id, "record", JSON.stringify(todoConflictShape(todo)), JSON.stringify(remoteConflictShape(remote)), "人工审阅后合并");
        db.prepare("UPDATE todo_sync_links SET external_id = ?, external_list = ?, status = 'conflict', error = '', updated_at = ? WHERE id = ?")
          .run(remote.id, remote.listName, now, row.id);
        operations.push({ action: "conflict", conflictId, todoId: row.todo_id, title: row.title });
        continue;
      }
        if (remoteChanged && !localChanged) {
        db.prepare("UPDATE todos SET title = ?, status = ?, due_at = ?, updated_at = ? WHERE id = ?")
          .run(remote.title || row.title, remote.completed ? "done" : "open", remote.dueAt, now, row.todo_id);
        const updatedTodo = db.prepare("SELECT * FROM todos WHERE id = ?").get(row.todo_id) as TodoRow;
        markTodoSyncSuccess(db, row, remote, updatedTodo, now);
        operations.push({ action: "pull", todoId: row.todo_id, title: remote.title });
        continue;
      }
      if (localChanged) {
        upserts.push(remotePayload(todo, row.external_list || remote.listName, row.external_id || remote.id));
        operations.push({ action: "push", todoId: row.todo_id, title: row.title });
        continue;
      }
      db.prepare("UPDATE todo_sync_links SET external_id = ?, external_list = ?, last_synced_at = COALESCE(last_synced_at, ?), status = 'synced', error = '', updated_at = ? WHERE id = ?")
        .run(remote.id, remote.listName, now, now, row.id);
      operations.push({ action: "noop", todoId: row.todo_id, title: row.title });
      continue;
    }
    upserts.push(remotePayload(todo, row.external_list));
    operations.push({ action: "create", todoId: row.todo_id, title: row.title, list: row.external_list });
  }

  if (upserts.length) {
    const upsertResult = upsertRemoteReminders(upserts);
    if (!upsertResult.ok) {
      const error = upsertResult.error || "reminders_upsert_failed";
      const now = nowIso();
      for (const op of upserts) {
        const link = db.prepare("SELECT * FROM todo_sync_links WHERE todo_id = ? AND provider = ? ORDER BY updated_at DESC LIMIT 1").get(String(op.todoId || ""), REMINDERS_PROVIDER) as SyncTodoLinkRow | undefined;
        if (!link) continue;
        markTodoSyncFailure(db, link, now, error, {});
      }
      return { ok: false, error, operations, status: reminderSyncStatus(db) };
    }
    for (const remote of upsertResult.reminders || []) {
      if (!remote.todoId) continue;
      const todo = db.prepare("SELECT * FROM todos WHERE id = ?").get(remote.todoId) as TodoRow | undefined;
      const link = db.prepare("SELECT * FROM todo_sync_links WHERE todo_id = ? AND provider = ? ORDER BY updated_at DESC LIMIT 1").get(remote.todoId, REMINDERS_PROVIDER) as SyncTodoLinkRow | undefined;
      if (link) markTodoSyncSuccess(db, link, remote, todo, nowIso());
    }
  }
  return {
    ok: true,
    apply: true,
    provider: REMINDERS_PROVIDER,
    mode: "full_reconcile",
    batchSize: links.length,
    total: links.length,
    processed: links.length,
    failed: 0,
    pendingBefore,
    remainingPending: reminderPendingCount(db),
    pendingAfter: reminderPendingCount(db),
    kindSummary: {
      ...reminderSyncStatus(db).stats?.kindSummary || emptySyncFailureSummary(),
    },
    operations,
    status: reminderSyncStatus(db),
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunkSize = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) out.push(items.slice(i, i + chunkSize));
  return out;
}

export function resolveReminderConflict(db: Db, conflictId: string, decision: "local" | "remote" | "dismiss") {
  const row = db.prepare("SELECT * FROM todo_sync_conflicts WHERE id = ? AND provider = ?").get(conflictId, REMINDERS_PROVIDER) as { todo_id?: string | null; remote_value: string; status: string } | undefined;
  if (!row) return { ok: false, error: "not_found" };
  const now = nowIso();
  if (decision === "remote" && row.todo_id) {
    const remote = parseJson<Record<string, unknown>>(row.remote_value, {});
    db.prepare("UPDATE todos SET title = ?, status = ?, due_at = ?, updated_at = ? WHERE id = ?")
      .run(String(remote.title || "未命名提醒"), remote.completed ? "done" : "open", String(remote.dueAt || "") || null, now, row.todo_id);
    db.prepare("UPDATE todo_sync_links SET sync_hash = ?, status = 'pending', error = '', updated_at = ? WHERE todo_id = ? AND provider = ?")
      .run(todoHash(db.prepare("SELECT * FROM todos WHERE id = ?").get(row.todo_id) as TodoRow | undefined), now, row.todo_id, REMINDERS_PROVIDER);
  } else if (decision === "local" && row.todo_id) {
    db.prepare("UPDATE todo_sync_links SET status = 'pending', error = '', updated_at = ? WHERE todo_id = ? AND provider = ?").run(now, row.todo_id, REMINDERS_PROVIDER);
  }
  db.prepare("UPDATE todo_sync_conflicts SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?").run(decision, now, now, conflictId);
  return { ok: true, status: reminderSyncStatus(db) };
}

function buildImportPreview(items: ImportItem[]) {
  const counts = {
    create: items.filter((item) => item.action === "create").length,
    update: items.filter((item) => item.action === "update").length,
    duplicate: items.filter((item) => item.action === "duplicate").length,
    skipped: items.filter((item) => item.action === "skipped").length,
  };
  const categories = [...new Set(items.filter((item) => item.action !== "skipped").map((item) => item.listName))].sort();
  const owners = [...new Set(items.filter((item) => item.action !== "skipped").map((item) => item.agentId).filter(Boolean))].sort();
  return {
    ok: true,
    defaults: reminderImportDefaults(),
    counts,
    categories,
    owners,
    items,
  };
}

function classifyImportItems(db: Db, items: ImportItem[]) {
  const seen = new Set<string>();
  return items.map((item) => {
    if (item.action === "skipped") return item;
    if (item.planType) {
      const plan = db.prepare("SELECT * FROM plan_items WHERE import_key = ? LIMIT 1").get(item.key) as { id: string; todo_id?: string | null; import_hash?: string | null } | undefined;
      if (plan) {
        return {
          ...item,
          existingPlanItemId: plan.id,
          existingTodoId: plan.todo_id || undefined,
          planItemId: plan.id,
          action: plan.import_hash === item.importHash ? "duplicate" as const : "update" as const,
        };
      }
    }
    const markerTodo = db.prepare("SELECT * FROM todos WHERE notes LIKE ? ORDER BY updated_at DESC LIMIT 1").get(`%${IMPORT_MARKER_PREFIX}${item.key}%`) as TodoRow | undefined;
    if (markerTodo) {
      return { ...item, existingTodoId: markerTodo.id, action: importHashFromNotes(markerTodo.notes) === item.importHash ? "duplicate" as const : "update" as const };
    }
    const signature = `${item.title}::${item.listName}::${item.dueAt || ""}`.toLowerCase();
    if (seen.has(signature)) return { ...item, action: "duplicate" as const, reason: "same_import_batch" };
    seen.add(signature);
    const existing = db.prepare("SELECT * FROM todos WHERE lower(title) = lower(?) AND COALESCE(list_name, '') = ? LIMIT 1").get(item.title, item.listName) as TodoRow | undefined;
    if (existing) return { ...item, existingTodoId: existing.id, action: "update" as const, reason: "matched_title_and_category" };
    return item;
  });
}

function buildImportItems(input: ImportPreviewInput) {
  const workPath = input.workPlanPath || DEFAULT_WORK_PLAN_PATH;
  const personalPath = input.personalPath || DEFAULT_PERSONAL_PATH;
  const items: ImportItem[] = [];
  if (fs.existsSync(workPath)) {
    const workbook = parseWorkbook(workPath);
    for (const sheet of workbook.sheets) {
      if (sheet.name === "2025年工作计划" && !input.include2025) {
        for (const row of sheet.rows) items.push(skippedImportItem(workPath, sheet.name, row.rowIndex, "2025历史计划默认不导入"));
        continue;
      }
      if (!/工作计划/.test(sheet.name)) continue;
      for (const row of sheet.rows) {
        const item = workPlanImportItem(workPath, sheet.name, row.rowIndex, row.values);
        if (item) items.push(item);
      }
    }
  }
  if (fs.existsSync(personalPath)) {
    const workbook = parseWorkbook(personalPath);
    for (const sheet of workbook.sheets) {
      if (sheet.name === "待办") {
        for (const row of sheet.rows) {
          const item = personalTodoImportItem(personalPath, sheet.name, row.rowIndex, row.values, Boolean(input.includeCompletedPersonal));
          if (item) items.push(item);
        }
      }
      if (sheet.name.includes("五年规划")) {
        for (const row of sheet.rows) {
          const item = lifePlanImportItem(personalPath, sheet.name, row.rowIndex, row.values);
          if (item) items.push(item);
        }
      }
    }
  }
  return items;
}

function workPlanImportItem(file: string, sheet: string, rowIndex: number, values: Record<string, string>): ImportItem | null {
  const titleBase = compact(values["任务描述"] || values["工作类型"]);
  if (!titleBase) return null;
  const listName = compact(values["工作类型"]) || "年度工作计划";
  const dueAt = parseSourceDate(values["预计完成日期"]) || (sheet.includes("2026") ? "2026-12-31T18:00" : parseSourceDate(values["实际完成日期"]));
  const tags = ["年度工作计划", sheet.replace("年工作计划", ""), listName].filter(Boolean);
  const status = isDoneText(values["已完成"] || values["是否完成"]) ? "done" : "open";
  const notes = notesFromSections([
    ["来源", `${fileName(file)} / ${sheet} / 第 ${rowIndex} 行`],
    ["年度目标", values["年度目标"]],
    ["一季度目标", values["一季度目标"]],
    ["二季度目标", values["二季度目标"]],
    ["三季度目标", values["三季度目标"]],
    ["四季度目标", values["四季度目标"]],
    ["月度记录", monthSummary(values)],
    ["年度总结", values["年度总结"]],
  ]);
  return importItem(file, sheet, rowIndex, "work_plan", titleBase, status, "P2", dueAt, values["任务执行人"] || "main", listName, tags, notes, values);
}

function personalTodoImportItem(file: string, sheet: string, rowIndex: number, values: Record<string, string>, includeCompleted: boolean): ImportItem | null {
  const title = compact(values["待办事项"]);
  if (!title) return null;
  const done = isDoneText(values["是否完成"]);
  if (done && !includeCompleted) return skippedImportItem(file, sheet, rowIndex, "已完成个人事项默认不导入");
  const categories = splitList(values["分类"]);
  const listName = categories[0] || "个人事项";
  const dueAt = parseSourceDate(values["跟踪进度时间"]) || parseSourceDate(values["实际完成时间"]) || parseSourceDate(values["开始时间"]);
  const tags = ["个人事项", ...categories].filter(Boolean);
  const notes = notesFromSections([
    ["来源", `${fileName(file)} / ${sheet} / 第 ${rowIndex} 行`],
    ["目标", values["目标"]],
    ["记录", values["记录"]],
    ["进度及总结", values["进度及总结"]],
    ["链接", values["链接"]],
    ["验证结果", values["验证结果"]],
    ["验证材料", values["验证材料"]],
  ]);
  return importItem(file, sheet, rowIndex, "personal_todo", title, done ? "done" : "open", done ? "P3" : "P1", dueAt, values["负责人"] || "main", listName, tags, notes, values);
}

function lifePlanImportItem(file: string, sheet: string, rowIndex: number, values: Record<string, string>): ImportItem | null {
  const action = compact(values["具体行动项（行）​"] || values["具体行动项（行）"]);
  if (!action) return null;
  const dimension = compact(values["维度"]) || "人生规划";
  const vision = compact(values["愿景"]);
  const title = `${dimension}${vision ? `/${vision}` : ""}：${action}`;
  const tags = ["五年规划", "2026-2030", dimension, vision].filter(Boolean);
  const notes = notesFromSections([
    ["来源", `${fileName(file)} / ${sheet} / 第 ${rowIndex} 行`],
    ["核心目标", values["核心目标（知）​"] || values["核心目标（知）"]],
    ["2026年计划", values["2026年计划"]],
    ["量化指标/里程碑", values["量化指标/里程碑​"] || values["量化指标/里程碑"]],
    ["完成证据/反思", values["完成证据/反思​"] || values["完成证据/反思"]],
    ["行动记录", values["行动记录"]],
    ["总结", values["总结"]],
    ["验证材料", values["验证材料"]],
  ]);
  return importItem(file, sheet, rowIndex, "life_plan", title, "open", "P2", "2026-12-31T18:00", "main", dimension, tags, notes, values);
}

function importItem(file: string, sheet: string, rowIndex: number, itemType: ImportItem["itemType"], title: string, status: string, priority: string, dueAt: string | null, agentId: string, listName: string, tags: string[], notes: string, rawValues: Record<string, string> = {}): ImportItem {
  const key = stableImportKey(file, sheet, rowIndex, title);
  const externalList = normalizeReminderListName(listName);
  const rawFields = Object.fromEntries(Object.entries(rawValues).filter(([, value]) => String(value || "").trim()));
  const fieldOrder = Object.keys(rawFields);
  const planType = itemType === "life_plan" ? "life" : itemType === "work_plan" ? "work" : undefined;
  const base = { title, status, priority, dueAt, agentId: cleanText(agentId || "main"), listName: cleanText(listName || "未分类"), tags: unique(tags.map(cleanText).filter(Boolean)), notes, rawFields };
  return {
    key,
    sourceFile: file,
    sheet,
    rowIndex,
    itemType,
    planType,
    ...base,
    fieldOrder,
    externalList,
    importHash: hashJson(base),
    action: "create",
  };
}

function skippedImportItem(file: string, sheet: string, rowIndex: number, reason: string): ImportItem {
  return {
    key: stableImportKey(file, sheet, rowIndex, reason),
    sourceFile: file,
    sheet,
    rowIndex,
    itemType: "work_plan",
    title: reason,
    status: "skipped",
    priority: "P3",
    dueAt: null,
    agentId: "main",
    listName: "历史记录",
    tags: ["跳过"],
    notes: "",
    rawFields: {},
    fieldOrder: [],
    externalList: normalizeReminderListName("历史记录"),
    importHash: hashJson({ reason }),
    action: "skipped",
    reason,
  };
}

function parseWorkbook(file: string) {
  const workbookXml = readZipEntry(file, "xl/workbook.xml");
  const relsXml = readZipEntry(file, "xl/_rels/workbook.xml.rels");
  const rels = new Map<string, string>();
  for (const rel of relsXml.matchAll(/<Relationship\b([^>]*)>/g)) {
    const attrs = parseAttrs(rel[1] || "");
    if (attrs.Id && attrs.Target) rels.set(attrs.Id, normalizeZipTarget(attrs.Target));
  }
  const sheets = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)>/g)) {
    const attrs = parseAttrs(match[1] || "");
    const name = attrs.name || "";
    const rid = attrs["r:id"];
    const target = rid ? rels.get(rid) : "";
    if (!name || !target) continue;
    sheets.push({ name, rows: parseSheet(readZipEntry(file, target)) });
  }
  return { sheets };
}

function parseSheet(xml: string) {
  const parsedRows: Array<{ rowIndex: number; values: Record<string, string> }> = [];
  const rowCells = new Map<number, Map<number, string>>();
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowAttrs = parseAttrs(rowMatch[1] || "");
    const rowIndex = Number(rowAttrs.r || 0);
    if (!rowIndex) continue;
    const cells = new Map<number, string>();
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttrs(cellMatch[1] || "");
      const ref = attrs.r || "";
      const col = columnIndex(ref.replace(/\d+/g, ""));
      const text = cellText(cellMatch[2] || "");
      if (text.trim()) cells.set(col, text.trim().replace(/\r/g, ""));
    }
    if (cells.size) rowCells.set(rowIndex, cells);
  }
  const firstRow = Math.min(...rowCells.keys());
  if (!Number.isFinite(firstRow)) return parsedRows;
  const headers = rowCells.get(firstRow) || new Map<number, string>();
  for (const [rowIndex, cells] of [...rowCells.entries()].sort((a, b) => a[0] - b[0])) {
    if (rowIndex === firstRow) continue;
    const values: Record<string, string> = {};
    for (const [col, header] of headers.entries()) {
      if (!header) continue;
      values[header] = cells.get(col) || "";
    }
    if (Object.values(values).some(Boolean)) parsedRows.push({ rowIndex, values });
  }
  return parsedRows;
}

function readZipEntry(file: string, entry: string) {
  const result = spawnSync("unzip", ["-p", file, entry], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`read_xlsx_failed:${file}:${entry}:${result.stderr || result.error?.message || "unknown"}`);
  return result.stdout || "";
}

function upsertRemoteReminders(items: Array<Record<string, unknown>>) {
  const script = `
function run(argv) {
  const payload = JSON.parse(argv[0] || "[]");
  const app = Application("${MACOS_REMINDERS_APP}");
  app.includeStandardAdditions = true;
  const reminderCache = {};
  function ensureList(name) {
    const lists = app.lists();
    for (let i = 0; i < lists.length; i++) {
      if (lists[i].name() === name) return lists[i];
    }
    const list = app.List({ name });
    app.lists.push(list);
    return app.lists.byName(name);
  }
  function remindersForList(name) {
    if (!reminderCache[name]) reminderCache[name] = ensureList(name).reminders();
    return reminderCache[name];
  }
  function markerFor(todoId) { return "${TODO_MARKER_PREFIX}" + todoId; }
  function findReminder(todoId, targetList, externalId) {
    const marker = markerFor(todoId);
    if (externalId) {
      try {
        const reminder = app.reminders.byId(externalId);
        if (reminder && reminder.id()) return reminder;
      } catch (_) {}
    }
    const listNames = targetList ? [targetList] : app.lists().map(function(list) { return list.name(); });
    for (let l = 0; l < listNames.length; l++) {
      const reminders = remindersForList(listNames[l]);
      for (let i = 0; i < reminders.length; i++) {
        let id = "";
        let body = "";
        try { id = reminders[i].id(); } catch (_) {}
        try { body = reminders[i].body(); } catch (_) {}
        if (externalId && id === externalId) return reminders[i];
        if (String(body || "").indexOf(marker) >= 0) return reminders[i];
      }
    }
    return null;
  }
	  function iso(value) {
	    if (!value) return null;
	    try { return new Date(value).toISOString(); } catch (_) { return null; }
	  }
	  function setIfChanged(reminder, key, value) {
	    try {
	      if (reminder[key]() === value) return;
	    } catch (_) {}
	    reminder[key] = value;
	  }
	  const out = [];
	  for (let i = 0; i < payload.length; i++) {
	    const item = payload[i];
	    const targetListName = item.listName || "OpenClaw";
	    let reminder = item.externalId ? findReminder(item.todoId, item.listName, item.externalId) : null;
	    const body = [item.body || "", markerFor(item.todoId)].filter(Boolean).join("\\n");
	    let list = null;
	    if (!reminder) {
	      list = ensureList(targetListName);
	      reminder = app.Reminder({ name: item.title || "OpenClaw 待办", body });
	      list.reminders.push(reminder);
	      if (reminderCache[targetListName]) reminderCache[targetListName].push(reminder);
	    }
	    setIfChanged(reminder, "name", item.title || "OpenClaw 待办");
	    setIfChanged(reminder, "body", body);
	    setIfChanged(reminder, "completed", Boolean(item.completed));
	    setIfChanged(reminder, "priority", Number(item.priority || 5));
	    if (item.dueAt) {
	      const nextDue = new Date(item.dueAt);
	      if (iso(reminder.dueDate()) !== nextDue.toISOString()) reminder.dueDate = nextDue;
	    }
	    out.push({ id: reminder.id(), title: reminder.name(), body: reminder.body(), dueAt: iso(reminder.dueDate()), completed: Boolean(reminder.completed()), listName: list ? list.name() : targetListName, todoId: item.todoId });
	  }
  return JSON.stringify(out);
}`;
  return runJxa<RemoteReminder[]>(script, items);
}

function readRemoteReminders() {
  const script = `
function run() {
  const app = Application("${MACOS_REMINDERS_APP}");
  app.includeStandardAdditions = true;
  function iso(value) {
    if (!value) return null;
    try { return new Date(value).toISOString(); } catch (_) { return null; }
  }
  const out = [];
  const lists = app.lists();
  for (let l = 0; l < lists.length; l++) {
    const listName = lists[l].name();
    if (String(listName).indexOf("OpenClaw") !== 0) continue;
    const reminders = lists[l].reminders();
    for (let i = 0; i < reminders.length; i++) {
      let body = "";
      try { body = reminders[i].body(); } catch (_) {}
      const marker = String(body || "").match(/${TODO_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\s]+)/);
      if (!marker) continue;
      let modifiedAt = null;
      try { modifiedAt = iso(reminders[i].modificationDate()); } catch (_) {}
      out.push({ id: reminders[i].id(), title: reminders[i].name(), body, dueAt: iso(reminders[i].dueDate()), completed: Boolean(reminders[i].completed()), listName, modifiedAt, todoId: marker[1] });
    }
  }
  return JSON.stringify(out);
}`;
  return runJxa<RemoteReminder[]>(script, []);
}

function runJxa<T>(script: string, payload: unknown) {
  const args = ["-l", "JavaScript", "-e", script];
  if (Array.isArray(payload) ? payload.length : payload) args.push(JSON.stringify(payload));
  const result = spawnSync("osascript", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: REMINDERS_OSASCRIPT_TIMEOUT_MS, killSignal: "SIGTERM" });
  if (result.error && "code" in result.error && result.error.code === "ETIMEDOUT") {
    return { ok: false as const, error: `macos_reminders_timeout_${REMINDERS_OSASCRIPT_TIMEOUT_MS}ms` };
  }
  if (result.status !== 0) return { ok: false as const, error: sanitizeError(result.stderr || result.error?.message || "osascript_failed") };
  try {
    return { ok: true as const, reminders: JSON.parse(result.stdout || "[]") as T };
  } catch (err) {
    return { ok: false as const, error: sanitizeError(err instanceof Error ? err.message : String(err)) };
  }
}

function remotePayload(todo: TodoRow, listName?: string, externalId?: string | null) {
  return {
    todoId: todo.id,
    externalId: externalId || null,
    title: todo.title,
    body: reminderBody(todo),
    dueAt: todo.due_at || null,
    completed: isTodoDone(todo.status),
    priority: reminderPriority(todo.priority),
    listName: normalizeReminderListName(listName || todo.list_name || "OpenClaw"),
  };
}

function linkTodoRow(row: SyncLinkRow & TodoRow & { todo_status?: string; todo_updated_at?: string | null }): TodoRow {
  return {
    id: row.todo_id,
    title: row.title,
    status: row.todo_status || row.status,
    priority: row.priority || "P2",
    due_at: row.due_at || null,
    tags: row.tags || "[]",
    list_name: row.list_name || row.external_list,
    agent_id: row.agent_id || "main",
    notes: row.notes || "",
    updated_at: row.todo_updated_at || row.updated_at,
  };
}

function todoHash(todo: TodoRow | undefined) {
  if (!todo) return "";
  return hashJson({
    title: todo.title || "",
    status: isTodoDone(todo.status) ? "done" : "open",
    dueAt: normalizeDue(todo.due_at),
    listName: normalizeReminderListName(todo.list_name || "OpenClaw"),
  });
}

function remoteReminderHash(remote: RemoteReminder) {
  return hashJson({
    title: remote.title || "",
    status: remote.completed ? "done" : "open",
    dueAt: normalizeDue(remote.dueAt),
    listName: normalizeReminderListName(remote.listName || "OpenClaw"),
  });
}

function upsertReminderConflict(db: Db, todoId: string, externalId: string, field: string, localValue: string, remoteValue: string, recommendation: string) {
  const existing = db.prepare("SELECT id FROM todo_sync_conflicts WHERE todo_id = ? AND provider = ? AND external_id = ? AND field = ? AND status = 'pending'")
    .get(todoId, REMINDERS_PROVIDER, externalId, field) as { id: string } | undefined;
  const now = nowIso();
  if (existing) {
    db.prepare("UPDATE todo_sync_conflicts SET local_value = ?, remote_value = ?, recommendation = ?, updated_at = ? WHERE id = ?")
      .run(localValue, remoteValue, recommendation, now, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare("INSERT INTO todo_sync_conflicts (id, todo_id, provider, external_id, field, local_value, remote_value, status, recommendation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, todoId, REMINDERS_PROVIDER, externalId, field, localValue, remoteValue, "pending", recommendation, now, now);
  return id;
}

function todoConflictShape(todo: TodoRow) {
  return { title: todo.title || "", status: isTodoDone(todo.status) ? "done" : "open", dueAt: todo.due_at || null, listName: todo.list_name || "" };
}

function remoteConflictShape(remote: RemoteReminder) {
  return { title: remote.title || "", completed: remote.completed, dueAt: remote.dueAt, listName: remote.listName };
}

function listNameForTodo(db: Db, todoId: string) {
  const todo = db.prepare("SELECT list_name FROM todos WHERE id = ?").get(todoId) as { list_name?: string | null } | undefined;
  return todo?.list_name || "OpenClaw";
}

function reminderBody(todo: TodoRow) {
  const tags = parseTags(todo.tags).join(", ");
  return [
    todo.notes || "",
    tags ? `标签：${tags}` : "",
    todo.agent_id ? `负责人：${todo.agent_id}` : "",
  ].filter(Boolean).join("\n");
}

function reminderPriority(priority: string | undefined) {
  const key = String(priority || "P2").toUpperCase();
  if (key === "P0" || key === "P1") return 1;
  if (key === "P2") return 5;
  return 9;
}

function normalizeDue(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const date = new Date(raw.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? raw.slice(0, 16) : date.toISOString().slice(0, 16);
}

function parseAttrs(value: string) {
  const attrs: Record<string, string> = {};
  for (const match of value.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) attrs[match[1]] = decodeXml(match[2]);
  return attrs;
}

function cellText(xml: string) {
  const texts = [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((match) => decodeXml(match[1] || ""));
  if (texts.length) return texts.join("");
  const value = xml.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
  return value ? decodeXml(value[1] || "") : "";
}

function normalizeZipTarget(target: string) {
  const value = target.replace(/^\/+/, "");
  return value.startsWith("xl/") ? value : `xl/${value}`;
}

function columnIndex(column: string) {
  let index = 0;
  for (const char of column) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stableImportKey(file: string, sheet: string, rowIndex: number, title: string) {
  return `${fileName(file)}:${sheet}:${rowIndex}:${hashText(title).slice(0, 10)}`;
}

function appendImportMarkers(notes: string, key: string, importHash: string) {
  return [notes.trim(), `${IMPORT_MARKER_PREFIX}${key}`, `openclaw:import_hash:${importHash}`, "openclaw:sync:macos_reminders"].filter(Boolean).join("\n");
}

function importHashFromNotes(notes: unknown) {
  const match = String(notes || "").match(/openclaw:import_hash:([a-f0-9]+)/);
  return match?.[1] || "";
}

function parseSourceDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/星期[一二三四五六日天]/g, "")
    .replace(/[年月]/g, "-")
    .replace(/日/g, "")
    .replace(/\./g, "/")
    .trim();
  const match = normalized.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (!match) return null;
  const [, y, m, d, hh = "18", mm = "00"] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}`;
}

function notesFromSections(sections: Array<[string, unknown]>) {
  return sections.map(([title, value]) => {
    const text = String(value || "").trim();
    return text ? `${title}：${text}` : "";
  }).filter(Boolean).join("\n\n");
}

function monthSummary(values: Record<string, string>) {
  return ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"]
    .map((month) => values[month] ? `${month}：${values[month]}` : "")
    .filter(Boolean)
    .join("\n");
}

function normalizeReminderListName(value: unknown) {
  const cleaned = cleanText(value || "OpenClaw").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "OpenClaw";
  return cleaned.startsWith("OpenClaw-") ? cleaned : `OpenClaw-${cleaned}`;
}

function splitList(value: unknown) {
  return unique(String(value || "").split(/[,，、/\n]+/).map(cleanText).filter(Boolean));
}

function parseTags(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return splitList(value);
  }
}

function isDoneText(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  return text.includes("✅") || ["true", "1", "done", "completed", "完成", "已完成"].includes(text);
}

function isTodoDone(value: unknown) {
  return ["done", "completed", "closed", "archived"].includes(String(value || "").toLowerCase());
}

function fileName(file: string) {
  return file.split(/[\\/]/).pop() || file;
}

function compact(value: unknown) {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown) {
  return hashText(JSON.stringify(value));
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function sanitizeError(value: string) {
  return value.replace(/[\r\n]+/g, " ").slice(0, 500);
}
