#!/usr/bin/env node
/**
 * Render 3 HTML "screenshot" pages and capture them as PNGs using headless Chrome.
 * Reads fixtures from a tmp dir (passed as argv).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tmpDir = process.argv[2];
if (!tmpDir) {
  console.error('usage: gen-screenshots-html.mjs <fixture-dir>');
  process.exit(1);
}

const outDir = path.resolve(process.argv[3] || '.');
fs.mkdirSync(outDir, { recursive: true });

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ── 1. Schema screenshot ──────────────────────────────────────────────
const schemaSql = fs.readFileSync(path.join(tmpDir, 'schema.sql'), 'utf-8');
const schemaHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>KB schema</title>
<style>
  body { font: 13px/1.4 ui-monospace, "SF Mono", Menlo, monospace; background: #1e1e1e; color: #e6e6e6; padding: 24px; margin: 0; }
  h1 { font: 600 16px/1.2 system-ui, -apple-system, sans-serif; color: #fff; margin: 0 0 12px; }
  .meta { color: #8e8e8e; font-size: 11px; margin-bottom: 16px; }
  pre { background: #2a2a2a; border-radius: 8px; padding: 16px 20px; overflow-x: auto; white-space: pre; }
  .kw { color: #c586c0; }
  .id { color: #9cdcfe; }
  .ty { color: #4ec9b0; }
  .cm { color: #6a9955; }
  .st { color: #ce9178; }
  .op { color: #d4d4d4; }
</style></head>
<body>
  <h1>KB Schema v0 · SQLite (WAL mode) · better-sqlite3 11.10.0</h1>
  <div class="meta">$ sqlite3 kb.sqlite .schema  →  /packages/kb/src/store/sqlite-store.ts:30-68</div>
  <pre>${escapeHtml(schemaSql).replace(/\b(CREATE|PRIMARY|KEY|TEXT|INTEGER|REAL|NOT NULL|UNIQUE|AUTOINCREMENT|INDEX|IF NOT EXISTS|TABLE)\b/g, '<span class="kw">$1</span>')}</pre>
</body></html>`;

// ── 2. MD frontmatter screenshot ──────────────────────────────────────
const sampleMd = fs.readFileSync(path.join(tmpDir, 'sample.md'), 'utf-8');
// Split frontmatter from body for separate styling
const fmMatch = sampleMd.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
const fmBlock = fmMatch ? fmMatch[1] : '';
const bodyBlock = fmMatch ? fmMatch[2] : sampleMd;
const mdHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>KB MD note</title>
<style>
  body { font: 13px/1.5 ui-monospace, "SF Mono", Menlo, monospace; background: #fafafa; color: #1f2328; padding: 24px; margin: 0; }
  h1 { font: 600 16px/1.2 system-ui, -apple-system, sans-serif; color: #1f2328; margin: 0 0 4px; }
  .sub { color: #57606a; font-size: 11px; margin-bottom: 18px; }
  .fm { background: #fff8c5; border: 1px solid #d4a72c; border-radius: 6px; padding: 14px 18px; margin-bottom: 18px; }
  .fm .hd { color: #8b6e00; font-size: 11px; font-weight: 600; margin-bottom: 6px; }
  .fm pre { white-space: pre; margin: 0; }
  .body { background: #fff; border: 1px solid #d0d7de; border-radius: 6px; padding: 14px 18px; white-space: pre-wrap; }
  .body .hd { color: #57606a; font-size: 11px; font-weight: 600; margin-bottom: 6px; }
</style></head>
<body>
  <h1>MD note · frontmatter + body</h1>
  <div class="sub">/packages/kb/notes/calendar/2026-07-08/standup.md  ·  gray-matter 4.0.3</div>
  <div class="fm">
    <div class="hd">--- frontmatter (YAML, mirrors notes row) ---</div>
    <pre>${escapeHtml(fmBlock)}</pre>
  </div>
  <div class="body">
    <div class="hd">--- body (markdown) ---</div>
    <pre>${escapeHtml(bodyBlock.trimStart())}</pre>
  </div>
</body></html>`;

// ── 3. Perf chart screenshot ──────────────────────────────────────────
const perf = JSON.parse(fs.readFileSync(path.join(tmpDir, 'perf.json'), 'utf-8'));
const rows = perf.perfRows;
const maxVal = Math.max(...rows.map(r => Math.max(r.list, r.filter, r.search))) || 1;
const chartW = 880;
const chartH = 280;
const pad = { l: 50, r: 20, t: 30, b: 50 };
const plotW = chartW - pad.l - pad.r;
const plotH = chartH - pad.t - pad.b;
const stepX = plotW / rows.length;
// Build bars (3 series)
const bars = rows.map((r, i) => {
  const x = pad.l + i * stepX;
  const lh = (r.list / maxVal) * plotH;
  const fh = (r.filter / maxVal) * plotH;
  const sh = (r.search / maxVal) * plotH;
  const bw = Math.max(1, stepX / 4);
  return `<g>
    <rect x="${x + 1}" y="${pad.t + plotH - lh}" width="${bw}" height="${lh}" fill="#3b82f6" />
    <rect x="${x + 1 + bw + 1}" y="${pad.t + plotH - fh}" width="${bw}" height="${fh}" fill="#10b981" />
    <rect x="${x + 1 + 2 * (bw + 1)}" y="${pad.t + plotH - sh}" width="${bw}" height="${sh}" fill="#f59e0b" />
  </g>`;
}).join('');
const perfHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>KB perf</title>
<style>
  body { font: 13px/1.4 system-ui, -apple-system, sans-serif; background: #fff; color: #1f2328; padding: 24px; margin: 0; }
  h1 { font: 600 16px/1.2 system-ui, sans-serif; margin: 0 0 4px; }
  .sub { color: #57606a; font-size: 11px; margin-bottom: 16px; }
  .stat-row { display: flex; gap: 16px; margin: 16px 0 8px; }
  .stat { flex: 1; border: 1px solid #d0d7de; border-radius: 6px; padding: 10px 14px; background: #f6f8fa; }
  .stat .k { color: #57606a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .stat .v { font: 600 18px/1.2 ui-monospace, Menlo, monospace; color: #1f2328; margin-top: 4px; }
  .stat .u { color: #57606a; font-size: 11px; margin-left: 4px; }
  .legend { display: flex; gap: 16px; font-size: 12px; color: #57606a; margin-bottom: 4px; }
  .legend span::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
  .legend .L::before { background: #3b82f6; }
  .legend .F::before { background: #10b981; }
  .legend .S::before { background: #f59e0b; }
</style></head>
<body>
  <h1>KB perf · 100 notes query &lt; 50ms (plan.md §2.1 T-1.1.4)</h1>
  <div class="sub">vitest · 50 iterations · better-sqlite3 11.10.0 · Node v24.13.1 · macOS Darwin 25.2.0</div>
  <div class="stat-row">
    <div class="stat"><div class="k">listNotes (no filter)</div><div class="v">${perf.listAvg.toFixed(2)}<span class="u">ms avg</span> · ${perf.listP95.toFixed(2)}<span class="u">ms p95</span></div></div>
    <div class="stat"><div class="k">listNotes (filtered)</div><div class="v">${perf.filterAvg.toFixed(2)}<span class="u">ms avg</span></div></div>
    <div class="stat"><div class="k">searchNotes</div><div class="v">${perf.searchAvg.toFixed(2)}<span class="u">ms avg</span></div></div>
  </div>
  <div class="legend"><span class="L">list</span><span class="F">filtered</span><span class="S">search</span></div>
  <svg viewBox="0 0 ${chartW} ${chartH + 20}" width="${chartW}" height="${chartH + 20}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="#f6f8fa" stroke="#d0d7de" />
    ${bars}
    <line x1="${pad.l}" y1="${pad.t + plotH}" x2="${pad.l + plotW}" y2="${pad.t + plotH}" stroke="#57606a" />
    <text x="${pad.l - 6}" y="${pad.t + 8}" text-anchor="end" font-size="10" fill="#57606a">${maxVal.toFixed(2)}ms</text>
    <text x="${pad.l - 6}" y="${pad.t + plotH / 2}" text-anchor="end" font-size="10" fill="#57606a">${(maxVal / 2).toFixed(2)}ms</text>
    <text x="${pad.l - 6}" y="${pad.t + plotH + 4}" text-anchor="end" font-size="10" fill="#57606a">0</text>
    <text x="${pad.l}" y="${chartH + 16}" font-size="10" fill="#57606a">iter 1</text>
    <text x="${pad.l + plotW}" y="${chartH + 16}" text-anchor="end" font-size="10" fill="#57606a">iter 50</text>
  </svg>
</body></html>`;

// Write all 3 HTML files to disk
fs.writeFileSync(path.join(tmpDir, 'shot-1-schema.html'), schemaHtml, 'utf-8');
fs.writeFileSync(path.join(tmpDir, 'shot-2-md.html'), mdHtml, 'utf-8');
fs.writeFileSync(path.join(tmpDir, 'shot-3-perf.html'), perfHtml, 'utf-8');

// Capture with Chrome headless
const captures = [
  { html: 'shot-1-schema.html', png: '01_sqlite_schema.png' },
  { html: 'shot-2-md.html',     png: '02_md_frontmatter_sample.png' },
  { html: 'shot-3-perf.html',   png: '03_perf_100_notes_under_50ms.png' },
];

for (const c of captures) {
  const url = 'file://' + path.join(tmpDir, c.html);
  const target = path.join(outDir, c.png);
  const res = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--screenshot=${target}`,
    '--window-size=1024,720',
    url,
  ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) {
    console.error('chrome failed for', c.png, res.stderr);
    process.exit(1);
  }
  const sz = fs.statSync(target).size;
  console.log('[shot]', c.png, '→', target, `(${sz} bytes)`);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}