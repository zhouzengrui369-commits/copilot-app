import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, HOME_DIR, WORKSPACE_DIR } from "../config.js";
import { resolveNasRoot } from "./nasRoot.js";

const execFileAsync = promisify(execFile);
const IMA_SCRIPT = path.join(WORKSPACE_DIR, "boss_workspace/skills/ima_api.cjs");
const WORKBENCH_DB = path.join(DATA_DIR, "workbench.sqlite");
const KNOWLEDGE_ROOT = path.join(WORKSPACE_DIR, "memory/knowledge");
const WIKI_ROOT = path.join(KNOWLEDGE_ROOT, "wiki");
const NJX_KNOWLEDGE_ROOT = path.resolve(process.env.NJX_KNOWLEDGE_ROOT || path.join(HOME_DIR, "njx-knowledge"));
const NJX_KNOWLEDGE_DIR = path.join(NJX_KNOWLEDGE_ROOT, "knowledge");

export type KnowledgeSource = "memory" | "wiki" | "nas" | "ima" | "njx-knowledge";
export type KnowledgeHit = {
  source: KnowledgeSource;
  title: string;
  path?: string;
  snippet: string;
  score?: number;
};

export function sourceStatus() {
  const nas = resolveNasRoot();
  return {
    memory: {
      status: fs.existsSync(path.join(WORKSPACE_DIR, "MEMORY.md")) ? "connected" : "unavailable",
      root: WORKSPACE_DIR,
    },
    wiki: {
      status: fs.existsSync(KNOWLEDGE_ROOT) ? "connected" : "unavailable",
      root: WIKI_ROOT,
    },
    nas: {
      status: nas.status,
      root: nas.root,
      graphPath: nas.graphPath,
      reason: nas.reason,
    },
    ima: {
      // 2026-07-07 (rework11 v2) — IMA 弃用 (NJX 拍板; 39+ 天无新数据)
      status: "deprecated",
      root: "ima.qq.com",
      reason: "IMA connector 已弃用 2026-07-07 (NJX 拍板; 39+ 天无新数据); 仅保留兼容读。",
    },
    "njx-knowledge": {
      status: fs.existsSync(NJX_KNOWLEDGE_DIR) ? "connected" : "unavailable",
      root: NJX_KNOWLEDGE_ROOT,
      path: NJX_KNOWLEDGE_DIR,
    },
  };
}

export async function searchKnowledge(query: string, sources: KnowledgeSource[] = ["memory", "wiki", "nas", "ima", "njx-knowledge"]) {
  const q = query.trim();
  if (!q) return [];
  const jobs = [];
  if (sources.includes("memory")) jobs.push(searchMemory(q));
  if (sources.includes("wiki")) jobs.push(searchWiki(q));
  if (sources.includes("nas")) jobs.push(searchNas(q));
  if (sources.includes("ima")) jobs.push(searchIma(q));
  if (sources.includes("njx-knowledge")) jobs.push(searchNjxKnowledge(q));
  const results = await Promise.all(jobs);
  return dedupeHits(results.flat())
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 30);
}

async function searchMemory(query: string): Promise<KnowledgeHit[]> {
  const notesRoot = path.join(KNOWLEDGE_ROOT, "notes");
  const noteFiles = fs.existsSync(notesRoot) ? walkFiles(notesRoot, 4).filter((file) => file.endsWith(".md")) : [];
  const files = [
    path.join(WORKSPACE_DIR, "MEMORY.md"),
    path.join(KNOWLEDGE_ROOT, "index.md"),
    path.join(KNOWLEDGE_ROOT, "MOC/Master_MOC.md"),
    path.join(KNOWLEDGE_ROOT, "MOC/OpenClaw系统_MOC.md"),
    path.join(KNOWLEDGE_ROOT, "MOC/三代理架构_MOC.md"),
    path.join(KNOWLEDGE_ROOT, "MOC/知识库治理_MOC.md"),
    ...noteFiles,
  ];
  return dedupeHits([
    ...searchMemoryIndexes(query),
    ...grepFiles("memory", query, files.filter((f) => fs.existsSync(f))),
  ]).slice(0, 18);
}

