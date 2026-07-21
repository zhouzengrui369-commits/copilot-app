import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const serverPath = path.join(root, "apps/server/src/index.ts");
const failures = [];

if (!fs.existsSync(serverPath)) {
  failures.push("apps/server/src/index.ts must exist.");
} else {
  const source = fs.readFileSync(serverPath, "utf8");
  const requiredContracts = [
    ["KNOWLEDGE_NOTE_ORGANIZE_JOB_RECOVERY_ROOT", "persist successful job recovery artifacts outside the redacted job report."],
    ["persistKnowledgeNoteOrganizeJobRecovery", "write recoverable Markdown/HTML only after trusted Gateway/MiniMax success."],
    ["loadKnowledgeNoteOrganizeJobRecovery", "load recoverable job results when polling or recreating a persisted job."],
    ["findLatestRecoverableKnowledgeNoteSuccess", "find a later same-sourceHash success before classifying an old job as lost."],
    ["supersededByJobId", "mark stale jobs that were taken over by a later successful job."],
    ["resultRecoveryPath", "expose a local recovery reference for diagnostics without embedding the full draft in the redacted report."],
  ];
  for (const [needle, description] of requiredContracts) {
    if (!source.includes(needle)) failures.push(`server must ${description} Missing: ${needle}`);
  }
  if (!/status:\s*"succeeded"[\s\S]{0,900}superseded_by_later_success/i.test(source)) {
    failures.push("stale same-sourceHash jobs must return succeeded only through an explicit superseded_by_later_success path.");
  }
  if (!/hasMarkdown[\s\S]{0,240}hasHtml[\s\S]{0,240}resultRecoveryPath/i.test(source)) {
    failures.push("redacted success reports must show hasMarkdown/hasHtml plus resultRecoveryPath, not raw content.");
  }
  if (/local_html_fallback_enabled|knowledge_note_recovery_fake_ok|local fallback success/i.test(source)) {
    failures.push("server source must not introduce add-note local fallback or fake success wording.");
  }
}

const reportsDir = path.join(root, "..", "memory/reports/knowledge_note_organize_jobs");
if (fs.existsSync(reportsDir)) {
  const rows = fs.readdirSync(reportsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const fullPath = path.join(reportsDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        return {
          file,
          id: String(data.id || ""),
          status: String(data.status || ""),
          sourceHash: String(data.sourceHash || ""),
          createdAt: Date.parse(String(data.createdAt || data.updatedAt || "")) || 0,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const byHash = new Map();
  for (const row of rows) {
    if (!row.sourceHash) continue;
    if (!byHash.has(row.sourceHash)) byHash.set(row.sourceHash, []);
    byHash.get(row.sourceHash).push(row);
  }
  const hasObservedSupersededPattern = [...byHash.values()].some((items) => {
    const running = items.filter((item) => ["running", "queued"].includes(item.status));
    const succeeded = items.filter((item) => item.status === "succeeded");
    return running.some((stale) => succeeded.some((success) => success.createdAt > stale.createdAt));
  });
  if (!hasObservedSupersededPattern) {
    failures.push("fixture data should include at least one stale same-sourceHash job followed by a success.");
  }
}

if (failures.length) {
  console.error("knowledge-note-job-recovery-contract-smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  checked: "knowledge_note_job_recovery_contract",
  serverPath,
}));
