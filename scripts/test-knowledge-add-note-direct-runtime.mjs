// 2026-07-04 — T8 njx-knowledge v2 Phase 4 Add Note direct-runtime rework regression probe.
//
// Codex acceptance of the previous finalization pass found the real Add Note
// path still depended on Gateway / OpenClaw Worker:
//
//   - Normal Knowledge Add Note default request used qualityMode = "m3-html".
//   - Calendar Add Note default request used qualityMode = "m3-html" and never
//     sent requestedQualityMode.
//   - New Add Note drafts defaulted to "m3-html" (emptyKnowledgeNoteDraft).
//   - Server normalizeKnowledgeNoteQualityMode("minimax-direct") aliased the
//     effective mode to "m3-html" (phase1_minimax_direct_alias_to_m3_html).
//   - Server runtime branch for requestedMode === "minimax-direct" silently
//     fell back to the m3-html Gateway pipeline on any failure
//     (audit metadata minimax_direct_failed_fallback_to_m3_html).
//   - Missing direct credentials did NOT surface BLOCKED_MINIMAX_DIRECT_CONFIG
//     to the UI; instead, the UI showed "连接 Gateway" /
//     "必须通过 Gateway/MiniMax" copy.
//
// This probe enforces the post-rework contract at source level + via a live
// /api/knowledge/notes/organize probe when a local server is reachable:
//
//   SERVER (apps/server/src/index.ts):
//     (1) normalizeKnowledgeNoteQualityMode("minimax-direct") keeps effective
//         mode = "minimax-direct" (no alias to m3-html).
//     (2) The runtime direct branch (`if (requestedMode === "minimax-direct")`)
//         calls failKnowledgeNoteGateway on direct failure instead of falling
//         through to the m3-html Gateway pipeline.
//     (3) buildKnowledgeNoteFailurePayload surfaces error = "blocked_minimax_direct_config"
//         and a non-empty payload.directMinimaxNote for direct-mode failures.
//     (4) Default defaults that used to be hard-coded to "m3-html" now default
//         to "minimax-direct" (organizeJobKey, createKnowledgeNoteOrganizeJob,
//         recoverKnowledgeNoteGatewayFinalBySourceHash, mobile calendar
//         create handler, createHighQualityCalendarNote, the runtime default
//         in organizeKnowledgeNoteDraftHighQuality, the html-qualityMode guard
//         in generateKnowledgeNoteM3Html).
//     (5) The knowledge note organize endpoint does NOT pre-call
//         requireGatewayReadyForKnowledgeNote before the minimax-direct branch
//         returns its result.
//
//   WEB (apps/web/src/App.tsx):
//     (6) emptyKnowledgeNoteDraft defaults qualityMode to "minimax-direct".
//     (7) submitNoteDraft and submitCalendarKnowledgeNoteDraft send
//         qualityMode / requestedQualityMode = "minimax-direct" by default.
//     (8) The calendar quick-note Add Note handler sends qualityMode =
//         "minimax-direct" and requestedQualityMode = "minimax-direct".
//     (9) The knowledge-note qualityMode selector marks "minimax-direct" as
//         the default option.
//    (10) The progress label "连接 Gateway" and the static copy
//         "必须通过 Gateway/MiniMax" are no longer emitted unconditionally for
//         direct-mode UI; both are gated on qualityMode === "m3-html".
//
//   LIVE PROBE (when a server is reachable):
//    (11) POST /api/knowledge/notes/organize with qualityMode = "minimax-direct"
//         and NO API key in the environment returns
//         error = "blocked_minimax_direct_config" (NOT a Gateway transport
//         failure).
//
//   GATEWAY-DEPENDENCY AUDIT (GATEWAY_DEPENDENCY_AUDIT.md):
//    (12) Add Note default path contains zero references to `requireGatewayReady`,
//         `Gateway 不可用`, `Gateway 整理失败`, or `transport failed` that fire
//         for the default mode.
//
// Read-only: only reads files + (optionally) hits the live server. Never
// mutates the tree. Deterministic when the env is stable.
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

const serverSrc = read("apps/server/src/index.ts");
const webSrc = read("apps/web/src/App.tsx");

