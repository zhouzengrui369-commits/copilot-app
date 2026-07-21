#!/usr/bin/env node
/**
 * ttl-cleanup-verify: confirm a cron task has been auto-removed after its TTL.
 * Pure read of `mavis cron list` + grep. No side effects on the data plane.
 * Outputs ONE line: {"verdict":"GONE|STILL_PRESENT|ERROR", "cronName":..., "ts":...}
 */
import { spawnSync } from "node:child_process";

const cronName = process.argv[2];
if (!cronName) {
 console.error("usage: node ttl-cleanup-verify.mjs <cron-name>");
 process.exit(2);
}

const ts = new Date().toISOString();
const out = spawnSync("mavis", ["cron", "list", "coder"], { encoding: "utf-8" });

if (out.status !== 0) {
 console.log(JSON.stringify({ verdict: "ERROR", cronName, ts, stderr: out.stderr.slice(0, 200) }));
 process.exit(1);
}

const present = out.stdout.includes(`"cronName": "${cronName}"`);
console.log(JSON.stringify({
 verdict: present ? "STILL_PRESENT" : "GONE",
 cronName,
 ts,
}));
process.exit(present ? 0 : 0);
