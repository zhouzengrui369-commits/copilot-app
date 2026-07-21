// 2026-07-03 — R7 stale recorder recovery regression.
//
// iPhone Mirroring surfaced a state where the voice workbench was stuck in
// "preview" with no path out: the fullscreen Modal blocked the home page and
// the visible "继续 / 取消" buttons all routed through the same Modal.
//
// This script enforces the contract end-to-end against source:
//   1. The home page must remain usable while recovery is pending.
//   2. Voice workbench must be inline (no fullscreen Modal covering home).
//   3. Boot-time stale recorder marker must surface a continue/discard
//      choice WITHOUT auto-deleting server data.
//   4. In-flight stale state must surface a recovery banner with three
//      actions: continue / discard / retry (no auto-delete either).
//   5. The existing duplicate-save guard must NOT regress.
//   6. closeVoiceWorkbench path must clear every per-device recorder
//      artifact (draft + session + recovery marker) so a cold start cannot
//      resurrect a stale state silently.
//   7. The saveQuickNote duplicate-save guard from R6 must remain
//      untouched (no double-save, no duplicate note).
//
// Exit 0 = regression passes. Exit 1 = contract violated.

import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

const failures = [];
function expect(label, predicate, detail) {
  if (!predicate) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

const screen = read("apps/mobile/src/screens/TodayConsoleScreen.tsx");
const storage = read("apps/mobile/src/lib/storage.ts");

// (1) Inline voice workbench: no `presentationStyle="fullScreen"` Modal that
// wraps the workbench. The Modal at the bottom of the screen is for voice
// NOTE transcription detail (R4), not for the recorder workbench itself.
expect(
  "voice workbench must not be a fullscreen Modal",
  !/<Modal[\s\S]*?visible=\{voiceWorkbenchVisible\}[\s\S]*?presentationStyle="fullScreen"/.test(screen),
);

// (2) Inline section exists with the legacy testID so other regressions
// keep passing.
expect(
  "inline voice workbench section exists with mobile-voice-workbench-page testID",
  /voiceWorkbenchOpen && !voiceWorkbenchMinimized \?\s*\(\s*<View style=\{styles\.voiceWorkbenchInline\} testID="mobile-voice-workbench-page"/.test(screen),
);

// (3) Boot-time recovery banner exists, separate from the in-flight one.
expect(
  "boot-time recovery banner has continue/discard/dismiss actions",
  /testID="mobile-voice-boot-recovery"[\s\S]*?testID="mobile-voice-recovery-boot-continue"[\s\S]*?testID="mobile-voice-recovery-boot-discard"[\s\S]*?testID="mobile-voice-recovery-boot-dismiss"/.test(screen),
);

// (4) In-flight recovery banner has continue/discard/retry actions.
expect(
  "in-flight recovery banner has continue/discard/retry actions",
  /testID="mobile-voice-recovery-banner"[\s\S]*?testID="mobile-voice-recovery-continue"[\s\S]*?testID="mobile-voice-recovery-discard"[\s\S]*?testID="mobile-voice-recovery-retry"/.test(screen),
);

// (5) The in-flight banner must NOT silently delete server data; the
// discard action only clears local recorder artifacts (draft + session +
// recovery marker) and must not call any server endpoint.
expect(
  "discardStaleVoiceWorkbench clears local artifacts only (no fetch / delete)",
  /const discardStaleVoiceWorkbench = useCallback\(async \(\) =>[\s\S]*?clearAllRecorderLocalState\(\)/.test(screen) &&
    !/discardStaleVoiceWorkbench[\s\S]{0,800}?fetch\(/.test(screen),
);

// (6) closeVoiceWorkbench must also clear local artifacts so a clean exit
// closes every per-device recorder key.
expect(
  "closeVoiceWorkbench clears per-device recorder artifacts",
  /const closeVoiceWorkbench\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,1500}?void\s+clearAllRecorderLocalState\(\)/.test(screen),
);

// (7) The home page sections (SyncBanner + todo + summary cards + knowledge
// query) must remain in the JSX, not removed/disabled by the recovery banner.
expect(
  "home page sections remain rendered (SyncBanner, todo priority, summary cards, knowledge query)",
  screen.includes('testID="mobile-sync-banner"') &&
    screen.includes('testID="mobile-todo-priority-panel"') &&
    screen.includes('testID="record-summary-cards"') &&
    screen.includes('testID="mobile-knowledge-query-panel"'),
);

// (8) The R6 duplicate-save guard inside saveQuickNote must remain. If we
// accidentally added an extra saveQuickNote call inside the recovery banner,
// the `quickInFlightId` guard would also need to gate it.
expect(
  "saveQuickNote dedupe guard (quickInFlightId / quickSavePending) is intact",
  screen.includes("setQuickInFlightId(inFlightId)") &&
    screen.includes("// 同一笔正在保存中:忽略,避免重复 POST"),
);

// (9) The confirmVoicePreviewSave branch ordering must remain: recorder
// session branch first, legacy addKnowledgeNote fallback second. Don't
// double-write during recovery.
const confirmStart = screen.indexOf("const confirmVoicePreviewSave = async () => {");
const confirmEnd = screen.indexOf("const closeVoiceWorkbench = () => {", confirmStart);
const confirmBody = confirmStart >= 0 && confirmEnd > confirmStart ? screen.slice(confirmStart, confirmEnd) : "";
const recorderBranchIndex = confirmBody.indexOf("if (mobileRecorderSessionId)");
const firstLegacySaveIndex = confirmBody.indexOf("await addKnowledgeNote(");
expect(
  "duplicate-save guard: recorder session branch first, legacy fallback second",
  confirmBody.length > 0 && recorderBranchIndex >= 0 && (firstLegacySaveIndex < 0 || firstLegacySaveIndex > recorderBranchIndex),
);

// (10) The new storage helpers are defined and exported.
expect(
  "storage exports clearAllRecorderLocalState + saveRecorderRecoveryMarker + clearRecorderRecoveryMarker + loadRecorderRecoveryMarker",
  storage.includes("export async function saveRecorderRecoveryMarker") &&
    storage.includes("export async function loadRecorderRecoveryMarker") &&
    storage.includes("export async function clearRecorderRecoveryMarker") &&
    storage.includes("export async function clearAllRecorderLocalState"),
);

// (11) The recovery marker is keyed by `openclaw.mobile.recorder.recovery.v1`
// and writes a per-device JSON blob with a timestamp; it does NOT touch
// server-side mobile_recording_sessions.
expect(
  "recovery marker key + payload schema",
  /const recorderRecoveryKey = "openclaw\.mobile\.recorder\.recovery\.v1"/.test(storage) &&
    /writtenAt/.test(storage) &&
    /recorderSessionId/.test(storage) &&
    !/fetch\(|apiRequest\(|mobileRecordingSession/i.test(storage),
);

// (12) The App.tsx shellWorkspaceOverlay remains untouched. Recovery only
// affects the record-tab workbench (TodayConsoleScreen).
const appShell = read("apps/mobile/src/App.tsx");
expect(
  "App.tsx shellWorkspaceOverlay / RecorderWorkspace import untouched",
  /import \{ RecorderWorkspace \}/.test(appShell) &&
    /shellWorkspaceActive = recorder\.state\.mode !== "closed" && !recorder\.state\.minimized && tab !== 'record'/.test(appShell),
);

if (failures.length) {
  console.error("MOBILE_R7_STALE_RECOVERY_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MOBILE_R7_STALE_RECOVERY_PASS");
