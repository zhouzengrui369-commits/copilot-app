import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname, "..");
const jobDir = path.join(root, "memory/reports/knowledge_note_organize_jobs");
const recoveryDir = path.join(root, "memory/reports/knowledge_note_organize_job_recovery");
const notesDir = path.join(root, "memory/knowledge/notes");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function walk(dir, matcher, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, matcher, out);
    else if (matcher(file)) out.push(file);
  }
  return out;
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  const raw = match?.[1] || "";
  const valueFor = (key) => {
    const row = raw.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() || "";
    if (!row) return "";
    if ((row.startsWith("\"") && row.endsWith("\"")) || (row.startsWith("'") && row.endsWith("'"))) return row.slice(1, -1);
    return row;
  };
  const jsonListFor = (key) => {
    const value = valueFor(key);
    if (!value) return [];
    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        const parsed = JSON.parse(value.replace(/'/g, "\""));
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return value.slice(1, -1).split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
    }
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  };
  const jsonValueFor = (key, fallback) => {
    const value = valueFor(key);
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };
  return {
    title: valueFor("title"),
    date: valueFor("date"),
    type: valueFor("type"),
    status: valueFor("status"),
    folder: valueFor("folder"),
    sourceHash: valueFor("source_hash") || valueFor("source-hash"),
    tags: jsonListFor("tags"),
    related: jsonListFor("related"),
    htmlQuality: jsonValueFor("html_quality", null),
    generationPipeline: jsonValueFor("generation_pipeline", []),
  };
}

function sourceHashInMarkdown(markdown) {
  return frontmatter(markdown).sourceHash
    || markdown.match(/source[-_]hash:\s*([a-f0-9]{32,})/i)?.[1]
    || "";
}

function buildSavedNotesIndex() {
  const index = new Map();
  for (const mdPath of walk(notesDir, (file) => file.endsWith(".md"))) {
    const markdown = fs.readFileSync(mdPath, "utf8");
    const sourceHash = sourceHashInMarkdown(markdown);
    if (!sourceHash) continue;
    const htmlPath = mdPath.replace(/\.md$/, ".html");
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, "utf8");
    if (!html.includes(sourceHash)) continue;
    const meta = frontmatter(markdown);
    index.set(sourceHash, { mdPath, htmlPath, markdown, html, meta });
  }
  return index;
}

function recoveryPathFor(report) {
  const ts = String(report.completedAt || report.updatedAt || report.createdAt || new Date().toISOString()).replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return path.join(recoveryDir, `knowledge_note_organize_recovery_${ts}_${String(report.sourceHash || "").slice(0, 10)}_${String(report.id || "unknown").slice(0, 8)}.json`);
}

const savedNotes = buildSavedNotesIndex();
const results = [];
for (const file of walk(jobDir, (item) => item.endsWith(".json"))) {
  const report = readJson(file);
  if (!report || report.status !== "succeeded") continue;
  if (report.result?.resultRecoveryPath) continue;
  const sourceHash = String(report.sourceHash || "");
  const saved = savedNotes.get(sourceHash);
  if (!saved) continue;
  const recoveryPath = recoveryPathFor(report);
  const recoveryResult = {
    ok: true,
    draft: {
      title: saved.meta.title || report.title || "Knowledge Note",
      date: saved.meta.date || report.date || "",
      type: saved.meta.type || "工作记录",
      status: saved.meta.status || "仅供参考",
      tags: saved.meta.tags,
      related: saved.meta.related,
      folder: saved.meta.folder || report.folder || "",
      markdown: saved.markdown,
    },
    layoutStrategy: null,
    htmlDraft: { title: saved.meta.title || report.title || "Knowledge Note", html: saved.html, sourceHash },
    htmlQuality: saved.meta.htmlQuality || { score: report.result?.htmlScore ?? null, passed: true, issues: [] },
    generationPipeline: Array.isArray(saved.meta.generationPipeline) && saved.meta.generationPipeline.length
      ? saved.meta.generationPipeline
      : Array.isArray(report.result?.generationPipeline)
        ? report.result.generationPipeline
        : [],
    htmlMode: "m3",
    quality: null,
    agentDecision: null,
    fallbackReason: "",
    qualityMode: report.qualityMode || report.result?.qualityMode || "m3-html",
    staleRuntimeError: false,
    attempts: Array.isArray(report.attempts) ? report.attempts : [],
    debugReports: Array.isArray(report.debugReports) ? report.debugReports : [],
    diagnosis: report.diagnosis || null,
    retryBudget: report.retryBudget || null,
    opsRecovery: report.opsRecovery || null,
    knowledgeNotePipelineVersion: "m3-html-v3",
    sourceHash,
    resultRecoveryPath: recoveryPath,
    backfilledFromSavedNote: {
      markdownPath: saved.mdPath,
      htmlPath: saved.htmlPath,
      reason: "saved_markdown_and_html_exact_source_hash",
    },
  };
  const recovery = {
    ok: true,
    jobId: report.id,
    key: report.key,
    sourceHash,
    title: report.title,
    date: report.date,
    folder: report.folder,
    qualityMode: report.qualityMode,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    completedAt: report.completedAt || report.updatedAt,
    result: recoveryResult,
  };
  const nextReport = {
    ...report,
    result: {
      ...(report.result || {}),
      hasMarkdown: true,
      hasHtml: true,
      resultRecoveryPath: recoveryPath,
      backfilledFromSavedNote: {
        markdownPath: saved.mdPath,
        htmlPath: saved.htmlPath,
        reason: "saved_markdown_and_html_exact_source_hash",
      },
    },
  };
  if (apply) {
    writeJson(recoveryPath, recovery);
    writeJson(file, nextReport);
  }
  results.push({ jobId: report.id, sourceHash, reportPath: file, recoveryPath, markdownPath: saved.mdPath, htmlPath: saved.htmlPath });
}

console.log(JSON.stringify({
  ok: true,
  mode: apply ? "apply" : "dry-run",
  savedNoteSources: savedNotes.size,
  backfilled: results.length,
  results,
}, null, 2));
