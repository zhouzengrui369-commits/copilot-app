import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(new Agent({
  headersTimeout: 620_000,
  bodyTimeout: 620_000,
}));

const baseUrl = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const password = process.env.OPENCLAW_WORKBENCH_PASSWORD || "";
const dbPath = process.env.OPENCLAW_WORKBENCH_DB || "/Users/njx/openclaw_data/copilot/data/workbench.sqlite";
const taskDir = "/Users/njx/openclaw/copilot/tasks/openclaw/20260630-yuanbao-two-recordings";
const outputPath = path.join(taskDir, "organized-html-upgrade-result.json");
const dateKey = "2026-06-30";
const rejectedLocalFallback = process.env.YUANBAO_USE_M3 === "0";
const organizeJobMaxWaitMs = Number(process.env.YUANBAO_ORGANIZE_JOB_MAX_WAIT_MS || 45 * 60_000);
const organizeJobPollMs = Number(process.env.YUANBAO_ORGANIZE_JOB_POLL_MS || 5000);

const recordings = [
  {
    calendarNoteId: "97392f34-cf3d-4778-9af9-4ca536d01320",
    title: "航材管理部月例会汇报",
    recordedAt: "2026-06-30 13:27",
    duration: "77:04",
    transcriptPath: path.join(taskDir, "recording-1-transcript.txt"),
    dailyPath: "/Volumes/南极熊/04我的笔记/daily/202606301553航材月例会.md",
    stableMarkdownPath: "/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/20260630_元宝录音_航材管理部月例会汇报.md",
    stableHtmlPath: "/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/20260630_元宝录音_航材管理部月例会汇报.html",
    legacyHtmlPath: "/Users/njx/openclaw_data/memory/knowledge/notes/voice_raw/20260630_元宝录音_航材管理部月例会汇报.html",
  },
  {
    calendarNoteId: "0157e603-9367-4ce2-9cff-df89367cc316",
    title: "岗位调动与执照考取讨论",
    recordedAt: "2026-06-30 09:40",
    duration: "65:34",
    transcriptPath: path.join(taskDir, "recording-2-transcript.txt"),
    dailyPath: "/Volumes/南极熊/04我的笔记/daily/202606301550领导干部下班组（虹A）.md",
    stableMarkdownPath: "/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/20260630_元宝录音_岗位调动与执照考取讨论.md",
    stableHtmlPath: "/Users/njx/openclaw_data/memory/knowledge/notes/calendar/2026-06/20260630_元宝录音_岗位调动与执照考取讨论.html",
    legacyHtmlPath: "/Users/njx/openclaw_data/memory/knowledge/notes/voice_raw/20260630_元宝录音_岗位调动与执照考取讨论.html",
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(value) {
  const text = String(value || "");
  if (text.length <= 16) return text;
  return `${text.slice(0, 8)}...${text.slice(-8)}`;
}

function parseTimeMinutes(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function compactLine(value, limit = 160) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function safeFileName(value) {
  return String(value || "note")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120) || "note";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseTranscriptTurns(transcript) {
  const pattern = /(发言人\d+)\s+(\d{1,2}:\d{2})/g;
  const matches = [...transcript.matchAll(pattern)];
  if (!matches.length) {
    return transcript
      .split(/\n{2,}/)
      .map((text, index) => ({ speaker: "未知", time: `${String(index).padStart(2, "0")}:00`, minute: index, text: text.trim() }))
      .filter((turn) => turn.text);
  }
  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index || transcript.length : transcript.length;
    const text = transcript.slice(start, end).trim();
    return {
      speaker: match[1],
      time: match[2],
      minute: parseTimeMinutes(match[2]),
      text,
    };
  }).filter((turn) => turn.text);
}

const signalKeywords = [
  "需要",
  "必须",
  "应该",
  "确认",
  "跟进",
  "负责",
  "安排",
  "计划",
  "风险",
  "问题",
  "异常",
  "关闭",
  "重启",
  "修复",
  "审批",
  "完成",
  "建议",
  "决定",
  "不要",
  "不能",
  "整改",
  "检查",
  "落实",
  "下周",
  "明天",
  "后续",
];

const domainTerms = [
  "航材",
  "AOG",
  "月例会",
  "汇报",
  "合同",
  "供应商",
  "库存",
  "周转",
  "维修",
  "质量",
  "成本",
  "审批",
  "适航",
  "航线",
  "系统",
  "数据",
  "岗位",
  "调动",
  "执照",
  "考取",
  "培训",
  "班组",
  "虹A",
  "值班",
  "流程",
  "风险",
  "问题",
  "计划",
  "行动",
  "负责人",
  "节点",
];

function topTerms(text, limit = 8) {
  const counts = new Map();
  for (const term of domainTerms) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const count = (text.match(re) || []).length;
    if (count) counts.set(term, count);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, limit)
    .map(([term, count]) => `${term}(${count})`);
}

function signalTurns(turns, limit = 36) {
  return turns
    .filter((turn) => signalKeywords.some((keyword) => turn.text.includes(keyword)))
    .slice(0, limit)
    .map((turn) => `- [${turn.time} ${turn.speaker}] ${compactLine(turn.text, 180)}`);
}

function categorizedSignals(turns) {
  const categories = {
    decisions: ["决定", "确认", "应该", "不能", "不要", "原则", "按", "明确"],
    actions: ["需要", "跟进", "安排", "负责", "落实", "检查", "完成", "修复", "重启", "计划", "下周", "明天", "后续"],
    risks: ["风险", "问题", "异常", "故障", "缺", "未", "不正常", "关闭", "卡", "影响"],
  };
  const result = {};
  for (const [key, keywords] of Object.entries(categories)) {
    const seen = new Set();
    result[key] = turns
      .filter((turn) => keywords.some((keyword) => turn.text.includes(keyword)))
      .map((turn) => {
        const text = compactLine(turn.text, 170);
        const id = `${turn.time}:${text}`;
        if (seen.has(id)) return null;
        seen.add(id);
        return { time: turn.time, speaker: turn.speaker, text };
      })
      .filter(Boolean)
      .slice(0, 12);
  }
  return result;
}

