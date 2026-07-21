#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WORKBENCH_ENVIRONMENTS,
  buildServerEnv,
  requireAllowedOperation,
} from "./env-config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const envName = process.argv[2] || "dev";

if (!WORKBENCH_ENVIRONMENTS[envName]) {
  console.error(`Unknown environment "${envName}". Expected dev, staging, or prod.`);
  process.exit(1);
}

try {
  requireAllowedOperation("env-start", envName, process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const serverEntry = path.join(repoRoot, "apps", "server", "dist", "index.js");
if (!fs.existsSync(serverEntry)) {
  console.error("Server build is missing. Run: npm run build --workspace @openclaw-workbench/server");
  process.exit(1);
}

const nextEnv = buildServerEnv(envName, process.env, { repoRoot });
for (const key of Object.keys(nextEnv)) {
  process.env[key] = nextEnv[key];
}

fs.mkdirSync(process.env.OPENCLAW_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OPENCLAW_WORKSPACE, { recursive: true });

console.log([
  `OpenClaw Workbench ${envName}`,
  `url=http://${process.env.OPENCLAW_WORKBENCH_HOST}:${process.env.OPENCLAW_WORKBENCH_PORT}`,
  `data=${process.env.OPENCLAW_DATA_DIR}`,
  `workspace=${process.env.OPENCLAW_WORKSPACE}`,
].join("\n"));

await import(serverEntry);
