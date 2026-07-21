/**
 * Generate three artifacts for T-1.1.4 screenshots:
 *  1. SQLite DB sample (real, populated) — used for the schema dump
 *  2. MD file sample — used for the frontmatter screenshot
 *  3. Perf benchmark output — used for the perf chart
 *
 * Run with: node scripts/gen-screenshots.mjs
 * Output: /tmp/screenshot-tmp/ + JSON/HTML fixtures, then chrome headless
 * captures the PNGs into screenshots/T-1.1.4/.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const screenshotDir = path.join(packageRoot, 'screenshots', 'T-1.1.4');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-shots-'));

fs.mkdirSync(screenshotDir, { recursive: true });

const { KbClient } = await import('../dist/api/crud.js');
const { SqliteStore } = await import('../dist/store/sqlite-store.js');
const { MdFileStore } = await import('../dist/store/md-file-store.js');

console.log('[gen-shots] tmp dir:', tmpDir);

// 1. Build a real sample DB
const dbPath = path.join(tmpDir, 'kb.sqlite');
const rootDir = path.join(tmpDir, 'notes');
const sqlite = new SqliteStore({ dbPath });
const md = new MdFileStore({ rootDir });
const kb = new KbClient({ sqlite, md });

kb.createNote({
  path: 'calendar/2026-07-08',
  title: '2026-07-08 standup',
  type: 'meeting',
  status: 'active',
  tags: ['standup', 'team'],
  related: ['inbox/quick'],
  body: '# Standup\n\n- kickoff sprint 1.1\n- assign T-1.1.4 to worker δ\n- tomorrow: Sprint 1.2 prep\n',
});
kb.createNote({
  path: 'calendar/2026-07-08/standup',
  title: 'Sprint 1.1 standup notes',
  type: 'meeting',
  status: 'active',
  tags: ['standup', 'team'],
  body: '# Standup (detail)\n\nReviewed T-1.1.4 freeze contract.\n',
});
kb.createNote({
  path: 'inbox/quick',
  title: 'Quick thought',
  type: 'note',
  tags: ['idea'],
  body: 'random idea worth keeping',
});
kb.createNote({
  path: 'research/llm/rag',
  title: 'RAG research notes',
  type: 'reference',
  tags: ['llm', 'rag'],
  body: 'Sprint 1.3 will use this for KB → RAG retrieval.',
});
kb.addLink({
  from_path: 'calendar/2026-07-08/standup',
  to_path: 'inbox/quick',
  rel: 'related',
});
kb.addLink({
  from_path: 'research/llm/rag',
  to_path: 'inbox/quick',
  rel: 'cites',
});
kb.close();

// 2. Dump the live SQLite schema
const schemaDump = spawnSync('/usr/bin/sqlite3', [dbPath, '.schema'], {
  encoding: 'utf-8',
}).stdout;
fs.writeFileSync(path.join(tmpDir, 'schema.sql'), schemaDump, 'utf-8');

// 3. Sample one MD file with frontmatter
const sampleMdPath = path.join(rootDir, 'calendar/2026-07-08', 'standup.md');
const sampleMdContent = fs.readFileSync(sampleMdPath, 'utf-8');
fs.writeFileSync(path.join(tmpDir, 'sample.md'), sampleMdContent, 'utf-8');

// 4. Run perf sample (50 iterations, real measurement)
const sqlite2 = new SqliteStore({ dbPath });
const md2 = new MdFileStore({ rootDir });
const kb2 = new KbClient({ sqlite: sqlite2, md: md2 });
const perfRows = [];
const listSamples = [];
const filterSamples = [];
const searchSamples = [];
for (let i = 0; i < 50; i++) {
  const t0 = performance.now();
  kb2.listNotes({ limit: 100 });
  listSamples.push(performance.now() - t0);
  const t1 = performance.now();
  kb2.listNotes({ type: 'meeting', tags: ['team'], limit: 50 });
  filterSamples.push(performance.now() - t1);
  const t2 = performance.now();
  kb2.searchNotes('standup', { limit: 50 });
  searchSamples.push(performance.now() - t2);
  perfRows.push({ i, list: listSamples[i], filter: filterSamples[i], search: searchSamples[i] });
}
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const p = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * q)] ?? s[s.length - 1] ?? 0;
};
const listAvg = avg(listSamples);
const listP95 = p(listSamples, 0.95);
const filterAvg = avg(filterSamples);
const searchAvg = avg(searchSamples);
fs.writeFileSync(
  path.join(tmpDir, 'perf.json'),
  JSON.stringify({ listAvg, listP95, filterAvg, searchAvg, perfRows }, null, 2),
  'utf-8',
);
kb2.close();

console.log('[gen-shots] list avg=', listAvg.toFixed(3), 'p95=', listP95.toFixed(3));
console.log('[gen-shots] filter avg=', filterAvg.toFixed(3));
console.log('[gen-shots] search avg=', searchAvg.toFixed(3));
console.log('[gen-shots] fixtures in', tmpDir);