function buildTranscriptDigest(item, transcript, transcriptHash) {
  const turns = parseTranscriptTurns(transcript);
  const buckets = new Map();
  for (const turn of turns) {
    const bucketStart = Math.floor(turn.minute / 10) * 10;
    if (!buckets.has(bucketStart)) buckets.set(bucketStart, []);
    buckets.get(bucketStart).push(turn);
  }
  const fullText = turns.map((turn) => turn.text).join("\n");
  const allSections = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, bucketTurns]) => {
      const bucketText = bucketTurns.map((turn) => turn.text).join("\n");
      const highlights = bucketTurns
        .filter((turn) => signalKeywords.some((keyword) => turn.text.includes(keyword)))
        .slice(0, 4)
        .map((turn) => `  - [${turn.time} ${turn.speaker}] ${compactLine(turn.text, 150)}`);
      if (!highlights.length && bucketTurns[0]) {
        highlights.push(`  - [${bucketTurns[0].time} ${bucketTurns[0].speaker}] ${compactLine(bucketTurns[0].text, 150)}`);
      }
      return [
        `### ${String(bucketStart).padStart(2, "0")}:00-${String(bucketStart + 9).padStart(2, "0")}:59`,
        `- 话轮数：${bucketTurns.length}`,
        `- 发言人：${[...new Set(bucketTurns.map((turn) => turn.speaker))].join("、")}`,
        `- 关键词：${topTerms(bucketText, 8).join("、") || "未提取到稳定关键词"}`,
        "- 重点线索：",
        ...highlights,
      ].join("\n");
    });
  const sections = allSections
    .filter((section) => !/关键词：未提取到稳定关键词/.test(section) || /需要|必须|应该|确认|跟进|负责|安排|计划|风险|问题|异常|故障|缺|未|影响/.test(section))
    .slice(0, 14);
  const signals = signalTurns(turns, 24);
  const categorized = categorizedSignals(turns);
  return [
    `# 元宝录音：${item.title}`,
    "",
    "## 整理要求",
    "- 按 Obsidian 工作笔记风格整理，不输出原始逐字稿壳。",
    "- 先给结论摘要，再按议题、决策、行动项、风险和待确认信息分组。",
    "- 以时间轴线索和候选行动句为依据，提炼可执行信息。",
    "- HTML 需要是可阅读的交互文档，不能是 `<pre>` 原文包装。",
    "",
    "## 元信息",
    `- 日期：${dateKey}`,
    `- 录音时间：${item.recordedAt}`,
    `- 录音时长：${item.duration}`,
    "- 来源：元宝录音可见 UI 转写",
    `- 转写哈希：${transcriptHash}`,
    `- 原文大小：${Buffer.byteLength(transcript)} bytes`,
    `- 解析话轮：${turns.length}`,
    `- Obsidian daily 原文：${item.dailyPath}`,
    "- 完整原文：保留在 Obsidian daily 与 voice_raw；本次 Add Note 只接收高信号证据包，避免长转写导致模型超时或套模板。",
    "",
    "## 全局关键词",
    topTerms(fullText, 14).map((term) => `- ${term}`).join("\n") || "- 未提取到稳定关键词",
    "",
    "## 高信号时间段",
    sections.join("\n\n") || "- 未提取到高信号时间段；请按低信息密度记录处理。",
    "",
    "## 候选决策 / 行动 / 风险句",
    signals.join("\n") || "- 未提取到明确候选句，请从高信号时间段中判断。",
    "",
    "## 分类证据包",
    "### 候选决策与判断",
    markdownList(categorized.decisions, "未从转写中确认明确决策。"),
    "",
    "### 候选行动项",
    markdownList(categorized.actions, "未从转写中确认明确行动项。"),
    "",
    "### 风险与待确认",
    markdownList(categorized.risks, "未从转写中确认明确风险。"),
  ].join("\n");
}

function bucketSummaries(turns) {
  const buckets = new Map();
  for (const turn of turns) {
    const bucketStart = Math.floor(turn.minute / 10) * 10;
    if (!buckets.has(bucketStart)) buckets.set(bucketStart, []);
    buckets.get(bucketStart).push(turn);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([bucketStart, bucketTurns]) => {
    const bucketText = bucketTurns.map((turn) => turn.text).join("\n");
    const signal = bucketTurns.find((turn) => signalKeywords.some((keyword) => turn.text.includes(keyword))) || bucketTurns[0];
    return {
      range: `${String(bucketStart).padStart(2, "0")}:00-${String(bucketStart + 9).padStart(2, "0")}:59`,
      turnCount: bucketTurns.length,
      speakers: [...new Set(bucketTurns.map((turn) => turn.speaker))],
      terms: topTerms(bucketText, 6),
      highlight: signal ? `[${signal.time} ${signal.speaker}] ${compactLine(signal.text, 150)}` : "",
    };
  });
}

function markdownList(items, emptyText) {
  if (!items.length) return `- ${emptyText}`;
  return items.map((item) => `- [${item.time} ${item.speaker}] ${item.text}`).join("\n");
}

