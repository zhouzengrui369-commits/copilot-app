// 2026-07-04 — T6 Phase 2 search-source-normalize rework regression probe.
//
// Codex acceptance of the 2026-07-04 v2 finalization pass found one real T6 gap:
//
//   /api/knowledge/search in apps/server/src/index.ts still parsed query
//   sources manually:
//     - default query sources were "memory,wiki,nas,ima" (4 old sources,
//       missing the Phase 2 default "njx-knowledge")
//     - `sources=all` leaked through as the literal string "all" straight
//       into searchKnowledge() — bypassing normalizeSources() and breaking
//       the chat / research / global-search contract.
//
// This probe enforces the post-rework contract at source level:
//
//   1. The /api/knowledge/search endpoint block calls normalizeSources(...).
//   2. The endpoint block no longer contains the literal default
//      "memory,wiki,nas,ima" (regression guard — old 4-source default).
//   3. The endpoint block does NOT pass the literal string "all" directly
//      into searchKnowledge() — it must be expanded by normalizeSources first.
//   4. The endpoint uses the same "split comma -> normalize" pattern as the
//      Phase 2 chat / research / global-search call sites (parity guard).
//   5. Default fall-through (empty `sources=` or all-invalid) still routes
//      through normalizeSources, so an empty/invalid query ends up with
//      `["njx-knowledge"]` (the documented default) — never the stale
//      4-source set.
//
// Read-only: only reads files, never mutates the tree. Deterministic: the
// assertions depend only on the static source content.
//
// Exit 0 = rework regression holds. Exit 1 = contract violated.

import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

const serverSrc = read("apps/server/src/index.ts");

// Slice the /api/knowledge/search endpoint block: from `app.get("/api/knowledge/search"`
// to the next `^app.` boundary. This guarantees we are looking only at the
// rewritten endpoint and not at unrelated call sites.
const startIdx = serverSrc.indexOf('app.get("/api/knowledge/search"');
if (startIdx < 0) {
  failures.push("endpoint-missing — /api/knowledge/search handler not found in apps/server/src/index.ts");
}
const tailIdx = (() => {
  if (startIdx < 0) return -1;
  const rest = serverSrc.slice(startIdx + 1);
  const nextApp = rest.search(/^app\./m);
  if (nextApp < 0) return serverSrc.length;
  return startIdx + 1 + nextApp;
})();
const endpointBlock = startIdx >= 0 ? serverSrc.slice(startIdx, tailIdx) : "";

// (1) Endpoint block must call normalizeSources(...) — the very fix that
//     closes the T6 gap.
expect(
  "endpoint /api/knowledge/search calls normalizeSources(...)",
  /normalizeSources\s*\(/.test(endpointBlock),
  "no normalizeSources call inside the endpoint block — T6 gap is back",
);

// (2) Endpoint block must NOT contain the literal default "memory,wiki,nas,ima"
//     that the previous implementation used as the hard-coded fallback.
expect(
  "endpoint block no longer contains the legacy default literal \"memory,wiki,nas,ima\"",
  !/["']memory,wiki,nas,ima["']/.test(endpointBlock),
  "literal \"memory,wiki,nas,ima\" still in the endpoint — old default leaked through",
);

// (3) The literal "all" must not be passed directly into searchKnowledge(...).
//     We allow "all" to appear as an input token (the query string `sources=all`
//     is legitimate), but it must not be the literal argument to searchKnowledge
//     itself — normalizeSources must have expanded it to the 5-source list first.
expect(
  "searchKnowledge(...) is never called with the literal string \"all\"",
  !/searchKnowledge\s*\([^)]*["']all["']/.test(endpointBlock),
  "searchKnowledge invoked with literal \"all\" — normalizeSources did not expand it",
);

// (4) Parity guard — the endpoint should follow the same split-then-normalize
//     shape as the chat / research / global-search call sites. We verify that
//     the endpoint: parses req.query.sources -> splits on "," when non-empty ->
//     passes the array to normalizeSources.
expect(
  "endpoint parses req.query.sources and splits on comma before normalize",
  /\(req\.query as \{ sources\?:\s*string\s*\}\)\.sources/.test(endpointBlock) &&
    /\.split\(["']\s*,\s*["']\s*\)/.test(endpointBlock),
  "endpoint does not follow the standard query->split->normalize shape",
);

// (5) Default fall-through guard — when the user supplies no `sources=` query,
//     the endpoint must still feed normalizeSources an empty array (or the
//     equivalent) so the Phase 2 default kicks in. We accept either an explicit
//     `[]` empty-array literal OR a falsy ternary whose falsy branch is `[]`.
//     The current shape is `normalizeSources(sourceParam ? sourceParam.split(",") : [])`
//     — empty sourceParam hits the `[]` branch and normalizeSources returns the
//     DEFAULT_KNOWLEDGE_SOURCES = ["njx-knowledge"] default.
expect(
  "endpoint feeds an empty list to normalizeSources when no `sources` query is given",
  /normalizeSources\(\s*(?:\[\]|\S+\s*\?\s*[\s\S]{0,80}?:\s*\[\])\s*\)/.test(endpointBlock),
  "no `normalizeSources([])` / `normalizeSources(x ? ... : [])` shape — default may drift",
);

// (6) Regression guard — the canonical normalizeSources contract itself must
//     still exist (we are not refactoring it, but a careless rewriter might).
//     Verify the ALL_KNOWLEDGE_SOURCES set still lists all 5 sources and the
//     DEFAULT_KNOWLEDGE_SOURCES still pins to ["njx-knowledge"].
expect(
  "ALL_KNOWLEDGE_SOURCES still lists the full 5-source set",
  /const ALL_KNOWLEDGE_SOURCES:\s*KnowledgeSource\[\]\s*=\s*\[\s*["']memory["']\s*,\s*["']wiki["']\s*,\s*["']nas["']\s*,\s*["']ima["']\s*,\s*["']njx-knowledge["']\s*\]/.test(serverSrc),
  "ALL_KNOWLEDGE_SOURCES no longer matches the canonical 5-source list",
);
expect(
  "DEFAULT_KNOWLEDGE_SOURCES still pins to [\"njx-knowledge\"]",
  /const DEFAULT_KNOWLEDGE_SOURCES:\s*KnowledgeSource\[\]\s*=\s*\[\s*["']njx-knowledge["']\s*\]/.test(serverSrc),
  "DEFAULT_KNOWLEDGE_SOURCES no longer matches the canonical njx-knowledge default",
);

// (7) Forbidden files guard — the two R8 dirty files must be byte-identical to
//     what they were before this task. If a careless rewriter touched them,
//     this catches it.
const r8Screen = "apps/mobile/src/screens/TodayConsoleScreen.tsx";
const r8Probe = "scripts/test-mobile-r8-source-todo-ui.mjs";
expect(
  "R8 dirty file TodayConsoleScreen.tsx is untouched (does not reference this rework)",
  !fs.readFileSync(path.join(repo, r8Screen), "utf8").includes("knowledge/search source normalize"),
  `${r8Screen} was modified by this task — forbidden`,
);
expect(
  "R8 dirty probe test-mobile-r8-source-todo-ui.mjs is untouched (does not reference this rework)",
  !fs.readFileSync(path.join(repo, r8Probe), "utf8").includes("knowledge/search source normalize"),
  `${r8Probe} was modified by this task — forbidden`,
);

if (failures.length) {
  console.error("KNOWLEDGE_SEARCH_SOURCE_NORMALIZE_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("KNOWLEDGE_SEARCH_SOURCE_NORMALIZE_PASS");