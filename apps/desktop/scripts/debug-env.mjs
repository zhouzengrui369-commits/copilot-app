#!/usr/bin/env node
// Debug helper: print all env vars to /tmp/env-debug.txt, then exit.
import fs from "node:fs";
const out = Object.entries(process.env)
  .filter(([k]) => k.startsWith("OPENCLAW") || k === "PATH")
  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
  .join("\n");
fs.writeFileSync("/tmp/env-debug.txt", out + "\n");
process.exit(0);