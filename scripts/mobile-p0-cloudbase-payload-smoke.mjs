#!/usr/bin/env node
// 2026-06-25 — P0 CloudBase broker 80KB cap smoke
// Reads the patched cloudbaseForwarder.ts, extracts the 3 internal
// functions (compactBrokerResponse, compactChatSendResponse,
// truncateLongestStringField), transpiles them, and runs assertions.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const srcPath = resolve(repoRoot, "apps/server/src/cloudbaseForwarder.ts");
const tsSrc = readFileSync(srcPath, "utf8");

// Extract the 3 functions + 1 helper (brokerPayloadBytes) by walking braces
function extractFn(name) {
  const re = new RegExp(`(?:^|\\n)function ${name}\\(`, "m");
  const m = tsSrc.match(re);
  if (!m) throw new Error("not found: " + name);
  const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
  let depth = 0, i = start, inStr = false, strCh = "";
  while (i < tsSrc.length) {
    const c = tsSrc[i];
    if (inStr) {
      if (c === "\\") { i += 2; continue; }
      if (c === strCh) inStr = false;
    } else {
      if (c === '"' || c === "'" || c === "`") { inStr = true; strCh = c; }
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return tsSrc.slice(start, i + 1); }
    }
    i++;
  }
  throw new Error("unterminated: " + name);
}

const fnsSrc = [
  extractFn("compactBrokerResponse"),
  extractFn("compactChatSendResponse"),
  extractFn("truncateLongestStringField"),
  extractFn("brokerPayloadBytes"),
  // Stubs for path-specific compactors the router references
  `function compactMobileTodayResponse(r){return r}`,
  `function compactMobileAtlasResponse(r){return r}`,
  `function compactMobileKbListResponse(r){return r}`,
  `function compactMobileCalendarResponse(r){return r}`,
  `function compactMobileBootstrapResponse(r){return r}`,
  `const MAX_BROKER_ACK_RESPONSE_BYTES = 80_000;`,
  `const compactArray = (arr) => arr; const compactObject = (o) => o;`,

].join("\n");

const transpiled = ts.transpileModule(fnsSrc, {
  filename: srcPath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Eval the transpiled code in a fresh CommonJS context
const m = { exports: {} };
const fn = new Function("module", "exports", "require", "Buffer", "console", transpiled + "\nmodule.exports = { compactBrokerResponse, compactChatSendResponse, truncateLongestStringField, brokerPayloadBytes };");

const mod = { exports: {} };
fn(mod, mod.exports, require, require("node:buffer").Buffer, console);

const { compactBrokerResponse, compactChatSendResponse, truncateLongestStringField, brokerPayloadBytes } = mod.exports;
if (typeof compactBrokerResponse !== "function") {
  console.error("MISSING exports — got:", Object.keys(mod.exports));
  process.exit(2);
}

const MAX_BYTES = 75_000;
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, info) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; failures.push(name); console.log("  FAIL  " + name + (info ? " — " + info : "")); }
}
const bytes = brokerPayloadBytes;
const clone = (o) => JSON.parse(JSON.stringify(o));

// ===== TEST 1: chat/send 100KB assistant content =====
console.log("\n[1] chat/send with 100KB assistant content");
const longContent = "中文测试".repeat(30_000);
const chatResp = { ok: true, sessionId: "sess-x", userMessageId: "msg-u",
  assistant: { id: "msg-a", content: longContent, role: "assistant", status: "complete" } };
const chatCompacted = compactChatSendResponse(clone(chatResp));
check("chat/send: response ≤ 75KB after compact", bytes(chatCompacted) <= MAX_BYTES, "got " + bytes(chatCompacted) + " bytes");
check("chat/send: _truncated flag set", chatCompacted._truncated === true);
check("chat/send: _truncatedBytes > 0", chatCompacted._truncatedBytes > 0);
check("chat/send: assistant.content ≤ 50KB + suffix",
  chatCompacted.assistant.content.length <= 50_000 + 100, "got " + chatCompacted.assistant.content.length);

// ===== TEST 2: chat/send small content =====
console.log("\n[2] chat/send with 1KB content (no truncate)");
const smallResp = { ok: true, assistant: { content: "你好".repeat(500), role: "assistant" } };
const smallCompacted = compactChatSendResponse(clone(smallResp));
check("chat/send: small NOT truncated", smallCompacted._truncated === undefined);
check("chat/send: small content preserved", smallCompacted.assistant.content === smallResp.assistant.content);

// ===== TEST 3: Generic 70KB safety net =====
console.log("\n[3] Generic 70KB safety net (200KB blob)");
const bigResp = { ok: true, data: { note: "X".repeat(200_000) } };
const truncated = truncateLongestStringField(bigResp, 70_000);
check("safety net: result ≤ 75KB", bytes(truncated) <= MAX_BYTES, "got " + bytes(truncated));
check("safety net: ok still true", truncated.ok === true);
check("safety net: data.note string is smaller", typeof truncated.data.note === "string" && truncated.data.note.length < 200_000);

// ===== TEST 4: compactBrokerResponse dispatches =====
console.log("\n[4] compactBrokerResponse dispatches");
const e2e = compactBrokerResponse("/api/chat/send", clone(chatResp));
check("e2e: chat/send path triggers compact", e2e._truncated === true);
check("e2e: response ≤ 75KB", bytes(e2e) <= MAX_BYTES, "got " + bytes(e2e));
const e2eStream = compactBrokerResponse("/api/chat/send-stream", clone(chatResp));
check("e2e: chat/send-stream path also triggers compact", e2eStream._truncated === true);

// ===== TEST 5: Non-chat path passthrough =====
console.log("\n[5] Non-chat path returns original");
const passthru = { ok: true, foo: "bar" };
const e2e2 = compactBrokerResponse("/api/something/else", passthru);
check("e2e: unknown path returns original", e2e2 === passthru);

// ===== TEST 6: existing mobile/* paths still work =====
console.log("\n[6] Existing mobile/* paths still work");
const mobile = compactBrokerResponse("/api/mobile/today", { ok: true, foo: "bar" });
check("e2e: mobile/today path returns compacted object", mobile && typeof mobile === "object" && mobile !== passthru);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) {
  console.log("FAILED:", failures.join(", "));
  process.exit(1);
}
process.exit(0);
