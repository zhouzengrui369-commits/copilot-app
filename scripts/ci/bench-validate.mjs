#!/usr/bin/env node
// bench-validate.mjs — make sure benchmarks/baseline.json satisfies schema.json.
//
// Run by both ci.yml and nightly-bench.yml after bench-collect.mjs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..", "..");
const SCHEMA_PATH = path.join(ROOT, "benchmarks", "schema.json");
const BASELINE_PATH = path.join(ROOT, "benchmarks", "baseline.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch (_) { return false; }
}

if (!exists(SCHEMA_PATH)) {
  console.error(`benchmarks/schema.json not found at ${SCHEMA_PATH}`);
  process.exit(1);
}
if (!exists(BASELINE_PATH)) {
  console.error(`benchmarks/baseline.json not found at ${BASELINE_PATH}`);
  process.exit(1);
}

const schema = readJson(SCHEMA_PATH);
const baseline = readJson(BASELINE_PATH);

const errors = [];

// Top-level shape.
for (const key of ["schema_version", "captured_at", "metrics"]) {
  if (!(key in baseline)) errors.push(`baseline.${key} is required`);
}

if (!baseline.metrics || typeof baseline.metrics !== "object") {
  errors.push("baseline.metrics must be an object");
}

// Each declared metric must exist and carry the right value/target pair.
for (const m of schema.metrics) {
  const entry = baseline.metrics?.[m.id];
  if (!entry) {
    errors.push(`missing metric: ${m.id}`);
    continue;
  }
  if (entry.label !== m.label) {
    errors.push(`${m.id}.label must equal "${m.label}" (got "${entry.label}")`);
  }
  // Value key
  const valueKey = m.value_ms !== undefined ? "value_ms"
                 : m.value_mb !== undefined ? "value_mb"
                 : m.value_fps !== undefined ? "value_fps" : null;
  if (!valueKey) {
    errors.push(`${m.id}: schema metric must define value_ms|value_mb|value_fps`);
    continue;
  }
  if (typeof entry[valueKey] !== "number") {
    errors.push(`${m.id}.${valueKey} must be a number (got ${typeof entry[valueKey]})`);
  }
  // Target key
  const targetKey = m.target_ms !== undefined ? "target_ms"
                  : m.target_mb !== undefined ? "target_mb"
                  : m.target_fps !== undefined ? "target_fps" : null;
  if (!targetKey) {
    errors.push(`${m.id}: schema metric must define target_*`);
    continue;
  }
  if (typeof entry[targetKey] !== "number") {
    errors.push(`${m.id}.${targetKey} must be a number`);
  }
}

// Extra metrics in baseline that aren't in schema are tolerated but warned.
for (const id of Object.keys(baseline.metrics || {})) {
  if (!schema.metrics.find((m) => m.id === id)) {
    console.log(`::notice::baseline has extra metric '${id}' not in schema — tolerated`);
  }
}

if (errors.length) {
  console.error("bench-validate FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

console.log("bench-validate OK: baseline satisfies schema (version", schema.version + ")");
