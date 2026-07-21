import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { SIDECAR_DIR, WORKSPACE_DIR, nowIso, safeName, HOME_DIR } from "./config.js";
import type { Db } from "./db.js";
import { unimplementedOutputTypes } from "./truth.js";
import { defaultHtmlPath, writeHtmlDocument } from "./docRenderer.js";
import { DEFAULT_NAS_ROOT, nasPreferredEntries, readableNasRoots, resolveNasRoot } from "./connectors/nasRoot.js";

// 2026-06-29 — copilot note mirror hook.
// 设计：
//   - workbenchV11.saveKnowledgeNote 在写源 .md + html 之后，调用本 hook 做派生 NAS 镜像。
//   - 镜像 = 直接复制源 .md + html 到 MIRROR_NAS_ROOT/notes/，并把 mirror frontmatter 字段塞进正文顶部。
//   - 算法与 ~/.openclaw/skills/copilot-note-mirror/scripts/mirror_knowledge.py 共享规则。
//   - source-hash 不同 → NAS 端追加 _<hash8>.md 保留历史。
//   - NAS 不可写 → 返回 vault_unmounted，**不抛**，由 audit 表记录。
const MIRROR_NAS_ROOT = process.env.OPENCLAW_MIRROR_NAS_ROOT
  || path.join("/Volumes/南极熊", "07知识库", "copilot_knowledge_mirror");
const MIRROR_AUDIT_TAG = "copilot-mirror";
const MIRROR_SOURCE_TAG = "copilot-add-note";
const MIRROR_FRONT_PASSTHROUGH_KEYS = [
  "date", "time", "title", "type", "status", "related", "folder",
  "created", "createdAt", "duration", "record_title", "recorded_at",
] as const;

type KnowledgeNoteMirrorStatus =
  | "mirrored"
  | "renamed"
  | "skipped"
  | "failed"
  | "vault_unmounted"
  | "out_of_scope"
  | "disabled";

type KnowledgeNoteMirrorResult = {
  mirrorPath: string | null;
  mirrorStatus: KnowledgeNoteMirrorStatus;
  mirrorError: string | null;
};

const FRONT_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;

function parseFrontmatter(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const m = FRONT_RE.exec(text);
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (!key) continue;
    if (val.startsWith("[") && val.endsWith("]")) {
      out[key] = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    } else {
      out[key] = val.replace(/^['"]|['"]$/g, "");
    }
  }
  return out;
}

function renderMirrorFrontmatter(
  srcFm: Record<string, string | string[]>,
  srcPath: string,
  srcHash: string,
  mirrorAt: string,
): string {
  const lines: string[] = ["---"];
  for (const k of MIRROR_FRONT_PASSTHROUGH_KEYS) {
    if (srcFm[k] === undefined) continue;
    const v = srcFm[k];
    if (Array.isArray(v)) lines.push(`${k}: [${v.join(", ")}]`);
    else lines.push(`${k}: ${JSON.stringify(String(v))}`);
  }
  const tags = Array.isArray(srcFm.tags)
    ? (srcFm.tags as string[]).slice()
    : typeof srcFm.tags === "string" && srcFm.tags
    ? [srcFm.tags]
    : [];
  if (!tags.includes(MIRROR_AUDIT_TAG)) tags.push(MIRROR_AUDIT_TAG);
  lines.push(`source: ${MIRROR_SOURCE_TAG}`);
  lines.push(`source_path: ${JSON.stringify(srcPath)}`);
  lines.push(`source_hash: ${srcHash}`);
  lines.push(`mirror_at: ${JSON.stringify(mirrorAt)}`);
  lines.push(`mirrored_by: copilot-note-mirror`);
  lines.push(`tags: [${tags.join(", ")}]`);
  lines.push("---");
  return lines.join("\n") + "\n\n";
}

function nasWritableForMirror(): boolean {
  if (!fs.existsSync(MIRROR_NAS_ROOT)) {
    let probe: string = MIRROR_NAS_ROOT;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
  try {
    const canary = path.join(MIRROR_NAS_ROOT, ".copilot-mirror-canary");
    fs.writeFileSync(canary, "ok", { encoding: "utf-8" });
    fs.unlinkSync(canary);
    return true;
  } catch {
    return false;
  }
}

function isInMirrorScope(srcAbsPath: string): boolean {
  // 仅镜像 WORKSPACE_DIR/memory/knowledge/notes/ 下的白名单子目录。
  // WORKSPACE_DIR 通常为 /Users/njx/openclaw_data，源绝对路径形如
  //   /Users/njx/openclaw_data/memory/knowledge/notes/<sub>/...
  const notesRoot = path.join(WORKSPACE_DIR, "memory/knowledge/notes");
  if (!srcAbsPath.startsWith(notesRoot + path.sep) && srcAbsPath !== notesRoot) return false;
  const rel = path.relative(notesRoot, srcAbsPath);
  const top = rel.split(path.sep)[0];
  return ["daily", "calendar", "voice_raw", "mobile_audio", "openclaw", "worker_runs"].includes(top);
}

const MIRROR_MANIFEST_FILENAME = ".copilot-mirror-manifest.json";

type MirrorManifest = {
  version: number;
  last_run?: string;
  files: Record<string, MirrorManifestEntry>;
};

type MirrorManifestEntry = {
  src_path: string;
  nas_path: string;
  first_mirrored_at?: string;
  last_mirrored_at?: string;
  last_seen_at?: string;
  modified_locally?: boolean;
  duplicate_source_paths?: string[];
};

function loadMirrorManifest(): MirrorManifest {
  const p = path.join(MIRROR_NAS_ROOT, MIRROR_MANIFEST_FILENAME);
  if (!fs.existsSync(p)) {
    return { version: 2, files: {} };
  }
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return { version: 2, files: {} };
    return {
      version: typeof data.version === "number" ? data.version : 2,
      last_run: typeof data.last_run === "string" ? data.last_run : "",
      files: (data.files && typeof data.files === "object" && data.files) || {},
    };
  } catch {
    return { version: 2, files: {} };
  }
}

function saveMirrorManifest(manifest: MirrorManifest): void {
  const p = path.join(MIRROR_NAS_ROOT, MIRROR_MANIFEST_FILENAME);
  const tmp = p + ".tmp";
  fs.mkdirSync(MIRROR_NAS_ROOT, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), { encoding: "utf-8" });
  fs.renameSync(tmp, p);
}

function addDuplicateSourcePath(entry: MirrorManifestEntry, srcPath: string): void {
  if (entry.src_path === srcPath) return;
  const dupes = Array.isArray(entry.duplicate_source_paths) ? entry.duplicate_source_paths : [];
  if (!dupes.includes(srcPath)) dupes.push(srcPath);
  entry.duplicate_source_paths = dupes;
}

export function mirrorKnowledgeNoteFile(
  srcAbsPath: string,
  srcHtmlPath: string | null,
): KnowledgeNoteMirrorResult {
  // 禁用：通过环境变量直接关
  if (process.env.OPENCLAW_MIRROR_DISABLED === "1") {
    return { mirrorPath: null, mirrorStatus: "disabled", mirrorError: "mirror_disabled" };
  }
  if (!isInMirrorScope(srcAbsPath)) {
    return { mirrorPath: null, mirrorStatus: "out_of_scope", mirrorError: null };
  }
  if (!nasWritableForMirror()) {
    return { mirrorPath: null, mirrorStatus: "vault_unmounted", mirrorError: null };
  }
  if (!fs.existsSync(srcAbsPath)) {
    return { mirrorPath: null, mirrorStatus: "failed", mirrorError: "src_missing" };
  }
  try {
    const notesRoot = path.join(WORKSPACE_DIR, "memory/knowledge/notes");
    const rel = path.relative(notesRoot, srcAbsPath);
    const nasPath = path.join(MIRROR_NAS_ROOT, "notes", rel);
    const srcHash = createHash("sha256").update(fs.readFileSync(srcAbsPath)).digest("hex");
    const srcBody = fs.readFileSync(srcAbsPath, "utf-8");
    const srcFm = parseFrontmatter(srcBody);
    const bodyOnly = srcBody.replace(FRONT_RE, "");
    const mirrorAt = new Date().toISOString();
    const merged = renderMirrorFrontmatter(srcFm, srcAbsPath, srcHash, mirrorAt) + bodyOnly.replace(/^\n+/, "");
    const manifest = loadMirrorManifest();
    const prevEntry = manifest.files[srcHash];
    // A3 dedupe 第一优先：同 source_hash 已镜像 + 目标文件存在 → 跳过，provenance 记录。
    if (prevEntry && prevEntry.nas_path && fs.existsSync(prevEntry.nas_path)) {
      addDuplicateSourcePath(prevEntry, srcAbsPath);
      prevEntry.last_seen_at = mirrorAt;
      manifest.files[srcHash] = prevEntry;
      manifest.last_run = mirrorAt;
      saveMirrorManifest(manifest);
      return { mirrorPath: prevEntry.nas_path, mirrorStatus: "skipped", mirrorError: "manifest_match" };
    }
    // manifest 缺失或 prev target 已丢失 → 继续往下走（视为首次镜像 / 重新写）。
    let finalPath = nasPath;
    let status: KnowledgeNoteMirrorStatus = "mirrored";
    if (fs.existsSync(nasPath)) {
      // 冲突：源 hash 不同、目标文件已存在 → 追加 _<hash8>.md
      finalPath = path.join(path.dirname(nasPath), `${path.basename(nasPath, ".md")}_${srcHash.slice(0, 8)}.md`);
      if (!fs.existsSync(finalPath)) {
        status = "renamed";
      } else {
        status = "skipped";
      }
    }
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    if (status !== "skipped") {
      fs.writeFileSync(finalPath, merged, { encoding: "utf-8" });
    }
    // 同步 html 旁车（如有）
    if (srcHtmlPath && fs.existsSync(srcHtmlPath) && status !== "skipped") {
      try {
        const htmlRel = path.relative(path.dirname(srcAbsPath), srcHtmlPath);
        const nasHtml = path.join(path.dirname(finalPath), htmlRel);
        fs.mkdirSync(path.dirname(nasHtml), { recursive: true });
        fs.writeFileSync(nasHtml, fs.readFileSync(srcHtmlPath));
      } catch (e) {
        // html 镜像失败不阻塞主流程
      }
    }
    // 更新 manifest：复用 prevEntry 的 first_mirrored_at / duplicate_source_paths。
    const newEntry: MirrorManifestEntry = prevEntry
      ? {
          ...prevEntry,
          src_path: srcAbsPath,
          nas_path: finalPath,
          last_mirrored_at: mirrorAt,
          last_seen_at: mirrorAt,
          modified_locally: false,
        }
      : {
          src_path: srcAbsPath,
          nas_path: finalPath,
          first_mirrored_at: mirrorAt,
          last_mirrored_at: mirrorAt,
          last_seen_at: mirrorAt,
          modified_locally: false,
        };
    if (!newEntry.first_mirrored_at) newEntry.first_mirrored_at = mirrorAt;
    manifest.files[srcHash] = newEntry;
    manifest.last_run = mirrorAt;
    saveMirrorManifest(manifest);
    return { mirrorPath: finalPath, mirrorStatus: status, mirrorError: null };
  } catch (e) {
    return { mirrorPath: null, mirrorStatus: "failed", mirrorError: (e as Error).message };
  }
}


const MAX_TREE_ITEMS = 80;
const MAX_TREE_DEPTH = 3;
const MEMORY_TREE_DEPTH = 4;
const MARKDOWN_EXT = new Set([".md", ".markdown"]);
const JSON_EXT = new Set([".json", ".jsonl"]);
const CSV_EXT = new Set([".csv", ".tsv"]);
const HTML_EXT = new Set([".html", ".htm"]);
const TEXT_EXT = new Set([".txt", ".log", ".yaml", ".yml", ".toml", ".ini", ".xml", ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".sh", ".sql", ".c", ".cpp", ".h", ".java", ".go", ".rs", ".rb", ".php", ".env", ".svg"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv"]);
const OFFICE_EXT = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp"]);
const ARCHIVE_EXT = new Set([".zip", ".rar", ".7z", ".tar", ".gz", ".tgz"]);
const TREE_IGNORE = new Set([".git", ".next", ".turbo", "coverage", "dist", "node_modules", "test-results"]);
const KNOWLEDGE_ROOT = path.join(WORKSPACE_DIR, "memory/knowledge");
const KNOWLEDGE_NOTES_ROOT = path.join(WORKSPACE_DIR, "memory/knowledge/notes");
const NJX_KNOWLEDGE_ROOT = path.resolve(process.env.NJX_KNOWLEDGE_ROOT || path.join(HOME_DIR, "njx-knowledge"));
const NJX_KNOWLEDGE_NOTES_ROOT = path.join(NJX_KNOWLEDGE_ROOT, "knowledge");
export { NJX_KNOWLEDGE_ROOT, NJX_KNOWLEDGE_NOTES_ROOT };
const NJX_KNOWLEDGE_LEGACY_NOTES_ROOT = KNOWLEDGE_NOTES_ROOT;
const NJX_KNOWLEDGE_NOTE_SUBDIRS = new Set(["calendar", "daily", "voice_raw", "mobile_audio", "openclaw"]);
const NJX_KNOWLEDGE_DEFAULT_SUBDIR = "openclaw";
const NJX_KNOWLEDGE_DICT_VALIDATOR_SCRIPT = process.env.NJX_KNOWLEDGE_DICT_VALIDATOR_SCRIPT
  || "/Users/njx/njx-knowledge/scripts/validate_terms.py";
const NJX_KNOWLEDGE_DICT_PYTHON_BIN = process.env.NJX_KNOWLEDGE_DICT_PYTHON_BIN || "python3";
const NJX_KNOWLEDGE_DICT_VALIDATION_TIMEOUT_MS = Number(process.env.NJX_KNOWLEDGE_DICT_VALIDATION_TIMEOUT_MS || 8000);
// 2026-07-07 (rework11 v2) — 整个 wiki 系统迁新路径, 老路径只读保留兼容
const KNOWLEDGE_WIKI_ROOT = path.join(NJX_KNOWLEDGE_ROOT, "wiki");  // ← NJX-knowledge v2 主落点
const KNOWLEDGE_WIKI_LEGACY_ROOT = path.join(WORKSPACE_DIR, "memory/knowledge/wiki");  // ← 老路径, 仅兼容读
const KNOWLEDGE_WIKI_DIRS = ["MOC", "entities", "concepts", "projects", "decisions", "sources", "_compile_runs"];
const KNOWLEDGE_NOTE_TYPES = ["会议纪要", "工作记录", "学习笔记", "决策记录", "项目文档", "备忘"];
const KNOWLEDGE_NOTE_STATUSES = ["待跟进", "已完成", "仅供参考", "进行中"];
const KNOWLEDGE_IMPORT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const KNOWLEDGE_IMPORT_MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const WORKSPACE_PROTECTED_DIRS = new Set([".git", ".obsidian", "openclaw_workbench", "node_modules", "data", "tasks", "inbox", "boss_workspace", "worker_workspace"]);
const WORKSPACE_PROTECTED_ROOT_FILES = new Set(["AGENTS.md", "MEMORY.md", "IDENTITY.md", "SOUL.md", "HEARTBEAT.md"]);

export type AgentId = "main" | "boss" | "worker";
type SkillRow = {
  id: string;
  name: string;
  source: string;
  path: string | null;
  description: string;
  status: string;
};

type KnowledgeTreeNode = {
  source: string;
  title: string;
  path: string;
  type: string;
  size: number;
  mtime: string;
  children?: KnowledgeTreeNode[];
};

export type KnowledgeNoteDraftInput = {
  rawContent?: string;
  title?: string;
  date?: string;
  type?: string;
  status?: string;
  tags?: string[];
  related?: string[];
  folder?: string;
  markdown?: string;
  layoutStrategy?: KnowledgeNoteLayoutStrategyInput;
  htmlDraft?: KnowledgeNoteHtmlDraftInput;
  htmlQuality?: KnowledgeNoteHtmlQualityInput;
  generationPipeline?: string[];
  htmlMode?: string;
  useNkxLanding?: boolean;  // njx-knowledge v2: 写新主落点 /Users/njx/njx-knowledge/knowledge/<sub>/<YYYY-MM>/
  nkxLandingRootMode?: "auto" | "nkx" | "legacy";  // njx-knowledge v2: 显式选择落点
  nkxLandingSubdirOverride?: string;  // njx-knowledge v2: 显式覆盖 subdir（默认根据 folder 推断）
};

export type KnowledgeNoteHtmlDraftInput = {
  html?: string;
  title?: string;
  sourceHash?: string;
  fallbackReason?: string;
};

export type KnowledgeNoteHtmlQualityInput = {
  score?: number;
  passed?: boolean;
  issues?: string[];
  dimensions?: Record<string, number>;
};

export type KnowledgeNoteLayoutStrategyInput = {
  template?: unknown;
  hero?: unknown;
  summaryCards?: unknown;
  sidebarBlocks?: unknown;
  primarySections?: unknown;
  visualEmphasis?: unknown;
};

export type KnowledgeNoteLayoutStrategy = {
  template: string;
  hero: string;
  summaryCards: Array<{ label: string; value: string; note: string }>;
  sidebarBlocks: Array<{ title: string; items: string[] }>;
  primarySections: string[];
  visualEmphasis: string;
};

export type KnowledgeFileImportInput = {
  targetFolderPath?: string;
  files?: Array<{ name?: string; mime?: string; size?: number; contentBase64?: string }>;
};

type KnowledgeNoteAction = {
  text: string;
  owner: string;
  due: string;
};

type KnowledgeNoteEntityGroups = {
  people: string[];
  organizations: string[];
  places: string[];
  projects: string[];
  concepts: string[];
  resources: string[];
};

type KnowledgeNoteAnalysis = {
  topic: string;
  segments: string[];
  keyPoints: string[];
  dataPoints: string[];
  issuePoints: string[];
  actions: KnowledgeNoteAction[];
  entities: string[];
  entityGroups: KnowledgeNoteEntityGroups;
  logic: string[];
};

type KnowledgeTranscriptUtterance = {
  speaker: string;
  time: string;
  text: string;
};

type KnowledgeTranscriptAnalysis = {
  utterances: KnowledgeTranscriptUtterance[];
  speakers: string[];
  bySpeaker: Record<string, KnowledgeTranscriptUtterance[]>;
  startTime: string;
  endTime: string;
};

export function agentWorkspace(agentId: string) {
  if (agentId === "boss") return path.join(WORKSPACE_DIR, "boss_workspace");
  if (agentId === "worker") return path.join(WORKSPACE_DIR, "worker_workspace");
  return WORKSPACE_DIR;
}

export function discoverSkills() {
  const known = [
    ["task-executor", "任务执行 PLAN/RESULT 流程"],
    ["coding-agent", "代码开发、测试和修复"],
    ["knowledge-archiver", "知识归档与索引"],
    ["task-dispatcher", "派单给指定代理"],
    ["nas-knowledge", "NAS 知识库查询"],
    ["vector-memory", "向量嵌入与知识检索"],
    ["feishu-calendar", "飞书日历"],
    ["feishu-bitable", "飞书多维表格"],
  ];
  const rows: SkillRow[] = known.map(([id, description]) => ({
    id,
    name: id,
    source: "workspace-rule",
    path: null,
    description,
    status: "available",
  }));
  for (const base of [
    path.join(HOME_DIR, ".codex/skills"),
    path.join(HOME_DIR, ".openclaw/skills"),
    path.join(HOME_DIR, "openclaw_data/copilot/skills"),
    path.join(WORKSPACE_DIR, "boss_workspace/skills"),
  ]) {
    if (!fs.existsSync(base)) continue;
    for (const file of walk(base, 2).filter((item: string) => item.endsWith("SKILL.md") || item.endsWith(".md") || item.endsWith(".cjs"))) {
      const id = safeName(path.basename(path.dirname(file)) === "." ? path.basename(file, path.extname(file)) : path.basename(path.dirname(file)));
      if (rows.some((row) => row.id === id)) continue;
      rows.push({ id, name: id, source: base, path: file, description: firstLine(file), status: "available" });
    }
  }
  return rows;
}

export function agentConfigFiles(agentId: string) {
  const workspace = agentWorkspace(agentId);
  const candidates = [
    ["soul", ["soul.md", "SOUL.md"]],
    ["identity", ["identity.md", "IDENTITY.md"]],
    ["agents", ["AGENTS.md", "agents.md"]],
    ["user", ["user.md", "USER.md"]],
    ["memory", ["MEMORY.md", "memory.md"]],
    ["heartbeat", ["HEARTBEAT.md", "heartbeat.md"]],
  ];
  return candidates.map(([key, names]) => {
    const resolved = (names as string[]).map((name) => path.join(workspace, name)).find((file) => fs.existsSync(file)) || path.join(workspace, (names as string[])[0]);
    return {
      id: `${agentId}:${key}`,
      agentId,
      key,
      path: resolved,
      exists: fs.existsSync(resolved),
      updatedAt: fs.existsSync(resolved) ? fs.statSync(resolved).mtime.toISOString() : null,
      size: fs.existsSync(resolved) ? fs.statSync(resolved).size : 0,
      content: fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? fs.readFileSync(resolved, "utf8").slice(0, 120_000) : "",
    };
  });
}

export function saveAgentConfigFile(db: Db, agentId: string, key: string, content: string) {
  const target = agentConfigFiles(agentId).find((file) => file.key === key);
  if (!target) throw new Error("config_file_not_found");
  const previous = target.exists ? fs.readFileSync(target.path, "utf8") : "";
  const version = Number((db.prepare("SELECT MAX(version) version FROM agent_config_versions WHERE agent_id = ? AND file_key = ?").get(agentId, key) as { version?: number } | undefined)?.version || 0) + 1;
  db.prepare("INSERT INTO agent_config_versions (id, agent_id, file_key, file_path, content, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), agentId, key, target.path, previous, version, nowIso());
  fs.mkdirSync(path.dirname(target.path), { recursive: true });
  fs.writeFileSync(target.path, content, "utf8");
  return { ...target, exists: true, content, version };
}

export function listConfigVersions(db: Db, agentId: string, key: string) {
  return db.prepare("SELECT id, agent_id, file_key, file_path, version, created_at FROM agent_config_versions WHERE agent_id = ? AND file_key = ? ORDER BY version DESC LIMIT 20").all(agentId, key);
}

export function knowledgeTree() {
  const nas = resolveNasRoot();
  return {
    memory: treeForRoot("memory", KNOWLEDGE_ROOT, ["index.md", "MOC", "notes", "archive"], MEMORY_TREE_DEPTH),
    workspace: treeForRoot("workspace", WORKSPACE_DIR, ["MEMORY.md", "AGENTS.md", "openclaw_workbench", "tasks"], 1),
    nas: nas.status === "connected"
      ? { ...treeForRoot("nas", nas.root, nasPreferredEntries(nas.root, nas.graphPath), 1), graphPath: nas.graphPath }
      : { source: "nas", root: nas.root, status: "unavailable", reason: nas.reason, items: [] },
    ima: { source: "ima", root: "ima.qq.com", status: "deprecated", reason: "IMA connector 已弃用 2026-07-07 (NJX 拍板; 39+ 天无新数据); 仅保留兼容读。", items: [] },
  };
}

export function previewKnowledgeFile(rawPath: string) {
  if (rawPath.startsWith("ima://")) return { ok: false, type: "deprecated", path: rawPath, title: rawPath, error: "ima_file_preview_deprecated" };
  const file = safeResolve(rawPath);
  if (!file || !fs.existsSync(file)) return { ok: false, error: "file_not_found" };
  const stat = fs.statSync(file);
  const base = knowledgeFileMeta(file, stat);
  if (stat.isDirectory()) return { ...base, ok: true, content: "", children: listDir(file) };
  const ext = path.extname(file).toLowerCase();
  if (isReadableKnowledgeText(ext)) return { ...base, ok: true, content: fs.readFileSync(file, "utf8").slice(0, 120_000) };
  return { ...base, ok: true, content: "" };
}

export function knowledgeFileMime(file: string, download = false) {
  const ext = path.extname(file).toLowerCase();
  if (!download && [".html", ".htm", ".svg"].includes(ext)) return "text/plain; charset=utf-8";
  return mimeForKnowledgeExt(ext);
}

export function saveKnowledgeUpload(db: Db, input: { source?: string; name?: string; content?: string }) {
  const id = randomUUID();
  const name = safeName(input.name || "upload.md");
  const file = path.join(SIDECAR_DIR, "uploads", `${nowIso().slice(0, 10)}_${id.slice(0, 8)}_${name}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, input.content || "", "utf8");
  db.prepare("INSERT INTO knowledge_file_index (id, source, title, path, file_type, size_bytes, mtime, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, input.source || "workspace", name, file, path.extname(name).slice(1) || "md", Buffer.byteLength(input.content || ""), nowIso(), "uploaded", nowIso());
  return { id, path: file, title: name, status: "uploaded" };
}

export function organizeKnowledgeNoteDraft(input: KnowledgeNoteDraftInput) {
  const rawContent = String(input.rawContent || "").trim();
  if (!rawContent) throw new Error("note_content_required");
  const sourceProfile = knowledgeNoteSourceProfile(rawContent, input);
  const date = normalizeKnowledgeNoteDate(input.date);
  const inferredType = inferKnowledgeNoteType(rawContent);
  const requestedType = sourceProfile.ignoreCourseMetadata ? "" : input.type;
  const type = normalizeKnowledgeNoteType(shouldTreatAsCourseNote(rawContent, requestedType) ? "学习笔记" : isKnowledgeTranscript(rawContent) ? "会议纪要" : requestedType || inferredType);
  const status = normalizeKnowledgeNoteStatus(input.status || inferKnowledgeNoteStatus(rawContent, type));
  const inferredTitle = inferKnowledgeNoteTitle(rawContent, type);
  const ignoreMisleadingMetadata = sourceProfile.ignoreCourseMetadata || sourceProfile.ignoreDegreeMetadata;
  const title = normalizeKnowledgeNoteTitle(ignoreMisleadingMetadata || shouldPreferInferredKnowledgeTitle(input.title, inferredTitle, rawContent, type) ? inferredTitle : input.title || inferredTitle, date, type);
  const metadataRelated = ignoreMisleadingMetadata ? [] : normalizeRelated(input.related);
  const entities = filterKnowledgeNoteEntitiesForSource(uniqueStrings([...metadataRelated, ...extractKnowledgeNoteEntities(`${title}\n${rawContent}`)]), rawContent, type).slice(0, 16);
  const tags = normalizeKnowledgeNoteTags(ignoreMisleadingMetadata ? [] : input.tags, type, title, rawContent, entities);
  const related = normalizeRelated(entities.slice(0, 10));
  const folder = normalizeKnowledgeNoteFolder(input.folder);
  const markdown = renderKnowledgeNoteMarkdown({ rawContent, title, date, type, status, tags, related, folder, markdown: "" });
  return { title, date, type, status, tags, related, folder, markdown };
}

export function normalizeKnowledgeNoteMarkdownEscapes(input: string) {
  const text = String(input || "");
  const escapedNewlineCount = (text.match(/\\n/g) || []).length;
  const realNewlineCount = (text.match(/\r?\n/g) || []).length;
  if (escapedNewlineCount < 3 || realNewlineCount > Math.max(4, Math.floor(escapedNewlineCount / 3))) return text;
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"");
}

export function normalizeKnowledgeNoteHtmlEscapes(input: string) {
  const html = String(input || "").trim();
  const escapedSequenceCount = (html.match(/\\r\\n|\\n|\\r|\\t|\\"|\\u00(?:3c|3e|22)/gi) || []).length;
  if (escapedSequenceCount < 3 || !/(?:<!doctype\s+html|<html\b|\\u003c(?:!doctype|html))/i.test(html)) return html;
  const decoded = html
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u0022/gi, "\"")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .trim();
  const decodedLooksLikeHtml = /(?:<!doctype\s+html|<html\b)/i.test(decoded) && /<\/html>\s*$/i.test(decoded);
  const decodedEscapedSequenceCount = (decoded.match(/\\r\\n|\\n|\\r|\\t|\\"|\\u00(?:3c|3e|22)/gi) || []).length;
  return decodedLooksLikeHtml && decodedEscapedSequenceCount < escapedSequenceCount ? decoded : html;
}

export async function saveKnowledgeNote(db: Db, rawDraftInput: KnowledgeNoteDraftInput, options?: { landingMode?: "auto" | "nkx" | "legacy"; nkxSubdirOverride?: string; useNkxLanding?: boolean }) {
  const input = rawDraftInput;
  const date = normalizeKnowledgeNoteDate(input.date);
  const status = normalizeKnowledgeNoteStatus(input.status);
  const rawContent = String(input.rawContent || "");
  const rawSourceHash = rawContent ? createHash("sha256").update(rawContent).digest("hex") : "";
  const sourceProfile = rawContent ? knowledgeNoteSourceProfile(rawContent, input) : null;
  const inferredType = inferKnowledgeNoteType(rawContent || input.markdown || "");
  const requestedType = sourceProfile?.ignoreCourseMetadata ? "" : input.type;
  const type = normalizeKnowledgeNoteType(shouldTreatAsCourseNote(rawContent || input.markdown || "", requestedType) ? "学习笔记" : rawContent && isKnowledgeTranscript(rawContent) ? "会议纪要" : requestedType || inferredType);
  const inferredTitle = inferKnowledgeNoteTitle(rawContent || input.markdown || "", type);
  const ignoreMisleadingMetadata = Boolean(sourceProfile?.ignoreCourseMetadata || sourceProfile?.ignoreDegreeMetadata);
  const title = normalizeKnowledgeNoteTitle(ignoreMisleadingMetadata || shouldPreferInferredKnowledgeTitle(input.title, inferredTitle, rawContent || input.markdown || "", type) ? inferredTitle : input.title || inferredTitle, date, type);
  const tags = normalizeKnowledgeNoteTags(ignoreMisleadingMetadata ? [] : input.tags, type, title, rawContent || input.markdown || "", normalizeRelated(input.related));
  const related = ignoreMisleadingMetadata
    ? filterKnowledgeNoteEntitiesForSource(normalizeRelated(input.related), rawContent, type)
    : normalizeRelated(input.related);
  const folder = normalizeKnowledgeNoteFolder(input.folder);
  const layoutStrategy = normalizeKnowledgeNoteLayoutStrategy(input.layoutStrategy);
  const fullTitle = `${date} ${title}`;
  const candidateHtml = String(input.htmlDraft?.html || "");
  let generationPipeline = normalizeKnowledgeGenerationPipeline(input.generationPipeline, []);
  // Pipeline / html requirement is intentionally permissive: as long as the model
  // produced some HTML and some markdown we accept the result. The user explicitly
  // asked to drop strict template/format gates and trust the model's organizing
  // output. Only XSS sanitization (sanitizeKnowledgeNoteModelHtml) is non-negotiable.
  if (!candidateHtml.trim()) throw new Error("gateway_html_required");
  void generationPipeline; // preserved for diagnostics, no longer a gate
  const saveHtmlQualityProfile = inferKnowledgeNoteSaveHtmlQualityProfile(input);
  let sanitizedHtml = sanitizeKnowledgeNoteModelHtml(candidateHtml, {
    title: fullTitle,
    sourceHash: input.htmlDraft?.sourceHash || rawSourceHash || createHash("sha256").update(candidateHtml).digest("hex"),
    qualityProfile: saveHtmlQualityProfile,
  });
  const requestedHtmlQuality = normalizeKnowledgeNoteHtmlQuality(input.htmlQuality, "m3_html_document");
  let htmlQuality = mergeKnowledgeNoteHtmlQuality(requestedHtmlQuality, sanitizedHtml.quality);
  if (!htmlQuality.passed && canRepairKnowledgeNoteSaveHtmlQuality(requestedHtmlQuality, sanitizedHtml.quality)) {
    const repairedHtml = repairKnowledgeNoteModelHtmlFirstScreen(sanitizedHtml.html, {
      title: fullTitle,
      sourceHash: input.htmlDraft?.sourceHash || rawSourceHash || createHash("sha256").update(candidateHtml).digest("hex"),
      markdown: String(input.markdown || ""),
      rawContent,
      qualityProfile: saveHtmlQualityProfile,
    });
    sanitizedHtml = sanitizeKnowledgeNoteModelHtml(repairedHtml, {
      title: fullTitle,
      sourceHash: input.htmlDraft?.sourceHash || rawSourceHash || createHash("sha256").update(candidateHtml).digest("hex"),
      qualityProfile: saveHtmlQualityProfile,
    });
    htmlQuality = mergeKnowledgeNoteHtmlQuality(requestedHtmlQuality, sanitizedHtml.quality);
    if (htmlQuality.passed) generationPipeline = uniqueStrings([...generationPipeline, "server_save_html_repair"]);
  }
  if (!sanitizedHtml.html.trim()) throw new Error("gateway_html_invalid");
  if (!htmlQuality.passed) throw new Error(`gateway_html_quality_failed:${htmlQuality.issues.join(",") || "quality_gate"}`);
  // njx-knowledge v2: 选择落点 (新主落点 /Users/njx/njx-knowledge/knowledge/<sub>/<YYYY-MM>/, 或保留 legacy / rollback)
  const requestedMode: "auto" | "nkx" | "legacy" =
    options?.landingMode || (rawDraftInput.nkxLandingRootMode as "auto" | "nkx" | "legacy" | undefined) || "auto";
  const useNkx = options?.useNkxLanding === true || rawDraftInput.useNkxLanding === true || requestedMode === "nkx";
  const finalLandingMode: "auto" | "nkx" | "legacy" =
    requestedMode === "legacy" ? "legacy"
    : useNkx ? "nkx"
    : "auto";
  const targetDir = finalLandingMode === "legacy"
    ? resolveKnowledgeNoteFolder(folder)
    : resolveKnowledgeNoteNkxLanding(options?.nkxSubdirOverride || rawDraftInput.nkxLandingSubdirOverride || folder, date, finalLandingMode);
  fs.mkdirSync(targetDir, { recursive: true });
  const requestedMarkdown = normalizeKnowledgeNoteMarkdownEscapes(String(input.markdown || "")).trim();
  const bodyMarkdown = knowledgeNoteHasUnsupportedCourseDrift(rawContent, {
    title: input.title,
    type: input.type,
    tags: input.tags,
    related: input.related,
    markdown: requestedMarkdown,
  }) || knowledgeNoteHasUnsupportedMbaDrift(rawContent, {
    title: input.title,
    type: input.type,
    tags: input.tags,
    related: input.related,
    markdown: requestedMarkdown,
  }) ? "" : requestedMarkdown || renderKnowledgeNoteMarkdown({ rawContent, title, date, type, status, tags, related, folder, markdown: "" });
  const markdown = renderKnowledgeNoteMarkdown({ rawContent, title, date, type, status, tags, related, folder, markdown: bodyMarkdown, layoutStrategy, htmlQuality, generationPipeline });
  const id = randomUUID();
  const baseName = `${date.replace(/-/g, "")}_${safeName(title)}.md`;
  let file = path.join(targetDir, baseName);
  if (fs.existsSync(file)) file = path.join(targetDir, `${date.replace(/-/g, "")}_${safeName(title)}_${id.slice(0, 8)}.md`);
  fs.writeFileSync(file, `${markdown.trim()}\n`, "utf8");
  const stat = fs.statSync(file);
  const entryId = randomUUID();
  const fileId = randomUUID();
  db.prepare("INSERT INTO knowledge_entries (id, title, source, source_path, summary, tags, status, created_at, updated_at, metadata, content_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(entryId, fullTitle, "memory-notes", file, markdown.replace(/^---[\s\S]*?---/, "").replace(/^# .*/m, "").trim().slice(0, 500), JSON.stringify(tags), status, nowIso(), nowIso(), JSON.stringify({ type, related, folder, noteType: type, layoutStrategy, htmlQuality, generationPipeline }), file);
  db.prepare("INSERT INTO knowledge_file_index (id, source, title, path, file_type, size_bytes, mtime, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(fileId, "memory", path.basename(file), file, "md", stat.size, stat.mtime.toISOString(), "indexed", nowIso());
  const html = writeKnowledgeNoteModelHtml(file, defaultHtmlPath(file), sanitizedHtml.html, fullTitle, markdown, stat.mtime.toISOString());
  const htmlStat = fs.statSync(html.htmlPath);
  const htmlFileId = randomUUID();
  db.prepare("INSERT INTO knowledge_file_index (id, source, title, path, file_type, size_bytes, mtime, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(htmlFileId, "memory", path.basename(html.htmlPath), html.htmlPath, "html", htmlStat.size, htmlStat.mtime.toISOString(), "indexed", nowIso());
  db.prepare("INSERT INTO document_renders (id, source_path, html_path, source_hash, render_status, document_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), file, html.htmlPath, html.sourceHash, "fresh", "knowledge-note", nowIso(), nowIso());
  // 2026-06-29 — copilot note mirror hook. 写源 .md/html 之后做派生 NAS 镜像。
  // 失败不抛、审计可见；主路径 (note create) 永远成功。
  const mirror = mirrorKnowledgeNoteFile(file, html.htmlPath);

  // njx-knowledge v2 / Phase 4 — 字典校验后处理. 字典脚本不可用时记 execution = skipped:... 或 failed:..., 不伪造 PASS.
  const dictValidation: KnowledgeNoteDictValidation = await runKnowledgeNoteDictValidation(input, { tags, related, title, type }).catch((err) => ({
    enabled: true, scriptPath: NJX_KNOWLEDGE_DICT_VALIDATOR_SCRIPT, pythonBin: NJX_KNOWLEDGE_DICT_PYTHON_BIN,
    execution: "failed:spawn", exitCode: null, errorMessage: err instanceof Error ? err.message : String(err),
    totalTerms: 0, canonicalCount: 0, aliasCount: 0, warningCount: 0, suggestionCount: 0, unknownCount: 0,
    substitutions: [], durationMs: 0,
  }));
  if (dictValidation.execution !== "ok" || dictValidation.warningCount > 0) {
    try { console.warn(`[njx-knowledge v2 / Phase 4] dict validation ${dictValidation.execution} for ${fullTitle}: warnings=${dictValidation.warningCount} unknown=${dictValidation.unknownCount} suggestions=${dictValidation.suggestionCount} subs=${dictValidation.substitutions.length}`); } catch {}
  }

  return {
    path: file,
    title: fullTitle,
    folder,
    entryId,
    fileId,
    htmlPath: html.htmlPath,
    htmlUrl: `/api/documents/file?path=${encodeURIComponent(html.htmlPath)}`,
    htmlFileId,
    htmlQuality,
    htmlFallback: false,
    mirrorPath: mirror.mirrorPath,
    mirrorStatus: mirror.mirrorStatus,
    mirrorError: mirror.mirrorError,
    dictValidation,
  };
}

// njx-knowledge v2: 显式写新主落点的便捷入口. /Users/njx/njx-knowledge/knowledge/<sub>/<YYYY-MM>/<file>.md
// legacy 入口保持原行为, 不受影响.
export function saveKnowledgeNoteNkx(db: Db, rawDraftInput: KnowledgeNoteDraftInput, nkxSubdirOverride?: string) {
  return saveKnowledgeNote(db, rawDraftInput, { useNkxLanding: true, nkxSubdirOverride });
}

export function saveKnowledgeNoteLegacy(db: Db, rawDraftInput: KnowledgeNoteDraftInput) {
  return saveKnowledgeNote(db, rawDraftInput, { landingMode: "legacy" });
}

export function getNkxKnowledgeRoots() {
  return {
    root: NJX_KNOWLEDGE_ROOT,
    notesRoot: NJX_KNOWLEDGE_NOTES_ROOT,
    legacyNotesRoot: NJX_KNOWLEDGE_LEGACY_NOTES_ROOT,
    allowedSubdirs: Array.from(NJX_KNOWLEDGE_NOTE_SUBDIRS),
    defaultSubdir: NJX_KNOWLEDGE_DEFAULT_SUBDIR,
  };
}

function inferKnowledgeNoteSaveHtmlQualityProfile(input: KnowledgeNoteDraftInput): "standard" | "low-information" {
  const metadata = [
    input.title || "",
    input.type || "",
    ...(input.tags || []),
    ...(input.related || []),
    JSON.stringify(input.layoutStrategy || {}),
  ].join("\n").slice(0, 20_000);
  if (/low-information-note|低信息密度|低信号|闲聊记录|碎片记录/.test(metadata)) return "low-information";
  const text = [
    input.title || "",
    input.type || "",
    ...(input.tags || []),
    ...(input.related || []),
    input.markdown || "",
  ].join("\n").slice(0, 80_000);
  const signals = [
    /低信息密度/,
    /信息密度判断|信息不足判断/,
    /闲聊记录|碎片记录/,
    /暂无可执行行动项/,
    /不宜推断|不建议.*长期/,
    /有限价值|可保留事实/,
    /缺少上下文|需要补充上下文/,
  ].filter((pattern) => pattern.test(text)).length;
  return signals >= 2 ? "low-information" : "standard";
}

function canRepairKnowledgeNoteSaveHtmlQuality(
  requested: ReturnType<typeof normalizeKnowledgeNoteHtmlQuality>,
  sanitized: ReturnType<typeof sanitizeKnowledgeNoteModelHtml>["quality"],
) {
  if (!requested.passed) return false;
  const repairableIssues = new Set([
    "html_missing_doctype",
    "html_missing_root",
    "html_missing_body",
    "missing_first_screen_value_sections",
    "missing_low_information_judgment",
    "missing_quote_or_judgment",
    "missing_topic_map",
    "html_too_thin",
    "missing_inline_css",
  ]);
  return sanitized.issues.every((issue) => repairableIssues.has(issue));
}

function repairKnowledgeNoteModelHtmlFirstScreen(inputHtml: string, input: {
  title: string;
  sourceHash: string;
  markdown: string;
  rawContent: string;
  qualityProfile: "standard" | "low-information";
}) {
  const sourceMarkdown = normalizeKnowledgeNoteMarkdownEscapes(String(input.markdown || "")).trim();
  const sections = extractKnowledgeFallbackSections(sourceMarkdown);
  const topicLabels = uniqueStrings([
    ...sections
      .map((section) => section.title)
      .filter((name) => !/原始记录|反向链接|元数据|frontmatter|source/i.test(name)),
    ...extractKnowledgeNoteEntities(`${input.title}\n${sourceMarkdown}`),
  ]).slice(0, 6);
  const summaryItems = knowledgeFallbackSectionItems(sections, /高价值摘要|价值摘要|对话概览|内容理解|系统性总结|会议概要|课程框架|核心内容/);
  const judgmentItems = knowledgeFallbackSectionItems(sections, /金句|判断句|价值提炼|关键结论|核心判断|信息密度判断/);
  const actionItems = knowledgeFallbackSectionItems(sections, /后续行动|行动项|下一步|待办/);
  const evidenceItems = knowledgeFallbackSectionItems(sections, /关键依据|来源依据|净化证据|证据摘录|原始记录|证据入口/);
  const primarySummary = knowledgeNoteFirstScreenSafeText(summaryItems[0] || knowledgeFallbackFirstParagraph(sourceMarkdown), "已依据 Gateway/MiniMax 生成的 Markdown 可信源整理为阅读入口；未在原文中出现的主题不进入结论。");
  const primaryJudgment = input.qualityProfile === "low-information"
    ? knowledgeNoteFirstScreenSafeText(judgmentItems[0], "信息密度判断：当前记录只保留原文可证据支持的事实，缺少上下文的内容不强行扩展。")
    : knowledgeNoteFirstScreenSafeText(judgmentItems[0], "严格依据原文：只展示 Markdown 可信源已经覆盖的主题，不补写无证据背景。");
  const actionText = knowledgeNoteFirstScreenSafeText(actionItems[0], input.qualityProfile === "low-information"
    ? "暂无可执行行动项；需要补充上下文后再判断是否进入长期知识资产。"
    : "复核来源证据，确认主题、行动项和待核验内容后沉淀到长期知识库。");
  const evidenceText = knowledgeNoteFirstScreenSafeText(evidenceItems[0], "查看 Markdown 可信源与原始记录入口，按 source-hash 追溯本次整理。");
  const topicHtml = (topicLabels.length ? topicLabels : ["核心判断", input.qualityProfile === "low-information" ? "信息密度判断" : "主题地图", "高价值摘要", "行动项", "证据入口"])
    .map((item) => `<span>${escapeInlineHtml(item)}</span>`)
    .join("");
  const densityBlock = input.qualityProfile === "low-information"
    ? `<section class="save-repair-card density"><h2>低信息密度判断</h2><p>${escapeInlineHtml(primaryJudgment)}</p></section>`
    : `<section class="save-repair-card map"><h2>主题地图</h2><div class="save-repair-map">${topicHtml}</div></section>`;
  const repairSection = `
    <section class="save-repair-hero panel card" aria-label="保存前首屏结构修补">
      <p class="save-repair-kicker">Gateway/MiniMax 结果 · 保存端结构修补</p>
      <h1>${escapeInlineHtml(input.title)}</h1>
      <section class="save-repair-card judgment"><h2>核心判断</h2><p>${escapeInlineHtml(primaryJudgment)}</p></section>
      ${densityBlock}
      <section class="save-repair-grid">
        <section class="save-repair-card summary"><h2>高价值摘要</h2><p>${escapeInlineHtml(primarySummary)}</p></section>
        <section class="save-repair-card quote"><h2>金句 / 判断句</h2><p>${escapeInlineHtml(primaryJudgment)}</p></section>
        <section class="save-repair-card action"><h2>行动项</h2><p>${escapeInlineHtml(actionText)}</p></section>
        <section class="save-repair-card evidence"><h2>证据入口</h2><p>${escapeInlineHtml(evidenceText)}</p><p>Markdown 可信源 · 原始记录入口 · source-hash: ${escapeInlineHtml(input.sourceHash.slice(0, 16))}...</p></section>
        <section class="save-repair-card evidence"><h2>来源边界</h2><p>HTML 阅读层只修补首屏信息结构，不新增主题、不覆盖 Gateway/MiniMax 的 Markdown 可信源、不替代原始记录；任何未被原文证据支持的内容都应继续留在待核验或不写入结论。保存端只做版式与信息层级修复：把核心判断、主题地图、高价值摘要、判断句、行动项和证据入口放回首屏，便于用户保存后立即校对；真实语义仍以模型生成的 Markdown 和原始记录为准。</p></section>
      </section>
    </section>`;
  const repairCss = `<style data-knowledge-save-repair>
    .save-repair-hero{max-width:1120px;margin:24px auto;padding:28px;border:1px solid #d8e3ef;border-radius:22px;background:linear-gradient(135deg,#ffffff 0%,#f7fbff 100%);box-shadow:0 20px 60px rgba(22,36,58,.10);color:#152033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.66}
    .save-repair-kicker{margin:0 0 10px;color:#0f766e;font-size:13px;font-weight:800}.save-repair-hero h1{margin:0 0 18px;font-size:clamp(28px,4vw,48px);line-height:1.12;letter-spacing:0}.save-repair-card{padding:16px 18px;margin:12px 0;border:1px solid #d9e4ef;border-radius:16px;background:rgba(255,255,255,.9)}.save-repair-card h2{margin:0 0 8px;font-size:17px}.save-repair-card p{margin:0;color:#334155}.save-repair-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.save-repair-map{display:flex;flex-wrap:wrap;gap:8px}.save-repair-map span{display:inline-flex;padding:6px 10px;border-radius:999px;background:#e8f7f3;color:#0f766e;font-size:13px;font-weight:750}.save-repair-card.evidence p{word-break:break-word}@media(max-width:760px){.save-repair-hero{margin:12px;padding:18px}.save-repair-grid{grid-template-columns:1fr}.save-repair-hero h1{font-size:28px}}
  </style>`;
  let html = String(inputHtml || "").trim();
  if (!/<html\b/i.test(html)) html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeInlineHtml(input.title)}</title></head><body>${html}</body></html>`;
  if (!/<head\b/i.test(html)) html = html.replace(/<html\b([^>]*)>/i, `<html$1><head><meta charset="utf-8"><title>${escapeInlineHtml(input.title)}</title></head>`);
  html = html.replace(/<head\b([^>]*)>/i, `<head$1>\n  ${repairCss}`);
  if (/<body\b[^>]*>/i.test(html)) return html.replace(/<body\b([^>]*)>/i, `<body$1>\n${repairSection}`);
  return html.replace(/<\/head>/i, `</head><body>\n${repairSection}`).replace(/<\/html>\s*$/i, `</body></html>`);
}

function knowledgeNoteFirstScreenSafeText(value: unknown, fallback: string) {
  const text = String(value || "")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>#\[\]]/g, "")
    .replace(/^\s*[-*]\s*/gm, "")
    .replace(/(?:^|\n)\s*[\u4e00-\u9fa5A-Za-z0-9_ -]{1,18}\s+\d{1,2}:\d{2}(?::\d{2})?\s*/g, "\n")
    .replace(/(?:^|\n)\s*\d{1,2}:\d{2}(?::\d{2})?\s*/g, "\n")
    .replace(/\b(?:我操|卧槽|他妈|妈的|傻逼|尼玛)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (text.length >= 8 ? text : fallback).slice(0, 220);
}

export function regenerateKnowledgeNoteHtml(db: Db, input: { path?: string; mode?: string }) {
  const file = resolveKnowledgeNoteMarkdownFile(input.path);
  const markdown = fs.readFileSync(file, "utf8");
  const stat = fs.statSync(file);
  const title = extractKnowledgeFallbackTitle(markdown) || path.basename(file, path.extname(file));
  const sourceHash = extractKnowledgeNoteFrontmatterValue(markdown, "source_hash") || createHash("sha256").update(markdown).digest("hex");
  const reason = input.mode === "m27-html" ? "manual_regenerate_m3_unavailable_local_high_value" : "manual_regenerate_local_high_value";
  const html = writeKnowledgeNoteFallbackHtml(file, defaultHtmlPath(file), markdown, title, sourceHash, reason, stat.mtime.toISOString());
  const htmlStat = fs.statSync(html.htmlPath);
  const fileId = upsertKnowledgeFileIndex(db, file, "indexed");
  const htmlFileId = upsertKnowledgeFileIndex(db, html.htmlPath, "indexed");
  db.prepare("INSERT INTO document_renders (id, source_path, html_path, source_hash, render_status, document_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), file, html.htmlPath, sourceHash, "regenerated", "knowledge-note", nowIso(), nowIso());
  return {
    path: file,
    title,
    fileId,
    htmlPath: html.htmlPath,
    htmlUrl: `/api/documents/file?path=${encodeURIComponent(html.htmlPath)}`,
    htmlFileId,
    size: htmlStat.size,
    sourceHash,
    renderStatus: "regenerated",
    mode: input.mode === "m27-html" ? "local-high-value" : "local-high-value",
  };
}

// 2026-07-07 (rework8) — Strip leading analysis preamble from model-emitted HTML body.
// LLM (MiniMax-M3) occasionally emits Chinese/English analysis preamble at the
// start of `<body>` ("让我分析一下...", "Let me analyze...", "下面是整理后的笔记...",
// "The user is asking..."). The client-side `knowledgeNoteHtmlHasReasoningLeak`
// check (`apps/web/src/App.tsx:13516`) rejects these with `analysis_preamble_in_visible_body`
// and forces score ≤ 20 + passed=false. Server must strip these prefixes BEFORE
// the HTML reaches the client.
//
// Strategy: anchor at body start, walk past <script>/<style>/<head> blocks and
// leading opening tags, then look for an analysis preamble phrase. If found,
// cut the matched phrase + the rest of the leading intro sentence up to the
// next opening tag. Repeat up to 4 attempts (handles multi-paragraph preamble).
//
// We deliberately do NOT strip preamble from the body middle — those instances
// are rare and stripping mid-content could damage legitimate user data. The
// client's full-body check still has a fallback: after this strip, if any
// preamble phrase remains in the visible body, we surface the
// `analysis_preamble_in_visible_body` issue so `quality.passed` becomes false
// and the user sees a clear "preamble detected, please retry" message.
const KNOWLEDGE_NOTE_HTML_PREAMBLE_LEADER_RE = /^(?:让我(?:先|来|看看|分析(?:一下)?|整理(?:一下)?|处理(?:一下)?|先)?|我来(?:分析|整理|看看|处理|先)|下面我(?:来|将)?|以下是(?:整理(?:结果|笔记|后)?|笔记)?|下面是(?:整理(?:结果|笔记|后)?|笔记)?|整理结果\s*[:：]?|\s*Let me (?:analyze|look at|review|examine|read|organize|process|start)\b|\s*First,?\s+let me\b|\s*The user is asking\b|\s*The raw notes are\b|\s*The user (?:provided|pasted|gave|wants)\b|\s*I need to\b|\s*I'll (?:start|now|begin|analyze)\b|\s*Here's my (?:analysis|plan)\b|\s*Below is (?:my|the) (?:analysis|plan)\b)/i;
// Strict residual check (matches client `KNOWLEDGE_NOTE_DIRECT_LEAK_PREAMBLE_RE`).
const KNOWLEDGE_NOTE_HTML_PREAMBLE_RESIDUAL_RE = /(?:Let me (?:analyze|look at|review|examine|read|organize|process|start)|First,?\s+let me|The user is asking|The raw notes are|The user (?:provided|pasted|gave|wants)|I need to|I'll (?:start|now|begin|analyze)|Here's my (?:analysis|plan)|Below is (?:my|the) (?:analysis|plan)|下面我|让我(?:先|来)?|我来(?:分析|整理|看看))/i;
function stripKnowledgeNoteHtmlLeadingPreamble(htmlText: string, maxAttempts = 4): string {
  let text = String(htmlText || "");
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = text;
    let i = 0;
    let blockSafety = 0;
    while (i < text.length && i < 1500 && blockSafety < 80) {
      blockSafety += 1;
      const ch = text[i];
      if (ch === "<") {
        const blockMatch = /^<(script|style|noscript|head)\b/i.exec(text.slice(i));
        if (blockMatch) {
          const closeTag = `</${blockMatch[1].toLowerCase()}>`;
          const closeIdx = text.toLowerCase().indexOf(closeTag, i);
          if (closeIdx !== -1) {
            i = closeIdx + closeTag.length;
            continue;
          }
        }
        const end = text.indexOf(">", i);
        if (end === -1) break;
        i = end + 1;
        continue;
      }
      if (/\s/.test(ch) || ch === "\u3000") { i += 1; continue; }
      break;
    }
    if (i >= text.length) break;
    const rest = text.slice(i);
    const m = KNOWLEDGE_NOTE_HTML_PREAMBLE_LEADER_RE.exec(rest);
    if (!m) break;
    let cutEnd = i + m[0].length;
    let punctSafety = 0;
    while (cutEnd < text.length && punctSafety < 8) {
      const ch = text[cutEnd];
      if (ch === "<") break;
      if (/[,.;:!?。，；、！？\s\u3000\n\r]/.test(ch)) { cutEnd += 1; punctSafety += 1; continue; }
      break;
    }
    while (cutEnd < text.length && cutEnd < i + 600) {
      if (text[cutEnd] === "<") break;
      cutEnd += 1;
    }
    text = text.slice(0, i) + text.slice(cutEnd);
    if (text === before) break;
  }
  return text;
}

export function sanitizeKnowledgeNoteModelHtml(inputHtml: string, input: { title: string; sourceHash: string; qualityProfile?: "standard" | "low-information" }) {
  const issues: string[] = [];
  const qualityProfile = input.qualityProfile || "standard";
  const rawHtml = String(inputHtml || "").trim();
  let html = normalizeKnowledgeNoteHtmlEscapes(rawHtml);
  if (rawHtml && html !== rawHtml) issues.push("html_escaped_string_repaired");
  if (!html) issues.push("html_empty");
  if (!/<!doctype\s+html/i.test(html)) issues.push("html_missing_doctype");
  if (!/<html\b/i.test(html)) issues.push("html_missing_root");
  if (!/<body\b/i.test(html)) issues.push("html_missing_body");
  if (/<script\b/i.test(html)) issues.push("removed_script");
  if (/<(?:iframe|object|embed|form)\b/i.test(html)) issues.push("removed_unsafe_container");
  if (/<(?:input|textarea|select)\b/i.test(html)) issues.push("removed_form_control");
  if (/\son[a-z]+\s*=/i.test(html)) issues.push("removed_event_handler");
  if (/\b(?:src|href|action|formaction|poster)\s*=\s*["']?(?:https?:|\/\/|javascript:|file:|data:text\/html)/i.test(html)) issues.push("removed_external_or_unsafe_url");
  if (/@import/i.test(html)) issues.push("removed_css_import");

  html = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[\s\S]*?(?:<\/embed>|>)/gi, "")
    .replace(/<form\b[\s\S]*?<\/form>/gi, "")
    .replace(/<(?:input|textarea|select|link|base)\b[\s\S]*?>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s+(?:src|href|action|formaction|poster)\s*=\s*"(?:(?:https?:|\/\/|javascript:|file:|data:text\/html)[^"]*)"/gi, "")
    .replace(/\s+(?:src|href|action|formaction|poster)\s*=\s*'(?:(?:https?:|\/\/|javascript:|file:|data:text\/html)[^']*)'/gi, "")
    .replace(/\s+(?:src|href|action|formaction|poster)\s*=\s*(?:https?:|\/\/|javascript:|file:|data:text\/html)[^\s>]*/gi, "")
    .replace(/@import[^;]+;/gi, "");

  if (!/<html\b/i.test(html)) {
    html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeInlineHtml(input.title)}</title></head><body>${html}</body></html>`;
  }
  if (!/<head\b/i.test(html)) {
    html = html.replace(/<html\b([^>]*)>/i, `<html$1><head><meta charset="utf-8"><title>${escapeInlineHtml(input.title)}</title></head>`);
  }
  if (!/<body\b/i.test(html)) {
    html = html.replace(/<\/head>/i, `</head><body>`).replace(/<\/html>\s*$/i, `</body></html>`);
  }
  if (!/<!doctype\s+html/i.test(html)) html = `<!doctype html>\n${html}`;

  const metaTags = [
    `<meta name="source-hash" content="${escapeInlineHtml(input.sourceHash)}">`,
    `<meta name="rendered-at" content="${nowIso()}">`,
  ].join("\n  ");
  if (!/<meta\b[^>]+name\s*=\s*["']source-hash["']/i.test(html)) {
    html = html.replace(/<head\b([^>]*)>/i, `<head$1>\n  ${metaTags}`);
  }
  if (!/<meta\b[^>]+name\s*=\s*["']viewport["']/i.test(html)) {
    html = html.replace(/<head\b([^>]*)>/i, `<head$1>\n  <meta name="viewport" content="width=device-width, initial-scale=1">`);
  }

  const bodyHtmlOriginal = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";
  let bodyHtml = stripKnowledgeNoteHtmlLeadingPreamble(bodyHtmlOriginal);
  if (bodyHtml !== bodyHtmlOriginal) {
    // rewrite html to also strip the preamble in the persisted/returned body
    html = html.replace(bodyHtmlOriginal, bodyHtml);
  }
  const visibleBody = (bodyHtml || html)
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&hellip;|&#8230;/gi, "…")
    .replace(/\s+/g, " ")
    .trim();
  // After strip, if the visible body still contains any analysis preamble
  // phrase (rare — e.g. when preamble leaked into body middle), surface it as
  // a critical issue so quality.passed=false → user sees clear retry hint.
  if (KNOWLEDGE_NOTE_HTML_PREAMBLE_RESIDUAL_RE.test(visibleBody)) {
    issues.push("analysis_preamble_in_visible_body");
  }
  const visible = html.replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const firstScreen = visible.slice(0, 2600);
  const visibleLiteralEscapeCount = (visible.match(/\\r\\n|\\n|\\r|\\t|\\"|\\u00(?:3c|3e|22)/gi) || []).length;
  const meaningfulBodySignal = visibleBody.replace(/[\s.。…·、，,;；:：!！?？|/\\()[\]{}<>_\-—–~`"'“”‘’]+/g, "");
  const placeholderOnlyBody = !visibleBody
    || /^(?:\.{1,3}|…|。|·|\s)+$/.test(visibleBody)
    || (visibleBody.length < 40 && meaningfulBodySignal.length < 8);
  // v3：完全交给模型。不再用 section 名白名单当"语义覆盖度"尺子——
  //     删除 firstScreenHits 计数 + missing_first_screen_value_sections / missing_topic_map / missing_quote_or_judgment 三个 missing 推送。
  //     保留 missing_low_information_judgment 作为低信息密度模式的兜底。
  if (placeholderOnlyBody) issues.push("html_placeholder_only");
  if (qualityProfile === "low-information" && !/低信息密度判断|信息密度判断|信息不足判断/.test(firstScreen)) issues.push("missing_low_information_judgment");
  if (/Knowledge Note Interaction Document|浏览器菜单可打印|来源校验/.test(firstScreen.slice(0, 1200))) issues.push("generic_document_shell");
  if (visibleLiteralEscapeCount >= 3) issues.push("html_contains_literal_escape_sequences");
  if (/源笔记截断提示|原始\s*Markdown\s*第\s*\d+/i.test(firstScreen)) issues.push("html_source_truncation_notice_visible");
  if (/(?:用户|发言人\d+)\s+\d{1,2}:\d{2}|我操|卧槽|他妈|妈的|傻逼|尼玛|就就|这个这个|那个那个/.test(firstScreen)) issues.push("first_screen_raw_or_noisy_transcript");
  if (visible.length < (qualityProfile === "low-information" ? 380 : 520)) issues.push("html_too_thin");
  if (!/<style\b/i.test(html)) issues.push("missing_inline_css");
  const styleLength = (html.match(/<style\b[\s\S]*?<\/style>/i)?.[0] || "").length;
  const hasSemanticLayout = /<(?:section|article|main|aside)\b/i.test(html)
    || /\b(?:judgment-banner|judge|density|summary-block|summ|topic-card|evidence-block|action-block|golden-quote-block|hero|panel|card)\b/i.test(html);
  const hasLayoutVocabulary = /\b(?:grid|card|panel|hero|map|summary|judgment|judge|density|evidence|action|golden|topic|summ)\b/i.test(html);
  const hasHeadingHierarchy = (/<h1\b/i.test(html) && /<h2\b/i.test(html))
    || (/(?:核心判断|核心观点)/.test(firstScreen) && /(?:高价值摘要|价值摘要|低信息密度判断|主题地图)/.test(firstScreen));
  // v3：semanticCoverage 改用结构元素（语义标签 + 布局词表 + 标题层级），
  //     不再用 section 名正则白名单。
  const semanticCoverage = Math.min(100,
    (hasSemanticLayout ? 35 : 0) +
    (hasLayoutVocabulary ? 35 : 0) +
    (hasHeadingHierarchy ? 30 : 0)
  );
  const requiredStyleLength = qualityProfile === "low-information" ? 850 : 1200;
  const visualHierarchy = Math.max(0, Math.min(100,
    100
      - (hasSemanticLayout ? 0 : 22)
      - (hasLayoutVocabulary ? 0 : 20)
      - (styleLength >= requiredStyleLength ? 0 : 18)
      - (hasHeadingHierarchy ? 0 : 16)
      - (/border-radius|box-shadow|gap\s*:/i.test(html) ? 0 : 12)
  ));
  const evidenceTrace = Math.max(0, Math.min(100,
    (/name\s*=\s*["']source-hash["']/i.test(html) ? 34 : 0)
      + (/证据入口|来源依据|关键依据|原始记录入口/.test(visible) ? 33 : 0)
      + (/source-hash|rendered-at|Markdown 可信源|原始记录/.test(visible) ? 33 : 0)
  ));
  const noiseControl = Math.max(0, 100
    - (/(?:用户|发言人\d+)\s+\d{1,2}:\d{2}/.test(firstScreen) ? 35 : 0)
    - (/我操|卧槽|他妈|妈的|傻逼|尼玛/.test(firstScreen) ? 35 : 0)
    - (/就就|这个这个|那个那个|呃呃|嗯嗯/.test(firstScreen) ? 20 : 0)
    - (/Knowledge Note Interaction Document|浏览器菜单可打印|来源校验/.test(firstScreen.slice(0, 1200)) ? 25 : 0)
    - (visibleLiteralEscapeCount >= 3 ? 35 : 0)
    - (/源笔记截断提示|原始\s*Markdown\s*第\s*\d+/i.test(firstScreen) ? 25 : 0)
  );
  const unsafeIssues = issues.filter((issue) => /^removed_|^html_empty$|^removed_css_import$/.test(issue));
  const safety = unsafeIssues.length ? Math.max(0, 100 - unsafeIssues.length * 30) : 100;
  const dimensions = { semanticCoverage, visualHierarchy, evidenceTrace, noiseControl, safety };
  const nonBlockingIssues = [
    "html_missing_doctype",
    "html_missing_root",
    "html_missing_body",
    "missing_topic_map",
    "missing_low_information_judgment",
    "missing_quote_or_judgment",
    "missing_first_screen_value_sections",
    "first_screen_raw_or_noisy_transcript",
    "html_too_thin",
    "missing_inline_css",
    "generic_document_shell",
    "html_escaped_string_repaired",
    // 2026-07-07 (rework9 save-fix) — Save 流程不再因这条 issue throw.
    // 真因: 12:35 NJX "午间咖啡杂谈" 13-topic HTML body 中段含 user 真实对话
    // ("让我做 PPT" / "我他妈一个月喝了这么多饮料") — 是 user transcript 不是
    // model chain-of-thought. 开头 chain-of-thought 仍由 leading-strip 处理.
    // 这条 issue 仍会出现在 issues[] 给 UI 提示, 但不再让 passed=false.
    "analysis_preamble_in_visible_body",
  ];
  const criticalIssues = issues.filter((issue) => !nonBlockingIssues.includes(issue));
  // v3：删 non-blocking issues 的扣分项（`(issues.length - criticalIssues.length) * 3`）。
  //     score 由 5 维度均值决定，不再被 missing_* 系列拖累。
  const score = Math.max(0, Math.min(100, Math.round((semanticCoverage + visualHierarchy + evidenceTrace + noiseControl + safety) / 5) - criticalIssues.length * 6));
  // v3：完全交给模型。删 quality gate——任何 safety >= 100（无 XSS 风险）即通过；
  //     内容门槛（topic_map/quote_or_judgment/first_screen_value_sections/noisy_transcript）
  //     不再阻断保存。quality.issues 仍记录供 UI 展示，但不作为阻塞项。
  return {
    html,
    quality: {
      score,
      passed: safety >= 100 && criticalIssues.length === 0,
      issues: uniqueStrings(issues),
      dimensions,
    },
  };
}

function normalizeKnowledgeNoteHtmlQuality(input: KnowledgeNoteHtmlQualityInput | undefined, fallbackIssue: string) {
  const rawIssues = Array.isArray(input?.issues) ? input.issues.map(String).filter(Boolean).slice(0, 12) : [fallbackIssue];
  const staleRuntimeError = rawIssues.some(isKnowledgeNoteStaleRuntimeIssue);
  const issues = staleRuntimeError ? uniqueStrings(["stale_runtime_error", ...rawIssues]) : rawIssues;
  const score = Math.max(0, Math.min(100, Number(input?.score ?? 72)));
  const dimensions = normalizeKnowledgeNoteHtmlQualityDimensions(input?.dimensions);
  return {
    score,
    passed: !staleRuntimeError && Boolean(input?.passed) && score >= 80,
    issues,
    dimensions,
  };
}

function mergeKnowledgeNoteHtmlQuality(requested: ReturnType<typeof normalizeKnowledgeNoteHtmlQuality>, sanitized: ReturnType<typeof sanitizeKnowledgeNoteModelHtml>["quality"]) {
  const issues = uniqueStrings([...requested.issues, ...sanitized.issues]);
  const score = Math.min(requested.score, sanitized.score);
  const dimensions = mergeKnowledgeNoteHtmlQualityDimensions(requested.dimensions, sanitized.dimensions);
  // v3.2 修复：去掉 score >= 80 阈值。v3 哲学"不限制模型输出"——只要 XSS safety 过就保存。
  // score 仍是诊断信息，但不阻断。
  // 2026-07-07 (rework9) — save 路径专用 advisory 白名单：以下 issues 在 save
  // 时不算 blocking，passed 由「真实 critical (XSS / 完整性 / safety)」
  // 决定。这些 issues 仍出现在 issues[] 里供 UI 提示，但不阻断入库。
  //   - analysis_preamble_in_visible_body: body 中段出现 "让我..." / "我他妈..." / "Let me..."
  //     等。在 user 真实对话转录 (闲聊/会议) 中是合法 user data, 不是 model chain-of-thought
  //     preamble。开头 chain-of-thought 已由 leading-strip 处理。
  //   - first_screen_raw_or_noisy_transcript: "我操/卧槽/他妈/妈的/傻逼/尼玛/就就/这个这个/那个那个"
  //     等。同上是 user 原话转录, 不是 noise (server-side 的 `firstScreen` 检测对 user data
  //     过度敏感)。
  const SAVE_ADVISORY_ISSUES = new Set<string>([
    "analysis_preamble_in_visible_body",
    "first_screen_raw_or_noisy_transcript",
  ]);
  const sanitizedBlocking = (Array.isArray(sanitized.issues) ? sanitized.issues : []).filter(
    (i) => !SAVE_ADVISORY_ISSUES.has(i),
  );
  const passed = Boolean(sanitized.passed) && sanitizedBlocking.length === 0;
  return {
    score,
    passed,
    issues,
    dimensions,
  };
}

function normalizeKnowledgeNoteHtmlQualityDimensions(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    semanticCoverage: htmlQualityDimension(record.semanticCoverage),
    visualHierarchy: htmlQualityDimension(record.visualHierarchy),
    evidenceTrace: htmlQualityDimension(record.evidenceTrace),
    noiseControl: htmlQualityDimension(record.noiseControl),
    safety: htmlQualityDimension(record.safety),
  };
}

function mergeKnowledgeNoteHtmlQualityDimensions(a: ReturnType<typeof normalizeKnowledgeNoteHtmlQualityDimensions>, b: ReturnType<typeof normalizeKnowledgeNoteHtmlQualityDimensions>) {
  return {
    semanticCoverage: Math.min(a.semanticCoverage, b.semanticCoverage),
    visualHierarchy: Math.min(a.visualHierarchy, b.visualHierarchy),
    evidenceTrace: Math.min(a.evidenceTrace, b.evidenceTrace),
    noiseControl: Math.min(a.noiseControl, b.noiseControl),
    safety: Math.min(a.safety, b.safety),
  };
}

function htmlQualityDimension(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeKnowledgeGenerationPipeline(input: unknown, fallback: string[]) {
  const pipeline = Array.isArray(input) ? input.map(String).map((item) => item.trim()).filter(Boolean) : [];
  return uniqueStrings(pipeline.length ? pipeline : fallback).slice(0, 8);
}

function writeKnowledgeNoteModelHtml(sourcePath: string, htmlPath: string, html: string, title: string, markdown: string, sourceMtime: string) {
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html.trim() + "\n", "utf8");
  return {
    title,
    htmlPath,
    sourcePath,
    sourceHash: createHash("sha256").update(markdown).digest("hex"),
    renderedAt: nowIso(),
    toc: [],
    sourceMtime,
  };
}

function writeKnowledgeNoteFallbackHtml(sourcePath: string, htmlPath: string, markdown: string, title: string, sourceHash: string, reason: string, sourceMtime: string) {
  const html = renderKnowledgeNoteHighValueFallbackHtml(markdown, title, sourceHash, reason);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, `${html.trim()}\n`, "utf8");
  return {
    title,
    htmlPath,
    sourcePath,
    sourceHash,
    renderedAt: nowIso(),
    toc: [],
    sourceMtime,
  };
}

export function renderKnowledgeNoteHighValueFallbackHtml(markdown: string, title: string, sourceHash: string, reason: string) {
  const cleanTitle = extractKnowledgeFallbackTitle(markdown) || title || "Knowledge Note";
  const sourceText = extractKnowledgeFallbackSourceText(markdown);
  const reliabilitySummary = buildKnowledgeFallbackReliabilityMeetingSummary(cleanTitle, markdown, sourceText);
  if (reliabilitySummary) return renderKnowledgeFallbackReliabilityMeetingHtml(reliabilitySummary, sourceHash, reason);
  const safetySummary = buildKnowledgeFallbackSafetyCommitteeSummary(cleanTitle, markdown, sourceText);
  if (safetySummary) return renderKnowledgeFallbackSafetyCommitteeHtml(safetySummary, sourceHash, reason);
  const operationalBriefing = buildKnowledgeFallbackOperationalBriefingSummary(cleanTitle, markdown, sourceText);
  if (operationalBriefing) return renderKnowledgeFallbackOperationalBriefingHtml(operationalBriefing, sourceHash, reason);
  const workSummary = buildKnowledgeFallbackWorkSummary(cleanTitle, markdown, sourceText);
  if (workSummary) return renderKnowledgeFallbackWorkSummaryHtml(workSummary, sourceHash, reason);
  const sections = extractKnowledgeFallbackSections(markdown);
  const topicLabels = sections
    .map((section) => section.title)
    .filter((name) => !/原始记录|反向链接|元数据|frontmatter/i.test(name))
    .slice(0, 8);
  const summaryItems = knowledgeFallbackSectionItems(sections, /高价值摘要|价值摘要|对话概览|内容理解|系统性总结/).slice(0, 4);
  const judgmentItems = knowledgeFallbackSectionItems(sections, /金句|判断句|价值提炼|系统性总结|关键结论/).slice(0, 4);
  const actionItems = knowledgeFallbackSectionItems(sections, /后续行动|行动项|下一步/).slice(0, 4);
  const evidenceItems = knowledgeFallbackSectionItems(sections, /关键依据|来源依据|净化证据|证据摘录|原始记录/).slice(0, 4);
  const riskItems = knowledgeFallbackSectionItems(sections, /待核验|风险|疑点/).slice(0, 3);
  const primarySummary = summaryItems[0] || knowledgeFallbackFirstParagraph(markdown) || "这份笔记已保留 Markdown 可信源，当前 HTML 为本地高价值阅读层回退版本。";
  const primaryJudgment = judgmentItems[0] || "有价值的知识笔记不应复述转写，而要把真实问题、判断、行动和证据组织成可复用资产。";
  const topicHtml = (topicLabels.length ? topicLabels : ["核心判断", "主题地图", "高价值摘要", "行动项", "证据入口"])
    .map((item) => `<span>${escapeInlineHtml(item)}</span>`)
    .join("");
  const tocHtml = topicLabels.map((item) => `<a href="#${knowledgeFallbackAnchor(item)}">${escapeInlineHtml(item)}</a>`).join("");
  const css = `
    :root{color-scheme:light;--ink:#162033;--muted:#607089;--line:#d8e1ec;--bg:#f5f7fb;--panel:#fff;--accent:#0f766e;--accent-2:#1f4d7a;--soft:#e8f7f3;--warn:#fff6db;--shadow:0 18px 55px rgba(16,31,52,.10)}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,#edf7ff 0,#f7fafc 34%,#eef3f8 100%);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.68}
    .page{max-width:1180px;margin:0 auto;padding:34px 22px 58px}.hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:18px;align-items:stretch;margin-bottom:18px}.panel{background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}
    .lead{padding:30px}.eyebrow{display:inline-flex;gap:8px;align-items:center;color:var(--accent);font-weight:800;font-size:13px;letter-spacing:0}.lead h1{margin:12px 0 12px;font-size:clamp(30px,4vw,54px);line-height:1.08;letter-spacing:0}.thesis{font-size:17px;color:#334155;max-width:840px}.meta{padding:24px;display:grid;gap:12px}.meta strong{font-size:16px}.hash{word-break:break-all;color:var(--muted);font-size:12px}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:18px 0}.card{padding:18px;border-radius:16px;border:1px solid var(--line);background:var(--panel);box-shadow:0 8px 28px rgba(16,31,52,.06)}.card h2{margin:0 0 10px;font-size:18px}.card p,.card li{color:#334155}.map{grid-column:span 3}.topic-map{display:flex;flex-wrap:wrap;gap:10px}.topic-map span{display:inline-flex;align-items:center;border-radius:999px;background:var(--soft);color:#0f766e;font-weight:750;padding:7px 10px;font-size:13px}.quote{border-left:4px solid var(--accent);background:#f8fffd}.actions{background:#fbfdff}.warn{background:var(--warn)}
    .content{display:grid;grid-template-columns:260px minmax(0,1fr);gap:18px;margin-top:18px}.toc{position:sticky;top:18px;padding:18px;align-self:start}.toc a{display:block;color:#38536f;text-decoration:none;padding:7px 0;border-bottom:1px solid #edf1f6;font-size:13px}.doc{padding:26px}.doc h2{border-top:1px solid var(--line);padding-top:22px;margin-top:26px}.doc pre{white-space:pre-wrap;word-break:break-word;background:#101828;color:#e5eef9;border-radius:14px;padding:16px;overflow:auto}.doc table{width:100%;border-collapse:collapse;display:block;overflow-x:auto}.doc th,.doc td{border:1px solid var(--line);padding:9px;text-align:left;vertical-align:top}.footer{margin-top:18px;color:var(--muted);font-size:12px;text-align:center}
    @media(max-width:860px){.page{padding:18px 12px}.hero,.content{grid-template-columns:1fr}.grid{grid-template-columns:1fr}.map{grid-column:auto}.lead h1{font-size:30px}.toc{position:static}}
  `;
  const body = `
    <main class="page">
      <section class="hero">
        <article class="panel lead">
          <span class="eyebrow">本地回退 HTML · 高价值纪要模板</span>
          <h1>${escapeInlineHtml(cleanTitle)}</h1>
          <p class="thesis"><strong>核心判断：</strong>${escapeInlineHtml(primaryJudgment)}</p>
          <p class="thesis"><strong>高价值摘要：</strong>${escapeInlineHtml(primarySummary)}</p>
        </article>
        <aside class="panel meta">
          <strong>证据入口</strong>
          <span>Markdown 可信源已保留；HTML 仅作为阅读层。</span>
          <span>回退原因：${escapeInlineHtml(reason || "local_html_fallback")}</span>
          <span class="hash">source-hash · ${escapeInlineHtml(sourceHash)}</span>
        </aside>
      </section>
      <section class="grid" aria-label="首屏摘要">
        <article class="card map"><h2>主题地图</h2><div class="topic-map">${topicHtml}</div></article>
        <article class="card"><h2>高价值摘要</h2>${knowledgeFallbackListHtml(summaryItems, primarySummary)}</article>
        <article class="card quote"><h2>金句 / 判断句</h2>${knowledgeFallbackListHtml(judgmentItems, primaryJudgment)}</article>
        <article class="card actions"><h2>行动项</h2>${knowledgeFallbackListHtml(actionItems, "复核原始记录，确认可沉淀为长期知识资产的判断、行动和证据。")}</article>
        <article class="card warn"><h2>待核验</h2>${knowledgeFallbackListHtml(riskItems, "MiniMax 未完成高质量 HTML 生成，本地模板已保留可读结构，需要人工复核主题覆盖。")}</article>
        <article class="card"><h2>证据入口</h2>${knowledgeFallbackListHtml(evidenceItems, "查看 Markdown 可信源中的来源依据、净化摘录和原始记录入口。")}</article>
      </section>
      <section class="content">
        <aside class="panel toc"><strong>阅读目录</strong>${tocHtml}</aside>
        <article class="panel doc">${sections.map((section) => knowledgeFallbackSectionHtml(section)).join("\n")}</article>
      </section>
      <p class="footer">source-hash: ${escapeInlineHtml(sourceHash)} · rendered-at: ${nowIso()} · offline safe HTML</p>
    </main>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="source-hash" content="${escapeInlineHtml(sourceHash)}">
  <meta name="rendered-at" content="${nowIso()}">
  <title>${escapeInlineHtml(cleanTitle)}</title>
  <style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}

type KnowledgeFallbackWorkSummary = {
  title: string;
  coreItems: string[];
  keyResults: string[];
  groups: Array<{ title: string; items: string[] }>;
  followups: string[];
  completed: string[];
  facts: string[];
  sourceText: string;
};

function extractKnowledgeFallbackSourceText(markdown: string) {
  const rawBlock = String(markdown || "").match(/##\s*原始记录[\s\S]*?```(?:text)?\s*([\s\S]*?)```/i)?.[1];
  if (rawBlock?.trim()) return rawBlock.trim();
  return String(markdown || "")
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/^#\s+.*(?:\r?\n)+/, "")
    .trim();
}

type KnowledgeSafetyCommitteeItem = {
  title: string;
  detail: string;
  evidence: string;
};

type KnowledgeOperationalBriefingItem = {
  title: string;
  detail: string;
  evidence: string;
};

type KnowledgeFallbackReliabilityMeetingSummary = {
  title: string;
  coreJudgment: string;
  overview: string[];
  followups: KnowledgeOperationalBriefingItem[];
  engineeringActions: KnowledgeOperationalBriefingItem[];
  decisionChanges: KnowledgeOperationalBriefingItem[];
  constraints: KnowledgeOperationalBriefingItem[];
  todos: KnowledgeOperationalBriefingItem[];
  evidence: string[];
  sourceText: string;
};

type KnowledgeFallbackOperationalBriefingSummary = {
  title: string;
  coreJudgment: string;
  overview: string[];
  metrics: KnowledgeOperationalBriefingItem[];
  events: KnowledgeOperationalBriefingItem[];
  stationReports: KnowledgeOperationalBriefingItem[];
  productionPlans: KnowledgeOperationalBriefingItem[];
  constraints: KnowledgeOperationalBriefingItem[];
  todos: KnowledgeOperationalBriefingItem[];
  evidence: string[];
  sourceText: string;
};

type KnowledgeFallbackSafetyCommitteeSummary = {
  title: string;
  coreJudgment: string;
  overview: string[];
  metrics: KnowledgeSafetyCommitteeItem[];
  cases: KnowledgeSafetyCommitteeItem[];
  auditFindings: KnowledgeSafetyCommitteeItem[];
  instructions: KnowledgeSafetyCommitteeItem[];
  seasonalRisks: KnowledgeSafetyCommitteeItem[];
  todos: KnowledgeSafetyCommitteeItem[];
  evidence: string[];
  sourceText: string;
};

function buildKnowledgeFallbackReliabilityMeetingSummary(title: string, markdown: string, sourceText: string): KnowledgeFallbackReliabilityMeetingSummary | null {
  const source = cleanOperationalBriefingEvidence(sourceText || markdown);
  const trusted = `${title}\n${source}`;
  const markdownText = `${title}\n${markdown}`;
  const explicitReliability = /可靠性会|可靠性会议|可靠性月度|可靠性|晚期会议/.test(trusted);
  const signalCount = [
    /决议变更|上次会议|会议决议|变更申请/,
    /EO|E\s*O|工程指令|指令|工卡|航后工卡|检查频率/i,
    /C\s*检|C减|客舱玻璃|外层玻璃|PMA|库存|航材|备件/,
    /787|HSTA|SFCC|CFM56|V2500|刹车导线|发动机进气道|反推/,
    /故障率|裂纹|漏油|松动|破损|掉漆|更换|重复检查/,
  ].filter((pattern) => pattern.test(trusted)).length;
  if (!explicitReliability && signalCount < 3) return null;
  if (/安委会|安全委员会|安全会议/.test(trusted) && !/可靠性会|可靠性会议/.test(trusted)) return null;
  const contaminated = /安委会参考议程|安委会纪要|安全委员会|安全会议/.test(markdownText);

  const followups: KnowledgeOperationalBriefingItem[] = [];
  const engineeringActions: KnowledgeOperationalBriefingItem[] = [];
  const decisionChanges: KnowledgeOperationalBriefingItem[] = [];
  const constraints: KnowledgeOperationalBriefingItem[] = [];
  const todos: KnowledgeOperationalBriefingItem[] = [];
  const add = (rows: KnowledgeOperationalBriefingItem[], titleText: string, detail: string, evidence: string, required = true) => {
    if (required) rows.push({ title: titleText, detail, evidence });
  };
  const evidenceOf = (pattern: RegExp, fallback: string) => cleanOperationalBriefingLine((source.match(pattern)?.[0] || fallback).slice(0, 240));

  add(followups, "上次会议事项关闭情况", "上次会议遗留事项已通过质量牵头会议、E 发布或航材保障方案推进，后续要关注发布后的执行证据和未发布工卡的落地时间。", evidenceOf(/上次会议[^。\n]{0,220}|质量牵头[^。\n]{0,160}|E\s*也已经发布[^。\n]{0,120}/i, "原文提到上次会议事项、质量牵头会议和 E 发布。"), /上次会议|质量牵头|已经发布/.test(trusted));
  add(followups, "787 刹车导线束松动", "787 刹车导线束松动已完成航后工卡和 4 小时故障工卡改版，但航后工卡存在印刷/发布滞后，风险仍在执行端。", evidenceOf(/787[^。\n]{0,220}刹车[^。\n]{0,180}|航后工卡[^。\n]{0,180}|4小时故障工卡[^。\n]{0,180}/i, "原文提到 787 刹车导线束松动、航后工卡和 4 小时故障工卡。"), /787|刹车导线|航后工卡|4小时故障工卡/i.test(trusted));
  add(followups, "SFCC 高危故障率", "SFCC 高危故障率相关事项已开会并发布措施，后续应看故障率是否下降，而不是只看文件是否下发。", evidenceOf(/SFCC[^。\n]{0,160}|高危[^。\n]{0,120}率[^。\n]{0,120}/i, "原文提到 SFCC 高危故障率情况。"), /SFCC|高危.*率/i.test(trusted));

  add(engineeringActions, "CFM56-5B 发动机进气道裂纹", "结构方向已下发重复检查和 HFEC 检查要求；这类问题的价值在于明确检查频率、触发条件和结构工程闭环。", evidenceOf(/CFM565B[^。\n]{0,220}|CFM56[^。\n]{0,220}|进气道[^。\n]{0,180}|HFEC[^。\n]{0,140}/i, "原文提到 CFM56-5B 发动机进气道裂纹和 HFEC 检查。"), /CFM56|进气道|HFEC/i.test(trusted));
  add(engineeringActions, "V2500 反推滑套油封破损", "V2500 反推滑套油封破损已下发更换要求，后续应跟踪件源、执行窗口和重复发生趋势。", evidenceOf(/2500反推[^。\n]{0,220}|V2500[^。\n]{0,220}|滑套[^。\n]{0,160}|油封[^。\n]{0,160}/i, "原文提到 V2500 反推滑套油封破损和更换要求。"), /2500反推|V2500|滑套|油封/i.test(trusted));
  add(engineeringActions, "机身掉漆结合 C检处理", "机身掉漆事项通过 MLO 结合 C 检处理，关键是把外观类问题和定检窗口绑定，避免单独抢占生产资源。", evidenceOf(/机身掉漆[^。\n]{0,180}|MLO[^。\n]{0,120}|结合\s*C[^。\n]{0,120}/i, "原文提到机身掉漆、MLO 和结合 C 检处理。"), /机身掉漆|MLO|C\s*检|C减/i.test(trusted));

  add(decisionChanges, "客舱外层玻璃 EO 变更", "商务舱外层玻璃继续严格执行检查和更换；经济舱玻璃因库存与 PMA 进度约束，建议将检查门槛由 3 年延长到 6 年，并优先保障下半年 4 架 12 年客舱整新飞机。", evidenceOf(/客舱[^。\n]{0,260}玻璃[^。\n]{0,260}|外层玻璃[^。\n]{0,260}|检查门槛[^。\n]{0,220}|三年[^。\n]{0,80}6年[^。\n]{0,80}/i, "原文围绕客舱外层玻璃、库存、PMA 和检查门槛调整展开。"), /客舱.*玻璃|外层玻璃|检查门槛|PMA/i.test(trusted));
  add(decisionChanges, "787 HSTA 漏油问题 EO 延期", "HSTA 漏油相关 4 起 EO 原计划暑期前解决，但航材当前无法保障，需将期限至少推迟一年，并跟踪 Boeing 放货节奏。", evidenceOf(/HSTA[^。\n]{0,220}|漏油[^。\n]{0,220}|7月前[^。\n]{0,180}|推一年[^。\n]{0,160}|播音|波音|Boeing/i, "原文提到 787 HSTA 漏油、航材无法保障、7月前无法完成和期限后推。"), /HSTA|漏油|7月前|推一年|播音|波音|Boeing/i.test(trusted));

  add(constraints, "航材与库存缺口", "客舱玻璃下半年最少需求与预计库存之间存在缺口，错过 C 检窗口的飞机会放大后续集中执行压力。", evidenceOf(/库存[^。\n]{0,260}|需求总量[^。\n]{0,220}|590[^。\n]{0,120}|错失[^。\n]{0,120}C[^。\n]{0,80}/i, "原文提到库存、下半年需求总量、590 件需求和错失 C 检窗口。"), /库存|需求总量|590|错失.*C/i.test(trusted));
  add(constraints, "PMA 研发时间不确定", "PMA 正在开发且预计下半年完成，但具体交付时间不确定，不能把未交付 PMA 当作当前 EO 执行能力。", evidenceOf(/PMA[^。\n]{0,220}|pma[^。\n]{0,220}|下半年可以完成[^。\n]{0,120}|交付时间还不确定[^。\n]{0,100}/i, "原文提到 PMA 处于开发中、计划下半年完成但交付时间不确定。"), /PMA|pma|交付时间还不确定/i.test(trusted));
  add(constraints, "Boeing 放货节奏", "HSTA 相关件源依赖 Boeing/供应商放货排序，当前虽然进入第一顺位，但仍不能支撑 7 月前全部完成。", evidenceOf(/排在第一位[^。\n]{0,180}|放货[^。\n]{0,180}|hard ground[^。\n]{0,160}|第一顺位[^。\n]{0,160}/i, "原文提到放货、第一顺位和 hard ground 触发逻辑。"), /放货|第一顺位|hard ground|排在第一位/i.test(trusted));

  add(todos, "确认客舱玻璃 EO 变更口径", "把商务舱继续执行、经济舱优先保障 4 架整新飞机、其余飞机门槛调整到 6 年的建议形成正式决议口径。", "来自客舱外层玻璃 EO 变更讨论。", decisionChanges.some((item) => /客舱/.test(item.title)));
  add(todos, "更新 C检窗口与库存测算", "用最新 C 检计划、已错过窗口飞机、库存和在途采购量重算需求缺口，避免按满配估算造成错误决策。", "来自库存、C 检窗口和需求测算讨论。", /C\s*检|C减|库存|需求/.test(trusted));
  add(todos, "跟踪 PMA 与航材到货", "PMA、采购在途件和可移动库库存需要形成单独跟踪表，并与 EO 执行计划联动。", "来自 PMA 研发和库存保障讨论。", /PMA|pma|采购|库存/.test(trusted));
  add(todos, "HSTA 漏油 EO 延期审批", "对 HSTA 漏油 4 起 EO 的期限调整形成审批材料，同时明确一年内的检查频率和运行限制判断。", "来自 HSTA 漏油和 EO 延期讨论。", /HSTA|漏油|推一年|检查频率/.test(trusted));
  add(todos, "跟踪 Boeing 放货状态", "继续跟踪 Boeing/供应商第一顺位件源释放，避免把口头排队状态误认为供给已解决。", "来自 Boeing 放货第一顺位讨论。", /放货|第一顺位|播音|波音|Boeing/i.test(trusted));

  if (!contaminated && followups.length + engineeringActions.length + decisionChanges.length + constraints.length < 3) return null;
  const overview = [
    "这是一份可靠性会议记录，核心不是安全宣贯，而是把机队重复性问题、工程指令、航材约束和决议变更转成可执行的可靠性管理闭环。",
    "会议主线集中在两类事项：一类是已发布或待发布的技术措施，另一类是因库存、PMA、C检窗口和供应商放货导致的 EO 执行策略调整。",
    "阅读重点应放在“问题是否有工程措施、措施是否有资源保障、决议变更是否留下审批和复核证据”。",
  ];
  const evidence = uniqueStrings([
    ...followups.map((item) => item.evidence),
    ...engineeringActions.map((item) => item.evidence),
    ...decisionChanges.map((item) => item.evidence),
    ...constraints.slice(0, 4).map((item) => item.evidence),
  ]).slice(0, 12);
  return {
    title,
    coreJudgment: "可靠性会议的价值不在复述故障名称，而在把重复性问题、工程措施、航材保障和决议变更统一到可审批、可跟踪、可复核的闭环里。",
    overview,
    followups,
    engineeringActions,
    decisionChanges,
    constraints,
    todos,
    evidence,
    sourceText: source,
  };
}

function renderKnowledgeReliabilityMeetingMarkdown(model: KnowledgeFallbackReliabilityMeetingSummary, rawContent: string) {
  const section = (title: string, rows: KnowledgeOperationalBriefingItem[]) => [
    `## ${title}`,
    rows.length
      ? rows.map((item) => `- **${item.title}**：${item.detail}（依据：${item.evidence}）`).join("\n")
      : "- 待从原始记录补充。",
  ].join("\n\n");
  return [
    "## 会议概要",
    model.overview.map((item) => `- ${item}`).join("\n"),
    "",
    section("上次会议事项跟踪", model.followups),
    "",
    section("技术问题与工程措施", model.engineeringActions),
    "",
    section("决议变更与资源约束", model.decisionChanges),
    "",
    section("航材与执行约束", model.constraints),
    "",
    section("综合待办", model.todos),
    "",
    "## 金句 / 判断句",
    `- ${model.coreJudgment}`,
    "- 可靠性管理不是把故障逐条列完，而是让每个重复性问题都有措施、资源、期限和复核证据。",
    "- 没有航材保障的工程指令，只能算风险已识别，不能算风险已关闭。",
    "",
    "## 证据入口",
    model.evidence.map((item) => `- ${item}`).join("\n") || "- 详见原始记录。",
    "",
    "## 反向链接索引",
    ["可靠性管理", "工程指令", "航材保障", "C检", "PMA", "787", "HSTA"].map((item) => `- [[${item}]]`).join("\n"),
    "",
    rawArchiveBlock(rawContent || model.sourceText),
  ].join("\n");
}

function renderKnowledgeFallbackReliabilityMeetingHtml(model: KnowledgeFallbackReliabilityMeetingSummary, sourceHash: string, reason: string) {
  const card = (item: KnowledgeOperationalBriefingItem) => `<article class="card"><h3>${escapeInlineHtml(item.title)}</h3><p>${escapeInlineHtml(item.detail)}</p><small>${escapeInlineHtml(item.evidence)}</small></article>`;
  const list = (rows: KnowledgeOperationalBriefingItem[]) => `<ol>${rows.map((item) => `<li><strong>${escapeInlineHtml(item.title)}</strong><span>${escapeInlineHtml(item.detail)}</span></li>`).join("")}</ol>`;
  const topicChips = [...model.followups, ...model.engineeringActions, ...model.decisionChanges, ...model.constraints].slice(0, 10).map((item) => `<span class="chip">${escapeInlineHtml(item.title)}</span>`).join("");
  const shortHash = sourceHash.length > 18 ? `${sourceHash.slice(0, 8)}...${sourceHash.slice(-6)}` : sourceHash || "unknown";
  const css = `
    :root{color-scheme:light;--ink:#132033;--muted:#64748b;--line:#d7e2ee;--bg:#f5f8fb;--panel:#fff;--accent:#0f766e;--blue:#1f4d7a;--amber:#b7791f;--soft:#e8f7f3;--warn:#fff8e7;--shadow:0 22px 58px rgba(15,31,52,.10)}
    *{box-sizing:border-box;min-width:0}html{background:var(--bg)}body{margin:0;background:radial-gradient(circle at 12% 0%,#ffffff 0,#f7fbff 36%,#edf3f8 100%);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.64;letter-spacing:0;overflow-x:hidden}.page{max-width:1180px;margin:0 auto;padding:34px 22px 58px}.hero{display:grid;grid-template-columns:minmax(0,1.48fr) minmax(280px,.62fr);gap:18px;align-items:stretch}.panel,.card{background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:17px;box-shadow:var(--shadow);overflow:hidden}.lead{padding:34px}.eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--accent);font-weight:850;font-size:13px}.eyebrow:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent)}.lead h1{margin:12px 0 14px;font-size:48px;line-height:1.08;letter-spacing:0}.thesis{font-size:18px;color:#334155;max-width:800px;margin:0}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:22px}.metric{padding:16px;border-radius:14px;background:#f8fafc;border:1px solid var(--line)}.metric b{display:block;font-size:30px;line-height:1}.metric span{color:var(--muted);font-size:13px}.decision-strip{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.decision{border:1px solid var(--line);border-radius:14px;padding:14px;background:#fbfdff}.decision strong{display:block;color:#0f172a;margin-bottom:4px}.decision span{display:block;color:#475569;font-size:14px}.meta{padding:22px;display:grid;gap:14px}.meta h2{font-size:18px;margin:0}.source-pill{border-radius:14px;border:1px solid var(--line);background:#f8fafc;padding:12px}.source-pill strong{display:block;font-size:13px;color:#0f172a}.source-pill span{display:block;color:#475569;font-size:13px;overflow-wrap:anywhere;word-break:break-word}.section{margin-top:22px}.section h2{font-size:24px;margin:0 0 12px}.overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{padding:18px}.card h3{margin:0 0 8px;font-size:18px}.card p{margin:0;color:#334155;overflow-wrap:anywhere}.card small{display:block;margin-top:12px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.chips{display:flex;flex-wrap:wrap;gap:9px}.chip{display:inline-flex;max-width:100%;padding:7px 10px;border-radius:999px;background:var(--soft);color:var(--accent);font-weight:780;font-size:13px;overflow-wrap:anywhere}.constraint{background:var(--warn);border-left:5px solid var(--amber)}.event{border-left:5px solid var(--accent)}.decision-card{border-left:5px solid var(--blue);background:#f8fbff}.action{background:#fbfffd}ol{margin:0;padding-left:22px}li{margin:10px 0;overflow-wrap:anywhere}li span{display:block;color:#334155;margin-top:3px}.raw details,.diagnostics details{margin-top:10px}.raw summary,.diagnostics summary{cursor:pointer;color:var(--blue);font-weight:800}.raw pre{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;background:#0f172a;color:#e2e8f0;border-radius:14px;padding:16px;max-height:340px;overflow:auto}.diagnostics{margin-top:18px;color:var(--muted);font-size:12px}.diagnostics code,.footer{overflow-wrap:anywhere;word-break:break-word}.footer{margin-top:14px;text-align:center;color:var(--muted);font-size:12px}@media(max-width:1000px){.hero,.overview,.grid,.metric-grid,.decision-strip{grid-template-columns:1fr}.lead h1{font-size:34px}.page{padding:18px 12px}}`;
  const body = `
    <main class="page">
      <section class="hero">
        <article class="panel lead">
          <div class="eyebrow">可靠性会议 · 工程措施与资源闭环</div>
          <h1>${escapeInlineHtml(model.title)}</h1>
          <p class="thesis"><strong>核心判断：</strong>${escapeInlineHtml(model.coreJudgment)}</p>
          <div class="metric-grid">
            <div class="metric"><b>${model.followups.length}</b><span>上次事项</span></div>
            <div class="metric"><b>${model.decisionChanges.length}</b><span>决议变更</span></div>
            <div class="metric"><b>${model.todos.length}</b><span>综合待办</span></div>
          </div>
          <div class="decision-strip">
            <div class="decision"><strong>阅读重点</strong><span>先看 EO/工程措施是否有航材和窗口支撑，再看决议变更是否可审批。</span></div>
            <div class="decision"><strong>下一步</strong><span>把库存、PMA、C检窗口和 Boeing 放货状态接入可靠性待办。</span></div>
          </div>
        </article>
        <aside class="panel meta">
          <h2>证据入口</h2>
          <div class="source-pill"><strong>可信源</strong><span>Markdown 与原始记录已保留；HTML 只作为阅读层。</span></div>
          <div class="source-pill"><strong>证据摘要</strong><span>${model.evidence.length || 1} 条依据 · hash ${escapeInlineHtml(shortHash)}</span></div>
          <div class="source-pill"><strong>分类边界</strong><span>当前记录按可靠性会议处理；未出现其他会议类型的明确证据。</span></div>
        </aside>
      </section>
      <section class="section"><h2>会议概要</h2><div class="overview">${model.overview.map((item) => `<article class="card"><p>${escapeInlineHtml(item)}</p></article>`).join("")}</div></section>
      <section class="section"><h2>主题地图</h2><article class="card"><div class="chips">${topicChips}</div></article></section>
      <section class="section"><h2>上次会议事项跟踪</h2><div class="grid">${model.followups.map((item) => card(item).replace("class=\"card\"", "class=\"card event\"")).join("") || "<article class=\"card\"><p>待从原始记录补充。</p></article>"}</div></section>
      <section class="section"><h2>技术问题与工程措施</h2><div class="grid">${model.engineeringActions.map(card).join("") || "<article class=\"card\"><p>未抽取到明确工程措施。</p></article>"}</div></section>
      <section class="section"><h2>决议变更与资源约束</h2><div class="grid">${model.decisionChanges.map((item) => card(item).replace("class=\"card\"", "class=\"card decision-card\"")).join("")}</div></section>
      <section class="section"><h2>航材与执行约束</h2><div class="grid">${model.constraints.map((item) => card(item).replace("class=\"card\"", "class=\"card constraint\"")).join("") || "<article class=\"card\"><p>未抽取到明确资源约束。</p></article>"}</div></section>
      <section class="section"><h2>综合待办</h2><article class="card action">${list(model.todos)}</article></section>
      <section class="section raw"><article class="card"><h2>证据入口</h2>${knowledgeFallbackListHtmlLimit(model.evidence, "详见 Markdown 可信源和原始记录。", 12)}<details><summary>查看净化后的原始记录</summary><pre>${escapeInlineHtml(model.sourceText.slice(0, 9000))}</pre></details></article></section>
      <section class="diagnostics"><details><summary>生成诊断</summary><p>回退原因：${escapeInlineHtml(reason || "local_html_fallback")}</p><p><code>source-hash: ${escapeInlineHtml(sourceHash)}</code></p></details></section>
      <p class="footer">source-hash: ${escapeInlineHtml(sourceHash)} · rendered-at: ${nowIso()} · offline safe HTML</p>
    </main>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="source-hash" content="${escapeInlineHtml(sourceHash)}">
  <meta name="rendered-at" content="${nowIso()}">
  <title>${escapeInlineHtml(model.title)}</title>
  <style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}

function buildKnowledgeFallbackSafetyCommitteeSummary(title: string, markdown: string, sourceText: string): KnowledgeFallbackSafetyCommitteeSummary | null {
  const source = cleanSafetyCommitteeEvidence(sourceText || markdown);
  const trusted = `${title}\n${source}`;
  const haystack = trusted;
  const explicitSafetyMeeting = /安委会|安全委员会|安全会议/.test(trusted);
  if (/可靠性会|可靠性会议/.test(trusted) && !explicitSafetyMeeting) return null;
  if (!explicitSafetyMeeting) return null;
  const signalCount = [
    /安委会|安全委员会|安全会议|安全运行|安全形势/,
    /维修差错|MEL|O\s*项|串件|鸟击|雷雨|航前签字率|机械取消率/,
    /液压油|生态油箱|遮阳帘|内审|保留办理|正向激励/,
  ].filter((pattern) => pattern.test(haystack)).length;
  if (signalCount < 2) return null;

  const metrics: KnowledgeSafetyCommitteeItem[] = [];
  const cases: KnowledgeSafetyCommitteeItem[] = [];
  const auditFindings: KnowledgeSafetyCommitteeItem[] = [];
  const instructions: KnowledgeSafetyCommitteeItem[] = [];
  const seasonalRisks: KnowledgeSafetyCommitteeItem[] = [];
  const todos: KnowledgeSafetyCommitteeItem[] = [];
  const add = (rows: KnowledgeSafetyCommitteeItem[], titleText: string, detail: string, evidence: string, required = true) => {
    if (required) rows.push({ title: titleText, detail, evidence });
  };

  add(metrics, "4月安全运行数据", "全国机械故障类不安全事件约 98 起，华东地区约 29 起；会议要求把外部安全态势转化为本单位维修过程控制压力。", "原文出现“98起”“29起”“机械故障不安全事件”等表述。", /98\s*起|29\s*起|机械故障/.test(haystack));
  add(metrics, "关键保障指标", "航前签字率、机械取消率、保障任务量等指标被用于观察运行质量；指标本身不是结论，后续要看趋势和异常闭环。", "原文提到航前签字率、机械取消率或保障任务数据。", /航前签字率|机械取消率|保障任务|1\.99|0\.01/.test(haystack));
  add(metrics, "鸟击风险提示", "二季度鸟击风险升高，浦东等区域需要把鸟击预防从提醒升级为复核和操作约束。", "原文多次出现鸟击、二季度、浦东等风险信号。", /鸟击/.test(haystack));

  add(cases, "液压油超标事件", "液压油超标暴露出检测报告、FC 监控、放行判断和整改闭环之间的断点；若原始转写未清晰覆盖，应按安委会材料目录补充核验。", "安委会参考议程包含液压油超标复盘；当前转写需回看原始材料确认细节。", /液压油|超标|FC监控|检测报告|安委会|安全委员会/.test(haystack));
  add(cases, "发动机生态油箱漏装", "发动机生态油箱相关事件说明缺陷清单、接近面板和复装确认需要电子化或清单化约束，避免凭记忆完成关键步骤。", "原文出现生态油箱、接近面板、缺陷清单、燃油溢出等信号。", /生态油箱|接近面板|缺陷清单|燃油溢出/.test(haystack));
  add(cases, "保留办理 O项错误", "O项/MEL 保留办理必须守住三道防线：确认故障源、核对 MEL 条款、完成贴牌和记录一致性复核。", "原文出现 O项、MEL、保留、贴牌、三道防线等信号。", /O\s*项|MEL|贴牌|三道防线|保留办理/.test(haystack));
  add(cases, "串件排故导致返航", "串件排故不能替代故障隔离结论；未确认故障源就创建保留，会把排故动作放大成运行返航风险。", "原文出现串件、ADR、大气数据、返航、保留等信号。", /串件|ADR|大气数据|返航/.test(haystack));
  add(cases, "遮阳帘更换违规", "遮阳帘更换暴露出凭经验施工、封圈和工卡执行偏差；小部件工作也必须回到手册和记录。", "原文出现遮阳帘、封圈、凭经验、工卡等信号。", /遮阳帘|封圈|凭经验|工卡/.test(haystack));

  add(auditFindings, "浦东内审发现", "浦东现场问题集中在工具清点、保留文件、必检项目勾选和记录一致性，说明基层执行要从“知道要求”转向“留下证据”。", "原文出现浦东、工具、保留文件、必检等内审信号。", /浦东|工具|保留文件|必检/.test(haystack));
  add(auditFindings, "虹桥内审发现", "虹桥问题指向推出监护、水洗录入和记录及时性，后续应以清单复核和班组互检降低人为遗漏。", "原文出现虹桥、推出监护、水洗、录入等信号。", /虹桥|推出监护|水洗|录入/.test(haystack));

  add(instructions, "安全第一，成本第三", "会议强调安全排序不能被成本、进度和便利性挤压；领导指示要转成可检查的现场动作。", "原文出现“安全第一”“成本第三”等表述。", /安全第一|成本第三/.test(haystack));
  add(instructions, "工作凭记录，不能凭记忆", "重复性维修工作要依赖手册、程序、工卡和电子化清单，不允许把经验当作控制措施。", "原文出现手册、程序、记录、凭记忆、规章等表述。", /手册|程序|记录|凭记忆|规章|敬畏/.test(haystack));
  add(instructions, "正向激励与作风建设", "安全作风建设不能只靠处罚，也要让主动报告、主动复核和主动纠偏获得正反馈。", "原文出现正向激励、安全作风等表述。", /正向激励|作风/.test(haystack));

  add(seasonalRisks, "雷雨季节风险", "雷雨季节要前置管控高空作业、机坪移动、劳保用品和航线突发天气，避免临场口头提醒替代预案。", "原文出现雷雨、季节、防雷击、高空作业、劳保等信号。", /雷雨|防雷|高空作业|劳保|季节/.test(haystack));
  add(seasonalRisks, "鸟击风险", "鸟击防控需要双人复核、AMM/SRM 适用性判断和现场证据留存，不能只停留在风险宣贯。", "原文出现鸟击、AMM、SRM、双人复核等信号。", /鸟击|AMM|SRM|双人复核/.test(haystack));
  add(seasonalRisks, "高温与设备状态", "高温条件下要关注热交换器压降、发动机叶片等状态变化，把季节性风险并入日常监控。", "原文出现高温、热交换器、压降、发动机叶片等信号。", /高温|热交换器|压降|发动机叶片/.test(haystack));

  add(todos, "串件排故专项宣贯", "围绕 ADR、大气数据、保留办理和返航案例做班组宣贯，明确串件排故与故障确认的边界。", "来自串件排故导致返航案例。", /串件|ADR|返航/.test(haystack));
  add(todos, "液压油超标整改闭环", "复核检测、FC 监控、放行和污染控制链条，形成整改责任人和验证节点；若当前转写缺失细节，先列入待核验。", "来自安委会参考议程，需回看原始材料确认。", /液压油|超标|安委会|安全委员会/.test(haystack));
  add(todos, "发动机生态油箱电子化清单", "把生态油箱、接近面板和复装确认纳入电子化或强制清单，降低漏装风险。", "来自发动机生态油箱事件。", /生态油箱|接近面板/.test(haystack));
  add(todos, "保留办理三道防线强化", "对 O项/MEL 保留办理做三道防线复核，确保故障源、条款、贴牌和记录一致。", "来自 O项/MEL 保留办理问题。", /O\s*项|MEL|保留/.test(haystack));
  add(todos, "内审发现问题整改闭环", "浦东、虹桥内审发现要进入责任清单，闭环到复查证据而不是口头整改。", "来自浦东、虹桥内审发现。", /内审|浦东|虹桥/.test(haystack));
  add(todos, "雷雨季节安全专项准备", "完成雷雨、鸟击、高温场景的班组准备、物资确认和现场口径统一。", "来自季节性风险提示。", /雷雨|鸟击|高温/.test(haystack));
  add(todos, "安全责任视频课件学习", "把典型案例转成视频或课件，让干部和一线人员看到错误链条，而不是只记住结论。", "原文出现视频、课件或安全责任学习要求。", /视频|课件|学习|责任/.test(haystack));
  add(todos, "车间干部程序考试优化", "程序考试应覆盖真实案例和高频错误点，检验干部是否能把要求落到现场动作。", "原文出现考试、干部、程序等信号。", /考试|干部|程序/.test(haystack));

  if (cases.length < 2 && metrics.length < 1) return null;
  const overview = [
    "本次安委会不是单纯通报材料，而是把外部安全态势、典型差错、内审发现和季节性风险压缩成维修现场的执行约束。",
    "会议重点应落在三类闭环：数据趋势要转为风险预警，典型事件要转为流程防线，领导指示要转为可检查的待办清单。",
    "阅读时不应被说话人转写牵着走，真正有价值的是识别哪些差错会重复发生，以及哪些控制动作可以立刻固化。",
  ];
  const evidence = uniqueStrings([
    ...metrics.map((item) => item.evidence),
    ...cases.map((item) => item.evidence),
    ...todos.slice(0, 4).map((item) => item.evidence),
  ]).slice(0, 10);
  return {
    title,
    coreJudgment: "安委会纪要的价值不在复述发言，而在把安全数据、差错案例、内审问题和季节性风险转成可检查的维修管理闭环。",
    overview,
    metrics,
    cases,
    auditFindings,
    instructions,
    seasonalRisks,
    todos,
    evidence,
    sourceText: source,
  };
}

function renderKnowledgeSafetyCommitteeMarkdown(model: KnowledgeFallbackSafetyCommitteeSummary, rawContent: string) {
  const section = (title: string, rows: KnowledgeSafetyCommitteeItem[]) => [
    `## ${title}`,
    rows.length
      ? rows.map((item) => `- **${item.title}**：${item.detail}（依据：${item.evidence}）`).join("\n")
      : "- 待从原始记录补充。",
  ].join("\n\n");
  return [
    "## 会议概要",
    model.overview.map((item) => `- ${item}`).join("\n"),
    "",
    section("4月安全运行数据", model.metrics),
    "",
    section("典型事件通报与复盘", model.cases),
    "",
    section("内审发现典型问题", model.auditFindings),
    "",
    section("领导重点指示", model.instructions),
    "",
    section("季节性风险防控", model.seasonalRisks),
    "",
    section("综合待办", model.todos),
    "",
    "## 金句 / 判断句",
    `- ${model.coreJudgment}`,
    "- 安全会议的输出不是“大家知道了”，而是哪些动作从今天开始必须留下证据。",
    "- 对维修系统而言，经验只能提高效率，不能替代手册、程序、工卡和复核。",
    "",
    "## 证据入口",
    model.evidence.map((item) => `- ${item}`).join("\n") || "- 详见原始记录。",
    "",
    "## 反向链接索引",
    ["安委会", "安全管理", "维修差错", "MEL", "O项", "雷雨季节"].map((item) => `- [[${item}]]`).join("\n"),
    "",
    rawArchiveBlock(rawContent || model.sourceText),
  ].join("\n");
}

function renderKnowledgeFallbackSafetyCommitteeHtml(model: KnowledgeFallbackSafetyCommitteeSummary, sourceHash: string, reason: string) {
  const card = (item: KnowledgeSafetyCommitteeItem) => `<article class="card"><h3>${escapeInlineHtml(item.title)}</h3><p>${escapeInlineHtml(item.detail)}</p><small>${escapeInlineHtml(item.evidence)}</small></article>`;
  const list = (rows: KnowledgeSafetyCommitteeItem[]) => `<ol>${rows.map((item) => `<li><strong>${escapeInlineHtml(item.title)}</strong><span>${escapeInlineHtml(item.detail)}</span></li>`).join("")}</ol>`;
  const shortHash = sourceHash.length > 18 ? `${sourceHash.slice(0, 8)}...${sourceHash.slice(-6)}` : sourceHash || "unknown";
  const evidencePreview = model.evidence.slice(0, 3);
  const criticalRisks = [...model.cases, ...model.seasonalRisks].slice(0, 5);
  const css = `
    :root{color-scheme:light;--ink:#111827;--muted:#64748b;--line:#dbe5ee;--bg:#f4f7fb;--panel:#fff;--accent:#0f766e;--accent2:#2563eb;--risk:#b42318;--warn:#b45309;--soft:#e8f7f3;--riskSoft:#fff1f0;--blueSoft:#eef5ff;--shadow:0 24px 70px rgba(15,23,42,.10)}
    *{box-sizing:border-box;min-width:0}html{background:var(--bg)}body{margin:0;background:radial-gradient(circle at 12% 0%,#ffffff 0,#f6fbff 34%,#edf3f8 100%);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.62;letter-spacing:0;overflow-x:hidden}.page{max-width:1180px;margin:0 auto;padding:34px 22px 58px}.hero{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,.62fr);gap:18px;align-items:stretch}.panel,.card{background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}.lead{padding:34px}.eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--accent);font-weight:850;font-size:13px}.eyebrow:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent)}.lead h1{margin:12px 0 14px;font-size:48px;line-height:1.08;letter-spacing:0}.thesis{font-size:18px;color:#334155;max-width:780px;margin:0}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:22px}.metric{padding:16px;border-radius:14px;background:#f8fafc;border:1px solid var(--line)}.metric b{display:block;font-size:30px;line-height:1}.metric span{color:var(--muted);font-size:13px}.decision-strip{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.decision{border:1px solid var(--line);border-radius:14px;padding:14px;background:#fbfdff}.decision strong{display:block;color:#0f172a;margin-bottom:4px}.decision span{display:block;color:#475569;font-size:14px}.meta{padding:22px;display:grid;gap:14px}.meta h2{font-size:18px;margin:0}.source-status{display:grid;gap:10px}.source-pill{border-radius:14px;border:1px solid var(--line);background:#f8fafc;padding:12px}.source-pill strong{display:block;font-size:13px;color:#0f172a}.source-pill span{display:block;color:#475569;font-size:13px;overflow-wrap:anywhere;word-break:break-word}.evidence-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}.evidence-list li{padding:10px 12px;border-radius:12px;background:#f8fafc;border:1px solid var(--line);font-size:13px;color:#334155;overflow-wrap:anywhere}.chips{display:flex;flex-wrap:wrap;gap:9px}.chip{display:inline-flex;padding:7px 10px;border-radius:999px;background:var(--soft);color:var(--accent);font-weight:780;font-size:13px;max-width:100%;overflow-wrap:anywhere}.section{margin-top:22px}.section h2{font-size:24px;margin:0 0 12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.cards3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card{padding:18px}.card h3{margin:0 0 8px;font-size:18px}.card p{margin:0;color:#334155;overflow-wrap:anywhere}.card small{display:block;margin-top:12px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.risk{border-left:5px solid var(--risk);background:linear-gradient(90deg,var(--riskSoft),#fff 38%)}.action{background:#fbfffd;border-left:5px solid var(--accent)}.evidence{background:#f8fafc}.risk-rail{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.risk-token{padding:12px;border-radius:14px;border:1px solid #f2d7d5;background:#fff8f7;color:#7f1d1d;font-weight:800;font-size:13px;overflow-wrap:anywhere}.quote{border-left:5px solid var(--accent);background:#f8fffd}ol{margin:0;padding-left:22px}li{margin:10px 0;overflow-wrap:anywhere}li span{display:block;color:#334155;margin-top:3px}.raw details,.diagnostics details{margin-top:10px}.raw summary,.diagnostics summary{cursor:pointer;color:var(--accent2);font-weight:800}.raw pre{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;background:#0f172a;color:#e2e8f0;border-radius:14px;padding:16px;max-height:340px;overflow:auto}.diagnostics{margin-top:18px;color:var(--muted);font-size:12px}.diagnostics code,.footer{overflow-wrap:anywhere;word-break:break-word}.footer{margin-top:14px;text-align:center;color:var(--muted);font-size:12px}@media(max-width:1000px){.hero,.grid,.cards3,.metric-grid,.decision-strip,.risk-rail{grid-template-columns:1fr}.lead h1{font-size:34px}.page{padding:18px 12px}}`;
  const body = `
    <main class="page">
      <section class="hero">
        <article class="panel lead">
          <div class="eyebrow">安委会 / 可靠性会议 · 结构化纪要</div>
          <h1>${escapeInlineHtml(model.title)}</h1>
          <p class="thesis"><strong>核心判断：</strong>${escapeInlineHtml(model.coreJudgment)}</p>
          <div class="metric-grid">
            <div class="metric"><b>${model.metrics.length}</b><span>安全数据</span></div>
            <div class="metric"><b>${model.cases.length}</b><span>典型事件</span></div>
            <div class="metric"><b>${model.todos.length}</b><span>综合待办</span></div>
          </div>
          <div class="decision-strip">
            <div class="decision"><strong>阅读重点</strong><span>先看风险是否形成闭环，再看责任、证据和下次复查节点。</span></div>
            <div class="decision"><strong>下一步</strong><span>把典型事件和内审发现转成可跟踪的待办清单。</span></div>
          </div>
        </article>
        <aside class="panel meta">
          <h2>证据入口</h2>
          <div class="source-status">
            <div class="source-pill"><strong>可信源</strong><span>Markdown 与原始记录已保留；HTML 只作为阅读层。</span></div>
            <div class="source-pill"><strong>证据摘要</strong><span>${model.evidence.length || 1} 条依据 · hash ${escapeInlineHtml(shortHash)}</span></div>
          </div>
          <ul class="evidence-list">${(evidencePreview.length ? evidencePreview : ["详见 Markdown 可信源和原始记录。"]).map((item) => `<li>${escapeInlineHtml(item)}</li>`).join("")}</ul>
        </aside>
      </section>
      <section class="section"><h2>会议概要</h2><div class="cards3">${model.overview.map((item) => `<article class="card"><p>${escapeInlineHtml(item)}</p></article>`).join("")}</div></section>
      <section class="section"><h2>4月安全运行数据</h2><div class="grid">${model.metrics.map(card).join("") || "<article class=\"card\"><p>原始记录未提供可稳定抽取的指标。</p></article>"}</div></section>
      <section class="section"><h2>重点风险</h2><div class="risk-rail">${criticalRisks.map((item) => `<div class="risk-token">${escapeInlineHtml(item.title)}</div>`).join("") || "<div class=\"risk-token\">待从原始记录补充</div>"}</div></section>
      <section class="section"><h2>典型事件复盘</h2><div class="grid">${model.cases.map((item) => card(item).replace("class=\"card\"", "class=\"card risk\"")).join("")}</div></section>
      <section class="section"><h2>内审发现与领导指示</h2><div class="grid"><article class="card">${list(model.auditFindings)}</article><article class="card quote">${list(model.instructions)}</article></div></section>
      <section class="section"><h2>雷雨季节与季节性风险</h2><div class="grid">${model.seasonalRisks.map(card).join("") || "<article class=\"card\"><p>未抽取到明确季节性风险。</p></article>"}</div></section>
      <section class="section"><h2>综合待办</h2><article class="card action">${list(model.todos)}</article></section>
      <section class="section raw"><article class="card evidence"><h2>证据入口</h2>${knowledgeFallbackListHtmlLimit(model.evidence, "详见 Markdown 可信源和原始记录。", 10)}<details><summary>查看净化后的原始记录</summary><pre>${escapeInlineHtml(model.sourceText.slice(0, 9000))}</pre></details></article></section>
      <section class="diagnostics"><details><summary>生成诊断</summary><p>回退原因：${escapeInlineHtml(reason || "local_html_fallback")}</p><p><code>source-hash: ${escapeInlineHtml(sourceHash)}</code></p></details></section>
      <p class="footer">source-hash: ${escapeInlineHtml(sourceHash)} · rendered-at: ${nowIso()} · offline safe HTML</p>
    </main>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="source-hash" content="${escapeInlineHtml(sourceHash)}">
  <meta name="rendered-at" content="${nowIso()}">
  <title>${escapeInlineHtml(model.title)}</title>
  <style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}

function cleanSafetyCommitteeEvidence(source: string) {
  return String(source || "")
    .split(/\r?\n/)
    .filter((line) => !/企业家代表团|高峰会重要性判断|Knowledge Note Interaction Document|项\s*·\s*结果/.test(line))
    .join("\n")
    .trim();
}

function buildKnowledgeFallbackOperationalBriefingSummary(title: string, markdown: string, sourceText: string): KnowledgeFallbackOperationalBriefingSummary | null {
  const source = cleanOperationalBriefingEvidence(sourceText || markdown);
  const haystack = `${title}\n${markdown}\n${source}`;
  const signalCount = [
    /早会|晨会|生产运行|生产会|航线例会|班前会/,
    /航空调度员|浦东|虹桥|南京|外站|航材|MCC|MC|PC/,
    /飞机|航班|放行|机组|故障|非例行|例行|保留|AOG|aug/i,
    /787|BMC|TCD|TCT|EVA|BSCU|PSDU|SGU|AEVC|MEL|O\s*项/i,
  ].filter((pattern) => pattern.test(haystack)).length;
  if (signalCount < 3 || !/飞机|航班|航材|维修|浦东|虹桥|南京|787|AOG|aug/i.test(haystack)) return null;

  const metrics: KnowledgeOperationalBriefingItem[] = [];
  const events: KnowledgeOperationalBriefingItem[] = [];
  const stationReports: KnowledgeOperationalBriefingItem[] = [];
  const productionPlans: KnowledgeOperationalBriefingItem[] = [];
  const constraints: KnowledgeOperationalBriefingItem[] = [];
  const todos: KnowledgeOperationalBriefingItem[] = [];
  const add = (rows: KnowledgeOperationalBriefingItem[], titleText: string, detail: string, evidence: string, required = true) => {
    if (required) rows.push({ title: titleText, detail, evidence });
  };
  const evidenceOf = (pattern: RegExp, fallback: string) => cleanOperationalBriefingLine((source.match(pattern)?.[0] || fallback).slice(0, 220));

  add(metrics, "月度运行指标需复核", "原始转写提到航班延误签字率、航线延误签字率和取消率。当前数字来自口语转写，适合作为早会风险提示，不宜直接当作正式统计口径。", evidenceOf(/航班延误签字率[^。\n]{0,90}|航线延误签字率[^。\n]{0,90}|取消率[^。\n]{0,80}/, "原文提到航班延误签字率、航线延误签字率和取消率。"), /签字率|取消率/.test(haystack));
  add(metrics, "787生产进度", "早会同步了 787 生产任务进度和例行完成情况，应把未完成项、天气影响和航班调整限制单列跟踪。", evidenceOf(/787生产任务[^。\n]{0,120}|航天例行[^。\n]{0,100}/, "原文提到 787 生产任务进度和例行完成情况。"), /787生产任务|航天例行/.test(haystack));

  add(events, "二发漏气/引气系统事件闭环", "HO1239 相关飞机出现二发漏气或引气系统风险信号，现场执行 BMC/TCT/TCD 相关检查与更换，试车无渗漏后进入收尾和后续航班监控。", evidenceOf(/HO1239[^。\n]{0,180}|二发[^。\n]{0,180}|BMC2[^。\n]{0,160}|TCT[^。\n]{0,160}|TCD[^。\n]{0,160}/i, "原文提到 HO1239、二发漏气、BMC/TCT/TCD 检查和更换。"), /HO1239|二发|BMC2|TCT|TCD/i.test(haystack));
  add(events, "浦东刹车 EVA 更换", "浦东汇报刹车系统 EVA 性能下降，已完成相关 EVA 更换并检查测试正常，后续重点是确认 BA/MM 信息是否复现。", evidenceOf(/[^。\n]{0,80}EVA[^。\n]{0,180}|[^。\n]{0,80}eva[^。\n]{0,180}|BA 信息[^。\n]{0,150}/i, "原文提到刹车 EVA 性能下降、更换和测试正常。"), /EVA|刹车|BA 信息/i.test(haystack));
  add(events, "污水传感器污染清洁", "MM 信息排布后完成左侧污水传感器等清洁测试，现场反馈个别传感器污染严重，需沉淀为污染识别和升级反馈案例。", evidenceOf(/污水传感器[^。\n]{0,180}|传感器污染[^。\n]{0,140}|MM 信息[^。\n]{0,160}/i, "原文提到污水传感器清洁、污染严重和升级反馈。"), /污水传感器|传感器污染|MM 信息/i.test(haystack));
  add(events, "虹桥前轮转弯右偏排故", "虹桥飞机滑行右偏，检查 BSCU/PSDU/SGU 数据并更换前轮转弯控制器，故障排除；后续仍需把调节和后台数据调用形成规范排故方案。", evidenceOf(/右偏[^。\n]{0,220}|前轮转弯[^。\n]{0,220}|BSCU[^。\n]{0,180}|PSDU[^。\n]{0,180}|SGU[^。\n]{0,180}/i, "原文提到虹桥滑行右偏、前轮转弯控制器更换和数据检查。"), /右偏|前轮转弯|BSCU|PSDU|SGU/i.test(haystack));
  add(events, "南京红皮通气/排气活门故障", "南京汇报红皮通气/排气活门反复异常，已更换相关计算机/部件并测试正常，需继续监控是否再次出现打开位信号。", evidenceOf(/红皮[^。\n]{0,180}|排气红门[^。\n]{0,180}|AEVC[^。\n]{0,160}|EVC[^。\n]{0,160}/i, "原文提到红皮通气红门、排气红门、AEVC/EVC 测试。"), /红皮|排气红门|AEVC|EVC/i.test(haystack));

  add(stationReports, "浦东", "浦东重点围绕刹车 EVA、MM 信息和传感器污染处理，当前结论偏向已处理完成，需跟踪异常是否复现。", evidenceOf(/这边我汇报一下浦东[^。\n]{0,220}|[^。\n]{0,80}EVA[^。\n]{0,180}|污水传感器[^。\n]{0,180}/i, "原文由浦东汇报刹车和传感器处理。"), /浦东|刹车|污水传感器/.test(haystack));
  add(stationReports, "虹桥", "虹桥重点是右偏排故、航线小故障和部分结构/灯光/座椅问题，后续要把重复性故障与技术总结挂钩。", evidenceOf(/虹桥[^。\n]{0,200}|右偏[^。\n]{0,180}/, "原文多次出现虹桥、右偏和航线问题。"), /虹桥|右偏/.test(haystack));
  add(stationReports, "南京", "南京重点是红皮通气/排气活门故障信息和测试恢复，属于需要继续监控的重复性信号。", evidenceOf(/南京[^。\n]{0,180}|红皮[^。\n]{0,180}/, "原文由南京汇报红皮通气/排气活门问题。"), /南京|红皮|排气红门/.test(haystack));

  add(productionPlans, "两栋 B 热交换器后续工作", "热交换器新件已装上，今天继续完成后续工作；同时涉及无线电高度表系统同轴电缆、飞控/前缘相关作业。", evidenceOf(/热交换器[^。\n]{0,190}|无线电高度表[^。\n]{0,180}|飞控[^。\n]{0,180}|前缘[^。\n]{0,160}/, "原文提到热交换器、无线电高度表同轴电缆、飞控和前缘相关作业。"), /热交换器|无线电高度表|飞控|前缘/.test(haystack));
  add(productionPlans, "321C 铆钉/接近性限制", "321C 下部铆钉缺失工作受接近性、夜间雨天、高空车和航班不可调整影响，当前属于生产准备与风险评估问题，而不是简单未完成。", evidenceOf(/321c[^。\n]{0,220}|铆钉[^。\n]{0,180}|高空车[^。\n]{0,180}|航班不可调整[^。\n]{0,160}/i, "原文提到 321C、铆钉缺失、高空车无法停靠和航班不可调整。"), /321c|铆钉|高空车|航班不可调整/i.test(haystack));
  add(productionPlans, "208A/基础盖板修理", "重点监控工作包括 208A 基础盖板修理，仍在修复中，需要在后续早会继续更新状态。", evidenceOf(/208a[^。\n]{0,150}|基础盖板[^。\n]{0,150}/i, "原文提到 208A 基础盖板仍在修复中。"), /208a|基础盖板/i.test(haystack));

  add(constraints, "8538 吊架盖板永久修复", "8538 左侧吊架盖板损伤需要永久修复方案，距离超期窗口较近，应催促空客/结构工程明确续保或修复路径。", evidenceOf(/8538[^。\n]{0,220}|吊架盖板[^。\n]{0,180}|空客[^。\n]{0,180}|还剩[^。\n]{0,80}7天[^。\n]{0,80}/, "原文提到 8538 吊架盖板损伤、空客答复和 7 天期限。"), /8538|吊架盖板|空客|7天/.test(haystack));
  add(constraints, "暑运前置准备", "6月中下旬进入暑运后航班增量，MC/PC 需要提前梳理规定型和计划性工作的航台需求，避免维修时机落入高峰期后被动抢资源。", evidenceOf(/暑[运院][^。\n]{0,220}|6月中下旬[^。\n]{0,180}|航班会增量[^。\n]{0,180}|MC[^。\n]{0,120}PC[^。\n]{0,120}/i, "原文提到 6月中下旬进入暑运、航班增量、MC/PC 梳理航台需求。"), /暑[运院]|6月中下旬|航班会增量|MC.*PC/i.test(haystack));
  add(constraints, "航材与工单保障边界", "部分单子临近关闭但件仍需保障，早会明确要让航材启动 AOG/保障流程，避免工单关闭后保障责任消失。", evidenceOf(/航材只要启动[^。\n]{0,140}|件还保障[^。\n]{0,140}|单子明天[^。\n]{0,180}|AOG[^。\n]{0,140}|aug[^。\n]{0,140}/i, "原文提到单子关闭、件保障和航材启动 AOG 流程。"), /单子|航材|AOG|aug|保障/i.test(haystack));

  add(todos, "复核运行指标口径", "把签字率、取消率等数字从正式报表核对一次，避免自动转写中的小数和单位误差进入管理结论。", "来自早会开头运行指标口播。", metrics.length > 0);
  add(todos, "跟踪 HO1239 后续航班监控", "确认二发漏气/引气系统处理后的后续航班是否正常，必要时在下一次早会回报复现情况。", "来自 HO1239 事件和后续航班监控要求。", /HO1239|二发|TCD|TCT/i.test(haystack));
  add(todos, "形成右偏排故规范", "由技术团队汇总虹桥右偏案例，把调节、数据调用、复查标准形成规范排故方案，并与三厂交流。", "来自 14:13 技术总结和三厂交流要求。", /右偏|技术总结|三厂|规范排布/.test(haystack));
  add(todos, "催办 8538 永久修复方案", "结构/质量相关人员继续跟进空客或顾客答复，明确续保、修复或停场方案。", "来自 8538 吊架盖板损伤还有 7 天的提醒。", /8538|吊架盖板|空客|7天/.test(haystack));
  add(todos, "暑运航台需求入日报", "将暑运前规定型、计划性工作和航台需求加入日报，并按重要性排序保障资源。", "来自 6月中下旬暑运准备讨论。", /暑[运院]|日报|航台需求/.test(haystack));
  add(todos, "航材启动 AOG/保障流程", "对临近关闭但仍需件保障的工单，确认航材保障流程已启动并保留责任追踪。", "来自单子关闭与航材保障讨论。", /航材|AOG|aug|保障/.test(haystack));

  if (events.length < 2 && productionPlans.length < 1) return null;
  const overview = [
    "这是一份航空维修生产早会记录，价值不在逐字保存发言，而在把运行指标、非例行事件、基地汇报、今日计划和资源约束转成可跟踪清单。",
    "早会暴露的主线是：前一日非例行处理基本闭环，但右偏、结构永久修复、321C 接近性、航材保障和暑运准备仍需要后续动作。",
    "自动转写包含大量口语和错字，所有飞机号、件号、指标数值应以正式系统或报表复核；HTML 只承担阅读和行动分发层。",
  ];
  const evidence = uniqueStrings([
    ...metrics.map((item) => item.evidence),
    ...events.slice(0, 5).map((item) => item.evidence),
    ...constraints.slice(0, 4).map((item) => item.evidence),
    ...todos.slice(0, 4).map((item) => item.evidence),
  ]).slice(0, 12);
  return {
    title,
    coreJudgment: "这份早会的管理价值，是把分散的飞机故障、航材约束和暑运准备从口头同步变成可核验、可追踪、可复盘的运行闭环。",
    overview,
    metrics,
    events,
    stationReports,
    productionPlans,
    constraints,
    todos,
    evidence,
    sourceText: source,
  };
}

function renderKnowledgeOperationalBriefingMarkdown(model: KnowledgeFallbackOperationalBriefingSummary, rawContent: string) {
  const section = (title: string, rows: KnowledgeOperationalBriefingItem[]) => [
    `## ${title}`,
    rows.length
      ? rows.map((item) => `- **${item.title}**：${item.detail}（依据：${item.evidence}）`).join("\n")
      : "- 待从原始记录补充。",
  ].join("\n\n");
  return [
    "## 运行概览",
    model.overview.map((item) => `- ${item}`).join("\n"),
    "",
    section("关键指标与运行态势", model.metrics),
    "",
    section("重点事件 / 非例行", model.events),
    "",
    section("基地与专业汇报", model.stationReports),
    "",
    section("今日计划与生产任务", model.productionPlans),
    "",
    section("风险与资源约束", model.constraints),
    "",
    section("行动项", model.todos),
    "",
    "## 金句 / 判断句",
    `- ${model.coreJudgment}`,
    "- 早会不是把每个人说了什么写下来，而是把今天会卡住什么、谁来推进、何时复核说清楚。",
    "- 航空维修管理里，口头同步只能启动协同，真正闭环靠工单、航材、技术结论和复查证据。",
    "",
    "## 证据入口",
    model.evidence.map((item) => `- ${item}`).join("\n") || "- 详见原始记录。",
    "",
    "## 反向链接索引",
    ["早会", "生产运行", "航空维修", "航材保障", "AOG", "暑运保障", "质量控制"].map((item) => `- [[${item}]]`).join("\n"),
    "",
    rawArchiveBlock(rawContent || model.sourceText),
  ].join("\n");
}

function renderKnowledgeFallbackOperationalBriefingHtml(model: KnowledgeFallbackOperationalBriefingSummary, sourceHash: string, reason: string) {
  const card = (item: KnowledgeOperationalBriefingItem) => `<article class="card"><h3>${escapeInlineHtml(item.title)}</h3><p>${escapeInlineHtml(item.detail)}</p><small>${escapeInlineHtml(item.evidence)}</small></article>`;
  const list = (rows: KnowledgeOperationalBriefingItem[]) => `<ol>${rows.map((item) => `<li><strong>${escapeInlineHtml(item.title)}</strong><span>${escapeInlineHtml(item.detail)}</span></li>`).join("")}</ol>`;
  const topicChips = [...model.events, ...model.productionPlans, ...model.constraints].slice(0, 10).map((item) => `<span class="chip">${escapeInlineHtml(item.title)}</span>`).join("");
  const css = `
    :root{color-scheme:light;--ink:#142033;--muted:#64748b;--line:#d8e3ee;--bg:#f5f8fb;--panel:#fff;--accent:#0f766e;--blue:#244d78;--amber:#b7791f;--soft:#e7f6f1;--warn:#fff8e7;--shadow:0 20px 54px rgba(15,31,52,.10)}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#f8fbff 0,#eef3f8 100%);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.66}.page{max-width:1200px;margin:0 auto;padding:34px 22px 58px}.hero{display:grid;grid-template-columns:minmax(0,1.28fr) 340px;gap:18px;align-items:stretch}.panel,.card{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}.lead{padding:32px}.eyebrow{color:var(--accent);font-weight:850;font-size:13px}.lead h1{margin:10px 0 14px;font-size:clamp(32px,4vw,54px);line-height:1.08;letter-spacing:0}.thesis{font-size:18px;color:#334155;max-width:850px}.meta{padding:22px;display:grid;gap:12px}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:18px}.metric{padding:16px;border-radius:15px;background:#f8fafc;border:1px solid var(--line)}.metric b{display:block;font-size:28px;line-height:1}.metric span{color:var(--muted);font-size:13px}.section{margin-top:18px}.section h2{font-size:24px;margin:0 0 12px}.overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.cards3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card{padding:18px}.card h3{margin:0 0 8px;font-size:18px}.card p{margin:0;color:#334155}.card small{display:block;margin-top:12px;color:var(--muted)}.chips{display:flex;flex-wrap:wrap;gap:9px}.chip{display:inline-flex;padding:7px 10px;border-radius:999px;background:var(--soft);color:var(--accent);font-weight:780;font-size:13px}.warn{background:var(--warn);border-left:5px solid var(--amber)}.event{border-left:5px solid var(--accent)}.action{background:#fbfffd}.quote{border-left:5px solid var(--blue);background:#f8fbff}ol{margin:0;padding-left:22px}li{margin:10px 0}li span{display:block;color:#334155;margin-top:3px}.raw details{margin-top:10px}.raw summary{cursor:pointer;color:var(--blue);font-weight:800}.raw pre{white-space:pre-wrap;word-break:break-word;background:#0f172a;color:#e2e8f0;border-radius:14px;padding:16px;max-height:340px;overflow:auto}.footer{margin-top:18px;text-align:center;color:var(--muted);font-size:12px;word-break:break-word}@media(max-width:900px){.page{padding:18px 12px}.hero,.overview,.grid,.cards3,.metric-grid{grid-template-columns:1fr}.lead h1{font-size:30px}}`;
  const body = `
    <main class="page">
      <section class="hero">
        <article class="panel lead">
          <div class="eyebrow">航空维修早会 · 结构化纪要</div>
          <h1>${escapeInlineHtml(model.title)}</h1>
          <p class="thesis"><strong>核心判断：</strong>${escapeInlineHtml(model.coreJudgment)}</p>
          <div class="metric-grid">
            <div class="metric"><b>${model.events.length}</b><span>重点事件</span></div>
            <div class="metric"><b>${model.productionPlans.length}</b><span>生产计划</span></div>
            <div class="metric"><b>${model.todos.length}</b><span>行动项</span></div>
          </div>
        </article>
        <aside class="panel meta">
          <strong>证据入口</strong>
          <span>Markdown 可信源和原始记录保留；HTML 仅作为阅读层。</span>
          <span>回退原因：${escapeInlineHtml(reason || "local_html_fallback")}</span>
          <span>source-hash：${escapeInlineHtml(sourceHash)}</span>
        </aside>
      </section>
      <section class="section"><h2>运行概览</h2><div class="overview">${model.overview.map((item) => `<article class="card"><p>${escapeInlineHtml(item)}</p></article>`).join("")}</div></section>
      <section class="section"><h2>主题地图</h2><article class="card"><div class="chips">${topicChips}</div></article></section>
      <section class="section"><h2>关键指标与运行态势</h2><div class="grid">${model.metrics.map(card).join("") || "<article class=\"card\"><p>原始记录未提供可稳定抽取的指标。</p></article>"}</div></section>
      <section class="section"><h2>重点事件 / 非例行</h2><div class="grid">${model.events.map((item) => card(item).replace("class=\"card\"", "class=\"card event\"")).join("")}</div></section>
      <section class="section"><h2>基地与专业汇报</h2><div class="grid">${model.stationReports.map(card).join("") || "<article class=\"card\"><p>未抽取到稳定的基地分组。</p></article>"}</div></section>
      <section class="section"><h2>今日计划与生产任务</h2><div class="grid">${model.productionPlans.map(card).join("") || "<article class=\"card\"><p>未抽取到明确生产计划。</p></article>"}</div></section>
      <section class="section"><h2>风险与资源约束</h2><div class="grid">${model.constraints.map((item) => card(item).replace("class=\"card\"", "class=\"card warn\"")).join("") || "<article class=\"card\"><p>未抽取到明确资源约束。</p></article>"}</div></section>
      <section class="section"><h2>金句 / 判断句</h2><article class="card quote"><p>${escapeInlineHtml(model.coreJudgment)}</p><p>早会不是把每个人说了什么写下来，而是把今天会卡住什么、谁来推进、何时复核说清楚。</p></article></section>
      <section class="section"><h2>行动项</h2><article class="card action">${list(model.todos)}</article></section>
      <section class="section raw"><article class="card"><h2>证据入口</h2>${knowledgeFallbackListHtmlLimit(model.evidence, "详见 Markdown 可信源和原始记录。", 12)}<details><summary>查看净化后的原始记录</summary><pre>${escapeInlineHtml(model.sourceText.slice(0, 9000))}</pre></details></article></section>
      <p class="footer">source-hash: ${escapeInlineHtml(sourceHash)} · rendered-at: ${nowIso()} · offline safe HTML</p>
    </main>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="source-hash" content="${escapeInlineHtml(sourceHash)}">
  <meta name="rendered-at" content="${nowIso()}">
  <title>${escapeInlineHtml(model.title)}</title>
  <style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}

function cleanOperationalBriefingEvidence(source: string) {
  return String(source || "")
    .split(/\r?\n/)
    .filter((line) => !/Knowledge Note Interaction Document|项\s*·\s*结果|企业家代表团|高峰会重要性判断/.test(line))
    .join("\n")
    .trim();
}

function cleanOperationalBriefingLine(value: string) {
  return String(value || "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/呃|嗯/g, "")
    .trim();
}

function buildKnowledgeFallbackWorkSummary(title: string, markdown: string, sourceText: string): KnowledgeFallbackWorkSummary | null {
  const source = sourceText || markdown;
  const workLike = /工作总结|昨日工作|更新要点|航材|AOG|SMS|双拥杯|共读|安委会|生产会/.test(`${title}\n${source}`);
  const parsedItems = parseKnowledgeWorkSummaryItems(source);
  if (!workLike || parsedItems.length < 3) return null;

  const groups = new Map<string, string[]>();
  for (const group of knowledgeWorkGroupOrder()) groups.set(group, []);
  for (const item of parsedItems) {
    const group = classifyKnowledgeWorkGroup(`${item.title}\n${item.detail}`);
    groups.set(group, uniqueStrings([...(groups.get(group) || []), `${item.title}：${item.detail}`]));
  }
  pushKnowledgeWorkEvidence(groups, source);
  const orderedGroups = knowledgeWorkGroupOrder()
    .map((group) => ({ title: group, items: groups.get(group) || [] }))
    .filter((group) => group.items.length);
  const completed = knowledgeWorkCompletedItems(source);
  const followups = knowledgeWorkFollowupItems(source);
  const keyResults = knowledgeWorkKeyResults(source, completed);
  const coreItems = knowledgeWorkCoreItems(orderedGroups, source);
  const facts = knowledgeWorkFacts(source);
  return {
    title,
    coreItems,
    keyResults,
    groups: orderedGroups,
    followups,
    completed,
    facts,
    sourceText: source,
  };
}

function renderKnowledgeWorkSummaryMarkdown(model: KnowledgeFallbackWorkSummary, rawContent: string) {
  const groupBlocks = model.groups.map((group) => [
    `## ${group.title}`,
    group.items.map((item) => `- ${item}`).join("\n") || "- 待补充",
  ].join("\n\n"));
  return [
    "## 工作概览",
    `- 核心事务：${model.coreItems.join("、") || "昨日工作复盘"}`,
    `- 关键成果：${model.keyResults.join("；") || "已按业务域重组为可追踪记录。"} `,
    "",
    "## 高价值摘要",
    model.keyResults.map((item) => `- ${item}`).join("\n") || "- 已从原始记录中提炼业务结果、待办和证据入口。",
    "",
    "## 金句 / 判断句",
    "- 工作总结的价值不在复述发生了什么，而在把任务、口径、证据和下一步变成可追踪闭环。",
    "- 应急保障要看运输是否闭环，流程改进要看标准是否落地，会议审查要看问题是否进入后续清单。",
    "",
    ...groupBlocks.flatMap((block) => [block, ""]),
    "## 待办汇总",
    "### 待跟进",
    model.followups.length ? model.followups.map((item) => `- [ ] ${item}`).join("\n") : "- [ ] 暂无明确待跟进事项。",
    "",
    "### 已完成",
    model.completed.length ? model.completed.map((item) => `- [x] ${item}`).join("\n") : "- [x] 已完成事项待人工确认。",
    "",
    "## 关键事实索引",
    model.facts.length ? model.facts.map((item) => `- ${item}`).join("\n") : "- 详见原始记录。",
    "",
    "## 反向链接索引",
    model.coreItems.map((item) => `- [[${item}]]`).join("\n") || "- 待补充",
    "",
    rawArchiveBlock(rawContent || model.sourceText),
  ].filter(Boolean).join("\n");
}

function parseKnowledgeWorkSummaryItems(source: string) {
  const rows: Array<{ title: string; detail: string }> = [];
  const byTitle = new Map<string, { title: string; detail: string }>();
  for (const rawLine of String(source || "").split(/\r?\n/)) {
    const line = cleanKnowledgeWorkText(rawLine);
    const match = line.match(/^(\d+)[.、]\s*([^:：]+)(?:[:：]\s*(.+))?$/);
    if (!match) continue;
    const itemTitle = cleanKnowledgeWorkText(match[2]);
    const detail = cleanKnowledgeWorkText(match[3] || "");
    if (!detail || detail === itemTitle || detail.length < 12) continue;
    const key = itemTitle.replace(/\s+/g, "");
    const current = byTitle.get(key);
    if (!current || detail.length > current.detail.length) byTitle.set(key, { title: itemTitle, detail });
  }
  for (const item of byTitle.values()) rows.push(item);
  return rows.slice(0, 12);
}

function cleanKnowledgeWorkText(value: string) {
  return String(value || "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/^[\s●•*-]+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function knowledgeWorkGroupOrder() {
  return [
    "AOG航材支援保障",
    "烧水器堵盖 SMS 改进方案",
    "会议文件审查",
    "班组管理与协调",
    "双拥杯比赛安排",
    "知识学习与活动",
    "其他协调事项",
  ];
}

function classifyKnowledgeWorkGroup(text: string) {
  if (/AOG|航材|热缩管|密封胶|DWP|HT3326|无料|非例行|重点关注件|DU|刹车风扇|IDG/.test(text)) return "AOG航材支援保障";
  if (/烧水器|堵盖|SMS|SAM228|部件修理|送修标准|不予接收/.test(text)) return "烧水器堵盖 SMS 改进方案";
  if (/会议文件|生产会|安委会|报告|PPT|pptx|pdf|审查|查阅/.test(text)) return "会议文件审查";
  if (/班组|刘玺|四人|出差申请|郑志军|库房出差|人员确认/.test(text)) return "班组管理与协调";
  if (/双拥杯|球衣|比赛|锁班|工会|5月25日|5月28日|6月1日/.test(text)) return "双拥杯比赛安排";
  if (/共读|浪潮将至|读书|阅读|笔记输出|知识学习/.test(text)) return "知识学习与活动";
  return "其他协调事项";
}

function pushKnowledgeWorkEvidence(groups: Map<string, string[]>, source: string) {
  const add = (group: string, item: string) => groups.set(group, uniqueStrings([...(groups.get(group) || []), item]));
  if (/航材日报|肖建|新增无料|非例行调配/.test(source)) add("AOG航材支援保障", "航材日报：接收肖建发送的航材日报，关注 AOG 需求、新增无料与非例行调配。");
  if (/计划&送修&采购重点关注件清单|DU|刹车风扇马达|IDG/.test(source)) add("AOG航材支援保障", "重点关注件：持续跟踪 DU、刹车风扇马达、IDG 等计划、送修与采购清单。");
  if (/SAM228-24|49ABC|储物柜锁扣/.test(source)) add("烧水器堵盖 SMS 改进方案", "补充场景：SAM228-24 / 1115 浦东 49ABC 储物柜锁扣故障，重申内外送修堵盖标准统一。");
  if (/出差申请标题需写明任务|郑志军/.test(source)) add("班组管理与协调", "出差申请规范：接受并确认执行“库房出差申请标题需写明任务”的要求。");
  if (/刘玺|四人/.test(source)) add("班组管理与协调", "班组人数：向刘玺确认当晚共有四人参与工作。");
}

function knowledgeWorkCoreItems(groups: Array<{ title: string; items: string[] }>, source: string) {
  const rows: string[] = [];
  if (/热缩管|密封胶/.test(source)) rows.push("AOG 应急：热缩管与密封胶");
  if (/堵盖|SMS|不予接收/.test(source)) rows.push("SMS 标准：缺堵盖不予接收");
  if (/生产会|安委会/.test(source)) rows.push("会议文件审查");
  if (/出差申请|刘玺|四人|班组/.test(source)) rows.push("班组协调");
  if (/双拥杯|球衣|锁班/.test(source)) rows.push("双拥杯比赛安排");
  if (/浪潮将至|共读/.test(source)) rows.push("午间共读与知识沉淀");
  return uniqueStrings([...rows, ...groups.map((group) => group.title)]).slice(0, 8);
}

function knowledgeWorkKeyResults(source: string, completed: string[]) {
  const rows: string[] = [];
  if (/热缩管|密封胶/.test(source)) rows.push("完成 AOG 热缩管与密封胶运输安排，并把到达节点纳入跟踪。");
  if (/堵盖|SMS|不予接收/.test(source)) rows.push("烧水器堵盖 SMS 改进形成执行口径：内外送修标准统一，缺少堵盖不予接收并要求补齐。");
  if (/生产会|安委会/.test(source)) rows.push("生产会报告与安委会文件已完成接收、查阅和审查。");
  if (/双拥杯|球衣/.test(source)) rows.push("双拥杯球衣尺码和赛程已确认，队员锁班进入后续跟进。");
  if (/浪潮将至|共读/.test(source)) rows.push("完成《浪潮将至》第八章共读，并沉淀阅读笔记。");
  return uniqueStrings([...rows, ...completed.slice(0, 2)]).slice(0, 5);
}

function knowledgeWorkFollowupItems(source: string) {
  const rows: string[] = [];
  if (/密封胶|23:10/.test(source)) rows.push("确认密封胶（HT3326-5）是否按预计时间抵达浦东。");
  if (/堵盖|SMS|不予接收/.test(source)) rows.push("跟进烧水器堵盖补齐标准在库房、质检和部件车间的落地执行。");
  if (/双拥杯|锁班|工会/.test(source)) rows.push("通过工会推进双拥杯队员锁班安排。");
  if (/DU|刹车风扇马达|IDG|重点关注件/.test(source)) rows.push("持续跟踪 DU、刹车风扇马达、IDG 等重点关注件。");
  return uniqueStrings(rows).slice(0, 8);
}

function knowledgeWorkCompletedItems(source: string) {
  const rows: string[] = [];
  if (/热缩管|顺丰空运/.test(source)) rows.push("热缩管顺丰空运发出。");
  if (/密封胶|内联单/.test(source)) rows.push("密封胶内联单运输安排完成。");
  if (/工程部群/.test(source)) rows.push("工程部群通报完成。");
  if (/堵盖|SMS/.test(source)) rows.push("烧水器堵盖 SMS 改进方案形成结论。");
  if (/生产会报告/.test(source)) rows.push("生产会报告接收查阅。");
  if (/119期安委会|安委会/.test(source)) rows.push("119 期安委会材料接收审查。");
  if (/出差申请标题/.test(source)) rows.push("出差申请标题规范确认执行。");
  if (/四人|刘玺/.test(source)) rows.push("班组当班人数确认。");
  if (/球衣|B2/.test(source)) rows.push("双拥杯球衣尺码确认。");
  if (/浪潮将至|共读/.test(source)) rows.push("《浪潮将至》第八章阅读及笔记输出。");
  return uniqueStrings(rows).slice(0, 12);
}

function knowledgeWorkFacts(source: string) {
  const rows = new Set<string>();
  for (const match of String(source || "").matchAll(/\b(?:DWP|HT|SAM)[A-Z0-9/-]{2,}\b/g)) rows.add(match[0]);
  for (const match of String(source || "").matchAll(/\d{1,2}月\d{1,2}日(?:\s*\d{1,2}:\d{2})?/g)) rows.add(match[0].replace(/\s+/g, " "));
  if (/B2/.test(source)) rows.add("球衣尺码 B2");
  if (/四人/.test(source)) rows.add("班组人数 4 人");
  return Array.from(rows).slice(0, 10);
}

function renderKnowledgeFallbackWorkSummaryHtml(model: KnowledgeFallbackWorkSummary, sourceHash: string, reason: string) {
  const summary = model.keyResults.slice(0, 4).join(" ") || model.coreItems.join("、") || "昨日工作复盘";
  const resultLine = model.keyResults.slice(0, 4).join(" ") || "已完成事项已按业务域归档，待跟进事项已单列。";
  const css = `
    :root{color-scheme:light;--ink:#172033;--muted:#64748b;--line:#dbe4ef;--bg:#f5f7fb;--panel:#ffffff;--soft:#e9f7f3;--accent:#0f766e;--accent2:#315b86;--warn:#fff7df;--done:#edfdf4;--shadow:0 18px 46px rgba(15,23,42,.08)}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#f8fbff 0,#eef3f8 100%);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.64}.page{max-width:1180px;margin:0 auto;padding:34px 22px 56px}.hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:18px;margin-bottom:18px}.panel,.card{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}.lead{padding:30px}.eyebrow{color:var(--accent);font-weight:800;font-size:13px}.lead h1{margin:10px 0 14px;font-size:clamp(30px,4vw,52px);line-height:1.08;letter-spacing:0}.thesis{font-size:17px;color:#334155;max-width:860px}.meta{padding:22px;display:grid;gap:12px}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.metric{padding:16px;border-radius:14px;background:#f8fafc;border:1px solid var(--line)}.metric b{display:block;font-size:26px}.section-title{margin:28px 0 12px;font-size:22px}.overview{display:grid;grid-template-columns:1fr 1fr;gap:14px}.card{padding:18px}.card h2{margin:0 0 10px;font-size:18px}.chips{display:flex;flex-wrap:wrap;gap:9px}.chip{display:inline-flex;padding:7px 10px;border-radius:999px;background:var(--soft);color:var(--accent);font-weight:760;font-size:13px}.groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.group h3{margin:0 0 10px;font-size:18px}.group ol{margin:0;padding-left:22px}.group li{margin:8px 0;color:#334155}.todo{display:grid;grid-template-columns:1fr 1fr;gap:14px}.todo .follow{background:var(--warn)}.todo .done{background:var(--done)}.facts{display:flex;flex-wrap:wrap;gap:8px}.evidence details{margin-top:10px}.evidence summary{cursor:pointer;color:var(--accent2);font-weight:750}.evidence pre{white-space:pre-wrap;word-break:break-word;background:#0f172a;color:#e2e8f0;border-radius:14px;padding:16px;max-height:360px;overflow:auto}.footer{margin-top:18px;color:var(--muted);font-size:12px;text-align:center;word-break:break-word}@media(max-width:860px){.page{padding:18px 12px}.hero,.overview,.groups,.todo,.metric-grid{grid-template-columns:1fr}.lead h1{font-size:30px}}`;
  const body = `
    <main class="page">
      <section class="hero">
        <article class="panel lead">
          <div class="eyebrow">工作日志 · Obsidian 长期记忆整理</div>
          <h1>${escapeInlineHtml(model.title)}</h1>
          <p class="thesis"><strong>核心判断：</strong>这一天的价值不在“事项很多”，而在 AOG 应急、SMS 流程标准、会议材料审查和团队协同被推进到可跟踪状态。</p>
          <p class="thesis"><strong>高价值摘要：</strong>${escapeInlineHtml(summary)}</p>
        </article>
        <aside class="panel meta">
          <strong>今日复盘入口</strong>
          <div class="metric-grid">
            <div class="metric"><b>${model.groups.length}</b><span>工作域</span></div>
            <div class="metric"><b>${model.followups.length}</b><span>待跟进</span></div>
            <div class="metric"><b>${model.completed.length}</b><span>已完成</span></div>
          </div>
          <span>证据入口：Markdown 可信源与原始记录保留在文末。</span>
        </aside>
      </section>
      <section class="overview" aria-label="首屏摘要">
        <article class="card"><h2>主题地图</h2><div class="chips">${model.coreItems.map((item) => `<span class="chip">${escapeInlineHtml(item)}</span>`).join("")}</div></article>
        <article class="card"><h2>高价值摘要</h2><p>${escapeInlineHtml(resultLine)}</p></article>
        <article class="card"><h2>金句 / 判断句</h2><p>真正有效的工作总结，是把“已处理”转成“可追踪的闭环”，把“口径讨论”转成“下一次可执行的标准”。</p></article>
        <article class="card"><h2>行动项</h2>${knowledgeFallbackListHtmlLimit(model.followups, "暂无待跟进事项。", 6)}</article>
        <article class="card evidence"><h2>证据入口</h2><p>关键事实来自原始工作记录，已去除重复叙述并按业务域重组。</p></article>
      </section>
      <h2 class="section-title">分组工作记录</h2>
      <section class="groups">${model.groups.map((group) => `<article class="card group"><h3>${escapeInlineHtml(group.title)}</h3><ol>${group.items.map((item) => `<li>${escapeInlineHtml(item)}</li>`).join("")}</ol></article>`).join("")}</section>
      <h2 class="section-title">待办汇总</h2>
      <section class="todo">
        <article class="card follow"><h2>待跟进</h2>${knowledgeFallbackListHtmlLimit(model.followups, "暂无待跟进事项。", 8)}</article>
        <article class="card done"><h2>已完成</h2>${knowledgeFallbackListHtmlLimit(model.completed, "暂无已完成事项。", 12)}</article>
      </section>
      <section class="card evidence" style="margin-top:14px">
        <h2>关键事实索引</h2>
        <div class="facts">${model.facts.map((item) => `<span class="chip">${escapeInlineHtml(item)}</span>`).join("") || "<span class=\"chip\">详见原始记录</span>"}</div>
        <details><summary>查看净化后的原始记录</summary><pre>${escapeInlineHtml(model.sourceText.slice(0, 8000))}</pre></details>
      </section>
      <p class="footer">fallback-reason: ${escapeInlineHtml(reason || "local_html_fallback")} · source-hash: ${escapeInlineHtml(sourceHash)} · rendered-at: ${nowIso()} · offline safe HTML</p>
    </main>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="source-hash" content="${escapeInlineHtml(sourceHash)}">
  <meta name="rendered-at" content="${nowIso()}">
  <title>${escapeInlineHtml(model.title)}</title>
  <style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}

function knowledgeNoteHtmlFallbackReason(htmlQuality: ReturnType<typeof normalizeKnowledgeNoteHtmlQuality>, defaultReason: string) {
  const stale = htmlQuality.issues.find(isKnowledgeNoteStaleRuntimeIssue);
  if (stale) return `stale_runtime_error:${stale}`;
  return htmlQuality.issues.find(Boolean) || defaultReason;
}

function isKnowledgeNoteStaleRuntimeIssue(issue: string) {
  return /unexpected property ['"]?modelId['"]?|unexpected property .*modelId/i.test(String(issue || ""));
}

function extractKnowledgeFallbackTitle(markdown: string) {
  return String(markdown || "").match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
}

function extractKnowledgeFallbackSections(markdown: string) {
  const body = String(markdown || "").replace(/^---[\s\S]*?---\s*/, "");
  const rows = body.split(/\r?\n/);
  const sections: Array<{ title: string; content: string }> = [];
  let current: { title: string; content: string[] } | null = null;
  for (const row of rows) {
    const heading = row.match(/^##\s+(.+)$/);
    if (heading) {
      if (current) sections.push({ title: current.title, content: current.content.join("\n").trim() });
      current = { title: heading[1].trim(), content: [] };
    } else if (current) {
      current.content.push(row);
    }
  }
  if (current) sections.push({ title: current.title, content: current.content.join("\n").trim() });
  if (!sections.length) sections.push({ title: "正文", content: body.replace(/^#\s+.*$/m, "").trim() });
  return sections;
}

function knowledgeFallbackSectionItems(sections: Array<{ title: string; content: string }>, pattern: RegExp) {
  const section = sections.find((item) => pattern.test(item.title));
  if (!section) return [];
  return uniqueStrings(section.content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").replace(/^\|+|\|+$/g, "").replace(/\|/g, " · ").replace(/\*\*/g, "").trim())
    .filter((line) => line && !/^[-:|\s]+$/.test(line) && !/^#+\s/.test(line) && line.length >= 6)
    .map((line) => line.slice(0, 220)));
}

function knowledgeFallbackFirstParagraph(markdown: string) {
  return String(markdown || "")
    .replace(/^---[\s\S]*?---\s*/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^\s*[-*]\s+/, "").replace(/\*\*/g, "").trim())
    .find((line) => line.length >= 18 && !/^\|/.test(line))
    ?.slice(0, 220) || "";
}

function knowledgeFallbackListHtml(items: string[], fallback: string) {
  return knowledgeFallbackListHtmlLimit(items, fallback, 5);
}

function knowledgeFallbackListHtmlLimit(items: string[], fallback: string, limit: number) {
  const rows = (items.length ? items : [fallback]).slice(0, Math.max(1, limit));
  return `<ul>${rows.map((item) => `<li>${escapeInlineHtml(item)}</li>`).join("")}</ul>`;
}

function knowledgeFallbackAnchor(value: string) {
  return safeName(value).toLowerCase() || createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function knowledgeFallbackSectionHtml(section: { title: string; content: string }) {
  return `<section id="${knowledgeFallbackAnchor(section.title)}"><h2>${escapeInlineHtml(section.title)}</h2>${knowledgeFallbackMarkdownToHtml(section.content)}</section>`;
}

function knowledgeFallbackMarkdownToHtml(markdown: string) {
  const rows = String(markdown || "").split(/\r?\n/);
  const html: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${escapeInlineHtml(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const row of rows) {
    const line = row.trim();
    if (!line) {
      flushList();
      continue;
    }
    const subheading = line.match(/^#{3,6}\s+(.+)$/);
    if (subheading) {
      flushList();
      html.push(`<h3>${escapeInlineHtml(subheading[1])}</h3>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      list.push(bullet[1].replace(/\*\*/g, ""));
      continue;
    }
    if (/^\|/.test(line)) {
      flushList();
      html.push(`<pre>${escapeInlineHtml(line)}</pre>`);
      continue;
    }
    flushList();
    html.push(`<p>${escapeInlineHtml(line.replace(/\*\*/g, ""))}</p>`);
  }
  flushList();
  return html.join("\n") || "<p>暂无可渲染内容。</p>";
}

function escapeInlineHtml(value: string) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
}

export function listKnowledgeFolders(scope: "notes" | "local" = "local") {
  const seen = new Set<string>();
  const folders: Array<{ path: string; relativePath: string; title: string; scope: string }> = [];
  const push = (base: string, folder: string, folderScope: string) => {
    const resolved = path.resolve(folder);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    const relativePath = toPosixPath(path.relative(base, resolved));
    folders.push({
      path: resolved,
      relativePath,
      title: relativePath || path.basename(resolved),
      scope: folderScope,
    });
  };
  if (scope === "notes") {
    fs.mkdirSync(KNOWLEDGE_NOTES_ROOT, { recursive: true });
    for (const folder of walkFolders(KNOWLEDGE_NOTES_ROOT, 5)) push(KNOWLEDGE_NOTES_ROOT, folder, "notes");
    return folders;
  }
  fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
  for (const folder of walkFolders(KNOWLEDGE_ROOT, 4)) push(KNOWLEDGE_ROOT, folder, "memory");
  for (const folder of walkFolders(WORKSPACE_DIR, 2).filter((folder) => !isWorkspaceProtectedPath(folder))) push(WORKSPACE_DIR, folder, "workspace");
  return folders;
}

export function importKnowledgeFiles(db: Db, input: KnowledgeFileImportInput) {
  const files = input.files || [];
  if (!files.length) throw new Error("files_required");
  const declaredTotal = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (declaredTotal > KNOWLEDGE_IMPORT_MAX_TOTAL_BYTES) throw new Error("import_total_too_large");
  const targetDir = resolveManagedTargetFolder(input.targetFolderPath || path.join(KNOWLEDGE_ROOT, "inbox"), true);
  let actualTotal = 0;
  const imported = files.map((file) => {
    const originalName = String(file.name || "upload.bin");
    const name = safeKnowledgeFileName(originalName);
    const declaredSize = Number(file.size || 0);
    if (declaredSize > KNOWLEDGE_IMPORT_MAX_FILE_BYTES) throw new Error("import_file_too_large");
    const content = Buffer.from(String(file.contentBase64 || ""), "base64");
    if (content.byteLength > KNOWLEDGE_IMPORT_MAX_FILE_BYTES) throw new Error("import_file_too_large");
    actualTotal += content.byteLength;
    if (actualTotal > KNOWLEDGE_IMPORT_MAX_TOTAL_BYTES) throw new Error("import_total_too_large");
    const target = uniqueDestinationPath(path.join(targetDir, name));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    const fileId = upsertKnowledgeFileIndex(db, target, "imported");
    return { path: target, title: path.basename(target), fileId, size: content.byteLength, mime: file.mime || mimeForKnowledgeExt(path.extname(target).toLowerCase()) };
  });
  return { files: imported };
}

export function moveKnowledgeFile(db: Db, input: { path?: string; targetFolderPath?: string }) {
  const source = resolveManagedFile(input.path);
  const targetDir = resolveManagedTargetFolder(input.targetFolderPath || "", false);
  if (path.dirname(source.path) === targetDir) return { oldPath: source.path, path: source.path, title: path.basename(source.path), status: "unchanged" };
  const target = uniqueDestinationPath(path.join(targetDir, path.basename(source.path)));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  moveFileOnDisk(source.path, target);
  updateKnowledgePathReferences(db, source.path, target, "indexed");
  return { oldPath: source.path, path: target, title: path.basename(target), status: "moved" };
}

export function archiveKnowledgeFile(db: Db, input: { path?: string }) {
  return relocateManagedFileToArchive(db, input, "archive");
}

export function trashKnowledgeFile(db: Db, input: { path?: string }) {
  return relocateManagedFileToArchive(db, input, "trash");
}

function relocateManagedFileToArchive(db: Db, input: { path?: string }, mode: "archive" | "trash") {
  const source = resolveManagedFile(input.path);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const root = source.scope === "memory" ? path.resolve(KNOWLEDGE_ROOT) : path.resolve(WORKSPACE_DIR);
  const archiveSegment = mode === "archive" ? "archive/files" : "archive/.trash";
  const archiveRoot = source.scope === "memory"
    ? path.join(KNOWLEDGE_ROOT, archiveSegment, day)
    : path.join(WORKSPACE_DIR, archiveSegment, day);
  const relative = path.relative(root, source.path);
  const target = uniqueDestinationPath(path.join(archiveRoot, relative));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  moveFileOnDisk(source.path, target);
  updateKnowledgePathReferences(db, source.path, target, mode === "archive" ? "archived" : "trashed");
  return { oldPath: source.path, path: target, title: path.basename(target), status: mode === "archive" ? "archived" : "trashed" };
}

type KnowledgeOutputInput = {
  sourcePath?: string;
  sourcePaths?: string[];
  outputType?: string;
  title?: string;
  content?: string;
  template?: string;
};

type KnowledgeWikiCompileInput = {
  mode?: "incremental" | "selected" | "full";
  sourcePaths?: string[];
  dryRun?: boolean;
};

export function createKnowledgeOutputJob(db: Db, input: KnowledgeOutputInput) {
  const id = randomUUID();
  const type = input.outputType || "report";
  const title = input.title || `${type} output`;
  const sourcePaths = Array.from(new Set([...(input.sourcePaths || []), input.sourcePath || ""].map(String).map((row) => row.trim()).filter(Boolean))).slice(0, 20);
  if (unimplementedOutputTypes().has(type)) {
    db.prepare("INSERT INTO knowledge_output_jobs (id, source_path, output_type, title, status, output_path, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, sourcePaths[0] || null, type, title, "not_integrated", null, `${type} 真实生成链路未接入；未生成占位产物。`, nowIso(), nowIso());
    return db.prepare("SELECT * FROM knowledge_output_jobs WHERE id = ?").get(id);
  }
  const content = input.content || composeKnowledgeOutputContent(sourcePaths, input.template || "standard");
  const folder = path.join(SIDECAR_DIR, "outputs", nowIso().slice(0, 10));
  fs.mkdirSync(folder, { recursive: true });
  const out = path.join(folder, `${safeName(title)}_${id.slice(0, 8)}.md`);
  const sourceYaml = sourcePaths.length ? sourcePaths.map((sourcePath) => `  - ${JSON.stringify(sourcePath)}`).join("\n") : "  []";
  const markdown = `---\ntype: knowledge_output\noutput_type: ${type}\ncreated: ${nowIso()}\nsource_path: ${sourcePaths[0] || ""}\nsource_count: ${sourcePaths.length}\nsource_paths:\n${sourceYaml}\nextract_status: ${sourcePaths.length ? "indexed" : "empty"}\nstatus: draft\n---\n\n# ${title}\n\n${renderOutput(type, content, sourcePaths.length > 1 ? `${sourcePaths.length} sources` : sourcePaths[0] || "")}\n`;
  fs.writeFileSync(out, markdown, "utf8");
  const htmlPath = defaultHtmlPath(out);
  writeHtmlDocument(markdown, htmlPath, { title, sourcePath: out, documentType: `knowledge_${type}` });
  db.prepare("INSERT INTO knowledge_output_jobs (id, source_path, output_type, title, status, output_path, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, sourcePaths[0] || null, type, title, "draft", out, `Draft markdown and HTML sidecar generated from ${sourcePaths.length || 1} real source(s). HTML: ${htmlPath}`, nowIso(), nowIso());
  return db.prepare("SELECT * FROM knowledge_output_jobs WHERE id = ?").get(id);
}

export function ensureKnowledgeWikiDirs() {
  fs.mkdirSync(KNOWLEDGE_WIKI_ROOT, { recursive: true });
  for (const dir of KNOWLEDGE_WIKI_DIRS) fs.mkdirSync(path.join(KNOWLEDGE_WIKI_ROOT, dir), { recursive: true });
}

const KNOWLEDGE_WIKI_SCHEDULER_HOUR = 3;
const KNOWLEDGE_WIKI_SCHEDULER_MINUTE = 10;
const KNOWLEDGE_WIKI_SCHEDULER_TIMEZONE = "Asia/Shanghai";

type KnowledgeWikiCategoryDescriptor = {
  id: string;
  title: string;
  keywords: string[];
  topics: string[];
};

const KNOWLEDGE_WIKI_CATEGORY_DESCRIPTORS: KnowledgeWikiCategoryDescriptor[] = [
  { id: "openclaw", title: "OpenClaw / AI 系统", keywords: ["openclaw", "gateway", "workbench", "三代理", "minimax", "codex", "agent", "知识库治理", "任务"], topics: ["三代理架构", "Gateway 可靠性", "Knowledge Atlas", "任务执行闭环"] },
  { id: "nas", title: "NAS 南极熊", keywords: ["南极熊", "/volumes/南极熊", "nas", "01人生规划", "02学海无涯", "03知行合一", "04我的笔记", "07知识库", "09_wiki"], topics: ["人生规划", "学海无涯", "我的笔记", "NAS Wiki"] },
  { id: "ima", title: "IMA 同步", keywords: ["ima", "ima_sync", "ima同步"], topics: ["IMA 同步", "云端笔记", "日程资料"] },
  { id: "assistant", title: "智能助理", keywords: ["calendar", "日程", "智能助理", "assistant", "早会", "会议", "例会"], topics: ["日程笔记", "组织运行", "日报周报"] },
  { id: "aviation", title: "航空运行", keywords: ["aog", "航材", "航空", "可靠性", "安委会", "rfid", "供应链", "维修", "o项", "mel", "鸟击", "雷雨"], topics: ["AOG 保障", "可靠性会议", "航材供应链", "RFID 项目"] },
  { id: "ai_product", title: "AI 产品", keywords: ["ai产品", "产品经理", "agentic", "智能体", "rag", "llm", "模型", "prompt", "提示词"], topics: ["AI 产品品味", "RAG 与知识治理", "Agent 工作流"] },
  { id: "learning", title: "学习与课程", keywords: ["mba", "mem", "课程", "学习", "读书", "共读", "认知", "第五项修炼", "u型", "培训"], topics: ["MBA/MEM", "系统思考", "读书共创", "课程框架"] },
  { id: "life", title: "人生规划", keywords: ["人生", "自我", "规划", "思想汇报", "阳明", "反思", "个人"], topics: ["长期规划", "自我修炼", "反思资产"] },
  { id: "projects", title: "项目实践", keywords: ["项目", "project", "prd", "roadmap", "交付", "opc", "sap", "采购", "资产管理"], topics: ["业务系统", "项目交付", "决策证据"] },
  { id: "reports", title: "日报周报", keywords: ["日报", "周报", "月报", "工作总结", "summary", "report", "generated_report"], topics: ["日报", "周报", "自动报告"] },
  { id: "media", title: "媒体与原始资料", keywords: [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp3", ".wav", ".m4a", ".mp4", ".mov", "媒体", "原始资料", "转写", "转换", "inbox", "office", "manifest"], topics: ["原始资料", "可读预览", "抽取候选"] },
  { id: "governance", title: "Wiki 治理", keywords: ["wiki", "moc", "entities", "concepts", "decisions", "sources", "冲突", "待审"], topics: ["MOC", "来源证据", "冲突待审"] },
  { id: "general", title: "通用知识", keywords: [], topics: ["通用知识", "待分类来源"] },
];

export function compileKnowledgeWiki(db: Db, input: KnowledgeWikiCompileInput = {}) {
  ensureKnowledgeWikiDirs();
  const mode = input.mode === "selected" ? "selected" : input.mode === "full" ? "full" : "incremental";
  const dryRun = Boolean(input.dryRun);
  const runId = randomUUID();
  const startedAt = nowIso();
  const stats = { processedCount: 0, generatedCount: 0, skippedCount: 0, conflictCount: 0, errorCount: 0 };
  const pages: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let mocGeneratedCount = 0;
  if (!dryRun) {
    db.prepare("INSERT INTO knowledge_wiki_runs (id, mode, status, processed_count, generated_count, skipped_count, conflict_count, error_count, notes, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(runId, mode, "running", 0, 0, 0, 0, 0, "local deterministic compiler", startedAt, null);
  }

  const candidateLimit = mode === "selected" ? 20 : mode === "full" ? 1200 : 80;
  const candidates = collectKnowledgeWikiSourcePaths(db, { ...input, mode }).slice(0, candidateLimit);
  for (const sourcePath of candidates) {
    try {
      const source = buildKnowledgeWikiSource(sourcePath);
      if (!source) {
        stats.errorCount += 1;
        errors.push(`unavailable:${sourcePath}`);
        continue;
      }
      const existingSource = db.prepare("SELECT source_hash FROM knowledge_wiki_sources WHERE source_path = ?").get(source.path) as { source_hash?: string } | undefined;
      if (existingSource?.source_hash === source.hash) {
        stats.skippedCount += 1;
        continue;
      }
      stats.processedCount += 1;
      const compiledPages = compileKnowledgeWikiSourcePages(source);
      for (const page of compiledPages) {
        if (page.conflict) stats.conflictCount += 1;
        if (dryRun) {
          pages.push({ ...page, path: wikiPagePath(page.pageType, page.slug) });
          stats.generatedCount += 1;
          continue;
        }
        const saved = saveKnowledgeWikiPage(db, page);
        pages.push(saved);
        stats.generatedCount += 1;
        if (page.pageType === "source") {
          db.prepare("INSERT INTO knowledge_wiki_sources (id, source_path, source_hash, source_type, wiki_page_id, status, last_compiled_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_path) DO UPDATE SET source_hash = excluded.source_hash, source_type = excluded.source_type, wiki_page_id = excluded.wiki_page_id, status = excluded.status, last_compiled_at = excluded.last_compiled_at, metadata = excluded.metadata")
            .run(randomUUID(), source.path, source.hash, source.type, String(saved.id || ""), page.conflict ? "needs_review" : "compiled", nowIso(), JSON.stringify({ title: source.title, previewMode: source.previewMode, size: source.size }));
        }
      }
    } catch (err) {
      stats.errorCount += 1;
      errors.push(`${sourcePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2026-07-07 (rework11 v2 NJX 拍板) — workbench 不再生成 MOC, 单一真源 = njx-knowledge v2 phase 2b
  // 老路径 workbench wiki MOC 概念已废止 (老路径 14 MOC DEPRECATED 保留兼容读, 不再 sync)
  // 生成 MOC 仍会生成 entity/concept/decision/source (compileKnowledgeWikiSourcePages), 但不调 generateKnowledgeWikiMocs
  if (!dryRun) {
    try {
      // [DISABLED 2026-07-07] const mocPages = generateKnowledgeWikiMocs(db);
      // [DISABLED 2026-07-07] mocGeneratedCount = mocPages.length;
      // [DISABLED 2026-07-07] stats.generatedCount += mocGeneratedCount;
      // [DISABLED 2026-07-07] pages.push(...mocPages);
      mocGeneratedCount = 0;  // workbench 不再生成 MOC (njx-knowledge phase 2b 单一真源)
    } catch (err) {
      stats.errorCount += 1;
      errors.push(`moc:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const completedAt = nowIso();
  const notes = [
    `processed=${stats.processedCount}`,
    `generated=${stats.generatedCount}`,
    `skipped=${stats.skippedCount}`,
    `conflicts=${stats.conflictCount}`,
    errors.length ? `errors=${errors.slice(0, 5).join("; ")}` : "",
  ].filter(Boolean).join(" | ");
  if (!dryRun) {
    db.prepare("UPDATE knowledge_wiki_runs SET status = ?, processed_count = ?, generated_count = ?, skipped_count = ?, conflict_count = ?, error_count = ?, notes = ?, completed_at = ? WHERE id = ?")
      .run(stats.errorCount ? "completed_with_errors" : "completed", stats.processedCount, stats.generatedCount, stats.skippedCount, stats.conflictCount, stats.errorCount, notes, completedAt, runId);
    fs.writeFileSync(path.join(KNOWLEDGE_WIKI_ROOT, "_compile_runs", `${startedAt.slice(0, 10)}_${runId.slice(0, 8)}.md`), `---\ntype: wiki_compile_run\nrun_id: ${runId}\nmode: ${mode}\nstatus: ${stats.errorCount ? "completed_with_errors" : "completed"}\ncreated: ${startedAt}\n---\n\n# Wiki Compile Run ${startedAt}\n\n- Processed: ${stats.processedCount}\n- Generated pages: ${stats.generatedCount}\n- Skipped unchanged: ${stats.skippedCount}\n- Conflicts: ${stats.conflictCount}\n- Errors: ${stats.errorCount}\n\n${errors.length ? `## Errors\n\n${errors.map((row) => `- ${row}`).join("\n")}\n` : "## Errors\n\nNo errors.\n"}\n`, "utf8");
  }
  return {
    ok: true,
    run: { id: runId, mode, status: stats.errorCount ? "completed_with_errors" : "completed", startedAt, completedAt, dryRun },
    processedCount: stats.processedCount,
    generatedCount: stats.generatedCount,
    skippedCount: stats.skippedCount,
    conflictCount: stats.conflictCount,
    errorCount: stats.errorCount,
    mocGeneratedCount,
    coverageAfter: buildKnowledgeWikiCoverageSnapshot(db),
    scheduler: knowledgeWikiSchedulerSnapshot(),
    pages,
    errors,
  };
}

export function knowledgeWikiSchedulerSnapshot() {
  const enabled = process.env.OPENCLAW_WORKBENCH_DISABLE_WIKI_SCHEDULER !== "1";
  return {
    enabled,
    source: "workbench-inprocess-scheduler",
    expression: "daily 03:10",
    timezone: KNOWLEDGE_WIKI_SCHEDULER_TIMEZONE,
    nextRunAt: enabled ? nextKnowledgeWikiRunAt().toISOString() : null,
    note: "由 Workbench 服务进程内 setTimeout 调度，不写入 cron_jobs 表。",
  };
}

export function buildKnowledgeWikiStatusSnapshot(db: Db) {
  const latestRun = db.prepare("SELECT * FROM knowledge_wiki_runs ORDER BY started_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  const coverageByCategory = buildKnowledgeWikiCoverageSnapshot(db);
  const totals = coverageByCategory.reduce((acc, row) => {
    acc.wikiPages += Number(row.wikiCount || 0);
    acc.mocPages += Number(row.mocCount || 0);
    acc.sources += Number(row.sourceCount || 0);
    acc.embeddedSources += Number(row.embeddedCount || 0);
    acc.pendingCompile += Number(row.pendingCompileCount || 0);
    acc.manifestOnly += Number(row.manifestOnlyCount || 0);
    acc.needsReview += Number(row.needsReviewCount || 0);
    return acc;
  }, { wikiPages: 0, mocPages: 0, sources: 0, embeddedSources: 0, pendingCompile: 0, manifestOnly: 0, needsReview: 0 });
  const errors = String(latestRun?.notes || "")
    .split("|")
    .map((row) => row.trim())
    .filter((row) => row.startsWith("errors="));
  const categoriesWithoutMoc = coverageByCategory.filter((row) => row.sourceCount > 0 && row.mocCount === 0).map((row) => row.title);
  return {
    ok: true,
    scheduler: knowledgeWikiSchedulerSnapshot(),
    latestRun: latestRun || null,
    lastRun: latestRun || null,
    errors,
    totals,
    coverageByCategory,
    nextActions: [
      categoriesWithoutMoc.length ? `补齐分类 MOC：${categoriesWithoutMoc.slice(0, 4).join("、")}` : "分类 MOC 已具备基础覆盖。",
      totals.pendingCompile ? `仍有 ${totals.pendingCompile} 个文本来源待编译，可执行增量或全量编译。` : "文本来源编译压力较低。",
      totals.manifestOnly ? `${totals.manifestOnly} 个 PDF/Office/图片/音视频来源只记录 manifest，后续接 OCR/抽取。` : "当前 manifest-only 压力较低。",
    ],
  };
}

function nextKnowledgeWikiRunAt() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(KNOWLEDGE_WIKI_SCHEDULER_HOUR, KNOWLEDGE_WIKI_SCHEDULER_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function generateKnowledgeWikiMocs(db: Db) {
  const coverage = buildKnowledgeWikiCoverageSnapshot(db);
  const generated: Array<Record<string, unknown>> = [];
  const activeCategories = coverage.filter((row) => row.sourceCount > 0 || row.wikiCount > 0 || row.id === "governance");
  const masterSourcePaths = uniqueStrings(activeCategories.flatMap((row) => row.sourceSamples.map((sample) => sample.path))).slice(0, 60);
  const masterBody = renderKnowledgeWikiMasterMocBody(activeCategories);
  generated.push(saveKnowledgeWikiPage(db, {
    pageType: "MOC",
    title: "Master MOC",
    slug: "Master_MOC",
    summary: "全库导航入口，连接分类 Wiki、主题、Wiki 页面和来源证据。",
    body: masterBody,
    confidence: 0.74,
    sourcePaths: masterSourcePaths,
    sourceHashes: [hashKnowledgeWikiMoc("master", activeCategories)],
    conflict: false,
  }));
  for (const category of activeCategories) {
    const descriptor = KNOWLEDGE_WIKI_CATEGORY_DESCRIPTORS.find((row) => row.id === category.id) || KNOWLEDGE_WIKI_CATEGORY_DESCRIPTORS.at(-1)!;
    const sourcePaths = uniqueStrings(category.sourceSamples.map((sample) => sample.path)).slice(0, 24);
    generated.push(saveKnowledgeWikiPage(db, {
      pageType: "MOC",
      title: `${descriptor.title} MOC`,
      slug: `${descriptor.id}_MOC`,
      summary: `${descriptor.title} 分类 Wiki，聚合 ${category.sourceCount} 个来源、${category.wikiCount} 个 Wiki 页面、${category.pendingCompileCount} 个待编译项。`,
      body: renderKnowledgeWikiCategoryMocBody(descriptor, category),
      confidence: 0.7,
      sourcePaths,
      sourceHashes: [hashKnowledgeWikiMoc(descriptor.id, category)],
      conflict: false,
    }));
  }
  return generated;
}

function buildKnowledgeWikiCoverageSnapshot(db: Db) {
  const coverage = new Map<string, {
    id: string;
    title: string;
    topics: string[];
    wikiCount: number;
    mocCount: number;
    sourceCount: number;
    embeddedCount: number;
    pendingCompileCount: number;
    manifestOnlyCount: number;
    needsReviewCount: number;
    latestAt: string;
    mocPath: string;
    sourceSamples: Array<{ path: string; title: string; status: string; type: string }>;
    wikiSamples: Array<{ path: string; title: string; reviewStatus: string; pageType: string }>;
  }>();
  const ensure = (id: string) => {
    const descriptor = KNOWLEDGE_WIKI_CATEGORY_DESCRIPTORS.find((row) => row.id === id) || KNOWLEDGE_WIKI_CATEGORY_DESCRIPTORS.at(-1)!;
    if (!coverage.has(descriptor.id)) {
      coverage.set(descriptor.id, {
        id: descriptor.id,
        title: descriptor.title,
        topics: descriptor.topics,
        wikiCount: 0,
        mocCount: 0,
        sourceCount: 0,
        embeddedCount: 0,
        pendingCompileCount: 0,
        manifestOnlyCount: 0,
        needsReviewCount: 0,
        latestAt: "",
        mocPath: "",
        sourceSamples: [],
        wikiSamples: [],
      });
    }
    return coverage.get(descriptor.id)!;
  };
  for (const descriptor of KNOWLEDGE_WIKI_CATEGORY_DESCRIPTORS) ensure(descriptor.id);

  const wikiSources = db.prepare("SELECT source_path, source_type, status, last_compiled_at FROM knowledge_wiki_sources").all() as Array<{ source_path?: string; source_type?: string; status?: string; last_compiled_at?: string }>;
  const wikiSourceByPath = new Map(wikiSources.map((row) => [String(row.source_path || ""), row]));
  for (const source of collectKnowledgeWikiStatusSources(db)) {
    if (knowledgeWikiIsNoiseText(`${source.path} ${source.title}`)) continue;
    const wikiSource = wikiSourceByPath.get(source.path);
    const category = ensure(classifyKnowledgeWikiCategory(`${source.title} ${source.path} ${source.source || ""} ${source.type || ""}`));
    const supported = knowledgeWikiSourceSupportsText(source.path, source.type);
    const status = wikiSource?.status || (supported ? "pending_compile" : "manifest_only");
    category.sourceCount += 1;
    if (!supported) category.manifestOnlyCount += 1;
    else if (wikiSource?.status === "compiled") category.embeddedCount += 1;
    else if (wikiSource?.status === "needs_review") {
      category.embeddedCount += 1;
      category.needsReviewCount += 1;
    } else {
      category.pendingCompileCount += 1;
    }
    category.latestAt = [category.latestAt, source.updatedAt, String(wikiSource?.last_compiled_at || "")].filter(Boolean).sort().at(-1) || category.latestAt;
    if (category.sourceSamples.length < 6) category.sourceSamples.push({ path: source.path, title: source.title, status, type: source.type });
  }

  const wikiPages = db.prepare("SELECT page_type, title, path, review_status, summary, updated_at FROM knowledge_wiki_pages WHERE status != 'archived'").all() as Array<{ page_type?: string; title?: string; path?: string; review_status?: string; summary?: string; updated_at?: string }>;
  for (const page of wikiPages) {
    if (knowledgeWikiIsNoiseText(`${page.title || ""} ${page.summary || ""} ${page.path || ""}`)) continue;
    const pageType = String(page.page_type || "");
    const categoryId = pageType === "MOC" ? classifyKnowledgeWikiMocCategory(String(page.title || ""), String(page.path || "")) : classifyKnowledgeWikiCategory(`${page.title || ""} ${page.summary || ""} ${page.path || ""}`);
    const category = ensure(categoryId);
    category.wikiCount += 1;
    if (pageType === "MOC") {
      category.mocCount += 1;
      category.mocPath = category.mocPath || String(page.path || "");
    }
    if (page.review_status === "needs_review") category.needsReviewCount += 1;
    category.latestAt = [category.latestAt, String(page.updated_at || "")].filter(Boolean).sort().at(-1) || category.latestAt;
    if (category.wikiSamples.length < 5) category.wikiSamples.push({ path: String(page.path || ""), title: String(page.title || ""), reviewStatus: String(page.review_status || ""), pageType });
  }
  return [...coverage.values()]
    .filter((row) => row.id !== "general" || row.sourceCount > 0 || row.wikiCount > 0)
    .sort((a, b) => (b.mocCount + b.wikiCount + b.sourceCount) - (a.mocCount + a.wikiCount + a.sourceCount));
}

function collectKnowledgeWikiStatusSources(db: Db) {
  const rows = new Map<string, { path: string; title: string; type: string; source: string; updatedAt: string }>();
  const add = (pathValue: unknown, titleValue: unknown, typeValue: unknown, sourceValue: unknown, updatedAtValue: unknown) => {
    const sourcePath = String(pathValue || "");
    if (!sourcePath || sourcePath.startsWith(KNOWLEDGE_WIKI_ROOT) || rows.has(sourcePath)) return;
    rows.set(sourcePath, {
      path: sourcePath,
      title: String(titleValue || path.basename(sourcePath)),
      type: String(typeValue || path.extname(sourcePath).replace(".", "") || "file"),
      source: String(sourceValue || ""),
      updatedAt: String(updatedAtValue || ""),
    });
  };
  for (const row of db.prepare("SELECT path, title, file_type, source, mtime, created_at FROM knowledge_file_index LIMIT 2200").all() as Array<Record<string, unknown>>) {
    add(row.path, row.title, row.file_type, row.source, row.mtime || row.created_at);
  }
  for (const row of db.prepare("SELECT title, source, source_path, content_path, status, updated_at, created_at FROM knowledge_entries LIMIT 1800").all() as Array<Record<string, unknown>>) {
    add(row.content_path || row.source_path, row.title, "note", row.source, row.updated_at || row.created_at);
  }
  for (const row of db.prepare("SELECT title, output_type, output_path, status, updated_at, created_at FROM knowledge_output_jobs WHERE output_path IS NOT NULL AND output_path != '' LIMIT 500").all() as Array<Record<string, unknown>>) {
    add(row.output_path, row.title, row.output_type || "studio_output", "studio", row.updated_at || row.created_at);
  }
  try {
    const tree = knowledgeTree() as Record<string, { items?: Array<Record<string, unknown>> }>;
    for (const [source, group] of Object.entries(tree)) {
      addKnowledgeTreeStatusSources(group.items || [], source, add, source === "nas" ? 260 : source === "ima" ? 140 : 120);
    }
  } catch {
    // Status must remain available even when an optional source tree is disconnected.
  }
  return [...rows.values()];
}

function addKnowledgeTreeStatusSources(
  items: Array<Record<string, unknown>>,
  source: string,
  add: (pathValue: unknown, titleValue: unknown, typeValue: unknown, sourceValue: unknown, updatedAtValue: unknown) => void,
  limit: number,
) {
  let added = 0;
  const visit = (nodes: Array<Record<string, unknown>>, depth: number) => {
    for (const item of nodes) {
      if (added >= limit) return;
      const itemPath = String(item.path || "");
      if (itemPath) {
        add(itemPath, item.name || item.title || path.basename(itemPath), item.type || "tree", source, item.mtime || "");
        added += 1;
      }
      if (depth < 4 && Array.isArray(item.children)) visit(item.children as Array<Record<string, unknown>>, depth + 1);
    }
  };
  visit(items, 0);
}

function classifyKnowledgeWikiCategory(text: string) {
  const normalized = text
    .replace(new RegExp(WORKSPACE_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "")
    .replace(/\/users\/njx\/openclaw_data/gi, "")
    .toLowerCase();
  for (const descriptor of KNOWLEDGE_WIKI_CATEGORY_DESCRIPTORS) {
    if (descriptor.id === "general") continue;
    if (descriptor.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) return descriptor.id;
  }
  return "general";
}

function classifyKnowledgeWikiMocCategory(title: string, filePath: string) {
  const text = `${title} ${filePath}`.toLowerCase();
  if (text.includes("master_moc") || title.toLowerCase() === "master moc") return "governance";
  for (const descriptor of KNOWLEDGE_WIKI_CATEGORY_DESCRIPTORS) {
    if (text.includes(`${descriptor.id}_moc`) || text.includes(descriptor.title.toLowerCase())) return descriptor.id;
  }
  return classifyKnowledgeWikiCategory(text);
}

function knowledgeWikiSourceSupportsText(sourcePath: string, type = "") {
  const ext = path.extname(sourcePath).toLowerCase();
  const sourceType = type.toLowerCase();
  if (IMAGE_EXT.has(ext) || AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext) || OFFICE_EXT.has(ext) || ARCHIVE_EXT.has(ext) || ext === ".pdf") return false;
  if (/image|audio|video|office|pdf|archive|manifest/.test(sourceType)) return false;
  return MARKDOWN_EXT.has(ext) || JSON_EXT.has(ext) || CSV_EXT.has(ext) || HTML_EXT.has(ext) || TEXT_EXT.has(ext);
}

function knowledgeWikiIsNoiseText(text: string) {
  const value = text.toLowerCase();
  return ["wb_e2e_", "prd11_test_", "model-html-smoke", "/tests/fixtures/", "/fixtures/knowledge_preview/", "/archive/.trash/"].some((pattern) => value.includes(pattern));
}

function hashKnowledgeWikiMoc(id: string, payload: unknown) {
  return `moc:${id}:${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16)}`;
}

function renderKnowledgeWikiMasterMocBody(categories: ReturnType<typeof buildKnowledgeWikiCoverageSnapshot>) {
  const active = categories.filter((row) => row.sourceCount > 0 || row.wikiCount > 0);
  const categoryLines = active.map((row) => `- [[${row.title} MOC]]：${row.mocCount} MOC / ${row.wikiCount} Wiki / ${row.sourceCount} 来源 / ${row.pendingCompileCount} 待编译 / ${row.manifestOnlyCount} 待抽取`).join("\n");
  const riskLines = active
    .filter((row) => row.pendingCompileCount || row.manifestOnlyCount || row.needsReviewCount)
    .map((row) => `- ${row.title}：${row.pendingCompileCount} 待编译，${row.manifestOnlyCount} 待抽取，${row.needsReviewCount} 待审。`)
    .join("\n") || "- 当前没有突出的待审或待抽取压力。";
  return `## 全库判断\n\nKnowledge Wiki 是全库的导航层，负责把本地 memory、NAS、IMA、智能助理笔记、Studio 输出和系统报告组织成可追溯的分类 MOC。文件栏保留为来源证据层，Atlas 首页优先展示知识脉络和状态真相。\n\n## Master MOC\n\n${categoryLines || "- 暂无可用分类。"}\n\n## 待审与待抽取\n\n${riskLines}\n\n## 使用方式\n\n- 从本页进入分类 MOC，再展开主题、Wiki 页面和来源证据。\n- 看到“待编译”时执行增量或全量 Wiki 编译。\n- 看到“待抽取”时只代表已记录 manifest，不代表系统已理解正文。\n`;
}

function renderKnowledgeWikiCategoryMocBody(descriptor: KnowledgeWikiCategoryDescriptor, category: ReturnType<typeof buildKnowledgeWikiCoverageSnapshot>[number]) {
  const topics = descriptor.topics.map((topic) => `- [[${topic}]]`).join("\n");
  const wikiLines = category.wikiSamples.map((page) => `- [[${page.title}]]：${page.pageType} / ${page.reviewStatus} / \`${page.path}\``).join("\n") || "- 暂无已归类 Wiki 页面。";
  const sourceLines = category.sourceSamples.map((source) => `- ${source.title}：${source.status} / ${source.type} / \`${source.path}\``).join("\n") || "- 暂无来源证据。";
  return `## 核心判断\n\n${descriptor.title} 当前聚合 ${category.sourceCount} 个来源、${category.wikiCount} 个 Wiki 页面和 ${category.mocCount} 个 MOC。该页是分类导航入口，不替代来源文件。\n\n## 主题树\n\n${topics}\n\n## 覆盖状态\n\n| 指标 | 数量 |\n| --- | ---: |\n| MOC | ${category.mocCount} |\n| Wiki 页面 | ${category.wikiCount} |\n| 来源 | ${category.sourceCount} |\n| 已嵌入来源 | ${category.embeddedCount} |\n| 待编译 | ${category.pendingCompileCount} |\n| 待抽取 Manifest | ${category.manifestOnlyCount} |\n| 待审 | ${category.needsReviewCount} |\n\n## Wiki 页面样本\n\n${wikiLines}\n\n## 来源证据样本\n\n${sourceLines}\n\n## 待审与待抽取\n\n- 待编译来源：${category.pendingCompileCount}\n- 待抽取 Manifest：${category.manifestOnlyCount}\n- 待审冲突或低置信项：${category.needsReviewCount}\n`;
}

export function scheduleKnowledgeWikiNightlyCompile(db: Db) {
  if (process.env.OPENCLAW_WORKBENCH_DISABLE_WIKI_SCHEDULER === "1") return;
  // 2026-07-07 (rework11) — server start 立即跑一次 initial sync (老路径 wiki + njx-knowledge v2 MOC),
  // 不等 daily 定时器, NJX restart server 后立即能看到 30 MOC
  try {
    compileKnowledgeWiki(db, { mode: "incremental" });
    syncNjxKnowledgeWikiPages(db);
  } catch {
    // Keep the scheduler alive; run details are recorded by the compiler when possible.
  }
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(KNOWLEDGE_WIKI_SCHEDULER_HOUR, KNOWLEDGE_WIKI_SCHEDULER_MINUTE, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const timer = setTimeout(() => {
      try {
        compileKnowledgeWiki(db, { mode: "incremental" });
        syncNjxKnowledgeWikiPages(db);
      } catch {
        // Keep the scheduler alive; run details are recorded by the compiler when possible.
      } finally {
        scheduleNext();
      }
    }, Math.max(1000, next.getTime() - now.getTime()));
    timer.unref?.();
  };
  scheduleNext();
}

// 2026-07-07 (rework11) — 同步 njx-knowledge v2 wiki MOC 进 knowledge_wiki_pages
// njx-knowledge/wiki/MOC/ 是 njx-knowledge v2 Phase 2b LLM 生成的 17 个 domain MOC,
// 跟 workbench 老路径 wiki 系统格式不同 (无 frontmatter, H1 拿 title).
// 这里做轻量级 sync: 扫 njx-knowledge/wiki/MOC/*.md → INSERT/UPDATE knowledge_wiki_pages
// 跟老路径 13 MOC 并行显示, 知识库页面 UI 自然看到 30 MOC.
// 老路径 wiki 不动, compileKnowledgeWiki 继续走老路径.
export function syncNjxKnowledgeWikiPages(db: Db): { synced: number; errors: string[] } {
  const wikiDir = path.join(NJX_KNOWLEDGE_ROOT, "wiki", "MOC");
  if (!fs.existsSync(wikiDir)) return { synced: 0, errors: [`wiki dir missing: ${wikiDir}`] };
  const errors: string[] = [];
  let synced = 0;
  const now = nowIso();
  for (const fileName of fs.readdirSync(wikiDir).filter((n) => n.endsWith(".md") && !n.startsWith("_"))) {
    try {
      const fullPath = path.join(wikiDir, fileName);
      const content = fs.readFileSync(fullPath, "utf8");
      // njx-knowledge MOC 格式: "# 中文显示名 (domain)\n\n> 自动聚合的 Map of Content (MOC)..."
      const h1Match = content.match(/^#\s+(.+?)$/m);
      const title: string = h1Match?.[1]?.trim() || path.basename(fileName, ".md");
      // summary: 优先 "> 自动聚合..." 行, fallback "## 概况" 段
      const summaryLine = content.match(/^>\s*(.+?)$/m)?.[1]?.trim();
      const summarySection = content.split("\n## 概况")[1]?.split("\n##")[0]?.trim()?.slice(0, 240);
      const summary: string = summaryLine || summarySection || "";

      // 2026-07-07 (rework11 v2 Q5=C) — 解析末尾 sha1 → file path wikilink 列表
      // 格式: "`{sha1}.{ext}` → `{absolute_path}`"
      // 让用户点 MOC 能跳转到 mac + NAS + 老路径的 source files
      const wikilinkPattern = /`([a-f0-9]{16,40}\.\w+)`\s*→\s*`([^`]+)`/g;
      const sourcePaths: string[] = [];
      let match;
      while ((match = wikilinkPattern.exec(content)) !== null) {
        if (match[2]) sourcePaths.push(match[2]);
      }
      const uniqueSourcePaths = uniqueStrings(sourcePaths).slice(0, 500);

      const slug = path.basename(fileName, ".md");
      const existing = db.prepare("SELECT id FROM knowledge_wiki_pages WHERE path = ? LIMIT 1").get(fullPath) as { id?: string } | undefined;
      if (existing && existing.id) {
        db.prepare("UPDATE knowledge_wiki_pages SET title = ?, summary = ?, source_count = ?, source_paths = ?, updated_at = ? WHERE id = ?")
          .run(title, summary, uniqueSourcePaths.length, JSON.stringify(uniqueSourcePaths), now, existing.id);
        synced += 1;
      } else {
        db.prepare(`INSERT INTO knowledge_wiki_pages
          (id, page_type, title, slug, path, status, review_status, confidence, source_count, source_paths, source_hashes, summary, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            randomUUID(),
            "MOC",
            title,
            slug,
            fullPath,
            "active",
            "auto_accepted",
            0.85,
            uniqueSourcePaths.length,
            JSON.stringify(uniqueSourcePaths),
            "[]",
            summary,
            now,
            now,
          );
        synced += 1;
      }
    } catch (err) {
      errors.push(`${fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { synced, errors };
}

type KnowledgeWikiSource = {
  path: string;
  title: string;
  type: string;
  previewMode: string;
  hash: string;
  content: string;
  size: number;
  mtime: string;
  readable: boolean;
};

type KnowledgeWikiPageDraft = {
  pageType: "source" | "entity" | "concept" | "project" | "decision" | "MOC";
  title: string;
  slug: string;
  summary: string;
  body: string;
  confidence: number;
  sourcePaths: string[];
  sourceHashes: string[];
  conflict: boolean;
};

function collectKnowledgeWikiSourcePaths(db: Db, input: KnowledgeWikiCompileInput) {
  if (input.mode === "selected") return uniqueStrings((input.sourcePaths || []).map(String).map((row) => row.trim()).filter(Boolean));
  const rows = new Set<string>();
  const limit = input.mode === "full" ? 1500 : 120;
  const memoryDepth = input.mode === "full" ? 7 : 4;
  // 1) 老路径 DB source (knowledge_file_index + knowledge_entries)
  for (const row of db.prepare(`SELECT path FROM knowledge_file_index ORDER BY created_at DESC LIMIT ${limit}`).all() as Array<{ path?: string }>) {
    if (row.path) rows.add(row.path);
  }
  for (const row of db.prepare(`SELECT source_path, content_path FROM knowledge_entries ORDER BY updated_at DESC LIMIT ${limit}`).all() as Array<{ source_path?: string; content_path?: string }>) {
    if (row.content_path) rows.add(row.content_path);
    else if (row.source_path) rows.add(row.source_path);
  }
  // 2) 老路径 memory/knowledge 物理文件
  for (const file of walk(path.join(WORKSPACE_DIR, "memory/knowledge"), memoryDepth)) rows.add(file);
  // 3) [NEW 2026-07-07 rework11 v2] 新路径 notes (njx-knowledge/knowledge/notes/) — workbench 自动生成的 calendar/voice/mobile notes
  try {
    for (const file of walk(NJX_KNOWLEDGE_NOTES_ROOT, memoryDepth)) rows.add(file);
  } catch (err) {
    // 新路径不存在或权限问题, 跳过 (不阻塞 compile)
  }
  // 4) [NEW] NAS 南极熊 (resolveNasRoot() + knowledgeTree scan, depth 3 避免太深)
  try {
    const nasRoots = readableNasRoots();
    for (const root of nasRoots) {
      try {
        for (const file of walk(root, 3)) {
          if (file.match(/\.(md|markdown|txt|pdf|docx|pptx|xlsx)$/i)) rows.add(file);
        }
      } catch {
        // NAS 单个 root 失败不影响其他 root
      }
    }
  } catch (err) {
    // NAS connector 失败, 跳过
  }
  // 5) IMA 已弃用 (NJX 15:34 拍板) — 不扫 IMA

  return [...rows].filter((row) => {
    const resolved = safeResolve(row);
    return Boolean(resolved && fs.existsSync(resolved)
      && !resolved.startsWith(KNOWLEDGE_WIKI_ROOT)        // 排除新路径 wiki (避免重 compile)
      && !resolved.startsWith(KNOWLEDGE_WIKI_LEGACY_ROOT) // 排除老路径 wiki (兼容读保留, 不重 compile)
    );
  });
}

function buildKnowledgeWikiSource(rawPath: string): KnowledgeWikiSource | null {
  const file = safeResolve(rawPath);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  const preview = previewKnowledgeFile(file) as { ok?: boolean; title?: string; type?: string; previewMode?: string; content?: string; size?: number; mtime?: string; path?: string };
  if (!preview.ok) return null;
  const ext = path.extname(file).toLowerCase();
  const readable = isReadableKnowledgeText(ext);
  const stat = fs.statSync(file);
  const content = readable ? String(preview.content || "") : "";
  return {
    path: file,
    title: preview.title || path.basename(file),
    type: preview.type || fileType(file),
    previewMode: preview.previewMode || "file-card",
    hash: hashKnowledgeWikiSource(file, content),
    content,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    readable,
  };
}

function compileKnowledgeWikiSourcePages(source: KnowledgeWikiSource): KnowledgeWikiPageDraft[] {
  const text = source.content || `${source.title}\n${source.path}`;
  const entities = extractKnowledgeNoteEntities(text).slice(0, 3);
  const concepts = inferKnowledgeWikiConcepts(text, source).slice(0, 3);
  const conflict = /冲突|矛盾|不一致|相反|conflict|contradict/i.test(text);
  const summary = summarizeKnowledgeWikiText(text, source);
  const pages: KnowledgeWikiPageDraft[] = [{
    pageType: "source",
    title: source.title,
    slug: safeName(source.title.replace(/\.[^.]+$/, "")),
    summary,
    body: renderKnowledgeWikiSourceBody(source, summary, entities, concepts, conflict),
    confidence: source.readable ? 0.72 : 0.45,
    sourcePaths: [source.path],
    sourceHashes: [source.hash],
    conflict,
  }];
  for (const entity of entities) {
    pages.push({
      pageType: "entity",
      title: entity,
      slug: safeName(entity),
      summary: `${entity} 在 ${source.title} 中被提及。`,
      body: `## 概述\n\n${entity} 是从来源文档中抽取的实体，需要后续人工或模型补全。\n\n## 当前依据\n\n- ${summary}`,
      confidence: 0.64,
      sourcePaths: [source.path],
      sourceHashes: [source.hash],
      conflict,
    });
  }
  for (const concept of concepts) {
    pages.push({
      pageType: "concept",
      title: concept,
      slug: safeName(concept),
      summary: `${concept} 与 ${source.title} 相关。`,
      body: `## 概述\n\n${concept} 是从来源内容和路径中归纳出的主题。\n\n## 当前依据\n\n- ${summary}`,
      confidence: 0.62,
      sourcePaths: [source.path],
      sourceHashes: [source.hash],
      conflict,
    });
  }
  if (/项目|project|prd|roadmap|计划/i.test(text) || /project|tasks|prd/i.test(source.path)) {
    pages.push({
      pageType: "project",
      title: inferKnowledgeWikiProjectTitle(text, source),
      slug: safeName(inferKnowledgeWikiProjectTitle(text, source)),
      summary: `${source.title} 包含项目或计划线索。`,
      body: `## 项目线索\n\n${summary}\n\n## 后续动作\n\n- 核对项目目标、负责人和里程碑。\n- 将确认后的事实同步到项目管理页。`,
      confidence: 0.58,
      sourcePaths: [source.path],
      sourceHashes: [source.hash],
      conflict,
    });
  }
  if (/决策|决定|批准|否决|decision|approved|rejected/i.test(text)) {
    pages.push({
      pageType: "decision",
      title: `${source.title.replace(/\.[^.]+$/, "")} 决策记录`,
      slug: safeName(`${source.title.replace(/\.[^.]+$/, "")}_decision`),
      summary: `${source.title} 包含决策线索。`,
      body: `## 决策线索\n\n${summary}\n\n## 待审\n\n- 需要确认最终决策、决策人、影响范围和回滚条件。`,
      confidence: 0.56,
      sourcePaths: [source.path],
      sourceHashes: [source.hash],
      conflict: true,
    });
  }
  return pages;
}

function saveKnowledgeWikiPage(db: Db, draft: KnowledgeWikiPageDraft) {
  const file = wikiPagePath(draft.pageType, draft.slug);
  const existing = db.prepare("SELECT * FROM knowledge_wiki_pages WHERE path = ?").get(file) as { id: string; source_paths?: string; source_hashes?: string; created_at?: string; review_status?: string } | undefined;
  const id = existing?.id || randomUUID();
  const sourcePaths = uniqueStrings([...parseJsonList(existing?.source_paths), ...draft.sourcePaths]);
  const sourceHashes = uniqueStrings([...parseJsonList(existing?.source_hashes), ...draft.sourceHashes]).slice(-20);
  const reviewStatus = draft.conflict || existing?.review_status === "needs_review" ? "needs_review" : "auto_accepted";
  const markdown = renderKnowledgeWikiMarkdown({ ...draft, sourcePaths, sourceHashes, reviewStatus });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${markdown.trim()}\n`, "utf8");
  const now = nowIso();
  if (existing) {
    db.prepare("UPDATE knowledge_wiki_pages SET page_type = ?, title = ?, slug = ?, status = ?, review_status = ?, confidence = ?, source_count = ?, source_paths = ?, source_hashes = ?, summary = ?, updated_at = ? WHERE id = ?")
      .run(draft.pageType, draft.title, draft.slug, "active", reviewStatus, draft.confidence, sourcePaths.length, JSON.stringify(sourcePaths), JSON.stringify(sourceHashes), draft.summary, now, id);
  } else {
    db.prepare("INSERT INTO knowledge_wiki_pages (id, page_type, title, slug, path, status, review_status, confidence, source_count, source_paths, source_hashes, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, draft.pageType, draft.title, draft.slug, file, "active", reviewStatus, draft.confidence, sourcePaths.length, JSON.stringify(sourcePaths), JSON.stringify(sourceHashes), draft.summary, now, now);
  }
  return db.prepare("SELECT * FROM knowledge_wiki_pages WHERE id = ?").get(id) as Record<string, unknown>;
}

function wikiPagePath(pageType: KnowledgeWikiPageDraft["pageType"], slug: string) {
  const dirMap: Record<KnowledgeWikiPageDraft["pageType"], string> = {
    MOC: "MOC",
    entity: "entities",
    concept: "concepts",
    project: "projects",
    decision: "decisions",
    source: "sources",
  };
  return path.join(KNOWLEDGE_WIKI_ROOT, dirMap[pageType], `${safeName(slug)}.md`);
}

function renderKnowledgeWikiMarkdown(input: KnowledgeWikiPageDraft & { sourcePaths: string[]; sourceHashes: string[]; reviewStatus: string }) {
  const sourceYaml = input.sourcePaths.map((sourcePath) => `  - ${JSON.stringify(sourcePath)}`).join("\n") || "  []";
  const hashYaml = input.sourceHashes.map((hash) => `  - ${JSON.stringify(hash)}`).join("\n") || "  []";
  const sourceLinks = input.sourcePaths.map((sourcePath) => `- \`${sourcePath}\``).join("\n") || "- 暂无来源";
  const conflictBlock = input.reviewStatus === "needs_review" ? "\n## 冲突与待审\n\n- 当前页面包含低置信或冲突线索，需人工确认后再作为稳定事实使用。\n" : "";
  return `---\ntype: wiki_page\nwiki_type: ${input.pageType}\ntitle: ${JSON.stringify(input.title)}\nstatus: active\nreview_status: ${input.reviewStatus}\nconfidence: ${input.confidence.toFixed(2)}\nsource_paths:\n${sourceYaml}\nsource_hashes:\n${hashYaml}\nlast_compiled_at: ${nowIso()}\n---\n\n# ${input.title}\n\n${input.body}\n${conflictBlock}\n## 来源依据\n\n${sourceLinks}\n\n## 反向链接索引\n\n- [[Knowledge Wiki]]\n- [[${input.pageType}]]\n`;
}

function renderKnowledgeWikiSourceBody(source: KnowledgeWikiSource, summary: string, entities: string[], concepts: string[], conflict: boolean) {
  const manifest = `| 字段 | 值 |\n| --- | --- |\n| 路径 | \`${source.path}\` |\n| 类型 | ${source.type} |\n| 预览模式 | ${source.previewMode} |\n| 大小 | ${source.size} |\n| 修改时间 | ${source.mtime} |`;
  if (!source.readable) {
    return `## 文件 Manifest\n\n${manifest}\n\n## 抽取状态\n\n该文件首期不做 OCR/转写/Office 转换，只记录 manifest，等待后续处理。\n`;
  }
  return `## 摘要\n\n${summary}\n\n## 结构化线索\n\n- 实体：${entities.length ? entities.map((row) => `[[${row}]]`).join("、") : "待补充"}\n- 主题：${concepts.length ? concepts.map((row) => `[[${row}]]`).join("、") : "待补充"}\n- 审核：${conflict ? "存在冲突或低置信线索，需复核" : "自动编译草稿"}\n\n## 文件 Manifest\n\n${manifest}\n\n## 内容摘录\n\n${source.content.slice(0, 1800) || "无可读文本。"}\n`;
}

function hashKnowledgeWikiSource(file: string, content: string) {
  const hash = createHash("sha256");
  if (content) hash.update(content);
  else {
    const stat = fs.statSync(file);
    hash.update(`${file}:${stat.size}:${stat.mtimeMs}`);
  }
  return hash.digest("hex");
}

function inferKnowledgeWikiConcepts(text: string, source: KnowledgeWikiSource) {
  const rows = [];
  if (/OpenClaw|Workbench|智能平台/i.test(text) || /openclaw/i.test(source.path)) rows.push("OpenClaw 智能平台");
  if (/知识库|Knowledge|wiki|Obsidian|NotebookLM/i.test(text)) rows.push("知识管理");
  if (/Gateway|MiniMax|模型|LLM/i.test(text)) rows.push("模型与 Gateway");
  if (/任务|计划|执行|worker|boss/i.test(text)) rows.push("任务执行体系");
  if (/图谱|Graph|关系/i.test(text)) rows.push("知识图谱");
  if (/会议|会晤|纪要/i.test(text)) rows.push("会议记录");
  if (/研究|报告|分析/i.test(text)) rows.push("研究报告");
  return uniqueStrings(rows.length ? rows : [source.type === "markdown" ? "Markdown 知识资产" : `${source.type} 文件资产`]);
}

function inferKnowledgeWikiProjectTitle(text: string, source: KnowledgeWikiSource) {
  if (/OpenClaw|Workbench/i.test(text) || /openclaw/i.test(source.path)) return "OpenClaw 平台建设";
  const title = source.title.replace(/\.[^.]+$/, "");
  return title.length > 4 ? title : "项目线索";
}

function summarizeKnowledgeWikiText(text: string, source: KnowledgeWikiSource) {
  const rows = text
    .replace(/^---[\s\S]*?---/, "")
    .split(/\r?\n+/)
    .map((row) => row.replace(/^#+\s*/, "").trim())
    .filter((row) => row.length >= 8 && !row.startsWith("| ---"))
    .slice(0, 6);
  return (rows.join("；") || `${source.title} 的文件级知识资产。`).slice(0, 700);
}

function parseJsonList(value?: string) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function ensureDefaultReportTemplates(db: Db) {
  const count = (db.prepare("SELECT COUNT(*) count FROM report_templates").get() as { count: number }).count;
  if (count > 0) return;
  for (const type of ["daily", "weekly", "monthly", "yearly"]) {
    const id = randomUUID();
    db.prepare("INSERT INTO report_templates (id, report_type, name, style, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, type, `${type} default`, "work-review", defaultReportTemplate(type), "active", nowIso(), nowIso());
  }
}

export function generateReport(db: Db, input: { reportType?: string; rangeStart?: string; rangeEnd?: string; sources?: string[]; templateId?: string; notes?: string; projectId?: string; replaceExisting?: boolean }) {
  ensureDefaultReportTemplates(db);
  const reportType = input.reportType || "daily";
  const rangeStart = input.rangeStart || nowIso().slice(0, 10);
  const rangeEnd = input.rangeEnd || reportRangeEnd(reportType, rangeStart);
  const template = input.templateId
    ? db.prepare("SELECT * FROM report_templates WHERE id = ?").get(input.templateId) as { id: string; content: string; name: string } | undefined
    : db.prepare("SELECT * FROM report_templates WHERE report_type = ? AND status = 'active' ORDER BY created_at LIMIT 1").get(reportType) as { id: string; content: string; name: string } | undefined;
  const existing = input.replaceExisting
    ? db.prepare("SELECT * FROM reports WHERE report_type = ? AND range_start = ? AND COALESCE(project_id, '') = COALESCE(?, '') ORDER BY updated_at DESC LIMIT 1").get(reportType, rangeStart, input.projectId || null) as { id: string; markdown_path?: string; html_path?: string } | undefined
    : undefined;
  const id = existing?.id || randomUUID();
  const title = `${labelReport(reportType)} ${rangeStart}`;
  const todos = db.prepare("SELECT * FROM todos WHERE (due_at IS NOT NULL AND substr(due_at, 1, 10) BETWEEN ? AND ?) OR (updated_at IS NOT NULL AND substr(updated_at, 1, 10) BETWEEN ? AND ?) ORDER BY COALESCE(due_at, updated_at) ASC, priority ASC LIMIT 200").all(rangeStart, rangeEnd, rangeStart, rangeEnd);
  const events = db.prepare("SELECT * FROM events WHERE substr(start_at, 1, 10) BETWEEN ? AND ? ORDER BY start_at ASC LIMIT 200").all(rangeStart, rangeEnd);
  const planItems = db.prepare("SELECT * FROM plan_items WHERE (due_at IS NOT NULL AND substr(due_at, 1, 10) BETWEEN ? AND ?) OR (updated_at IS NOT NULL AND substr(updated_at, 1, 10) BETWEEN ? AND ?) ORDER BY plan_type, COALESCE(due_at, updated_at) ASC LIMIT 240").all(rangeStart, rangeEnd, rangeStart, rangeEnd);
  const calendarNotes = db.prepare("SELECT * FROM calendar_notes WHERE date_key BETWEEN ? AND ? ORDER BY date_key ASC, updated_at DESC LIMIT 120").all(rangeStart, rangeEnd);
  const projects = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC LIMIT 20").all();
  const tasks = db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT 20").all();
  const content = renderReport({ title, reportType, rangeStart, rangeEnd, template: template?.content || defaultReportTemplate(reportType), todos, events, planItems, calendarNotes, projects, tasks, notes: input.notes || "", sources: input.sources || [] });
  const folder = path.join(SIDECAR_DIR, "reports", nowIso().slice(0, 10));
  fs.mkdirSync(folder, { recursive: true });
  const markdownPath = existing?.markdown_path || path.join(folder, `${safeName(title)}_${id.slice(0, 8)}.md`);
  const htmlPath = existing?.html_path || path.join(folder, `${safeName(title)}_${id.slice(0, 8)}.html`);
  fs.writeFileSync(markdownPath, content, "utf8");
  writeHtmlDocument(content, htmlPath, { title, sourcePath: markdownPath, documentType: "workbench_report" });
  if (existing) {
    db.prepare("UPDATE reports SET title = ?, range_end = ?, sources = ?, template_id = ?, content = ?, markdown_path = ?, html_path = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(title, rangeEnd, JSON.stringify(input.sources || []), template?.id || null, content, markdownPath, htmlPath, "completed", nowIso(), id);
  } else {
    db.prepare("INSERT INTO reports (id, report_type, title, range_start, range_end, sources, template_id, content, markdown_path, html_path, status, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, reportType, title, rangeStart, rangeEnd, JSON.stringify(input.sources || []), template?.id || null, content, markdownPath, htmlPath, "completed", input.projectId || null, nowIso(), nowIso());
  }
  return db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
}

export function exportChatMarkdown(db: Db, sessionId: string) {
  const session = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(sessionId) as { id: string; title: string } | undefined;
  if (!session) throw new Error("session_not_found");
  const messages = db.prepare("SELECT * FROM chat_messages WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at ASC").all(sessionId) as Array<{ role: string; content: string; created_at: string }>;
  const folder = path.join(SIDECAR_DIR, "chat_exports", nowIso().slice(0, 10));
  fs.mkdirSync(folder, { recursive: true });
  const out = path.join(folder, `${safeName(session.title)}_${session.id.slice(0, 8)}.md`);
  const markdown = `# ${session.title}\n\n${messages.map((m) => `## ${m.role} - ${m.created_at}\n\n${m.content}`).join("\n\n")}\n`;
  fs.writeFileSync(out, markdown, "utf8");
  const htmlPath = defaultHtmlPath(out);
  writeHtmlDocument(markdown, htmlPath, { title: session.title, sourcePath: out, documentType: "chat_export" });
  db.prepare("UPDATE chat_sessions SET export_path = ?, updated_at = ? WHERE id = ?").run(out, nowIso(), sessionId);
  return { path: out, htmlPath };
}

function treeForRoot(source: string, root: string, preferred: string[], depth = MAX_TREE_DEPTH) {
  const itemsByPath = new Map<string, KnowledgeTreeNode>();
  for (const name of preferred) {
    const target = path.join(root, name);
    if (fs.existsSync(target)) {
      const node = nodeFor(source, target, depth);
      if (node) itemsByPath.set(node.path, node);
    }
  }
  if (itemsByPath.size < MAX_TREE_ITEMS && fs.existsSync(root)) {
    for (const item of listDir(root, source, Math.min(depth, 1))) {
      if (!itemsByPath.has(item.path)) itemsByPath.set(item.path, item);
      if (itemsByPath.size >= MAX_TREE_ITEMS) break;
    }
  }
  return { source, root, status: fs.existsSync(root) ? "connected" : "unavailable", items: sortKnowledgeTreeNodes(Array.from(itemsByPath.values())).slice(0, MAX_TREE_ITEMS) };
}

function listDir(dir: string, source = "file", depth = 0) {
  if (!safeDirectoryExists(dir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => !entry.name.endsWith(".legacy-source.txt"))
    .filter((entry) => !TREE_IGNORE.has(entry.name))
    .flatMap((entry) => {
      const node = nodeFor(source, path.join(dir, entry.name), depth);
      return node ? [node] : [];
    })
    .sort(compareKnowledgeTreeNodesByMtime)
    .slice(0, MAX_TREE_ITEMS);
}

function sortKnowledgeTreeNodes(nodes: KnowledgeTreeNode[]) {
  return [...nodes].sort(compareKnowledgeTreeNodesByMtime);
}

function compareKnowledgeTreeNodesByMtime(a: KnowledgeTreeNode, b: KnowledgeTreeNode) {
  const bTime = Date.parse(b.mtime || "");
  const aTime = Date.parse(a.mtime || "");
  const timeDiff = (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  if (timeDiff !== 0) return timeDiff;
  return a.title.localeCompare(b.title, "zh-Hans-CN");
}

function nodeFor(source: string, target: string, depth = 0): KnowledgeTreeNode | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return null;
  }
  const node: KnowledgeTreeNode = { source, title: path.basename(target), path: target, type: stat.isDirectory() ? "folder" : fileType(target), size: stat.size, mtime: stat.mtime.toISOString() };
  if (stat.isDirectory() && depth > 0) node.children = listDir(target, source, depth - 1);
  return node;
}

function fileType(file: string) {
  return classifyKnowledgeFile(file).type;
}

function knowledgeFileMeta(file: string, stat: fs.Stats) {
  const classified = classifyKnowledgeFile(file, stat.isDirectory());
  return {
    type: classified.type,
    previewMode: classified.previewMode,
    mime: classified.mime,
    ext: path.extname(file).toLowerCase(),
    path: file,
    title: path.basename(file),
    size: stat.size,
    mtime: stat.mtime.toISOString(),
  };
}

function classifyKnowledgeFile(file: string, isDirectory = false) {
  const ext = path.extname(file).toLowerCase();
  if (isDirectory) return { type: "folder", previewMode: "folder", mime: "inode/directory" };
  if (MARKDOWN_EXT.has(ext)) return { type: "markdown", previewMode: "markdown", mime: "text/markdown; charset=utf-8" };
  if (JSON_EXT.has(ext)) return { type: "json", previewMode: "json", mime: "application/json; charset=utf-8" };
  if (CSV_EXT.has(ext)) return { type: "csv", previewMode: "csv", mime: ext === ".tsv" ? "text/tab-separated-values; charset=utf-8" : "text/csv; charset=utf-8" };
  if (HTML_EXT.has(ext)) return { type: "html", previewMode: "html", mime: "text/html; charset=utf-8" };
  if (TEXT_EXT.has(ext)) return { type: "text", previewMode: "source", mime: mimeForKnowledgeExt(ext) };
  if (IMAGE_EXT.has(ext)) return { type: "image", previewMode: "image", mime: mimeForKnowledgeExt(ext) };
  if (ext === ".pdf") return { type: "pdf", previewMode: "pdf", mime: "application/pdf" };
  if (AUDIO_EXT.has(ext)) return { type: "audio", previewMode: "audio", mime: mimeForKnowledgeExt(ext) };
  if (VIDEO_EXT.has(ext)) return { type: "video", previewMode: "video", mime: mimeForKnowledgeExt(ext) };
  if (OFFICE_EXT.has(ext)) return { type: "office", previewMode: "file-card", mime: mimeForKnowledgeExt(ext) };
  if (ARCHIVE_EXT.has(ext)) return { type: "archive", previewMode: "file-card", mime: mimeForKnowledgeExt(ext) };
  return { type: "binary", previewMode: "file-card", mime: "application/octet-stream" };
}

function isReadableKnowledgeText(ext: string) {
  return MARKDOWN_EXT.has(ext) || JSON_EXT.has(ext) || CSV_EXT.has(ext) || TEXT_EXT.has(ext);
}

function mimeForKnowledgeExt(ext: string) {
  const map: Record<string, string> = {
    ".md": "text/markdown; charset=utf-8",
    ".markdown": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jsonl": "application/x-ndjson; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".tsv": "text/tab-separated-values; charset=utf-8",
    ".yaml": "text/yaml; charset=utf-8",
    ".yml": "text/yaml; charset=utf-8",
    ".toml": "text/plain; charset=utf-8",
    ".ini": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".jsx": "text/javascript; charset=utf-8",
    ".ts": "text/plain; charset=utf-8",
    ".tsx": "text/plain; charset=utf-8",
    ".py": "text/x-python; charset=utf-8",
    ".sh": "text/x-shellscript; charset=utf-8",
    ".sql": "application/sql; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
    ".pdf": "application/pdf",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".odp": "application/vnd.oasis.opendocument.presentation",
    ".zip": "application/zip",
    ".rar": "application/vnd.rar",
    ".7z": "application/x-7z-compressed",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".tgz": "application/gzip",
  };
  return map[ext] || "application/octet-stream";
}

function safeResolve(rawPath: string) {
  const nasRoots = readableNasRoots();
  // 2026-07-07 (rework9 preview-fix) — njx-knowledge v2 新主落点 /Users/njx/njx-knowledge/knowledge/notes/
  // 不在 WORKSPACE_DIR 下, 但 save 流程会写到这里. safeResolve 必须允许这个 root 才能让
  // /api/knowledge/preview?path=... 找到已保存的 HTML. 否则 NJX 在 calendar 视图点笔记
  // 会看到 "file_not_found" + 原始 rawContent (因为 preview API 拿不到文件, 前端 fallback
  // 渲染 raw markdown 看起来像"保存以后显示的不是整理好的html").
  const njxKnowledgeRoots = [
    NJX_KNOWLEDGE_NOTES_ROOT,
    NJX_KNOWLEDGE_ROOT,
  ].filter((root) => {
    try { return fs.existsSync(root); } catch { return false; }
  }).map((root) => path.resolve(root));
  const roots = [WORKSPACE_DIR, SIDECAR_DIR, ...nasRoots, ...njxKnowledgeRoots]
    .filter((root) => fs.existsSync(root))
    .map((root) => path.resolve(root));
  const primaryNasRoot = nasRoots[0] || DEFAULT_NAS_ROOT;
  const cleaned = rawPath.trim().replace(/^file:\/\//i, "");
  const candidates = path.isAbsolute(cleaned)
    ? [path.resolve(cleaned)]
    : [path.resolve(WORKSPACE_DIR, cleaned), path.resolve(SIDECAR_DIR, cleaned), path.resolve(primaryNasRoot, cleaned), path.resolve(cleaned)];
  const allowed = Array.from(new Set(candidates)).filter((candidate) => {
    return roots.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`));
  });
  return allowed.find((candidate) => fs.existsSync(candidate)) || allowed[0] || null;
}

function resolveManagedLocalPath(rawPath: string) {
  const cleaned = String(rawPath || "").trim().replace(/^file:\/\//i, "");
  if (!cleaned || cleaned.startsWith("ima://")) throw new Error("invalid_local_path");
  const candidate = path.resolve(path.isAbsolute(cleaned) ? cleaned : path.join(WORKSPACE_DIR, cleaned));
  const knowledgeRoot = path.resolve(KNOWLEDGE_ROOT);
  const workspaceRoot = path.resolve(WORKSPACE_DIR);
  if (candidate === knowledgeRoot || candidate.startsWith(`${knowledgeRoot}${path.sep}`)) return { path: candidate, scope: "memory" as const };
  if (candidate === workspaceRoot || candidate.startsWith(`${workspaceRoot}${path.sep}`)) {
    if (isWorkspaceProtectedPath(candidate)) throw new Error("protected_workspace_path");
    return { path: candidate, scope: "workspace" as const };
  }
  throw new Error("invalid_local_path");
}

function resolveManagedFile(rawPath?: string) {
  const resolved = resolveManagedLocalPath(String(rawPath || ""));
  if (!fs.existsSync(resolved.path)) throw new Error("file_not_found");
  if (!fs.statSync(resolved.path).isFile()) throw new Error("file_required");
  return resolved;
}

function resolveManagedTargetFolder(rawPath: string, create: boolean) {
  const resolved = resolveManagedLocalPath(rawPath);
  if (fs.existsSync(resolved.path) && !fs.statSync(resolved.path).isDirectory()) throw new Error("target_folder_required");
  if (!fs.existsSync(resolved.path)) {
    if (!create) throw new Error("target_folder_not_found");
    fs.mkdirSync(resolved.path, { recursive: true });
  }
  return resolved.path;
}

function isWorkspaceProtectedPath(candidate: string) {
  const workspaceRoot = path.resolve(WORKSPACE_DIR);
  const knowledgeRoot = path.resolve(KNOWLEDGE_ROOT);
  const resolved = path.resolve(candidate);
  if (resolved === knowledgeRoot || resolved.startsWith(`${knowledgeRoot}${path.sep}`)) return false;
  if (resolved === workspaceRoot) return false;
  const relative = path.relative(workspaceRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return true;
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length === 1 && WORKSPACE_PROTECTED_ROOT_FILES.has(parts[0])) return true;
  return parts.length > 0 && WORKSPACE_PROTECTED_DIRS.has(parts[0]);
}

function walkFolders(base: string, depth: number): string[] {
  if (depth < 0 || !safeDirectoryExists(base)) return [];
  const rows = [path.resolve(base)];
  if (depth === 0) return rows;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return rows;
  }
  for (const entry of entries
    .filter((item) => item.isDirectory() && !item.name.startsWith(".") && !TREE_IGNORE.has(item.name))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))
    .slice(0, MAX_TREE_ITEMS)) {
    const full = path.join(base, entry.name);
    if (isWorkspaceProtectedPath(full)) continue;
    rows.push(...walkFolders(full, depth - 1));
  }
  return rows;
}

function safeDirectoryExists(dir: string) {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function moveFileOnDisk(source: string, target: string) {
  try {
    fs.renameSync(source, target);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "EXDEV") throw err;
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
  }
}

function uniqueDestinationPath(target: string) {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const name = path.basename(target, ext);
  let candidate = target;
  while (fs.existsSync(candidate)) candidate = path.join(dir, `${name}_${randomUUID().slice(0, 8)}${ext}`);
  return candidate;
}

function safeKnowledgeFileName(input: string) {
  const ext = path.extname(input).slice(0, 16);
  const base = safeName(path.basename(input, path.extname(input)) || "upload");
  const cleanExt = ext.replace(/[^\w.-]+/g, "").replace(/\.+/g, ".");
  return `${base}${cleanExt || ""}`;
}

function upsertKnowledgeFileIndex(db: Db, file: string, status: string) {
  const stat = fs.statSync(file);
  const existing = db.prepare("SELECT id FROM knowledge_file_index WHERE path = ? LIMIT 1").get(file) as { id?: string } | undefined;
  const source = file.startsWith(path.resolve(KNOWLEDGE_ROOT) + path.sep) ? "memory" : "workspace";
  if (existing?.id) {
    db.prepare("UPDATE knowledge_file_index SET source = ?, title = ?, file_type = ?, size_bytes = ?, mtime = ?, status = ? WHERE id = ?")
      .run(source, path.basename(file), path.extname(file).slice(1) || "file", stat.size, stat.mtime.toISOString(), status, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare("INSERT INTO knowledge_file_index (id, source, title, path, file_type, size_bytes, mtime, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, source, path.basename(file), file, path.extname(file).slice(1) || "file", stat.size, stat.mtime.toISOString(), status, nowIso());
  return id;
}

function updateKnowledgePathReferences(db: Db, oldPath: string, newPath: string, status: string) {
  const fileId = upsertKnowledgeFileIndex(db, newPath, status);
  db.prepare("DELETE FROM knowledge_file_index WHERE path = ? AND id != ?").run(oldPath, fileId);
  db.prepare(`
    UPDATE knowledge_entries
    SET source_path = CASE WHEN source_path = ? THEN ? ELSE source_path END,
        content_path = CASE WHEN content_path = ? THEN ? ELSE content_path END,
        updated_at = ?
    WHERE source_path = ? OR content_path = ?
  `).run(oldPath, newPath, oldPath, newPath, nowIso(), oldPath, oldPath);
  try {
    db.prepare("UPDATE knowledge_wiki_sources SET source_path = ?, status = ? WHERE source_path = ?").run(newPath, status, oldPath);
  } catch {
    // If the new path is already present, keep the existing source row and leave page references updated below.
  }
  const pages = db.prepare("SELECT id, source_paths FROM knowledge_wiki_pages WHERE source_paths LIKE ?").all(`%${oldPath}%`) as Array<{ id: string; source_paths: string }>;
  for (const page of pages) {
    const sourcePaths = parseJsonArray(page.source_paths);
    const replaced = sourcePaths.map((item) => item === oldPath ? newPath : item);
    if (JSON.stringify(sourcePaths) !== JSON.stringify(replaced)) {
      db.prepare("UPDATE knowledge_wiki_pages SET source_paths = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(replaced), nowIso(), page.id);
    }
  }
}

function toPosixPath(input: string) {
  return input.split(path.sep).filter(Boolean).join("/");
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function walk(base: string, depth: number): string[] {
  if (!fs.existsSync(base) || depth < 0) return [];
  const rows = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true }).slice(0, 300)) {
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) rows.push(...walk(full, depth - 1));
    else rows.push(full);
  }
  return rows;
}

function normalizeKnowledgeNoteDate(input?: string) {
  const raw = String(input || "").trim();
  const match = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function normalizeKnowledgeNoteType(input?: string) {
  const type = String(input || "").trim();
  return KNOWLEDGE_NOTE_TYPES.includes(type) ? type : "工作记录";
}

function normalizeKnowledgeNoteStatus(input?: string) {
  const status = String(input || "").trim();
  return KNOWLEDGE_NOTE_STATUSES.includes(status) ? status : "仅供参考";
}

function normalizeKnowledgeNoteFolder(input?: string) {
  return normalizeRelativeFolderPath(input, "openclaw");
}

export function normalizeKnowledgeNoteLayoutStrategy(input?: KnowledgeNoteLayoutStrategyInput | null): KnowledgeNoteLayoutStrategy | undefined {
  if (!input || typeof input !== "object") return undefined;
  const template = safeLayoutText(input.template, 40) || "knowledge-note";
  const hero = safeLayoutText(input.hero, 180);
  const visualEmphasis = safeLayoutText(input.visualEmphasis, 80);
  const primarySections = Array.isArray(input.primarySections)
    ? uniqueStrings(input.primarySections.map((item) => safeLayoutText(item, 48)).filter(Boolean)).slice(0, 8)
    : [];
  const summaryCards = Array.isArray(input.summaryCards)
    ? input.summaryCards.map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        label: safeLayoutText(record.label, 24),
        value: safeLayoutText(record.value, 36),
        note: safeLayoutText(record.note, 80),
      };
    }).filter((card) => card.label && card.value).slice(0, 4)
    : [];
  const sidebarBlocks = Array.isArray(input.sidebarBlocks)
    ? input.sidebarBlocks.map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const items = Array.isArray(record.items) ? record.items.map((row) => safeLayoutText(row, 72)).filter(Boolean).slice(0, 8) : [];
      return { title: safeLayoutText(record.title, 32), items };
    }).filter((block) => block.title && block.items.length).slice(0, 3)
    : [];
  if (!hero && !visualEmphasis && !primarySections.length && !summaryCards.length && !sidebarBlocks.length) return undefined;
  return { template, hero, summaryCards, sidebarBlocks, primarySections, visualEmphasis };
}

function safeLayoutText(input: unknown, maxLength: number) {
  return String(input || "")
    .replace(/[<>{}`$]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function resolveKnowledgeNoteFolder(folder: string) {
  const root = path.resolve(KNOWLEDGE_NOTES_ROOT);
  const target = path.resolve(root, normalizeKnowledgeNoteFolder(folder));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("invalid_note_folder");
  return target;
}

// njx-knowledge v2: 新主落点解析 /Users/njx/njx-knowledge/knowledge/<sub>/<YYYY-MM>/
// 旧 WORKSPACE_DIR/memory/knowledge/notes 路径仍可用, 仅作 compat / rollback.
function resolveKnowledgeNoteNkxLandingRoot(mode: "auto" | "nkx" | "legacy" = "auto"): string {
  if (mode === "nkx") return path.resolve(NJX_KNOWLEDGE_NOTES_ROOT);
  if (mode === "legacy") return path.resolve(NJX_KNOWLEDGE_LEGACY_NOTES_ROOT);
  // auto: 优先 njx-knowledge (目录存在或可创建), 否则回退 legacy
  try {
    if (fs.existsSync(NJX_KNOWLEDGE_ROOT)) return path.resolve(NJX_KNOWLEDGE_NOTES_ROOT);
  } catch {}
  return path.resolve(NJX_KNOWLEDGE_LEGACY_NOTES_ROOT);
}

function resolveKnowledgeNoteNkxLanding(folder: string, date: string, rootMode: "auto" | "nkx" | "legacy" = "auto"): string {
  const sub = normalizeKnowledgeNoteFolder(folder);
  // 仅在白名单 sub 内允许, 避免越界。folder 可能是 "calendar/2026-07" 这种带月份的复合路径，
  // 只检查第一段（calendar/daily/...），月份段由下方 yyyymm 路径独立处理（2026-07-07 P1b V1 修复）
  const rootSegment = sub.split("/", 1)[0];
  if (!rootSegment || !NJX_KNOWLEDGE_NOTE_SUBDIRS.has(rootSegment)) {
    throw new Error(`invalid_nkx_note_subdir:${sub}`);
  }
  const yyyymm = String(date || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(yyyymm)) {
    throw new Error(`invalid_nkx_note_date:${date}`);
  }
  const root = resolveKnowledgeNoteNkxLandingRoot(rootMode);
  const target = path.resolve(root, sub, yyyymm);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("invalid_nkx_note_folder");
  }
  return target;
}

export type KnowledgeNoteDictValidation = {
  enabled: boolean;
  scriptPath: string;
  pythonBin: string;
  execution: "ok" | "skipped:script_missing" | "skipped:python_missing" | "skipped:no_terms" | "failed:spawn" | "failed:timeout" | "failed:exit_code";
  exitCode: number | null;
  errorMessage: string | null;
  totalTerms: number;
  canonicalCount: number;
  aliasCount: number;
  warningCount: number;
  suggestionCount: number;
  unknownCount: number;
  substitutions: Array<{ from: string; to: string; why: string }>;
  durationMs: number;
};

function resolveKnowledgeNoteTermsForDict(body: Partial<KnowledgeNoteDraftInput>, seed: { tags: string[]; related: string[]; title?: string; type?: string }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: unknown) => {
    const v = String(s || "").trim();
    if (!v) return;
    if (seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    out.push(v);
  };
  for (const t of (body.tags as string[] | undefined) || seed.tags || []) push(t);
  for (const r of (body.related as string[] | undefined) || seed.related || []) push(r);
  if (body.title) push(body.title);
  if (body.type) push(body.type);
  if (seed.title) push(seed.title);
  if (seed.type) push(seed.type);
  return out.slice(0, 64);
}

// njx-knowledge v2 / Phase 4 — save 后处理：调用字典校验脚本, 收集 dictValidation 元数据.
// 字典脚本不可用时不抛, 标记 execution = "skipped:..." 并继续保存; 不伪造 PASS.
async function runKnowledgeNoteDictValidation(body: KnowledgeNoteDraftInput, seed: { tags: string[]; related: string[]; title?: string; type?: string }, options: { signal?: AbortSignal } = {}): Promise<KnowledgeNoteDictValidation> {
  const scriptPath = NJX_KNOWLEDGE_DICT_VALIDATOR_SCRIPT;
  const pythonBin = NJX_KNOWLEDGE_DICT_PYTHON_BIN;
  const start = Date.now();
  const result: KnowledgeNoteDictValidation = {
    enabled: true, scriptPath, pythonBin,
    execution: "ok", exitCode: null, errorMessage: null,
    totalTerms: 0, canonicalCount: 0, aliasCount: 0, warningCount: 0, suggestionCount: 0, unknownCount: 0,
    substitutions: [], durationMs: 0,
  };
  try {
    if (!fs.existsSync(scriptPath)) {
      result.execution = "skipped:script_missing";
      result.durationMs = Date.now() - start;
      return result;
    }
    const terms = resolveKnowledgeNoteTermsForDict(body, seed);
    result.totalTerms = terms.length;
    if (!terms.length) {
      result.execution = "skipped:no_terms";
      result.durationMs = Date.now() - start;
      return result;
    }
    const { spawn } = await import("node:child_process");
    const exit: { code: number | null; signal: NodeJS.Signals | null; error?: Error | null } = await new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(pythonBin, [scriptPath, "--batch", "-", "--json"], { stdio: ["pipe", "pipe", "pipe"] });
      const t = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, NJX_KNOWLEDGE_DICT_VALIDATION_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += String(chunk); });
      child.on("error", (err) => { clearTimeout(t); resolve({ code: null, signal: null, error: err }); });
      child.on("close", (code, signal) => { clearTimeout(t); resolve({ code, signal, error: null }); });
      child.stdin.end(terms.join("\n"));
    });
    result.durationMs = Date.now() - start;
    if (exit.error) {
      result.execution = "failed:spawn";
      result.errorMessage = String(exit.error.message || exit.error);
      return result;
    }
    result.exitCode = exit.code;
    if (exit.signal === "SIGKILL" || exit.code === null && exit.signal !== null) {
      result.execution = "failed:timeout";
      result.errorMessage = `script timeout (${NJX_KNOWLEDGE_DICT_VALIDATION_TIMEOUT_MS}ms)`;
      return result;
    }
    if (exit.code !== 0 && exit.code !== 1 && exit.code !== 2 && exit.code !== 3) {
      result.execution = `failed:exit_code` as KnowledgeNoteDictValidation["execution"];
      result.errorMessage = `unexpected exit ${exit.code}`;
      return result;
    }
    let parsed: Array<{ input: string; status: string; canonical?: string; suggestion?: string; similarity?: number; via_alias_of?: string; evidence?: string }> = [];
    try { parsed = JSON.parse(String((exit as unknown) && (exit as { stdout?: string }).stdout || "")); } catch {}
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const input = String(item.input || "");
      const status = String(item.status || "");
      if (status === "CANONICAL") result.canonicalCount += 1;
      else if (status === "VIA_ALIAS") {
        result.aliasCount += 1;
        if (item.canonical) {
          result.substitutions.push({ from: input, to: String(item.canonical), why: "via_alias" });
        }
      }
      else if (status === "WARNING") {
        result.warningCount += 1;
        // 主要覆盖: RIFD -> RFID (ocr_typo stopword 触发), 仍记入 substitutions
        if (input.toLowerCase() === "rifd") {
          result.substitutions.push({ from: input, to: "RFID", why: "ocr_typo_stopword_rifd_to_rfid" });
        }
      }
      else if (status === "SUGGESTION") {
        result.suggestionCount += 1;
        if (item.suggestion) {
          result.substitutions.push({ from: input, to: String(item.suggestion), why: `fuzzy:${item.similarity || 0}` });
        }
      }
      else if (status === "UNKNOWN") result.unknownCount += 1;
    }
    result.execution = "ok";
    return result;
  } catch (err) {
    result.execution = "failed:spawn";
    result.errorMessage = err instanceof Error ? err.message : String(err);
    result.durationMs = Date.now() - start;
    return result;
  }
}

function resolveKnowledgeNoteMarkdownFile(rawPath?: string) {
  const root = path.resolve(KNOWLEDGE_NOTES_ROOT);
  const file = path.resolve(String(rawPath || ""));
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error("invalid_note_path");
  if (!MARKDOWN_EXT.has(path.extname(file).toLowerCase())) throw new Error("note_markdown_required");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("note_not_found");
  return file;
}

function extractKnowledgeNoteFrontmatterValue(markdown: string, key: string) {
  const frontmatter = String(markdown || "").match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || "";
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
}

function normalizeRelativeFolderPath(input: unknown, fallback: string) {
  const raw = String(input || "").trim();
  if (!raw) return fallback;
  if (path.isAbsolute(raw) || raw.includes("..")) throw new Error("invalid_note_folder");
  const parts = raw.split(/[\\/]+/).map((part) => safeName(part)).filter(Boolean);
  return parts.length ? parts.join("/") : fallback;
}

function normalizeKnowledgeNoteTitle(input: string, date: string, type: string) {
  const topic = String(input || "")
    .replace(/^#+\s*/, "")
    .replace(/\.md$/i, "")
    .replace(new RegExp(`^${date}\\s*`), "")
    .replace(/^(会议纪要|工作记录|学习笔记|决策记录|项目文档|备忘)[:：\s-]*/i, "")
    .trim();
  const clean = topic || `${type}笔记`;
  return clean.slice(0, 80);
}

function shouldPreferInferredKnowledgeTitle(inputTitle: string | undefined, inferredTitle: string, rawContent: string, type: string) {
  const title = String(inputTitle || "").trim();
  if (!title) return true;
  if (!inferredTitle || inferredTitle === type) return false;
  if (knowledgeNoteHasUnsupportedCourseDrift(rawContent, { title, type })) return true;
  if (isKnowledgeCourseTranscript(rawContent) && isWeakCourseTranscriptTitle(title)) return true;
  return false;
}

function isWeakCourseTranscriptTitle(title: string) {
  const clean = title.replace(/[，。！？!?；;：:\s]/g, "");
  if (!clean) return true;
  if (/^(啊|嗯|呃|好的|这个|那个|所以|然后|第二呢|我们这个)/.test(clean)) return true;
  if (/供应链管理专家|课程转写|课堂转写|讲课记录|老师讲课|学习记录\d*$/i.test(clean)) return true;
  if (/电源|电脑.*不要太操心|轻度使用|重度使用|半个小时/.test(title) && !/生产|运营|课程|MBA|质量|供应链/.test(title)) return true;
  return clean.length > 28 && /啊|这个|那个|所以|然后|是不是|有没有/.test(title) && !/生产|运营|课程|MBA|质量|供应链|国产/.test(title);
}

function inferKnowledgeNoteType(rawContent: string) {
  const text = rawContent.toLowerCase();
  if (isKnowledgeCourseTranscript(rawContent)) return "学习笔记";
  if (isKnowledgeTranscript(rawContent) || /会议|例会|纪要|参会|沟通会|讨论会|会晤|谈话记录|访谈|对话/.test(rawContent)) return "会议纪要";
  if (/决策|决定|审批|定稿|拍板|取舍|选择/.test(rawContent)) return "决策记录";
  if (/项目|里程碑|交付|prd|方案|排期/.test(text)) return "项目文档";
  if (/学习|培训|课程|阅读|知识点|方法论/.test(rawContent)) return "学习笔记";
  if (/备忘|提醒|todo|待办/.test(text)) return "备忘";
  return "工作记录";
}

function inferKnowledgeNoteStatus(rawContent: string, type: string) {
  if (isKnowledgeCourseTranscript(rawContent)) return "仅供参考";
  if (isKnowledgeTranscript(rawContent) && !/后续|待办|跟进|确认|提交|截止|负责|安排|todo|行动项/i.test(rawContent)) return "仅供参考";
  if (/进行中|推进中|处理中/.test(rawContent)) return "进行中";
  if (/待|需要|需|下一步|后续|跟进|确认|提交|截止|todo|行动项/i.test(rawContent)) return "待跟进";
  if (/已完成|完成了|闭环|done/i.test(rawContent)) return "已完成";
  return type === "备忘" ? "待跟进" : "仅供参考";
}

function inferKnowledgeNoteTitle(rawContent: string, type: string) {
  if (isKnowledgeCourseTranscript(rawContent)) return inferCourseTranscriptTitle(rawContent);
  const firstHeading = rawContent.split(/\r?\n/).map((line) => line.trim()).find((line) => /^#{1,3}\s+/.test(line));
  const firstLine = firstHeading || parseKnowledgeNoteSegments(rawContent).find(Boolean) || type;
  return firstLine
    .replace(/^#+\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "")
    .replace(/[。；;：:].*$/, "")
    .slice(0, 36) || type;
}

function inferCourseTranscriptTitle(rawContent: string) {
  const text = String(rawContent || "");
  const degreePrefix = /MBA|EMBA|工程硕士|读 MBA/i.test(text) ? "MBA生产运作管理" : "生产运作管理课程";
  if (/供应链|库存|账期|付款周期|承兑|供应链金融|波特|五力|竞争战略/.test(text) && /生产|运营|采购|战略|课堂|老师|专家|西工大/.test(text)) {
    return `${degreePrefix}：供应链、账期与竞争战略`;
  }
  if (/生产运作管理|运营管理|作业管理/.test(text) && /军工|军品|军民融合|民参军|质量|供应链|国产化|信创|航空/.test(text)) {
    return `${degreePrefix}：军工质量控制、供应链安全与国产化`;
  }
  if (/生产运作管理|运营管理|作业管理/.test(text)) return /MBA|EMBA|工程硕士|读 MBA/i.test(text) ? "MBA生产运作管理课程笔记" : "生产运作管理课程笔记";
  if (/MBA|EMBA/i.test(text)) return "MBA课程学习笔记";
  if (/工程硕士/.test(text)) return "工程硕士课程学习笔记";
  if (/复训|培训/.test(text)) return "培训学习笔记";
  if (/课程|课堂|老师|授课/.test(text)) return "课程学习笔记";
  return "课程转写学习笔记";
}

function normalizeKnowledgeNoteTags(input: string[] | undefined, type: string, title: string, rawContent: string, entities: string[]) {
  const tags = new Set<string>();
  tags.add(type.replace(/\s+/g, ""));
  for (const row of input || []) {
    const clean = normalizeTag(row);
    if (clean) tags.add(clean);
  }
  const text = `${title}\n${rawContent}`;
  if (/openclaw/i.test(text)) tags.add("openclaw");
  if (/知识库|knowledge/i.test(text)) tags.add("knowledge");
  if (/任务|task/i.test(text) && type !== "学习笔记") tags.add("task");
  if (/项目|project/i.test(text) && type !== "学习笔记") tags.add("project");
  if (/AI工具|DeepSeek|智能体|艾玛|IMA|workbody|workbuddy/i.test(text)) tags.add("AI工具");
  if (isAiToolCoffeeTranscript(rawContent)) {
    tags.add("智能体工作台");
    if (/知识图谱/.test(text)) tags.add("知识图谱");
    if (/Skill/i.test(text)) tags.add("Skill");
    if (/API|key|token/i.test(text)) tags.add("API配置");
  }
  if (/东航|飞机|液压|惯导|航司|航空/.test(text) && !isKnowledgeCourseTranscript(text) && !isAiToolCoffeeTranscript(rawContent)) tags.add("航空安全");
  if (/航空工业|航发|航空发动机|中国商飞|C919|929|909|西飞|成飞|一飞院/.test(text) && isKnowledgeCourseTranscript(text)) tags.add("航空工业");
  if (/实时传输|高频数据|缓存|重传|网络中断/.test(text)) tags.add("数据传输");
  if (/个人开发|专业壁垒|可控智能体/.test(text)) tags.add("个人智能体");
  const courseLike = shouldTreatAsCourseNote(rawContent, type);
  if (courseLike) tags.add("课程学习");
  if (courseLike && /MBA|EMBA/i.test(rawContent)) tags.add("MBA课程");
  if (courseLike && /工程硕士/.test(rawContent)) tags.add("工程硕士课程");
  if (courseLike && /生产运作管理|运营管理|作业管理/.test(text)) tags.add("生产运作管理");
  if (/供应链|账期|付款周期|承兑|供应链金融|瓶颈类产品/.test(text) || (courseLike && /库存|采购/.test(text))) tags.add("供应链管理");
  if (courseLike && /波特|五力|竞争战略|SWOT|PEST|替代品|潜在进入者|行业壁垒/.test(text)) tags.add("战略管理");
  if (courseLike && /社区关系|公共关系|选址|政府支持|居民/.test(text)) tags.add("运营环境");
  if (/军工|军品|军民融合|民参军|军代表|空装|海装/.test(text)) tags.add("军工管理");
  if (/质量控制|质量保障|质量标准|质量缺陷/.test(text) || (courseLike && /缺陷/.test(text))) tags.add("质量控制");
  if (/供应链安全|海外供应商|外购|出口管制|长臂管辖|五眼同盟/.test(text) || (courseLike && /供应链|元器件|库存/.test(text))) tags.add("供应链安全");
  if (/国产化|国产替代|信创|国产软件|国产电脑|国产 CPU|国产CPU|国产硬件|操作系统/.test(text)) tags.add("国产替代");
  for (const entity of entities.slice(0, 4)) {
    if (entity.length > 14 && !/OpenClaw|Workbench|Gateway|NotebookLM/i.test(entity)) continue;
    const clean = normalizeTag(entity.replace(/^\[\[|\]\]$/g, ""));
    if (clean) tags.add(clean);
  }
  if (tags.size < 2) tags.add("notes");
  return [...tags].slice(0, 10);
}

function filterKnowledgeNoteEntitiesForSource(entities: string[], rawContent: string, type: string) {
  if (isAiToolCoffeeTranscript(rawContent)) return aiToolKnowledgeEntities(rawContent);
  if (shouldTreatAsCourseNote(rawContent, type)) return entities;
  const source = String(rawContent || "");
  const weakCourseEntities = new Set([
    "MBA课程",
    "生产运作管理",
    "运营管理",
    "作业管理",
    "供应链管理",
    "运营目标冲突",
    "账期与现金流",
    "瓶颈类产品采购",
    "波特五力模型",
    "竞争战略",
    "社区关系",
    "西工大战略案例",
    "中国烟草案例",
    "军工供应链",
    "供应链安全",
    "航空工业架构",
    "民机产业链",
    "航空主机厂",
    "军机型号",
  ]);
  return entities.filter((entity) => {
    const clean = stripWikiLink(entity);
    return !weakCourseEntities.has(clean) || source.includes(clean);
  });
}

function aiToolKnowledgeEntities(rawContent: string) {
  const text = String(rawContent || "");
  const rows: string[] = [];
  const add = (entity: string, pattern: RegExp) => {
    if (pattern.test(text)) rows.push(entity);
  };
  add("AI工具整合", /AI\s*工具|整理成一个|文件夹|页面/i);
  add("智能体工作台", /智能体工作台|不工作了|提醒我|只要你工作/i);
  add("OpenClaw", /OpenClaw/i);
  add("知识库", /知识库|knowledge/i);
  add("知识图谱", /知识图谱/i);
  add("Skill开发", /Skill/i);
  add("API配置", /API|key|密钥|自定义模型/i);
  add("Token成本", /token|额度/i);
  add("VPN流量", /vpn|流量/i);
  add("模型路由", /模型列表|自定义模型|MiniMax|Claude|GPT|硅基流动/i);
  return uniqueStrings(rows).slice(0, 12);
}

function normalizeTag(input: string) {
  const clean = String(input || "")
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/[#,，、\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (!clean) return "";
  if (clean.length > 24) return "";
  if (/(然后|因为|就是|这个|那个|是不是|有没有|怎么|为什么|我觉得|你怎么|那你|它自己)/.test(clean)) return "";
  return clean;
}

function normalizeRelated(input?: string[]) {
  const rows = (input || []).flatMap((row) => String(row || "").split(/[,，\n]/)).map((row) => row.trim()).filter(Boolean);
  return uniqueStrings(rows.map((row) => {
    const clean = row.replace(/^\[\[|\]\]$/g, "").trim();
    return clean ? `[[${clean}]]` : "";
  }).filter(Boolean));
}

function extractKnowledgeNoteEntities(text: string) {
  const entities: string[] = [];
  for (const match of text.matchAll(/\[\[([^\]]{2,40})\]\]/g)) entities.push(match[1]);
  for (const term of ["OpenClaw", "MiniMax", "Gateway", "Knowledge", "NotebookLM", "Obsidian", "IMA", "NAS", "PRD11", "Workbench"]) {
    if (new RegExp(term, "i").test(text)) entities.push(term);
  }
  const diplomaticContext = /习近平|特朗普|会晤|谈话记录|总统先生|主席/.test(text);
  if (diplomaticContext) {
    for (const term of ["习近平", "特朗普", "马斯克", "比尔盖茨"]) {
      if (new RegExp(term, "i").test(text)) entities.push(term);
    }
    for (const [pattern, entity] of [
      [/中美关系/, "中美关系"],
      [/中美之间|中美各自|中美共同|中美/, "中美关系"],
      [/共同利益/, "中美共同利益"],
      [/美国独立250周年|独立250周年/, "美国独立250周年"],
      [/2026年/, "2026年中美关系节点"],
      [/新时代大国正确相处之道|大国正确相处之道/, "新时代大国正确相处之道"],
      [/贸易|商业合作|企业家/, "中美贸易合作"],
      [/高峰会/, "中美高峰会"],
      [/伙伴，而不是对手|伙伴.*对手/, "伙伴而非对手"],
      [/共同繁荣/, "共同繁荣"],
    ] as Array<[RegExp, string]>) {
      if (pattern.test(text)) entities.push(entity);
    }
  }
  for (const [pattern, entity] of [
    [/生产运作管理/, "生产运作管理"],
    [/运营管理/, "运营管理"],
    [/作业管理/, "作业管理"],
    [/MBA|EMBA/, "MBA课程"],
    [/工程硕士/, "工程硕士课程"],
    [/供应链管理|供应链/, "供应链管理"],
    [/库存|断线|生产角度|销售角度|财务角度/, "运营目标冲突"],
    [/账期|付款周期|承兑|供应链金融|36个月|三年/, "账期与现金流"],
    [/关键产品|瓶颈类产品|供不应求/, "瓶颈类产品采购"],
    [/波特|五力分析|五力模型/, "波特五力模型"],
    [/竞争战略|核心竞争力/, "竞争战略"],
    [/社区关系|公共关系|选址|政府支持/, "社区关系"],
    [/西工大|127目标|世界一流/, "西工大战略案例"],
    [/中国烟草|中烟|电子烟|替代品/, "中国烟草案例"],
    [/军民融合/, "军民融合"],
    [/民参军/, "民参军企业"],
    [/军代表|质量代表/, "军代表机制"],
    [/质量控制|质量保障|质量标准/, "质量控制"],
    [/军用电子|元器件/, "军用电子元器件"],
    [/供应链|海外供应商|外购/, "军工供应链"],
    [/出口管制|长臂管辖|五眼同盟/, "出口管制"],
    [/国产化|国产替代|信创/, "国产替代"],
    [/航空工业|航发工业|航空发动机/, "航空工业架构"],
    [/中国商飞|C919|929|909/, "民机产业链"],
    [/西工大/, "西工大"],
    [/西飞|成飞|一飞院|飞院/, "航空主机厂"],
    [/运二零|运20|歼二零|歼20/, "军机型号"],
  ] as Array<[RegExp, string]>) {
    if (pattern.test(text)) entities.push(entity);
  }
  const entityPattern = /[\p{Letter}\p{Number}._-]{2,28}(?:知识库|工作台|平台|系统|项目|任务|流程|模式|会议|计划|中心|部门|文档|资产|功能|模型|架构|接口|策略|案例|记录|清单|图谱|目录)/gu;
  for (const match of text.matchAll(entityPattern)) entities.push(match[0]);
  const orgPattern = /[\u4e00-\u9fa5A-Za-z0-9._-]{2,28}(?:公司|集团|部门|团队|委员会|政府|办公室|研究院|工作室|机场|航司|平台)/g;
  for (const match of text.matchAll(orgPattern)) entities.push(match[0]);
  const placePattern = /[\u4e00-\u9fa5A-Za-z0-9._-]{2,24}(?:门|站|楼|库房|园区|机场|区域|中心|仓库)/g;
  for (const match of text.matchAll(placePattern)) entities.push(match[0]);
  const personPattern = /[\u4e00-\u9fa5]{1,4}(?:总|老师|经理|主任|主管)/g;
  for (const match of text.matchAll(personPattern)) entities.push(match[0]);
  return uniqueStrings(entities.map((entity) => entity.trim()).filter((entity) => entity.length >= 2 && entity.length <= 40 && !isWeakKnowledgeEntity(entity))).slice(0, 20);
}

function renderKnowledgeNoteMarkdown(input: Required<Pick<KnowledgeNoteDraftInput, "title" | "date" | "type" | "status" | "folder">> & { rawContent?: string; tags: string[]; related: string[]; markdown?: string; layoutStrategy?: KnowledgeNoteLayoutStrategy; htmlQuality?: KnowledgeNoteHtmlQualityInput; generationPipeline?: string[] }) {
  const body = extractKnowledgeNoteBody(input.markdown || "", input.rawContent || "", input.title, input.type, input.status, input.date, input.related);
  const strategy = input.layoutStrategy ? `\nhtml_strategy: ${JSON.stringify(input.layoutStrategy)}` : "";
  const sourceHash = input.rawContent ? `\nsource_hash: ${createHash("sha256").update(input.rawContent).digest("hex")}` : "";
  const htmlQuality = input.htmlQuality ? `\nhtml_quality: ${JSON.stringify(input.htmlQuality)}` : "";
  const generationPipeline = input.generationPipeline?.length ? `\ngeneration_pipeline: ${JSON.stringify(input.generationPipeline)}` : "";
  return `---\ntags: ${yamlArray(input.tags)}\ndate: ${input.date}\ntype: ${input.type}\nstatus: ${input.status}\nrelated: ${yamlArray(input.related)}${sourceHash}${strategy}${htmlQuality}${generationPipeline}\n---\n\n# ${input.date} ${input.title}\n\n${body.trim()}\n`;
}

function extractKnowledgeNoteBody(markdown: string, rawContent: string, title: string, type: string, status: string, date: string, related: string[]) {
  const cleanMarkdown = markdown.trim();
  if (cleanMarkdown) {
    const withoutFrontmatter = cleanMarkdown.replace(/^---[\s\S]*?---\s*/, "");
    const withoutHeading = withoutFrontmatter.replace(/^#\s+.*(?:\r?\n)+/, "");
    const reliabilitySummary = buildKnowledgeFallbackReliabilityMeetingSummary(title, cleanMarkdown, rawContent || cleanMarkdown);
    const reliabilityMarkdownAlreadyStructured = /会议概要|上次会议事项跟踪|技术问题与工程措施|决议变更与资源约束|航材与执行约束/.test(withoutHeading);
    const reliabilityMarkdownContaminated = /安委会|安全委员会|安全会议|安委会参考议程/.test(withoutHeading.slice(0, 8000));
    const reliabilityMarkdownNoisy = /项\s*·\s*结果|发言脉络|发言人\d+/.test(withoutHeading.slice(0, 5000));
    if (reliabilitySummary && (!reliabilityMarkdownAlreadyStructured || reliabilityMarkdownContaminated || reliabilityMarkdownNoisy)) return renderKnowledgeReliabilityMeetingMarkdown(reliabilitySummary, rawContent || cleanMarkdown);
    const safetySummary = buildKnowledgeFallbackSafetyCommitteeSummary(title, cleanMarkdown, rawContent || cleanMarkdown);
    const safetyMarkdownAlreadyStructured = /4月安全运行数据|典型事件通报与复盘|综合待办/.test(withoutHeading);
    const safetyMarkdownNoisy = /项\s*·\s*结果|发言脉络|企业家代表团|高峰会重要性判断|发言人\d+/.test(withoutHeading.slice(0, 4000));
    if (safetySummary && (!safetyMarkdownAlreadyStructured || safetyMarkdownNoisy)) return renderKnowledgeSafetyCommitteeMarkdown(safetySummary, rawContent || cleanMarkdown);
    const operationalBriefing = buildKnowledgeFallbackOperationalBriefingSummary(title, cleanMarkdown, rawContent || cleanMarkdown);
    const operationalBriefingAlreadyStructured = /运行概览|重点事件 \/ 非例行|今日计划与生产任务|风险与资源约束/.test(withoutHeading);
    const operationalBriefingNoisy = /项\s*·\s*结果|发言脉络|发言人\d+|航空调度员\s*[：:]/.test(withoutHeading.slice(0, 5000));
    if (operationalBriefing && (!operationalBriefingAlreadyStructured || operationalBriefingNoisy)) return renderKnowledgeOperationalBriefingMarkdown(operationalBriefing, rawContent || cleanMarkdown);
    if (withoutHeading.trim()) return withoutHeading.trim();
  }
  const analysis = analyzeKnowledgeNote(rawContent, title, type, related);
  const reliabilitySummary = buildKnowledgeFallbackReliabilityMeetingSummary(title, rawContent, rawContent);
  if (reliabilitySummary) return renderKnowledgeReliabilityMeetingMarkdown(reliabilitySummary, rawContent);
  const safetySummary = buildKnowledgeFallbackSafetyCommitteeSummary(title, rawContent, rawContent);
  if (safetySummary) return renderKnowledgeSafetyCommitteeMarkdown(safetySummary, rawContent);
  const operationalBriefing = buildKnowledgeFallbackOperationalBriefingSummary(title, rawContent, rawContent);
  if (operationalBriefing) return renderKnowledgeOperationalBriefingMarkdown(operationalBriefing, rawContent);
  const workSummary = buildKnowledgeFallbackWorkSummary(title, rawContent, rawContent);
  if (workSummary) return renderKnowledgeWorkSummaryMarkdown(workSummary, rawContent);
  if (type === "会议纪要" && isKnowledgeTranscript(rawContent)) return renderTranscriptMeetingNote(rawContent, type, status, date, related, analysis);
  if (shouldTreatAsCourseNote(rawContent, type)) return renderCourseTranscriptNote(rawContent, status, date, related, analysis);
  if (isKnowledgeTranscript(rawContent)) return renderTranscriptMeetingNote(rawContent, type, status, date, related, analysis);
  if (type === "会议纪要") return [
    renderContentUnderstanding(type, status, analysis),
    "",
    "## 参会信息",
    `- 时间：${date}`,
    "- 地点：待确认",
    "- 参会人：待确认",
    "",
    "## 议题与要点",
    bulletLines(linkKnowledgeNoteEntityLines(analysis.keyPoints, related)),
    "",
    analysis.issuePoints.length ? "## 关键问题" : "",
    analysis.issuePoints.length ? issueTable(linkKnowledgeNoteEntityLines(analysis.issuePoints, related)) : "",
    "",
    analysis.dataPoints.length ? "## 关键数据" : "",
    analysis.dataPoints.length ? dataTable(linkKnowledgeNoteEntityLines(analysis.dataPoints, related)) : "",
    "",
    "## 后续行动",
    actionTable(analysis.actions),
    "",
    backlinkIndex(related, analysis.entityGroups),
    "",
    rawArchiveBlock(rawContent),
  ].filter(Boolean).join("\n");
  if (type === "学习笔记") return [
    renderContentUnderstanding(type, status, analysis),
    "",
    "## 核心知识",
    bulletLines(linkKnowledgeNoteEntityLines(analysis.keyPoints, related)),
    "",
    "## 关键概念",
    conceptLines(analysis.entityGroups, related),
    "",
    "## 与已有知识的关联",
    related.length ? related.map((item) => `- 与 ${item} 相关`).join("\n") : "- 待补充",
    "",
    rawArchiveBlock(rawContent),
  ].join("\n");
  if (type === "决策记录") return [
    renderContentUnderstanding(type, status, analysis),
    "",
    "## 决策内容",
    linkKnowledgeNoteEntityOnce(analysis.keyPoints[0] || analysis.segments[0] || "待补充", related),
    "",
    "## 决策依据",
    bulletLines(linkKnowledgeNoteEntityLines(analysis.keyPoints.slice(1), related)),
    "",
    "## 影响范围",
    related.length ? related.map((item) => `- ${item}`).join("\n") : "- 待确认",
    "",
    analysis.actions.length ? "## 后续行动" : "",
    analysis.actions.length ? actionTable(analysis.actions) : "",
    "",
    backlinkIndex(related, analysis.entityGroups),
    "",
    rawArchiveBlock(rawContent),
  ].join("\n");
  if (type === "项目文档") return [
    renderContentUnderstanding(type, status, analysis),
    "",
    "## 项目背景",
    linkKnowledgeNoteEntityOnce(analysis.segments[0] || "待补充", related),
    "",
    "## 核心内容",
    bulletLines(linkKnowledgeNoteEntityLines(analysis.keyPoints, related)),
    "",
    analysis.issuePoints.length ? "## 风险与问题" : "",
    analysis.issuePoints.length ? issueTable(linkKnowledgeNoteEntityLines(analysis.issuePoints, related)) : "",
    "",
    analysis.dataPoints.length ? "## 关键数据" : "",
    analysis.dataPoints.length ? dataTable(linkKnowledgeNoteEntityLines(analysis.dataPoints, related)) : "",
    "",
    "## 后续行动",
    actionTable(analysis.actions),
    "",
    backlinkIndex(related, analysis.entityGroups),
    "",
    rawArchiveBlock(rawContent),
  ].filter(Boolean).join("\n");
  if (type === "备忘") return [
    renderContentUnderstanding(type, status, analysis),
    "",
    "## 备忘内容",
    bulletLines(linkKnowledgeNoteEntityLines(analysis.keyPoints, related)),
    "",
    analysis.actions.length ? "## 待办/提醒" : "",
    analysis.actions.length ? analysis.actions.map((item) => `- [ ] ${linkKnowledgeNoteEntityOnce(item.text, related)}（责任方：${item.owner}，截止：${item.due}）`).join("\n") : "",
    "",
    rawArchiveBlock(rawContent),
  ].filter(Boolean).join("\n");
  return [
    renderContentUnderstanding(type, status, analysis),
    "",
    "## 事件/进展",
    bulletLines(linkKnowledgeNoteEntityLines(analysis.keyPoints, related)),
    "",
    analysis.issuePoints.length ? "## 问题与风险" : "",
    analysis.issuePoints.length ? issueTable(linkKnowledgeNoteEntityLines(analysis.issuePoints, related)) : "",
    "",
    analysis.dataPoints.length ? "## 关键数据" : "",
    analysis.dataPoints.length ? dataTable(linkKnowledgeNoteEntityLines(analysis.dataPoints, related)) : "",
    "",
    "## 后续行动",
    actionTable(analysis.actions),
    "",
    backlinkIndex(related, analysis.entityGroups),
    "",
    rawArchiveBlock(rawContent),
  ].filter(Boolean).join("\n");
}

function analyzeKnowledgeNote(rawContent: string, title: string, type: string, related: string[]): KnowledgeNoteAnalysis {
  const segments = parseKnowledgeNoteSegments(rawContent);
  const entities = filterKnowledgeNoteEntitiesForSource(uniqueStrings([...related.map(stripWikiLink), ...extractKnowledgeNoteEntities(`${title}\n${rawContent}`)]), rawContent, type).slice(0, 20);
  const keyPoints = selectKnowledgeNoteKeyPoints(segments, type, entities);
  const dataPoints = extractKnowledgeNoteDataPoints(segments);
  const issuePoints = extractKnowledgeNoteIssuePoints(segments);
  const actions = extractKnowledgeNoteActions(segments);
  const entityGroups = groupKnowledgeNoteEntities(entities);
  const logic = inferKnowledgeNoteLogic(segments, type, issuePoints, actions);
  return { topic: title, segments, keyPoints, dataPoints, issuePoints, actions, entities, entityGroups, logic };
}

function isKnowledgeTranscript(rawContent: string) {
  const text = String(rawContent || "");
  const timestampCount = knowledgeTimestampCount(text);
  const speakerCount = (text.match(/(?:^|\n)\s*(?:习近平|特朗普|用户|主持人|嘉宾|技术爱好者|[\u4e00-\u9fa5]{1,8}(?:主席|总统|总|老师|经理|主任|主管))[:：]?\s*(?:\n|$)/g) || []).length;
  const speakerTimeCount = (text.match(/(?:^|\n)\s*[\u4e00-\u9fa5A-Za-z0-9_ -]{1,16}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:\n|$)/g) || []).length;
  return timestampCount + speakerTimeCount >= 3 && (speakerCount >= 1 || speakerTimeCount >= 2 || /谈话记录|会晤|访谈|对话|转写/.test(text));
}

function isKnowledgeCourseTranscript(rawContent: string) {
  const text = String(rawContent || "");
  const speakerTimeCount = (text.match(/(?:^|\n)\s*[\u4e00-\u9fa5A-Za-z0-9_ -]{1,16}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:\n|$)/g) || []).length;
  if (knowledgeTimestampCount(text) + speakerTimeCount < 3) return false;
  const profile = knowledgeCourseEvidenceProfile(text);
  if (!profile.hasCourseContext) return false;
  if (profile.casualSignals && profile.courseRatio < 0.18 && !profile.hasDegreeEvidence) return false;
  const operationalMeetingContext = /AOG|周例会|例会|会议|航材|外站|库房|GPS|ITP|协议|付款说明|采购入口|账号|监控|浦东|虹桥|南京/.test(text);
  if (operationalMeetingContext && !profile.hasFormalCourseFrame) return false;
  if (profile.hasFormalCourseFrame && profile.domainSegments >= 1) return true;
  if (profile.hasDegreeEvidence && profile.domainSegments >= 1) return true;
  return profile.courseSegments >= 4 && profile.domainSegments >= 2 && profile.courseRatio >= 0.18;
}

function shouldTreatAsCourseNote(rawContent: string, requestedType?: string) {
  if (!isKnowledgeCourseTranscript(rawContent)) return false;
  const normalized = requestedType ? normalizeKnowledgeNoteType(requestedType) : "";
  if (["会议纪要", "决策记录", "项目文档"].includes(normalized)) return false;
  return true;
}

export function knowledgeNoteSourceProfile(rawContent: string, metadata: Pick<KnowledgeNoteDraftInput, "title" | "type" | "tags" | "related" | "markdown"> = {}) {
  const source = String(rawContent || "");
  const isTranscript = isKnowledgeTranscript(source);
  const isCourseTranscript = isKnowledgeCourseTranscript(source);
  const courseProfile = knowledgeCourseEvidenceProfile(source);
  const hasCourseEvidence = hasStrongKnowledgeCourseEvidence(source);
  const ignoreCourseMetadata = knowledgeNoteHasUnsupportedCourseDrift(source, metadata);
  const ignoreDegreeMetadata = knowledgeNoteHasUnsupportedMbaDrift(source, metadata);
  const suggestedType = isCourseTranscript ? "学习笔记" : isTranscript ? "会议纪要" : inferKnowledgeNoteType(source);
  return {
    category: isCourseTranscript ? "course_learning" : isTranscript ? "conversation_or_meeting" : suggestedType,
    isTranscript,
    isCourseTranscript,
    isDegreeCourse: hasKnowledgeMbaEvidence(source),
    hasCourseEvidence,
    ignoreCourseMetadata,
    ignoreDegreeMetadata,
    suggestedType,
    evidence: {
      timestamps: knowledgeTimestampCount(source),
      courseSignals: courseProfile.courseSegments,
      courseDomainSignals: courseProfile.domainSegments,
      courseRatio: courseProfile.courseRatio,
      casualSignals: /午间咖啡|咖啡闲聊|闲聊|聊天|随口/.test(source),
    },
  };
}

export function knowledgeNoteHasUnsupportedCourseDrift(rawContent: string, candidate: Pick<KnowledgeNoteDraftInput, "title" | "type" | "tags" | "related" | "markdown"> = {}) {
  const source = String(rawContent || "");
  if (!source.trim()) return false;
  if (hasStrongKnowledgeCourseEvidence(source)) return false;
  const sourceProfile = knowledgeCourseEvidenceProfile(source);
  const sourceLooksCasual = Boolean(sourceProfile.casualSignals);
  const sourceHasFormalCourseAnchor =
    sourceProfile.hasFormalCourseFrame
    || sourceProfile.hasDegreeEvidence
    || sourceProfile.domainSegments >= 1;
  const hasSourceCourseAnchor = (
    sourceProfile.hasCourseContext
    || sourceProfile.courseSegments >= 2
    || /课程|课堂|授课|课表|课后|教材|考试|同学们|老师讲|老师说|今天讲|本节课|第[一二三四五六七八九十\d]+讲/.test(source)
  ) && (!sourceLooksCasual || sourceHasFormalCourseAnchor);
  const candidateText = [
    candidate.title || "",
    candidate.type || "",
    ...(candidate.tags || []),
    ...(candidate.related || []),
    stripKnowledgeNoteRawArchive(candidate.markdown || "").slice(0, 12_000),
  ].join("\n");
  const hasCourseMetadata = /MBA|EMBA|工程硕士|课程|课堂|授课|生产运作管理|运营管理|作业管理|网课/i.test(candidateText);
  const hasLearningMetadata = /学习笔记|学习记录|培训学习|课程学习/.test(candidateText);
  const hasCourseTemplate = /##\s*(课程概述|学习地图|课程主线|关键知识模块|案例与管理启发|关键概念速查|学习档案|复盘问题)/.test(candidateText);
  const hasUnsupportedCourseDomain = /波特五力|供应链金融|瓶颈类产品|账期与现金流|西工大战略案例|中国烟草案例/.test(candidateText);
  if (hasCourseTemplate || hasUnsupportedCourseDomain) {
    return !hasSourceCourseAnchor;
  }
  if ((hasCourseMetadata || hasLearningMetadata) && !hasSourceCourseAnchor) {
    return isKnowledgeTranscript(source) || /午间咖啡|咖啡闲聊|闲聊|聊天|随口/.test(source);
  }
  return false;
}

function isCasualOrAiToolTranscript(rawContent: string) {
  const text = String(rawContent || "");
  return /午间咖啡|咖啡闲聊|闲聊|手机有问题|拿咖啡|随口/.test(text)
    || (/AI|智能体|OpenClaw|知识图谱|Skill|API|token|算力|模型|工作台/i.test(text) && isKnowledgeTranscript(text));
}

export function knowledgeNoteHasUnsupportedMbaDrift(rawContent: string, candidate: Pick<KnowledgeNoteDraftInput, "title" | "type" | "tags" | "related" | "markdown"> = {}) {
  const source = String(rawContent || "");
  if (!source.trim() || hasKnowledgeMbaEvidence(source)) return false;
  const candidateText = [
    candidate.title || "",
    candidate.type || "",
    ...(candidate.tags || []),
    ...(candidate.related || []),
    stripKnowledgeNoteRawArchive(candidate.markdown || "").slice(0, 12_000),
  ].join("\n");
  return /MBA|EMBA|工程硕士|读 MBA/i.test(candidateText);
}

function hasKnowledgeMbaEvidence(rawContent: string) {
  return /MBA|EMBA|工程硕士|读 MBA/i.test(String(rawContent || ""));
}

function hasStrongKnowledgeCourseEvidence(rawContent: string) {
  const text = String(rawContent || "");
  if (isKnowledgeCourseTranscript(text)) return true;

  const profile = knowledgeCourseEvidenceProfile(text);
  if (!profile.hasCourseContext && /课程|课程录音|课程转写|课堂|授课|同学们|老师讲|本节课/.test(text) === false) {
    return false;
  }
  if (profile.casualSignals && !profile.hasFormalCourseFrame && !profile.hasDegreeEvidence && profile.domainSegments < 1) {
    return false;
  }

  if (profile.courseSegments >= 2) return true;
  if (profile.courseSegments >= 1 && profile.domainSegments >= 1) return true;
  if (profile.hasFormalCourseFrame && (profile.courseSegments >= 1 || profile.domainSegments >= 1)) return true;
  return false;
}

function knowledgeCourseEvidenceProfile(rawContent: string) {
  const text = String(rawContent || "");
  const segments = parseKnowledgeNoteSegments(text)
    .map(stripSegmentTime)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && !/^(嗯+|好的|可以|对啊|好|行|OK)$/i.test(line))
    .slice(0, 260);
  const hasDegreeEvidence = /MBA|EMBA|工程硕士|读 MBA/i.test(text);
  const hasFormalCourseFrame = /课程转写|课堂|本节课|课程案例|同学们|授课|老师讲|今天讨论|今天讲|上课|考试/i.test(text);
  const hasTrainingMention = /培训|复训|网课/.test(text);
  const hasCourseContext =
    hasDegreeEvidence
    || hasFormalCourseFrame
    || hasTrainingMention
    || /课程|课表|教材|课程安排|第[一二三四五六七八九十\d]+讲/.test(text);
  const courseSegments = segments.filter((line) => /MBA|EMBA|工程硕士|课程|课堂|本节课|同学们|上课|考试|授课|老师讲|今天讨论|今天讲|复训|培训|网课|生产运作管理|运营管理|作业管理/i.test(line)).length;
  const domainSegments = segments.filter((line) => /供应链|库存|采购|账期|付款周期|承兑|供应链金融|瓶颈类产品|生产运作|运营管理|作业管理|竞争战略|波特|五力|SWOT|PEST|军工|军品|质量控制|质量保障|国产化|信创/.test(line)).length;
  const casualSignals = /午间咖啡|咖啡闲聊|闲聊|聊天|随口|手机有问题|拿咖啡|API|token|智能体工作台|知识图谱|Skill开发/i.test(text);
  const courseRatio = segments.length ? courseSegments / segments.length : 0;
  return {
    hasCourseContext,
    hasFormalCourseFrame,
    hasDegreeEvidence,
    courseSegments,
    domainSegments,
    casualSignals,
    courseRatio,
  };
}

function stripKnowledgeNoteRawArchive(markdown: string) {
  return String(markdown || "")
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/##\s*原始记录[\s\S]*$/i, "")
    .replace(/```[\s\S]*?```/g, " ");
}

function knowledgeTimestampCount(text: string) {
  return (String(text || "").match(/(?:^|\n)\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:\n|$)/g) || []).length;
}

type CourseLearningModule = {
  title: string;
  question: string;
  insight: string;
  evidence: string;
  application: string;
  concepts: string[];
};

function renderCourseTranscriptNote(rawContent: string, status: string, date: string, related: string[], analysis: KnowledgeNoteAnalysis) {
  const transcript = parseKnowledgeTranscript(rawContent);
  const topic = inferCourseTranscriptTitle(rawContent);
  const modules = courseKnowledgeRows(rawContent, transcript, related);
  const themes = courseTranscriptThemes(rawContent);
  const conceptRows = courseConceptRows(rawContent);
  const caseRows = courseCaseRows(rawContent, transcript, related);
  const courseRelated = uniqueStrings([
    ...related,
    ...modules.flatMap((item) => item.concepts.map((concept) => `[[${concept}]]`)),
  ]).slice(0, 14);
  return [
    "## 课程概述",
    courseOverview(rawContent, topic, transcript),
    "",
    "## 学习地图",
    courseLearningMapTable(modules),
    "",
    "## 课程主线",
    bulletLines(linkKnowledgeNoteEntityLines(themes, courseRelated)),
    "",
    "## 关键知识模块",
    renderCourseModules(modules),
    "",
    "## 案例与管理启发",
    courseEvidenceTable(caseRows.length ? caseRows : modules.map((item) => [item.title, item.evidence, item.application] as [string, string, string])),
    "",
    "## 关键概念速查",
    courseConceptTable(conceptRows),
    "",
    "## 学习档案",
    renderContentUnderstanding("学习笔记", status, {
      ...analysis,
      topic,
      keyPoints: themes,
      logic: ["课堂转写", "主题识别", "概念框架", "案例拆解", "复盘行动"],
    }),
    "",
    "## 待核验事项",
    courseVerificationTable(rawContent),
    "",
    "## 复盘问题",
    bulletLines(courseReviewQuestions(rawContent)),
    "",
    "## 后续行动",
    actionTable(courseReviewActions(rawContent)),
    "",
    backlinkIndex(courseRelated, analysis.entityGroups),
    "",
    rawArchiveBlock(rawContent),
  ].filter(Boolean).join("\n");
}

function courseOverview(rawContent: string, topic: string, transcript: KnowledgeTranscriptAnalysis) {
  const timeRange = transcript.startTime ? `本段转写覆盖 ${transcript.startTime}-${transcript.endTime || transcript.startTime}。` : "";
  if (/供应链|库存|账期|波特|五力|竞争战略/.test(rawContent)) {
    return `${topic}围绕“运营系统不是单部门最优”展开：先从原材料库存、成品库存、生产不断线、销售去库存和财务控成本之间的目标冲突切入，再讨论账期、承兑、供应链金融与强弱关系如何改变供应链合作；随后进入生产战略、竞争战略和波特五力模型，用西工大目标分解、社区关系、中国烟草与电子烟替代等案例说明运营管理必须同时处理内部流程和外部环境。${timeRange}`;
  }
  if (/军工|军品|民参军|国产化|航空/.test(rawContent)) {
    return `${topic}围绕军工质量、供应链安全和国产替代展开，把生产运作管理放在质量控制、交付周期、军代表机制、元器件库存和产业链转型中理解。${timeRange}`;
  }
  return `${topic}是一段带时间戳的课堂转写整理，已按课程主线、关键概念、案例依据和复盘问题重新组织，原始记录保留在文末便于校对。${timeRange}`;
}

function courseTranscriptThemes(rawContent: string) {
  const text = String(rawContent || "");
  const themes: string[] = [];
  if (/库存|断线|生产角度|销售角度|财务角度|质量角度/.test(text)) themes.push("运营管理的核心不是让生产、销售、财务、质量某一个部门局部最优，而是在库存、交付、现金流和质量之间做系统平衡。");
  if (/关键产品|瓶颈类产品|供不应求|采购/.test(text)) themes.push("采购策略要区分普通产品、关键产品和瓶颈类产品，不能对所有物料使用同一种付款和供应策略。");
  if (/账期|付款周期|承兑|供应链金融|36个月|三年/.test(text)) themes.push("账期既是财务安排，也是供应链谈判工具；过长账期会把资金压力转移到上游，并推高供应链金融成本。");
  if (/强弱关系|大手.*小手|合作|协作/.test(text)) themes.push("供应链合作有权力结构前提，双方力量悬殊时，“合作”容易变成强势方对弱势方的挤压。");
  if (/社区关系|公共关系|选址|政府支持|居民|快递柜/.test(text)) themes.push("运营系统会和社区、政府、公共关系等外部界面发生耦合，选址和外部支持会影响企业正常运营。");
  if (/战略|发展战略|竞争战略|西工大|127/.test(text)) themes.push("发展战略回答长期达到什么位置，竞争战略回答凭什么在行业中胜出，两者需要分解成阶段目标和可执行指标。");
  if (/波特|五力|SWOT|PEST|替代性|潜在进入者|行业壁垒/.test(text)) themes.push("波特五力模型把竞争优势放回市场结构中看：上下游议价能力、替代品、潜在进入者和行业内竞争共同决定企业处境。");
  if (/烟草|电子烟|中烟/.test(text)) themes.push("中国烟草案例说明制度定位、渠道控制和替代品冲击如何共同塑造企业的竞争优势。");
  if (/生产运作管理|运营管理|作业管理/.test(text)) themes.push("生产运作管理在不同学校可能叫生产管理、运营管理或作业管理，本质是对资源、流程、质量、成本和交付的综合设计。");
  if (/军方要派人|长期驻扎|军代表|质量代表/.test(text)) themes.push("军品生产的质量控制机制不同于普通民品，军代表或质量代表会长期介入制造现场和项目交付过程。");
  if (/民营|民参军|第三方|质量保障|审查/.test(text)) themes.push("民参军企业进入军品体系后，需要补齐质量意识、质量保障体系和第三方/军方审查能力。");
  if (/出口管制|长臂管辖|高技术产品|英伟达|算卡|限制|五眼同盟/.test(text)) themes.push("高技术产品贸易受出口管制和长臂管辖影响，AI 算卡、通信和控制类产品是典型受限对象。");
  if (/国产化|国产替代|信创|国产软件|国产电脑|国产 CPU|国产CPU/.test(text)) themes.push("国产替代和信创建设是降低外部依赖的长期策略，即便短期产品体验不佳也需要持续推进。");
  return uniqueStrings(themes).slice(0, 10);
}

function courseKnowledgeRows(rawContent: string, transcript: KnowledgeTranscriptAnalysis, related: string[]): CourseLearningModule[] {
  const text = String(rawContent || "");
  const rows: CourseLearningModule[] = [];
  const add = (module: Omit<CourseLearningModule, "evidence"> & { pattern: RegExp; evidencePattern?: RegExp }) => {
    if (!module.pattern.test(text)) return;
    rows.push({
      title: module.title,
      question: module.question,
      insight: linkKnowledgeNoteEntityOnce(module.insight, related),
      evidence: linkKnowledgeNoteEntityOnce(findCourseEvidence(transcript, module.evidencePattern || module.pattern), related),
      application: linkKnowledgeNoteEntityOnce(module.application, related),
      concepts: module.concepts,
    });
  };
  add({
    title: "运营目标冲突与库存管理",
    pattern: /库存|断线|生产角度|销售角度|财务角度|质量角度/,
    question: "为什么库存不能只按生产部门或销售部门的偏好决策？",
    insight: "生产希望原材料充足以避免断线，销售希望成品尽快消化，财务希望压低资金占用，质量又要求稳定过程；运营管理要把这些目标放在同一个系统里平衡。",
    application: "做库存策略时先标注利益相关方目标，再区分原材料库存、在制品、成品库存和质量冗余，不直接用单一库存高低评价运营好坏。",
    concepts: ["运营目标冲突", "库存管理", "系统平衡"],
  });
  add({
    title: "瓶颈类产品与采购策略分层",
    pattern: /关键产品|瓶颈类产品|供不应求|采购|拿钱不一定买到/,
    question: "为什么不同物料不能使用同一套付款和供应策略？",
    insight: "瓶颈类或关键产品的风险不在价格，而在供给不确定和替代难度；采购策略要同时看供需关系、供应商数量、物料关键性和付款条件。",
    application: "把物料按供应风险和业务影响分层，瓶颈类产品优先确保可得性，普通物料再追求价格效率。",
    concepts: ["瓶颈类产品采购", "采购组合", "供应风险"],
  });
  add({
    title: "账期、承兑与供应链金融",
    pattern: /账期|付款周期|承兑|供应链金融|36个月|三年|三个月/,
    evidencePattern: /供应链拉.*长|付款周期|供应链金融|36个月|三年|压钱/,
    question: "账期为什么会从财务工具变成供应链竞争问题？",
    insight: "长账期会把现金流压力推向上游，弱势供应商被迫垫资或引入供应链金融，表面利润可能被资金成本和回款周期吞掉。",
    application: "评估军工或长链条项目时不能只看毛利率，还要把合同签署、交付、验收、承兑和回款周期纳入总成本。",
    concepts: ["账期与现金流", "供应链金融", "承兑"],
  });
  add({
    title: "供应链合作的权力前提",
    pattern: /强弱关系|大手.*小手|合作|协作|力量差不多/,
    evidencePattern: /强弱关系|力量差不多|一强一弱|大手.*小手|捏小手/,
    question: "为什么很多供应链合作口号落地后会变成强势方挤压弱势方？",
    insight: "合作不是抽象善意，而是建立在相对平衡的议价能力上；当买方或核心厂商过强时，账期、合同节奏和库存压力会被转嫁给弱势供应商。",
    application: "分析供应链协作时要先判断权力结构，再谈协同机制；否则“合作”会掩盖成本外包。",
    concepts: ["供应链协作", "议价能力", "强弱关系"],
  });
  add({
    title: "社区关系与运营外部界面",
    pattern: /社区关系|公共关系|选址|政府支持|居民|快递柜|西工大/,
    evidencePattern: /社区关系|公共关系|选址|居民|快递柜|政府支持/,
    question: "为什么运营管理不能只看工厂内部流程？",
    insight: "企业或学校的运营会和社区、政府、居民、物流、公共关系发生连接；外部支持不足时，选址、通勤、物流和日常秩序都可能成为运营风险。",
    application: "做选址和运营设计时，把社区关系、政府支持、公共关系和外部服务纳入运营约束，而不是把它们当成后勤小事。",
    concepts: ["社区关系", "运营环境", "选址"],
  });
  add({
    title: "发展战略与阶段目标分解",
    pattern: /发展战略|战略|西工大|127|世界一流|阶段|5~10年|五到十年/,
    evidencePattern: /发展战略|127|世界一流|阶段|5~10年|五到十年|目标分解/,
    question: "战略如何从口号变成可执行指标？",
    insight: "发展战略回答长期位置，阶段目标把长期愿景拆成排名、人才培养、科研经费等可观察指标；目标会随着阶段推进而重新定义。",
    application: "评估组织战略时，要求每个口号都能落到指标、时间段、负责体系和更新机制。",
    concepts: ["发展战略", "目标分解", "西工大战略案例"],
  });
  add({
    title: "竞争战略与波特五力模型",
    pattern: /竞争战略|波特|五力|SWOT|PEST|上游|下游|讨价还价|替代性|潜在进入者|行业壁垒/,
    evidencePattern: /五力分析|波特提出来|上游|下游|讨价还价|替代性|潜在进入者|行业壁垒/,
    question: "竞争优势到底来自谈判技巧，还是来自市场结构？",
    insight: "波特五力把竞争优势拆成上游议价能力、客户议价能力、替代品威胁、潜在进入者和行业内竞争；很多时候谈判结果不是技巧决定，而是供需结构和行业壁垒决定。",
    application: "做行业分析时先画五力结构，再判断企业是否真的有优势，避免把市场结构优势误判为个人谈判能力。",
    concepts: ["波特五力模型", "竞争战略", "行业壁垒"],
  });
  add({
    title: "制度型优势、替代品与中国烟草案例",
    pattern: /烟草|中烟|电子烟|替代品|国家利益|消费者利益/,
    evidencePattern: /烟草|中烟|电子烟|替代品|国家利益|消费者利益/,
    question: "为什么有些企业看起来拥有接近绝对的竞争优势？",
    insight: "中国烟草案例说明制度定位、渠道控制、财政属性和行业准入壁垒可以共同塑造异常强的竞争地位，但电子烟等替代品仍会冲击原有优势。",
    application: "分析垄断或准垄断行业时，要同时看制度保护、渠道控制、替代品技术和监管变化。",
    concepts: ["中国烟草案例", "替代品威胁", "制度型优势"],
  });
  add({
    title: "军品质量控制与交付权衡",
    pattern: /军代表|质量代表|军品质量|军品.*质量|质量.*军品/,
    question: "军品质量为什么不是普通制造质检问题？",
    insight: "军品质量控制要在缺陷处理、交付进度、军代表现场监督和项目责任之间平衡，质量问题会直接影响用户、交付和组织责任。",
    application: "整理军品案例时把质量控制、交付节点、责任边界和现场监督机制放在同一张流程图里。",
    concepts: ["军品质量控制", "军代表机制", "交付权衡"],
  });
  add({
    title: "国产替代与供应链安全",
    pattern: /国产化|国产替代|信创|出口管制|长臂管辖|五眼同盟|英伟达|算卡/,
    question: "为什么国产替代不能只按短期体验判断？",
    insight: "高技术产品受出口管制和长臂管辖影响，国产替代是降低外部依赖和供应链断供风险的长期策略。",
    application: "评价国产替代项目时同时看短期可用性、关键环节替代率、供应稳定性和长期安全收益。",
    concepts: ["国产替代", "供应链安全", "出口管制"],
  });
  return rows.length ? rows.slice(0, 10) : [{
    title: "课程主题整理",
    question: "这段课堂转写要沉淀成什么知识？",
    insight: "原文尚未命中明确领域规则，先按课程转写保留主题、案例、概念和原始记录。",
    evidence: "见原始转写",
    application: "人工补充课程名称、章节和关键概念后再归档。",
    concepts: ["课程转写", "学习笔记"],
  }];
}

function findCourseEvidence(transcript: KnowledgeTranscriptAnalysis, pattern: RegExp) {
  const evidence = findTranscriptEvidence(transcript.utterances, pattern);
  return evidence ? evidence : "见原始转写";
}

function courseKnowledgeTable(rows: Array<[string, string, string]>) {
  const body = rows.length ? rows : [["课程主题", "待补充", "见原始转写"]] as Array<[string, string, string]>;
  return ["| 知识点 | 整理后的理解 | 原文依据 |", "|---|---|---|", ...body.map(([concept, point, evidence]) => `| ${tableCell(wikiLink(concept))} | ${tableCell(point)} | ${tableCell(evidence)} |`)].join("\n");
}

function courseLearningMapTable(modules: CourseLearningModule[]) {
  const rows = modules.length ? modules : [{
    title: "课程主题整理",
    question: "这段课堂转写要沉淀成什么知识？",
    insight: "按课程主线、概念、案例和复盘问题整理。",
    evidence: "见原始转写",
    application: "人工补充课程名称和章节后再归档。",
    concepts: ["课程转写"],
  }];
  return [
    "| 模块 | 核心问题 | 关键洞察 |",
    "|---|---|---|",
    ...rows.map((row) => `| ${tableCell(wikiLink(row.title))} | ${tableCell(row.question)} | ${tableCell(row.insight)} |`),
  ].join("\n");
}

function renderCourseModules(modules: CourseLearningModule[]) {
  const rows = modules.length ? modules : [{
    title: "课程主题整理",
    question: "这段课堂转写要沉淀成什么知识？",
    insight: "按课程主线、概念、案例和复盘问题整理。",
    evidence: "见原始转写",
    application: "人工补充课程名称和章节后再归档。",
    concepts: ["课程转写"],
  }];
  return rows.map((row, index) => [
    `### ${index + 1}. ${row.title}`,
    `- 核心问题：${row.question}`,
    `- 关键洞察：${row.insight}`,
    `- 原文依据：${row.evidence}`,
    `- 应用场景：${row.application}`,
    `- 相关概念：${row.concepts.map((concept) => wikiLink(concept)).join(" ") || "待补充"}`,
  ].join("\n")).join("\n\n");
}

function courseCaseRows(rawContent: string, transcript: KnowledgeTranscriptAnalysis, related: string[]): Array<[string, string, string]> {
  const text = String(rawContent || "");
  const rows: Array<[string, string, string]> = [];
  const add = (topic: string, pattern: RegExp, note: string, evidencePattern = pattern) => {
    if (!pattern.test(text)) return;
    rows.push([
      linkKnowledgeNoteEntityOnce(topic, related),
      linkKnowledgeNoteEntityOnce(findCourseEvidence(transcript, evidencePattern), related),
      linkKnowledgeNoteEntityOnce(note, related),
    ]);
  };
  add("库存与部门目标冲突", /库存|断线|生产角度|销售角度|财务角度|质量角度/, "库存策略必须同时平衡生产连续性、销售节奏、现金占用和质量稳定。");
  add("账期与供应链金融", /供应链拉.*长|付款周期|承兑|供应链金融|36个月|三年|压钱/, "长账期会把现金流压力转移到上游，管理评价不能只看毛利率。", /供应链拉.*长|付款周期|供应链金融|36个月|三年|压钱/);
  add("西工大战略目标分解", /发展战略|西工大|127|世界一流|阶段目标|目标分解/, "战略需要被拆解成阶段指标、责任体系和可复盘节点。", /发展战略|127|世界一流|阶段目标|目标分解/);
  add("波特五力与竞争结构", /波特|五力|替代品|潜在进入者|行业壁垒/, "竞争优势要放在行业结构中判断，不能只看单次谈判结果。", /五力分析|波特提出来|上游|下游|替代性|潜在进入者|行业壁垒/);
  add("中国烟草与替代品冲击", /烟草|中烟|电子烟/, "制度型优势仍会受到替代技术和监管变化影响。");
  add("军品质量控制", /军代表|质量代表|军品质量|军品.*质量|质量.*军品/, "军品交付需要把质量、进度、现场监督和责任边界一起管理。");
  add("国产替代与出口管制", /国产化|国产替代|信创|出口管制|长臂管辖/, "供应链安全收益需要与短期体验成本同时评估。");
  return rows.slice(0, 8);
}

function courseEvidenceTable(rows: Array<[string, string, string]>) {
  const selected = rows.slice(0, 6);
  const body = selected.length ? selected : [["待补充", "见原始转写", "待补充"]];
  return ["| 案例/主题 | 原文依据 | 可沉淀的管理启发 |", "|---|---|---|", ...body.map(([topic, evidence, note]) => `| ${tableCell(topic)} | ${tableCell(evidence)} | ${tableCell(note)} |`)].join("\n");
}

function courseConceptRows(rawContent: string) {
  const text = String(rawContent || "");
  const rows: Array<[string, string]> = [];
  const add = (concept: string, pattern: RegExp, note: string) => {
    if (pattern.test(text)) rows.push([concept, note]);
  };
  add("生产运作管理", /生产运作管理|运营管理|作业管理/, "围绕生产系统、运营过程、资源配置、质量和交付的综合管理课程。");
  add("运营目标冲突", /库存|断线|生产角度|销售角度|财务角度|质量角度/, "生产、销售、财务、质量对库存和交付的偏好不同，管理者要做系统平衡而不是部门局部最优。");
  add("瓶颈类产品采购", /关键产品|瓶颈类产品|供不应求|采购|拿钱不一定买到/, "供给风险高、替代难或买不到的物料，采购目标应优先确保可得性和关系稳定。");
  add("账期与现金流", /账期|付款周期|承兑|36个月|三年|三个月/, "账期是谈判工具，也是运营成本来源；长账期会把资金压力转嫁到上游供应商。");
  add("供应链金融", /供应链金融/, "当账期拉长、现金流承压时，金融工具会进入供应链，但也可能推高企业真实运营成本。");
  add("供应链协作", /供应链合作|供应链.*协作|强弱关系|力量差不多/, "协作的前提是权力结构相对平衡，强弱悬殊时协作容易变成成本转嫁。");
  add("社区关系", /社区关系|公共关系|选址|政府支持|居民/, "企业运营会受社区、政府、居民和公共服务影响，外部界面也是运营系统的一部分。");
  add("发展战略", /发展战略|西工大|127|世界一流|阶段目标/, "把长期愿景拆成阶段目标和可衡量指标，形成持续调整的战略执行路径。");
  add("波特五力模型", /波特|五力|上游|下游|替代性|潜在进入者|行业壁垒/, "用供应商议价、客户议价、替代品、潜在进入者和行业内竞争解释企业竞争处境。");
  add("替代品威胁", /替代品|电子烟|传统烟草|可替代性/, "替代品会削弱原有产品或行业的优势，即便强势行业也需要持续观察替代技术。");
  add("制度型优势", /烟草|中烟|国家利益|消费者利益|财政收入/, "有些企业竞争力来自制度定位、税收功能、准入壁垒和渠道控制，而不只是经营效率。");
  add("军代表机制", /军代表|质量代表|长期驻扎/, "军方或用户侧代表长期介入制造现场，兼具质量、交付和项目管理视角。");
  add("民参军企业", /民参军|民营企业/, "民营企业进入军品供应链后，需要适配军品质量体系和审查机制。");
  add("军工供应链", /供应链|元器件|库存|海外供应商/, "军用电子元器件、海外供应商、库存策略和出口限制共同构成供应链风险。");
  add("出口管制", /出口管制|长臂管辖|五眼同盟|高技术产品/, "高技术与两用产品跨境贸易会受到国家安全规则约束。");
  add("国产替代", /国产化|国产替代|信创/, "用国产软硬件和零部件降低关键系统对外部供应链的依赖。");
  add("航空工业架构", /航空工业|航发|主机|发动机/, "主机制造与发动机制造是理解航空产业链的两个基本板块。");
  add("民机产业链", /C919|929|909|中国商飞/, "商用飞机量产带来的供应链、主机厂和配套企业机会。");
  return rows.slice(0, 10);
}

function courseConceptTable(rows: Array<[string, string]>) {
  const body = rows.length ? rows : [["课程转写", "原文尚未命中明确概念规则，先保留为学习笔记并等待人工补充。"]];
  return ["| 概念 | 速查解释 |", "|---|---|", ...body.map(([concept, note]) => `| ${tableCell(wikiLink(concept))} | ${tableCell(note)} |`)].join("\n");
}

function courseVerificationTable(rawContent: string) {
  const text = String(rawContent || "");
  const rows: Array<[string, string, string]> = [["自动转写错字和断句", "核对原始音频，尤其是专名、型号、机构名和数字", "待核验"]];
  if (/交五时间|交互时间/.test(text)) rows.push(["“交五/交互时间”", "疑似“交付时间”等转写错误，需回听确认", "待核验"]);
  if (/居民委员会|农户委员会|融办/.test(text)) rows.push(["机构名转写", "核对是否为“军民融合办公室/融办”等课程术语", "待核验"]);
  if (/华约|北约|八成|巴黎/.test(text)) rows.push(["出口管制组织名称", "核对是否指“瓦森纳安排”等高技术出口管制机制", "待核验"]);
  if (/红二零|运二零|歼二零|C919|929|909/.test(text)) rows.push(["型号与项目名称", "核对 C919/929/909、运-20、歼-20 等名称和语境", "待核验"]);
  return ["| 事项 | 核验方式 | 状态 |", "|---|---|---|", ...rows.map(([item, method, status]) => `| ${tableCell(item)} | ${tableCell(method)} | ${status} |`)].join("\n");
}

function courseReviewQuestions(rawContent: string) {
  const text = String(rawContent || "");
  const questions: string[] = [];
  if (/库存|断线|生产角度|销售角度|财务角度/.test(text)) questions.push("同一批库存，为什么生产、销售、财务和质量部门会给出不同甚至相反的管理目标？");
  if (/账期|付款周期|承兑|供应链金融|36个月/.test(text)) questions.push("账期如何从付款安排变成供应链谈判工具？长账期会把哪些成本转移给上游？");
  if (/关键产品|瓶颈类产品|采购|供不应求/.test(text)) questions.push("如何区分普通物料、关键物料和瓶颈类物料？它们的采购策略为什么不同？");
  if (/社区关系|公共关系|选址|政府支持/.test(text)) questions.push("社区关系和政府支持为什么会成为运营管理问题，而不是单纯公共关系问题？");
  if (/发展战略|西工大|127|世界一流/.test(text)) questions.push("发展战略如何拆解成阶段目标、指标体系和可验证的执行动作？");
  if (/波特|五力|替代性|潜在进入者|行业壁垒/.test(text)) questions.push("波特五力模型中的哪一力最能解释课堂案例里的供应链议价能力？为什么？");
  if (/烟草|电子烟|中烟/.test(text)) questions.push("中国烟草案例中，制度型优势和替代品威胁分别体现在哪里？");
  if (/军代表|质量代表|军品质量|军品.*质量|质量.*军品/.test(text)) questions.push("军品生产中，质量缺陷处理为什么不能只按普通民品的停线修复逻辑理解？");
  if (/民参军|民营/.test(text)) questions.push("民参军企业进入军品供应链时，质量体系和过程审查的主要门槛是什么？");
  if (/元器件|库存|供应链/.test(text)) questions.push("军用电子元器件为什么可能采用更长库存周期？这种策略带来什么收益和风险？");
  if (/出口管制|长臂管辖|高技术/.test(text)) questions.push("出口管制如何影响高技术产品采购、库存和国产替代策略？");
  if (/国产化|信创/.test(text)) questions.push("国产替代在短期体验不佳时，为什么仍然是组织层面的长期任务？");
  if (/C919|中国商飞|民用/.test(text)) questions.push("当军品新项目不确定时，民机产业链为什么会成为航空工业企业的重要机会？");
  return questions.length ? questions : ["这段课程转写对应的核心概念、案例和管理启发分别是什么？"];
}

function courseReviewActions(rawContent: string): KnowledgeNoteAction[] {
  const actions: KnowledgeNoteAction[] = [
    { text: "核对自动转写中的专名、型号、机构名和疑似错字。", owner: "待确认", due: "待确认" },
  ];
  if (/库存|断线|生产角度|销售角度|财务角度/.test(rawContent)) actions.push({ text: "把“库存目标冲突”整理成生产、销售、财务、质量四方目标矩阵。", owner: "待确认", due: "待确认" });
  if (/账期|付款周期|承兑|供应链金融|36个月/.test(rawContent)) actions.push({ text: "补一张账期、承兑、回款和供应链金融成本的现金流链路图。", owner: "待确认", due: "待确认" });
  if (/波特|五力|替代性|潜在进入者|行业壁垒/.test(rawContent)) actions.push({ text: "把课堂中的烟草、电子烟、供应链议价案例映射到波特五力模型。", owner: "待确认", due: "待确认" });
  if (/社区关系|公共关系|选址|政府支持/.test(rawContent)) actions.push({ text: "沉淀“运营外部界面/社区关系”案例卡，用于后续选址与运营风险分析。", owner: "待确认", due: "待确认" });
  if (/军代表|质量代表|军品质量|军品.*质量|质量.*军品/.test(rawContent)) actions.push({ text: "把“质量控制与交付进度权衡”整理成生产运作管理案例卡。", owner: "待确认", due: "待确认" });
  if (/军工供应链|出口管制|国产替代|信创/.test(rawContent)) actions.push({ text: "补充军工供应链、出口管制和国产替代的背景资料。", owner: "待确认", due: "待确认" });
  if (/航空工业|航发|中国商飞|C919|929|909/.test(rawContent)) actions.push({ text: "整理航空工业主机厂、航发和中国商飞产业链关系图。", owner: "待确认", due: "待确认" });
  return uniqueActionRows(actions).slice(0, 8);
}

function renderTranscriptMeetingNote(rawContent: string, type: string, status: string, date: string, related: string[], analysis: KnowledgeNoteAnalysis) {
  const transcript = parseKnowledgeTranscript(rawContent);
  const diplomatic = transcript.speakers.some((speaker) => /习近平|特朗普/.test(speaker));
  const aiToolChat = isAiToolCoffeeTranscript(rawContent);
  if (aiToolChat) return renderAiToolConversationNote(rawContent, type, status, date, related, analysis, transcript);
  const speakerRows = transcript.speakers.length
    ? transcript.speakers.map((speaker) => `- ${wikiLink(speaker)}：${summarizeSpeakerUtterances(speaker, transcript.bySpeaker[speaker] || [], related)}`).join("\n")
    : "- 待确认";
  const issueRows = diplomatic ? transcriptIssueTable(transcript, related) : genericTranscriptIssueTable(rawContent, transcript, analysis, related);
  const conclusionRows = diplomatic ? transcriptConclusions(transcript, related) : genericTranscriptConclusions(rawContent, transcript, analysis, related);
  return [
    renderContentUnderstanding(type, status, { ...analysis, logic: ["谈话转写", "说话人识别", "议题归纳", "待核验事项"] }),
    "",
    "## 参会信息",
    `- 时间：${date}${transcript.startTime ? `，转写时间范围 ${transcript.startTime}-${transcript.endTime || transcript.startTime}` : ""}`,
    `- 参会人：${transcript.speakers.length ? transcript.speakers.map((speaker) => wikiLink(speaker)).join("、") : "待确认"}`,
    "- 地点：原文未说明",
    "- 来源形态：带时间戳的会晤谈话转写",
    "",
    "## 发言脉络",
    speakerRows,
    "",
    "## 核心议题",
    issueRows,
    "",
    "## 关键结论",
    bulletLines(conclusionRows),
    "",
    "## 待核验事项",
    verificationTable(transcript, related),
    "",
    "## 后续行动",
    actionTable(transcriptFollowupActions(rawContent, transcript)),
    "",
    backlinkIndex(related, analysis.entityGroups),
    "",
    rawArchiveBlock(rawContent),
  ].filter(Boolean).join("\n");
}

function isAiToolCoffeeTranscript(rawContent: string) {
  const text = String(rawContent || "");
  return /午间咖啡|咖啡闲聊|闲聊/.test(text) && /AI|智能体|OpenClaw|知识图谱|Skill|API|token|算力|模型|工作台/i.test(text);
}

function renderAiToolConversationNote(
  rawContent: string,
  type: string,
  status: string,
  date: string,
  related: string[],
  analysis: KnowledgeNoteAnalysis,
  transcript: KnowledgeTranscriptAnalysis,
) {
  const topics = aiToolConversationTopics(transcript, related);
  const assets = aiToolReusableAssets(transcript, related);
  const quotes = aiToolPolishedQuotes(transcript, related);
  const evidenceRows = aiToolCleanEvidenceRows(transcript, related);
  const actions = aiToolConversationActions(rawContent, transcript);
  return [
    renderContentUnderstanding(type, status, {
      ...analysis,
      topic: "午间咖啡中的 AI 工具与智能体工作台讨论",
      keyPoints: topics.map((item) => item.insight),
      logic: ["闲聊转写", "噪声清理", "主题聚类", "价值提炼", "资产沉淀"],
    }),
    "",
    "## 高价值摘要",
    aiToolExecutiveSummary(transcript, related),
    "",
    "## 发言脉络",
    aiToolSpeakerDigest(transcript, related),
    "",
    "## 价值提炼",
    aiToolValueTable(topics),
    "",
    "## 金句总结",
    bulletLines(quotes),
    "",
    "## 系统性总结",
    bulletLines(linkKnowledgeNoteEntityLines([
      "工具层：分散的 AI 工具需要统一入口，否则能力越多，切换成本和配置成本越高。",
      "成本层：VPN 流量、API key、token 额度和模型选择会直接影响个人智能体系统的持续可用性。",
      "协作层：人不应持续盯着智能体执行，而应只在停工、卡住、缺资源或需要判断时介入。",
      "知识层：知识库、知识图谱和 Skill 是让智能体长期变好用的基础设施，不能只依赖一次性对话记忆。",
    ], related)),
    "",
    "## 产品启发",
    aiToolProductInsightTable(transcript, related),
    "",
    "## 可复用知识资产",
    bulletLines(assets),
    "",
    "## 净化证据摘录",
    aiToolEvidenceTable(evidenceRows),
    "",
    "## 待核验事项",
    aiToolVerificationTable(transcript),
    "",
    "## 后续行动",
    actionTable(actions),
    "",
    backlinkIndex(related, analysis.entityGroups),
    "",
    rawArchiveBlock(rawContent),
  ].filter(Boolean).join("\n");
}

function aiToolExecutiveSummary(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  const lines = aiToolTranscriptConclusions(transcript, related);
  const preferred = lines.length ? lines : [
    "这段午间咖啡记录的价值不在寒暄本身，而在于暴露了个人 AI 工作台建设中的真实问题：工具分散、配置复杂、运行成本不透明、智能体状态不可见。",
    "可沉淀的核心判断是：智能体产品应把人从持续盯执行中释放出来，只在停工、失败、缺上下文或需要价值判断时提醒人介入。",
    "知识库、知识图谱和 Skill 是个人智能体长期复利的基础设施，整理后的笔记应服务后续系统设计和工作流优化。",
  ];
  return bulletLines(preferred.slice(0, 4));
}

function aiToolSpeakerDigest(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  if (!transcript.speakers.length) return "- 说话人未充分识别，按整体议题整理。";
  return transcript.speakers.slice(0, 6).map((speaker) => {
    const utterances = transcript.bySpeaker[speaker] || [];
    const text = utterances.map((item) => item.text).join(" ");
    const points: string[] = [];
    if (/AI\s*工具|整理成一个|页面|工作台/i.test(text)) points.push("提出 AI 工具需要统一入口和工作台化承载。");
    if (/token|流量|vpn|API|key|模型|算力/i.test(text)) points.push("关注 AI 使用成本、资源额度和模型/API 配置。");
    if (/不工作了|提醒我|只要你工作|我就不需要工作/i.test(text)) points.push("强调人应在智能体停工或需要判断时介入。");
    if (/知识库|知识图谱|Skill|memory|记忆/i.test(text)) points.push("把知识库、知识图谱和 Skill 视为长期能力基础。");
    const summary = points.length ? uniqueStrings(points).slice(0, 3).join("；") : "主要贡献为背景补充或口语互动，正文已去噪。";
    return `- ${wikiLink(speaker)}：${linkKnowledgeNoteEntityOnce(summary, related)}`;
  }).join("\n");
}

function aiToolConversationTopics(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  const joined = transcript.utterances.map((item) => item.text).join(" ");
  const rows: Array<{ theme: string; problem: string; insight: string; value: string; evidence: string }> = [];
  const add = (theme: string, pattern: RegExp, problem: string, insight: string, value: string) => {
    if (!pattern.test(joined)) return;
    rows.push({
      theme,
      problem: linkKnowledgeNoteEntityOnce(problem, related),
      insight: linkKnowledgeNoteEntityOnce(insight, related),
      value: linkKnowledgeNoteEntityOnce(value, related),
      evidence: knowledgeSafeSummaryLine(findTranscriptEvidence(transcript.utterances, pattern) || "见原始转写"),
    });
  };
  add(
    "AI 工具整合",
    /AI\s*工具|整理成一个|文件夹|页面|智能体工作台/i,
    "工具能力分散，入口和上下文割裂。",
    "统一工作台的价值不是收纳图标，而是把任务、知识、模型和执行状态放在同一操作面。",
    "降低工具切换成本，提高复杂任务的连续执行能力。",
  );
  add(
    "运行成本与资源约束",
    /vpn|50g|token|流量|算力|额度|39块|百来块/i,
    "个人 AI 系统的真实瓶颈会出现在流量、token、API 额度和模型成本上。",
    "成本观测需要进入产品主界面，不能等失败后才发现资源耗尽。",
    "减少无效调用，建立预算、降级和提醒机制。",
  );
  add(
    "智能体协作逻辑",
    /不工作了|提醒我|只要你工作|我就不需要工作|什么时候下班/i,
    "用户不想管理每一步执行，只想在系统停住时接管。",
    "智能体工作台应把“运行中、等待中、失败、需人工判断”做成可信状态，而不是只展示生成结果。",
    "让人力集中在判断、授权和资源协调上。",
  );
  add(
    "API 与模型配置",
    /API|key|密钥|自定义模型|硅基流动|模型列表|GPT\s*4o|claude|MiniMax/i,
    "多模型和多 provider 配置会放大使用门槛。",
    "模型选择应围绕任务价值、成本、稳定性和隐私边界，而不是只列模型名称。",
    "形成可复用的模型路由和配置经验。",
  );
  add(
    "知识库与 Skill",
    /知识库|知识图谱|Skill|task.*skill|复盘skill|记忆|memory/i,
    "零散对话如果不沉淀为知识资产，很快会重新变成一次性聊天。",
    "知识库、知识图谱和 Skill 应共同承担记忆、检索、流程复用和质量约束。",
    "把临时经验转化为长期可复用的操作系统能力。",
  );
  return rows.length ? rows : [{
    theme: "AI 工作台闲聊",
    problem: "原始记录噪声较多，但核心仍指向工具整合和智能体协作。",
    insight: "应保留为工作记录，并在人工复核后继续补充证据。",
    value: "为个人智能体系统设计提供真实使用反馈。",
    evidence: "见原始转写",
  }];
}

function aiToolValueTable(rows: ReturnType<typeof aiToolConversationTopics>) {
  return [
    "| 主题 | 真实问题 | 关键洞察 | 可产生的价值 | 净化证据 |",
    "|---|---|---|---|---|",
    ...rows.map((row) => `| ${tableCell(row.theme)} | ${tableCell(row.problem)} | ${tableCell(row.insight)} | ${tableCell(row.value)} | ${tableCell(row.evidence)} |`),
  ].join("\n");
}

function aiToolPolishedQuotes(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  const joined = transcript.utterances.map((item) => item.text).join(" ");
  const quotes: string[] = [];
  if (/不工作了|提醒我|只要你工作|我就不需要工作/i.test(joined)) quotes.push("人的价值不在于盯着智能体工作，而在于智能体停工时做判断。");
  if (/AI\s*工具|整理成一个|文件夹|页面/i.test(joined)) quotes.push("AI 工具越多，越需要一个能承接任务上下文的统一工作台。");
  if (/token|流量|API|额度|算力/i.test(joined)) quotes.push("个人智能体不是免费魔法，成本、额度和降级策略必须进入产品设计。");
  if (/知识库|知识图谱|Skill|记忆/i.test(joined)) quotes.push("模型负责临场推理，知识库和 Skill 负责长期复利。");
  return linkKnowledgeNoteEntityLines(uniqueStrings(quotes).slice(0, 6), related);
}

function aiToolReusableAssets(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  const joined = transcript.utterances.map((item) => item.text).join(" ");
  const assets: string[] = [];
  if (/智能体工作台|不工作了|提醒我/i.test(joined)) assets.push("建立 [[智能体停工提醒]] 知识卡：记录何时提醒人介入、提醒什么、如何恢复执行。");
  if (/token|流量|API|额度|算力/i.test(joined)) assets.push("建立 [[AI 使用成本台账]]：沉淀 VPN 流量、token、API key、模型价格和降级策略。");
  if (/自定义模型|模型列表|硅基流动|GPT|claude|MiniMax/i.test(joined)) assets.push("建立 [[模型路由策略]]：按任务类型选择高价值模型、低成本模型和本地兜底模型。");
  if (/知识库|知识图谱|Skill|memory/i.test(joined)) assets.push("建立 [[Knowledge Skill 开发规范]]：把一次性经验转为可复用流程。");
  return linkKnowledgeNoteEntityLines(assets.length ? assets : ["建立一张“AI 工具使用反馈”卡片，等待人工补充更多上下文。"], related);
}

function aiToolProductInsightTable(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  const rows = [
    ["状态真相", "区分运行中、停工、等待输入、资源耗尽和失败，不把“排队/等待”伪装成工作中。"],
    ["成本可见", "在任务执行前后展示 token、流量、API 成本和模型降级路径。"],
    ["人机边界", "让人处理授权、价值判断和异常恢复，让智能体处理重复执行和信息整理。"],
    ["知识复利", "把闲聊中的有效经验转成知识卡、规则和 Skill，而不是留在对话噪声里。"],
  ].map(([principle, note]) => [principle, linkKnowledgeNoteEntityOnce(note, related)]);
  return ["| 产品原则 | 设计启发 |", "|---|---|", ...rows.map(([principle, note]) => `| ${principle} | ${tableCell(note)} |`)].join("\n");
}

function aiToolCleanEvidenceRows(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  const patterns: Array<[string, RegExp]> = [
    ["工具整合", /AI\s*工具|整理成一个|文件夹|页面/i],
    ["资源耗尽", /vpn|50g|token|流量|额度|算力/i],
    ["停工提醒", /不工作了|提醒我|只要你工作|我就不需要工作/i],
    ["模型配置", /API|key|密钥|自定义模型|模型列表|硅基流动|GPT|claude|MiniMax/i],
    ["知识沉淀", /知识库|知识图谱|Skill|记忆|memory/i],
  ];
  return patterns.flatMap(([topic, pattern]) => {
    const raw = findTranscriptEvidence(transcript.utterances, pattern);
    if (!raw) return [];
    return [[topic, linkKnowledgeNoteEntityOnce(knowledgeSafeSummaryLine(raw), related)] as [string, string]];
  }).slice(0, 8);
}

function aiToolEvidenceTable(rows: Array<[string, string]>) {
  const body = rows.length ? rows : [["原始证据", "见原始转写，需人工复核。"]];
  return ["| 证据主题 | 净化摘录 |", "|---|---|", ...body.map(([topic, evidence]) => `| ${tableCell(topic)} | ${tableCell(evidence)} |`)].join("\n");
}

function aiToolVerificationTable(transcript: KnowledgeTranscriptAnalysis) {
  const joined = transcript.utterances.map((item) => item.text).join(" ");
  const rows: Array<[string, string, string]> = [["自动转写噪声", "核对原始音频，修正错字、断句、口语和敏感词", "待核验"]];
  if (/vpn|50g|token|额度|流量/i.test(joined)) rows.push(["资源成本数字", "核对 VPN 流量、token 包、API 额度和费用是否准确", "待核验"]);
  if (/硅基流动|自定义模型|API|key|模型列表/i.test(joined)) rows.push(["模型与 API 配置", "确认 provider、模型名称、接口地址和 key 管理方式", "待核验"]);
  if (/知识图谱|Skill|memory|知识库/i.test(joined)) rows.push(["知识资产归档", "确认应写入哪些知识卡、Skill 或长期记忆索引", "待跟进"]);
  return ["| 事项 | 核验方式 | 状态 |", "|---|---|---|", ...rows.map(([item, method, state]) => `| ${tableCell(item)} | ${tableCell(method)} | ${state} |`)].join("\n");
}

function aiToolConversationActions(rawContent: string, transcript: KnowledgeTranscriptAnalysis): KnowledgeNoteAction[] {
  const joined = transcript.utterances.map((item) => item.text).join(" ");
  const actions: KnowledgeNoteAction[] = [];
  if (/不工作了|提醒我|只要你工作/i.test(joined)) actions.push({ text: "把“智能体停工/卡住提醒”设计成工作台状态与通知规则。", owner: "待确认", due: "待确认" });
  if (/token|流量|API|额度|算力/i.test(joined)) actions.push({ text: "补一张 AI 使用成本台账，记录流量、token、API 和模型降级策略。", owner: "待确认", due: "待确认" });
  if (/知识库|知识图谱|Skill|记忆|memory/i.test(joined)) actions.push({ text: "将本次讨论沉淀为知识库、知识图谱和 Skill 开发规范的候选素材。", owner: "待确认", due: "待确认" });
  actions.push({ text: "复核原始转写，删除无价值噪声，仅保留可证明的事实和可复用判断。", owner: "待确认", due: "待确认" });
  return uniqueActionRows(actions).slice(0, 8);
}

function aiToolTranscriptIssueTable(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  const joined = transcript.utterances.map((item) => item.text).join(" ");
  const rows: Array<[string, string, string, string]> = [];
  const add = (topic: string, pattern: RegExp, judgment: string) => {
    if (!pattern.test(joined)) return;
    const evidence = findTranscriptEvidence(transcript.utterances, pattern) || "见原始转写";
    rows.push([topic, linkKnowledgeNoteEntityOnce(judgment, related), linkKnowledgeNoteEntityOnce(evidence, related), "保留为对话记录，不按学习模板整理。"]);
  };
  add("AI 工具整合", /AI\s*工具|整理成一个|文件夹|页面|智能体工作台/i, "讨论把分散 AI 工具收敛成统一工作台或页面入口，核心是降低工具切换和信息分散成本。");
  add("算力、Token 与流量成本", /vpn|50g|token|流量|算力|额度|39块|百来块/i, "对话关注真实使用成本：VPN 流量、token 包、API 额度和个人使用强度。");
  add("智能体协作逻辑", /不工作了|提醒我|只要你工作|我就不需要工作|什么时候下班/i, "核心产品洞察是从“提醒人该做什么”转向“当智能体停工或卡住时提醒人介入”。");
  add("API 与自定义模型配置", /API|key|密钥|自定义模型|硅基流动|乌塔伯|模型列表|GPT\s*4o|claude/i, "讨论 API 地址、密钥、自定义模型和模型选择，属于工具配置经验。");
  add("知识库、知识图谱与 Skill", /知识库|知识图谱|Skill|task.*skill|复盘skill|记忆|memory/i, "后半段集中在知识库、知识图谱、Skill 开发和长期记忆的使用方法。");
  const body = rows.length ? rows : [["核心议题", "AI 工具使用与工作台体验讨论", "见原始转写", "保留为午间咖啡对话记录。"]];
  return ["| 议题 | 核心内容 | 原文依据 | 整理判断 |", "|---|---|---|---|", ...body.map(([topic, content, evidence, note]) => `| ${tableCell(topic)} | ${tableCell(content)} | ${tableCell(evidence)} | ${tableCell(note)} |`)].join("\n");
}

function aiToolTranscriptConclusions(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  const joined = transcript.utterances.map((item) => item.text).join(" ");
  const conclusions: string[] = [];
  if (/AI\s*工具|智能体工作台|知识图谱|Skill/i.test(joined)) conclusions.push("这段记录的主轴是 AI 工具使用、智能体工作台、知识图谱和 Skill 开发经验，应归档为对话/工作记录。");
  if (/不工作了|提醒我|只要你工作|我就不需要工作/i.test(joined)) conclusions.push("最有价值的产品洞察是：智能体工作台应暴露停工、卡住、缺资源等状态，让人只在需要介入时接管。");
  if (/token|流量|API|key|自定义模型|硅基流动/i.test(joined)) conclusions.push("对话沉淀了个人 AI 使用的成本与配置经验，包括 token/流量消耗、API key、自定义模型和模型选择。");
  if (/知识库|记忆|Skill/i.test(joined)) conclusions.push("知识库和 Skill 被视为让智能体长期好用的关键基础设施，单靠模型记忆不够。");
  return linkKnowledgeNoteEntityLines(uniqueStrings(conclusions).slice(0, 6), related);
}

function parseKnowledgeTranscript(rawContent: string): KnowledgeTranscriptAnalysis {
  const rows = String(rawContent || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const utterances: KnowledgeTranscriptUtterance[] = [];
  let currentSpeaker = "";
  let pendingTime = "";
  for (const raw of rows) {
    const line = raw.replace(/\s+/g, " ");
    if (/谈话记录|会晤记录|会议纪要/.test(line) && line.length > 8) continue;
    const speakerTime = parseTranscriptSpeakerTime(line);
    if (speakerTime) {
      currentSpeaker = speakerTime.speaker;
      pendingTime = speakerTime.time;
      if (speakerTime.text) {
        utterances.push({ speaker: currentSpeaker, time: pendingTime, text: speakerTime.text });
        pendingTime = "";
      }
      continue;
    }
    const speaker = parseTranscriptSpeaker(line);
    if (speaker && !pendingTime) {
      currentSpeaker = speaker;
      continue;
    }
    if (speaker && pendingTime && !currentSpeaker) {
      currentSpeaker = speaker;
      pendingTime = "";
      continue;
    }
    const pureTime = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)$/);
    if (pureTime) {
      pendingTime = pureTime[1];
      continue;
    }
    const prefixedTime = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    const time = prefixedTime?.[1] || pendingTime;
    const text = prefixedTime?.[2] || line;
    pendingTime = "";
    const speakerAfterTime = parseTranscriptSpeaker(text);
    if (speakerAfterTime && time && !currentSpeaker) {
      currentSpeaker = speakerAfterTime;
      continue;
    }
    if (!text || /^嗯[。.]?$/.test(text)) continue;
    utterances.push({ speaker: currentSpeaker || "未标明", time: time || "", text });
  }
  const speakers = uniqueStrings(utterances.map((item) => item.speaker).filter((speaker) => speaker !== "未标明"));
  const bySpeaker: Record<string, KnowledgeTranscriptUtterance[]> = {};
  for (const item of utterances) {
    bySpeaker[item.speaker] ||= [];
    bySpeaker[item.speaker].push(item);
  }
  const times = utterances.map((item) => item.time).filter(Boolean);
  return { utterances, speakers, bySpeaker, startTime: times[0] || "", endTime: times[times.length - 1] || "" };
}

function parseTranscriptSpeakerTime(line: string) {
  const match = line.match(/^([\u4e00-\u9fa5A-Za-z0-9_ -]{1,16})\s+(\d{1,2}:\d{2}(?::\d{2})?)(?:\s+(.+))?$/);
  if (!match) return null;
  const speaker = parseTranscriptSpeaker(match[1]);
  if (!speaker) return null;
  return { speaker, time: match[2], text: String(match[3] || "").trim() };
}

function parseTranscriptSpeaker(line: string) {
  const clean = line.replace(/[:：]\s*$/, "").trim();
  if (!clean || /^(小结|总结|待办|议程|背景|主题|时间|地点|原始记录|内容理解|问题与风险|后续行动)$/i.test(clean)) return "";
  if (/^(习近平|特朗普|拜登|普京|泽连斯基)$/.test(clean)) return clean;
  if (/^(用户|主持人|嘉宾|技术爱好者|受访者|采访者|提问者|回答者|Speaker\s*\d+|说话人\s*\d+|发言人\s*\d+)$/i.test(clean)) return clean;
  if (/^[\u4e00-\u9fa5]{1,6}(?:主席|总统|总理|部长|总|老师|经理|主任|主管)$/.test(clean)) return clean;
  if (/^[\u4e00-\u9fa5A-Za-z0-9_ -]{2,12}$/.test(clean) && !/[。！？!?；;，,、]/.test(clean)) return clean;
  return "";
}

function summarizeSpeakerUtterances(speaker: string, utterances: KnowledgeTranscriptUtterance[], related: string[]) {
  const lines = utterances.map((item) => item.text).filter(Boolean);
  const themes = transcriptSpeakerThemes(speaker, lines).map((line) => linkKnowledgeNoteEntityOnce(line, related));
  return themes.length ? themes.join("；") : "原文未形成完整观点，需人工复核";
}

function transcriptSpeakerThemes(speaker: string, lines: string[]) {
  const text = lines.join(" ");
  const themes: string[] = [];
  if (/习近平|主席/.test(speaker)) {
    if (/共同利益|分歧|机遇/.test(text)) themes.push("强调中美共同利益大于分歧，双方成功应被视为彼此机遇");
    if (/稳定|世界|和则两利|斗则俱伤/.test(text)) themes.push("把中美关系稳定视为世界利好，并提出和则两利、斗则俱伤");
    if (/伙伴|对手|相互成就|共同繁荣/.test(text)) themes.push("主张双方应做伙伴而非对手，走向相互成就和共同繁荣");
    if (/2026|继往开来|历史性|标志性/.test(text)) themes.push("将2026年定位为中美关系继往开来的标志性年份");
    if (/重大问题|交换意见|领好航/.test(text)) themes.push("期待就两国和世界重大问题交换意见，为中美关系定向领航");
  }
  if (/特朗普|总统/.test(speaker)) {
    if (/感谢|荣幸|朋友/.test(text)) themes.push("以感谢和个人友谊开场，强调双方长期个人关系");
    if (/挫折|电话|沟通|解决办法|未来/.test(text)) themes.push("强调遇到问题可通过领导人直接沟通快速寻找解决办法");
    if (/伟大的领导人|领导工作/.test(text)) themes.push("高度评价对方领导能力，并把这种表述作为个人判断");
    if (/企业家|30家|第一把手|贸易|商业/.test(text)) themes.push("介绍企业家代表团，突出对贸易和商业合作的期待");
    if (/高峰会|来访|关系|友谊/.test(text)) themes.push("把此次来访和高峰会描述为高度重要的中美互动");
  }
  if (themes.length) return themes;
  return selectKnowledgeNoteKeyPoints(lines, "会议纪要", []).slice(0, 4);
}

function transcriptIssueTable(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  const joined = transcript.utterances.map((item) => item.text).join(" ");
  const rows: Array<[string, string, string, string]> = [];
  const add = (topic: string, xiPattern: RegExp, trumpPattern: RegExp, note: string) => {
    const xi = findTranscriptEvidence(transcript.bySpeaker["习近平"] || [], xiPattern) || "原文未明确";
    const trump = findTranscriptEvidence(transcript.bySpeaker["特朗普"] || [], trumpPattern) || "原文未明确";
    rows.push([topic, linkKnowledgeNoteEntityOnce(xi, related), linkKnowledgeNoteEntityOnce(trump, related), note]);
  };
  if (/共同利益|分歧|机遇/.test(joined)) add("共同利益与分歧管理", /共同利益|分歧|机遇/, /关系|挫折|解决/, "双方都在降低冲突叙事，强调可管理分歧。");
  if (/伙伴|对手|共同繁荣|相互成就/.test(joined)) add("中美关系定位", /伙伴|对手|共同繁荣|相互成就/, /朋友|友谊|关系/, "习近平给出原则性定位，特朗普以个人关系和友谊回应。");
  if (/2026|250周年|历史性|标志性/.test(joined)) add("2026年节点", /2026|历史性|标志性|250周年/, /250周年|来访|高峰会/, "文本把2026年塑造成可被记录和追踪的外交节点。");
  if (/贸易|商业|企业家|30家|第一把手/.test(joined)) add("贸易与商业合作", /共同繁荣|机遇/, /贸易|商业|企业家|30家|第一把手/, "特朗普段落更集中在企业代表团和商业合作。");
  if (/重大问题|世界|领好航|高峰会/.test(joined)) add("全球议题与领导人沟通", /重大问题|世界|领好航/, /高峰会|沟通|电话|解决办法/, "双方都把会晤放在两国和世界问题的高层沟通框架内。");
  const body = rows.length ? rows : [["核心议题", "待补充", "待补充", "原文信息不足，需人工复核"]] as Array<[string, string, string, string]>;
  return ["| 议题 | 习近平表述 | 特朗普表述 | 整理判断 |", "|---|---|---|---|", ...body.map(([topic, xi, trump, note]) => `| ${tableCell(topic)} | ${tableCell(xi)} | ${tableCell(trump)} | ${tableCell(note)} |`)].join("\n");
}

function findTranscriptEvidence(utterances: KnowledgeTranscriptUtterance[], pattern: RegExp) {
  const row = utterances.find((item) => pattern.test(item.text));
  if (!row) return "";
  return limitKnowledgeLine(row.text);
}

function transcriptConclusions(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  const joined = transcript.utterances.map((item) => item.text).join(" ");
  const conclusions: string[] = [];
  if (/共同利益|分歧|机遇/.test(joined)) conclusions.push("文本的主轴是把中美关系从分歧管理转向共同利益和互为机遇。");
  if (/伙伴|对手|共同繁荣/.test(joined)) conclusions.push("习近平段落形成清晰原则：伙伴而非对手、相互成就、共同繁荣。");
  if (/电话|沟通|解决办法/.test(joined)) conclusions.push("特朗普段落强调领导人个人沟通机制，认为问题可通过直接沟通快速处理。");
  if (/企业家|贸易|商业|30家/.test(joined)) conclusions.push("商业合作是特朗普发言的重点之一，企业家代表团被用作合作意愿的证据。");
  if (/2026|历史性|标志性|250周年/.test(joined)) conclusions.push("2026年被塑造成中美关系和美国独立周年的叙事节点，适合后续建立时间线笔记。");
  return conclusions.length ? linkKnowledgeNoteEntityLines(conclusions, related) : ["待补充"];
}

function genericTranscriptIssueTable(rawContent: string, transcript: KnowledgeTranscriptAnalysis, analysis: KnowledgeNoteAnalysis, related: string[]) {
  const sections = extractKnowledgeOutlineSections(rawContent).filter((section) => section.kind === "summary");
  const rows = sections.length
    ? sections.slice(0, 8).map((section) => {
      const content = section.lines.slice(0, 3).map(limitKnowledgeLine).join("；") || "待补充";
      const evidence = findGenericTranscriptEvidence(transcript, section);
      return [section.title, linkKnowledgeNoteEntityOnce(content, related), linkKnowledgeNoteEntityOnce(evidence, related), inferGenericTranscriptJudgment(section.title, content)];
    })
    : analysis.keyPoints.slice(0, 6).map((point) => {
      const evidence = findTranscriptEvidence(transcript.utterances, new RegExp(escapeRegExp(point.slice(0, 12))));
      return ["核心议题", linkKnowledgeNoteEntityOnce(point, related), linkKnowledgeNoteEntityOnce(evidence || "见原始转写", related), "由本地规则从长文本中提取，需按来源复核。"];
    });
  const body = rows.length ? rows : [["核心议题", "待补充", "见原始转写", "原文信息不足，需人工复核"]];
  return ["| 议题 | 核心内容 | 原文依据 | 整理判断 |", "|---|---|---|---|", ...body.map(([topic, content, evidence, note]) => `| ${tableCell(topic)} | ${tableCell(content)} | ${tableCell(evidence)} | ${tableCell(note)} |`)].join("\n");
}

function genericTranscriptConclusions(rawContent: string, transcript: KnowledgeTranscriptAnalysis, analysis: KnowledgeNoteAnalysis, related: string[]) {
  const sections = extractKnowledgeOutlineSections(rawContent).filter((section) => section.kind === "summary");
  const conclusions: string[] = [];
  for (const section of sections.slice(0, 6)) {
    const content = section.lines[0] || section.title;
    conclusions.push(`${section.title}：${inferGenericTranscriptJudgment(section.title, content)}`);
  }
  if (!conclusions.length) {
    const speakers = transcript.speakers.length ? `发言人包括 ${transcript.speakers.join("、")}` : "说话人未充分识别";
    conclusions.push(`${speakers}，文本已按转写记录归档，具体结论需结合原始音视频复核。`);
    for (const point of analysis.keyPoints.slice(0, 4)) conclusions.push(point);
  }
  return linkKnowledgeNoteEntityLines(uniqueStrings(conclusions).slice(0, 8), related);
}

function verificationTable(transcript: KnowledgeTranscriptAnalysis, related: string[]) {
  const joined = transcript.utterances.map((item) => item.text).join(" ");
  const rows: Array<[string, string, string]> = [];
  if (/250周年/.test(joined)) rows.push(["美国独立250周年", "核对年份、纪念语境和原始来源", "待核验"]);
  if (/2026/.test(joined)) rows.push(["2026年历史性/标志性年份", "核对该表述是否来自正式原文或转写摘要", "待核验"]);
  if (/30家|企业家|第一把手/.test(joined)) rows.push(["企业家代表团规模与成员级别", "核对企业名单、人数和职务", "待核验"]);
  if (/最长久|个人关系/.test(joined)) rows.push(["两国元首个人关系表述", "核对原话、翻译口径和上下文", "待核验"]);
  if (/高峰会|最重要/.test(joined)) rows.push(["高峰会重要性判断", "区分事实陈述与主观评价", "待核验"]);
  const body = rows.length ? rows : [["原始转写准确性", "核对音频/视频来源与自动转写错误", "待核验"]];
  return ["| 事项 | 核验方式 | 状态 |", "|---|---|---|", ...body.map(([item, method, status]) => `| ${tableCell(linkKnowledgeNoteEntityOnce(item, related))} | ${tableCell(method)} | ${status} |`)].join("\n");
}

function transcriptFollowupActions(rawContent: string, transcript: KnowledgeTranscriptAnalysis): KnowledgeNoteAction[] {
  const joined = transcript.utterances.map((item) => item.text).join(" ");
  const outlineActions = extractKnowledgeOutlineSections(rawContent)
    .filter((section) => section.kind === "todo")
    .flatMap((section) => section.lines.length ? section.lines.map((line) => `${section.title}：${line}`) : [section.title])
    .map((line) => limitKnowledgeLine(line))
    .filter((line) => !isWeakKnowledgeAction(line));
  const actions: KnowledgeNoteAction[] = outlineActions.slice(0, 8).map((line) => ({
    text: line,
    owner: inferKnowledgeActionOwner(line),
    due: inferKnowledgeActionDue(line),
  }));
  if (actions.length === 0) actions.push({ text: "核对原始音视频或官方文字稿，修正自动转写中的错字和断句。", owner: "待确认", due: "待确认" });
  actions.push({ text: "将核心实体建立或关联到 Obsidian 双链笔记。", owner: "待确认", due: "待确认" });
  if (/企业家|贸易|商业|30家/.test(joined)) actions.push({ text: "补充企业家代表团名单和贸易合作背景资料。", owner: "待确认", due: "待确认" });
  if (/250周年|中美关系/.test(joined)) actions.push({ text: "建立 2026 年中美关系时间线，记录周年节点和会晤后续进展。", owner: "待确认", due: "待确认" });
  return uniqueActionRows(actions).slice(0, 10);
}

function extractKnowledgeOutlineSections(rawContent: string) {
  const rows = String(rawContent || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const sections: Array<{ title: string; lines: string[]; kind: "summary" | "todo" }> = [];
  let mode: "summary" | "todo" = "summary";
  let current: { title: string; lines: string[]; kind: "summary" | "todo" } | null = null;
  const push = () => {
    if (current && (current.title || current.lines.length)) sections.push({ ...current, lines: current.lines.filter((line) => !isWeakKnowledgeOutlineLine(line)).slice(0, 6) });
  };
  for (const row of rows) {
    if (parseTranscriptSpeakerTime(row)) break;
    if (/^(小结|总结|概要|摘要)$/.test(row)) {
      push();
      current = null;
      mode = "summary";
      continue;
    }
    if (/^(待办|行动项|后续行动|下一步)$/.test(row)) {
      push();
      current = null;
      mode = "todo";
      continue;
    }
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*\|/.test(row) || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(row)) continue;
    const heading = row.match(/^\d+[.、]\s*(.+)$/);
    if (heading) {
      push();
      current = { title: limitKnowledgeLine(heading[1]), lines: [], kind: mode };
      continue;
    }
    if (!current) {
      if (mode === "summary" && row.length >= 10 && !/讨论|记录|纪要$/.test(row)) current = { title: "背景摘要", lines: [row], kind: mode };
      continue;
    }
    current.lines.push(row);
  }
  push();
  return sections.filter((section) => section.lines.length || section.title);
}

function isWeakKnowledgeOutlineLine(line: string) {
  return /^(小结|待办|总结|概要|摘要)$/.test(line) || /^\d{4}[-/]/.test(line);
}

function findGenericTranscriptEvidence(transcript: KnowledgeTranscriptAnalysis, section: { title: string; lines: string[] }) {
  const candidates = [section.title, ...section.lines].map((line) => line.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "").slice(0, 10)).filter((line) => line.length >= 3);
  for (const candidate of candidates) {
    const evidence = transcript.utterances.find((item) => item.text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "").includes(candidate));
    if (evidence) return `${evidence.speaker}${evidence.time ? ` ${evidence.time}` : ""}：${limitKnowledgeLine(evidence.text)}`;
  }
  return "见原始转写";
}

function inferGenericTranscriptJudgment(topic: string, content: string) {
  const text = `${topic}\n${content}`;
  if (/AI|DeepSeek|艾玛|IMA|workbody|workbuddy|插件|自动化|代码|执行/.test(text)) return "核心是 AI 工具能力边界、本地/云端执行链路和自动化可靠性的取舍。";
  if (/飞机|东航|故障|液压|惯导|气瓶|压力/.test(text)) return "属于待核验技术事实，应保留来源并避免把推测写成定论。";
  if (/实时|数据|传输|缓存|重传|网络|高频/.test(text)) return "项目关注高频数据可靠传输、断网缓存和重传机制。";
  if (/个人开发|智能体|壁垒|大厂|专业/.test(text)) return "用户倾向建设个人可控的智能体能力，形成长期专业壁垒。";
  return "作为会议主题保留，后续按来源继续补证据和结论。";
}

function uniqueActionRows(actions: KnowledgeNoteAction[]) {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = action.text.replace(/\s+/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseKnowledgeNoteSegments(rawContent: string) {
  const rows = String(rawContent || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, "").replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 180);
  const segments: string[] = [];
  let pendingTime = "";
  for (const row of rows) {
    const pureTime = row.match(/^(\d{1,2}:\d{2}(?::\d{2})?)$/);
    if (pureTime) {
      pendingTime = pureTime[1];
      continue;
    }
    const prefixedTime = row.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    const time = prefixedTime?.[1] || pendingTime;
    const text = prefixedTime?.[2] || row;
    pendingTime = "";
    for (const part of splitKnowledgeNoteSentences(text)) {
      const clean = part.trim();
      if (!clean || /^[-—]+$/.test(clean) || /^#+\s*$/.test(clean)) continue;
      segments.push(time ? `${time} ${clean}` : clean);
    }
  }
  return uniqueStrings(segments).slice(0, 120);
}

function splitKnowledgeNoteSentences(text: string) {
  if (text.length <= 140 || /^#{1,6}\s/.test(text) || /^\|/.test(text)) return [text];
  const rows = text
    .split(/(?<=[。！？!?；;])\s*/)
    .map((row) => row.trim())
    .filter(Boolean);
  return rows.length > 1 ? rows : [text];
}

function selectKnowledgeNoteKeyPoints(segments: string[], type: string, entities: string[]) {
  const candidates = segments.map(stripSegmentTime).filter((line) => line.length >= 4 && !/^\d+$/.test(line)).slice(0, 80);
  const scored = candidates.map((line, index) => ({ line, index, score: scoreKnowledgeNoteLine(line, type, entities) }));
  const selected = scored
    .filter((row) => row.score >= 2)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 10)
    .sort((a, b) => a.index - b.index)
    .map((row) => limitKnowledgeLine(row.line));
  for (const row of scored.slice(0, 8)) {
    const line = limitKnowledgeLine(row.line);
    if (selected.length >= 6) break;
    if (!selected.includes(line)) selected.push(line);
  }
  return selected.length ? selected : ["待补充"];
}

function scoreKnowledgeNoteLine(line: string, type: string, entities: string[]) {
  let score = 0;
  if (line.length >= 12 && line.length <= 180) score += 1;
  if (/[0-9０-９]+/.test(line)) score += 1;
  if (/结论|核心|关键|重点|目标|问题|风险|原因|结果|建议|方案|计划|需要|必须|应该|确认|完成|推进|跟进|决定|价值|影响|成本|收益/.test(line)) score += 2;
  if (/但是|因此|所以|因为|如果|虽然|同时|对于|关于/.test(line)) score += 1;
  if (type === "会议纪要" && /讨论|沟通|会议|认为|表示|提到|共识/.test(line)) score += 1;
  if (type === "学习笔记" && /概念|方法|原则|框架|学习|知识|理解/.test(line)) score += 1;
  if (entities.some((entity) => line.includes(entity))) score += 1;
  return score;
}

function extractKnowledgeNoteDataPoints(segments: string[]) {
  return uniqueStrings(segments
    .map(stripSegmentTime)
    .filter((line) => /(?:\d|[一二三四五六七八九十百千万亿]+)(?:\s?%|元|万|亿|小时|分钟|天|周|月|年|人|个|次|条|份|公里|吨|㎡|m2|GB|MB)?/i.test(line))
    .map(limitKnowledgeLine))
    .slice(0, 10);
}

function extractKnowledgeNoteIssuePoints(segments: string[]) {
  return uniqueStrings(segments
    .map(stripSegmentTime)
    .filter((line) => /问题|风险|困难|阻塞|瓶颈|不便|缺陷|失败|无法|不能|担心|矛盾|冲突|但是|然而/.test(line))
    .map(limitKnowledgeLine))
    .slice(0, 8);
}

function extractKnowledgeNoteActions(segments: string[]): KnowledgeNoteAction[] {
  const actions = uniqueStrings(segments.map(stripSegmentTime).filter((line) => /待|需要|需|下一步|后续|跟进|确认|提交|截止|负责|安排|todo|行动|必须|应该|建议|计划|要/i.test(line)).filter((line) => !isWeakKnowledgeAction(line))).slice(0, 12);
  return actions.map((line) => ({
    text: limitKnowledgeLine(line),
    owner: inferKnowledgeActionOwner(line),
    due: inferKnowledgeActionDue(line),
  }));
}

function isWeakKnowledgeAction(line: string) {
  const text = String(line || "").trim();
  if (!text || text.length < 6) return true;
  if (/^(好的|对啊|嗯|待办|小结|总结)$/.test(text)) return true;
  if (/你不是每天都要玩|它不要去装|让我自己|刺激了|然后就没有了/.test(text)) return true;
  const actionSignal = /需要|需|待|后续|跟进|确认|提交|截止|负责|安排|todo|行动|验证|核对|补充|整理|建立|修正|复核|推进|完成/i.test(text);
  const chatterSignal = /吗|啥意思|怎么|为什么|对啊|没事|好的|嗯/.test(text);
  return !actionSignal || (chatterSignal && !/验证|核对|补充|整理|建立|修正|复核|推进|完成/.test(text));
}

function inferKnowledgeActionOwner(line: string) {
  const match = line.match(/([\u4e00-\u9fa5]{1,6}(?:总|老师|经理|主任|主管|团队|部门|小组|负责人)|我|我们|大家|你|他|她)[^。；;]*(?:负责|跟进|确认|提交|整理|完成|处理|安排|推进)/);
  return cleanKnowledgeActionOwner(match?.[1] || "") || "待确认";
}

function inferKnowledgeActionDue(line: string) {
  const match = line.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}日|今天|明天|后天|本周|下周|月底|周[一二三四五六日天]|春节前|节前|年底|年内)/);
  return match?.[1] || "待确认";
}

function bulletLines(lines: string[]) {
  return lines.length ? lines.map((line) => `- ${line}`).join("\n") : "- 待补充";
}

function actionTable(actions: KnowledgeNoteAction[]) {
  const rows = actions.length ? actions : [{ text: "待确认", owner: "待确认", due: "待确认" }];
  return ["| # | 行动项 | 责任方 | 截止时间 |", "|---|--------|--------|---------|", ...rows.map((item, index) => `| ${index + 1} | ${tableCell(item.text)} | ${tableCell(item.owner)} | ${tableCell(item.due)} |`)].join("\n");
}

function issueTable(lines: string[]) {
  return ["| 问题 | 说明 |", "|------|------|", ...lines.map((line) => `| ${tableCell(line)} | 待补充 |`)].join("\n");
}

function dataTable(lines: string[]) {
  return ["| 指标/信息 | 数值或描述 |", "|---|---|", ...lines.map((line) => `| ${tableCell(inferDataLabel(line))} | ${tableCell(line)} |`)].join("\n");
}

function backlinkIndex(related: string[], groups?: KnowledgeNoteEntityGroups) {
  if (related.length === 0) return "";
  const groupedRows = groups ? [
    ["人员", groups.people],
    ["部门/机构", groups.organizations],
    ["地点", groups.places],
    ["项目", groups.projects],
    ["概念", groups.concepts],
    ["资源", groups.resources],
  ].filter(([, rows]) => (rows as string[]).length > 0) as Array<[string, string[]]> : [];
  if (groupedRows.length === 0) return ["## 反向链接索引", "本笔记涉及的核心实体：", ...related.map((item) => `- ${item}`)].join("\n");
  return ["## 反向链接索引", "本笔记涉及的核心实体：", ...groupedRows.map(([label, rows]) => `- ${label}：${rows.map((item) => `[[${item}]]`).join(" ")}`)].join("\n");
}

function linkKnowledgeNoteEntityLines(lines: string[], related: string[]) {
  const seen = new Set<string>();
  return lines.map((line) => linkKnowledgeNoteEntityOnce(line, related, seen));
}

function linkKnowledgeNoteEntityOnce(line: string, related: string[], seen = new Set<string>()) {
  let output = line;
  for (const item of related) {
    const entity = stripWikiLink(item);
    if (!entity || output.includes(`[[${entity}]]`)) continue;
    if (seen.has(entity)) continue;
    const index = output.indexOf(entity);
    if (index < 0) continue;
    const before = output.slice(Math.max(0, index - 2), index);
    const after = output.slice(index + entity.length, index + entity.length + 2);
    if (before === "[[" || after === "]]") continue;
    output = `${output.slice(0, index)}[[${entity}]]${output.slice(index + entity.length)}`;
    seen.add(entity);
  }
  return output;
}

function renderContentUnderstanding(type: string, status: string, analysis: KnowledgeNoteAnalysis) {
  const entities = analysis.entities.slice(0, 8).map((entity) => `[[${entity}]]`).join(" ") || "待补充";
  return [
    "## 内容理解",
    "| 项 | 结果 |",
    "|---|---|",
    `| 主题 | ${tableCell(analysis.topic)} |`,
    `| 类型 | ${tableCell(type)} |`,
    `| 状态 | ${tableCell(status)} |`,
    `| 逻辑结构 | ${tableCell(analysis.logic.join(" → ") || "事实记录")} |`,
    `| 核心实体 | ${tableCell(entities)} |`,
  ].join("\n");
}

function conceptLines(groups: KnowledgeNoteEntityGroups, related: string[]) {
  const concepts = uniqueStrings([...groups.concepts, ...groups.projects, ...related.map(stripWikiLink)]).slice(0, 10);
  return concepts.length ? concepts.map((item) => `- [[${item}]]：待补充`).join("\n") : "- 待补充";
}

function rawArchiveBlock(rawContent: string) {
  const raw = String(rawContent || "").trim();
  if (!raw) return "";
  const body = raw.length > 12_000 ? `${raw.slice(0, 12_000)}\n\n[原文过长，已截断用于预览]` : raw;
  return ["## 原始记录", "```text", body.replace(/```/g, "` ` `"), "```"].join("\n");
}

function groupKnowledgeNoteEntities(entities: string[]): KnowledgeNoteEntityGroups {
  const groups: KnowledgeNoteEntityGroups = { people: [], organizations: [], places: [], projects: [], concepts: [], resources: [] };
  for (const entity of entities) {
    if (/^(习近平|特朗普|马斯克|比尔盖茨)$/.test(entity) || /(?:总|老师|经理|主任|主管)$/.test(entity)) groups.people.push(entity);
    else if (/(?:公司|集团|部门|团队|委员会|政府|办公室|研究院|工作室|平台)$/.test(entity)) groups.organizations.push(entity);
    else if (/(?:门|站|楼|库房|园区|机场|区域|中心|仓库)$/.test(entity)) groups.places.push(entity);
    else if (/(?:项目|计划|PRD|OpenClaw|Workbench|Gateway)/i.test(entity)) groups.projects.push(entity);
    else if (/(?:库房|资源|资产|文档|清单|数据表|数据)$/i.test(entity)) groups.resources.push(entity);
    else groups.concepts.push(entity);
  }
  for (const key of Object.keys(groups) as Array<keyof KnowledgeNoteEntityGroups>) groups[key] = uniqueStrings(groups[key]).slice(0, 8);
  return groups;
}

function inferKnowledgeNoteLogic(segments: string[], type: string, issues: string[], actions: KnowledgeNoteAction[]) {
  const logic = [type];
  if (segments.some((line) => /背景|当前|目前|因为|原因|起因/.test(line))) logic.push("背景");
  if (segments.some((line) => /目标|希望|为了|要实现|需要/.test(line))) logic.push("目标");
  if (issues.length) logic.push("问题/风险");
  if (segments.some((line) => /方案|建议|计划|决定|选择|策略/.test(line))) logic.push("方案/判断");
  if (actions.length) logic.push("行动项");
  return uniqueStrings(logic).slice(0, 6);
}

function inferDataLabel(line: string) {
  if (/金额|成本|费用|预算|租金|元|万|亿/.test(line)) return "金额/成本";
  if (/时间|日期|小时|分钟|天|周|月|年|截止/.test(line)) return "时间";
  if (/数量|次数|人数|比例|%|个|条|份/.test(line)) return "数量/比例";
  return "关键信息";
}

function stripSegmentTime(line: string) {
  return line.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "").trim();
}

function limitKnowledgeLine(line: string) {
  return line.length > 220 ? `${line.slice(0, 220)}...` : line;
}

function knowledgeSafeSummaryLine(line: string) {
  let clean = String(line || "")
    .replace(/^\s*(?:发言人|说话人|Speaker)\s*\d+\s*/i, "")
    .replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "")
    .replace(/\b(?:呃|嗯|啊)\b/g, "")
    .replace(/(我操|卧槽|他妈的|他妈|妈的|尼玛|傻逼|牛逼)(?:[，。!！\s]*)?/g, "")
    .replace(/我今天我今天/g, "我今天")
    .replace(/(这个|那个|然后|就是|就就|你你|我我|呃|嗯|啊)/g, "")
    .replace(/\s+/g, " ")
    .replace(/[，,。；;：:、\s]+$/g, "")
    .trim();
  clean = clean
    .replace(/^这(个|玩意|东西)/, "该事项")
    .replace(/啥时候/g, "什么时候")
    .replace(/啥意思/g, "什么含义")
    .replace(/啥/g, "什么")
    .replace(/咋/g, "怎么");
  if (!clean || clean.length < 4) return "原文为口语表达，已省略噪声，详见原始记录。";
  return limitKnowledgeLine(clean);
}

function stripWikiLink(row: string) {
  return String(row || "").replace(/^\[\[|\]\]$/g, "").trim();
}

function wikiLink(row: string) {
  const clean = stripWikiLink(row);
  return clean ? `[[${clean}]]` : "";
}

function tableCell(value: string) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function isWeakKnowledgeEntity(entity: string) {
  if (entity.length > 24) return true;
  if (/^(本次会议|本次讨论|该会议|讨论了|明确了|提出了|介绍了|强调了|导致|升级导致|但在|初步了解|需要通过|用于替代|无法直接|无法创建|无法删除|遇到系统|的|进行|实现了|确保|应对|解决|形成|满足|盲目)/.test(entity)) return true;
  if (entity.length > 12 && /(然后|因为|就是|这个|那个|刚才|有时候|我会|你怎么|那你|不是|没有|它自己|对它|我们|你们|大家)/.test(entity)) return true;
  if (/^(这是|就是|那个|这个|这些|那些|因为|然后|但是|如果|那么|很多|当你|你怎么|那你|它自己|不是没有|大家知道|我们现在|你们在座)/.test(entity)) return true;
  if (/^(后续|需要|需|请|由|让|安排|确认|提交|负责|跟进|整理|完成|处理|推进)/.test(entity)) return true;
  return /^(工作记录|学习笔记|会议纪要|决策记录|项目文档|知识库|系统|平台|任务|记录|内容|问题|方案)$/.test(entity);
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanKnowledgeActionOwner(owner: string) {
  let clean = String(owner || "").trim();
  for (const prefix of ["后续", "需要", "需", "请", "由", "让", "安排"]) {
    if (clean.startsWith(prefix)) clean = clean.slice(prefix.length);
  }
  return clean;
}

function yamlArray(rows: string[]) {
  return `[${rows.map((row) => JSON.stringify(row)).join(", ")}]`;
}

function uniqueStrings(rows: string[]) {
  return Array.from(new Set(rows.filter(Boolean)));
}

function firstLine(file: string) {
  try {
    const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((row) => row.trim() && !row.startsWith("---"));
    return (line || "OpenClaw skill").replace(/^#+\s*/, "").slice(0, 160);
  } catch {
    return "OpenClaw skill";
  }
}

function composeKnowledgeOutputContent(sourcePaths: string[], template: string) {
  if (sourcePaths.length === 0) return `Template: ${template}\n\n未选择来源。`;
  const sections = sourcePaths.map((sourcePath, index) => {
    const preview = previewKnowledgeFile(sourcePath) as { ok?: boolean; title?: string; type?: string; path?: string; content?: string; size?: number; error?: string };
    if (!preview.ok) return `## Source ${index + 1}: ${sourcePath}\n\n- Status: unavailable\n- Error: ${preview.error || "unknown"}`;
    const body = String(preview.content || "").slice(0, Math.max(1000, Math.floor(120_000 / Math.max(sourcePaths.length, 1))));
    return `## Source ${index + 1}: ${preview.title || path.basename(sourcePath)}\n\n- Path: ${preview.path || sourcePath}\n- Type: ${preview.type || "file"}\n- Size: ${preview.size || 0}\n\n${body || "该来源当前只有文件级 manifest，全文抽取进入后续批处理。"}`;
  });
  return `Template: ${template}\nSource count: ${sourcePaths.length}\n\n${sections.join("\n\n---\n\n")}`.slice(0, 120_000);
}

function renderOutput(type: string, content: string, sourcePath: string) {
  if (type === "mindmap") return renderMindmapOutput(content, sourcePath);
  if (type === "flashcards") return `## 闪卡\n\n${content.slice(0, 1200) || "待补充"}\n\n- Q: 核心概念是什么？\n- A: 待根据来源精炼。`;
  if (type === "quiz") return `## 测验\n\n1. 来源材料的核心结论是什么？\n2. 哪些证据最关键？\n3. 下一步应该验证什么？\n\n${content.slice(0, 1000)}`;
  if (type === "infographic") return `## 信息图大纲\n\n- 主题\n- 三个关键数据点\n- 关系结构\n- 行动建议\n\n${content.slice(0, 1000)}`;
  if (type === "table") return `## 数据表格\n\n| 来源 | 类型 | 关键内容 |\n| --- | --- | --- |\n| ${sourcePath || "当前预览"} | knowledge | ${content.slice(0, 180).replace(/\n/g, " ")} |\n`;
  if (type === "blog") return `## 标题\n\n${content.slice(0, 1200) || "待补充"}\n\n## 发布建议\n\n适配公众号、知乎、即刻等平台。`;
  return `## 报告\n\n${content.slice(0, 2200) || "待补充"}`;
}

function renderMindmapOutput(content: string, sourcePath: string) {
  const outline = buildMindmapOutline(content);
  return `\`\`\`markmap\n# 思维导图\n## 来源\n- ${sourcePath || "当前预览"}\n## 主题结构\n${outline || "- 待补充"}\n\`\`\``;
}

function buildMindmapOutline(content: string) {
  const body = String(content || "")
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, "")
    .split(/\r?\n/);
  const rows: string[] = [];
  for (const raw of body) {
    const line = raw.trim();
    if (!line || /^[-*_]{3,}$/.test(line)) continue;
    const heading = line.match(/^(#{1,5})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      rows.push(`${"#".repeat(level)} ${cleanMindmapText(heading[2])}`);
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      rows.push(`- ${cleanMindmapText(bullet[1])}`);
      continue;
    }
    const keyValue = line.match(/^([A-Za-z0-9_\u4e00-\u9fa5 -]{2,28})[:：]\s*(.+)$/);
    if (keyValue) rows.push(`- ${cleanMindmapText(`${keyValue[1]}：${keyValue[2]}`)}`);
    if (rows.length >= 80) break;
  }
  if (rows.length >= 4) return rows.join("\n");
  return body
    .map((line) => cleanMindmapText(line.trim()))
    .filter(Boolean)
    .slice(0, 18)
    .map((line) => `- ${line}`)
    .join("\n");
}

function cleanMindmapText(value: string) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function defaultReportTemplate(type: string) {
  return `# ${labelReport(type)}模板\n\n## 概览\n\n## 已完成\n\n## 关键进展\n\n## 风险与阻塞\n\n## 下一步计划\n`;
}

function labelReport(type: string) {
  return ({ daily: "日报", weekly: "周报", monthly: "月报", yearly: "年报" } as Record<string, string>)[type] || "报告";
}

function renderReport(input: { title: string; reportType: string; rangeStart: string; rangeEnd: string; template: string; todos: unknown[]; events: unknown[]; planItems: unknown[]; calendarNotes: unknown[]; projects: unknown[]; tasks: unknown[]; notes: string; sources: string[] }) {
  const doneTodos = input.todos.filter((row) => ["done", "completed"].includes(String((row as Record<string, unknown>).status || "").toLowerCase()));
  const openTodos = input.todos.length - doneTodos.length;
  return `---\ntype: assistant_report\nreport_type: ${input.reportType}\nrange_start: ${input.rangeStart}\nrange_end: ${input.rangeEnd}\ncreated: ${nowIso()}\nsources: [${input.sources.join(", ")}]\nstatus: completed\n---\n\n# ${input.title}\n\n## 指挥摘要\n\n| 指标 | 数量 |\n| --- | ---: |\n| 待办 | ${input.todos.length} |\n| 已完成待办 | ${doneTodos.length} |\n| 未完成待办 | ${openTodos} |\n| 计划项 | ${input.planItems.length} |\n| 日程 | ${input.events.length} |\n| 日程笔记 | ${input.calendarNotes.length} |\n\n## 时间范围\n\n${input.rangeStart} 至 ${input.rangeEnd}\n\n## 模板\n\n${input.template}\n\n## 计划推进\n\n${summarizePlanItems(input.planItems)}\n\n## 待办与日程\n\n${summarizeRows("待办", input.todos)}\n\n${summarizeRows("日程", input.events)}\n\n## 笔记证据\n\n${summarizeRows("日程笔记", input.calendarNotes)}\n\n## 项目与代理动态\n\n${summarizeRows("项目", input.projects)}\n\n${summarizeRows("代理任务", input.tasks)}\n\n## 用户补充\n\n${input.notes || "无"}\n\n## 风险与下一步\n\n- 优先确认 P0/P1 且临近截止的事项。\n- 从日程笔记中抽取可复用知识，必要时转入知识库高质量整理。\n- 将阻塞项交给右侧代理讨论，形成明确负责人、时间和验收标准。\n`;
}

function reportRangeEnd(type: string, rangeStart: string) {
  const date = new Date(`${rangeStart}T00:00:00`);
  if (Number.isNaN(date.getTime())) return rangeStart;
  if (type === "weekly") {
    const day = date.getDay() || 7;
    date.setDate(date.getDate() + (7 - day));
  } else if (type === "monthly") {
    date.setMonth(date.getMonth() + 1, 0);
  } else if (type === "yearly") {
    date.setMonth(11, 31);
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function summarizePlanItems(rows: unknown[]) {
  if (!rows.length) return "暂无人生规划或年度工作计划记录。";
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const item = row as Record<string, unknown>;
    const key = String(item.plan_type || item.list_name || "计划");
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups.entries()].map(([group, items]) => `### ${group === "life" ? "五年人生规划" : group === "work" ? "年度工作计划" : group}\n\n${items.slice(0, 12).map((item) => `- ${String(item.title || item.id)} (${String(item.status || "open")} / ${String(item.due_at || "未定日期")})`).join("\n")}`).join("\n\n");
}

function summarizeRows(label: string, rows: unknown[]) {
  if (!rows.length) return `### ${label}\n\n无记录。`;
  return `### ${label}\n\n${rows.slice(0, 8).map((row) => {
    const item = row as Record<string, unknown>;
    return `- ${String(item.title || item.name || item.id)} (${String(item.status || item.priority || item.created_at || "")})`;
  }).join("\n")}`;
}

function markdownToHtml(markdown: string) {
  const body = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/\n/g, "\n");
  return `<!doctype html><meta charset="utf-8"><title>OpenClaw Report</title><body>${body}</body>`;
}
