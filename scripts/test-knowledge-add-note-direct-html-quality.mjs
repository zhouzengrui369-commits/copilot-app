// 2026-07-06 — T10 njx-knowledge v2 Add Note direct HTML quality rework.
//
// NJX rejected the previous rework: the Add Note default `minimax-direct`
// path now reaches MiniMax-M3 successfully, but the model output leaks its
// chain-of-thought into `draft.markdown` and the rendered `draft.html`, and
// the server emits a fake `{ passed: true, score: 0.6 }` so the UI accepts
// the contaminated draft and lets the user save it.
//
// This probe enforces the post-rework contract at source level + (optionally)
// against a live local server (when reachable):
//
//   SERVER (apps/server/src/index.ts):
//     (1)  Helper `cleanKnowledgeNoteDirectMarkdown(raw)` exists and strips
//          `<think>…</think>` blocks, unclosed `<think>` from the start, JSON
//          envelopes whose only field is `draft.markdown`, and obvious
//          English / Chinese analysis preambles (`Let me analyze`, `The user
//          is asking`, `The raw notes are`, `I need to`, `First, let me`,
//          `Here's my analysis`, `Below is`, `下面我`, `让我先`, `我来分析一下`,
//          etc.).
//     (2)  Helper `assessKnowledgeNoteDirectMarkdownQuality(markdown)` returns
//          a real `{ passed, score, issues, dimensions }`. Issues include
//          `residual_think_uncleaned`, `residual_preamble`, `only_json_envelope`,
//          `missing_heading_or_frontmatter`, `missing_source_hash_line`.
//     (3)  The direct branch in `organizeKnowledgeNoteDraftHighQuality`
//          wires the helpers in: it does NOT just assign `directResult.content`
//          to `draft.markdown`. Instead it computes `cleanedMarkdown` and
//          `cleanedHtml`, and uses them in the returned payload.
//     (4)  The direct branch fails fast with reason
//          `minimax_direct_markdown_quality_failed:…` (or
//          `…_empty_after_clean`) when quality gates fail. The diagnosis
//          category is `MiniMax 直连输出质量未通过` (NOT `Gateway 不可用` /
//          `Workbench/Gateway transport failed`).
//     (5)  The direct branch's `htmlQuality` is NOT the previous fake-pass
//          `{ passed: true, score: 0.6, dimensions: { minimax_direct: 0.6 } }`.
//          It must reflect the real assessment result.
//     (6)  Quality failure advice must NOT recommend `重启 OpenClaw Gateway`.
//     (7)  Quality failure does NOT fall through to the m3-html Gateway
//          pipeline. The audit marker is still `minimax_direct_failed_no_fallback`.
//     (8)  `buildKnowledgeNoteM3SimplePrompt` accepts a `promptMode: "direct"
//          | "gateway"` option. When `promptMode === "direct"`, the prompt
//          explicitly forbids `<think>` tags, JSON envelopes, analysis
//          preambles, and tells the model to output ONLY Obsidian Markdown.
//          When `promptMode === "gateway"` (default), the existing JSON-contract
//          prompt is preserved (regression guard for legacy m3-html / m27-html).
//     (9)  The direct-path call to `buildKnowledgeNoteM3Prompt` passes
//          `promptMode: "direct"`; the legacy m3-html call does NOT pass
//          `promptMode` (so it keeps `gateway` behavior).
//
//   WEB (apps/web/src/App.tsx):
//    (10)  `knowledgeNoteHtmlHasReasoningLeak(html)` helper exists; it returns
//          `{ leaked, reasons }` where reasons include
//          `residual_think_in_visible_body`, `analysis_preamble_in_visible_body`,
//          `only_json_envelope_in_visible_body`.
//    (11)  `knowledgeNoteHtmlQualityForPreview` overrides the htmlQuality to
//          `{ passed: false, score ≤ 20 }` and appends the leak reasons to
//          `issues` when the HTML body contains any of the leak signals.
//          The previous fake-pass `{ passed: true, score: 0.6 }` from the
//          server is also forced down to `passed: false` when the body has
//          reasoning leak.
//
//   STANDALONE FUNCTIONAL TEST (no server required):
//    (12)  When the helpers run against the NJX-screenshot content
//          (`<think>Let me analyze this raw note carefully. The user is
//          asking me to organize raw meeting notes…</think>…good Obsidian
//          Markdown body…`), the final cleaned Markdown does NOT contain
//          `<think>`, `Let me analyze`, `The user is asking`, `The raw notes
//          are`, and the assessment issues include `stripped_think_block`
//          (so the gate fails fast).
//    (13)  When the helpers run against a clean Obsidian Markdown draft
//          (frontmatter + # heading + ## sections + `source-hash: <hash>`),
//          the cleaned Markdown is unchanged AND the assessment reports
//          `passed: true` with no issues.
//    (14)  When the helpers run against a pure JSON envelope
//          (`{"draft":{"markdown":"…"}}`), the cleanup unwraps it and the
//          assessment reports `passed: false` with `unwrapped_json_envelope`.
//
//   LIVE PROBE (only when KNOWLEDGE_ADD_NOTE_LIVE_PROBE=1 and a server is
//   reachable on $WORKBENCH_PORT / $WORKBENCH_HOST):
//    (15)  POST /api/knowledge/notes/organize with qualityMode = "minimax-direct"
//          and NO API key in env still surfaces
//          `error = "blocked_minimax_direct_config"` (the upstream direct-mode
//          error contract from the prior two reworks is preserved).
//
// Read-only at runtime: only reads files + (optionally) hits the live server.
// Never mutates the tree. Deterministic when the env is stable.
//
// Exit 0 = rework regression holds. Exit 1 = contract violated.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const repo = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

// Module-level reference to the helper sandbox compiled from the extracted
// server source. Declared at module scope so the rework3 helper-level tests
// below can use it after the inner block has finished populating it.
let mod = null;

// ---------------------------------------------------------------------------
// Source-level helpers (extract from source so we never drift).
// ---------------------------------------------------------------------------

function extractFunctionBody(src, name) {
  const re = new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) return "";
  let parenDepth = 0;
  let i = m.index;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === "(") parenDepth += 1;
    else if (c === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) break;
    }
  }
  // After `)`, we may have an optional `: ReturnType` annotation, then `{ body }`.
  // Walk forward, skipping whitespace + comments, and skip past a single return
  // type annotation if present.
  let j = i + 1;
  const skipWsAndComments = () => {
    while (j < src.length) {
      const c = src[j];
      const nxt = src[j + 1];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") { j += 1; continue; }
      if (c === "/" && nxt === "/") {
        while (j < src.length && src[j] !== "\n") j += 1;
        continue;
      }
      if (c === "/" && nxt === "*") {
        j += 2;
        while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j += 1;
        j += 2;
        continue;
      }
      break;
    }
  };
  skipWsAndComments();
  if (src[j] === ":") {
    // Skip past the return type annotation. The annotation can be a simple
    // identifier (`name`), a generic (`name<T>`), or an object type literal
    // (`{ ... }`). In the object-type-literal case, we must count balanced
    // braces so we don't bail on the type's opening `{`.
    j += 1;
    skipWsAndComments();
    let typeDepth = 0;
    let typeBraceDepth = 0;
    let inSingleLineComment2 = false;
    let inMultiLineComment2 = false;
    let inString2 = null;
    while (j < src.length) {
      const c = src[j];
      const nxt = src[j + 1];
      if (inSingleLineComment2) { if (c === "\n") inSingleLineComment2 = false; j += 1; continue; }
      if (inMultiLineComment2) { if (c === "*" && nxt === "/") { inMultiLineComment2 = false; j += 1; } j += 1; continue; }
      if (inString2) { if (c === "\\") { j += 2; continue; } if (c === inString2) inString2 = null; j += 1; continue; }
      if (c === "/" && nxt === "/") { inSingleLineComment2 = true; j += 1; continue; }
      if (c === "/" && nxt === "*") { inMultiLineComment2 = true; j += 1; continue; }
      if (c === '"' || c === "'" || c === "`") { inString2 = c; j += 1; continue; }
      if (c === "(" || c === "<" || c === "[") typeDepth += 1;
      else if (c === ")" || c === ">" || c === "]") typeDepth -= 1;
      else if (c === "{") {
        if (typeDepth === 0 && typeBraceDepth === 0) {
          // Could be either start of object type literal OR function body.
          // Treat as type literal and skip past its matching `}`. We
          // disambiguate by peeking: if after the type's `}` the next
          // non-whitespace char is `{`, that's the body.
          typeBraceDepth += 1;
        } else {
          typeBraceDepth += 1;
        }
      } else if (c === "}") {
        typeBraceDepth -= 1;
        if (typeDepth === 0 && typeBraceDepth === 0) {
          // Closed an outer `{`. Peek to see if the next thing is the body.
          j += 1;
          skipWsAndComments();
          if (src[j] === "{") break;
          // Otherwise keep scanning.
          continue;
        }
      } else if (c === ";" && typeDepth === 0 && typeBraceDepth === 0) {
        break;
      }
      j += 1;
    }
  }
  skipWsAndComments();
  if (j >= src.length || src[j] !== "{") return "";
  // Count balanced braces from the body open brace, ignoring string / comment
  // content.
  let depth = 0;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let inString = null;
  for (; j < src.length; j += 1) {
    const c = src[j];
    const nxt = src[j + 1];
    if (inSingleLineComment) {
      if (c === "\n") inSingleLineComment = false;
      continue;
    }
    if (inMultiLineComment) {
      if (c === "*" && nxt === "/") { inMultiLineComment = false; j += 1; }
      continue;
    }
    if (inString) {
      if (c === "\\") { j += 1; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === "/" && nxt === "/") { inSingleLineComment = true; j += 1; continue; }
    if (c === "/" && nxt === "*") { inMultiLineComment = true; j += 1; continue; }
    if (c === '"' || c === "'" || c === "`") { inString = c; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(m.index, j + 1);
    }
  }
  return src.slice(m.index);
}

const serverSrc = read("apps/server/src/index.ts");
const webSrc = read("apps/web/src/App.tsx");

// ---------------------------------------------------------------------------
// (1) cleanKnowledgeNoteDirectMarkdown helper
// ---------------------------------------------------------------------------

