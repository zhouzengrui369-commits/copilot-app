import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import {
  CLOUDBASE_BROKER_URL,
  CLOUDBASE_ENABLED,
  FORWARDER_AUTH_TOKEN,
  HOME_DIR,
  nowIso,
} from "./config.js";

const WORKBENCH_ENV = String(process.env.OPENCLAW_WORKBENCH_ENV || "prod").trim().toLowerCase();
const MAC_ID_FILE = path.join(HOME_DIR, ".openclaw", WORKBENCH_ENV && WORKBENCH_ENV !== "prod" ? `mac_id_${WORKBENCH_ENV}` : "mac_id");
const HEARTBEAT_INTERVAL_MS = 60_000;
const POLL_ACTIVE_INTERVAL_MS = 2_000;
const POLL_WARM_INTERVAL_MS = 10_000;
const POLL_IDLE_INTERVAL_MS = 20_000;
const POLL_ACTIVE_WINDOW_MS = 5 * 60_000;
const POLL_WARM_WINDOW_MS = 20 * 60_000;
const POLL_ERROR_BACKOFF_MS = 60_000;
const REGISTER_RETRY_MS = 5_000;
const BROKER_TIMEOUT_MS = 8_000;
const LOCAL_FORWARD_TIMEOUT_MS = 25_000;
const MAX_BROKER_ACK_RESPONSE_BYTES = 80_000;

