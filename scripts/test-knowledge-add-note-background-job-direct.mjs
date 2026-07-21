// 2026-07-05 — T9 njx-knowledge v2 Add Note background-job direct-mode rework.
//
// Codex's previous finalization pass only verified the synchronous
// /api/knowledge/notes/organize direct-runtime path. NJX then tested the
// real UI flow (Calendar "添加笔记 / 同步日程" + Knowledge page background
// job) and found the background-job path still emitted hard-coded
// Gateway/MiniMax copy:
//
//   - queued status: "已加入添加笔记后台队列；…避免 Gateway 并发拥塞。"
//   - running status: "正在后台执行 Gateway/MiniMax 整理…"
//   - stage button: "连接 Gateway"
//   - chip: "必须通过 Gateway/MiniMax"
//   - diagnosis category: "Gateway 不可用"
//   - diagnosis body:  "Workbench/Gateway transport failed during Add Note
//                        organize request."
//
// Knowledge v2 is not product-accepted until the real background-job path
// only emits direct-mode copy for default direct jobs. This probe enforces
// the post-rework contract at source level (no live server required):
//
//   SERVER (apps/server/src/index.ts):
//     (1)  Mode-aware helpers exist (knowledgeNoteJobDirectLabel +
//          knowledgeNoteJobIsDirect) and resolve to "MiniMax-M3 直连" for
//          default qualityMode (empty / missing / "minimax-direct") and
//          "Gateway/MiniMax" otherwise.
//     (2)  runKnowledgeNoteOrganizeJob no longer carries the literal
//          hard-coded copy "正在后台执行 Gateway/MiniMax 整理" /
//          "Gateway/MiniMax 整理等待较久" / "等待 Gateway/MiniMax 当前结果" /
//          "继续等待 Gateway/MiniMax 整理结果" /
//          "继续等待当前 Gateway/MiniMax 结果" /
//          "继续最后一次 Gateway/MiniMax 重试" /
//          "中止当前 Gateway 等待" in the run loop messages. Each has
//          been replaced with a `directLabel` template literal so direct
//          mode reads "MiniMax-M3 直连" instead.
//     (3)  processKnowledgeNoteOrganizeQueue initial running message uses
//          the helper (not the hard-coded Gateway/MiniMax literal).
//     (4)  diagnoseKnowledgeNoteFailureForMode is registered, replaces
//          "Gateway 不可用" / "重新连接 Gateway" / "Workbench 已到达
//          Gateway/MiniMax 通道" copy with direct-mode specific copy and
//          emits "不要重启 OpenClaw Gateway" repair directive. Legacy
//          m3-html/m27-html still produces the Gateway copy.
//     (5)  buildKnowledgeNoteFailurePayload falls back to
//          diagnoseKnowledgeNoteFailureForMode for the failure.diagnosis
//          default.
//     (6)  normalizeKnowledgeNoteOrganizeReportForRuntime routes the
//          stale-job label through knowledgeNoteJobIsDirect.
//     (7)  /api/knowledge/notes/organize abort reply uses
//          knowledgeNoteJobIsDirect for the abort label.
//
//   WEB (apps/web/src/App.tsx):
//     (8)  knowledgeNoteDraftWithOpsRecovery is mode-aware: for default
//          minimax-direct qualityMode it emits "MiniMax-M3 直连失败" +
//          "MiniMax-M3 直连 transport failed during Add Note organize
//          request." + "不要重启 OpenClaw Gateway". Legacy m3-html keeps
//          the Gateway copy.
//     (9)  runKnowledgeNoteOpsRecovery accepts opts: { qualityMode } and
//          emits the direct-mode Worker task title / queue label /
//          anti-restart directive for default direct mode.
//    (10)  organizeKnowledgeNoteWithOpsRetry passes payload.qualityMode
//          into runKnowledgeNoteOpsRecovery.
//    (11)  submitCalendarKnowledgeNoteDraft catch branch uses
//          activeDraft.qualityMode to switch the "MiniMax-M3 直连失败"
//          vs. "Gateway/MiniMax 整理失败" message.
//
//   REGRESSION GUARDS:
//    (12) Legacy m3-html / m27-html mode branch still produces
//         "Gateway/MiniMax" wording in the mode-aware template literals.
//    (13) The pre-existing Phase 4 direct contract from
//         test-knowledge-add-note-direct-runtime.mjs holds (re-executed
//         after this probe runs).
//
// Read-only: only reads files. Never mutates the tree. Deterministic when
// the env is stable.
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
const webSrc = read("apps/web/src/App.tsx");