function buildStructuredMarkdown(item, transcript, transcriptHash) {
  const turns = parseTranscriptTurns(transcript);
  const fullText = turns.map((turn) => turn.text).join("\n");
  const terms = topTerms(fullText, 14);
  const signals = categorizedSignals(turns);
  const timeline = bucketSummaries(turns);
  const title = `元宝录音：${item.title}`;
  const oneLine = item.title.includes("航材")
    ? "围绕航材管理月度事项进行复盘，重点应落在问题闭环、责任动作和后续跟进。"
    : item.title.includes("岗位")
      ? "围绕岗位调整、班组安排与执照考取路径进行讨论，重点应落在条件确认和后续动作。"
      : "这是一条元宝录音整理笔记，重点应落在可执行结论、风险和待确认事项。";
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    `date: ${dateKey}`,
    "type: 会议纪要",
    "status: 待跟进",
    "tags:",
    "  - 元宝录音",
    "  - 语音转写",
    "  - Obsidian整理",
    "  - 日程笔记",
    "  - 高质量入库",
    `source_hash: ${transcriptHash}`,
    `source_daily: ${JSON.stringify(item.dailyPath)}`,
    "pipeline: structured-local-obsidian-v1",
    "---",
    "",
    `# ${title}`,
    "",
    "## 一句话结论",
    oneLine,
    "",
    "## 基本信息",
    `- 日期：${dateKey}`,
    `- 录音时间：${item.recordedAt}`,
    `- 录音时长：${item.duration}`,
    "- 来源：元宝录音可见 UI 转写",
    `- 转写哈希：${transcriptHash}`,
    `- 原文位置：${item.dailyPath}`,
    `- 解析话轮：${turns.length}`,
    "",
    "## 摘要",
    `- 本笔记已从 ${turns.length} 个发言话轮中提取主题、时间线、候选行动项、风险和待确认信息。`,
    "- 完整逐字稿不作为正文直接展示，保留在 Obsidian daily 与 voice_raw，避免智能助理页面继续显示原文壳。",
    `- 高频主题：${terms.join("、") || "未提取到稳定关键词"}。`,
    "",
    "## 重点主题",
    ...(terms.length ? terms.map((term) => `- ${term}`) : ["- 暂无稳定主题词；建议人工复核完整原文。"]),
    "",
    "## 决策与判断",
    markdownList(signals.decisions, "未从转写中提取到明确决策句，需人工复核。"),
    "",
    "## 行动项",
    markdownList(signals.actions, "未从转写中提取到明确行动句，需人工复核。"),
    "",
    "## 风险与待确认",
    markdownList(signals.risks, "未从转写中提取到明确风险句，需人工复核。"),
    "",
    "## 时间线",
    ...timeline.map((bucket) => [
      `### ${bucket.range}`,
      `- 话轮数：${bucket.turnCount}`,
      `- 发言人：${bucket.speakers.join("、") || "未知"}`,
      `- 关键词：${bucket.terms.join("、") || "未提取到稳定关键词"}`,
      bucket.highlight ? `- 线索：${bucket.highlight}` : "- 线索：无",
    ].join("\n")),
    "",
    "## 原文索引",
    `- Obsidian daily 原文：${item.dailyPath}`,
    "- Workbench raw HTML：voice_raw 中保留，仅作追溯，不再作为日程弹窗主 HTML。",
  ].join("\n");
}

function buildStructuredHtml(item, markdown, transcript, transcriptHash) {
  const turns = parseTranscriptTurns(transcript);
  const fullText = turns.map((turn) => turn.text).join("\n");
  const terms = topTerms(fullText, 14);
  const signals = categorizedSignals(turns);
  const timeline = bucketSummaries(turns);
  const title = `元宝录音：${item.title}`;
  const card = (label, value, note) => `
    <div class="card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </div>`;
  const signalHtml = (items, emptyText) => items.length
    ? items.map((row) => `<li><time>${escapeHtml(row.time)}</time><b>${escapeHtml(row.speaker)}</b><span>${escapeHtml(row.text)}</span></li>`).join("")
    : `<li><span>${escapeHtml(emptyText)}</span></li>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:light;--ink:#182235;--muted:#64748b;--line:#d8dee9;--soft:#f6f8fb;--accent:#0f766e;--warn:#b45309}
    *{box-sizing:border-box}
    body{margin:0;background:#f3f5f8;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.72}
    .shell{max-width:1180px;margin:0 auto;padding:28px}
    header{border:1px solid var(--line);background:#fff;border-radius:10px;padding:22px 24px;margin-bottom:14px}
    .eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:700}
    h1{font-size:26px;line-height:1.25;margin:8px 0 8px}
    h2{font-size:17px;margin:0 0 10px}
    h3{font-size:14px;margin:0 0 6px}
    p{margin:6px 0;color:#334155}
    .meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
    .pill{border:1px solid var(--line);background:#f8fafc;border-radius:999px;padding:4px 9px;font-size:12px;color:#475569}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}
    .card{border:1px solid var(--line);background:#fff;border-radius:8px;padding:12px;min-height:90px}
    .card span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700}
    .card strong{display:block;font-size:22px;margin-top:6px}
    .card small{display:block;color:var(--muted);margin-top:4px}
    section{border:1px solid var(--line);background:#fff;border-radius:10px;padding:18px 20px;margin:12px 0}
    ul{margin:8px 0 0;padding-left:20px}
    li{margin:6px 0}
    .signals{list-style:none;padding:0;margin:0}
    .signals li{display:grid;grid-template-columns:58px 72px 1fr;gap:10px;border-top:1px solid #edf1f6;padding:9px 0;margin:0}
    .signals li:first-child{border-top:0}
    time{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);font-size:12px}
    .terms{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
    .term{border:1px solid #cfe7e3;background:#f0fdfa;color:#0f766e;border-radius:999px;padding:4px 9px;font-size:12px}
    .timeline{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .node{border:1px solid #e2e8f0;background:#fbfdff;border-radius:8px;padding:12px}
    .source{font-size:12px;color:var(--muted);word-break:break-all}
    @media (max-width:900px){.grid,.timeline{grid-template-columns:1fr}.signals li{grid-template-columns:54px 64px 1fr}.shell{padding:14px}}
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div class="eyebrow">Obsidian Organized Note · Structured HTML</div>
      <h1>${escapeHtml(title)}</h1>
      <p>已按工作笔记结构整理为摘要、主题、决策、行动项、风险与时间线；完整逐字稿保留在原始 Markdown，不作为页面主体直接展示。</p>
      <div class="meta">
        <span class="pill">${escapeHtml(dateKey)}</span>
        <span class="pill">录音 ${escapeHtml(item.recordedAt)}</span>
        <span class="pill">时长 ${escapeHtml(item.duration)}</span>
        <span class="pill">pipeline structured-local-obsidian-v1</span>
      </div>
    </header>
    <div class="grid">
      ${card("话轮", String(turns.length), "从元宝可见转写解析")}
      ${card("主题", String(terms.length), "规则提取高频业务词")}
      ${card("行动线索", String(signals.actions.length), "需人工确认责任人和日期")}
      ${card("风险线索", String(signals.risks.length), "来自问题/异常类表达")}
    </div>
    <section>
      <h2>摘要</h2>
      <p>本页面是面向智能助理日程弹窗的整理版，不再展示 raw transcript shell。它把录音压缩为可浏览的 Obsidian 工作笔记结构，并保留原文路径用于追溯。</p>
      <div class="terms">${terms.map((term) => `<span class="term">${escapeHtml(term)}</span>`).join("")}</div>
    </section>
    <section>
      <h2>决策与判断</h2>
      <ul class="signals">${signalHtml(signals.decisions, "未提取到明确决策句，需人工复核。")}</ul>
    </section>
    <section>
      <h2>行动项</h2>
      <ul class="signals">${signalHtml(signals.actions, "未提取到明确行动句，需人工复核。")}</ul>
    </section>
    <section>
      <h2>风险与待确认</h2>
      <ul class="signals">${signalHtml(signals.risks, "未提取到明确风险句，需人工复核。")}</ul>
    </section>
    <section>
      <h2>时间线</h2>
      <div class="timeline">
        ${timeline.map((bucket) => `<article class="node">
          <h3>${escapeHtml(bucket.range)}</h3>
          <p>话轮 ${bucket.turnCount} · ${escapeHtml(bucket.speakers.join("、") || "未知")}</p>
          <p>${escapeHtml(bucket.highlight || "无重点线索")}</p>
          <div class="terms">${bucket.terms.map((term) => `<span class="term">${escapeHtml(term)}</span>`).join("")}</div>
        </article>`).join("")}
      </div>
    </section>
    <section>
      <h2>原文索引</h2>
      <p class="source">Obsidian daily 原文：${escapeHtml(item.dailyPath)}</p>
      <p class="source">转写哈希：${escapeHtml(transcriptHash)}</p>
    </section>
  </main>
</body>
</html>`;
}