type LogSink = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type BrokerInboxRequest = {
  requestId: string;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export interface CloudbaseForwarderOptions {
  localUrl: string;
  log: LogSink;
  version?: string;
}

export class CloudbaseForwarder {
  private readonly brokerUrl = CLOUDBASE_BROKER_URL;
  private readonly localUrl: string;
  private readonly log: LogSink;
  private readonly version: string;
  private macId: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private registerTimer: NodeJS.Timeout | null = null;
  private lastInboxActivityAt = 0;
  private stopped = false;

  constructor(opts: CloudbaseForwarderOptions) {
    this.localUrl = opts.localUrl.replace(/\/+$/, "");
    this.log = opts.log;
    this.version = opts.version || "0.0.0";
  }

  static enabled() {
    return CLOUDBASE_ENABLED;
  }

  getMacId() {
    return this.macId;
  }

  getBrokerUrl() {
    return this.brokerUrl;
  }

  start() {
    if (!CloudbaseForwarder.enabled()) {
      this.log.info({ brokerUrl: this.brokerUrl }, "cloudbase forwarder disabled");
      return;
    }
    if (this.stopped) return;
    this.macId = this.loadOrCreateMacId();
    this.log.info({ macId: this.macId, brokerUrl: this.brokerUrl, localUrl: this.localUrl }, "cloudbase forwarder starting");
    void this.registerWithRetry();
    this.lastInboxActivityAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat().catch((err) => this.log.warn({ err: String(err) }, "cloudbase heartbeat failed"));
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
    this.scheduleNextPoll(0);
  }

  stop() {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.registerTimer) clearTimeout(this.registerTimer);
    this.heartbeatTimer = null;
    this.pollTimer = null;
    this.registerTimer = null;
  }

  private scheduleNextPoll(delayMs = this.nextPollIntervalMs()) {
    if (this.stopped) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      void this.pollOnce();
    }, delayMs);
    this.pollTimer.unref?.();
  }

  private nextPollIntervalMs() {
    const idleMs = Math.max(0, Date.now() - this.lastInboxActivityAt);
    if (idleMs <= POLL_ACTIVE_WINDOW_MS) return POLL_ACTIVE_INTERVAL_MS;
    if (idleMs <= POLL_WARM_WINDOW_MS) return POLL_WARM_INTERVAL_MS;
    return POLL_IDLE_INTERVAL_MS;
  }

  private async pollOnce() {
    if (this.stopped) return;
    try {
      const requestCount = await this.pollInbox();
      if (requestCount > 0) this.lastInboxActivityAt = Date.now();
      this.scheduleNextPoll();
    } catch (err) {
      this.log.warn({ err: String(err) }, "cloudbase inbox poll failed");
      this.scheduleNextPoll(POLL_ERROR_BACKOFF_MS);
    }
  }

  private loadOrCreateMacId() {
    try {
      if (existsSync(MAC_ID_FILE)) {
        const existing = readFileSync(MAC_ID_FILE, "utf8").trim();
        if (/^mac_[A-Za-z0-9_-]+_[a-f0-9]{4,16}$/.test(existing)) return existing;
      }
    } catch (err) {
      this.log.warn({ err: String(err) }, "load cloudbase macId failed");
    }
    const host = hostname().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32) || "host";
    const hash = createHash("sha256").update(`${host}|${process.env.USER || ""}|${HOME_DIR}|${WORKBENCH_ENV}`).digest("hex").slice(0, 8);
    const envPrefix = WORKBENCH_ENV && WORKBENCH_ENV !== "prod" ? `${WORKBENCH_ENV}_` : "";
    const macId = `mac_${envPrefix}${host}_${hash}`;
    try {
      mkdirSync(path.dirname(MAC_ID_FILE), { recursive: true });
      writeFileSync(MAC_ID_FILE, macId, "utf8");
    } catch (err) {
      this.log.warn({ err: String(err), file: MAC_ID_FILE }, "persist cloudbase macId failed");
    }
    return macId;
  }

  private brokerHeaders() {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.macId) headers["X-OpenClaw-Mac-Id"] = this.macId;
    return headers;
  }

  private async brokerJson(pathname: string, init: RequestInit) {
    const res = await fetch(`${this.brokerUrl}${pathname}`, {
      ...init,
      headers: { ...this.brokerHeaders(), ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(BROKER_TIMEOUT_MS),
    });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { ok: false, raw: text.slice(0, 240) };
    }
    if (!res.ok) throw new Error(`broker ${init.method || "GET"} ${pathname} ${res.status}: ${JSON.stringify(parsed).slice(0, 240)}`);
    return parsed;
  }

  private async registerWithRetry() {
    if (this.stopped || !this.macId) return;
    try {
      const result = await this.brokerJson("/mac/register", {
        method: "POST",
        body: JSON.stringify({
          macId: this.macId,
          endpoint: this.localUrl,
          version: this.version,
          capabilities: ["mobile-relay", "openclaw-workbench"],
          hostname: hostname(),
          registeredAt: nowIso(),
        }),
      }) as { status?: string };
      this.log.info({ macId: this.macId, status: result.status || "registered" }, "cloudbase forwarder registered");
    } catch (err) {
      this.log.warn({ err: String(err), macId: this.macId }, "cloudbase register failed, retrying");
      if (!this.stopped) {
        this.registerTimer = setTimeout(() => void this.registerWithRetry(), REGISTER_RETRY_MS);
        this.registerTimer.unref?.();
      }
    }
  }

  private async heartbeat() {
    if (!this.macId) return;
    await this.brokerJson("/mac/heartbeat", {
      method: "POST",
      body: JSON.stringify({ macId: this.macId, ts: nowIso() }),
    });
  }

  private async pollInbox() {
    if (!this.macId) return 0;
    const result = await this.brokerJson(`/mac/${encodeURIComponent(this.macId)}/inbox`, { method: "GET" }) as {
      requests?: BrokerInboxRequest[];
    };
    const requests = result.requests || [];
    for (const request of requests) {
      void this.handleInboxRequest(request).catch((err) =>
        this.log.warn({ err: String(err), requestId: request.requestId }, "cloudbase request handling failed"),
      );
    }
    return requests.length;
  }

  private async handleInboxRequest(request: BrokerInboxRequest) {
    const startedAt = Date.now();
    let httpStatus = 500;
    let response: unknown = { ok: false, error: "forward_failed" };
    let error: string | null = null;
    try {
      const headers = this.localHeaders(request);
      const hasBody = request.body !== undefined && request.body !== null && !["GET", "HEAD"].includes(request.method.toUpperCase());
      if (hasBody) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === "content-type") delete headers[key];
        }
        headers["Content-Type"] = "application/json";
      } else {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === "content-type") delete headers[key];
        }
      }
      const init: RequestInit = {
        method: request.method,
        headers,
        signal: AbortSignal.timeout(LOCAL_FORWARD_TIMEOUT_MS),
      };
      if (hasBody) {
        init.body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
      }
      const localRes = await fetch(`${this.localUrl}${request.path}`, init);
      httpStatus = localRes.status;
      const text = await localRes.text();
      try {
        response = text ? JSON.parse(text) : {};
      } catch {
        response = { ok: localRes.ok, text: text.slice(0, 120_000) };
      }
    } catch (err) {
      httpStatus = 502;
      error = "local_forward_failed";
      response = { ok: false, error, detail: String(err).slice(0, 500) };
    }

    let compactedResponse = compactBrokerResponse(request.path, response);
    // 2026-06-25 — P0: generic 70KB safety net. If any response is still over
    // budget after path-specific compaction, truncate the longest string field
    // recursively until under 70KB. We refuse rather than silently corrupt.
    const SAFETY_NET_BYTES = 70_000;
    let responseBytes = brokerPayloadBytes(compactedResponse);
    if (responseBytes > SAFETY_NET_BYTES) {
      compactedResponse = truncateLongestStringField(compactedResponse, SAFETY_NET_BYTES);
      responseBytes = brokerPayloadBytes(compactedResponse);
    }
    if (responseBytes > MAX_BROKER_ACK_RESPONSE_BYTES) {
      httpStatus = 502;
      error = "relay_payload_too_large";
      response = {
        ok: false,
        error,
        originalBytes: responseBytes,
        maxBytes: MAX_BROKER_ACK_RESPONSE_BYTES,
        path: request.path,
      };
    } else {
      response = compactedResponse;
    }

    await this.brokerJson(`/mac/ack/${encodeURIComponent(request.requestId)}`, {
      method: "POST",
      body: JSON.stringify({
        macId: this.macId,
        requestId: request.requestId,
        httpStatus,
        response,
        error,
        durationMs: Date.now() - startedAt,
      }),
    }).catch((err) => this.log.warn({ err: String(err), requestId: request.requestId }, "cloudbase ack failed"));
  }

  private localHeaders(request: BrokerInboxRequest) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers || {})) {
      const lower = key.toLowerCase();
      if (["host", "content-length", "connection", "keep-alive", "transfer-encoding"].includes(lower)) continue;
      headers[key] = value;
    }
    headers["X-Forwarded-By"] = "cloudbase-forwarder";
    headers["X-Original-Request-Id"] = request.requestId;
    if (FORWARDER_AUTH_TOKEN) headers["X-OpenClaw-Forwarder-Token"] = FORWARDER_AUTH_TOKEN;
    return headers;
  }
}

function brokerPayloadBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
}

function truncateLongestStringField(value: unknown, maxBytes: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
    const sliceBytes = Math.max(0, maxBytes - 64);
    let out = value.slice(0, sliceBytes);
    while (Buffer.byteLength(out, "utf8") > sliceBytes) out = out.slice(0, -1);
    return out + "…[truncated]";
  }
  if (Array.isArray(value)) {
    return value.map((v) => truncateLongestStringField(v, maxBytes));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateLongestStringField(v, maxBytes);
    }
    return out;
  }
  return value;
}

function compactBrokerResponse(pathname: string, response: unknown) {
  if (pathname.startsWith("/api/mobile/today")) return compactMobileTodayResponse(response);
  if (pathname.startsWith("/api/mobile/knowledge/atlas")) return compactMobileAtlasResponse(response);
  if (pathname.startsWith("/api/mobile/kb/list")) return compactMobileKbListResponse(response);
  if (pathname.startsWith("/api/mobile/calendar")) return compactMobileCalendarResponse(response);
  if (pathname.startsWith("/api/mobile/bootstrap")) return compactMobileBootstrapResponse(response);
  if (pathname === "/api/chat/send" || pathname === "/api/chat/send-stream") return compactChatSendResponse(response);
  return response;
}

// 2026-06-25 — P0 CloudBase broker 80KB cap
// LLM long responses can exceed the broker ack budget. Truncate the assistant
// message to 50KB and surface _truncated + _truncatedBytes so the mobile can
// fetch the full text from /api/chat/sessions/:id/messages separately.
function compactChatSendResponse(response: unknown) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const row = response as Record<string, unknown>;
  const assistant = row.assistant as Record<string, unknown> | undefined;
  if (assistant && typeof assistant.content === "string") {
    const full = assistant.content;
    const fullBytes = Buffer.byteLength(full, "utf8");
    // Truncate to <= 50KB BYTES (not chars), never split a multi-byte char.
    const BYTE_LIMIT = 50_000;
    if (fullBytes > BYTE_LIMIT) {
      const buf = Buffer.from(full, "utf8");
      // Walk back from limit to land on a UTF-8 start byte.
      let cut = BYTE_LIMIT;
      while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut--;
      const truncated = buf.subarray(0, cut).toString("utf8") + "\n\n[内容已截断,完整内容请查看历史消息]";
      row.assistant = { ...assistant, content: truncated };
      row._truncated = true;
      row._truncatedBytes = fullBytes;
    }
  }
  return row;
}