// Extract a top-level function body by name. Looks for `^function NAME` or
// `^async function NAME` at column 0 (TypeScript top-level definitions).
function extractFunctionBody(src, name) {
  // Try to find the function definition (top-level) and walk to closing brace.
  const re = new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) return "";
  const start = m.index;
  // Skip past the parameter list by finding the matching `)`. Naive
  // paren-counting — assumes no string literals in the parameter list (true
  // for the knowledge note helpers we target).
  let parenDepth = 0;
  let i = start;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === "(") parenDepth += 1;
    else if (c === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) break;
    }
  }
  // Now walk past the return type annotation if any (between `)` and `{`).
  // Skip past any whitespace, then look for `{`.
  let j = i + 1;
  for (; j < src.length; j += 1) {
    const c = src[j];
    if (c === "{" || c === ";") break; // function body or statement ending
  }
  if (j >= src.length || src[j] !== "{") return ""; // not a function body
  let depth = 0;
  for (; j < src.length; j += 1) {
    const c = src[j];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  return src.slice(start);
}

// --- (1) Mode-aware helper exists ---
const directLabelBody = extractFunctionBody(serverSrc, "knowledgeNoteJobDirectLabel");
const isDirectBody = extractFunctionBody(serverSrc, "knowledgeNoteJobIsDirect");
expect(
  "knowledgeNoteJobDirectLabel function body is non-empty",
  Boolean(directLabelBody) && directLabelBody.includes('"MiniMax-M3 直连"'),
  "knowledgeNoteJobDirectLabel is missing or has no 'MiniMax-M3 直连' literal",
);
expect(
  "knowledgeNoteJobDirectLabel falls back to 'Gateway/MiniMax' for legacy",
  directLabelBody.includes('"Gateway/MiniMax"'),
  "knowledgeNoteJobDirectLabel has no 'Gateway/MiniMax' fallback literal",
);
expect(
  "knowledgeNoteJobIsDirect function body is non-empty",
  Boolean(isDirectBody),
  "knowledgeNoteJobIsDirect missing",
);
expect(
  "knowledgeNoteJobIsDirect is strict-mode (=== minimax-direct)",
  /===\s*"minimax-direct"/.test(isDirectBody),
  "knowledgeNoteJobIsDirect lacks the strict === minimax-direct compare",
);
expect(
  "knowledgeNoteJobRequestedMode defaults to 'minimax-direct'",
  extractFunctionBody(serverSrc, "knowledgeNoteJobRequestedMode").includes('"minimax-direct"'),
  "knowledgeNoteJobRequestedMode does not default to minimax-direct",
);