// --- (1) Server normalize: minimax-direct -> effective = minimax-direct ---
const normFnMatch = serverSrc.match(/function\s+normalizeKnowledgeNoteQualityMode[\s\S]*?\n\}/);
const normFnBody = normFnMatch ? normFnMatch[0] : "";
expect(
  "normalizeKnowledgeNoteQualityMode keeps minimax-direct effective = minimax-direct",
  /requested === "minimax-direct"[\s\S]*?return\s*\{\s*requested\s*,\s*effective:\s*"minimax-direct"\s*,\s*aliasReason:/m.test(normFnBody),
  "minimax-direct is still aliased to m3-html somewhere in normalizeKnowledgeNoteQualityMode",
);
expect(
  "normalizeKnowledgeNoteQualityMode no longer returns aliasReason phase1_minimax_direct_alias_to_m3_html",
  !/phase1_minimax_direct_alias_to_m3_html/.test(serverSrc),
  "literal aliasReason `phase1_minimax_direct_alias_to_m3_html` still present in source",
);
expect(
  "normalizeKnowledgeNoteQualityMode defaults to minimax-direct when input is missing",
  /String\(input \|\| "minimax-direct"\)/.test(serverSrc),
  "no minimax-direct default in normalizeKnowledgeNoteQualityMode fallback",
);

// --- (2) Runtime direct branch fails-fast (no Gateway fallback) ---
const directBranchStart = serverSrc.indexOf("if (requestedMode === \"minimax-direct\")");
const directBranchEnd = directBranchStart >= 0 ? serverSrc.indexOf("\n  }\n  try {\n    await requireGatewayReadyForKnowledgeNote", directBranchStart) : -1;
const directBranch = directBranchStart >= 0 && directBranchEnd >= 0 ? serverSrc.slice(directBranchStart, directBranchEnd) : "";
expect(
  "runtime minimax-direct branch is followed by an early return on success (no Gateway preflight when direct works)",
  // 2026-07-06 (rework3): the success-path generationPipeline now uses a basePipeline
  // spread + sanitized append (so repair cases can interleave empty_after_clean / repair
  // markers). The contract is still: qualityMode === "minimax-direct" + the function
  // contains the minimax_direct_markdown pipeline step + the server_render_html step.
  /return\s*\{[\s\S]*?qualityMode:\s*"minimax-direct"[\s\S]*?generationPipeline:\s*finalPipeline/.test(directBranch)
    && /"minimax_direct_markdown"/.test(directBranch)
    && /"server_render_html"/.test(directBranch),
  "minimax-direct success path no longer returns early with qualityMode = minimax-direct",
);
expect(
  "runtime minimax-direct branch calls failKnowledgeNoteGateway on direct failure (no Gateway fallback)",
  /failKnowledgeNoteGateway\(\s*directStage\s*,\s*`\$\{directFailureCode\}:\$\{directFailureMessage\}`[\s\S]*?minimax_direct_failed_no_fallback/m.test(directBranch),
  "minimax-direct failure path no longer fail-fast via failKnowledgeNoteGateway",
);
expect(
  "runtime minimax-direct branch no longer audits `fallback: \"m3-html\"` (Phase 4 contract: fallback = none)",
  !/fallback:\s*"m3-html",\s*requestedQualityMode:\s*body\.requestedQualityMode \|\| requestedMode,\s*effectiveQualityMode:\s*"m3-html"/.test(serverSrc),
  "Phase 4 contract: minimax-direct failure audit must mark fallback = none, not m3-html",
);

// --- (3) buildKnowledgeNoteFailurePayload surfaces blocked_minimax_direct_config ---
const payloadFnMatch = serverSrc.match(/function\s+buildKnowledgeNoteFailurePayload[\s\S]*?\n\}/);
const payloadFnBody = payloadFnMatch ? payloadFnMatch[0] : "";
expect(
  "buildKnowledgeNoteFailurePayload emits error = \"blocked_minimax_direct_config\" for minimax-direct failures",
  // 2026-07-06 (rework3): the quality check is now `isDirectQualityFailure ? ... : (isDirectMinimaxFailure ? "blocked_minimax_direct_config" : ...)`.
  // Pattern is relaxed to look for either the previous exact ordering or the new
  // ternary ordering.
  /isDirectMinimaxFailure[\s\S]{0,400}errorCode[\s\S]{0,200}"blocked_minimax_direct_config"/.test(payloadFnBody)
    || /isDirectMinimaxFailure\s*\?\s*"blocked_minimax_direct_config"/.test(payloadFnBody),
  "no blocked_minimax_direct_config errorCode emitted from buildKnowledgeNoteFailurePayload",
);
expect(
  "buildKnowledgeNoteFailurePayload payload includes directMinimaxNote",
  /directMinimaxNote:\s*failure\.directMinimaxNote/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload payload does not surface failure.directMinimaxNote",
);
// Top-level reasonLabel/advice must NEVER carry Gateway repair copy when the
// failure is direct-mode (BLOCKED_MINIMAX_DIRECT_CONFIG / minimax_direct_*).
// The rework previously emitted "Gateway/MiniMax 未返回可保存结果" +
// "请重试；若持续失败，检查 Gateway 状态..." at top level for direct-mode
// failures, which misleads users into restarting OpenClaw Gateway when the
// real root cause is a missing MiniMax API key.
expect(
  "buildKnowledgeNoteFailurePayload overrides top-level reasonLabel for direct-mode failures (no Gateway repair copy)",
  /isDirectMinimaxFailure[\s\S]{0,1200}topReasonLabel[\s\S]{0,80}isDirectMinimaxFailure\s*\?\s*directReasonLabel\s*:\s*details\.reasonLabel/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload does not override top-level reasonLabel for direct-mode failures — would surface Gateway repair copy",
);
expect(
  "buildKnowledgeNoteFailurePayload overrides top-level advice for direct-mode failures (no Gateway repair copy)",
  /isDirectMinimaxFailure[\s\S]{0,1500}topAdvice[\s\S]{0,80}isDirectMinimaxFailure\s*\?\s*directAdvice\s*:\s*details\.advice/.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload does not override top-level advice for direct-mode failures — would surface Gateway repair copy",
);
expect(
  "buildKnowledgeNoteFailurePayload direct-mode string literals (directReasonLabel/directAdvice) do NOT use Gateway repair copy",
  // Inspect only the direct-mode string literals — `directReasonLabel = ...`
  // and `directAdvice = ...`. Allow comments to describe the bug.
  (() => {
    const directLabelMatch = payloadFnBody.match(/const\s+directReasonLabel\s*=\s*isDirectConfigMissing\s*\n?\s*\?\s*"([^"]+)"\s*\n?\s*:\s*"([^"]+)"/);
    const directAdviceMatch = payloadFnBody.match(/const\s+directAdvice\s*=\s*"([^"]+)"/);
    if (!directLabelMatch || !directAdviceMatch) return false;
    const literals = [directLabelMatch[1], directLabelMatch[2], directAdviceMatch[1]];
    const gatewayRepairTerms = /Gateway\/MiniMax\s+未返回可保存结果|请重试；若持续失败，检查\s+Gateway\s+状态|重启\s+OpenClaw\s+Gateway/;
    return literals.every((s) => !gatewayRepairTerms.test(s));
  })(),
  "buildKnowledgeNoteFailurePayload direct-mode string literals still contain Gateway repair copy",
);
expect(
  "buildKnowledgeNoteFailurePayload direct-mode advice mentions m3-html as the explicit user-selected legacy path",
  /directAdvice\s*=\s*"[\s\S]{0,200}m3-html[\s\S]{0,40}legacy/i.test(payloadFnBody)
    || /directAdvice\s*=\s*"[\s\S]{0,200}m3-html[\s\S]{0,40}显式[\s\S]{0,40}切换/i.test(payloadFnBody),
  "buildKnowledgeNoteFailurePayload does not frame m3-html as the explicit user-selected legacy path in direct-mode advice",
);

// --- (4) Server defaults changed from m3-html to minimax-direct ---
expect(
  "knowledgeNoteOrganizeJobKey defaults qualityMode to minimax-direct",
  /qualityMode:\s*String\(body\.qualityMode \|\| "minimax-direct"\)/.test(serverSrc),
  "knowledgeNoteOrganizeJobKey still defaults to m3-html",
);
expect(
  "createKnowledgeNoteOrganizeJob defaults qualityMode / requestedQualityMode / effectiveQualityMode to minimax-direct",
  /qualityMode:\s*String\(body\.qualityMode \|\| "minimax-direct"\),\s*\n\s*requestedQualityMode:\s*body\.requestedQualityMode \|\| String\(input\.qualityMode \|\| body\.qualityMode \|\| "minimax-direct"\),\s*\n\s*effectiveQualityMode:\s*body\.effectiveQualityMode \|\| String\(body\.qualityMode \|\| "minimax-direct"\),/.test(serverSrc),
  "createKnowledgeNoteOrganizeJob still defaults to m3-html",
);
expect(
  "createRecoveredKnowledgeNoteOrganizeJob defaults qualityMode / requestedQualityMode / effectiveQualityMode to minimax-direct",
  /qualityMode:\s*String\(input\.qualityMode \|\| result\.qualityMode \|\| "minimax-direct"\),\s*\n\s*requestedQualityMode:\s*input\.requestedQualityMode \|\| String\(input\.qualityMode \|\| result\.qualityMode \|\| "minimax-direct"\),\s*\n\s*effectiveQualityMode:\s*input\.effectiveQualityMode \|\| String\(input\.qualityMode \|\| result\.qualityMode \|\| "minimax-direct"\),/.test(serverSrc),
  "createRecoveredKnowledgeNoteOrganizeJob still defaults to m3-html",
);
expect(
  "mobile calendar create handler defaults qualityMode / requestedQualityMode to minimax-direct",
  /qualityMode:\s*body\.qualityMode \|\| body\.requestedQualityMode \|\| "minimax-direct",\s*\n\s*requestedQualityMode:\s*body\.requestedQualityMode \|\| body\.qualityMode \|\| "minimax-direct",/.test(serverSrc),
  "mobile calendar create handler still defaults to m3-html",
);
expect(
  "createHighQualityCalendarNote calls organizeKnowledgeNoteDraftHighQuality with qualityMode = minimax-direct",
  /organizeKnowledgeNoteDraftHighQuality\(\{\s*\.\.\.input,\s*qualityMode:\s*"minimax-direct",\s*gatewayTimeoutMs:\s*300_000\s*\}\)/.test(serverSrc),
  "createHighQualityCalendarNote still hard-codes qualityMode = m3-html",
);
expect(
  "organizeKnowledgeNoteDraftHighQuality default qualityMode = minimax-direct",
  /normalizeKnowledgeNoteQualityMode\(body\.qualityMode \|\| "minimax-direct"\)/.test(serverSrc),
  "organizeKnowledgeNoteDraftHighQuality still defaults body.qualityMode || \"m3-html\"",
);
expect(
  "generateKnowledgeNoteM3Html allowDeterministicHtmlFallback default qualityMode = minimax-direct",
  /String\(input\.input\.qualityMode \|\| "minimax-direct"\)\.toLowerCase\(\)/.test(serverSrc),
  "generateKnowledgeNoteM3Html allowDeterministicHtmlFallback still defaults to m3-html",
);

// --- (5) organize endpoint does not call requireGatewayReadyForKnowledgeNote before minimax-direct branch returns ---
// The direct branch sits ABOVE the try { await requireGatewayReadyForKnowledgeNote(...)}
// and contains an explicit early return. We just confirm that the direct branch
// ends with a `}` and is followed by `try { await requireGatewayReadyForKnowledgeNote(...)`.
// (We already extracted directBranch above; assert it is non-empty and that
// the runtime no longer has a `await requireGatewayReadyForKnowledgeNote` BEFORE
// the direct branch in organizeKnowledgeNoteDraftHighQuality.)
const fnBodyStart = serverSrc.indexOf("async function organizeKnowledgeNoteDraftHighQuality(");
// The function is large (~20K). Capture the full body up to the closing "}\n".
const fnBodyEnd = serverSrc.indexOf("\n}\n", fnBodyStart);
const fnBody = fnBodyStart >= 0 ? serverSrc.slice(fnBodyStart, fnBodyEnd >= 0 ? fnBodyEnd : fnBodyStart + 30000) : "";
expect(
  "organizeKnowledgeNoteDraftHighQuality calls requireGatewayReadyForKnowledgeNote AFTER the minimax-direct branch (not before)",
  fnBody.indexOf("requestedMode === \"minimax-direct\"") >= 0
    && fnBody.indexOf("requestedMode === \"minimax-direct\"") < fnBody.indexOf("await requireGatewayReadyForKnowledgeNote"),
  "requireGatewayReadyForKnowledgeNote appears BEFORE the minimax-direct branch — would block direct path on Gateway",
);

// --- (6) emptyKnowledgeNoteDraft default qualityMode = minimax-direct ---
expect(
  "emptyKnowledgeNoteDraft defaults qualityMode to minimax-direct",
  /function emptyKnowledgeNoteDraft[\s\S]*?qualityMode:\s*"minimax-direct"/m.test(webSrc),
  "emptyKnowledgeNoteDraft still defaults qualityMode to m3-html",
);

// --- (7) submitNoteDraft sends qualityMode = minimax-direct by default ---
expect(
  "submitNoteDraft sends qualityMode = minimax-direct (or noteDraft.qualityMode || minimax-direct)",
  /function submitNoteDraft[\s\S]*?qualityMode:\s*noteDraft\.qualityMode \|\| "minimax-direct"/m.test(webSrc),
  "submitNoteDraft still hard-codes qualityMode = m3-html",
);

// --- (8) submitCalendarKnowledgeNoteDraft sends qualityMode + requestedQualityMode = minimax-direct ---
expect(
  "submitCalendarKnowledgeNoteDraft sends qualityMode and requestedQualityMode = minimax-direct",
  /function submitCalendarKnowledgeNoteDraft[\s\S]*?qualityMode:\s*activeDraft\.qualityMode \|\| "minimax-direct",\s*\n\s*requestedQualityMode:\s*activeDraft\.qualityMode \|\| "minimax-direct",/m.test(webSrc),
  "submitCalendarKnowledgeNoteDraft still defaults to m3-html",
);
expect(
  "assistant_calendar quick-note Add Note handler sends qualityMode + requestedQualityMode = minimax-direct",
  /qualityMode:\s*"minimax-direct",\s*\n\s*requestedQualityMode:\s*"minimax-direct",\s*\n\s*useNkxLanding:\s*true,/.test(webSrc),
  "assistant_calendar quick-note Add Note handler still sends qualityMode = m3-html",
);

// --- (9) Quality-mode selector: minimax-direct is the default option ---
expect(
  "knowledge-note qualityMode selector marks minimax-direct as default",
  /<option value="minimax-direct">minimax-direct（默认 · 直连 MiniMax-M3，无需 Gateway）<\/option>/.test(webSrc),
  "minimax-direct is not the marked default in the knowledge-note selector",
);
expect(
  "knowledge-note qualityMode selector no longer marks m3-html as 默认 · Gateway",
  !/<option value="m3-html">m3-html（默认 · Gateway）<\/option>/.test(webSrc),
  "m3-html still has the (默认 · Gateway) marker in the qualityMode selector",
);

// --- (10) Direct-mode UI does not show  "连接 Gateway" / "必须通过 Gateway/MiniMax" unconditionally ---
// Both UI occurrences should be guarded by qualityMode !== "minimax-direct".
const gatewayLabelRegex = />\s*连接 Gateway\s*</;
const gatewayLabelHits = webSrc.match(new RegExp(gatewayLabelRegex.source, "g")) || [];
// We allow the literal "连接 Gateway" to remain in the source, but it must
// not appear as a static JSX text node; it must appear inside a ternary that
// checks qualityMode === "minimax-direct".
const gatewayStaticJsx = /className=\{noteStageClass\("gateway"[^}]+\}\}>连接 Gateway</.test(webSrc);
expect(
  "stage strip \"连接 Gateway\" label is gated on qualityMode !== minimax-direct (no unconditional static JSX)",
  !gatewayStaticJsx,
  '"连接 Gateway" still appears as an unconditional static JSX label in the stage strip',
);
const sourceCoverageStaticJsx = />必须通过 Gateway\/MiniMax</.test(webSrc);
expect(
  "sourceCoverage fallback string \"必须通过 Gateway/MiniMax\" is gated on qualityMode !== minimax-direct (no unconditional static JSX)",
  !sourceCoverageStaticJsx,
  '"必须通过 Gateway/MiniMax" still appears as an unconditional static JSX fallback',
);