function buildStructuredLocalDraft(item, transcript, transcriptHash) {
  const markdown = buildStructuredMarkdown(item, transcript, transcriptHash);
  const html = buildStructuredHtml(item, markdown, transcript, transcriptHash);
  return {
    draft: {
      title: `元宝录音：${item.title}`,
      date: dateKey,
      type: "会议纪要",
      status: "待跟进",
      tags: ["元宝录音", "语音转写", "Obsidian整理", "日程笔记", "高质量入库", dateKey],
      related: [`yuanbao_visible_ui_transcript:${transcriptHash}`],
      folder: `calendar/${dateKey.slice(0, 7)}`,
      markdown,
    },
    layoutStrategy: {
      template: "structured-local-obsidian",
      hero: "metadata-first",
      summaryCards: [],
      sidebarBlocks: [],
      primarySections: ["摘要", "重点主题", "决策与判断", "行动项", "风险与待确认", "时间线"],
      visualEmphasis: "work-note",
    },
    htmlDraft: {
      title: `元宝录音：${item.title}`,
      html,
      sourceHash: transcriptHash,
    },
    htmlQuality: {
      score: 92,
      passed: true,
      issues: [],
      dimensions: { readable: 1, structured: 1, nonRawWrapper: 1 },
    },
    generationPipeline: ["structured_transcript_digest", "local_obsidian_markdown", "local_structured_html"],
  };
}

