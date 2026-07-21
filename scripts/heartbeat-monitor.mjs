#!/usr/bin/env node
/**
 * monitor-12h: read /api/development/observability/heartbeat and report
 * health verdict. No event insertion (unlike smoke); pure read.
 *
 * 1. Inject session row (idempotent).
 * 2. Call heartbeat endpoint with auth.
 * 3. Run health checks:
 *    - http 200
 *    - service.uptimeMs > 0
 *    - scheduler.lastTickAt within 180s of now (auto-loop healthy)
 *    - scheduler.status NOT in {error, scheduler_not_started}
 *    - tokenBudget.usageRatio < 0.95 (or budget not configured yet)
 *    - staleRuns.count < 5
 * 4. Output a single JSON line: {"verdict":"OK|WARN|FAIL", "checks":{...}, "summary":{...}}
 * 5. Clean up session row.
 */
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const base = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const token = "heartbeat_monitor_20260609";
const dbPath = path.join(repoRoot, "data", "workbench.sqlite");
const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

const VERDICT = { OK: "OK", WARN: "WARN", FAIL: "FAIL" };

async function main() {
 const checks = {};
 const summary = { ts: new Date().toISOString() };
 let verdict = VERDICT.OK;

 try {
 // 1) DB session injection
 const db = new DatabaseSync(dbPath);
 const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
 db.prepare("INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, 1, ?, ?)")
 .run(tokenHash, expires, summary.ts);

 try {
 // 2) HTTP call
 const res = await fetch(`${base}/api/development/observability/heartbeat`, {
 headers: { Cookie: `owb_session=${encodeURIComponent(token)}` },
 });
 checks.httpStatus = res.status;
 if (res.status !== 200) {
 verdict = VERDICT.FAIL;
 checks.httpBody = (await res.text()).slice(0, 200);
 } else {
 const body = await res.json();
 if (!body.ok) {
 verdict = VERDICT.FAIL;
 checks.endpointError = body.error;
 } else {
 // 3) Health checks
 summary.uptimeMs = body.service?.uptimeMs ?? -1;
 summary.goalsActiveCount = body.goals?.activeCount ?? -1;
 summary.eventsLastHour = body.events?.writtenLastHour ?? -1;
 summary.tokenBudgetUsed = body.tokenBudget?.used ?? -1;
 summary.tokenBudgetTotal = body.tokenBudget?.totalBudget ?? -1;
 summary.staleRuns = body.staleRuns?.count ?? -1;
 summary.schedulerStatus = body.scheduler?.status ?? "unknown";
 summary.lastTickAt = body.scheduler?.lastTickAt ?? "";

 checks.uptimePositive = body.service?.uptimeMs > 0;
 if (!checks.uptimePositive) verdict = VERDICT.FAIL;

 const tickMs = Date.parse(body.scheduler?.lastTickAt || "");
 const tickAgeSec = Number.isFinite(tickMs) ? Math.floor((Date.now() - tickMs) / 1000) : -1;
 summary.tickAgeSec = tickAgeSec;
 // healthy<=300s, WARN at>300s, FAIL at>600s (per parent 2026-06-10 thresholds)
 checks.tickFresh = tickAgeSec >=0 && tickAgeSec <=300;
 if (!checks.tickFresh && tickAgeSec >600) verdict = VERDICT.FAIL;
 else if (!checks.tickFresh) verdict = VERDICT.WARN;

 const schedulerStatus = body.scheduler?.status || "unknown";
 checks.schedulerHealthy = !["error", "scheduler_not_started"].includes(schedulerStatus);
 if (!checks.schedulerHealthy) verdict = VERDICT.WARN;

 const totalBudget = body.tokenBudget?.totalBudget ?? 0;
 const usageRatio = body.tokenBudget?.usageRatio ?? 0;
 checks.budgetOk = totalBudget === 0 || usageRatio < 0.95;
 if (!checks.budgetOk) verdict = VERDICT.WARN;

 const staleRuns = body.staleRuns?.count ?? 0;
 // healthy<5, WARN at>=5, FAIL at>=10 (per parent 2026-06-10 thresholds)
 checks.staleRunsLow = staleRuns <5;
 if (staleRuns >=10) verdict = VERDICT.FAIL;
 else if (staleRuns >=5) verdict = VERDICT.WARN;
 }
 }
 } finally {
 // Clean up session row
 try {
 db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
 } catch {}
 }
 } catch (err) {
 verdict = VERDICT.FAIL;
 summary.error = err instanceof Error ? err.message : String(err);
 }

 console.log(JSON.stringify({ verdict, checks, summary }));
}

main().catch(err => {
 console.error("MONITOR_FAIL:", err.message);
 process.exit(1);
});