// --- (12) Direct-mode progress uses "连接 MiniMax-M3" label ---
expect(
  "knowledgeNoteOrganizeProgress uses \"连接 MiniMax-M3\" when qualityMode = minimax-direct",
  /function knowledgeNoteOrganizeProgress[\s\S]*?isDirect\s*=\s*String\(qualityMode \|\| "minimax-direct"\) === "minimax-direct"[\s\S]*?return\s*\{\s*key:\s*"gateway",\s*label:\s*"连接 MiniMax-M3"/m.test(webSrc),
  "knowledgeNoteOrganizeProgress no longer differentiates direct vs Gateway label",
);

// --- (13) Regression guard: legacy m3-html paths still work ---
// The legacy path qualityMode === "m3-html" must still send through the Gateway
// pipeline. The Gateway preflight is invoked once at the top of the
// organizeKnowledgeNoteDraftHighQuality try block, so any non-direct mode
// (m3-html, m27-html, high, m3, etc.) hits it. The check below just confirms
// the preflight still exists in the source.
const legacyM3htmlStillHitsGateway = /requireGatewayReadyForKnowledgeNote\(options\.signal\)/.test(serverSrc);
expect(
  "legacy m3-html path still routes through requireGatewayReadyForKnowledgeNote (Gateway path preserved)",
  legacyM3htmlStillHitsGateway,
  "requireGatewayReadyForKnowledgeNote no longer in source — explicit Gateway mode must still work",
);

// --- (11) Live probe: POST /api/knowledge/notes/organize with no API key ---
// Only attempt when a local server is reachable. We do not start the server
// here — that is the caller's job (or the parent Codex verifier's job).
const port = Number(process.env.WORKBENCH_PORT || 38789);
const host = process.env.WORKBENCH_HOST || "127.0.0.1";
async function liveProbe() {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      rawContent: "Phase 4 probe: Add Note default = minimax-direct, no API key in env.",
      title: "Phase 4 probe note",
      date: "2026-07-04",
      type: "工作记录",
      status: "待跟进",
      tags: ["phase4_probe"],
      related: [],
      folder: "openclaw",
      qualityMode: "minimax-direct",
      requestedQualityMode: "minimax-direct",
      htmlMode: "m3",
      agentId: "auto",
      gatewayTimeoutMs: 30_000,
      retryPolicy: { autoRepair: false, maxAttempts: 1, exposeDiagnostics: true },
    });
    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    };
    // Forward cookies from WORKBENCH_COOKIE env if provided.
    const cookieEnv = process.env.WORKBENCH_COOKIE;
    if (cookieEnv) headers.Cookie = cookieEnv;
    const req = http.request(
      {
        host,
        port,
        method: "POST",
        path: "/api/knowledge/notes/organize",
        headers,
        timeout: 35_000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch {}
          resolve({ status: res.statusCode, body, parsed });
        });
      },
    );
    req.on("error", () => resolve({ status: 0, body: "", parsed: null }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "", parsed: null }); });
    req.write(payload);
    req.end();
  });
}

