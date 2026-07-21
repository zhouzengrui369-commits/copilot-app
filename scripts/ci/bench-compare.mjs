#!/usr/bin/env node
// bench-compare.mjs — produce reports/bench/delta.json comparing the current
// baseline to benchmarks/baseline.previous.json. Read by nightly-bench.yml
// to surface regressions without auto-failing the run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..", "..");
const BASELINE = path.join(ROOT, "benchmarks", "baseline.json");
const PREVIOUS = path.join(ROOT, "benchmarks", "baseline.previous.json");
const REPORT_DIR = path.join(ROOT, "reports", "bench");

function exists(p) {
  try { fs.accessSync(p); return true; } catch (_) { return false; }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function valueKeyOf(metric) {
  if ("value_ms" in metric) return "value_ms";
  if ("value_mb" in metric) return "value_mb";
  if ("value_fps" in metric) return "value_fps";
  return null;
}

function pctDelta(a, b) {
  if (a === 0 && b === 0) return 0;
  if (a === 0) return Infinity;
  return ((b - a) / a) * 100;
}

function verdictFor(id, deltaPct, current, target) {
  // Lower is better for ms/MB; higher is better for FPS.
  const betterHigh = id === "metric_004_kg_render";
  if (betterHigh) {
    if (deltaPct <= 0) return "improved";
    if (deltaPct < 10) return "stable";
    return "regressed";
  }
  if (deltaPct >= 0) return "improved";
  if (deltaPct > -10) return "stable";
  return "regressed";
}

function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  if (!exists(PREVIOUS)) {
    console.log("::notice::no previous baseline yet — first run");
    writeJson(path.join(REPORT_DIR, "delta.json"), { first_run: true });
    return;
  }

  const cur = readJson(BASELINE);
  const prev = readJson(PREVIOUS);
  const deltas = {};

  for (const id of Object.keys(cur.metrics)) {
    const a = prev.metrics?.[id];
    const b = cur.metrics[id];
    if (!a || !b) continue;
    const key = valueKeyOf(b);
    if (!key || typeof a[key] !== "number" || typeof b[key] !== "number") continue;
    const targetKey = key.replace("value_", "target_");
    const target = b[targetKey];
    const deltaPct = pctDelta(a[key], b[key]);
    deltas[id] = {
      label: b.label,
      previous: a[key],
      current: b[key],
      delta_pct: Number.isFinite(deltaPct) ? Number(deltaPct.toFixed(2)) : null,
      verdict: verdictFor(id, deltaPct, b[key], target),
      target,
    };
  }

  const summary = {
    captured_at: new Date().toISOString(),
    deltas,
  };
  writeJson(path.join(REPORT_DIR, "delta.json"), summary);

  let regressions = 0;
  for (const d of Object.values(summary.deltas)) {
    const arrow = d.delta_pct === null ? "n/a" : `${d.delta_pct > 0 ? "+" : ""}${d.delta_pct}%`;
    console.log(`  ${d.verdict.padEnd(9)}  ${arrow.padEnd(8)}  ${d.previous} -> ${d.current}  (target ${d.target})`);
    if (d.verdict === "regressed") regressions++;
  }
  console.log(`bench-compare: ${Object.keys(deltas).length} metric(s), ${regressions} regression(s)`);
}

main();
