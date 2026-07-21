import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const taskDir = "/Users/njx/openclaw/copilot/tasks/openclaw/20260630-yuanbao-two-recordings";
const importResultPath = path.join(taskDir, "import-result.json");
const outputPath = path.join(taskDir, "calendar-daily-backfill-result.json");
const dbPath = process.env.OPENCLAW_WORKBENCH_DB || "/Users/njx/openclaw_data/copilot/data/workbench.sqlite";
const dailyDir = process.env.NANJIXIONG_DAILY_DIR || "/Volumes/南极熊/04我的笔记/daily";
const dateKey = "2026-06-30";

const recordings = [
  {
    title: "航材管理部月例会汇报",
    recordedAt: "2026-06-30 13:27",
    duration: "77:04",
    transcriptPath: path.join(taskDir, "recording-1-transcript.txt"),
  },
  {
    title: "岗位调动与执照考取讨论",
    recordedAt: "2026-06-30 09:40",
    duration: "65:34",
    transcriptPath: path.join(taskDir, "recording-2-transcript.txt"),
  },
];

function assert(condition, message, details = {}) {
  if (!condition) {
    const err = new Error(message);
    err.details = details;
    throw err;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function safeName(value) {
  return String(value)
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}._\-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "untitled";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findDailyTranscript(transcript) {
  if (!fs.existsSync(dailyDir)) return null;
  const names = fs.readdirSync(dailyDir).filter((name) => name.endsWith(".md") && name.startsWith(dateKey.replaceAll("-", "")));
  const rawHash = sha256(transcript);
  const trimmedHash = sha256(transcript.trim());
  for (const name of names) {
    const candidate = path.join(dailyDir, name);
    const text = fs.readFileSync(candidate, "utf8");
    if (sha256(text) === rawHash || sha256(text.trim()) === trimmedHash) {
      return {
        path: candidate,
        bytes: Buffer.byteLength(text),
        hash: sha256(text),
        matched: "existing",
      };
    }
  }
  return null;
}

function ensureDailyTranscript(item, transcript) {
  const existing = findDailyTranscript(transcript);
  if (existing) return existing;
  fs.mkdirSync(dailyDir, { recursive: true });
  const compactTime = item.recordedAt.replace(/\D/g, "").slice(0, 12);
  const filePath = path.join(dailyDir, `${compactTime}_元宝录音_${safeName(item.title)}.md`);
  fs.writeFileSync(filePath, transcript.endsWith("\n") ? transcript : `${transcript}\n`, "utf8");
  const text = fs.readFileSync(filePath, "utf8");
  return {
    path: filePath,
    bytes: Buffer.byteLength(text),
    hash: sha256(text),
    matched: "created",
  };
}

function calendarContent(item, imported, dailyPath, transcriptHash, transcriptBytes) {
  return [
    `# 元宝录音：${item.title}`,
    "",
    `- 日期：${dateKey}`,
    `- 录音时间：${item.recordedAt}`,
    `- 录音时长：${item.duration}`,
    `- 转写字节数：${transcriptBytes}`,
    `- 转写哈希：${transcriptHash}`,
    `- HTML 笔记：${imported.htmlPath}`,
    `- Obsidian daily Markdown：${dailyPath}`,
    "- 入库方式：yuanbao-visible-ui-transcript-v1 + calendar-daily-backfill-v1",
    "",
    "打开 HTML 笔记查看完整转写；Obsidian daily 路径保存 Markdown 原文。",
  ].join("\n");
}

function ensureCalendarRow(db, item, imported, dailyPath, transcriptHash, transcriptBytes) {
  const entry = db.prepare("SELECT * FROM knowledge_entries WHERE source_path = ? OR content_path = ? ORDER BY updated_at DESC LIMIT 1")
    .get(imported.sourcePath, imported.sourcePath);
  const title = `元宝录音：${item.title}`;
  const tags = ["元宝录音", "语音转写", "日程笔记", "visible-ui-import", "calendar-daily-backfill", dateKey];
  const summary = `元宝录音 ${item.recordedAt}，时长 ${item.duration}，已生成 HTML 笔记并落入 Obsidian daily。`;
  const content = calendarContent(item, imported, dailyPath, transcriptHash, transcriptBytes);
  const now = nowIso();
  const relatedType = "yuanbao_visible_ui_transcript";
  const relatedId = transcriptHash;
  const existing = db.prepare(`
    SELECT * FROM calendar_notes
    WHERE (related_type = ? AND related_id = ?)
       OR knowledge_html_path = ?
       OR knowledge_path = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(relatedType, relatedId, imported.htmlPath, dailyPath);

  if (existing?.id) {
    db.prepare(`
      UPDATE calendar_notes
      SET date_key = ?, title = ?, summary = ?, content = ?, tags = ?,
          knowledge_entry_id = ?, knowledge_path = ?, knowledge_html_path = ?,
          related_type = ?, related_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      dateKey,
      title,
      summary,
      content,
      JSON.stringify(tags),
      entry?.id ? String(entry.id) : null,
      dailyPath,
      imported.htmlPath,
      relatedType,
      relatedId,
      now,
      existing.id,
    );
    return { id: String(existing.id), action: "updated", title, relatedId };
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO calendar_notes
      (id, date_key, title, summary, content, tags, knowledge_entry_id, knowledge_path,
       knowledge_html_path, related_type, related_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    dateKey,
    title,
    summary,
    content,
    JSON.stringify(tags),
    entry?.id ? String(entry.id) : null,
    dailyPath,
    imported.htmlPath,
    relatedType,
    relatedId,
    now,
    now,
  );
  return { id, action: "inserted", title, relatedId };
}

function main() {
  assert(fs.existsSync(importResultPath), "IMPORT_RESULT_MISSING", { importResultPath });
  assert(fs.existsSync(dbPath), "WORKBENCH_DB_MISSING", { dbPath });
  assert(fs.existsSync(dailyDir), "DAILY_DIR_MISSING", { dailyDir });
  const importResult = readJson(importResultPath);
  assert(importResult?.ok && Array.isArray(importResult.imported), "IMPORT_RESULT_INVALID", importResult);

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000;");
  const fixed = [];
  try {
    for (const item of recordings) {
      const imported = importResult.imported.find((row) => row.title === item.title);
      assert(imported, "IMPORTED_ITEM_MISSING", { title: item.title });
      assert(fs.existsSync(imported.sourcePath), "SOURCE_NOTE_MISSING", { title: item.title, sourcePath: imported.sourcePath });
      assert(fs.existsSync(imported.htmlPath), "HTML_NOTE_MISSING", { title: item.title, htmlPath: imported.htmlPath });
      assert(fs.existsSync(item.transcriptPath), "TRANSCRIPT_FILE_MISSING", { transcriptPath: item.transcriptPath });

      const transcript = fs.readFileSync(item.transcriptPath, "utf8");
      const transcriptHash = sha256(transcript.trim());
      const transcriptBytes = Buffer.byteLength(transcript);
      const daily = ensureDailyTranscript(item, transcript);
      const calendar = ensureCalendarRow(db, item, imported, daily.path, transcriptHash, transcriptBytes);
      fixed.push({
        title: item.title,
        recordedAt: item.recordedAt,
        duration: item.duration,
        transcriptBytes,
        transcriptHash,
        htmlPath: imported.htmlPath,
        dailyPath: daily.path,
        dailyStatus: daily.matched,
        calendarNoteId: calendar.id,
        calendarAction: calendar.action,
      });
    }
  } finally {
    db.close();
  }

  const result = { ok: true, date: dateKey, dbPath, dailyDir, fixed };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (err) {
  const payload = { ok: false, error: err.message, details: err.details || null };
  try {
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {}
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}