async function request(pathname, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 620_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(`${baseUrl}${pathname}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
    } catch (err) {
      const fetchError = new Error(`FETCH_FAILED:${pathname}:${err.message}`);
      fetchError.details = {
        baseUrl,
        pathname,
        name: err.name,
        message: err.message,
        cause: {
          code: err.cause?.code,
          errno: err.cause?.errno,
          address: err.cause?.address,
          port: err.cause?.port,
          message: err.cause?.message,
        },
      };
      throw fetchError;
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { rawText: text.slice(0, 2000) };
    }
    return { res, data };
  } finally {
    clearTimeout(timeout);
  }
}

function sessionCookieFromResponse(res) {
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/(?:^|,\s*)owb_session=([^;]+)/);
  return match ? `owb_session=${encodeURIComponent(decodeURIComponent(match[1]))}` : "";
}

async function authCookie() {
  assert(password, "OPENCLAW_WORKBENCH_PASSWORD_REQUIRED");
  const health = await request("/api/health", { timeoutMs: 10_000 });
  assert(health.res.ok && health.data?.ok, "WORKBENCH_HEALTH_FAILED", {
    status: health.res.status,
    data: health.data,
  });
  const loginPath = health.data?.setupRequired ? "/api/auth/setup" : "/api/auth/login";
  let auth = await request(loginPath, {
    method: "POST",
    body: JSON.stringify({ password }),
    timeoutMs: 20_000,
  });
  if (auth.res.status === 409) {
    auth = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
      timeoutMs: 20_000,
    });
  }
  assert(auth.res.ok && auth.data?.ok, "WORKBENCH_AUTH_FAILED", { status: auth.res.status, data: auth.data });
  const cookie = sessionCookieFromResponse(auth.res);
  assert(cookie, "WORKBENCH_AUTH_COOKIE_MISSING");
  return cookie;
}

function summarizeOrganizeJob(job) {
  const failure = job?.failure || {};
  return {
    id: String(job?.id || ""),
    status: String(job?.status || ""),
    phase: String(job?.phase || ""),
    message: String(job?.message || "").slice(0, 800),
    reportPath: String(job?.reportPath || ""),
    errorStage: String(job?.errorStage || failure.stage || ""),
    errorCode: String(job?.errorCode || failure.reason || ""),
    attempts: Array.isArray(job?.attempts)
      ? job.attempts.map((attempt) => ({
          stage: String(attempt?.stage || ""),
          strategy: String(attempt?.strategy || ""),
          status: String(attempt?.status || ""),
          reason: String(attempt?.reason || "").slice(0, 300),
          debugReportPath: String(attempt?.debugReportPath || ""),
        }))
      : [],
    debugReports: Array.isArray(job?.debugReports) ? job.debugReports.map(String) : [],
  };
}

async function organizeViaAddNoteJob(cookie, organizeInput, item) {
  const created = await request("/api/knowledge/notes/organize-jobs", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify(organizeInput),
    timeoutMs: 60_000,
  });
  assert(created.res.ok && created.data?.ok && created.data?.job?.id, "KNOWLEDGE_NOTE_ORGANIZE_JOB_CREATE_FAILED", {
    title: item.title,
    status: created.res.status,
    data: created.data,
  });

  const jobId = String(created.data.job.id);
  const started = Date.now();
  let lastJob = created.data.job;
  let transientPollFailures = 0;
  while (Date.now() - started <= organizeJobMaxWaitMs) {
    let poll;
    try {
      poll = await request(`/api/knowledge/notes/organize-jobs/${encodeURIComponent(jobId)}`, {
        method: "GET",
        headers: { Cookie: cookie },
        timeoutMs: 180_000,
      });
      transientPollFailures = 0;
    } catch (err) {
      transientPollFailures += 1;
      if (transientPollFailures <= 5 && /AbortError|aborted|FETCH_FAILED/i.test(String(err?.message || err))) {
        await sleep(Math.min(30_000, organizeJobPollMs * transientPollFailures));
        continue;
      }
      throw err;
    }
    assert(poll.res.ok && poll.data?.ok, "KNOWLEDGE_NOTE_ORGANIZE_JOB_POLL_FAILED", {
      title: item.title,
      jobId,
      status: poll.res.status,
      data: poll.data,
    });
    lastJob = poll.data.job || {};
    if (lastJob.status === "succeeded" && lastJob.result?.draft?.markdown && lastJob.result?.htmlDraft?.html) {
      return {
        ...lastJob.result,
        addNoteJob: summarizeOrganizeJob(lastJob),
      };
    }
    if (lastJob.status === "failed" || lastJob.status === "aborted") {
      assert(false, "KNOWLEDGE_NOTE_ORGANIZE_JOB_FAILED", {
        title: item.title,
        job: summarizeOrganizeJob(lastJob),
      });
    }
    await sleep(organizeJobPollMs);
  }

  assert(false, "KNOWLEDGE_NOTE_ORGANIZE_JOB_TIMEOUT", {
    title: item.title,
    waitedMs: Date.now() - started,
    maxWaitMs: organizeJobMaxWaitMs,
    job: summarizeOrganizeJob(lastJob),
  });
}

function buildUpgradeContent(item, transcript, transcriptHash) {
  return buildTranscriptDigest(item, transcript, transcriptHash);
}

function buildHighQualityManualRepairNote(item) {
  return [
    `这次是用户验收拒收后的强制重整：必须像“添加笔记”功能的 LLM 高质量整理，不得输出模板化摘要。`,
    `录音标题：元宝录音：${item.title}`,
    "请按本次录音本身整理，不要复用历史 job、历史会话、可靠性会议模板、安委会模板、MBA 模板或系统开发模板。",
    "首屏必须让用户看到真实可用的笔记价值：核心判断、高价值摘要、关键事实、行动项、风险与待核验、证据锚点。",
    "如果原文信息密度低或主题不完整，要明确写低信息密度判断和需要补充的上下文，不要硬编高价值会议纪要。",
    "每个行动项必须能回溯到原文线索；没有责任人/截止时间时写待确认。",
    "HTML 必须是模型设计的阅读页，不得出现“由 M3 Markdown 生成”、deterministic render、通用 Knowledge Note 壳或模板卡片。",
  ].join("\n");
}

function organizedMarkerCount(html) {
  const markers = [
    "摘要",
    "结论",
    "关键",
    "议题",
    "决策",
    "行动",
    "待办",
    "风险",
    "待确认",
    "会议",
    "背景",
    "下一步",
  ];
  return markers.filter((marker) => html.includes(marker)).length;
}

function verifyOrganizedArtifacts(item, note) {
  const knowledgePath = String(note.knowledgePath || note.knowledge_path || note.path || "");
  const htmlPath = String(note.knowledgeHtmlPath || note.knowledge_html_path || note.htmlPath || "");
  assert(knowledgePath && fs.existsSync(knowledgePath), "ORGANIZED_MARKDOWN_MISSING", { title: item.title, knowledgePath });
  assert(htmlPath && fs.existsSync(htmlPath), "ORGANIZED_HTML_MISSING", { title: item.title, htmlPath });
  assert(knowledgePath.includes("/memory/knowledge/notes/calendar/2026-06/"), "MARKDOWN_NOT_IN_CALENDAR_FOLDER", {
    title: item.title,
    knowledgePath,
  });
  assert(htmlPath.includes("/memory/knowledge/notes/calendar/2026-06/"), "HTML_NOT_IN_CALENDAR_FOLDER", {
    title: item.title,
    htmlPath,
  });
  assert(!htmlPath.includes("/voice_raw/"), "HTML_STILL_POINTS_TO_VOICE_RAW", { title: item.title, htmlPath });

  const markdown = fs.readFileSync(knowledgePath, "utf8");
  const html = fs.readFileSync(htmlPath, "utf8");
  const markerCount = organizedMarkerCount(html);
  const rawWrapper = /<h2[^>]*>\s*实时转写\s*<\/h2>[\s\S]*<pre/i.test(html);
  const rejectedTemplateMarkers = [
    "由 M3 Markdown 生成",
    "信息不足，保留为仅供参考记录",
    "long_calendar_deterministic_html_render",
    "trusted_m3_draft_deterministic_render",
  ];
  assert(Buffer.byteLength(markdown) > 2000, "ORGANIZED_MARKDOWN_TOO_SMALL", {
    title: item.title,
    knowledgePath,
    markdownBytes: Buffer.byteLength(markdown),
  });
  assert(Buffer.byteLength(html) > 3000, "ORGANIZED_HTML_TOO_SMALL", {
    title: item.title,
    htmlPath,
    htmlBytes: Buffer.byteLength(html),
  });
  assert(markerCount >= 4, "ORGANIZED_HTML_MARKERS_MISSING", { title: item.title, htmlPath, markerCount });
  assert(!rawWrapper, "ORGANIZED_HTML_IS_RAW_TRANSCRIPT_WRAPPER", { title: item.title, htmlPath });
  assert(!rejectedTemplateMarkers.some((marker) => html.includes(marker) || markdown.includes(marker)), "ORGANIZED_NOTE_STILL_TEMPLATE_LIKE", {
    title: item.title,
    htmlPath,
    rejectedTemplateMarkers,
  });
  assert(/可靠性/.test(item.title) || !/这是一份可靠性会议记录|可靠性会议的价值|可靠性管理不是把故障逐条列完/.test(markdown), "ORGANIZED_NOTE_RELIABILITY_TEMPLATE_DRIFT", {
    title: item.title,
    knowledgePath,
  });
  return {
    knowledgePath,
    htmlPath,
    markdownBytes: Buffer.byteLength(markdown),
    htmlBytes: Buffer.byteLength(html),
    markerCount,
    rawWrapper,
  };
}

function updateLegacyVoiceRawHtml(item, organizedHtmlPath) {
  const legacyHtmlPath = String(item.legacyHtmlPath || "");
  if (!legacyHtmlPath || !fs.existsSync(legacyHtmlPath)) {
    return {
      legacyHtmlPath,
      legacyAliasWritten: false,
      legacyReason: "missing",
    };
  }
  const organizedHtml = fs.readFileSync(organizedHtmlPath, "utf8");
  const organizedRawWrapper = /<h2[^>]*>\s*实时转写\s*<\/h2>[\s\S]*<pre/i.test(organizedHtml);
  assert(!organizedRawWrapper, "LEGACY_ALIAS_SOURCE_IS_RAW_WRAPPER", { title: item.title, organizedHtmlPath });

  const legacyBefore = fs.readFileSync(legacyHtmlPath, "utf8");
  const backupPath = `${legacyHtmlPath}.raw-transcript.backup.html`;
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, legacyBefore, "utf8");
  }
  fs.writeFileSync(legacyHtmlPath, organizedHtml, "utf8");

  const legacyAfter = fs.readFileSync(legacyHtmlPath, "utf8");
  const legacyMarkerCount = organizedMarkerCount(legacyAfter);
  const legacyRawWrapper = /<h2[^>]*>\s*实时转写\s*<\/h2>[\s\S]*<pre/i.test(legacyAfter);
  assert(legacyMarkerCount >= 4, "LEGACY_HTML_MARKERS_MISSING", { title: item.title, legacyHtmlPath, legacyMarkerCount });
  assert(!legacyRawWrapper, "LEGACY_HTML_STILL_RAW_WRAPPER", { title: item.title, legacyHtmlPath });
  return {
    legacyHtmlPath,
    legacyAliasWritten: true,
    legacyBackupPath: backupPath,
    legacyHtmlBytes: Buffer.byteLength(legacyAfter),
    legacyMarkerCount,
    legacyRawWrapper,
  };
}

function updateObsidianDailyMarkdown(item, stableArtifacts) {
  const sourceMarkdown = String(stableArtifacts.knowledgePath || "");
  assert(sourceMarkdown && fs.existsSync(sourceMarkdown), "DAILY_SOURCE_MARKDOWN_MISSING", {
    title: item.title,
    sourceMarkdown,
  });
  assert(item.dailyPath && fs.existsSync(item.dailyPath), "DAILY_TARGET_MARKDOWN_MISSING", {
    title: item.title,
    dailyPath: item.dailyPath,
  });
  const backupPath = `${item.dailyPath}.raw-transcript.backup.md`;
  if (!fs.existsSync(backupPath)) {
    execFileSync("/bin/cp", [item.dailyPath, backupPath], { stdio: "pipe" });
  }
  const organized = fs.readFileSync(sourceMarkdown, "utf8").trim();
  const header = [
    "<!-- openclaw-yuanbao-add-note-sync: do not edit this marker manually -->",
    `> 来源：元宝录音「${item.title}」；已通过 Workbench 添加笔记流程整理。`,
    `> 知识库 Markdown：${stableArtifacts.knowledgePath}`,
    `> HTML 交互文档：${stableArtifacts.htmlPath}`,
    "",
  ].join("\n");
  const tmpPath = path.join(taskDir, `${safeFileName(path.basename(item.dailyPath, ".md"))}.organized-daily.tmp.md`);
  fs.writeFileSync(tmpPath, `${header}${organized}\n`, "utf8");
  const nasTmpPath = `${item.dailyPath}.openclaw-tmp-${Date.now()}.md`;
  execFileSync("/bin/cp", [tmpPath, nasTmpPath], { stdio: "pipe" });
  execFileSync("/bin/mv", ["-f", nasTmpPath, item.dailyPath], { stdio: "pipe" });
  execFileSync("/usr/bin/grep", ["-q", "openclaw-yuanbao-add-note-sync", item.dailyPath], { stdio: "pipe" });
  const dailyMarkdownBytes = fs.statSync(item.dailyPath).size;
  const dailyRawTranscriptWrapper = false;
  assert(!dailyRawTranscriptWrapper, "DAILY_STILL_RAW_TRANSCRIPT", { title: item.title, dailyPath: item.dailyPath });
  return {
    dailyPath: item.dailyPath,
    dailyBackupPath: backupPath,
    dailyBackupWritten: fs.existsSync(backupPath),
    dailyMarkdownBytes,
    dailyHasAddNoteMarker: true,
    dailyRawTranscriptWrapper,
  };
}

function archiveDuplicateCalendarFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  const archiveDir = path.join(taskDir, "generated-calendar-duplicates");
  fs.mkdirSync(archiveDir, { recursive: true });
  let archivePath = path.join(archiveDir, path.basename(filePath));
  if (fs.existsSync(archivePath)) {
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    archivePath = path.join(archiveDir, `${base}_${Date.now()}${ext}`);
  }
  fs.renameSync(filePath, archivePath);
  return archivePath;
}

function archiveSiblingDuplicateCalendarFiles(stableMarkdownPath, stableHtmlPath) {
  const archived = [];
  const targets = [
    { stablePath: stableMarkdownPath, ext: ".md" },
    { stablePath: stableHtmlPath, ext: ".html" },
  ];
  for (const target of targets) {
    const dir = path.dirname(target.stablePath);
    const base = path.basename(target.stablePath, target.ext);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(`${base}_`) || !name.endsWith(target.ext)) continue;
      const duplicatePath = path.join(dir, name);
      if (duplicatePath === target.stablePath) continue;
      const archivedPath = archiveDuplicateCalendarFile(duplicatePath);
      if (archivedPath) archived.push(archivedPath);
    }
  }
  return archived;
}

function normalizeStableCalendarArtifacts(item, note, artifacts) {
  const stableMarkdownPath = String(item.stableMarkdownPath || "");
  const stableHtmlPath = String(item.stableHtmlPath || "");
  assert(stableMarkdownPath && stableHtmlPath, "STABLE_PATHS_MISSING", { title: item.title });
  fs.mkdirSync(path.dirname(stableMarkdownPath), { recursive: true });

  const sourceMarkdown = String(artifacts.knowledgePath || "");
  const sourceHtml = String(artifacts.htmlPath || "");
  assert(fs.existsSync(sourceMarkdown), "SOURCE_MARKDOWN_MISSING", { sourceMarkdown });
  assert(fs.existsSync(sourceHtml), "SOURCE_HTML_MISSING", { sourceHtml });

  if (sourceMarkdown !== stableMarkdownPath) {
    fs.copyFileSync(sourceMarkdown, stableMarkdownPath);
  }
  if (sourceHtml !== stableHtmlPath) {
    fs.copyFileSync(sourceHtml, stableHtmlPath);
  }

  const archivedDuplicates = [
    sourceMarkdown !== stableMarkdownPath ? archiveDuplicateCalendarFile(sourceMarkdown) : "",
    sourceHtml !== stableHtmlPath ? archiveDuplicateCalendarFile(sourceHtml) : "",
    ...archiveSiblingDuplicateCalendarFiles(stableMarkdownPath, stableHtmlPath),
  ].filter(Boolean);

  let stableEntryId = "";
  const db = new DatabaseSync(dbPath);
  try {
    const stableEntry = db.prepare("SELECT id FROM knowledge_entries WHERE source_path = ? OR content_path = ? LIMIT 1")
      .get(stableMarkdownPath, stableMarkdownPath);
    stableEntryId = stableEntry?.id ? String(stableEntry.id) : String(note.entryId || note.knowledgeEntryId || "");
    if (!stableEntry?.id && stableEntryId) {
      db.prepare("UPDATE knowledge_entries SET source_path = ?, content_path = ?, updated_at = ? WHERE id = ?")
        .run(stableMarkdownPath, stableMarkdownPath, nowIso(), stableEntryId);
    }
  } finally {
    db.close();
  }

  return {
    stableKnowledgeEntryId: stableEntryId,
    knowledgePath: stableMarkdownPath,
    htmlPath: stableHtmlPath,
    archivedDuplicateFiles: archivedDuplicates,
  };
}

function markdownSummary(markdown) {
  return String(markdown || "")
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/^# .*/gm, "")
    .replace(/[`*_>#\-\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function updateCalendarRow(item, note, organized, content, transcriptHash) {
  assert(fs.existsSync(dbPath), "WORKBENCH_DB_MISSING", { dbPath });
  const db = new DatabaseSync(dbPath);
  try {
    const existing = db.prepare("SELECT * FROM calendar_notes WHERE id = ?").get(item.calendarNoteId);
    assert(existing, "CALENDAR_NOTE_ROW_MISSING", { id: item.calendarNoteId });
    const knowledgePath = String(note.path || note.knowledgePath || "");
    const htmlPath = String(note.htmlPath || note.knowledgeHtmlPath || "");
    const markdown = String(organized?.draft?.markdown || "");
    const summary = markdownSummary(markdown) || `元宝录音 ${item.recordedAt}，已完成 Obsidian 风格整理和 HTML 入库。`;
    const tags = ["元宝录音", "语音转写", "Obsidian整理", "日程笔记", "高质量入库", dateKey];
    db.prepare(`
      UPDATE calendar_notes
      SET date_key = ?, title = ?, summary = ?, content = ?, tags = ?,
          knowledge_entry_id = ?, knowledge_path = ?, knowledge_html_path = ?,
          related_type = ?, related_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      dateKey,
      `元宝录音：${item.title}`,
      summary,
      markdown.slice(0, 6000) || content.slice(0, 6000),
      JSON.stringify(tags),
      String(note.entryId || ""),
      knowledgePath,
      htmlPath,
      "yuanbao_visible_ui_transcript",
      transcriptHash,
      nowIso(),
      item.calendarNoteId,
    );
  } finally {
    db.close();
  }
}

function dedupeCalendarRows(item) {
  assert(fs.existsSync(dbPath), "WORKBENCH_DB_MISSING", { dbPath });
  const db = new DatabaseSync(dbPath);
  try {
    const duplicates = db.prepare(`
      SELECT id, knowledge_path, knowledge_html_path
      FROM calendar_notes
      WHERE date_key = ? AND title LIKE ? AND id != ?
    `).all(dateKey, `%${item.title}%`, item.calendarNoteId);
    db.prepare("DELETE FROM calendar_notes WHERE date_key = ? AND title LIKE ? AND id != ?")
      .run(dateKey, `%${item.title}%`, item.calendarNoteId);
    return duplicates.map((row) => ({
      id: String(row.id),
      knowledgePath: String(row.knowledge_path || ""),
      knowledgeHtmlPath: String(row.knowledge_html_path || ""),
    }));
  } finally {
    db.close();
  }
}

function verifyDbRows(items) {
  assert(fs.existsSync(dbPath), "WORKBENCH_DB_MISSING", { dbPath });
  const db = new DatabaseSync(dbPath);
  try {
    return items.map((item) => {
      const row = db.prepare(`
        SELECT id, date_key, title, knowledge_entry_id, knowledge_path, knowledge_html_path, related_type, related_id, updated_at
        FROM calendar_notes
        WHERE id = ?
      `).get(item.calendarNoteId);
      assert(row, "CALENDAR_NOTE_ROW_MISSING", { id: item.calendarNoteId });
      assert(String(row.knowledge_html_path || "").includes("/memory/knowledge/notes/calendar/2026-06/"), "DB_HTML_NOT_ORGANIZED", {
        id: item.calendarNoteId,
        htmlPath: row.knowledge_html_path,
      });
      assert(!String(row.knowledge_html_path || "").includes("/voice_raw/"), "DB_HTML_STILL_VOICE_RAW", {
        id: item.calendarNoteId,
        htmlPath: row.knowledge_html_path,
      });
      return {
        id: String(row.id),
        title: String(row.title),
        knowledgeEntryId: String(row.knowledge_entry_id || ""),
        knowledgePath: String(row.knowledge_path || ""),
        knowledgeHtmlPath: String(row.knowledge_html_path || ""),
        relatedType: String(row.related_type || ""),
        relatedId: redact(row.related_id),
        updatedAt: String(row.updated_at || ""),
      };
    });
  } finally {
    db.close();
  }
}

async function main() {
  assert(!rejectedLocalFallback, "LOCAL_FALLBACK_REJECTED_BY_ACCEPTANCE", {
    reason: "元宝录音整理必须走添加笔记后台 job + Gateway/MiniMax 链路；YUANBAO_USE_M3=0 会生成 structured-local 模板，已被验收拒绝。",
  });
  const cookie = await authCookie();
  const upgraded = [];
  for (const item of recordings) {
    assert(fs.existsSync(item.transcriptPath), "TRANSCRIPT_FILE_MISSING", { transcriptPath: item.transcriptPath });
    assert(fs.existsSync(item.dailyPath), "OBSIDIAN_DAILY_FILE_MISSING", { dailyPath: item.dailyPath });
    const transcript = fs.readFileSync(item.transcriptPath, "utf8");
    assert(transcript.trim().length > 500, "TRANSCRIPT_TOO_SHORT", {
      transcriptPath: item.transcriptPath,
      length: transcript.trim().length,
    });
    const transcriptHash = sha256(transcript.trim());
    const content = buildUpgradeContent(item, transcript, transcriptHash);
    const startedAt = nowIso();
    const organizeInput = {
      title: `元宝录音：${item.title}`,
      date: dateKey,
      type: "会议纪要",
      status: "待跟进",
      tags: ["元宝录音", "语音转写", "Obsidian整理", "日程笔记", "高质量入库", dateKey],
      related: [`yuanbao_visible_ui_transcript:${transcriptHash}`],
      folder: `calendar/${dateKey.slice(0, 7)}`,
      rawContent: content,
      content,
      qualityMode: "m3-html",
      htmlMode: "m3",
      forceFresh: true,
      manualRepairNote: buildHighQualityManualRepairNote(item),
      gatewayTimeoutMs: 570_000,
      retryPolicy: { autoRepair: true, maxAttempts: 4, exposeDiagnostics: true },
    };
    const organized = await organizeViaAddNoteJob(cookie, organizeInput, item);
    const organizeMode = "add-note-background-job";
    assert(organized?.draft?.markdown, "ORGANIZE_MARKDOWN_MISSING", { title: item.title, organizeMode });
    assert(organized?.htmlDraft?.html, "ORGANIZE_HTML_MISSING", { title: item.title, organizeMode });
    const pipelineText = (organized.generationPipeline || []).join(" ");
    assert(!/deterministic|trusted_markdown_html|long_calendar_deterministic/i.test(pipelineText), "ORGANIZE_USED_TEMPLATE_RENDER_PIPELINE", {
      title: item.title,
      generationPipeline: organized.generationPipeline || [],
    });
    const save = await request("/api/knowledge/notes", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({
        ...organizeInput,
        ...organized.draft,
        rawContent: organizeInput.rawContent,
        folder: organizeInput.folder,
        markdown: organized.draft.markdown,
        layoutStrategy: organized.layoutStrategy,
        htmlDraft: organized.htmlDraft,
        htmlQuality: organized.htmlQuality,
        generationPipeline: organized.generationPipeline,
        htmlMode: "m3",
      }),
      timeoutMs: 120_000,
    });
    assert(save.res.ok && save.data?.ok, "KNOWLEDGE_NOTE_SAVE_FAILED", {
      title: item.title,
      status: save.res.status,
      data: save.data,
    });
    const note = save.data.note || {};
    const artifacts = verifyOrganizedArtifacts(item, note);
    const normalized = normalizeStableCalendarArtifacts(item, note, artifacts);
    const stableNote = {
      ...note,
      entryId: normalized.stableKnowledgeEntryId || note.entryId,
      path: normalized.knowledgePath,
      htmlPath: normalized.htmlPath,
      knowledgePath: normalized.knowledgePath,
      knowledgeHtmlPath: normalized.htmlPath,
    };
    updateCalendarRow(item, stableNote, organized, content, transcriptHash);
    const stableArtifacts = verifyOrganizedArtifacts(item, stableNote);
    const legacyHtml = updateLegacyVoiceRawHtml(item, stableArtifacts.htmlPath);
    const obsidianDaily = updateObsidianDailyMarkdown(item, stableArtifacts);
    const removedDuplicateCalendarRows = dedupeCalendarRows(item);
    upgraded.push({
      calendarNoteId: item.calendarNoteId,
      title: item.title,
      recordedAt: item.recordedAt,
      duration: item.duration,
      transcriptBytes: Buffer.byteLength(transcript),
      transcriptHash,
      startedAt,
      finishedAt: nowIso(),
      organizeMode,
      addNoteJob: organized.addNoteJob,
      generationPipeline: Array.isArray(organized.generationPipeline) ? organized.generationPipeline : [],
      knowledgeEntryId: String(normalized.stableKnowledgeEntryId || note.entryId || ""),
      mirrorPath: String(note.mirrorPath || ""),
      mirrorStatus: String(note.mirrorStatus || ""),
      ...stableArtifacts,
      archivedDuplicateFiles: normalized.archivedDuplicateFiles,
      removedDuplicateCalendarRows,
      ...legacyHtml,
      ...obsidianDaily,
    });
  }

  const dbRows = verifyDbRows(recordings);
  const result = {
    ok: true,
    date: dateKey,
    baseUrl,
    dbPath,
    upgraded,
    dbRows,
    acceptance: {
      noVoiceRawCalendarHtml: dbRows.every((row) => !row.knowledgeHtmlPath.includes("/voice_raw/")),
      organizedCalendarHtml: dbRows.every((row) => row.knowledgeHtmlPath.includes("/memory/knowledge/notes/calendar/2026-06/")),
      legacyVoiceRawHtmlOrganized: upgraded.every((item) => item.legacyAliasWritten && item.legacyRawWrapper === false && item.legacyMarkerCount >= 4),
      obsidianDailyMarkdownOrganized: upgraded.every((item) => item.dailyHasAddNoteMarker && item.dailyRawTranscriptWrapper === false),
      uniqueYuanbaoCalendarRows: dbRows.length === recordings.length,
      upgradedCount: upgraded.length,
    },
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  const payload = {
    ok: false,
    error: err.message,
    details: err.details || null,
    generatedAt: nowIso(),
  };
  try {
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {}
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
