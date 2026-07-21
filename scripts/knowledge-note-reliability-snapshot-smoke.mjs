import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const serverPath = path.join(root, "apps/server/src/index.ts");
const webPath = path.join(root, "apps/web/src/App.tsx");

const serverSource = fs.readFileSync(serverPath, "utf8");
const webSource = fs.readFileSync(webPath, "utf8");
const failures = [];

if (!/function buildKnowledgeNoteReliabilitySnapshot\(\)/.test(serverSource)) {
  failures.push("apps/server/src/index.ts must build a knowledge-note reliability snapshot for system ops.");
}

if (!/knowledgeNoteReliability/.test(serverSource)) {
  failures.push("/api/system-ops must expose knowledgeNoteReliability.");
}

if (!/添加笔记可靠性/.test(webSource)) {
  failures.push("System Ops UI must render an 添加笔记可靠性 panel.");
}

if (!/knowledge_note_reliability_below_target/.test(serverSource)) {
  failures.push("System Ops risks must surface knowledge_note_reliability_below_target when add-note reliability is below target.");
}

if (!/function loadKnowledgeNoteOrganizeJobReportById\(/.test(serverSource) || !/recoveredFromReport/.test(serverSource)) {
  failures.push("Add-note job polling must recover persisted job reports after a Workbench service reload.");
}

if (!/function normalizeKnowledgeNoteOrganizeReportForRuntime\(/.test(serverSource) || !/stale_job_report_aborted/.test(serverSource)) {
  failures.push("System Ops reliability stats must classify stale persisted running jobs instead of leaving them as infinite running.");
}

if (!/function latestKnowledgeNoteReliabilityLearningReport\(/.test(serverSource) || !/knowledgeNoteReliabilityLearning/.test(serverSource)) {
  failures.push("/api/system-ops must expose the Worker learning report for add-note reliability SLO breaches.");
}

if (!/QUEUE-KNOWLEDGE-NOTE-RELIABILITY-SLO/.test(webSource)) {
  failures.push("System Ops UI must show the add-note reliability self-learning queue item.");
}

if (failures.length) {
  console.error("knowledge-note-reliability-snapshot-smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  checked: "knowledge_note_reliability_system_ops_snapshot",
  serverPath,
  webPath,
}));