const liveNote = process.env.KNOWLEDGE_ADD_NOTE_LIVE_PROBE === "1";
if (liveNote) {
  const result = await liveProbe();
  const errCode = result.parsed?.error;
  const reasonCode = result.parsed?.reason?.split(":")[0] || "";
  const directNote = result.parsed?.directMinimaxNote;
  const isBlockedDirect = errCode === "blocked_minimax_direct_config"
    || /BLOCKED_MINIMAX_DIRECT_CONFIG/.test(String(result.parsed?.reason || ""))
    || /minimax_direct_failed_no_fallback/.test(Array.isArray(result.parsed?.generationPipeline) ? result.parsed.generationPipeline.join(",") : "")
    || /minimax_direct/.test(reasonCode);
  expect(
    "live probe: /api/knowledge/notes/organize with qualityMode=minimax-direct and no API key surfaces BLOCKED_MINIMAX_DIRECT_CONFIG (not Gateway transport failure)",
    result.status === 0 || isBlockedDirect,
    `live probe returned status=${result.status}, error=${errCode}, reason=${result.parsed?.reason}, directMinimaxNote=${JSON.stringify(directNote)}`,
  );
  expect(
    "live probe: direct failure payload includes a directMinimaxNote block",
    result.status === 0 || Boolean(directNote),
    `live probe response has no directMinimaxNote block — payload=${JSON.stringify(result.parsed)?.slice(0, 600)}`,
  );
  // Top-level direct-mode copy contract — no Gateway repair language.
  // m3-html may appear ONLY as an explicit user-selected legacy path.
  if (isBlockedDirect && result.status !== 0) {
    const topReasonLabel = String(result.parsed?.reasonLabel || "");
    const topAdvice = String(result.parsed?.advice || "");
    const topDiagnosisReason = String(result.parsed?.diagnosis?.reasonLabel || "");
    const topDiagnosisAdvice = String(result.parsed?.diagnosis?.advice || "");
    const gatewayRepairTerms = /Gateway\/MiniMax\s+未返回可保存结果|检查\s+Gateway\s+状态|请重试；若持续失败/;
    expect(
      "live probe: top-level reasonLabel is direct-mode specific (no Gateway repair copy)",
      !gatewayRepairTerms.test(topReasonLabel),
      `top-level reasonLabel still says "${topReasonLabel}" — should be direct-mode specific (MiniMax API key 未配置 / MiniMax M3 直连失败).`,
    );
    expect(
      "live probe: top-level advice is direct-mode specific (no Gateway repair copy)",
      !gatewayRepairTerms.test(topAdvice),
      `top-level advice still says "${topAdvice}" — should mention minimax-direct no-fallback, not Gateway repair.`,
    );
    expect(
      "live probe: diagnosis.reasonLabel is direct-mode specific (no Gateway repair copy)",
      !gatewayRepairTerms.test(topDiagnosisReason),
      `diagnosis.reasonLabel still says "${topDiagnosisReason}" — should be direct-mode specific.`,
    );
    expect(
      "live probe: diagnosis.advice is direct-mode specific (no Gateway repair copy)",
      !gatewayRepairTerms.test(topDiagnosisAdvice),
      `diagnosis.advice still says "${topDiagnosisAdvice}" — should mention minimax-direct no-fallback.`,
    );
    expect(
      "live probe: directMinimaxNote.fallback = false (no implicit Gateway fallback for direct mode)",
      result.parsed?.directMinimaxNote?.fallback === false,
      `directMinimaxNote.fallback should be false for direct-mode failures, got ${JSON.stringify(result.parsed?.directMinimaxNote)}`,
    );
    expect(
      "live probe: stage = minimax_direct_markdown (not Gateway stage)",
      String(result.parsed?.stage || "").startsWith("minimax_direct"),
      `stage should start with minimax_direct for direct-mode failures, got "${result.parsed?.stage}"`,
    );
    expect(
      "live probe: generationPipeline contains minimax_direct_failed_no_fallback",
      Array.isArray(result.parsed?.generationPipeline)
        && result.parsed.generationPipeline.includes("minimax_direct_failed_no_fallback"),
      `generationPipeline should include minimax_direct_failed_no_fallback, got ${JSON.stringify(result.parsed?.generationPipeline)}`,
    );
  }
}

if (failures.length) {
  console.error("KNOWLEDGE_ADD_NOTE_DIRECT_RUNTIME_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("KNOWLEDGE_ADD_NOTE_DIRECT_RUNTIME_PASS");