import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const base = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const lanBase = process.env.OPENCLAW_WORKBENCH_LAN_URL || "http://192.168.0.104:38888";
const token = "codex_gate6_smoke_20260509";
const db = new DatabaseSync(new URL("../data/workbench.sqlite", import.meta.url).pathname);
const now = new Date().toISOString();
const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
db.prepare("INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash, 1, expires, now);

const cookie = `owb_session=${encodeURIComponent(token)}`;
const created = { projects: [], milestones: [], deliverables: [] };

async function api(path, options = {}, root = base) {
  const res = await fetch(`${root}${path}`, {
    ...options,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(`${root}${path} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

try {
  const project = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "GATE6_SMOKE_PROJECT_20260509", objective: "Validate project gate", deadline: "2026-06-01" }),
  });
  created.projects.push(project.project.id);

  const patched = await api(`/api/projects/${project.project.id}`, {
    method: "PATCH",
    body: JSON.stringify({ progress: 67, status: "active", objective: "Validated progress" }),
  });
  if (patched.project.progress !== 67 || patched.project.objective !== "Validated progress") throw new Error("project progress patch failed");

  const milestone = await api(`/api/projects/${project.project.id}/milestones`, {
    method: "POST",
    body: JSON.stringify({ name: "GATE6_SMOKE_MILESTONE_20260509", dueDate: "2026-05-20" }),
  });
  created.milestones.push(milestone.milestone.id);

  const deliverable = await api(`/api/projects/${project.project.id}/deliverables`, {
    method: "POST",
    body: JSON.stringify({ title: "GATE6_SMOKE_DELIVERABLE_20260509", uri: "/Users/njx/openclaw_data/openclaw_workbench/knowledge_sidecars/reports" }),
  });
  created.deliverables.push(deliverable.deliverable.id);

  const personal = await api("/api/personal");
  if (!personal.projects.some((row) => row.id === project.project.id)) throw new Error("personal projects missing");
  if (!personal.milestones.some((row) => row.id === milestone.milestone.id)) throw new Error("personal milestone missing");
  if (!personal.deliverables.some((row) => row.id === deliverable.deliverable.id)) throw new Error("personal deliverable missing");

  const lan = await api("/api/health", {}, lanBase);
  const html = await fetch(`${base}/`, { signal: AbortSignal.timeout(5000) }).then((res) => res.text());
  if (!html.includes("OpenClaw Workbench")) throw new Error("frontend shell missing");

  console.log(JSON.stringify({
    ok: true,
    projectProgress: patched.project.progress,
    milestoneStatus: milestone.milestone.status,
    deliverableUri: deliverable.deliverable.uri,
    lanHealth: lan.ok,
    frontendShell: true,
  }, null, 2));
} finally {
  for (const id of created.deliverables) db.prepare("DELETE FROM project_deliverables WHERE id = ?").run(id);
  for (const id of created.milestones) db.prepare("DELETE FROM project_milestones WHERE id = ?").run(id);
  for (const id of created.projects) db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  db.prepare("DELETE FROM project_deliverables WHERE title LIKE 'GATE6_SMOKE_%'").run();
  db.prepare("DELETE FROM project_milestones WHERE name LIKE 'GATE6_SMOKE_%'").run();
  db.prepare("DELETE FROM projects WHERE name LIKE 'GATE6_SMOKE_%'").run();
  db.close();
}
