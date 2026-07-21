import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertWritableSmokeTarget } from "./env-config.mjs";

const base = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const lanBase = process.env.OPENCLAW_WORKBENCH_LAN_URL || base;
assertWritableSmokeTarget({
  baseUrl: base,
  env: process.env.OPENCLAW_WORKBENCH_ENV,
  allowProdWrite: process.env.OPENCLAW_ALLOW_PROD_SMOKE_WRITE,
});
const marker = "PRD11_TEST_20260509";
const token = `${marker}_token`;
const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const repoDataDir = path.join(repoRoot, "data");
const dataDir = process.env.OPENCLAW_DATA_DIR || repoDataDir;
const db = new DatabaseSync(path.join(dataDir, "workbench.sqlite"));
const workspaceDir = process.env.OPENCLAW_WORKSPACE || repoRoot;
const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
const now = new Date().toISOString();
const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const cookie = `owb_session=${encodeURIComponent(token)}`;
const requestTimeoutMs = Number(process.env.OPENCLAW_WORKBENCH_SMOKE_TIMEOUT_MS || 120_000);
const created = {
  chats: [],
  attachments: [],
  cron: [],
  inbox: [],
  tasks: [],
  approvals: [],
  knowledgeEntries: [],
  knowledgeFiles: [],
  previewChats: [],
  outputJobs: [],
  reports: [],
  templates: [],
  projects: [],
  milestones: [],
  deliverables: [],
  todos: [],
  events: [],
  models: [],
};

