#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function includes(file, needle, label = needle) {
  assert.ok(file.includes(needle), `Missing ${label}`);
}

const db = read("apps/server/src/db.ts");
const server = read("apps/server/src/index.ts");
const rightRail = read("apps/web/src/DeliveryRightRail.tsx");
const app = read("apps/web/src/App.tsx");

includes(db, "development_goal_runs", "Goal OS run ledger table");
includes(server, "runGoalOsPreflight", "deterministic Goal OS preflight");
includes(server, "/api/development/goals/:goalId/preflight", "preflight API route");
includes(server, "createGoalRunLedgerEntry", "Goal Run ledger writer");
includes(server, "runGoalOsSystemRunCanary", "real system.run canary");
includes(server, "pwd + git status --short", "read-only system.run canary command");
includes(server, "ensureGoalOsGitStatusHelper", "parameter-safe git status helper");
includes(server, "goal-os-git-status-short", "fixed git status helper path");
assert.ok(
  !server.includes('"--",\n      "/usr/bin/git",\n      "status",\n      "--short"'),
  "Goal OS canary must not require broad /usr/bin/git allowlist",
);
includes(server, "dryRun: true", "preflight dry-run response");
includes(server, "persisted: false", "preflight dry-run no persistence marker");
includes(server, "completion_audit_required", "Verify accept completion audit gate");
includes(server, "verify_accept_override", "Verify accept owner override audit");
includes(server, "updateLatestGoalRunEvidence", "Goal Run evidence pack backfill");
includes(server, "goal_os_preflight_blocked", "dispatch blocker event");
includes(server, "Goal OS preflight passed", "preflight success writes goal evidence");
includes(server, "last_heartbeat_at", "preflight success records goal heartbeat");
includes(server, "system.run canary passes", "preflight evidence covers canary criterion");
includes(server, "directEvidenceCovered", "evidence pack counts goal evidence text matches");
includes(server, "goal evidence ·", "evidence pack labels direct goal evidence");
includes(server, "activeSubtask ? []", "continuation contract does not block active goals on completion-only gaps");
includes(server, "evidenceTextMatch", "completion audit counts direct goal evidence text matches");
includes(server, "buildGoalResumeManifest", "resume manifest builder");
includes(server, "preflight_ready", "Goal Run preflight state");
includes(server, "blocked_preflight", "Goal Run blocked preflight state");
includes(server, "sideEffects.lockBaseline = lockDevelopmentBaseline", "lock_baseline action performs real baseline lock");
assert.ok(
  !server.includes('dispatchFailed || tone === "blocked" || productivity?.tone === "warn"'),
  "Mission control must not mark evidence warnings as dispatch blockers",
);
includes(server, "summarizeGoalOsNodeHost", "readable node host blocker summary");
includes(server, "需要 NJX 明确批准后安装/启动 openclaw-cn node host", "explicit approval repair action");
includes(app, "goalOs", "Goal OS payload passed through App");
includes(app, "runGoalPreflight", "Goal OS preflight action passed through App");
includes(rightRail, "goal-os-preflight", "right rail preflight panel");
includes(rightRail, "Goal OS", "right rail Goal OS label");
includes(rightRail, "重跑 preflight", "right rail preflight refresh button");
includes(rightRail, "刷新证据包", "right rail evidence refresh button");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "development_goal_runs",
    "runGoalOsPreflight",
    "preflight API",
    "Goal Run ledger",
    "real system.run canary",
    "preflight dry-run no persistence",
    "Verify accept audit gate",
    "Goal Run evidence pack backfill",
    "resume manifest",
    "right rail Goal OS panel",
    "readable node host blocker",
  ],
}, null, 2));
