import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const base = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const token = "codex_gate5_smoke_20260509";
const db = new DatabaseSync(new URL("../data/workbench.sqlite", import.meta.url).pathname);
const now = new Date().toISOString();
const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
db.prepare("INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash, 1, expires, now);

const cookie = `owb_session=${encodeURIComponent(token)}`;
const created = {
  todos: [],
  events: [],
  templates: [],
  reports: [],
  chats: [],
};

cleanupTaggedRows();

async function api(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(`${path} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

try {
  const unauth = await fetch(`${base}/api/personal`, { signal: AbortSignal.timeout(5000) });
  if (unauth.status !== 401) throw new Error(`unauth guard failed: ${unauth.status}`);

  const todo = await api("/api/todos", {
    method: "POST",
    body: JSON.stringify({ title: "GATE5_SMOKE_TODO_20260509", priority: "P1", dueAt: "2026-05-09T18:00", tags: ["gate5", "smoke"] }),
  });
  created.todos.push(todo.todo.id);
  const patchedTodo = await api(`/api/todos/${todo.todo.id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "GATE5_SMOKE_TODO_DONE_20260509", status: "done", priority: "P0", tags: ["gate5", "done"] }),
  });
  if (patchedTodo.todo.status !== "done" || patchedTodo.todo.priority !== "P0") throw new Error("todo patch failed");

  const event = await api("/api/events", {
    method: "POST",
    body: JSON.stringify({ title: "GATE5_SMOKE_EVENT_20260509", startAt: "2026-05-09T09:00", eventType: "meeting" }),
  });
  created.events.push(event.event.id);
  const patchedEvent = await api(`/api/events/${event.event.id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "GATE5_SMOKE_EVENT_EDITED_20260509", eventType: "deadline" }),
  });
  if (patchedEvent.event.title !== "GATE5_SMOKE_EVENT_EDITED_20260509" || patchedEvent.event.event_type !== "deadline") throw new Error("event patch failed");

  const templates = await api("/api/reports/templates");
  const reportTypes = new Set(templates.templates.map((row) => row.report_type));
  for (const type of ["daily", "weekly", "monthly", "yearly"]) {
    if (!reportTypes.has(type)) throw new Error(`missing default template: ${type}`);
  }

  const template = await api("/api/reports/templates", {
    method: "POST",
    body: JSON.stringify({ reportType: "daily", name: "GATE5_SMOKE_TEMPLATE_20260509", style: "smoke", content: "# Smoke\n\n{{summary}}" }),
  });
  created.templates.push(template.template.id);
  const patchedTemplate = await api(`/api/reports/templates/${template.template.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: "GATE5_SMOKE_TEMPLATE_EDITED_20260509", content: "# Smoke edited\n\n{{summary}}" }),
  });
  if (patchedTemplate.template.name !== "GATE5_SMOKE_TEMPLATE_EDITED_20260509") throw new Error("template patch failed");

  for (const reportType of ["daily", "weekly", "monthly", "yearly"]) {
    const report = await api("/api/reports/generate", {
      method: "POST",
      body: JSON.stringify({ reportType, rangeStart: "2026-05-09", sources: ["events", "todos", "projects", "tasks"], notes: `GATE5_SMOKE_${reportType}` }),
    });
    created.reports.push(report.report.id);
    if (report.report.status !== "completed" || !report.report.markdown_path || !report.report.html_path) throw new Error(`report failed: ${reportType}`);
  }

  const exported = await api(`/api/reports/${created.reports[0]}/export`);
  if (!exported.export?.markdown_path || !exported.export?.html_path) throw new Error("report export failed");

  const chat = await api("/api/chat/send", {
    method: "POST",
    body: JSON.stringify({ agentId: "main", knowledgeSources: ["all"], skillIds: ["task-executor"], planEnabled: true, message: "GATE5_SMOKE_ASSISTANT_CONTEXT_20260509" }),
  });
  created.chats.push(chat.sessionId);
  if (!chat.planMessageId || !String(chat.plan || "").includes("# 执行计划")) throw new Error("assistant plan card failed");

  const personal = await api("/api/personal");
  if (!Array.isArray(personal.todos) || !Array.isArray(personal.events) || !Array.isArray(personal.projects)) throw new Error("personal aggregate failed");

  console.log(JSON.stringify({
    ok: true,
    unauthorizedStatus: unauth.status,
    todo: patchedTodo.todo.status,
    event: patchedEvent.event.event_type,
    defaultTemplates: reportTypes.size,
    generatedReports: created.reports.length,
    export: exported.export,
    assistantPlan: chat.planMessageId,
  }, null, 2));
} finally {
  for (const id of created.chats) {
    db.prepare("DELETE FROM chat_attachments WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
  }
  for (const id of created.reports) db.prepare("DELETE FROM reports WHERE id = ?").run(id);
  for (const id of created.templates) db.prepare("DELETE FROM report_templates WHERE id = ?").run(id);
  for (const id of created.events) db.prepare("DELETE FROM events WHERE id = ?").run(id);
  for (const id of created.todos) db.prepare("DELETE FROM todos WHERE id = ?").run(id);
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  cleanupTaggedRows();
  db.close();
}

function cleanupTaggedRows() {
  const chatSessions = db.prepare("SELECT DISTINCT session_id FROM chat_messages WHERE content LIKE '%GATE5_SMOKE_ASSISTANT_CONTEXT_20260509%'").all();
  for (const row of chatSessions) {
    db.prepare("DELETE FROM chat_attachments WHERE session_id = ?").run(row.session_id);
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(row.session_id);
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(row.session_id);
  }
  db.prepare("DELETE FROM reports WHERE content LIKE '%GATE5_SMOKE_%' OR title LIKE '%GATE5_SMOKE_%'").run();
  db.prepare("DELETE FROM report_templates WHERE name LIKE 'GATE5_SMOKE_%'").run();
  db.prepare("DELETE FROM events WHERE title LIKE 'GATE5_SMOKE_%'").run();
  db.prepare("DELETE FROM todos WHERE title LIKE 'GATE5_SMOKE_%'").run();
}
