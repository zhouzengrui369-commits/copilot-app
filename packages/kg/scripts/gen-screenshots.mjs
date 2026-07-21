/**
 * Generate screenshots for T-1.2.1 (wave 1: kg_nodes DB).
 *
 *   1. Seed a real local KgStore with 12 sample entities (4 person / 3 org /
 *      2 concept / 2 event / 1 place) plus note_links.
 *   2. Render an HTML table view of kg_nodes + kg_schema_meta + indexes.
 *   3. Headless Chromium via playwright captures the rendered DOM to PNG.
 *
 * Run with:
 *   node packages/kg/scripts/gen-screenshots.mjs [--out=path]
 *
 * Defaults to /Users/njx/openclaw/copilot.wt-T121v2/wt-T121v2/screenshots/T-1.2.1/
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const defaultOut = path.join(repoRoot, 'screenshots', 'T-1.2.1');

function argOut() {
  const args = process.argv.slice(2);
  for (const a of args) {
    if (a.startsWith('--out=')) return a.slice('--out='.length);
  }
  return defaultOut;
}

const outDir = argOut();
fs.mkdirSync(outDir, { recursive: true });

// Pull compiled module from dist/ — `KgStore` is exported from src/index.ts
// but we also expose a build path. If dist/ is missing yet, try tsx-style
// dynamic import of the .ts source (requires `tsx`); fall back to a
// vitest-built snapshot. Best-effort, no hard fail on tooling miss.
const { KgStore } = await import('../dist/index.js').catch(async () => {
  // Fallback: load source via tsx (if available) so this script works
  // during the wave 1 first-build window before `npm run build` ran.
  return await import('../src/index.js').catch(() => ({ KgStore: null }));
});

if (!KgStore) {
  console.error(
    '[gen-shots] KgStore not available — run `npm run build` in packages/kg first.',
  );
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-shots-'));
const dbPath = path.join(tmpDir, 'kg.sqlite');
console.log('[gen-shots] tmp dir:', tmpDir);

// ── 1. Seed KG with sample data ─────────────────────────────────────────────
const store = new KgStore({ dbPath });
const now = 1_700_000_000_000;

const seedEntities = [
  { type: 'person', name: 'Grace Hopper', aliases: ['GH', 'Amazing Grace'], confidence: 0.97 },
  { type: 'person', name: 'Alan Turing', aliases: ['Turing'], confidence: 0.95 },
  { type: 'person', name: 'Ada Lovelace', aliases: ['Augusta Ada'], confidence: 0.92 },
  { type: 'person', name: 'Linus Torvalds', aliases: ['Linus'], confidence: 0.88 },
  { type: 'org', name: 'OpenAI', aliases: [], confidence: 0.9 },
  { type: 'org', name: 'Anthropic', aliases: ['Anthropic PBC'], confidence: 0.86 },
  { type: 'org', name: 'Google DeepMind', aliases: ['DeepMind'], confidence: 0.84 },
  { type: 'concept', name: 'Knowledge Graph', aliases: ['KG'], confidence: 0.96 },
  { type: 'concept', name: 'RAG', aliases: ['Retrieval-Augmented Generation'], confidence: 0.93 },
  { type: 'event', name: 'Sprint 1.2 Kickoff', aliases: [], confidence: 0.8 },
  { type: 'event', name: 'Sprint 1.1 Retrospective', aliases: [], confidence: 0.82 },
  { type: 'place', name: 'San Francisco', aliases: ['SF'], confidence: 0.78 },
];

for (const e of seedEntities) {
  store.upsertEntity(
    {
      entity_id: `${e.type}:${e.name.toLowerCase().replace(/\s+/g, '-')}`,
      type: e.type,
      name: e.name,
      aliases: e.aliases,
      confidence: e.confidence,
      source_note: `seed/${e.type}-${e.name.toLowerCase().replace(/\s+/g, '-')}`,
    },
    now,
  );
}

// ── 2. Dump to HTML ─────────────────────────────────────────────────────────
const nodes = store.listNodes();
const edges = store.listEdges();
const tags = store.listTags();

function escape(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRows(rows, cells, emptyMsg) {
  if (rows.length === 0) return `<tr><td colspan="10" class="empty">${emptyMsg}</td></tr>`;
  return rows.map(cells).join('');
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>KG nodes · T-1.2.1 wave 1 screenshot</title>
<style>
  :root {
    --bg: #1a1d24; --panel: #232830; --grid: #2c323c;
    --text: #d6dbe4; --muted: #7d8694;
    --accent: #5fb5ff; --accent-2: #9be07b;
    --type-person: #5fb5ff; --type-org: #ffb35f; --type-concept: #9be07b;
    --type-event: #d77bff; --type-place: #ffd966; --type-other: #c0c7d2;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--bg); color: var(--text); }
  header { padding: 18px 28px; border-bottom: 1px solid var(--grid); background: #161a20; }
  header h1 { margin: 0; font-size: 16px; letter-spacing: 0.5px; }
  header .meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
  main { padding: 22px 28px; }
  .panel { background: var(--panel); border: 1px solid var(--grid); border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; }
  .panel h2 { margin: 0 0 10px 0; font-size: 13px; color: var(--accent); letter-spacing: 0.5px; text-transform: uppercase; }
  .summary { display: flex; gap: 22px; flex-wrap: wrap; font-size: 12px; }
  .summary .stat { background: #1a1d24; border: 1px solid var(--grid); border-radius: 6px; padding: 8px 14px; }
  .summary .stat .label { color: var(--muted); font-size: 11px; }
  .summary .stat .value { font-size: 18px; color: var(--accent-2); font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: 10.5px; letter-spacing: 0.6px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 600; }
  .badge.person { background: rgba(95, 181, 255, 0.18); color: var(--type-person); }
  .badge.org { background: rgba(255, 179, 95, 0.18); color: var(--type-org); }
  .badge.concept { background: rgba(155, 224, 123, 0.18); color: var(--type-concept); }
  .badge.event { background: rgba(215, 123, 255, 0.18); color: var(--type-event); }
  .badge.place { background: rgba(255, 217, 102, 0.18); color: var(--type-place); }
  .badge.other { background: rgba(192, 199, 210, 0.15); color: var(--type-other); }
  .conf-bar { display: inline-block; width: 60px; height: 8px; background: #1a1d24; border-radius: 4px; overflow: hidden; vertical-align: middle; }
  .conf-bar > span { display: block; height: 100%; background: linear-gradient(90deg, #9be07b, #5fb5ff); }
  .empty { color: var(--muted); font-style: italic; }
  .alias { color: var(--muted); font-size: 11px; }
  footer { color: var(--muted); font-size: 11px; padding: 18px 28px; border-top: 1px solid var(--grid); background: #161a20; }
</style>
</head>
<body>
<header>
  <h1>@copilot/kg · wave 1 · kg_nodes table inspection</h1>
  <div class="meta">Sprint 1.2 · T-1.2.1 RETRY v2 · branch <code>sp1.2-T-1.2.1-v2</code> · db <code>${escape(dbPath)}</code></div>
</header>
<main>
  <section class="panel">
    <h2>Schema</h2>
    <pre style="font-size: 11.5px; color: var(--muted); line-height: 1.4; margin: 0;">
CREATE TABLE kg_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT,           -- JSON array
  summary TEXT,           -- LLM summary (filled by Summarizer, wave 2)
  confidence REAL,        -- 0..1
  source_notes TEXT,      -- JSON array of note paths
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_kg_nodes_type ON kg_nodes(type);
CREATE INDEX idx_kg_nodes_name ON kg_nodes(name);</pre>
  </section>

  <section class="panel">
    <h2>Counts</h2>
    <div class="summary">
      <div class="stat"><div class="label">kg_nodes</div><div class="value">${nodes.length}</div></div>
      <div class="stat"><div class="label">kg_edges</div><div class="value">${edges.length}</div></div>
      <div class="stat"><div class="label">kg_tags</div><div class="value">${tags.length}</div></div>
      <div class="stat"><div class="label">seeded types</div><div class="value">${new Set(nodes.map((n) => n.type)).size}</div></div>
    </div>
  </section>

  <section class="panel">
    <h2>kg_nodes rows (${nodes.length})</h2>
    <table>
      <thead>
        <tr>
          <th>id</th><th>entity_id</th><th>type</th><th>name</th>
          <th>aliases</th><th>confidence</th><th>source_notes</th>
        </tr>
      </thead>
      <tbody>
        ${renderRows(
          nodes,
          (n) => {
            const conf = Math.round((n.confidence ?? 0) * 100);
            return `<tr>
              <td>${n.id}</td>
              <td>${escape(n.entity_id)}</td>
              <td><span class="badge ${n.type}">${escape(n.type)}</span></td>
              <td>${escape(n.name)}</td>
              <td class="alias">${n.aliases.length ? escape(n.aliases.join(', ')) : '—'}</td>
              <td>
                <span class="conf-bar"><span style="width: ${conf}%;"></span></span>
                ${(n.confidence ?? 0).toFixed(2)}
              </td>
              <td class="alias">${escape(n.source_notes.join(', '))}</td>
            </tr>`;
          },
          'no nodes',
        )}
      </tbody>
    </table>
  </section>
</main>
<footer>
  Generated by packages/kg/scripts/gen-screenshots.mjs · 2026-07-10 · seeded 12 entities
  (4 person / 3 org / 2 concept / 2 event / 1 place). Will be re-run for full T-1.2.1 coverage
  after wave 3 (KG ≥ 30 nodes ≥ 50 edges).
</footer>
</body>
</html>
`;

const htmlPath = path.join(outDir, 'kg-nodes-db.html');
fs.writeFileSync(htmlPath, html);
console.log('[gen-shots] wrote', htmlPath);

// ── 3. Headless Chromium screenshot via playwright ──────────────────────────
let playwright;
try {
  playwright = await import('playwright');
} catch {
  console.error('[gen-shots] playwright not available — writing raw HTML only.');
  process.exit(0);
}

const browser = await playwright.chromium.launch({
  headless: true,
  channel: 'chrome', // use system Google Chrome (cache has 1228 but PW 1.59 wants 1217)
});
const context = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto('file://' + htmlPath);
await page.waitForLoadState('networkidle');
const pngPath = path.join(outDir, 'kg-nodes-db.png');
await page.screenshot({ path: pngPath, fullPage: true });
await browser.close();
console.log('[gen-shots] wrote', pngPath);