// --- (2) runKnowledgeNoteOrganizeJob message strings no longer hard-code
// "Gateway/MiniMax"; each replaced with `directLabel` template interpolation.
const runJobBody = extractFunctionBody(serverSrc, "runKnowledgeNoteOrganizeJob");
expect(
  "runKnowledgeNoteOrganizeJob body is non-empty",
  Boolean(runJobBody) && runJobBody.length > 200,
  "runKnowledgeNoteOrganizeJob body extraction failed",
);
const literalStringsToBan = [
  "正在后台执行 Gateway/MiniMax 整理",
  "Gateway/MiniMax 整理等待较久",
  "继续等待 Gateway/MiniMax 整理结果",
  "继续等待当前 Gateway/MiniMax 结果",
  "继续最后一次 Gateway/MiniMax 重试",
  "中止当前 Gateway 等待",
  "等待 Gateway/MiniMax 当前结果",
  "本轮双阶段整理超过",
];
for (const banned of literalStringsToBan) {
  expect(
    `runKnowledgeNoteOrganizeJob no longer carries literal "${banned}"`,
    !runJobBody.includes(banned),
    `runKnowledgeNoteOrganizeJob still carries "${banned}" — direct-mode jobs would surface this verbatim`,
  );
}
expect(
  "runKnowledgeNoteOrganizeJob uses ${directLabel} template literal in running message",
  runJobBody.includes("${directLabel} 整理"),
  "running message does not use the ${directLabel} template literal",
);
expect(
  "runKnowledgeNoteOrganizeJob uses ${directLabel} template literal in retry count message",
  /Worker\s+运维恢复后正在执行第\s+\$\{jobAttempt\}\/\$\{[^}]+\}\s+轮\s+\$\{directLabel\}/.test(runJobBody),
  "retry count message does not use the ${directLabel} template literal",
);
expect(
  "runKnowledgeNoteOrganizeJob uses ${directLabel} template literal in queued message",
  /Worker\s+运维恢复已确认，已中止悬挂请求，将自动进行第\s+\$\{jobAttempt\s*\+\s*1\}\/\$\{[^}]+\}\s+轮\s+\$\{directLabel\}/.test(runJobBody),
  "queued message after recovery does not use the ${directLabel} template literal",
);
expect(
  "runKnowledgeNoteOrganizeJob uses ${directLabel} in late-session success message",
  runJobBody.includes("已回收同一 sourceHash 的 ${directLabel} 迟到"),
  "late-session success message does not use the ${directLabel} template literal",
);
expect(
  "runKnowledgeNoteOrganizeJob uses ${directLabel} in final failure fallback",
  /finalReasonLabel\s*=\s*failure\.reasonLabel\s*\|\|\s*\(knowledgeNoteJobIsDirect\(job\)\s*\?\s*`\$\{directLabel\}\s+直连未返回可保存结果`\s*:\s*`\$\{directLabel\}\s+未返回可保存结果`\)/.test(runJobBody),
  "final failure fallback does not branch on knowledgeNoteJobIsDirect for direct-mode wording",
);
expect(
  "runKnowledgeNoteOrganizeJob computes directLabel at the top of the function",
  runJobBody.includes("const directLabel = knowledgeNoteJobDirectLabel(job)"),
  "runKnowledgeNoteOrganizeJob does not derive directLabel at the top",
);