function compactMobileTodayResponse(response: unknown) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const row = response as Record<string, unknown>;
  return {
    ok: row.ok,
    date: row.date,
    updatedAt: row.updatedAt,
    status: row.status,
    source: row.source,
    gateway: compactObject(row.gateway, ["ok", "status", "state", "model", "provider", "error", "message", "updatedAt", "checkedAt"]),
    sources: row.sources,
    agentOps: compactArray(row.agentOps, 3, ["id", "name", "role", "visualStatus", "liveStatus", "gateway", "activeCount", "unreadInbox", "progressPercent", "lastActivityAt", "currentWork"]),
    nextActions: compactArray(row.nextActions, 10, ["id", "kind", "priority", "title", "summary", "actionLabel", "target", "source", "createdAt"]),
    timeline: compactArray(row.timeline, 20, ["id", "kind", "title", "time", "status", "priority", "source"]),
    todos: compactArray(row.todos, 80, ["id", "title", "status", "priority", "source", "start_at", "due_at", "updated_at"]),
    events: compactArray(row.events, 20, ["id", "title", "status", "priority", "source", "start_at", "due_at", "updated_at"]),
    planItems: compactArray(row.planItems, 20, ["id", "title", "status", "priority", "source", "start_at", "due_at", "updated_at"]),
    approvals: compactArray(row.approvals, 40, ["id", "task_id", "action", "status", "requested_at", "resolved_at", "details"]),
    blocked: compactArray(row.blocked, 12, ["id", "title", "status", "agentId", "agent_id", "priority", "lastActivityAt", "summary"]),
    tasks: compactArray(row.tasks, 12, ["id", "title", "status", "agentId", "agent_id", "priority", "lastActivityAt", "summary"]),
    notes: compactArray(row.notes, 12, ["id", "title", "status", "source", "updated_at", "created_at"]),
    reports: compactArray(row.reports, 8, ["id", "title", "status", "source", "updated_at", "created_at"]),
    holidays: compactArray(row.holidays, 8, ["id", "name", "title", "date", "type", "source"]),
    inbox: compactObject(row.inbox, ["unread", "total", "latest", "updatedAt"]),
    stats: row.stats,
  };
}

function compactMobileAtlasResponse(response: unknown) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const row = response as Record<string, unknown>;
  const graph = (row.graph || {}) as Record<string, unknown>;
  return {
    ok: row.ok,
    updatedAt: row.updatedAt,
    sources: row.sources,
    sourceStates: compactArray(row.sourceStates, 48, ["id", "title", "path", "source", "type", "status", "updatedAt", "summary"]),
    categories: compactArray(row.categories, 14, ["id", "title", "status", "sourceCount", "wikiCount", "summary"]),
    noteCategories: compactArray(row.noteCategories, 12, ["id", "title", "status", "sourceCount", "wikiCount", "summary"]),
    atlasSummary: row.atlasSummary,
    focusItems: compactArray(row.focusItems, 8, ["id", "title", "status", "summary", "source", "path"]),
    graph: {
      nodes: compactArray(graph.nodes, 48, ["id", "label", "type", "source"]),
      edges: compactArray(graph.edges, 72, ["id", "from", "to", "relation"]),
    },
    wikiStatus: compactObject(row.wikiStatus, ["ok", "status", "summary", "updatedAt"]),
    live: compactObject(row.live, ["ok", "status", "summary", "updatedAt"]),
  };
}

