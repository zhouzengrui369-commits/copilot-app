import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KbClient } from '../src/api/crud.js';
import { SqliteStore } from '../src/store/sqlite-store.js';
import { MdFileStore } from '../src/store/md-file-store.js';

const NOTE_COUNT = 100;
const P95_TARGET_MS = 80;
const AVG_TARGET_MS = 50;

describe('KB perf — 100 notes query < 50ms (plan.md §2.1 T-1.1.4)', () => {
  let kb: KbClient;
  let cleanup: () => void;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-perf-'));
    const sqlite = new SqliteStore({ dbPath: path.join(dir, 'kb.sqlite') });
    const md = new MdFileStore({ rootDir: path.join(dir, 'notes') });
    kb = new KbClient({ sqlite, md });
    cleanup = () => {
      kb.close();
      fs.rmSync(dir, { recursive: true, force: true });
    };

    // Seed NOTE_COUNT notes with varied paths + tags.
    for (let i = 0; i < NOTE_COUNT; i++) {
      const folder = i % 5 === 0 ? 'inbox' : 'calendar/2026-07-08';
      kb.createNote({
        path: `${folder}/n${i}`,
        title: `note ${i}`,
        type: i % 3 === 0 ? 'todo' : 'note',
        status: i % 2 === 0 ? 'active' : 'draft',
        tags: i % 4 === 0 ? ['urgent', 'team'] : ['team'],
        body: `body for note ${i}`,
      });
    }
  });
  afterEach(() => cleanup());

  it('listNotes (no filter) avg < 50ms, P95 < 80ms', () => {
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      const out = kb.listNotes({ limit: 100 });
      const dt = performance.now() - t0;
      samples.push(dt);
      expect(out.total).toBeGreaterThanOrEqual(NOTE_COUNT);
    }
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[perf] list avg=${avg.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
    expect(avg).toBeLessThan(AVG_TARGET_MS);
    expect(p95).toBeLessThan(P95_TARGET_MS);
  });

  it('listNotes (filtered) avg < 50ms', () => {
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      const out = kb.listNotes({
        type: 'todo',
        status: 'active',
        tags: ['urgent'],
        limit: 50,
      });
      samples.push(performance.now() - t0);
      expect(out.items.length).toBeGreaterThan(0);
    }
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    // eslint-disable-next-line no-console
    console.log(`[perf] filtered avg=${avg.toFixed(2)}ms`);
    expect(avg).toBeLessThan(AVG_TARGET_MS);
  });

  it('searchNotes avg < 50ms', () => {
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      kb.searchNotes('note', { limit: 50 });
      samples.push(performance.now() - t0);
    }
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    // eslint-disable-next-line no-console
    console.log(`[perf] search avg=${avg.toFixed(2)}ms`);
    expect(avg).toBeLessThan(AVG_TARGET_MS);
  });
});