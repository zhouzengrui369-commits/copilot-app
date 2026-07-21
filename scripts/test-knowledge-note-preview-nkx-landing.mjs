// 2026-07-07 (rework9 preview-fix) — Verify /api/knowledge/preview can
// resolve the new njx-knowledge v2 landing path. Before fix:
//   previewKnowledgeFile('/Users/njx/njx-knowledge/...') returns
//   { ok: false, error: 'file_not_found' } because safeResolve only
//   allowed WORKSPACE_DIR / SIDECAR_DIR / NAS roots.
// After fix:
//   safeResolve includes NJX_KNOWLEDGE_NOTES_ROOT so file resolves.
//
// Note: for .html files, `content` is empty by design — the renderer
// streams the file via /api/knowledge/file. The critical check is
// `ok === true` and `error === undefined`.
import { previewKnowledgeFile } from "/Users/njx/Applications/njx-copilot.app/Contents/Resources/resources/server/workbenchV11.js";

const realPath = "/Users/njx/njx-knowledge/knowledge/notes/calendar/2026-07/20260707_午间咖啡杂谈.html";
const result = previewKnowledgeFile(realPath);

console.log("=== previewKnowledgeFile (post rework9 preview-fix) ===");
console.log("path:    ", realPath);
console.log("ok:      ", result.ok);
console.log("error:   ", result.error || "(none)");
console.log("title:   ", result.title || "(none)");
console.log("size:    ", result.size || "(none)");

// Cross-verify by reading the HTML file directly and counting LLM markers
import { readFileSync } from "node:fs";
const rawHtml = readFileSync(realPath, "utf8");
console.log("\nraw file on disk:");
console.log("size:                ", rawHtml.length, "bytes");
console.log("has <!doctype html>: ", rawHtml.includes("<!doctype html>") ? "✓" : "✗");
console.log("has '让我做 PPT':     ", rawHtml.includes("让我做 PPT") ? "✓" : "✗");
console.log("has '我他妈':         ", rawHtml.includes("我他妈") ? "✓" : "✗");
console.log("has '大脑 reset':     ", rawHtml.includes("大脑 reset") ? "✓" : "✗");

const ok = result.ok === true
    && result.error === undefined
    && rawHtml.includes("<!doctype html>")
    && rawHtml.includes("让我做 PPT")
    && rawHtml.includes("我他妈");
process.exit(ok ? 0 : 1);