async function searchWiki(query: string): Promise<KnowledgeHit[]> {
  const db = openSearchDb();
  if (!db) return [];
  try {
    const like = `%${query}%`;
    const rows = db.prepare(`
      SELECT page_type, title, path, review_status, confidence, summary, updated_at
      FROM knowledge_wiki_pages
      WHERE title LIKE ? OR summary LIKE ? OR source_paths LIKE ? OR path LIKE ?
      ORDER BY updated_at DESC
      LIMIT 16
    `).all(like, like, like, like) as Array<{ page_type: string; title: string; path: string; review_status: string; confidence: number; summary: string; updated_at: string }>;
    const pagePaths = db.prepare("SELECT path FROM knowledge_wiki_pages ORDER BY updated_at DESC LIMIT 220").all() as Array<{ path: string }>;
    return dedupeHits([
      ...rows.map((row) => ({
        source: "wiki" as const,
        title: row.title,
        path: row.path,
        snippet: `${row.page_type} / ${row.review_status} / confidence ${Number(row.confidence || 0).toFixed(2)}：${String(row.summary || row.path).slice(0, 240)}`,
        score: 0.98,
      })),
      ...grepFiles("wiki", query, pagePaths.map((row) => row.path).filter((file) => fs.existsSync(file))),
    ]).slice(0, 18);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function searchMemoryIndexes(query: string): KnowledgeHit[] {
  const db = openSearchDb();
  if (!db) return [];
  try {
    const like = `%${query}%`;
    const entries = db.prepare(`
      SELECT title, source, source_path, content_path, summary, tags, status, updated_at
      FROM knowledge_entries
      WHERE title LIKE ? OR summary LIKE ? OR tags LIKE ? OR source_path LIKE ? OR content_path LIKE ?
      ORDER BY updated_at DESC
      LIMIT 14
    `).all(like, like, like, like, like) as Array<{ title: string; source: string; source_path?: string; content_path?: string; summary: string; tags: string; status: string; updated_at: string }>;
    const files = db.prepare(`
      SELECT source, title, path, file_type, status, mtime
      FROM knowledge_file_index
      WHERE title LIKE ? OR path LIKE ? OR file_type LIKE ?
      ORDER BY COALESCE(mtime, '') DESC, created_at DESC
      LIMIT 14
    `).all(like, like, like) as Array<{ source: string; title: string; path: string; file_type: string; status: string; mtime?: string }>;
    return [
      ...entries.map((entry) => ({
        source: "memory" as const,
        title: entry.title,
        path: entry.content_path || entry.source_path || undefined,
        snippet: `entry/${entry.status}${entry.tags ? ` / ${entry.tags}` : ""}：${String(entry.summary || entry.source_path || "").slice(0, 240)}`,
        score: 0.94,
      })),
      ...files.map((file) => ({
        source: "memory" as const,
        title: file.title,
        path: file.path,
        snippet: `file-index/${file.source}/${file.file_type}/${file.status}：${file.path}`,
        score: 0.9,
      })),
    ];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

async function searchNas(query: string): Promise<KnowledgeHit[]> {
  const nas = resolveNasRoot();
  if (nas.status !== "connected") return [];
  const targets = [
    nas.graphPath || "",
    path.join(nas.root, "04我的笔记/note"),
    path.join(nas.root, "07知识库"),
    path.join(nas.root, "03知行合一/openclaw智能体"),
  ].filter((p) => fs.existsSync(p));
  if (!targets.length) return [];
  try {
    const { stdout } = await execFileAsync("rg", ["-n", "-i", "--max-count", "5", query, ...targets], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.split("\n").filter(Boolean).slice(0, 12).map((line) => {
      const [file, row, ...rest] = line.split(":");
      return {
        source: "nas",
        title: path.basename(file),
        path: file,
        snippet: `L${row}: ${rest.join(":").trim().slice(0, 240)}`,
      } satisfies KnowledgeHit;
    });
  } catch {
    return [];
  }
}

async function searchIma(query: string): Promise<KnowledgeHit[]> {
  if (sourceStatus().ima.status !== "connected") return [];
  try {
    const { stdout } = await execFileAsync(
      "node",
      [IMA_SCRIPT, "openapi/note/v1/search_note", JSON.stringify({ search_type: 0, query_info: { title: query }, start: 0, end: 5 })],
      { timeout: 8000, maxBuffer: 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout || "{}");
    const rows = Array.isArray(parsed?.data?.list) ? parsed.data.list : Array.isArray(parsed?.data) ? parsed.data : [];
    return rows.slice(0, 8).map((item: Record<string, unknown>, index: number) => ({
      source: "ima",
      title: String(item.title || item.name || `IMA result ${index + 1}`),
      path: typeof item.url === "string" ? item.url : undefined,
      snippet: String(item.summary || item.content || item.desc || "IMA note result").slice(0, 240),
    }));
  } catch {
    return [];
  }
}

async function searchNjxKnowledge(query: string): Promise<KnowledgeHit[]> {
  if (!fs.existsSync(NJX_KNOWLEDGE_DIR)) return [];
  const files = walkFiles(NJX_KNOWLEDGE_DIR, 5, 600)
    .filter((file) => /\.(md|markdown|txt|html)$/i.test(file));
  if (!files.length) return [];
  return dedupeHits(grepFiles("njx-knowledge", query, files)).slice(0, 18);
}

function grepFiles(source: KnowledgeSource, query: string, files: string[]) {
  const hits: KnowledgeHit[] = [];
  const needle = query.toLowerCase();
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < 12; i += 1) {
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push({
          source,
          title: path.basename(file),
          path: file,
          snippet: `L${i + 1}: ${lines[i].trim().slice(0, 240)}`,
        });
      }
    }
  }
  return hits;
}

function openSearchDb() {
  if (!fs.existsSync(WORKBENCH_DB)) return null;
  try {
    const db = new DatabaseSync(WORKBENCH_DB);
    db.exec("PRAGMA busy_timeout = 3000;");
    return db;
  } catch {
    return null;
  }
}

function dedupeHits(hits: KnowledgeHit[]) {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.source}:${hit.path || ""}:${hit.title}:${hit.snippet}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function walkFiles(base: string, depth: number, cap = 500): string[] {
  if (!fs.existsSync(base) || depth < 0 || cap <= 0) return [];
  const rows: string[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true }).filter((item) => !item.name.startsWith(".")).slice(0, 500)) {
    if (rows.length >= cap) break;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) rows.push(...walkFiles(full, depth - 1, cap - rows.length));
    else rows.push(full);
  }
  return rows;
}
