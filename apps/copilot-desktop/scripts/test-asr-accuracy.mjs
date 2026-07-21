#!/usr/bin/env node
/**
 * test-asr-accuracy.mjs — CLI probe for the zh-CN ASR accuracy bar
 * (PM discipline #6: ≥ 0.9 combined / web / cloud).
 *
 * Usage:
 *   node scripts/test-asr-accuracy.mjs \
 *     --samples tests/fixtures/asr-samples-zh.json \
 *     --min-accuracy 0.9
 *
 * Exit 0 when the bar is met, 1 otherwise. Used by PM's verify
 * command (`scripts/test-asr-accuracy.mjs ...`).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function longestCommonSubsequence(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  const prev = new Array(n + 1).fill(0);
  const cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      cur[j] =
        a[i - 1] === b[j - 1]
          ? (prev[j - 1] ?? 0) + 1
          : Math.max(prev[j] ?? 0, cur[j - 1] ?? 0);
    }
    for (let j = 0; j <= n; j++) {
      prev[j] = cur[j] ?? 0;
      cur[j] = 0;
    }
  }
  return prev[n] ?? 0;
}

function characterAccuracy(expected, actual) {
  const norm = (s) => s.replace(/\s+/g, '').normalize('NFKC').toLowerCase();
  const e = norm(expected);
  const a = norm(actual);
  if (!e) return a ? 0 : 1;
  if (!a) return 0;
  const lcs = longestCommonSubsequence(e, a);
  const precision = lcs / a.length;
  const recall = lcs / e.length;
  if (precision + recall === 0) return 0;
  const f1 = (2 * precision * recall) / (precision + recall);
  return Math.max(0, Math.min(1, f1));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      args[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const samplesPath = args.samples ?? 'tests/fixtures/asr-samples-zh.json';
  const minAccuracy = Number(args['min-accuracy'] ?? '0.9');

  const abs = path.isAbsolute(samplesPath)
    ? samplesPath
    : path.resolve(process.cwd(), samplesPath);
  const raw = await readFile(abs, 'utf8');
  const data = JSON.parse(raw);

  if (!data || !Array.isArray(data.samples)) {
    console.error('FAIL: samples file does not contain a "samples" array');
    process.exit(2);
  }

  let webSum = 0;
  let cloudSum = 0;
  let n = data.samples.length;
  const rows = [];

  for (const s of data.samples) {
    const w = characterAccuracy(s.expected, s.web);
    const c = characterAccuracy(s.expected, s.cloud);
    webSum += w;
    cloudSum += c;
    rows.push({ id: s.id, web: w, cloud: c });
  }

  const webAvg = webSum / n;
  const cloudAvg = cloudSum / n;
  const combined = (webSum + cloudSum) / (n * 2);

  console.log(`samples: ${n}`);
  console.log(`min-accuracy: ${minAccuracy.toFixed(4)}`);
  console.log(`web avg:    ${webAvg.toFixed(4)}`);
  console.log(`cloud avg:  ${cloudAvg.toFixed(4)}`);
  console.log(`combined:   ${combined.toFixed(4)}`);

  const passWeb = webAvg >= minAccuracy;
  const passCloud = cloudAvg >= minAccuracy;
  const passCombined = combined >= minAccuracy;
  const ok = passWeb && passCloud && passCombined;

  console.log('');
  console.log(`web:      ${passWeb ? 'PASS' : 'FAIL'}`);
  console.log(`cloud:    ${passCloud ? 'PASS' : 'FAIL'}`);
  console.log(`combined: ${passCombined ? 'PASS' : 'FAIL'}`);
  console.log('');
  console.log(`VERDICT: ${ok ? 'PASS' : 'FAIL'}`);

  if (!ok) {
    console.error('\nFailing samples:');
    for (const r of rows) {
      if (r.web < minAccuracy || r.cloud < minAccuracy) {
        console.error(`  - ${r.id}: web=${r.web.toFixed(4)} cloud=${r.cloud.toFixed(4)}`);
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('test-asr-accuracy: unexpected error', err);
  process.exit(2);
});