function compactMobileKbListResponse(response: unknown) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const row = response as Record<string, unknown>;
  return {
    ok: row.ok,
    path: row.path,
    parent: row.parent,
    vaultRoot: row.vaultRoot,
    entries: compactArray(row.entries, 160, ["name", "kind", "size", "path"]),
    total: row.total,
  };
}

function compactMobileCalendarResponse(response: unknown) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const row = response as Record<string, unknown>;
  return {
    ok: row.ok,
    date: row.date,
    start: row.start,
    end: row.end,
    event: compactObject(row.event, ["id", "date", "startTime", "endTime", "title", "description", "status", "kind", "source", "createdAt", "updatedAt"]),
    events: compactArray(row.events, 120, ["id", "date", "startTime", "endTime", "title", "description", "status", "kind", "source", "createdAt", "updatedAt"]),
    id: row.id,
  };
}

function compactMobileBootstrapResponse(response: unknown) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const row = response as Record<string, unknown>;
  const vault = row.vault as Record<string, unknown> | undefined;
  return {
    ok: row.ok,
    user: row.user,
    service: row.service,
    mobile: row.mobile,
    gateway: compactObject(row.gateway, ["ok", "status", "state", "model", "provider", "error", "message", "updatedAt", "checkedAt"]),
    sources: row.sources,
    agentOps: compactArray(row.agentOps, 6, ["id", "name", "role", "visualStatus", "liveStatus", "gateway", "activeCount", "unreadInbox", "progressPercent", "lastActivityAt", "currentWork"]),
    inbox: compactObject(row.inbox, ["unread", "total", "latest", "updatedAt"]),
    stats: row.stats,
    vault: vault ? {
      vaultRoot: vault.vaultRoot || vault.root,
      vaultLabel: vault.vaultLabel || vault.displayName,
      vaultAvailable: vault.vaultAvailable,
      vaultFallbackReason: vault.vaultFallbackReason || vault.reason || null,
      root: vault.root || vault.vaultRoot,
      status: vault.status,
      reason: vault.reason || null,
      writable: vault.writable,
      writeReason: vault.writeReason || null,
      graphPath: vault.graphPath || null,
      displayName: vault.displayName || vault.vaultLabel,
      preferredEntries: Array.isArray(vault.preferredEntries) ? vault.preferredEntries.slice(0, 12) : [],
      kbVaultDir: vault.kbVaultDir,
    } : null,
    featureFlags: row.featureFlags,
  };
}

function compactArray(value: unknown, limit: number, keys: string[]) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => compactObject(item, keys));
}

function compactObject(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value ?? null;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] === undefined) continue;
    out[key] = compactValue(source[key]);
  }
  return out;
}

function compactValue(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, 240);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 6).map(compactValue);
  if (typeof value === "object") return compactObject(value, ["id", "title", "name", "status", "summary", "type"]);
  return String(value).slice(0, 120);
}

export async function publishPairCodeToBroker(opts: {
  macId: string;
  macHint?: string;
  deviceHint?: string;
}): Promise<{ ok: true; brokerCode: string; expiresAt?: number; brokerUrl: string } | { ok: false; error: string; brokerUrl: string }> {
  if (!CLOUDBASE_ENABLED) return { ok: false, error: "cloudbase_disabled", brokerUrl: CLOUDBASE_BROKER_URL };
  try {
    const res = await fetch(`${CLOUDBASE_BROKER_URL}/pair/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        macId: opts.macId,
        macHint: opts.macHint || opts.macId,
        deviceHint: opts.deviceHint || "",
      }),
      signal: AbortSignal.timeout(BROKER_TIMEOUT_MS),
    });
    const text = await res.text();
    let parsed: { ok?: boolean; code?: string; expiresAt?: number; error?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    if (!res.ok || !parsed.ok || !parsed.code) {
      return { ok: false, error: parsed.error || `broker_${res.status}`, brokerUrl: CLOUDBASE_BROKER_URL };
    }
    return { ok: true, brokerCode: parsed.code, expiresAt: parsed.expiresAt, brokerUrl: CLOUDBASE_BROKER_URL };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 240), brokerUrl: CLOUDBASE_BROKER_URL };
  }
}
