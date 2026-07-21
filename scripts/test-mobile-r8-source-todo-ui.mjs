// 2026-07-04 — R8 Mate60 source/todo UI data-mapping regression.
//
// NJX accepted the build at 2026-07-04 09:59 but the screenshot showed two
// inconsistencies in the home / Today console:
//
//   A) Top summary said "74 待办" while the bottom KPI card read "待办 0".
//   B) NAS was restored (today API + bootstrap both report connected) yet the
//      SyncBanner still flashed "离线只读 · 源 vault · 未挂载 · 请检查 NAS".
//
// Root cause:
//   A) The summary card was reading `todayQuery.data?.todos?.length` directly,
//      which is `undefined` whenever the user opens the screen on cache (no
//      fresh network payload yet). The top summary used the merged `today`
//      value (`todayQuery.data || cachedToday.today`), so the two counts
//      diverged.
//
//   B) The SyncBanner only watched `bootstrapQuery.data?.vault.vaultAvailable`,
//      and the bootstrap query has no refetchInterval — so a restored NAS
//      stayed invisible until the user manually pulled to refresh.
//
// This probe enforces the post-fix contract end-to-end against source:
//
//   1. KPI 待办 card binds to `today?.todos?.length`, never `todayQuery.data`.
//   2. KPI 时间线 card binds to `today?.events?.length`, never `todayQuery.data`.
//   3. Top summary still uses `today?.todos?.length` (regression guard).
//   4. `today` is defined as the query+cache fallback (R7 contract).
//   5. bootstrapQuery has a `refetchInterval` so vault state auto-refreshes.
//   6. SyncBanner treats `today.sources.nas.status === "connected"` as a
//      secondary "vault available" signal so a freshly restored NAS clears
//      the stale "未挂载" warning without waiting for bootstrap to refetch.
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

// (1) KPI 待办 card: must bind to `today?.todos?.length` (merged value),
//     NOT `todayQuery.data?.todos?.length`. This is the exact line NJX saw
//     showing 0 instead of 74.
const todoKpiBlock = screen.slice(
  screen.indexOf("accessibilityLabel=\"今日待办\""),
  screen.indexOf("accessibilityLabel=\"今日待办\"") + 1200,
);
expect(
  "KPI 待办 card uses `today?.todos?.length`, not `todayQuery.data`",
  /today\?\.todos\?\.length\s*\?\?\s*0/.test(todoKpiBlock) &&
    !/summaryCardCount[\s\S]{0,80}todayQuery\.data\?\.todos/.test(todoKpiBlock),
  "KPI 待办 card still references todayQuery.data — count will read 0 on cache render",
);

// (2) KPI 时间线 card: same fix — bind to `today?.events?.length`.
const timelineKpiBlock = screen.slice(
  screen.indexOf("accessibilityLabel=\"时间线\""),
  screen.indexOf("accessibilityLabel=\"时间线\"") + 1200,
);
expect(
  "KPI 时间线 card uses `today?.events?.length`, not `todayQuery.data`",
  /today\?\.events\?\.length\s*\?\?\s*0/.test(timelineKpiBlock) &&
    !/summaryCardCount[\s\S]{0,80}todayQuery\.data\?\.events/.test(timelineKpiBlock),
  "KPI 时间线 card still references todayQuery.data — count will read 0 on cache render",
);

// (3) Top summary uses the merged `today` value (regression guard for the
//     header strip that NJX saw correctly showing 74).
expect(
  "top summary still derives `todosTotal` from `today?.todos?.length`",
  /const todosTotal = today\?\.todos\?\.length \|\| 0/.test(screen),
);

// (4) `today` is the query+cache fallback. If anyone reverts this, both bugs
//     resurface because the UI will start reading `todayQuery.data` directly
//     again.
expect(
  "`today` is defined as `todayQuery.data || cachedToday?.today || null`",
  /const today = todayQuery\.data \|\| cachedToday\?\.today \|\| null/.test(screen),
);

// (5) bootstrapQuery has a `refetchInterval` so vault state auto-refreshes.
//     Without this, the banner stays stale forever even after NAS is restored.
const bootstrapBlock = screen.slice(
  screen.indexOf("queryKey: [\"mobile-bootstrap\""),
  screen.indexOf("queryKey: [\"mobile-bootstrap\"") + 600,
);
expect(
  "bootstrapQuery has a refetchInterval (≥30s) for vault freshness",
  /refetchInterval:\s*(?:\d{4,}|3[0-9]_000|6[0-9]_000)/.test(bootstrapBlock),
);

// (6) SyncBanner treats `today.sources.nas.status === "connected"` as a
//     secondary signal — the freshly restored NAS should clear the banner
//     even before the 60s bootstrap refetch lands.
expect(
  "SyncBanner honors `today.sources.nas.status === \"connected\"` as a secondary vault signal",
  /today\?\.sources\?\.nas/.test(screen) && /"connected"/.test(screen),
  "SyncBanner does not consult today.sources.nas — restored NAS banner stays stale",
);

// (7) Regression guard: SyncBanner still produces the "未挂载" warning when
//     the vault is genuinely unavailable. We only changed how the warning is
//     *cleared*, not how it is *raised*.
expect(
  "SyncBanner still renders \"未挂载 · ...\" when vault is unavailable",
  /未挂载 · \$\{vaultFallbackReason \|\| "请检查 NAS"\}/.test(screen),
);

// (8) Regression guard: the SyncBanner testID stays put so the visual smoke
//     harness (`mobile-visual-smoke.mjs`) doesn't break.
expect(
  "SyncBanner testID `mobile-sync-banner` is preserved",
  /testID="mobile-sync-banner"/.test(screen),
);

// (9) Regression guard: no accidental change to the desktop source path.
const desktopToday = (() => {
  try { return read("apps/desktop/src/screens/TodayConsoleScreen.tsx"); }
  catch { return ""; }
})();
if (desktopToday) {
  expect(
    "desktop TodayConsoleScreen untouched (no R8 source/todo edits)",
    !desktopToday.includes("R8: read from `today`"),
    "desktop screen picked up R8 edits — task contract forbids this",
  );
}

// (10) Regression guard: the recorder/transcription server module is untouched.
const serverIndex = read("apps/server/src/index.ts");
expect(
  "server /api/mobile/today handler still slices todos to 80 (no payload bump)",
  /todos: todos\.slice\(0, 80\)\.map\(mobileCalendarRowSummary\)/.test(serverIndex),
);
expect(
  "server mobileVaultInfo still exposes vaultAvailable / vaultFallbackReason",
  /vaultAvailable: resolved\.status === "connected"/.test(read("apps/server/src/connectors/nasRoot.ts")),
);

if (failures.length) {
  console.error("MOBILE_R8_SOURCE_TODO_UI_FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MOBILE_R8_SOURCE_TODO_UI_PASS");