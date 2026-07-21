#!/usr/bin/env node
// Gateway Direct Fallback Smoke Test (Sprint4.1)
//
// Verifies that the new direct WebSocket fallback in
// `apps/server/src/connectors/gatewayDirectWebSocket.ts` is exported and
// well-typed, and that the categorization helpers behave correctly.
//
// This script does NOT require a live Gateway — it is a pure unit check
// that runs in <1s and ships as part of `npm run test:env` extension points.
// It can be run manually with:
//   node scripts/gateway-direct-fallback-smoke.mjs

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const distEntry = path.join(repoRoot, "apps", "server", "dist", "connectors", "gatewayDirectWebSocket.js");

if (!existsSync(distEntry)) {
  console.error(`gateway-direct-fallback-smoke: missing build artifact ${distEntry}.`);
  console.error("Run: npm run build --workspace @openclaw-workbench/server");
  process.exit(1);
}

const mod = await import(pathToFileURL(distEntry).href);

const required = [
  "gatewayCallDirectWebSocket",
  "shouldFallbackToDirectWebSocket",
  "directFallbackReason",
  "resolveGatewayWebSocketUrl",
];
for (const name of required) {
  assert.equal(typeof mod[name], "function", `expected ${name} to be a function`);
}

// 1) shouldFallbackToDirectWebSocket recognises device-auth errors.
assert.equal(mod.shouldFallbackToDirectWebSocket("EPERM: .../.openclaw/identity/device-auth.json"), true);
assert.equal(mod.shouldFallbackToDirectWebSocket("EACCES: device-auth-store not writable"), true);
assert.equal(mod.shouldFallbackToDirectWebSocket("Gateway protocol mismatch (expected 3)"), true);
assert.equal(mod.shouldFallbackToDirectWebSocket("OpenClaw Gateway CLI timed out after 3500ms while waiting for RPC response."), true);
assert.equal(mod.shouldFallbackToDirectWebSocket("OpenClaw Gateway CLI timed out after 540000ms while waiting for final agent output."), false);
assert.equal(mod.shouldFallbackToDirectWebSocket("Invalid JSON response from gateway"), false);
assert.equal(mod.shouldFallbackToDirectWebSocket("Service not installed"), false);
assert.equal(mod.shouldFallbackToDirectWebSocket(""), false);

// 2) directFallbackReason returns the right category.
assert.equal(mod.directFallbackReason("EPERM: device-auth.json"), "device_auth_unwritable");
assert.equal(mod.directFallbackReason("protocol mismatch (got 2)"), "protocol_mismatch");
assert.equal(mod.directFallbackReason("not a fallback trigger"), null);

// 3) resolveGatewayWebSocketUrl returns a ws:// URL.
const url = mod.resolveGatewayWebSocketUrl();
assert.match(String(url), /^wss?:\/\//, `expected ws(s):// URL, got ${url}`);

console.log(JSON.stringify({
  ok: true,
  exports: required,
  url,
  checks: {
    deviceAuth: true,
    protocolMismatch: true,
    negativeCases: true,
  },
}, null, 2));