// --- (3) processKnowledgeNoteOrganizeQueue initial running message uses helper ---
const queueFnBody = extractFunctionBody(serverSrc, "processKnowledgeNoteOrganizeQueue");
expect(
  "processKnowledgeNoteOrganizeQueue running message uses ${directLabel}",
  /message:\s*`正在后台执行\s+\$\{directLabel\}\s+整理；其他添加笔记会排队等待/.test(queueFnBody),
  `processKnowledgeNoteOrganizeQueue initial running message does not use a template literal: ${queueFnBody.slice(0, 500)}`,
);

// --- (4) diagnoseKnowledgeNoteFailureForMode exists and mode-aware override ---
const modDiagnoseBody = extractFunctionBody(serverSrc, "diagnoseKnowledgeNoteFailureForMode");
expect(
  "diagnoseKnowledgeNoteFailureForMode body is non-empty",
  Boolean(modDiagnoseBody) && modDiagnoseBody.length > 200,
  "diagnoseKnowledgeNoteFailureForMode not found in server source",
);
expect(
  "diagnoseKnowledgeNoteFailureForMode overrides category to direct-specific copy",
  /category:\s*isConfigMissing\s*\?\s*"MiniMax API key 未配置"\s*:\s*"MiniMax-M3 直连失败"/.test(modDiagnoseBody),
  "diagnoseKnowledgeNoteFailureForMode does not override category for direct-mode failures",
);
expect(
  "diagnoseKnowledgeNoteFailureForMode emits '不要重启 OpenClaw Gateway' repair directive",
  /repairDirectives:\s*\[[^\]]*"不要重启 OpenClaw Gateway"/.test(modDiagnoseBody),
  "diagnoseKnowledgeNoteFailureForMode does not emit anti-Gateway repair directive",
);
expect(
  "diagnoseKnowledgeNoteFailureForMode differentiates rootCause for config-missing direct failure",
  /rootCause:\s*isConfigMissing\s*\?\s*"minimax-direct\s+模式下/.test(modDiagnoseBody),
  "diagnoseKnowledgeNoteFailureForMode does not differentiate rootCause for config-missing direct failure",
);
expect(
  "diagnoseKnowledgeNoteFailureForMode differentiates advice for direct failure",
  /advice:\s*isConfigMissing\s*\?\s*"minimax-direct\s+模式下不做\s+Gateway\s+隐式\s+fallback/.test(modDiagnoseBody),
  "diagnoseKnowledgeNoteFailureForMode does not differentiate advice for direct failure",
);

// --- (5) buildKnowledgeNoteFailurePayload falls back to diagnoseKnowledgeNoteFailureForMode ---
const buildPayloadBody = extractFunctionBody(serverSrc, "buildKnowledgeNoteFailurePayload");
expect(
  "buildKnowledgeNoteFailurePayload falls back to diagnoseKnowledgeNoteFailureForMode for diagnosis default",
  buildPayloadBody.includes("diagnoseKnowledgeNoteFailureForMode("),
  "buildKnowledgeNoteFailurePayload does not fall back to diagnoseKnowledgeNoteFailureForMode",
);

// --- (6) normalizeKnowledgeNoteOrganizeReportForRuntime routes stale label through helper ---
const staleReportBody = extractFunctionBody(serverSrc, "normalizeKnowledgeNoteOrganizeReportForRuntime");
expect(
  "normalizeKnowledgeNoteOrganizeReportForRuntime routes stale message label through helper",
  /knowledgeNoteJobIsDirect\(\{[\s\S]*?qualityMode:[\s\S]*?requestedQualityMode:[\s\S]*?effectiveQualityMode[\s\S]*?\}\s+as\s+Record<string,\s*unknown>\)/.test(staleReportBody)
    && /message:\s*`后台整理任务报告已超过心跳窗口；Workbench\s+可能已重启或\s+\$\{staleJobLabel\}\s+请求失去收敛/.test(staleReportBody),
  "normalizeKnowledgeNoteOrganizeReportForRuntime stale message uses a hard-coded Gateway/MiniMax literal",
);

// --- (7) /api/knowledge/notes/organize abort reply uses knowledgeNoteJobIsDirect for label ---
expect(
  "/api/knowledge/notes/organize abort reply uses abortLabel through knowledgeNoteJobIsDirect",
  /Knowledge\s+添加笔记整理请求已停止，后端已中止等待\s+\$\{abortLabel\}/.test(serverSrc)
    && /const\s+abortLabel\s*=\s*knowledgeNoteJobIsDirect\(/.test(serverSrc),
  "/api/knowledge/notes/organize abort reply still uses a hard-coded Gateway/MiniMax literal",
);

// --- (8) web knowledgeNoteDraftWithOpsRecovery is mode-aware ---
const webOpsRecoveryBody = extractFunctionBody(webSrc, "knowledgeNoteDraftWithOpsRecovery");
expect(
  "knowledgeNoteDraftWithOpsRecovery is mode-aware (effectiveQualityMode / direct branch)",
  /effectiveMode\s*=\s*String\(\s*draft\.qualityMode\s*\|\|\s*"minimax-direct"\s*\)/.test(webOpsRecoveryBody)
    && /isDirect\s*=\s*effectiveMode\s*===\s*"minimax-direct"/.test(webOpsRecoveryBody),
  "knowledgeNoteDraftWithOpsRecovery lacks the minimax-direct default branch",
);
expect(
  "knowledgeNoteDraftWithOpsRecovery emits 'MiniMax-M3 直连失败' category for direct mode",
  /category:\s*qualityFailure\s*\?\s*"内容质量修复与运维恢复"\s*:\s*\(isDirect\s*\?\s*"MiniMax-M3 直连失败"\s*:\s*"Gateway 不可用"\)/.test(webOpsRecoveryBody),
  "knowledgeNoteDraftWithOpsRecovery still falls back to 'Gateway 不可用' for direct mode",
);
expect(
  "knowledgeNoteDraftWithOpsRecovery rootCause for direct mode does NOT say Workbench/Gateway transport failed",
  /isDirect\s*\?\s*"MiniMax-M3 直连 transport failed[^"]+"\s*:\s*"Workbench\/Gateway transport failed during Add Note organize request\."/.test(webOpsRecoveryBody),
  "knowledgeNoteDraftWithOpsRecovery still emits the Workbench/Gateway transport failed rootCause for direct mode",
);
expect(
  "knowledgeNoteDraftWithOpsRecovery inserts '不要重启 OpenClaw Gateway' repair directive",
  /不要重启\s+OpenClaw\s+Gateway/.test(webOpsRecoveryBody),
  "knowledgeNoteDraftWithOpsRecovery lacks '不要重启 OpenClaw Gateway' anti-restart directive",
);

