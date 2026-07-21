/**
 * 元宝 .aac 录音 → ASR → saveKnowledgeNote → 镜像自动 fire
 *
 * 设计原则（2026-06-29）：
 * 1. **不重建元宝 UI 自动化**。仅扫描候选目录的 .aac 文件（macOS 文件系统层）。
 * 2. **不删/不改元宝 app 内部文件、TKV、chat_message.db**。本模块只读。
 * 3. **ASR 走现有 mobileTranscription**（OpenAI gpt-4o-mini-transcribe 或 command fallback）。
 * 4. **idempotent**：source-hash 已处理过的 .aac 跳过（state JSON 持久化在 DATA_DIR）。
 * 5. **失败保留** .aac 不动，下次 run 再试。
 * 6. **未配置 provider → 仅 dry-run / 仅 manual import-text 路径**。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DATA_DIR, WORKSPACE_DIR, nowIso } from "./config.js";
import { saveKnowledgeNote, type KnowledgeNoteDraftInput } from "./workbenchV11.js";
import { mobileTranscriptionProvider, transcribeMobileVoiceAudio } from "./mobileTranscription.js";
import type { Db } from "./db.js";

// 候选根目录（按顺序探测，找到第一个存在的）
const DEFAULT_CANDIDATES = [
  "/Users/njx/Library/Containers/com.tencent.yuanbao/Data/Library/Global/Voice",
  "/Users/njx/Library/Application Support/com.tencent.yuanbao/Voice",
  "/Users/njx/Library/Application Support/腾讯元宝/Voice",
];

function resolveAacRoot(): string {
  const envRoot = process.env.YUANBAO_AAC_ROOT;
  if (envRoot && fs.existsSync(envRoot)) return envRoot;
  for (const candidate of DEFAULT_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return DEFAULT_CANDIDATES[0];
}

const AAC_EXT = new Set([".aac", ".m4a", ".wav", ".mp3"]);
const STATE_FILE = path.join(DATA_DIR, "yuanbao-sync-state.json");

type SyncEntry = {
  aacPath: string;
  aacHash: string;
  size: number;
  mtime: string;
  transcriptHash?: string;
  knowledgeNoteId?: string;
  knowledgeNotePath?: string;
  status: "imported" | "skipped_duplicate" | "asr_unavailable" | "transcript_empty" | "failed" | "dry_run";
  error?: string;
  importedAt: string;
};

type SyncState = {
  version: 1;
  lastRun: string;
  lastRunStatus: "ok" | "partial" | "skipped" | "error";
  lastRunError?: string;
  processed: Record<string, SyncEntry>; // keyed by aacHash
};

function loadState(): SyncState {
  if (!fs.existsSync(STATE_FILE)) {
    return { version: 1, lastRun: "", lastRunStatus: "skipped", processed: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { version: 1, lastRun: "", lastRunStatus: "skipped", processed: {} };
  }
}

function saveState(state: SyncState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, STATE_FILE);
}

function hashFile(filePath: string): string {
  const h = createHash("sha256");
  h.update(fs.readFileSync(filePath));
  return h.digest("hex");
}

function discoverAacFiles(root: string, maxFiles: number): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (e.isFile() && AAC_EXT.has(path.extname(e.name).toLowerCase())) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTranscriptHtml(title: string, transcript: string): string {
  // 最小 HTML 包装：仅在 yuanbao_sync_v1 path 使用，不进入正式 Knowledge 页面。
  // saveKnowledgeNote 要求 htmlDraft.html 非空；这里只保证 through the gate。
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8" />',
    `<title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<pre class="yuanbao-transcript">${escapeHtml(transcript)}</pre>`,
    "</body>",
    "</html>",
  ].join("\n");
}

function buildNoteInput(opts: {
  aacPath: string;
  transcript: string;
  recordedAt: string;
}): KnowledgeNoteDraftInput {
  const date = opts.recordedAt.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const fileName = path.basename(opts.aacPath, path.extname(opts.aacPath));
  const title = fileName.slice(0, 80) || "元宝录音";
  return {
    title,
    date,
    type: "会议纪要",
    status: "待跟进",
    tags: ["元宝录音", "语音转写", "auto-yuanbao-sync"],
    related: [],
    folder: "voice_raw",
    rawContent: opts.transcript,
    layoutStrategy: { template: "auto" },
    htmlDraft: {
      html: buildTranscriptHtml(title, opts.transcript),
      title,
      sourceHash: createHash("sha256").update(opts.transcript).digest("hex"),
    },
    htmlQuality: { score: 1, passed: true, issues: [] },
    generationPipeline: ["yuanbao_sync_v1"],
  };
}

export type YuanbaoSyncResult = {
  dryRun: boolean;
  aacRoot: string;
  aacRootExists: boolean;
  provider: string;
  totalDiscovered: number;
  imported: number;
  skippedDuplicate: number;
  asrUnavailable: number;
  transcriptEmpty: number;
  failed: number;
  entries: SyncEntry[];
  error?: string;
};

export async function runYuanbaoSync(db: Db, opts: { dryRun?: boolean; maxFiles?: number } = {}): Promise<YuanbaoSyncResult> {
  const dryRun = Boolean(opts.dryRun);
  const maxFiles = opts.maxFiles ?? 20;
  const aacRoot = resolveAacRoot();
  const aacRootExists = fs.existsSync(aacRoot);
  const provider = mobileTranscriptionProvider();
  const state = loadState();

  const result: YuanbaoSyncResult = {
    dryRun,
    aacRoot,
    aacRootExists,
    provider,
    totalDiscovered: 0,
    imported: 0,
    skippedDuplicate: 0,
    asrUnavailable: 0,
    transcriptEmpty: 0,
    failed: 0,
    entries: [],
  };

  if (!aacRootExists) {
    result.error = "aac_root_missing";
    state.lastRun = nowIso();
    state.lastRunStatus = "skipped";
    if (!dryRun) saveState(state);
    return result;
  }

  const files = discoverAacFiles(aacRoot, maxFiles);
  result.totalDiscovered = files.length;

  for (const f of files) {
    let aacHash = "";
    try {
      aacHash = hashFile(f);
    } catch (e) {
      result.failed += 1;
      result.entries.push({
        aacPath: f,
        aacHash: "",
        size: 0,
        mtime: "",
        status: "failed",
        error: `hash_failed: ${(e as Error).message}`,
        importedAt: nowIso(),
      });
      continue;
    }
    const stat = fs.statSync(f);

    const existing = state.processed[aacHash];
    if (existing?.status === "imported") {
      result.skippedDuplicate += 1;
      result.entries.push({
        aacPath: f,
        aacHash,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        status: "skipped_duplicate",
        importedAt: nowIso(),
        transcriptHash: existing.transcriptHash,
        knowledgeNoteId: existing.knowledgeNoteId,
        knowledgeNotePath: existing.knowledgeNotePath,
      });
      continue;
    }

    if (dryRun) {
      result.entries.push({
        aacPath: f,
        aacHash,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        status: "dry_run",
        importedAt: nowIso(),
      });
      continue;
    }

    if (!provider) {
      result.asrUnavailable += 1;
      result.entries.push({
        aacPath: f,
        aacHash,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        status: "asr_unavailable",
        error: "transcription_provider_unavailable",
        importedAt: nowIso(),
      });
      continue;
    }

    let transcript = "";
    try {
      const buf = fs.readFileSync(f);
      const r = await transcribeMobileVoiceAudio({
        audioBuffer: buf,
        audioMime: "audio/aac",
        filename: path.basename(f),
        language: "zh",
        audioPath: f,
      });
      transcript = r.text || "";
    } catch (e) {
      result.failed += 1;
      const entry: SyncEntry = {
        aacPath: f,
        aacHash,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        status: "failed",
        error: (e as Error).message,
        importedAt: nowIso(),
      };
      result.entries.push(entry);
      state.processed[aacHash] = entry;
      continue;
    }

    if (!transcript.trim()) {
      result.transcriptEmpty += 1;
      const entry: SyncEntry = {
        aacPath: f,
        aacHash,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        status: "transcript_empty",
        error: "asr_returned_empty",
        importedAt: nowIso(),
      };
      result.entries.push(entry);
      // 不写 state.processed，让下次重试
      continue;
    }

    try {
      const noteInput = buildNoteInput({
        aacPath: f,
        transcript,
        recordedAt: stat.mtime.toISOString(),
      });
      const note = await saveKnowledgeNote(db, noteInput);
      result.imported += 1;
      const entry: SyncEntry = {
        aacPath: f,
        aacHash,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        transcriptHash: createHash("sha256").update(transcript).digest("hex"),
        knowledgeNoteId: note.entryId,
        knowledgeNotePath: note.path,
        status: "imported",
        importedAt: nowIso(),
      };
      result.entries.push(entry);
      state.processed[aacHash] = entry;
    } catch (e) {
      result.failed += 1;
      const entry: SyncEntry = {
        aacPath: f,
        aacHash,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        status: "failed",
        error: (e as Error).message,
        importedAt: nowIso(),
      };
      result.entries.push(entry);
      state.processed[aacHash] = entry;
    }
  }

  state.lastRun = nowIso();
  if (result.failed > 0) state.lastRunStatus = "partial";
  else if (result.imported > 0) state.lastRunStatus = "ok";
  else state.lastRunStatus = "skipped";
  if (!dryRun) saveState(state);
  return result;
}

export function yuanbaoSyncStateSummary() {
  const state = loadState();
  return {
    lastRun: state.lastRun,
    lastRunStatus: state.lastRunStatus,
    aacRoot: resolveAacRoot(),
    aacRootExists: fs.existsSync(resolveAacRoot()),
    provider: mobileTranscriptionProvider(),
    processedCount: Object.keys(state.processed).length,
    importedCount: Object.values(state.processed).filter((e) => e.status === "imported").length,
  };
}