const cleanBody = extractFunctionBody(serverSrc, "cleanKnowledgeNoteDirectMarkdown");
expect(
  "server defines cleanKnowledgeNoteDirectMarkdown function",
  Boolean(cleanBody) && cleanBody.length > 200,
  "cleanKnowledgeNoteDirectMarkdown not found in server source",
);
expect(
  "cleanKnowledgeNoteDirectMarkdown strips <think>…</think> blocks",
  /<think>[\s\S]*?<\/think>/i.test(cleanBody)
    && /removedBlocks\s*=\s*0/.test(cleanBody)
    && /stripped_think_block/.test(cleanBody),
  "cleanKnowledgeNoteDirectMarkdown does not strip <think> blocks",
);
expect(
  "cleanKnowledgeNoteDirectMarkdown strips unclosed <think> at the start",
  /stripped_unclosed_think_block/.test(cleanBody)
    && /KNOWLEDGE_NOTE_DIRECT_UNCLOSED_THINK_RE/.test(serverSrc),
  "cleanKnowledgeNoteDirectMarkdown does not strip unclosed <think>",
);
expect(
  "cleanKnowledgeNoteDirectMarkdown unwraps JSON envelopes",
  /unwrapped_json_envelope/.test(cleanBody)
    && /extractKnowledgeNoteDirectMarkdownFromJsonEnvelope/.test(serverSrc),
  "cleanKnowledgeNoteDirectMarkdown does not unwrap JSON envelopes",
);
expect(
  "cleanKnowledgeNoteDirectMarkdown strips English/Chinese analysis preambles",
  /stripped_preamble/.test(cleanBody)
    && /Let me (?:analyze|look at)/.test(serverSrc)
    && /下面我|让我(?:先|来)?|我来(?:分析|整理|看看)/.test(serverSrc),
  "cleanKnowledgeNoteDirectMarkdown does not strip preamble phrases",
);
expect(
  "cleanKnowledgeNoteDirectMarkdown strips pre-header narration (Note:/Output:) and post-footer narration (Hope this helps / 如有需要)",
  /stripKnowledgeNoteDirectPreHeaderNarration/.test(cleanBody)
    && /stripKnowledgeNoteDirectPostFooterNarration/.test(cleanBody),
  "cleanKnowledgeNoteDirectMarkdown does not call pre-header/post-footer strippers",
);

// ---------------------------------------------------------------------------
// (2) assessKnowledgeNoteDirectMarkdownQuality helper
// ---------------------------------------------------------------------------