// --- (9) web runKnowledgeNoteOpsRecovery is mode-aware via opts.qualityMode ---
const webOpsRecoverBody = extractFunctionBody(webSrc, "runKnowledgeNoteOpsRecovery");
expect(
  "runKnowledgeNoteOpsRecovery accepts opts: { qualityMode }",
  /runKnowledgeNoteOpsRecovery\([^]*?opts:\s*\{\s*qualityMode\?:\s*string\s*\}/.test(webOpsRecoverBody),
  "runKnowledgeNoteOpsRecovery does not accept opts.qualityMode (no opts: { qualityMode?: string } arg)",
);
expect(
  "runKnowledgeNoteOpsRecovery derives labelM / queueLabel / forbiddenRecovery from opts.qualityMode",
  /const isDirect\s*=\s*effectiveMode\s*===\s*"minimax-direct"/.test(webOpsRecoverBody)
    && /const labelM\s*=\s*isDirect\s*\?\s*"MiniMax-M3 直连"\s*:\s*"Gateway\/MiniMax"/.test(webOpsRecoverBody)
    && /MiniMax API key \/ model_configs/.test(webOpsRecoverBody)
    && /禁止重启\s+OpenClaw\s+Gateway/.test(webOpsRecoverBody),
  "runKnowledgeNoteOpsRecovery is not mode-aware on title / queue label / forbidden recovery directive",
);

// --- (10) organizeKnowledgeNoteWithOpsRetry passes payload.qualityMode ---
expect(
  "organizeKnowledgeNoteWithOpsRetry calls runKnowledgeNoteOpsRecovery with { qualityMode: ... }",
  /runKnowledgeNoteOpsRecovery\(\s*reason\s*,\s*attempt\s*,\s*onStatus\s*,\s*\{\s*qualityMode:\s*String\(\s*payload\.qualityMode\s*\|\|\s*"minimax-direct"\s*\)[^)]*\)/.test(webSrc),
  "organizeKnowledgeNoteWithOpsRetry still calls runKnowledgeNoteOpsRecovery without qualityMode",
);

// --- (11) submitCalendarKnowledgeNoteDraft catch uses activeDraft.qualityMode ---
expect(
  "submitCalendarKnowledgeNoteDraft catch uses activeDraft.qualityMode to swap error wording",
  /isDirectQualityMode\s*=\s*String\(\s*activeDraft\.qualityMode\s*\|\|\s*"minimax-direct"\s*\)\s*===\s*"minimax-direct"/.test(webSrc),
  "submitCalendarKnowledgeNoteDraft catch still hard-codes 'Gateway/MiniMax 整理失败' for direct mode",
);

// --- (12) Legacy m3-html / m27-html mode branch still produces 'Gateway/MiniMax' wording ---
expect(
  "Legacy m3-html / m27-html mode branch still produces 'Gateway/MiniMax' wording in mode-aware template (server)",
  /knowledgeNoteJobIsDirect\([^)]*\)\s*\?\s*"MiniMax-M3 直连"\s*:\s*"Gateway\/MiniMax"/.test(serverSrc),
  "Legacy m3-html / m27-html no longer produces Gateway/MiniMax wording in the server mode-aware template",
);
expect(
  "Web UI legacy 'Gateway/MiniMax 整理失败' wording preserved for legacy modes",
  /`Gateway\/MiniMax\s+整理失败：\$\{failureDetail\}`/.test(webSrc)
    || /`Gateway\/MiniMax\s+整理失败：\$\{message\}`/.test(webSrc)
    || /`Gateway\/MiniMax\s+整理失败：\$\{rawError\}`/.test(webSrc),
  "Web UI legacy Gateway/MiniMax wording has been deleted entirely — regression guard",
);