async function api(route, options = {}, root = base) {
  const res = await fetch(`${root}${route}`, {
    ...options,
    headers: { Cookie: cookie, ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok || data.ok === false) throw new Error(`${route} failed: ${res.status} ${text}`);
  return data;
}

function cleanup() {
  const chatRows = db.prepare("SELECT DISTINCT session_id FROM chat_messages WHERE content LIKE ?").all(`%${marker}%`);
  for (const row of chatRows) created.chats.push(row.session_id);
  for (const id of [...new Set(created.chats)]) {
    db.prepare("DELETE FROM chat_attachments WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
  }
  for (const table of [
    ["approvals", "id", created.approvals],
    ["development_goals", "project_id", created.projects],
    ["development_subtask_acceptance", "project_id", created.projects],
    ["development_subtasks", "project_id", created.projects],
    ["development_baselines", "project_id", created.projects],
    ["development_product_roles", "project_id", created.projects],
    ["development_project_workspaces", "project_id", created.projects],
    ["development_review_records", "project_id", created.projects],
    ["development_context_manifests", "project_id", created.projects],
    ["development_gate_definitions", "project_id", created.projects],
    ["development_plugin_registry", "project_id", created.projects],
    ["development_tool_registry", "project_id", created.projects],
    ["development_work_packets", "project_id", created.projects],
    ["development_gates", "project_id", created.projects],
    ["development_artifacts", "project_id", created.projects],
    ["development_run_events", "project_id", created.projects],
    ["development_runs", "project_id", created.projects],
    ["development_stages", "project_id", created.projects],
    ["development_documents", "project_id", created.projects],
    ["development_project_profiles", "project_id", created.projects],
    ["task_events", "task_id", created.tasks],
    ["approvals", "task_id", created.tasks],
    ["task_dependencies", "task_id", created.tasks],
    ["task_dependencies", "depends_on_task_id", created.tasks],
    ["tasks", "id", created.tasks],
    ["knowledge_preview_chats", "id", created.previewChats],
    ["knowledge_output_jobs", "id", created.outputJobs],
    ["knowledge_links", "source_entry_id", created.knowledgeEntries],
    ["calendar_notes", "knowledge_entry_id", created.knowledgeEntries],
    ["knowledge_entries", "id", created.knowledgeEntries],
    ["knowledge_file_index", "id", created.knowledgeFiles],
    ["reports", "id", created.reports],
    ["report_templates", "id", created.templates],
    ["cron_jobs", "id", created.cron],
    ["inbox_items", "id", created.inbox],
    ["project_deliverables", "id", created.deliverables],
    ["project_milestones", "id", created.milestones],
    ["development_goals", "project_id", created.projects],
    ["development_subtask_acceptance", "project_id", created.projects],
    ["development_subtasks", "project_id", created.projects],
    ["development_baselines", "project_id", created.projects],
    ["development_product_roles", "project_id", created.projects],
    ["development_project_workspaces", "project_id", created.projects],
    ["development_review_records", "project_id", created.projects],
    ["development_context_manifests", "project_id", created.projects],
    ["development_gate_definitions", "project_id", created.projects],
    ["development_plugin_registry", "project_id", created.projects],
    ["development_tool_registry", "project_id", created.projects],
    ["development_work_packets", "project_id", created.projects],
    ["development_gates", "project_id", created.projects],
    ["development_artifacts", "project_id", created.projects],
    ["development_run_events", "project_id", created.projects],
    ["development_runs", "project_id", created.projects],
    ["development_stages", "project_id", created.projects],
    ["development_documents", "project_id", created.projects],
    ["development_project_profiles", "project_id", created.projects],
    ["projects", "id", created.projects],
    ["plan_items", "todo_id", created.todos],
    ["todo_sync_conflicts", "todo_id", created.todos],
    ["todo_sync_links", "todo_id", created.todos],
    ["todos", "id", created.todos],
    ["event_sync_conflicts", "event_id", created.events],
    ["event_sync_links", "event_id", created.events],
    ["events", "id", created.events],
    ["model_configs", "id", created.models],
  ]) {
    const [tableName, col, ids] = table;
    for (const id of ids) db.prepare(`DELETE FROM ${tableName} WHERE ${col} = ?`).run(id);
  }
  db.prepare("DELETE FROM reports WHERE content LIKE ? OR title LIKE ?").run(`%${marker}%`, `%${marker}%`);
  const devProjectRows = db.prepare("SELECT id FROM projects WHERE name LIKE ? OR objective LIKE ?").all(`${marker}%`, `%${marker}%`);
  for (const row of devProjectRows) {
    for (const table of ["development_goals", "development_subtask_acceptance", "development_subtasks", "development_baselines", "development_product_roles", "development_project_workspaces", "development_review_records", "development_context_manifests", "development_gate_definitions", "development_plugin_registry", "development_tool_registry", "development_work_packets", "development_gates", "development_artifacts", "development_run_events", "development_runs", "development_stages", "development_documents", "development_project_profiles"]) {
      db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(row.id);
    }
  }
  db.prepare("DELETE FROM report_templates WHERE name LIKE ?").run(`${marker}%`);
  db.prepare("DELETE FROM cron_jobs WHERE name LIKE ?").run(`${marker}%`);
  db.prepare("DELETE FROM inbox_items WHERE title LIKE ?").run(`${marker}%`);
  const markerProjectRows = db.prepare("SELECT id FROM projects WHERE name LIKE ? OR objective LIKE ?").all(`${marker}%`, `%${marker}%`);
  for (const row of markerProjectRows) {
    db.prepare("DELETE FROM project_deliverables WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM project_milestones WHERE project_id = ?").run(row.id);
    db.prepare("DELETE FROM plan_items WHERE todo_id IN (SELECT id FROM todos WHERE project_id = ?)").run(row.id);
    db.prepare("DELETE FROM todo_sync_conflicts WHERE todo_id IN (SELECT id FROM todos WHERE project_id = ?)").run(row.id);
    db.prepare("DELETE FROM todo_sync_links WHERE todo_id IN (SELECT id FROM todos WHERE project_id = ?)").run(row.id);
    db.prepare("DELETE FROM todos WHERE project_id = ?").run(row.id);
  }
  const markerTaskRows = db.prepare("SELECT id FROM tasks WHERE title LIKE ?").all(`${marker}%`);
  for (const row of markerTaskRows) {
    db.prepare("DELETE FROM approvals WHERE task_id = ?").run(row.id);
    db.prepare("DELETE FROM task_events WHERE task_id = ?").run(row.id);
    db.prepare("DELETE FROM development_run_events WHERE task_id = ?").run(row.id);
    db.prepare("DELETE FROM development_artifacts WHERE task_id = ?").run(row.id);
    db.prepare("UPDATE development_work_packets SET active_task_id = NULL WHERE active_task_id = ?").run(row.id);
    db.prepare("DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?").run(row.id, row.id);
  }
  db.prepare("DELETE FROM tasks WHERE title LIKE ?").run(`${marker}%`);
  db.prepare("DELETE FROM projects WHERE name LIKE ?").run(`${marker}%`);
  db.prepare("DELETE FROM plan_items WHERE todo_id IN (SELECT id FROM todos WHERE title LIKE ?)").run(`${marker}%`);
  db.prepare("DELETE FROM todo_sync_conflicts WHERE todo_id IN (SELECT id FROM todos WHERE title LIKE ?)").run(`${marker}%`);
  db.prepare("DELETE FROM todo_sync_links WHERE todo_id IN (SELECT id FROM todos WHERE title LIKE ?)").run(`${marker}%`);
  db.prepare("DELETE FROM todos WHERE title LIKE ?").run(`${marker}%`);
  db.prepare("DELETE FROM event_sync_conflicts WHERE event_id IN (SELECT id FROM events WHERE title LIKE ?)").run(`${marker}%`);
  db.prepare("DELETE FROM event_sync_links WHERE event_id IN (SELECT id FROM events WHERE title LIKE ?)").run(`${marker}%`);
  db.prepare("DELETE FROM events WHERE title LIKE ?").run(`${marker}%`);
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

try {
  cleanup();
  db.prepare("INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash, 1, expires, now);
  const unauth = await fetch(`${base}/api/personal`, { signal: AbortSignal.timeout(5000) });
  if (unauth.status !== 401) throw new Error(`auth guard expected 401, got ${unauth.status}`);

  const skills = await api("/api/skills");
  if (!skills.skills?.length) throw new Error("skills unavailable");
  const modelsBefore = await api("/api/model-configs");
  if (JSON.stringify(modelsBefore.models).toLowerCase().includes("deepseek-r1-14b-local")) throw new Error("archived default deepseek should not appear in model configs");
  const model = await api("/api/model-configs", { method: "POST", body: JSON.stringify({ label: `${marker}_model_api`, provider: "minimax", model: `${marker}_model`, apiKeyRef: "PRD11_TEST_API_KEY" }) });
  created.models.push(model.model.id);
  await api(`/api/model-configs/${model.model.id}`, { method: "DELETE" });
  const modelsAfterDelete = await api("/api/model-configs");
  if (JSON.stringify(modelsAfterDelete.models).includes(model.model.id)) throw new Error("archived model still appeared in model configs");

  const session = await api("/api/chat/sessions", { method: "POST", body: JSON.stringify({ title: `${marker}_chat`, agentId: "main", knowledgeSources: ["all"], skillIds: ["task-executor"], planEnabled: true }) });
  created.chats.push(session.session.id);
  const renamed = await api(`/api/chat/sessions/${session.session.id}`, { method: "PATCH", body: JSON.stringify({ title: `${marker}_renamed`, favorite: true }) });
  if (!renamed.session.favorite) throw new Error("chat favorite failed");
  const attachment = await api("/api/chat/attachments", { method: "POST", body: JSON.stringify({ sessionId: session.session.id, type: "file", name: `${marker}.md`, content: marker }) });
  created.attachments.push(attachment.attachment.id);
  const attachment2 = await api("/api/chat/attachments", { method: "POST", body: JSON.stringify({ sessionId: session.session.id, type: "file", name: `${marker}_second.md`, content: `${marker} second` }) });
  created.attachments.push(attachment2.attachment.id);
  const sent = await api("/api/chat/send", { method: "POST", body: JSON.stringify({ sessionId: session.session.id, message: `${marker} plan request`, agentId: "main", knowledgeSources: ["nas", "ima"], skillIds: ["knowledge-base"], planEnabled: true, attachmentIds: [attachment.attachment.id, attachment2.attachment.id] }) });
  if (!sent.plan?.includes("task-executor")) throw new Error("plan should include task-executor");
  if (JSON.stringify(sent).includes("DEP0040") || JSON.stringify(sent).includes("punycode")) throw new Error("chat send leaked node warning");
  const confirmed = await api(`/api/chat/plan/${sent.planMessageId}/confirm`, { method: "POST" });
  if (!confirmed.execution?.skills?.includes("task-executor")) throw new Error("confirmed plan missing task-executor execution");
  if (JSON.stringify(confirmed).includes("Command failed: openclaw-cn gateway call")) throw new Error("confirmed plan leaked raw gateway command");
  if (JSON.stringify(confirmed).includes("DEP0040") || JSON.stringify(confirmed).includes("punycode")) throw new Error("confirmed plan leaked node warning");
  const updated = await api(`/api/chat/messages/${sent.userMessageId}`, { method: "PATCH", body: JSON.stringify({ favorite: true }) });
  if (!updated.message.favorite) throw new Error("message favorite failed");
  const regenerated = await api(`/api/chat/messages/${sent.planMessageId}/regenerate`, { method: "POST" });
  if (JSON.stringify(regenerated).includes("Command failed: openclaw-cn gateway call")) throw new Error("regenerate leaked raw gateway command");
  await api(`/api/chat/messages/${sent.userMessageId}`, { method: "DELETE" });
  await api("/api/chat/export", { method: "POST", body: JSON.stringify({ sessionId: session.session.id }) });

  const cron = await api("/api/cron", { method: "POST", body: JSON.stringify({ agentId: "main", name: `${marker}_cron`, expression: "15 9 * * 1", prompt: marker, status: "paused" }) });
  created.cron.push(cron.job.id);
  const inbox = await api("/api/inbox", { method: "POST", body: JSON.stringify({ agentId: "main", title: `${marker}_inbox`, body: marker }) });
  created.inbox.push(inbox.item.id);
  await api(`/api/inbox/${inbox.item.id}`, { method: "PATCH", body: JSON.stringify({ status: "read" }) });

  const task = await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: `${marker}_task`, description: marker, agentId: "worker", riskLevel: "high", priority: "P1" }) });
  created.tasks.push(task.task.id);
  for (const action of ["inject", "pause", "retry", "terminate"]) {
    const approval = await api(`/api/tasks/${task.task.id}/${action}`, { method: "POST" });
    created.approvals.push(approval.approval.id);
  }
  const taskDetail = await api(`/api/tasks/${task.task.id}`);
  if (!taskDetail.task || taskDetail.events.length < 1) throw new Error("task detail failed");

  const upload = await api("/api/knowledge/upload", { method: "POST", body: JSON.stringify({ source: "workspace", name: `${marker}.md`, content: marker }) });
  created.knowledgeFiles.push(upload.upload.id);
  await api(`/api/knowledge/preview?path=${encodeURIComponent(upload.upload.path)}`);
  const folders = await api("/api/knowledge/folders?scope=local");
  const notesTarget = folders.folders.find((folder) => String(folder.path || "").includes("memory/knowledge/notes/openclaw"))?.path
    || folders.folders.find((folder) => folder.scope === "memory")?.path;
  if (!notesTarget) throw new Error("knowledge local target folder unavailable");
  const importMove = await api("/api/knowledge/files/import", { method: "POST", body: JSON.stringify({ files: [{ name: `${marker}_move.md`, mime: "text/markdown", size: marker.length, contentBase64: Buffer.from(marker).toString("base64") }] }) });
  created.knowledgeFiles.push(importMove.files[0].fileId);
  const movedFile = await api("/api/knowledge/files/move", { method: "POST", body: JSON.stringify({ path: importMove.files[0].path, targetFolderPath: notesTarget }) });
  if (!movedFile.file?.path?.startsWith(notesTarget)) throw new Error("knowledge file move target mismatch");
  const archivedFile = await api("/api/knowledge/files/archive", { method: "POST", body: JSON.stringify({ path: movedFile.file.path }) });
  if (!archivedFile.file?.path?.includes("archive/files")) throw new Error("knowledge archive path mismatch");
  const importTrash = await api("/api/knowledge/files/import", { method: "POST", body: JSON.stringify({ files: [{ name: `${marker}_trash.md`, mime: "text/markdown", size: marker.length, contentBase64: Buffer.from(marker).toString("base64") }] }) });
  created.knowledgeFiles.push(importTrash.files[0].fileId);
  const trashedFile = await api("/api/knowledge/files/trash", { method: "POST", body: JSON.stringify({ path: importTrash.files[0].path }) });
  if (trashedFile.file?.status !== "trashed" || !trashedFile.file?.path?.includes("archive/.trash")) throw new Error("knowledge trash path mismatch");
  const sortTarget = path.join(workspaceDir, "memory/knowledge/inbox", `${marker}_sort_order`);
  const sortImport = await api("/api/knowledge/files/import", {
    method: "POST",
    body: JSON.stringify({
      targetFolderPath: sortTarget,
      files: [
        { name: `${marker}_sort_old.md`, mime: "text/markdown", size: marker.length, contentBase64: Buffer.from(`${marker} old`).toString("base64") },
        { name: `${marker}_sort_new.md`, mime: "text/markdown", size: marker.length, contentBase64: Buffer.from(`${marker} new`).toString("base64") },
      ],
    }),
  });
  for (const file of sortImport.files) created.knowledgeFiles.push(file.fileId);
  const oldSortFile = sortImport.files.find((file) => file.title.includes("_sort_old"));
  const newSortFile = sortImport.files.find((file) => file.title.includes("_sort_new"));
  if (!oldSortFile || !newSortFile) throw new Error("knowledge sort import files missing");
  fs.utimesSync(oldSortFile.path, new Date(Date.now() - 86_400_000), new Date(Date.now() - 86_400_000));
  fs.utimesSync(newSortFile.path, new Date(), new Date());
  const sortPreview = await api(`/api/knowledge/preview?path=${encodeURIComponent(sortTarget)}`);
  const sortTitles = (sortPreview.children || []).map((child) => child.title);
  if (sortTitles.indexOf(newSortFile.title) === -1 || sortTitles.indexOf(oldSortFile.title) === -1) throw new Error("knowledge sort preview missing files");
  if (sortTitles.indexOf(newSortFile.title) > sortTitles.indexOf(oldSortFile.title)) throw new Error("knowledge tree should sort files by mtime desc");
  const previewChat = await api("/api/knowledge/preview-chat", { method: "POST", body: JSON.stringify({ sourcePath: upload.upload.path, question: marker, agentId: "main" }) });
  created.previewChats.push(previewChat.chat.id);
  const output = await api("/api/knowledge/output-jobs", { method: "POST", body: JSON.stringify({ sourcePaths: [upload.upload.path, upload.upload.path], outputType: "report", title: `${marker}_output`, template: "standard" }) });
  created.outputJobs.push(output.job.id);
  if (!String(output.job.notes || "").includes("source")) throw new Error("multi-source output notes missing source count");
  const entry = await api("/api/knowledge/ingest", { method: "POST", body: JSON.stringify({ title: `${marker}_entry`, content: marker, tags: ["prd11"] }) });
  created.knowledgeEntries.push(entry.entry.id);
  await api(`/api/knowledge/graph?entryId=${encodeURIComponent(entry.entry.id)}`);
  const search = await api(`/api/search?q=${encodeURIComponent(`@all ${marker}`)}`);
  if (!search.results) throw new Error("global search failed");

  const template = await api("/api/reports/templates", { method: "POST", body: JSON.stringify({ reportType: "daily", name: `${marker}_template`, style: "prd", content: `# ${marker}` }) });
  created.templates.push(template.template.id);
  const report = await api("/api/reports/generate", { method: "POST", body: JSON.stringify({ reportType: "daily", rangeStart: "2026-05-09", sources: ["events", "todos", "projects", "tasks"], notes: marker, templateId: template.template.id }) });
  created.reports.push(report.report.id);
  await api(`/api/reports/${report.report.id}`, { method: "PATCH", body: JSON.stringify({ title: `${marker}_report_edited`, content: `${marker} edited` }) });
  await api(`/api/reports/${report.report.id}/export`);
  const schedule = await api(`/api/reports/${report.report.id}/schedule`, { method: "POST", body: JSON.stringify({ expression: "0 18 * * *" }) });
  created.cron.push(schedule.job.id);

  const todo = await api("/api/todos", { method: "POST", body: JSON.stringify({ title: `${marker}_todo`, priority: "P1", tags: ["prd11"] }) });
  created.todos.push(todo.todo.id);
  await api(`/api/todos/${todo.todo.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
  const event = await api("/api/events", { method: "POST", body: JSON.stringify({ title: `${marker}_event`, startAt: "2026-05-09T10:00", eventType: "meeting" }) });
  created.events.push(event.event.id);
  const project = await api("/api/projects", { method: "POST", body: JSON.stringify({ name: `${marker}_project`, objective: marker, deadline: "2026-06-01" }) });
  created.projects.push(project.project.id);
  await api(`/api/projects/${project.project.id}`, { method: "PATCH", body: JSON.stringify({ progress: 65 }) });
  const milestone = await api(`/api/projects/${project.project.id}/milestones`, { method: "POST", body: JSON.stringify({ name: `${marker}_milestone`, dueDate: "2026-05-20" }) });
  created.milestones.push(milestone.milestone.id);
  const deliverable = await api(`/api/projects/${project.project.id}/deliverables`, { method: "POST", body: JSON.stringify({ title: `${marker}_deliverable`, uri: upload.upload.path }) });
  created.deliverables.push(deliverable.deliverable.id);
  const devList = await api("/api/development/projects");
  if (!devList.projects?.some((row) => row.id === "aog-copilot")) throw new Error("development seed project missing");
  const devProject = await api("/api/development/projects", { method: "POST", body: JSON.stringify({ name: `${marker}_development_project`, objective: `${marker} development objective`, previewUrl: `${base}/delivery` }) });
  created.projects.push(devProject.project.id);
  const devDetail = await api(`/api/development/projects/${devProject.project.id}`);
  if (!devDetail.detail?.documents?.length) throw new Error("development documents missing");
  if (!devDetail.detail?.gateDefinitions?.length) throw new Error("development gate definitions missing");
  if (!devDetail.detail?.pluginRegistry?.length) throw new Error("development plugin registry missing");
  if (!devDetail.detail?.reviews?.length) throw new Error("development reviewer records missing");
  if (!devDetail.detail?.workspace?.workspacePath?.includes("development_projects")) throw new Error("development workspace missing");
  if (!devDetail.detail?.productRole?.title?.includes("Product Manager")) throw new Error("development product role missing");
  if (!devDetail.detail?.baseline?.subtasks?.length) throw new Error("development baseline missing");
  const workspaceInfo = await api(`/api/development/projects/${devProject.project.id}/workspace`);
  if (workspaceInfo.workspace?.prd?.sourceStatus !== "available") throw new Error("development workspace PRD unavailable");
  const baselineInfo = await api(`/api/development/projects/${devProject.project.id}/baseline`);
  if (!baselineInfo.baseline?.currentSubtask?.id) throw new Error("development baseline current subtask missing");
  const lockedBaseline = await api(`/api/development/projects/${devProject.project.id}/baseline/lock`, { method: "POST" });
  if (lockedBaseline.baseline?.status !== "locked") throw new Error("development baseline lock failed");
  const currentSubtask = lockedBaseline.baseline.currentSubtask;
  const secondSubtask = lockedBaseline.baseline.subtasks.find((item) => item.id !== currentSubtask.id);
  if (!secondSubtask) throw new Error("development baseline second subtask missing");
  let outOfOrder = false;
  try {
    await api(`/api/development/subtasks/${secondSubtask.id}/run`, { method: "POST" });
  } catch (err) {
    outOfOrder = String(err.message || err).includes("out_of_order_subtask");
  }
  if (!outOfOrder) throw new Error("development out-of-order subtask was not rejected");
  const currentRun = await api(`/api/development/subtasks/${currentSubtask.id}/run`, { method: "POST" });
  if (!currentRun.subtask || !["running", "needs_review", "blocked"].includes(currentRun.subtask.status)) throw new Error("development current subtask run did not update status");
  const failedAcceptance = await api(`/api/development/subtasks/${currentSubtask.id}/acceptance`, { method: "POST", body: JSON.stringify({ status: "passed", score: 92, evidence: "" }) });
  if (failedAcceptance.acceptance?.status === "passed") throw new Error("development acceptance should fail without evidence");
  const passedAcceptance = await api(`/api/development/subtasks/${currentSubtask.id}/acceptance`, { method: "POST", body: JSON.stringify({ status: "passed", score: 92, evidence: `${marker} evidence` }) });
  if (passedAcceptance.acceptance?.status !== "passed") throw new Error("development acceptance pass failed");
  if (passedAcceptance.baseline?.currentSubtask?.id === currentSubtask.id) throw new Error("development baseline did not advance after acceptance");
  const override = await api(`/api/development/subtasks/${passedAcceptance.baseline.currentSubtask.id}/override`, { method: "POST", body: JSON.stringify({ action: "force_pass", reason: marker }) });
  if (!override.requiresApproval) throw new Error("development subtask override must require approval");
  created.approvals.push(override.approvalId);
  const devPacket = await api(`/api/development/projects/${devProject.project.id}/work-packets`, { method: "POST", body: JSON.stringify({ title: `${marker}_development_packet`, objective: marker, scope: "smoke validates packet -> review -> evidence" }) });
  if (!devPacket.workPacket?.id) throw new Error("development work packet create failed");
  const devGateDefs = await api(`/api/development/projects/${devProject.project.id}/gate-definitions`);
  if (!JSON.stringify(devGateDefs.gateDefinitions).includes("no_fake_ok")) throw new Error("development no_fake_ok gate missing");
  const devPlugins = await api(`/api/development/projects/${devProject.project.id}/plugins`);
  if (!JSON.stringify(devPlugins.plugins).includes("openclaw-delivery-core")) throw new Error("development plugins missing delivery core");
  const devReviews = await api(`/api/development/projects/${devProject.project.id}/reviews`);
  if (!JSON.stringify(devReviews.reviews).includes("Product Taste")) throw new Error("development reviews missing product taste");
  const devReviewRun = await api(`/api/development/projects/${devProject.project.id}/reviews/run`, { method: "POST", body: JSON.stringify({ workPacketId: devPacket.workPacket.id }) });
  if (!devReviewRun.reviews?.length) throw new Error("development review run failed");
  const devTask = await api(`/api/development/projects/${devProject.project.id}/tasks`, { method: "POST", body: JSON.stringify({ title: `${marker}_development_task`, description: marker, agentId: "worker" }) });
  created.tasks.push(devTask.task.id);
  const devGoal = await api(`/api/development/projects/${devProject.project.id}/documents/goal`);
  if (devGoal.document?.key !== "goal") throw new Error("development document lookup failed");
  const devArtifactId = devDetail.detail.artifacts?.[0]?.id;
  if (devArtifactId) {
    const devArtifact = await api(`/api/development/artifacts/${devArtifactId}`);
    if (!devArtifact.artifact?.content) throw new Error("development artifact content missing");
  }
  const devApproval = await api(`/api/development/projects/${devProject.project.id}/runs`, { method: "POST", body: JSON.stringify({ mode: "apply" }) });
  if (!devApproval.requiresApproval) throw new Error("development apply must require approval");
  created.approvals.push(devApproval.approvalId);
  const archivedDev = await api(`/api/development/projects/${devProject.project.id}/archive`, { method: "POST" });
  if (archivedDev.detail?.project?.status !== "archived") throw new Error("development archive failed");

  const lan = await api("/api/health", {}, lanBase);
  if (!lan.ok) throw new Error("LAN health failed");
  const audit = db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE details LIKE ? OR target_id LIKE ?").get(`%${marker}%`, `%${marker}%`);

  console.log(JSON.stringify({ ok: true, skills: skills.skills.length, task: task.task.status, output: output.job.status, report: report.report.status, lan: lan.ok, auditCount: audit.count }, null, 2));
} finally {
  cleanup();
  const leftovers = {
    todos: db.prepare("SELECT COUNT(*) count FROM todos WHERE title LIKE ?").get(`${marker}%`).count,
    events: db.prepare("SELECT COUNT(*) count FROM events WHERE title LIKE ?").get(`${marker}%`).count,
    tasks: db.prepare("SELECT COUNT(*) count FROM tasks WHERE title LIKE ?").get(`${marker}%`).count,
    projects: db.prepare("SELECT COUNT(*) count FROM projects WHERE name LIKE ?").get(`${marker}%`).count,
    reports: db.prepare("SELECT COUNT(*) count FROM reports WHERE title LIKE ? OR content LIKE ?").get(`${marker}%`, `%${marker}%`).count,
    chats: db.prepare("SELECT COUNT(*) count FROM chat_messages WHERE content LIKE ?").get(`%${marker}%`).count,
  };
  const manifestDir = new URL("../knowledge_sidecars/test_artifacts", import.meta.url).pathname;
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, "PRD11_TEST_20260509.md"), `---\ntype: test_artifact_manifest\ncreated: ${new Date().toISOString()}\nstatus: marked\n---\n\n# PRD11 Test Artifacts\n\nDatabase leftovers: ${JSON.stringify(leftovers)}\n\nSidecar files containing the test marker may remain as retained evidence and should not be treated as production knowledge.\n`, "utf8");
  db.close();
}