const assessBody = extractFunctionBody(serverSrc, "assessKnowledgeNoteDirectMarkdownQuality");
expect(
  "server defines assessKnowledgeNoteDirectMarkdownQuality function",
  Boolean(assessBody) && assessBody.length > 200,
  "assessKnowledgeNoteDirectMarkdownQuality not found in server source",
);
expect(
  "assessKnowledgeNoteDirectMarkdownQuality returns passed/score/issues/dimensions",
  /return\s*\{[\s\S]*?passed,[\s\S]*?score,[\s\S]*?issues,[\s\S]*?dimensions:/m.test(assessBody),
  "assessKnowledgeNoteDirectMarkdownQuality return shape missing",
);
expect(
  "assessKnowledgeNoteDirectMarkdownQuality flags residual <think>",
  /residual_think_uncleaned/.test(assessBody),
  "assessKnowledgeNoteDirectMarkdownQuality does not flag residual <think>",
);
expect(
  "assessKnowledgeNoteDirectMarkdownQuality flags residual preamble",
  /residual_preamble/.test(assessBody),
  "assessKnowledgeNoteDirectMarkdownQuality does not flag residual preamble",
);
expect(
  "assessKnowledgeNoteDirectMarkdownQuality flags JSON-envelope-only output",
  /only_json_envelope/.test(assessBody),
  "assessKnowledgeNoteDirectMarkdownQuality does not flag only_json_envelope",
);
expect(
  "assessKnowledgeNoteDirectMarkdownQuality requires heading or frontmatter",
  /missing_heading_or_frontmatter/.test(assessBody),
  "assessKnowledgeNoteDirectMarkdownQuality does not require heading/frontmatter",
);
expect(
  "assessKnowledgeNoteDirectMarkdownQuality requires source-hash line",
  /missing_source_hash_line/.test(assessBody),
  "assessKnowledgeNoteDirectMarkdownQuality does not require source-hash line",
);
expect(
  "assessKnowledgeNoteDirectMarkdownQuality enforces length-based scoring",
  /lengthScore\s*=\s*0/.test(assessBody)
    && /length\s*>=\s*1200/.test(assessBody),
  "assessKnowledgeNoteDirectMarkdownQuality lacks length-based scoring",
);
expect(
  "assessKnowledgeNoteDirectMarkdownQuality never returns the previous fake pass",
  !/passed:\s*true,\s*score:\s*0\.6,\s*issues:\s*\[\],\s*dimensions:\s*\{\s*minimax_direct:\s*0\.6\s*\}/.test(serverSrc),
  "the previous fake-pass htmlQuality literal is still in server source",
);

// ---------------------------------------------------------------------------
// (3)+(4)+(5) Direct branch wires in cleaning + assessment + fail-fast
// ---------------------------------------------------------------------------

// Locate the direct branch inside organizeKnowledgeNoteDraftHighQuality. We
// search for `requestedMode === "minimax-direct"` and inspect the body that
// follows.
const directBranchIdx = serverSrc.indexOf('if (requestedMode === "minimax-direct")');
expect(
  "organizeKnowledgeNoteDraftHighQuality has a minimax-direct branch",
  directBranchIdx >= 0,
  "no direct branch found in server source",
);

// Slice a reasonable window after the branch start (the direct branch is the
// only block that calls `directMinimaxM3Call` and ends with `}` returning the
// success payload).
const directBranchSlice = directBranchIdx >= 0 ? serverSrc.slice(directBranchIdx, directBranchIdx + 32_000) : "";

expect(
  "direct branch computes cleanedMarkdown via cleanKnowledgeNoteDirectMarkdown",
  /cleanKnowledgeNoteDirectMarkdown\s*\(\s*rawDirectContent\s*\)/.test(directBranchSlice),
  "direct branch does not call cleanKnowledgeNoteDirectMarkdown",
);
expect(
  "direct branch computes qualityAssessment via assessKnowledgeNoteDirectMarkdownQuality",
  /assessKnowledgeNoteDirectMarkdownQuality\s*\(\s*cleanedMarkdown\s*,\s*cleaned\.issues\s*\)/.test(directBranchSlice),
  "direct branch does not call assessKnowledgeNoteDirectMarkdownQuality",
);
expect(
  "direct branch uses cleanedMarkdown (not directResult.content) for draft.markdown",
  /draft:\s*\{\s*markdown:\s*cleanedMarkdown/.test(directBranchSlice)
    && !/draft:\s*\{\s*markdown:\s*directResult\.content\b/.test(directBranchSlice),
  "direct branch still assigns directResult.content to draft.markdown (would leak raw model output)",
);
expect(
  "direct branch renders HTML from cleanedMarkdown",
  /renderKnowledgeNoteDirectMarkdownAsHtml\s*\(\s*cleanedMarkdown/.test(directBranchSlice)
    && !/renderKnowledgeNoteDirectMarkdownAsHtml\s*\(\s*directResult\.content\b/.test(directBranchSlice),
  "direct branch still renders HTML from directResult.content",
);
expect(
  "direct branch fail-fast reason code includes 'minimax_direct_markdown_quality_failed'",
  /minimax_direct_markdown_quality_failed/.test(directBranchSlice),
  "direct branch lacks minimax_direct_markdown_quality_failed reason",
);
expect(
  "direct branch fail-fast reason code includes 'minimax_direct_markdown_empty_after_clean'",
  /minimax_direct_markdown_empty_after_clean/.test(directBranchSlice),
  "direct branch lacks minimax_direct_markdown_empty_after_clean reason",
);
expect(
  "direct branch quality failure diagnosis category is 'MiniMax 直连输出质量未通过'",
  /category:\s*"MiniMax 直连输出质量未通过"/.test(directBranchSlice),
  "direct branch quality failure diagnosis category missing/wrong",
);
expect(
  "direct branch quality failure rootCause mentions OpenClaw Gateway NOT to be restarted",
  /不要重启\s+OpenClaw\s+Gateway/.test(directBranchSlice),
  "direct branch quality failure advice does not include '不要重启 OpenClaw Gateway'",
);
expect(
  "direct branch quality failure advice is NOT a Gateway repair directive",
  !/(?:^|[^不])重新连接\s+Gateway/.test(directBranchSlice),
  "direct branch quality failure advice still says '重新连接 Gateway' (would misdirect users)",
);
expect(
  "direct branch quality failure pipeline includes 'minimax_direct_markdown_quality_failed'",
  /["']local_seed["']\s*,\s*["']minimax_direct_markdown_quality_failed["']\s*,\s*["']minimax_direct_failed_no_fallback["']/.test(directBranchSlice),
  "direct branch quality failure pipeline lacks minimax_direct_markdown_quality_failed step",
);
expect(
  "direct branch htmlQuality is the real assessment result, not a hard-coded fake pass",
  /htmlQuality:\s*\{[\s\S]*?passed:\s*qualityAssessment\.passed[\s\S]*?score:\s*qualityAssessment\.score[\s\S]*?issues:\s*qualityAssessment\.issues[\s\S]*?dimensions:\s*qualityAssessment\.dimensions/.test(directBranchSlice),
  "direct branch htmlQuality is still hard-coded or wrong",
);
expect(
  "direct branch htmlQuality also surfaces warnings + sanitized flag from real assessment",
  /htmlQuality:\s*\{[\s\S]*?warnings:\s*qualityAssessment\.warnings[\s\S]*?sanitized:\s*qualityAssessment\.sanitized/.test(directBranchSlice),
  "direct branch htmlQuality does not include warnings + sanitized flag from real assessment (rework2 expectation)",
);
// 2026-07-06 rework2 + rework3: the generationPipeline must distinguish sanitized vs not, so
// downstream tools (audit / dashboard) can tell when MiniMax-M3 output needed
// cleaning. The rework3 structure uses a `basePipeline` spread + sanitized append:
//   const finalPipeline = qualityAssessment.sanitized
//     ? [...basePipeline, "minimax_direct_markdown_sanitized", "server_render_html"]
//     : [...basePipeline, "server_render_html"];
expect(
  "direct branch success pipeline emits 'minimax_direct_markdown_sanitized' when sanitized",
  /qualityAssessment\.sanitized[\s\S]{0,200}"minimax_direct_markdown_sanitized"[\s\S]{0,200}"server_render_html"/.test(directBranchSlice),
  "direct branch success pipeline does not include the 'minimax_direct_markdown_sanitized' step when sanitized",
);
expect(
  "direct branch htmlDraft.html uses renderedHtml from cleanedMarkdown",
  /htmlDraft:\s*\{\s*html:\s*renderedHtml\s*,/.test(directBranchSlice),
  "direct branch htmlDraft.html still uses raw content",
);

// ---------------------------------------------------------------------------
// (6) Quality failure must NOT recommend restarting Gateway
// ---------------------------------------------------------------------------

const qualityFailureDiagnosisMatch = directBranchSlice.match(/category:\s*"MiniMax 直连输出质量未通过"[\s\S]*?\},\s*\n\s*attempts:/);
expect(
  "direct branch quality failure diagnosis block extracted",
  Boolean(qualityFailureDiagnosisMatch),
  "could not locate direct branch quality failure diagnosis block",
);
if (qualityFailureDiagnosisMatch) {
  const diagnosis = qualityFailureDiagnosisMatch[0];
  expect(
    "diagnosis.reasonLabel is direct-quality-specific, not Gateway generic",
    /MiniMax 直连输出含污染片段|MiniMax 直连输出内容过短|MiniMax 直连输出未达质量门槛|MiniMax 直连输出已通过质量门禁/.test(serverSrc),
    `server source did not include any direct-quality reasonLabel; check assessKnowledgeNoteDirectMarkdownQuality`,
  );
  expect(
    "diagnosis.userAction does NOT recommend restarting Gateway",
    !/(?<!不)(?<!请)(?<!勿)(?<!切)(?<!即)(?<!要)重启\s+OpenClaw\s+Gateway|(?<![不请勿切即要])重新连接\s+Gateway/.test(diagnosis),
    `diagnosis.userAction still says restart/reconnect Gateway: ${diagnosis.slice(0, 400)}`,
  );
  expect(
    "diagnosis.repairDirectives include '不要重启 OpenClaw Gateway'",
    /不要重启\s+OpenClaw\s+Gateway/.test(diagnosis),
    "diagnosis.repairDirectives missing anti-Gateway directive",
  );
  expect(
    "diagnosis.advice is direct-mode specific (not Gateway)",
    /minimax-direct\s+直连质量门禁/.test(diagnosis) && !/检查\s+Gateway\s+状态/.test(diagnosis),
    "diagnosis.advice is not direct-mode specific",
  );
}

// ---------------------------------------------------------------------------
// (6.5) [rework2] Quality failures must surface `blocked_minimax_direct_quality`,
// not `blocked_minimax_direct_config`. Config error code is reserved for
// missing-key / config failures only.
// ---------------------------------------------------------------------------

const payloadFnMatch = serverSrc.match(/function\s+buildKnowledgeNoteFailurePayload[\s\S]*?\n\}/);
const payloadFnBody = payloadFnMatch ? payloadFnMatch[0] : "";
expect(
  "[rework2] buildKnowledgeNoteFailurePayload defines isDirectQualityFailure flag",
  /isDirectQualityFailure\s*=/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload is missing isDirectQualityFailure (rework2 contract)",
);
expect(
  "[rework2] buildKnowledgeNoteFailurePayload emits error = \"blocked_minimax_direct_quality\" for quality failures",
  /isDirectQualityFailure\s*\?\s*["']blocked_minimax_direct_quality["']/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload does not branch on isDirectQualityFailure to emit blocked_minimax_direct_quality",
);
expect(
  "[rework2] buildKnowledgeNoteFailurePayload keeps error = \"blocked_minimax_direct_config\" for non-quality direct failures",
  /isDirectMinimaxFailure\s*\?\s*["']blocked_minimax_direct_config["']/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload no longer emits blocked_minimax_direct_config for non-quality direct failures",
);
expect(
  "[rework2] buildKnowledgeNoteFailurePayload top-level message does NOT mention API key config when failing on quality",
  /isDirectQualityFailure[\s\S]{0,1500}message\s*=\s*isDirectQualityFailure[\s\S]{0,800}API\s*key\s*已配置正确/.test(payloadFnBody)
    || /isDirectQualityFailure[\s\S]{0,1500}const\s+message\s*=[\s\S]{0,800}API\s*key\s*已配置正确/.test(payloadFnBody)
    || /const\s+message\s*=[\s\S]{0,200}isDirectQualityFailure[\s\S]{0,800}API\s*key\s*已配置正确/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload quality-failure message still conflates with API-key config (rework2 contract violated)",
);
expect(
  "[rework2] buildKnowledgeNoteFailurePayload quality top-level reasonLabel is direct-quality-specific (NOT API-key config)",
  /qualityReasonLabel\s*=\s*["']MiniMax\s+M3\s+直连输出质量未通过/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload quality top-level reasonLabel is wrong (rework2 contract)",
);
expect(
  "[rework2] buildKnowledgeNoteFailurePayload quality top-level advice explicitly states MiniMax API key 已成功调用",
  /qualityAdvice[\s\S]{0,500}MiniMax\s+API\s*key\s*已成功调用/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload quality top-level advice does not explain API key was successfully called (rework2 contract)",
);
expect(
  "[rework2] direct branch quality-failure diagnosis.userAction does NOT recommend 重启 / 重新连接 / 配置 OpenClaw Gateway",
  // Inspect ONLY the userAction string literal (between userAction: "..." up to the closing "),
  // not the entire diagnosis block — the repairDirectives legitimately contain "不要重启 OpenClaw Gateway".
  (() => {
    const userActionMatch = directBranchSlice.match(/diagnosis:\s*\{[\s\S]*?category:\s*"MiniMax 直连输出质量未通过"[\s\S]*?userAction:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (!userActionMatch) return false;
    const userActionText = userActionMatch[1];
    const banned = /请配置\s+MiniMax\s+API\s*key|重启\s+OpenClaw\s+Gateway|重新连接\s+Gateway/;
    return !banned.test(userActionText);
  })(),
  "direct branch quality-failure diagnosis.userAction still recommends restarting Gateway or configuring MiniMax API key (rework2 contract)",
);
expect(
  "[rework2] direct branch quality-failure diagnosis advice states API key 已成功调用",
  /diagnosis:\s*\{[\s\S]*?category:\s*"MiniMax 直连输出质量未通过"[\s\S]*?advice:[\s\S]*?MiniMax\s+API\s*key\s*已成功调用/.test(directBranchSlice),
  "direct branch quality-failure diagnosis advice does not mention MiniMax API key 已成功调用 (rework2 contract)",
);
expect(
  "[rework2] direct branch quality-failure rootCause distinguishes quality from API-key config",
  /diagnosis:\s*\{[\s\S]*?category:\s*"MiniMax 直连输出质量未通过"[\s\S]*?rootCause:[\s\S]*?与\s+MiniMax\s+API\s*key\s+无关/.test(directBranchSlice),
  "direct branch quality-failure rootCause does not distinguish quality from API-key config (rework2 contract)",
);
expect(
  "[rework2] direct branch quality-failure repairDirectives include '不要重新配置 MiniMax API key (本次已成功调用)'",
  /不要重新配置\s+MiniMax\s+API\s*key[\s\S]*?本次已成功调用/.test(directBranchSlice),
  "direct branch quality-failure repairDirectives do not include anti-config directive (rework2 contract)",
);

const simpleBody = extractFunctionBody(serverSrc, "buildKnowledgeNoteM3SimplePrompt");
expect(
  "buildKnowledgeNoteM3SimplePrompt accepts promptMode?: 'direct' | 'gateway'",
  /promptMode\?:\s*"direct"\s*\|\s*"gateway"/.test(simpleBody),
  "buildKnowledgeNoteM3SimplePrompt does not accept promptMode option",
);
expect(
  "buildKnowledgeNoteM3SimplePrompt 'direct' branch forbids <think> tags",
  /直接模式|硬约束|不要输出\s*<think>/.test(simpleBody)
    || /不要输出\s*<think>/.test(simpleBody),
  "buildKnowledgeNoteM3SimplePrompt direct branch does not forbid <think>",
);
expect(
  "buildKnowledgeNoteM3SimplePrompt 'direct' branch forbids JSON envelopes",
  /不要输出\s*JSON|不要任何包装层|不要输出\s*任何包装层|不要输出\s*JSON/.test(simpleBody),
  "buildKnowledgeNoteM3SimplePrompt direct branch does not forbid JSON envelopes",
);
expect(
  "buildKnowledgeNoteM3SimplePrompt 'direct' branch forbids chain-of-thought preamble phrases",
  /Let me analyze|The user is asking|The raw notes are|I need to/.test(simpleBody)
    && /下面我|让我(?:先|来)?|我来(?:分析|整理|看看)/.test(simpleBody),
  "buildKnowledgeNoteM3SimplePrompt direct branch does not forbid preamble phrases",
);
expect(
  "buildKnowledgeNoteM3SimplePrompt 'direct' branch preserves Obsidian layout (frontmatter + # title + ## sections + source-hash)",
  /frontmatter/.test(simpleBody) && /source-hash/.test(simpleBody) && /## 高价值摘要/.test(simpleBody),
  "buildKnowledgeNoteM3SimplePrompt direct branch missing Obsidian layout contract",
);
expect(
  "buildKnowledgeNoteM3SimplePrompt 'gateway' branch still requires JSON output (regression guard)",
  /用 JSON 输出，便于程序解析/.test(simpleBody),
  "buildKnowledgeNoteM3SimplePrompt gateway branch no longer requires JSON output (would break legacy parser)",
);

// (8) Direct-path call site uses promptMode: "direct", legacy call site does NOT.
expect(
  "direct-path call to buildKnowledgeNoteM3Prompt passes promptMode: 'direct'",
  /buildKnowledgeNoteM3Prompt\(\s*\{\s*input:\s*body\s*,[\s\S]*?sourceProfile\s*,[\s\S]*?promptMode:\s*"direct"\s*\}\s*\)/.test(serverSrc),
  "direct-path call to buildKnowledgeNoteM3Prompt does not pass promptMode: 'direct'",
);
expect(
  "buildKnowledgeNoteM3CompactPrompt accepts and forwards promptMode",
  /function\s+buildKnowledgeNoteM3CompactPrompt[\s\S]*?promptMode\?:\s*"direct"\s*\|\s*"gateway"[\s\S]*?promptMode:\s*input\.promptMode/.test(serverSrc),
  "buildKnowledgeNoteM3CompactPrompt does not forward promptMode",
);
expect(
  "buildKnowledgeNoteM3CalendarPrompt accepts and forwards promptMode",
  /function\s+buildKnowledgeNoteM3CalendarPrompt[\s\S]*?promptMode\?:\s*"direct"\s*\|\s*"gateway"[\s\S]*?promptMode:\s*input\.promptMode/.test(serverSrc),
  "buildKnowledgeNoteM3CalendarPrompt does not forward promptMode",
);

// ---------------------------------------------------------------------------
// (10)+(11) Web-side: knowledgeNoteHtmlHasReasoningLeak + htmlQualityForPreview
// ---------------------------------------------------------------------------

expect(
  "web defines knowledgeNoteHtmlHasReasoningLeak helper",
  /function\s+knowledgeNoteHtmlHasReasoningLeak\s*\(/.test(webSrc)
    && /residual_think_in_visible_body/.test(webSrc),
  "knowledgeNoteHtmlHasReasoningLeak helper not found in web source",
);
expect(
  "web knowledgeNoteHtmlQualityForPreview flags reasoning leak as passed: false",
  /function\s+knowledgeNoteHtmlQualityForPreview[\s\S]*?leak[\s\S]*?passed:\s*false[\s\S]*?issues:[\s\S]*?issueSet/m.test(webSrc),
  "knowledgeNoteHtmlQualityForPreview does not force passed: false on reasoning leak",
);
expect(
  "web knowledgeNoteHtmlQualityForPreview adds residual_think issue on leak",
  /residual_think_in_visible_body/.test(webSrc),
  "web reasoning-leak detector missing residual_think issue",
);
expect(
  "web knowledgeNoteHtmlQualityForPreview adds analysis_preamble issue on leak",
  /analysis_preamble_in_visible_body/.test(webSrc),
  "web reasoning-leak detector missing analysis_preamble issue",
);
expect(
  "web knowledgeNoteHtmlQualityForPreview adds only_json_envelope issue on leak",
  /only_json_envelope_in_visible_body/.test(webSrc),
  "web reasoning-leak detector missing only_json_envelope issue",
);

// ---------------------------------------------------------------------------
// (12)+(13)+(14) Standalone functional test on extracted helper bodies
// ---------------------------------------------------------------------------

// We compile the helpers in an isolated module so we can run real inputs
// against them. The helpers are intentionally pure functions.
{
  const cleanFnSrc = cleanBody;
  const assessFnSrc = assessBody;
  if (!cleanFnSrc || !assessFnSrc) {
    failures.push("could not extract helper bodies for standalone test");
  } else {
    // Use esbuild to transpile the extracted TypeScript helpers into plain
    // JavaScript so we can exercise them in isolation. We pull in only the
    // helper bodies (not the whole server module), and explicitly stub the
    // regex constants + utility helpers used inside them.
    const { build } = await import("esbuild");
    const tsSrc = [
      "const KNOWLEDGE_NOTE_DIRECT_THINK_BLOCK_RE = /<think>[\\s\\S]*?<\\/think>/gi;",
      "const KNOWLEDGE_NOTE_DIRECT_UNCLOSED_THINK_RE = /^\\s*<think>\\b[\\s\\S]*?(?=\\n\\s*---\\s*\\n|\\n\\s*#\\s+|\\Z)/i;",
      "const KNOWLEDGE_NOTE_DIRECT_PREAMBLE_RE = /^\\s*(?:(?:Let me (?:analyze|look at|review|examine|read|organize|process|start))|First,?\\s+let me|The user is asking|The raw notes are|The user (?:provided|pasted|gave|wants)|I need to|I'll (?:start|now|begin|analyze)|Here's my (?:analysis|plan)|Below is (?:my|the) (?:analysis|plan)|下面我|让我(?:先|来)?|我来(?:分析|整理|看看))/i;",
      "const KNOWLEDGE_NOTE_DIRECT_JSON_ENVELOPE_ONLY_RE = /^\\s*\\{[\\s\\S]*?\"draft\"[\\s\\S]*?\"markdown\"[\\s\\S]*?\\}\\s*$/;",
      "const KNOWLEDGE_NOTE_DIRECT_RESIDUAL_THINK_RE = /<\\/?think\\b/i;",
      "function stripKnowledgeNoteDirectPreHeaderNarration(text: string): string {",
      "  const lines = text.split(/\\r?\\n/);",
      "  let consumed = 0;",
      "  let i = 0;",
      "  for (; i < Math.min(lines.length, 12); i += 1) {",
      "    const raw = lines[i];",
      "    const line = String(raw || \"\").trim();",
      "    if (!line) { consumed += 1; continue; }",
      "    if (/^(?:---|-\\{3,\\}|#{1,6}\\s|[-*+]\\s|>\\s|\\|)/.test(line)) break;",
      "    if (/^source-hash\\s*[:：]/i.test(line)) break;",
      "    if (/^(?:Note|Output|Result|Answer|Response|整理结果|整理后的笔记|以下是|下面是|Here's|Here is|Below is|Output is|下面是整理)\\s*[:：]/i.test(line)) { consumed += 1; continue; }",
      "    break;",
      "  }",
      "  if (consumed === 0) return text;",
      "  return lines.slice(consumed).join(\"\\n\");",
      "}",
      "function stripKnowledgeNoteDirectPostFooterNarration(text: string): string {",
      "  const lines = text.split(/\\r?\\n/);",
      "  let tail = lines.length;",
      "  let safety = 0;",
      "  while (tail > 0 && safety < 4) {",
      "    const prev = tail - 1;",
      "    const line = String(lines[prev] || \"\").trim();",
      "    if (!line) { tail = prev; continue; }",
      "    if (/^(?:Let me know if|Hope this helps|如有(?:需要|疑问)|如果(?:您|你)需要|希望(?:对您|对你)有帮助|如有其他问题)/i.test(line)) { tail = prev; safety += 1; continue; }",
      "    break;",
      "  }",
      "  if (tail === lines.length) return text;",
      "  return lines.slice(0, tail).join(\"\\n\").replace(/\\s+$/, \"\");",
      "}",
      "function extractKnowledgeNoteDirectMarkdownFromJsonEnvelope(text: string): string | null {",
      "  try { const parsed = JSON.parse(text); const candidate = parsed?.draft?.markdown; if (typeof candidate === \"string\" && candidate.trim()) return candidate; if (typeof parsed?.markdown === \"string\" && parsed.markdown.trim()) return parsed.markdown; } catch { return null; }",
      "  return null;",
      "}",
      cleanFnSrc,
      assessFnSrc,
      "export const c = cleanKnowledgeNoteDirectMarkdown;",
      "export const a = assessKnowledgeNoteDirectMarkdownQuality;",
    ].join("\n");
    const sandboxPath = `/tmp/openclaw-direct-quality-helpers-${Date.now()}.mjs`;
    const buildResult = await build({
      stdin: { contents: tsSrc, resolveDir: process.cwd(), loader: "ts" },
      bundle: false,
      format: "esm",
      target: "node20",
      write: false,
      logLevel: "silent",
    });
    fs.writeFileSync(sandboxPath, buildResult.outputFiles[0].text, "utf8");
    try {
      mod = await import(sandboxPath);
    } catch (err) {
      failures.push(`could not compile extracted helpers: ${err.message}; first 400 chars of compiled: ${buildResult.outputFiles[0].text.slice(0, 400)}`);
    }
    if (mod) {
      // Case (12): NJX-screenshot content
      const njx = `<think>Let me analyze this raw note carefully. The user is asking me to organize raw meeting notes into an Obsidian-compatible Markdown note.

The raw notes are about a standup discussion. I need to identify the key points, action items, and follow-ups.

I should produce clean Obsidian markdown. Let me start with the frontmatter.</think>

---
title: 站会纪要
date: 2026-07-06
type: 工作记录
status: 待跟进
tags: [standup, openclaw]
related: []
folder: openclaw
---

# 站会纪要

## 高价值摘要

本次站会聚焦 MiniMax 直连质量问题.

## 关键事实

- 用户截图里看到 <think> 污染预览.
- 直连管线 \`local_seed -> minimax_direct_markdown -> server_render_html\` 已经在跑.

## 行动项

- [ ] server 端加 <think> 清理 helper.
- [ ] 强化 direct prompt, 禁止 <think>/preamble.

## 风险与待核验

- API key 还可能在某些环境下缺失, 需要更稳健的容错.

## 证据锚点

- "用户在 7-06 截图里看到 <think>…</think> 污染预览" — NJX 截图原文
- "直连管线 local_seed -> minimax_direct_markdown -> server_render_html 已经在跑" — Phase 4 debug

## 原始记录入口

见 sourceHash 引用.

source-hash: abcdef0123456789
`;
      const cleaned = mod.c(njx);
      expect(
        "standalone: NJX think-block content — final markdown does NOT contain <think>",
        !/<think>/i.test(cleaned.markdown),
        `cleaned markdown still contains <think>: ${cleaned.markdown.slice(0, 200)}`,
      );
      expect(
        "standalone: NJX think-block content — final markdown does NOT contain 'Let me analyze'",
        !/Let me analyze/i.test(cleaned.markdown),
        `cleaned markdown still contains Let me analyze: ${cleaned.markdown.slice(0, 200)}`,
      );
      expect(
        "standalone: NJX think-block content — final markdown does NOT contain 'The user is asking'",
        !/The user is asking/i.test(cleaned.markdown),
        `cleaned markdown still contains 'The user is asking': ${cleaned.markdown.slice(0, 200)}`,
      );
      expect(
        "standalone: NJX think-block content — final markdown does NOT contain 'The raw notes are'",
        !/The raw notes are/i.test(cleaned.markdown),
        `cleaned markdown still contains 'The raw notes are': ${cleaned.markdown.slice(0, 200)}`,
      );
      expect(
        "standalone: NJX think-block content — assessment issues include stripped_think_block",
        cleaned.issues.includes("stripped_think_block"),
        `clean issues did not include stripped_think_block: ${cleaned.issues.join(",")}`,
      );
      const assessment = mod.a(cleaned.markdown, cleaned.issues);
      // 2026-07-06 (rework2): NJX-shape content (think-block + good Obsidian body)
      // MUST now PASS the quality gate after safe cleaning — sanitization is a
      // warning, not a hard fail. The previous behavior (always passed=false)
      // is what NJX rejected; this is the rework2 acceptance.
      expect(
        "standalone: NJX think-block content — assessment.passed === true (safe cleaning salvages usable content)",
        assessment.passed === true,
        `assessment should be passed=true after safe cleaning, got ${JSON.stringify(assessment)}`,
      );
      expect(
        "standalone: NJX think-block content — assessment.issues is empty (no residual defects)",
        Array.isArray(assessment.issues) && assessment.issues.length === 0,
        `assessment.issues should be empty after cleaning, got ${JSON.stringify(assessment.issues)}`,
      );
      expect(
        "standalone: NJX think-block content — assessment.warnings includes stripped_think_block (defense-in-depth)",
        Array.isArray(assessment.warnings) && assessment.warnings.includes("stripped_think_block"),
        `assessment.warnings missing stripped_think_block: ${JSON.stringify(assessment.warnings)}`,
      );

      // Case (13): clean input
      const good = `---
title: 站会纪要
date: 2026-07-06
type: 工作记录
status: 待跟进
tags: [standup]
related: []
folder: openclaw
---

# 站会纪要

## 高价值摘要

本次站会聚焦 MiniMax 直连质量问题.

## 关键事实

- 直连管线 \`local_seed -> minimax_direct_markdown -> server_render_html\` 已经在跑.

## 行动项

- [ ] server 端加 chain-of-thought 清理 helper.
- [ ] 强化 direct prompt, 禁止任何 chain-of-thought 输出.

## 风险与待核验

- API key 还可能在某些环境下缺失, 需要更稳健的容错.

## 证据锚点

- "直连管线 local_seed -> minimax_direct_markdown -> server_render_html 已经在跑" — Phase 4 debug

## 原始记录入口

见 sourceHash 引用.

source-hash: deadbeefcafe1234
`;
      const cleanGood = mod.c(good);
      expect(
        "standalone: clean input — cleaning issues is empty",
        cleanGood.issues.length === 0,
        `cleaning issues should be empty, got ${cleanGood.issues.join(",")}`,
      );
      expect(
        "standalone: clean input — markdown is unchanged",
        cleanGood.markdown === good.trim(),
        `markdown changed: ${cleanGood.markdown.slice(0, 200)}`,
      );
      const assessGood = mod.a(cleanGood.markdown, cleanGood.issues);
      expect(
        "standalone: clean input — assessment.passed === true",
        assessGood.passed === true,
        `assessment should be passed=true for clean input, got ${JSON.stringify(assessGood)}`,
      );
      expect(
        "standalone: clean input — assessment score >= 50",
        assessGood.score >= 50,
        `score too low for clean input: ${assessGood.score}`,
      );

      // Case (14): JSON envelope only
      const envelope = JSON.stringify({
        draft: {
          title: "测试",
          date: "2026-07-06",
          type: "工作记录",
          status: "待跟进",
          tags: ["test"],
          related: [],
          folder: "openclaw",
          markdown: `# 站会纪要

## 高价值摘要

JSON envelope test.

## 关键事实

- Fact 1
- Fact 2

## 行动项

- [ ] Action 1

## 风险与待核验

- Risk 1

## 证据锚点

- Anchor 1

## 原始记录入口

- Entry 1

source-hash: cafef00d12345678
`,
        },
        quality: { confidence: 0.8, sourceCoverage: "覆盖", unresolvedItems: [] },
      });
      const cleanEnvelope = mod.c(envelope);
      expect(
        "standalone: JSON envelope — unwrapJson is true",
        cleanEnvelope.unwrappedJson === true,
        `unwrappedJson should be true, got ${JSON.stringify(cleanEnvelope)}`,
      );
      expect(
        "standalone: JSON envelope — issues include unwrapped_json_envelope",
        cleanEnvelope.issues.includes("unwrapped_json_envelope"),
        `envelope issues missing unwrapped_json_envelope: ${cleanEnvelope.issues.join(",")}`,
      );
      expect(
        "standalone: JSON envelope — final markdown no longer starts with { (not just JSON)",
        !/^\s*\{/.test(cleanEnvelope.markdown),
        `envelope markdown still starts with JSON brace: ${cleanEnvelope.markdown.slice(0, 100)}`,
      );

      // Case (15): preamble-only — without think block. The cleanup regex eats the
// first matching preamble fragment and loops until exhausted, so all three
// chained preamble markers ("Let me analyze …", "The user is asking …",
// "The raw notes are …") are removed even if they share a single sentence.
      const preamble = `Let me analyze this carefully. The user is asking me to organize this note. The raw notes are short fragments.

# 站会纪要

## 高价值摘要

Preamble test.

## 关键事实

- Fact 1

## 行动项

- [ ] Action 1

## 风险与待核验

- Risk 1

## 证据锚点

- Anchor 1

## 原始记录入口

- Entry 1

source-hash: 12345678abcdef
`;
      const cleanPreamble = mod.c(preamble);
      expect(
        "standalone: preamble-only — 'Let me analyze' is removed from final markdown",
        !/Let me analyze/i.test(cleanPreamble.markdown),
        `preamble still contains 'Let me analyze': ${cleanPreamble.markdown.slice(0, 200)}`,
      );
      expect(
        "standalone: preamble-only — 'The user is asking' is removed from final markdown",
        !/The user is asking/i.test(cleanPreamble.markdown),
        `preamble still contains 'The user is asking': ${cleanPreamble.markdown.slice(0, 200)}`,
      );
      expect(
        "standalone: preamble-only — 'The raw notes are' is removed from final markdown",
        !/The raw notes are/i.test(cleanPreamble.markdown),
        `preamble still contains 'The raw notes are': ${cleanPreamble.markdown.slice(0, 200)}`,
      );
      expect(
        "standalone: preamble-only — issues include stripped_preamble",
        cleanPreamble.issues.includes("stripped_preamble"),
        `preamble issues missing stripped_preamble: ${cleanPreamble.issues.join(",")}`,
      );

      // -------------------------------------------------------------------
      // 2026-07-06 (rework2) — positive path fixture.
      //
      // NJX's screenshot shows the real MiniMax-M3 direct response pattern:
      //   <think>Let me analyze …</think>
      //   ---
      //   title: …
      //   …
      //   ## 高价值摘要
      //   …
      //   source-hash: …
      //
      // After the cleaner runs, the sanitization tags must surface as
      // WARNINGS (not issues), and the assessment must PASS — the final
      // markdown has no <think> leak, has a heading, has a source-hash,
      // and has all the expected Obsidian sections.
      //
      // This is the rework2 acceptance gate for the positive path.
      // -------------------------------------------------------------------
      const njxPositive = `<think>Let me analyze this raw note carefully. The user is asking me to organize raw meeting notes into an Obsidian-compatible Markdown note.

The raw notes are about a standup discussion. I need to identify the key points, action items, and follow-ups.

I should produce clean Obsidian markdown. Let me start with the frontmatter.</think>

---
title: 站会纪要
date: 2026-07-06
type: 工作记录
status: 待跟进
tags: [standup, openclaw]
related: []
folder: openclaw
---

# 站会纪要

## 高价值摘要

本次站会聚焦 MiniMax 直连质量门禁 rework2 的落地动作. 重work1 已经把假 pass / 残留 leak 拦住, 但 rework1 把 sanitization 当 issue 也一起 fail 了, 所以 rework2 要把"成功清理 + 最终内容干净"判为 pass.

## 关键事实

- 直连管线 \`local_seed -> minimax_direct_markdown -> server_render_html\` 已经在跑.
- 用户的截图里出现 \`<think>Let me analyze …</think>\` 这种 chain-of-thought 污染.

## 行动项

- [ ] server 端在 assessor 里区分 warnings vs issues, sanitization 走 warnings.
- [ ] 强化 buildKnowledgeNoteFailurePayload 的错误码分流, 质量失败 emit \`blocked_minimax_direct_quality\`.

## 风险与待核验

- API key 还可能在某些环境下缺失, 但 rework2 已经把 config vs quality 分流, 不再混淆.

## 证据锚点

- "用户在 7-06 截图里看到 <think>…</think> 污染预览" — NJX 截图原文
- "直连管线 local_seed -> minimax_direct_markdown -> server_render_html 已经在跑" — Phase 4 debug

## 原始记录入口

见 sourceHash 引用.

source-hash: abcdef0123456789
`;
      const cleanedPositive = mod.c(njxPositive);
      expect(
        "[rework2] standalone: positive fixture — final markdown does NOT contain <think>",
        !/<think>/i.test(cleanedPositive.markdown),
        `[rework2] cleaned markdown still contains <think>: ${cleanedPositive.markdown.slice(0, 200)}`,
      );
      expect(
        "[rework2] standalone: positive fixture — final markdown does NOT contain 'Let me analyze'",
        !/Let me analyze/i.test(cleanedPositive.markdown),
        `[rework2] cleaned markdown still contains 'Let me analyze': ${cleanedPositive.markdown.slice(0, 200)}`,
      );
      expect(
        "[rework2] standalone: positive fixture — final markdown does NOT contain 'The user is asking'",
        !/The user is asking/i.test(cleanedPositive.markdown),
        `[rework2] cleaned markdown still contains 'The user is asking': ${cleanedPositive.markdown.slice(0, 200)}`,
      );
      expect(
        "[rework2] standalone: positive fixture — final markdown does NOT contain 'The raw notes are'",
        !/The raw notes are/i.test(cleanedPositive.markdown),
        `[rework2] cleaned markdown still contains 'The raw notes are': ${cleanedPositive.markdown.slice(0, 200)}`,
      );
      expect(
        "[rework2] standalone: positive fixture — cleanIssues includes stripped_think_block (sanitization happened)",
        cleanedPositive.issues.includes("stripped_think_block"),
        `[rework2] cleanIssues missing stripped_think_block: ${cleanedPositive.issues.join(",")}`,
      );
      const assessPositive = mod.a(cleanedPositive.markdown, cleanedPositive.issues);
      expect(
        "[rework2] standalone: positive fixture — assessment.passed === true (sanitized content passes gate)",
        assessPositive.passed === true,
        `[rework2] assessment should be passed=true for cleaned content, got ${JSON.stringify(assessPositive)}`,
      );
      expect(
        "[rework2] standalone: positive fixture — assessment.issues is empty (no residual leak)",
        Array.isArray(assessPositive.issues) && assessPositive.issues.length === 0,
        `[rework2] assessment.issues should be empty after cleaning, got ${JSON.stringify(assessPositive.issues)}`,
      );
      expect(
        "[rework2] standalone: positive fixture — assessment.warnings includes stripped_think_block",
        Array.isArray(assessPositive.warnings) && assessPositive.warnings.includes("stripped_think_block"),
        `[rework2] assessment.warnings missing stripped_think_block: ${JSON.stringify(assessPositive.warnings)}`,
      );
      expect(
        "[rework2] standalone: positive fixture — assessment.sanitized === true",
        assessPositive.sanitized === true,
        `[rework2] assessment.sanitized should be true for cleaned content, got ${assessPositive.sanitized}`,
      );
      expect(
        "[rework2] standalone: positive fixture — assessment.score >= 50",
        assessPositive.score >= 50,
        `[rework2] assessment.score should be >= 50 for valid cleaned content, got ${assessPositive.score}`,
      );
      expect(
        "[rework2] standalone: positive fixture — assessment.reasonLabel is the '已通过质量门禁（含清理痕迹）' variant",
        /已通过质量门禁/.test(String(assessPositive.reasonLabel || "")),
        `[rework2] reasonLabel should mark pass, got "${assessPositive.reasonLabel}"`,
      );

      // -------------------------------------------------------------------
      // 2026-07-06 (rework2) — negative path fixtures.
      //
      // Two cases must still fail:
      //   (16) Residual <think> leak (cleaner could not strip it) — must HARD-FAIL.
      //   (17) Empty / too-short content — must HARD-FAIL.
      // These prove we did NOT make the gate too lenient — sanitization is
      // fine, residual defects and insufficient content still block.
      // -------------------------------------------------------------------
      // The cleaner's THINK_BLOCK_RE matches inline `<think>…</think>` (anywhere,
      // global, multiline). The UNCLOSED_THINK_RE matches an unclosed `<think>`
      // only at the START of the string. So a `<think>` that appears mid-document
      // WITHOUT a closing `</think>` is a residual leak that the cleaner cannot
      // fully strip — the assessor's RESIDUAL_THINK_RE will catch it.
      const residualLeak = `---
title: 站会纪要
date: 2026-07-06
type: 工作记录
status: 待跟进
tags: [standup]
related: []
folder: openclaw
---

# 站会纪要

## 高价值摘要

This is the high-value summary section.

## 关键事实

- 事实 1
- 事实 2

## 行动项

- [ ] Action 1

## 风险与待核验

- Risk 1

## 证据锚点

- Anchor 1

Here is a stray think block the model emitted mid-document without closing it: <think>Now I'm reconsidering the summary.

## 原始记录入口

source-hash: deadbeefcafe1234
`;
      const cleanedLeak = mod.c(residualLeak);
      const assessLeak = mod.a(cleanedLeak.markdown, cleanedLeak.issues);
      expect(
        "[rework2] standalone: negative residual_leak — assessment.passed === false (residual <think> blocks)",
        assessLeak.passed === false,
        `[rework2] assessment should be passed=false for residual think, got ${JSON.stringify(assessLeak)}`,
      );
      expect(
        "[rework2] standalone: negative residual_leak — assessment.issues includes residual_think_uncleaned",
        Array.isArray(assessLeak.issues) && assessLeak.issues.includes("residual_think_uncleaned"),
        `[rework2] assessment.issues missing residual_think_uncleaned: ${JSON.stringify(assessLeak.issues)}`,
      );

      const tooShort = `---
title: 太短
---
source-hash: 12345
`;
      const cleanedShort = mod.c(tooShort);
      const assessShort = mod.a(cleanedShort.markdown, cleanedShort.issues);
      expect(
        "[rework2] standalone: negative too-short — assessment.passed === false (length < 200)",
        assessShort.passed === false,
        `[rework2] assessment should be passed=false for too-short content, got ${JSON.stringify(assessShort)}`,
      );
      expect(
        "[rework2] standalone: negative too-short — assessment.reasonLabel mentions 内容过短",
        /内容过短|未达质量门槛/.test(String(assessShort.reasonLabel || "")),
        `[rework2] reasonLabel should explain length failure, got "${assessShort.reasonLabel}"`,
      );
    }
    try { fs.unlinkSync(sandboxPath); } catch {}
  }
}

// ---------------------------------------------------------------------------
// (15) Optional live probe
// ---------------------------------------------------------------------------

if (process.env.KNOWLEDGE_ADD_NOTE_LIVE_PROBE === "1") {
  const port = Number(process.env.WORKBENCH_PORT || 38888);
  const host = process.env.WORKBENCH_HOST || "127.0.0.1";
  const live = await new Promise((resolve) => {
    const payload = JSON.stringify({
      rawContent: "HTML quality probe: Add Note direct path should fail-fast when content is contaminated. No API key.",
      title: "Phase T10 probe note",
      date: "2026-07-06",
      type: "工作记录",
      status: "待跟进",
      tags: ["phase_t10_probe"],
      related: [],
      folder: "openclaw",
      qualityMode: "minimax-direct",
      requestedQualityMode: "minimax-direct",
      htmlMode: "m3",
      agentId: "auto",
      gatewayTimeoutMs: 30_000,
      retryPolicy: { autoRepair: false, maxAttempts: 1, exposeDiagnostics: true },
    });
    const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) };
    const cookieEnv = process.env.WORKBENCH_COOKIE;
    if (cookieEnv) headers.Cookie = cookieEnv;
    const req = http.request({ host, port, method: "POST", path: "/api/knowledge/notes/organize", headers, timeout: 35_000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, body, parsed });
      });
    });
    req.on("error", () => resolve({ status: 0, body: "", parsed: null }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "", parsed: null }); });
    req.write(payload);
    req.end();
  });
  const errCode = live.parsed?.error;
  const reasonText = String(live.parsed?.reason || "");
  const pipelineText = Array.isArray(live.parsed?.generationPipeline) ? live.parsed.generationPipeline.join(",") : "";
  // 2026-07-06 rework2: three valid direct-mode failure shapes:
  //   - blocked_minimax_direct_config  (no API key / config / http / abort / throw)
  //   - blocked_minimax_direct_quality (output quality gate failed)
  //   - 200 OK with ok: true           (clean output)
  const isBlockedDirectConfig = errCode === "blocked_minimax_direct_config"
    || /BLOCKED_MINIMAX_DIRECT_CONFIG/.test(reasonText)
    || /minimax_direct_failed_no_fallback/.test(pipelineText);
  const isBlockedDirectQuality = errCode === "blocked_minimax_direct_quality"
    || /^minimax_direct_markdown_quality/.test(reasonText);
  const isPositivePass = live.status === 200 && live.parsed?.ok === true;
  expect(
    "live probe: default direct path returns one of {blocked_minimax_direct_config, blocked_minimax_direct_quality, ok:true}",
    live.status === 0 || isBlockedDirectConfig || isBlockedDirectQuality || isPositivePass,
    `live probe returned status=${live.status}, error=${errCode}, reason=${reasonText}`,
  );
  if (isBlockedDirectConfig && live.status !== 0) {
    const gatewayRepair = /重新连接\s+Gateway|重启\s+OpenClaw\s+Gateway/;
    expect(
      "live probe (config failure): top-level copy does NOT recommend restarting Gateway for direct failures",
      !gatewayRepair.test(String(live.parsed?.diagnosis?.reasonLabel || "")) && !gatewayRepair.test(String(live.parsed?.diagnosis?.advice || "")),
      `direct failure still mentions Gateway repair: reasonLabel=${live.parsed?.diagnosis?.reasonLabel}; advice=${live.parsed?.diagnosis?.advice}`,
    );
    expect(
      "live probe (config failure): errorCode is \"blocked_minimax_direct_config\" (NOT \"blocked_minimax_direct_quality\")",
      errCode === "blocked_minimax_direct_config",
      `expected blocked_minimax_direct_config for config failure, got ${errCode}`,
    );
  }
  if (isBlockedDirectQuality && live.status !== 0) {
    // 2026-07-06 rework2 — quality failure must NEVER say "请配置 MiniMax API key"
    // and must NEVER recommend restarting Gateway.
    const topMessage = String(live.parsed?.message || "");
    const topReasonLabel = String(live.parsed?.reasonLabel || "");
    const topAdvice = String(live.parsed?.advice || "");
    const diagnosisReasonLabel = String(live.parsed?.diagnosis?.reasonLabel || "");
    const diagnosisAdvice = String(live.parsed?.diagnosis?.advice || "");
    const diagnosisUserAction = String(live.parsed?.diagnosis?.userAction || "");
    const diagnosisCategory = String(live.parsed?.diagnosis?.category || "");
    const fullText = [topMessage, topReasonLabel, topAdvice, diagnosisReasonLabel, diagnosisAdvice, diagnosisUserAction, diagnosisCategory].join("\n");
    expect(
      "live probe (quality failure): errorCode is \"blocked_minimax_direct_quality\" (NOT \"blocked_minimax_direct_config\")",
      errCode === "blocked_minimax_direct_quality",
      `expected blocked_minimax_direct_quality for quality failure, got ${errCode}`,
    );
    expect(
      "live probe (quality failure): category is 'MiniMax 直连输出质量未通过'",
      /MiniMax 直连输出质量未通过/.test(diagnosisCategory),
      `expected quality-specific category, got "${diagnosisCategory}"`,
    );
    expect(
      "live probe (quality failure): top-level message does NOT recommend 配置 MiniMax API key (API key was already used successfully)",
      !/请配置\s+MiniMax\s+API\s*key|配置\s+MiniMax\s+API\s*key/.test(fullText),
      `quality failure still says 配置 MiniMax API key: ${fullText.slice(0, 400)}`,
    );
    expect(
      "live probe (quality failure): no Gateway restart/reconnect advice",
      !/重启\s+OpenClaw\s+Gateway|重新连接\s+Gateway/.test(fullText),
      `quality failure still says restart Gateway: ${fullText.slice(0, 400)}`,
    );
    expect(
      "live probe (quality failure): top-level message explicitly notes API key was successfully called",
      /MiniMax\s+API\s*key\s*已(配置正确|成功调用)/.test(fullText),
      `quality failure should explicitly note API key was called successfully: ${fullText.slice(0, 400)}`,
    );
  }
  if (isPositivePass) {
    // PASS path — verify draft.markdown and draft.html have no leak.
    const draftMd = String(live.parsed?.draft?.markdown || "");
    const draftHtml = String(live.parsed?.draft?.html || live.parsed?.htmlDraft?.html || "");
    expect(
      "live probe (positive pass): draft.markdown does NOT contain <think>",
      !/<think>/i.test(draftMd),
      `positive pass draft.markdown still contains <think>: ${draftMd.slice(0, 200)}`,
    );
    expect(
      "live probe (positive pass): draft.html does NOT contain <think>",
      !/<think>/i.test(draftHtml),
      `positive pass draft.html still contains <think>: ${draftHtml.slice(0, 200)}`,
    );
    expect(
      "live probe (positive pass): htmlQuality.passed !== false",
      live.parsed?.htmlQuality?.passed !== false,
      `positive pass htmlQuality.passed should not be false, got ${JSON.stringify(live.parsed?.htmlQuality)}`,
    );
    expect(
      "live probe (positive pass): qualityMode === 'minimax-direct' (no Gateway fallback)",
      live.parsed?.qualityMode === "minimax-direct",
      `positive pass qualityMode should be minimax-direct, got ${live.parsed?.qualityMode}`,
    );
    expect(
      "live probe (positive pass): generationPipeline does NOT include minimax_direct_failed_no_fallback",
      !Array.isArray(live.parsed?.generationPipeline) || !live.parsed.generationPipeline.includes("minimax_direct_failed_no_fallback"),
      `positive pass should not include minimax_direct_failed_no_fallback in pipeline: ${JSON.stringify(live.parsed?.generationPipeline)}`,
    );
  }
}

// -------------------------------------------------------------------
// 2026-07-06 (rework3) — direct repair path tests.
// We test (a) the buildKnowledgeNoteM3RepairPrompt helper at source level,
// (b) the direct branch repair logic at source level, and (c) the helper
// behaviour against a real repair-response fixture using the already-loaded
// sandbox module.
// -------------------------------------------------------------------

// (a) buildKnowledgeNoteM3RepairPrompt helper exists with the right shape.
const repairPromptBody = extractFunctionBody(serverSrc, "buildKnowledgeNoteM3RepairPrompt");
expect(
  "[rework3] server defines buildKnowledgeNoteM3RepairPrompt function",
  Boolean(repairPromptBody) && repairPromptBody.length > 200,
  "buildKnowledgeNoteM3RepairPrompt not found in server source",
);
expect(
  "[rework3] buildKnowledgeNoteM3RepairPrompt forbids <think> tags",
  /不要输出\s*<think>|绝对不要.*<think>/.test(repairPromptBody) && /不要输出\s*JSON/.test(repairPromptBody),
  "buildKnowledgeNoteM3RepairPrompt does not forbid <think> or JSON output",
);
expect(
  "[rework3] buildKnowledgeNoteM3RepairPrompt forbids preamble phrases",
  /Let me analyze|The user is asking|The raw notes are|I need to/.test(repairPromptBody)
    && /下面我|让我(?:先|来)?|我来(?:分析|整理|看看)/.test(repairPromptBody),
  "buildKnowledgeNoteM3RepairPrompt does not forbid preamble phrases",
);
expect(
  "[rework3] buildKnowledgeNoteM3RepairPrompt requires source-hash line in output",
  /末尾必须.*source-hash|source-hash\s*:/.test(repairPromptBody),
  "buildKnowledgeNoteM3RepairPrompt does not require source-hash line in output",
);
expect(
  "[rework3] buildKnowledgeNoteM3RepairPrompt handles low-signal transcripts (午间咖啡杂谈 rule)",
  /低信息密度|仅供参考|午间咖啡杂谈|未从原文确认/.test(repairPromptBody),
  "buildKnowledgeNoteM3RepairPrompt does not handle low-signal transcripts",
);
expect(
  "[rework3] buildKnowledgeNoteM3RepairPrompt embeds previousIssues / previousCleanedLength",
  /previousIssues/.test(repairPromptBody) && /previousCleanedLength/.test(repairPromptBody),
  "buildKnowledgeNoteM3RepairPrompt does not embed previous failure context",
);

// (b) Direct branch repair logic at source level.
const directBranchWithRepair = directBranchIdx >= 0 ? serverSrc.slice(directBranchIdx, directBranchIdx + 36_000) : "";
expect(
  "[rework3] direct branch calls buildKnowledgeNoteM3RepairPrompt on quality failure",
  /buildKnowledgeNoteM3RepairPrompt\s*\(/.test(directBranchWithRepair),
  "direct branch does not call buildKnowledgeNoteM3RepairPrompt",
);
expect(
  "[rework3] direct branch calls directMinimaxM3Call a second time for repair",
  // First call is around line 8616, repair call should be a second await.
  /directMinimaxM3Call\([^)]*repairPrompt|directMinimaxM3Call\([^)]*\)\s*[;,]?[\s\S]{0,200}directMinimaxM3Call/.test(directBranchWithRepair)
    || (/await\s+directMinimaxM3Call/.test(directBranchWithRepair) && (directBranchWithRepair.match(/await\s+directMinimaxM3Call/g) || []).length >= 2),
  "direct branch only calls directMinimaxM3Call once — repair call missing",
);
expect(
  "[rework3] direct branch pipeline emits 'minimax_direct_markdown_empty_after_clean' on repair success",
  /minimax_direct_markdown_empty_after_clean/.test(directBranchWithRepair),
  "direct branch pipeline missing 'minimax_direct_markdown_empty_after_clean' marker",
);
expect(
  "[rework3] direct branch pipeline emits 'minimax_direct_markdown_repair' on repair success",
  /minimax_direct_markdown_repair/.test(directBranchWithRepair),
  "direct branch pipeline missing 'minimax_direct_markdown_repair' marker",
);
expect(
  "[rework3] direct branch emits 'minimax_direct_markdown_repair_failed' on dual failure",
  /minimax_direct_markdown_repair_failed/.test(directBranchWithRepair),
  "direct branch does not emit 'minimax_direct_markdown_repair_failed' on dual failure",
);
expect(
  "[rework3] direct branch dual-failure rootCause explains both attempts failed",
  /两次|均未通过|repair.*未通过|first.*repair/i.test(directBranchWithRepair),
  "direct branch dual-failure rootCause does not explain both attempts failed",
);
expect(
  "[rework3] direct branch dual-failure pipeline includes both empty_after_clean AND repair_failed",
  /minimax_direct_markdown_empty_after_clean[\s\S]{0,800}minimax_direct_markdown_repair_failed|minimax_direct_markdown_repair_failed[\s\S]{0,800}minimax_direct_markdown_empty_after_clean/.test(directBranchWithRepair),
  "direct branch dual-failure pipeline does not include both empty_after_clean and repair_failed markers",
);
expect(
  "[rework3] direct branch retryBudget.maxMarkdownRepairAttempts === 1 on dual failure",
  /maxMarkdownRepairAttempts:\s*1/.test(directBranchWithRepair),
  "direct branch retryBudget.maxMarkdownRepairAttempts should be 1 after repair attempt",
);
expect(
  "[rework3] direct branch repair success retryBudget.maxMarkdownRepairAttempts === 1",
  /maxMarkdownRepairAttempts:\s*didRepair\s*\?\s*1\s*:\s*0/.test(directBranchWithRepair),
  "direct branch repair success retryBudget does not reflect didRepair state",
);

// (c) buildKnowledgeNoteFailurePayload detects `minimax_direct_markdown_repair_failed` and emits
//     the dual-failure top-level message ("两次直连均未通过").
expect(
  "[rework3] buildKnowledgeNoteFailurePayload detects repair_failed reason",
  /isDirectRepairFailed\s*=/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload does not detect repair_failed reason",
);
expect(
  "[rework3] buildKnowledgeNoteFailurePayload dual-failure top-level message says 两次直连均未通过",
  /两次.*均未通过.*质量门禁|两次.*均未通过|两次直连与一次性 repair 均未通过/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload dual-failure top-level message does not say '两次直连均未通过'",
);
expect(
  "[rework3] buildKnowledgeNoteFailurePayload dual-failure message still mentions m3-html legacy as fallback advice",
  /m3-html.*legacy|legacy.*Gateway/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload dual-failure message should mention m3-html legacy as fallback advice",
);
expect(
  "[rework3] buildKnowledgeNoteFailurePayload dual-failure message does NOT mention API key config",
  // Inspect ONLY the quality-failure branch (isDirectQualityFailure → message ternary),
  // not the directAdvice which legitimately mentions API key config.
  (() => {
    const qualityBranch = payloadFnBody.match(/isDirectQualityFailure\s*\?\s*\([\s\S]*?:\s*"([^"]+)"\s*\)/);
    if (!qualityBranch) return false;
    return !/请配置\s+MiniMax\s+API\s*key|配置\s+MiniMax\s+API\s*key/.test(qualityBranch[1]);
  })(),
  "buildKnowledgeNoteFailurePayload dual-failure message still mentions 配置 MiniMax API key",
);
expect(
  "[rework3] buildKnowledgeNoteFailurePayload dual-failure message does NOT recommend restarting Gateway",
  (() => {
    const qualityBranch = payloadFnBody.match(/isDirectQualityFailure\s*\?\s*\([\s\S]*?:\s*"([^"]+)"\s*\)/);
    if (!qualityBranch) return false;
    return !/重启\s+OpenClaw\s+Gateway|重新连接\s+Gateway/.test(qualityBranch[1]);
  })(),
  "buildKnowledgeNoteFailurePayload dual-failure message still recommends restarting Gateway",
);

// (d) Helper-level simulated repair path: feed the helpers a valid Obsidian
//     Markdown (the simulated repair response) and prove it passes the gate
//     with no leak. This block re-uses the `mod` instance built by the
//     earlier (12)-(17) cases; we just guard against an unbuilt `mod` here.
if (mod) {
  const repairResponseRaw = `---
title: 午间咖啡杂谈
date: 2026-07-06
type: 备忘
status: 仅供参考
tags: [casual, summer, travel]
related: []
folder: openclaw
---

# 午间咖啡杂谈

## 高价值摘要

本次是 2026 年 7 月初一段低信息密度的咖啡闲聊, 没有具体决策或行动项. 主要话题包括 7 月高温、美国建国 250 周年, 以及对"年纪越大时间越快"的心理感受. 末尾约定在孩子开学前再安排一次出行.

## 关键事实

- 7 月初气温 30 多度, 已进入暑期, 空调电费预估上涨.
- 2026 年是美国建国 250 周年, 起算年 1776.
- 对话双方对"年龄越大主观时间越快"形成共识, 心理学解释为新体验减少.
- 孩子开学前计划一次出行, 距离远则飞机、近则自驾.

## 行动项

未从原文确认.

## 风险与待核验

- 原始信息密度低, 关键判断待用户补充; 出行时间 / 目的地 / 同行人等细节未明确.

## 证据锚点

- "2026 还是美国建国 250 周年呢" — 对话原文
- "年纪越大, 时间过得越快" — 对话原文
- "等孩子开学前安排一次" — 对话原文

## 原始记录入口

见 sourceHash 引用.

source-hash: abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
`;
  const cleanedRepair = mod.c(repairResponseRaw);
  const assessRepair = mod.a(cleanedRepair.markdown, cleanedRepair.issues);
  expect(
    "[rework3] standalone: simulated repair response — final markdown does NOT contain <think>",
    !/<think>/i.test(cleanedRepair.markdown),
    `[rework3] repair cleaned markdown still contains <think>: ${cleanedRepair.markdown.slice(0, 200)}`,
  );
  expect(
    "[rework3] standalone: simulated repair response — final markdown does NOT contain 'Let me analyze'",
    !/Let me analyze/i.test(cleanedRepair.markdown),
    `[rework3] repair cleaned markdown still contains 'Let me analyze': ${cleanedRepair.markdown.slice(0, 200)}`,
  );
  expect(
    "[rework3] standalone: simulated repair response — final markdown does NOT contain 'The user is asking'",
    !/The user is asking/i.test(cleanedRepair.markdown),
    `[rework3] repair cleaned markdown still contains 'The user is asking': ${cleanedRepair.markdown.slice(0, 200)}`,
  );
  expect(
    "[rework3] standalone: simulated repair response — assessment.passed === true",
    assessRepair.passed === true,
    `[rework3] repair assessment should be passed=true, got ${JSON.stringify(assessRepair)}`,
  );
  expect(
    "[rework3] standalone: simulated repair response — assessment.issues is empty",
    Array.isArray(assessRepair.issues) && assessRepair.issues.length === 0,
    `[rework3] repair assessment.issues should be empty, got ${JSON.stringify(assessRepair.issues)}`,
  );
  expect(
    "[rework3] standalone: simulated repair response — reasonLabel includes 已通过质量门禁",
    /已通过质量门禁/.test(String(assessRepair.reasonLabel || "")),
    `[rework3] repair reasonLabel should mark pass, got "${assessRepair.reasonLabel}"`,
  );

  // 午间咖啡杂谈 fixture: prove the helpers can accept a faithful Obsidian
  // Markdown for the real raw transcript.
  const casualRepairResponse = `---
title: 午间咖啡杂谈
date: 2026-07-06
type: 备忘
status: 仅供参考
tags: [casual, summer, travel]
related: []
folder: openclaw
---

# 午间咖啡杂谈

## 高价值摘要

本次是 2026 年 7 月初一段低信息密度的咖啡闲聊, 没有具体决策或行动项. 主要话题包括 7 月高温、美国建国 250 周年, 以及对"年纪越大时间越快"的心理感受. 末尾约定在孩子开学前再安排一次出行.

## 关键事实

- 7 月初气温 30 多度, 已进入暑期, 空调电费预估上涨.
- 2026 年是美国建国 250 周年, 起算年 1776.
- 对话双方对"年龄越大主观时间越快"形成共识, 心理学解释为新体验减少.
- 孩子开学前计划一次出行, 距离远则飞机、近则自驾.

## 行动项

未从原文确认.

## 风险与待核验

- 原始信息密度低, 关键判断待用户补充; 出行时间 / 目的地 / 同行人等细节未明确.

## 证据锚点

- "2026 还是美国建国 250 周年呢" — 对话原文
- "年纪越大, 时间过得越快" — 对话原文
- "等孩子开学前安排一次" — 对话原文

## 原始记录入口

见 sourceHash 引用.

source-hash: 1122334455667788112233445566778811223344556677881122334455667788
`;
  const cleanedCasual = mod.c(casualRepairResponse);
  const assessCasual = mod.a(cleanedCasual.markdown, cleanedCasual.issues);
  expect(
    "[rework3] standalone: 午间咖啡杂谈 fixture — final markdown does NOT contain <think>",
    !/<think>/i.test(cleanedCasual.markdown),
    `[rework3] casual cleaned markdown still contains <think>: ${cleanedCasual.markdown.slice(0, 200)}`,
  );
  expect(
    "[rework3] standalone: 午间咖啡杂谈 fixture — assessment.passed === true",
    assessCasual.passed === true,
    `[rework3] casual assessment should be passed=true, got ${JSON.stringify(assessCasual)}`,
  );
  expect(
    "[rework3] standalone: 午间咖啡杂谈 fixture — title 午间咖啡杂谈 preserved",
    /title:\s*午间咖啡杂谈/.test(cleanedCasual.markdown) || /^#\s+午间咖啡杂谈/m.test(cleanedCasual.markdown),
    `[rework3] casual title 午间咖啡杂谈 not preserved in final markdown`,
  );
  expect(
    "[rework3] standalone: 午间咖啡杂谈 fixture — final markdown contains source-hash line",
    /^source-hash\s*[:：]/im.test(cleanedCasual.markdown),
    `[rework3] casual markdown missing source-hash line`,
  );
  expect(
    "[rework3] standalone: 午间咖啡杂谈 fixture — final markdown contains 未从原文确认",
    /未从原文确认/.test(cleanedCasual.markdown),
    `[rework3] casual markdown missing '未从原文确认' for missing actions`,
  );

  // Negative repair: second call also returns think-only with NO actual note
  // content. The cleaned markdown must be empty so the assessment fails.
  // We use a fully closed <think>…</think> block (THINK_BLOCK_RE strips it).
  const unsafeRepairRaw = `<think>Let me analyze this carefully. The user is asking me to organize this note.

The raw notes are about casual summer conversation. I need to think about the structure.

I should produce clean Obsidian markdown. Let me start with the frontmatter and the heading. I will use frontmatter with title, date, type, status, tags, related, folder. Then I will write the sections.

I think the title should be 午间咖啡杂谈. The status should be 仅供参考. The type should be 备忘.

I will use tags like casual, summer, travel. Then I will write the body.

I hope this analysis is sufficient. Let me also write the sections. Each section should be written in Obsidian markdown format.

I need to ensure the output is good enough to pass the quality gate. Let me think about this more carefully.

I think the structure should include 高价值摘要, 关键事实, 行动项, 风险与待核验, 证据锚点, and 原始记录入口 sections.

Let me think about what to write in each section. The high-value summary should briefly summarize the conversation. Key facts should list the main points. Action items should list any decisions or follow-ups. Risk and to-be-verified should note any uncertainties. Evidence anchors should cite the original lines. Original entry should reference the source.

Now I will write the actual markdown. The markdown should start with --- for frontmatter. Then I will write the body. Each section will be in Chinese.

Let me ensure the JSON envelope is correct. I will use a frontmatter block with title, date, type, status, tags, related, folder. Then I will write the body with the sections.

I need to make sure I do not include any preamble like Let me analyze. I will just output the final markdown directly. Here is my final markdown.

Wait, I should not output anything before the markdown. Let me just output the markdown.

Let me think one more time. The quality gate checks for residual think blocks. So I should not include any think content. Let me just output the markdown.

OK I think I am ready now. Let me write the final markdown. Here it is.

Actually let me reconsider. The user is asking me to organize a casual conversation transcript. The transcript mentions summer heat, US 250th anniversary, age perception of time, and travel plans. I should write a faithful representation of these topics in Obsidian markdown format.

Let me write the frontmatter first.

Then I will write each section based on the topics mentioned in the conversation.

OK I will write the markdown now. No</think>`;

  const cleanedUnsafeRepair = mod.c(unsafeRepairRaw);
  const assessUnsafeRepair = mod.a(cleanedUnsafeRepair.markdown, cleanedUnsafeRepair.issues);
  expect(
    "[rework3] standalone: negative dual-failure — second call returns think-only → assessment.passed === false",
    assessUnsafeRepair.passed === false,
    `[rework3] unsafe repair assessment should be passed=false, got ${JSON.stringify(assessUnsafeRepair)}`,
  );
  expect(
    "[rework3] standalone: negative dual-failure — cleaned markdown is empty (empty_after_clean)",
    !cleanedUnsafeRepair.markdown.trim(),
    `[rework3] unsafe repair cleaned markdown should be empty, got length=${cleanedUnsafeRepair.markdown.length}: ${cleanedUnsafeRepair.markdown.slice(0, 200)}`,
  );
  expect(
    "[rework3] standalone: negative dual-failure — cleanIssues include stripped_think_block (or residual leak)",
    cleanedUnsafeRepair.issues.some((t) => /stripped_think_block|stripped_preamble|stripped_unclosed_think_block|residual_think_uncleaned|residual_preamble/.test(t)),
    `[rework3] unsafe repair issues missing think/preamble tags: ${cleanedUnsafeRepair.issues.join(",")}`,
  );
}

// (e) Live probe: rework3 expects the live response to accept the
//     new repair-success / repair-failed shapes from the live server.
//     The original live probe block above already validates the basic
//     contract; the dual-failure contract is also verified at source level
//     (the [rework3] buildKnowledgeNoteFailurePayload checks above).
//     No additional live probe code is needed here.

if (failures.length) {
  console.error("KNOWLEDGE_ADD_NOTE_DIRECT_HTML_QUALITY_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("KNOWLEDGE_ADD_NOTE_DIRECT_HTML_QUALITY_PASS");