// --- (12.5) createKnowledgeNoteOrganizeJob queued-state message is mode-aware (rework #2) ---
//
// NJX found the initial queued message (returned from POST
// /api/knowledge/notes/organize-jobs with status="queued") still emitted
// the hard-coded literal "已加入添加笔记后台队列；…避免 Gateway 并发拥塞。"
// for default minimax-direct jobs. This block verifies the rework:
//   * The createKnowledgeNoteOrganizeJob function must define a queuedMessage
//     (or equivalent) computed via knowledgeNoteJobIsDirect from the body's
//     qualityMode (not a literal Gateway copy).
//   * The hard-coded literal "已加入添加笔记后台队列；相同内容重复提交会复用同一个 job，避免 Gateway 并发拥塞。"
//     must NOT appear as the *default* queued message (it must be wrapped
//     in a ternary / conditional so direct-mode jobs never see it).
//   * The direct-mode branch must contain none of the 6 forbidden substrings.
//   * The legacy-mode branch (else) must still contain Gateway wording
//     (regression guard so m3-html users still see what they expect).
//
// Note: we use the wider serverSrc view directly (the existing extractor
// can't handle TypeScript return-type annotations like
// `: { job: KnowledgeNoteOrganizeJob; reused: boolean }`).
expect(
  "createKnowledgeNoteOrganizeJob defines a queuedMessage variable (mode-aware queued text)",
  /function\s+createKnowledgeNoteOrganizeJob[\s\S]*?const\s+queuedMessage\s*=/m.test(serverSrc),
  "createKnowledgeNoteOrganizeJob does not define a queuedMessage variable — direct-mode queued copy may still hard-code Gateway",
);
expect(
  "createKnowledgeNoteOrganizeJob's queuedMessage is computed via knowledgeNoteJobIsDirect",
  /function\s+createKnowledgeNoteOrganizeJob[\s\S]*?knowledgeNoteJobIsDirect\(\s*\{[\s\S]*?qualityMode:[\s\S]*?requestedQualityMode:[\s\S]*?effectiveQualityMode[\s\S]*?\}\s*\)[\s\S]*?const\s+queuedMessage\s*=/m.test(serverSrc),
  "createKnowledgeNoteOrganizeJob does not derive queuedMessage via knowledgeNoteJobIsDirect",
);
expect(
  "createKnowledgeNoteOrganizeJob's queuedMessage ternary has a direct branch starting with '已加入 MiniMax-M3 直连后台队列'",
  /function\s+createKnowledgeNoteOrganizeJob[\s\S]*?queuedMessage\s*=\s*[A-Za-z_$][\w$]*\s*\?\s*["']已加入\s+MiniMax-M3\s+直连后台队列/.test(serverSrc),
  "createKnowledgeNoteOrganizeJob does not have a direct-mode ternary branch starting with '已加入 MiniMax-M3 直连后台队列'",
);
// Extract the direct-mode literal (the truthy branch of the queuedMessage ternary).
const createJobQueuedMatch = serverSrc.match(/function\s+createKnowledgeNoteOrganizeJob[\s\S]*?const\s+queuedMessage\s*=\s*[A-Za-z_$][\w$]*\s*\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']/);
const directBranchLiteral = createJobQueuedMatch ? createJobQueuedMatch[1] : "";
const legacyBranchLiteral = createJobQueuedMatch ? createJobQueuedMatch[2] : "";
expect(
  "createKnowledgeNoteOrganizeJob direct-mode queued literal is non-empty and starts with '已加入'",
  Boolean(directBranchLiteral) && /已加入/.test(directBranchLiteral),
  `direct-mode literal is empty or wrong; got "${directBranchLiteral}"`,
);
expect(
  "createKnowledgeNoteOrganizeJob legacy-mode queued literal is non-empty and contains 'Gateway' (regression guard)",
  Boolean(legacyBranchLiteral) && /Gateway/.test(legacyBranchLiteral),
  `legacy-mode literal is empty or no longer mentions Gateway; got "${legacyBranchLiteral}" — would break m3-html users`,
);
// 6 forbidden substrings for the direct-mode branch.
const directForbidden = [
  "Gateway",
  "Gateway/MiniMax",
  "连接 Gateway",
  "必须通过 Gateway/MiniMax",
  "Gateway 不可用",
  "Workbench/Gateway transport failed during Add Note organize request.",
];
for (const banned of directForbidden) {
  expect(
    `createKnowledgeNoteOrganizeJob direct-mode queued literal does NOT contain "${banned}"`,
    !directBranchLiteral.includes(banned),
    `direct-mode queued literal "${directBranchLiteral}" still contains "${banned}"`,
  );
}
expect(
  "createKnowledgeNoteOrganizeJob direct-mode queued literal includes 'MiniMax-M3 直连' label",
  /MiniMax-M3\s+直连/.test(directBranchLiteral),
  `direct-mode queued literal "${directBranchLiteral}" missing 'MiniMax-M3 直连' label`,
);
expect(
  "createKnowledgeNoteOrganizeJob direct-mode queued literal preserves the 复用同一个 job 语义",
  /复用同一个\s+job/.test(directBranchLiteral),
  `direct-mode queued literal "${directBranchLiteral}" missing the '复用同一个 job' semantic`,
);
// Hard-coded legacy literal must NOT appear as the queued-state message field
// unconditionally — it must be wrapped in a ternary so direct-mode jobs never
// receive it verbatim.
const unconditionalLegacyQueued = /message:\s*["']已加入添加笔记后台队列；相同内容重复提交会复用同一个 job，避免 Gateway 并发拥塞。["']/.test(serverSrc);
expect(
  "No 'message: <literal containing 避免 Gateway 并发拥塞>' site remains anywhere in server source",
  !unconditionalLegacyQueued,
  "Found an unconditional queued-state message that still uses '避免 Gateway 并发拥塞' verbatim — direct jobs would surface it",
);

// --- (13) Pre-existing direct contract test still passes (re-execute) ---
{
  const { spawnSync } = await import("node:child_process");
  const res = spawnSync("node", ["scripts/test-knowledge-add-note-direct-runtime.mjs"], {
    cwd: repo,
    encoding: "utf8",
    timeout: 60_000,
  });
  const last = (res.stdout || "").trim().split("\n").slice(-1)[0] || "";
  expect(
    "scripts/test-knowledge-add-note-direct-runtime.mjs still returns KNOWLEDGE_ADD_NOTE_DIRECT_RUNTIME_PASS",
    last.includes("KNOWLEDGE_ADD_NOTE_DIRECT_RUNTIME_PASS") && res.status === 0,
    `previous direct-runtime probe returned status=${res.status}, last line="${last}"`,
  );
}

if (failures.length) {
  console.error("KNOWLEDGE_ADD_NOTE_BACKGROUND_JOB_DIRECT_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("KNOWLEDGE_ADD_NOTE_BACKGROUND_JOB_DIRECT_PASS");
