import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), "utf8");
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

function includesAll(source, tokens, label) {
  const missing = tokens.filter((token) => !source.includes(token));
  assert(missing.length === 0, `${label}_missing_tokens`, { missing });
}

const app = read("apps/mobile/src/App.tsx");
const api = read("apps/mobile/src/lib/api.ts");
const today = read("apps/mobile/src/screens/TodayConsoleScreen.tsx");
const knowledge = read("apps/mobile/src/screens/KnowledgeScreen.tsx");
const calendar = read("apps/mobile/src/screens/CalendarScreen.tsx");
const editor = read("apps/mobile/src/screens/NoteEditorScreen.tsx");
// 2026-06-25 — 知识录入已迁到独立 CaptureScreen 页,首屏只露三卡 (待办/语音/时间线)
const capture = read("apps/mobile/src/screens/CaptureScreen.tsx");
const forwarder = read("apps/server/src/cloudbaseForwarder.ts");
const visualSmoke = read("scripts/mobile-visual-smoke.mjs");
const dbTs = read("apps/server/src/db.ts");

includesAll(app, ["TodayConsoleScreen", "KnowledgeScreen", "CalendarScreen", "DeviceScreen", "NoteEditorScreen"], "mobile_app_routes");
includesAll(app, ["记录", "知识", "日程", "设备"], "mobile_bottom_tabs");
includesAll(app, [
  "testID: 'mobile-tab-record'",
  "testID: 'mobile-tab-knowledge'",
  "testID: 'mobile-tab-calendar'",
  "testID: 'mobile-tab-device'",
  "accessibilityLabel={`主导航 ${label}`}",
  "accessibilityRole=\"button\"",
], "mobile_bottom_tabs_automation_contract");

// 2026-06-22 — Pairing submit hitbox regression guard.
// Source-only contract: the bottom tab bar must be hidden whenever the user is
// on the pairing screen (no session yet), so the fixed bar cannot intercept
// taps on `mobile-pair-submit` near y=802 on iPhone 800-px screens.
includesAll(app, [
  "pairingMode",
  "onPairingStateChange",
  "setPairingMode",
], "mobile_pairing_hitbox_contract");
assert(
  // The tab bar SafeAreaView must be conditionally removed based on a
  // pairingMode flag, so it disappears at runtime.
  /hideTabBar\s*\?\s*null\s*:\s*\(/m.test(app),
  "mobile_pairing_hitbox_tabbar_conditional_missing",
);
assert(
  // The hide predicate must combine tab==='record' with pairingMode.
  /tab\s*===\s*['"]record['"]\s*&&\s*pairingMode/m.test(app),
  "mobile_pairing_hitbox_hide_predicate_missing",
);
// Callback wiring: pairing-mode must flow from TodayConsoleScreen back to App.
assert(
  /onPairingStateChange=\{onPairingStateChange\}/.test(app),
  "mobile_pairing_hitbox_callback_not_wired_in_app",
);
assert(
  /onPairingStateChange\?:/.test(today),
  "mobile_pairing_hitbox_callback_signature_missing_in_today",
);
// Predicate in the screen: pairing mode is true when there is no session
// after loading completes. Accept either `!loadingSession && !session` or
// `loadingSession === false && session === null`.
assert(
  /onPairingStateChange\(\s*(?:!\s*loadingSession\s*&&\s*!\s*session|loadingSession\s*===\s*false\s*&&\s*session\s*===\s*null)\s*\)/.test(today),
  "mobile_pairing_hitbox_callback_predicate_missing_in_today",
);

includesAll(api, [
  "const defaultTimeoutMs = 45_000",
  "FUNCTION_INVOCATION_FAILED",
  "InsufficientBalance",
  "responseError",
  "timeoutMs: 90_000",
  "timeoutMs: 120_000",
], "mobile_api_resilience");

includesAll(today, [
  "const consoleTabs = [\"voice\", \"chat\", \"approvals\"]",
  "testID=\"mobile-pair-server-url\"",
  "testID=\"mobile-pair-code\"",
  "testID=\"mobile-pair-submit\"",
  "testID=\"mobile-sync-banner\"",
  "testID=\"mobile-todo-priority-panel\"",
  "testID=\"mobile-knowledge-query-panel\"",
  "testID=\"mobile-todo-priority-open-schedule\"",
  "testID=\"mobile-voice-record\"",
  "testID=\"mobile-knowledge-search\"",
  "testID=\"mobile-section-toggle\"",
  "testID={`record-segment-${item}`}",
  "accessibilityLabel={`执行台 ${consoleLabel(item)}`}",
  "待办优先",
  "知识查询",
  "知识地图、笔记、HTML、Markdown",
  "待同步笔记",
  "展开执行台",
  "today?.events",
  "today?.todos",
  "today?.planItems",
  "createVoiceNote",
  "transcribeVoiceNote",
  "organizeVoiceNote",
  "随时对话",
  "审批与接管",
], "mobile_today_console");

// 2026-06-25 — 知识录入 / 快速笔记 / 录音保存 已迁到独立 CaptureScreen 页
includesAll(capture, [
  "testID=\"mobile-knowledge-input-panel\"",
  "testID=\"mobile-quick-note-title\"",
  "testID=\"mobile-quick-note-body\"",
  "testID=\"mobile-quick-note-save\"",
  "testID=\"mobile-voice-save\"",
  "testID=\"mobile-quick-note-saved\"",
  "知识录入",
  "添加笔记",
  "markdownPath",
  "htmlPath",
  "quickSavePending",
  "quickInFlightId",
  "SaveState",
  "state.kind === \"saved\"",
  "继续添加",
], "mobile_capture_workspace");

// 新优先级:首页三面板顺序必须为 待办优先 → 知识录入 → 知识查询,且 知识查询 必须在 今日日程/待办 之后被收口;
// 执行台折叠按钮在 知识查询 之后。
const todoIdx = today.indexOf("mobile-todo-priority-panel");
// 2026-06-25 — 知识录入 已迁到 CaptureScreen;today 只剩 待办/查询 顺序
const queryIdx = today.indexOf("mobile-knowledge-query-panel");
const sectionToggleIdx = today.indexOf("mobile-section-toggle");
assert(
  todoIdx > -1 && queryIdx > -1 && sectionToggleIdx > -1,
  "mobile_today_priority_testids_missing",
  { todoIdx, queryIdx, sectionToggleIdx },
);
assert(todoIdx < queryIdx, "mobile_today_priority_order_todo_before_query", { todoIdx, queryIdx });
assert(queryIdx < sectionToggleIdx, "mobile_today_priority_order_query_before_toggle", { queryIdx, sectionToggleIdx });

includesAll(knowledge, [
  "type KnowledgeView = 'map' | 'vault' | 'sources'",
  "fetchKnowledgeAtlas",
  "AtlasOverview",
  "全库知识地图",
  "Selected Source",
  "+ 新建",
  "kind: 'markdown'",
  "kind: 'html'",
  "onOpenEditor",
], "mobile_knowledge_workspace");

includesAll(calendar, [
  "fetchCalendarByDate",
  "fetchCalendarRange",
  "createCalendarEvent",
  "updateCalendarEvent",
  "deleteCalendarEvent",
  "今天做什么",
  "默认显示今天",
  "新建日程",
  "编辑日程",
  "删除日程",
  // 2026-06-26 R3 — 日程 HTML 笔记预览
  "knowledgePath",
  "knowledgeHtmlPath",
  "calendar-open-note",
  "打开关联笔记",
], "mobile_calendar_workspace");

includesAll(editor, [
  "readKb",
  "createKb",
  "writeKb",
  "Markdown 编辑器",
  "HTML 编辑器",
  "保存",
  "HTML 源码编辑区",
  "Markdown 编辑区",
], "mobile_note_editor");

includesAll(forwarder, [
  "compactMobileTodayResponse",
  "compactMobileAtlasResponse",
  "compactMobileKbListResponse",
  "compactMobileCalendarResponse",
  "todos",
  "events",
  "planItems",
  "MAX_BROKER_ACK_RESPONSE_BYTES",
], "mobile_relay_contract");

includesAll(visualSmoke, [
  "createPairingCode",
  "MOBILE_VISUAL_WORKBENCH_URL",
  "待办优先",
  "知识录入",
  "知识查询",
  "今天做什么",
  "知识地图",
], "mobile_visual_smoke_contract");

// 2026-06-24 — 100-Point Recovery (NJX Mate60) regression guards.
// The current rejected app was failing the first-screen capture/recall contract.
// These assertions prove the new P0 wiring is in place. They are source-based
// and intentionally narrow: an old build that is missing the new testIDs,
// vault plumbing, manual-transcript fallback, or HTML preview will fail here.

const nasRoot = read("apps/server/src/connectors/nasRoot.ts");
const configTs = read("apps/server/src/config.ts");
const indexTs = read("apps/server/src/index.ts");
const mobileApi = read("apps/mobile/src/lib/api.ts");
const mobileStorage = read("apps/mobile/src/lib/storage.ts");
const mobileTypes = read("apps/mobile/src/lib/types.ts");
const mobileHtmlPreview = read("apps/mobile/src/lib/htmlPreview.ts");

// 2026-06-30 R5 acceptance guards from iPhone11 rejection.
assert(
  /<KnowledgeScreen[\s\S]{0,240}?onOpenCapture=\{onOpenCapture\}/m.test(app),
  "mobile_r5_knowledge_quick_new_not_wired_to_capture",
);
assert(
  /testID="record-card-timeline"[\s\S]{0,500}?onOpenCalendar\?\.\(\)/m.test(today) === false,
  "mobile_r5_timeline_card_must_not_jump_calendar",
);
assert(
  /setSection\("console"\)[\s\S]{0,360}?scrollToEnd[\s\S]{0,500}?testID="record-card-timeline"/m.test(today),
  "mobile_r5_timeline_card_must_open_record_console_timeline",
);
assert(
  /onOpenCalendar\?\.\(\{\s*kind:\s*"task"\s*\}\)/m.test(today),
  "mobile_r5_todo_card_must_open_calendar_task_filter",
);
assert(
  /calendarFocus/.test(app) &&
    /<CalendarScreen[\s\S]{0,180}?focus=\{calendarFocus\}/m.test(app),
  "mobile_r5_calendar_focus_not_wired_from_app",
);
assert(
  /fetchToday/.test(calendar) &&
    /mobile-calendar-today-agenda/.test(calendar) &&
    /todoToCalendarEvent/.test(calendar) &&
    /mergeCalendarEventsWithTodos/.test(calendar),
  "mobile_r5_calendar_must_merge_today_todos",
);
assert(
  /agendaItemBelongsToDate/.test(calendar) &&
    /approvalBelongsToDate/.test(calendar) &&
    /\.filter\(\(todo\) => agendaItemBelongsToDate\(todo, dateKey\)\)/.test(calendar) &&
    /\.filter\(\(approval\) => approvalBelongsToDate\(approval, dateKey\)\)/.test(calendar),
  "mobile_r5_calendar_must_filter_today_pool_by_selected_date",
);
assert(
  /kindFilter === 'all' \? baseVisibleEvents : baseVisibleEvents\.filter/.test(calendar) &&
    /kindFilter === 'task'/.test(calendar),
  "mobile_r5_calendar_kind_filter_not_applied",
);
assert(
  /isTodayTodoEvent/.test(calendar) &&
    /桌面待办只读展示/.test(calendar),
  "mobile_r5_calendar_todos_must_be_readonly",
);
assert(
  /SELECT \*[\s\S]{0,300}?FROM todos[\s\S]{0,600}?COALESCE\(status/.test(indexTs) &&
    /LIMIT 80/.test(indexTs) &&
    /todos:\s*todos\.slice\(0,\s*80\)/.test(indexTs),
  "mobile_r5_today_must_query_full_open_todos",
);
assert(
  /todos:\s*compactArray\(row\.todos,\s*80/.test(forwarder) &&
    /approvals:\s*compactArray\(row\.approvals,\s*40/.test(forwarder),
  "mobile_r5_cloudbase_today_must_not_truncate_todos_to_20",
);
assert(
  /resolved\.rel === "\." && resolved\.root === mobileKbVaultRoot\(\)[\s\S]{0,600}?preferredEntries/.test(indexTs) === false,
  "mobile_r5_kb_root_must_not_be_preferred_entries_only",
);
assert(
  /preferredOrder/.test(indexTs) && /fs\.readdirSync\(resolved\.abs/.test(indexTs),
  "mobile_r5_kb_root_should_readdir_real_vault",
);
assert(
  /const vaultAbs = path\.resolve\(root, stripped\)/.test(indexTs) &&
    /fs\.existsSync\(vaultAbs\)[\s\S]{0,180}?return \{ ok: true, abs: vaultAbs/.test(indexTs),
  "mobile_r6_kb_root_file_must_prefer_real_vault_before_mobile_kb_fallback",
);
assert(
  /实时转写 \/ 手动草稿/.test(today) &&
    /noteRecordingActive/.test(today) &&
    /mobile-voice-manual-transcript/.test(today),
  "mobile_r5_voice_live_transcript_panel_missing",
);
assert(
  /type VoiceWorkbenchMode = "closed" \| "recording" \| "minimized" \| "transcribing" \| "preview" \| "saving" \| "saved"/.test(today) &&
    /testID="mobile-voice-workbench-page"/.test(today) &&
    /testID="mobile-voice-workbench-mini"/.test(today) &&
    /testID="mobile-voice-workbench-minimize"/.test(today) &&
    /testID="mobile-voice-workbench-stop"/.test(today) &&
    /testID="mobile-voice-workbench-exit"/.test(today),
  "mobile_r6_voice_must_use_independent_workbench",
);
assert(
  /退出本次录音/.test(today) &&
    /onPress=\{closeVoiceWorkbench\}/.test(today) &&
    /testID="mobile-voice-workbench-exit"/.test(today),
  "mobile_r6_voice_preview_must_have_explicit_exit",
);
assert(
  /async\?: boolean/.test(mobileApi) &&
    /async:\s*params\.async === true/.test(mobileApi) &&
    /async:\s*true/.test(today) &&
    /pendingTranscriptionVoiceNoteId/.test(today) &&
    /refetchInterval:\s*pendingTranscriptionVoiceNoteId \? 3000 : false/.test(today) &&
    /mobile-voice-workbench-transcribing/.test(today) &&
    /后台转写中/.test(today),
  "mobile_r6_voice_must_use_async_transcription_polling",
);
// 2026-07-04 R9: superseded by mobile_r9_note_recording_uses_r5b_recorder_session.
// The R6 contract (auto-transcribe on stop even if bootstrap flag is stale)
// is intentionally replaced: note recording now uses the R5B recorder session
// path exclusively (chunks -> segments -> finalize). The legacy
// /voice-notes/:id/audio-chunk path 413's on CloudBase for 60-90s Mate60
// recordings, so we no longer gate transcription on the bootstrap flag for
// note recording. Chat voice upload (chatVoiceMutation) still uses the
// legacy /voice-notes path because it is a short clip + sync transcription,
// which is what the R6 contract was originally scoped to.
const stopFnStartR9 = today.indexOf("const stopVoiceRecording = async () => {");
const stopFnEndR9 = stopFnStartR9 >= 0 ? today.indexOf("};\n", stopFnStartR9) : -1;
const stopFnBodyR9 = stopFnStartR9 >= 0 && stopFnEndR9 > stopFnStartR9 ? today.slice(stopFnStartR9, stopFnEndR9) : "";
assert(
  // stopVoiceRecording() must reference the R5B recorder session APIs and
  // must NOT call autoTranscribeMutation.mutate() (which would re-trigger the
  // legacy /voice-notes path that 413'd on CloudBase).
  /startRecorderSession\s*\(/.test(stopFnBodyR9) &&
    /uploadRecorderAudio\s*\(/.test(stopFnBodyR9) &&
    /listRecorderSegments\s*\(/.test(stopFnBodyR9) &&
    !/autoTranscribeMutation[\s\S]{0,40}?\.mutate\s*\(/.test(stopFnBodyR9),
  "mobile_r9_note_recording_uses_r5b_recorder_session",
);
assert(
  // retryVoiceWorkbenchSync must NOT call autoTranscribeMutation.mutate()
  // either — even on user-initiated retry, R5B is the source of truth for
  // note recording.
  /retryVoiceWorkbenchSync[\s\S]{0,4000}?listRecorderSegments\s*\(/.test(today) &&
    !/retryVoiceWorkbenchSync[\s\S]{0,4000}?autoTranscribeMutation[\s\S]{0,40}?\.mutate\s*\(/.test(today),
  "mobile_r9_note_retry_does_not_call_autoTranscribeMutation",
);
assert(
  /wantsAsyncMobileTranscription/.test(indexTs) &&
    /reply\.code\(202\)\.send/.test(indexTs) &&
    /void runTranscription\(\)\.catch/.test(indexTs) &&
    /status:\s*"transcribing"/.test(indexTs),
  "mobile_r6_server_must_return_202_for_async_transcription",
);
assert(
  /probeMobileAudioSeconds/.test(indexTs) &&
    /audio_too_short/.test(indexTs) &&
    /reply\.code\(422\)\.send/.test(indexTs) &&
    /mobileVoiceMinAudioSeconds/.test(indexTs) &&
    /audio_too_short/.test(mobileApi),
  "mobile_r6_voice_must_fail_fast_for_empty_audio",
);
assert(
  /buildVoicePreviewMarkdown/.test(today) &&
    /buildVoicePreviewHtml/.test(today) &&
    /testID="mobile-voice-workbench-preview"/.test(today) &&
    /testID="mobile-voice-preview-md-tab"/.test(today) &&
    /testID="mobile-voice-preview-html-tab"/.test(today) &&
    /testID="mobile-voice-workbench-confirm"/.test(today) &&
    /confirmVoicePreviewSave/.test(today),
  "mobile_r6_voice_must_preview_markdown_html_before_save",
);
assert(
  /autoTranscribeMutation/.test(today) &&
    /autoOrganizeMutation/.test(today) === false &&
    /addKnowledgeNote\([\s\S]{0,900}?source:\s*recordedAudioUri \? "speech_recognition" : "manual_transcript"/.test(today),
  "mobile_r6_voice_must_not_auto_organize_before_confirm",
);

// P0-1: vault root = 南极熊, mobile bootstrap must surface it
includesAll(nasRoot, [
  "DEFAULT_NAS_ROOT = \"/Volumes/南极熊\"",
  "mobileVaultInfo",
  "KB_VAULT_DIR",
], "mobile_priority_vault_contract");
includesAll(configTs, [
  "/Volumes/南极熊",
  "KB_VAULT_DIR",
], "mobile_priority_vault_config");
includesAll(mobileTypes, [
  "MobileBootstrapVault",
  "vault?: MobileBootstrapVault",
  "vaultRoot: string",
  "vaultLabel: string",
  "vaultAvailable: boolean",
  "vaultFallbackReason: string | null",
  "voiceTranscriptionProvider?: string",
], "mobile_priority_types_contract");
// server-side vault helper must expose the new explicit fields
includesAll(nasRoot, [
  "vaultRoot:",
  "vaultLabel:",
  "vaultAvailable:",
  "vaultFallbackReason:",
], "mobile_priority_vault_explicit_fields");
// server bootstrap endpoint must include `vault` in the response
assert(
  /app\.get\("\/api\/mobile\/bootstrap"[\s\S]{0,2000}?mobileVaultInfo/m.test(indexTs),
  "mobile_priority_bootstrap_vault_missing",
);
// mobile should call the new mobileVaultInfo from nasRoot
assert(
  /mobileVaultInfo/m.test(indexTs) && /import\s*\{[^}]*mobileVaultInfo[^}]*\}\s*from\s*"\.\/connectors\/nasRoot\.js"/m.test(indexTs),
  "mobile_priority_bootstrap_vault_import_missing",
);

// 2026-06-25 — P0-B note capture 已迁到 CaptureScreen,所有 token 在 capture 中校验 (见 mobile_capture_workspace)
// 单独保留 「添加笔记」 入口在 today 上(首屏快速动作卡)
assert(
  /添加笔记/.test(today) || /添加笔记/.test(capture),
  "mobile_priority_add_note_label_missing",
);
assert(
  /mobile-quick-note-saved/.test(capture) || /mobile-voice-saved/.test(capture),
  "mobile_priority_saved_banner_testid_missing",
);
assert(
  /type SaveState/.test(capture) && /state\.kind === "saved"/.test(capture),
  "mobile_priority_saved_state_missing",
);
// P0-B: success banner must surface both Markdown and HTML paths.
assert(
  /markdownPath/.test(capture) && /htmlPath/.test(capture),
  "mobile_priority_markdown_html_paths_missing",
);
// duplicate-save prevention: capture 内部 in-flight guard (single SaveState)
assert(
  /state.kind === "saving"/.test(capture) || /quickSavePending/.test(capture) || /quickInFlightId/.test(capture),
  "mobile_priority_duplicate_save_guard_missing",
);
// 「继续添加」 入口必须在 capture 上
assert(
  /继续添加/.test(capture),
  "mobile_priority_continue_add_copy_missing",
);
// P0-B server-side: the mobile note endpoint must return Markdown + HTML
// paths in a single response — duplicate clicks of 添加笔记 must not be
// able to create a second note with the same body. Source-only check.
assert(
  /app\.post\("\/api\/mobile\/knowledge\/notes\/[^"]*"[\s\S]{0,3000}?markdownPath[\s\S]{0,500}?htmlPath/m.test(indexTs),
  "mobile_priority_server_note_md_html_endpoint_missing",
);
// P0-3: transcription manual fallback (provider unconfigured) — 在 today 或 capture
assert(
  /mobile-voice-manual-fallback/.test(today) || /mobile-voice-manual-fallback/.test(capture),
  "mobile_priority_manual_fallback_testid_missing",
);
assert(
  /Mac 端语音转写未配置/.test(today) || /Mac 端语音转写未配置/.test(capture),
  "mobile_priority_manual_fallback_copy_missing",
);
// R5 acceptance: voice fallback must be visible from the first-screen voice
// panel after a recording/transcription failure. It cannot live only under the
// folded "执行台" section, otherwise NJX records audio but never sees the
// transcript/manual-entry path.
const manualFallbackIdx = today.indexOf("mobile-voice-manual-fallback");
const consoleSectionIdx = today.indexOf('section === "console"');
assert(
  manualFallbackIdx > -1 && (consoleSectionIdx === -1 || manualFallbackIdx < consoleSectionIdx),
  "mobile_r5_voice_manual_fallback_not_first_screen",
  { manualFallbackIdx, consoleSectionIdx },
);
assert(
  /setShowVoice\(true\)/.test(today),
  "mobile_r5_voice_error_must_expand_panel",
);
assert(
  /if \(!noteRecordingActive\) return;[\s\S]{0,180}?setShowVoice\(true\)/.test(today) &&
    /scrollTo\(\{\s*y:\s*0,\s*animated:\s*true\s*\}\)/.test(today) &&
    /setVoiceWorkbenchMode\(\(mode\) => mode === "minimized" \? "minimized" : "recording"\)/.test(today) &&
    /noteRecordingActive \? renderVoiceManualFallback\(false, true\) : null/.test(today) === false,
  "mobile_r5_recording_must_force_voice_workbench",
);
assert(
  /setVoiceTranscript\(\s*(?:transcribed|result)\.transcriptText/.test(today) ||
    /setVoiceTranscript\(transcript\)/.test(today) ||
    /setVoiceTranscript\(\(current\) =>[\s\S]{0,220}?return transcript/.test(today),
  "mobile_r5_voice_transcript_not_written_to_ui",
);
// 2026-06-24 first-screen viewport: NJX requires 待办优先 + 知识录入 + 添加笔记
// + 知识查询 all visible without scrolling on 390x844. The home render block
// must use the compact panel style and hide the giant header. Source-only
// guard: if any of these tokens is missing, the first viewport will not fit
// the four required labels at once.
// 2026-06-25 — 知识录入已迁到 CaptureScreen;首屏三卡:待办 / 语音 / 时间线 + 知识查询
includesAll(today, [
  'style={styles.panelCompact}',
  'mobile-todo-priority-panel',
  'mobile-knowledge-query-panel',
  '打开完整日程',
  '添加笔记',
  'mobile-voice-toggle',
  'showVoice',
  '展开语音输入',
], "mobile_first_screen_viewport_contract");
assert(
  /mobile-knowledge-input-panel/.test(capture) && /mobile-quick-note-save/.test(capture),
  "mobile_first_screen_capture_workspace_testids_missing",
);
// The home ScrollView must not include the old "Header" call before the
// three priority panels — otherwise it eats too many vertical px.
assert(
  /<Header[\s\S]{0,200}?\/>[\s\S]{0,400}?mobile-todo-priority-panel/.test(today) === false,
  "mobile_first_screen_no_legacy_header",
);
// The SyncBanner must be a compact single-line strip.
assert(
  /syncBannerCompact/.test(today),
  "mobile_first_screen_sync_banner_compact",
);
// P0-4: HTML preview must exist and be wired into the Knowledge reader
assert(
  /parseHtml/.test(mobileHtmlPreview) && /HtmlBlock/.test(mobileHtmlPreview),
  "mobile_priority_html_preview_module_missing",
);
assert(
  /showHtmlSource/.test(capture) && /capture-toggle-html-source/.test(capture),
  "mobile_r5_capture_html_source_must_be_explicit_toggle",
);
includesAll(knowledge, [
  "HtmlPreview",
  "mobile-html-preview",
  "parseHtml",
  "previewToggle",
  "HtmlBlockRow",
  "mobile-knowledge-vault-warning",
], "mobile_priority_knowledge_html_preview_contract");
// 南极熊 must be the visible source in the knowledge tab
assert(
  /南极熊/.test(knowledge) || /南极熊/.test(knowledge),
  "mobile_priority_nanji_xiong_label_missing",
);
// P0-5: today + schedule grouping with source-aware empty state
includesAll(calendar, [
  "mobile-calendar-empty",
  "新建日程",
  "今天做什么",
], "mobile_priority_calendar_today_contract");
includesAll(today, [
  "mobile-todo-priority-open-schedule",
  "eventsTotal",
  "todosTotal",
  "planTotal",
  "审批与接管",
  "阻塞任务",
], "mobile_priority_todo_alerts_contract");

// P0-1: SyncBanner must surface vault source truth
assert(
  /vault:/.test(today) && /知识库源/.test(today),
  "mobile_priority_sync_banner_vault_missing",
);

// P0-A (handoff 2026-06-24): the server's bootstrap response must surface the
// explicit vault truth fields vaultRoot / vaultLabel / vaultAvailable /
// vaultFallbackReason. Without these the mobile app cannot tell NJX whether
// it is hitting the real /Volumes/南极熊 NAS or a fallback.
assert(
  /vault:\s*mobileVaultInfo\(\)/m.test(indexTs),
  "mobile_p0a_bootstrap_vault_field_missing",
);
includesAll(nasRoot, [
  "vaultRoot:",
  "vaultLabel:",
  "vaultAvailable:",
  "vaultFallbackReason:",
], "mobile_p0a_vault_explicit_fields_in_nas_root");
// Also verify the mobile types surface the explicit field names so mobile code
// can rely on them.
includesAll(mobileTypes, [
  "vaultRoot: string",
  "vaultLabel: string",
  "vaultAvailable: boolean",
  "vaultFallbackReason: string | null",
], "mobile_p0a_vault_explicit_fields_in_types");

// P0-B (handoff 2026-06-24): the new add-note endpoint must return Markdown +
// HTML paths plus a saved id / source hash in one response. Duplicate clicks
// of 添加笔记 must not create a second note with the same body.
includesAll(indexTs, [
  'app.post("/api/mobile/knowledge/notes/add"',
  "sourceHash",
  "markdownPath: result.markdownPath",
  "htmlPath: result.htmlPath",
  'status: "duplicate"',
], "mobile_p0b_add_note_endpoint_contract");
// Server dedupe index must exist for (device_id, source_hash)
assert(
  /idx_mobile_voice_notes_source_hash/.test(dbTs) || /source_hash/.test(indexTs),
  "mobile_p0b_server_source_hash_index_missing",
);
// Mobile API helper must exist so the single primary action can call it.
includesAll(mobileApi, [
  "export function addKnowledgeNote",
  '"/api/mobile/knowledge/notes/add"',
  "AddKnowledgeNoteResult",
], "mobile_p0b_add_knowledge_note_api_helper");
// Mobile TodayConsoleScreen must wire saveQuickNote to addKnowledgeNote (or
// keep the legacy two-step path with both Markdown + HTML banners showing).
assert(
  /addKnowledgeNote\(/.test(today) || (/createVoiceNote\([\s\S]{0,200}?organizeVoiceNote\(/.test(today) && /markdownPath/.test(today) && /htmlPath/.test(today)),
  "mobile_p0b_today_wired_to_add_note",
);
// Duplicate-save prevention — 在 today 或 capture 任一保留 in-flight guard 与成功提示
assert(
  (/quickSavePending/.test(today) && /quickInFlightId/.test(today)) ||
    (/quickSavePending/.test(capture) && /quickInFlightId/.test(capture)),
  "mobile_p0b_duplicate_save_guard",
);
assert(
  /继续添加/.test(today) || /继续添加/.test(capture),
  "mobile_p0b_continue_add_copy",
);
assert(
  /mobile-quick-note-saved/.test(today) || /mobile-voice-saved/.test(today) ||
    /mobile-quick-note-saved/.test(capture) || /mobile-voice-saved/.test(capture),
  "mobile_p0b_saved_banner_testid",
);

// P0-1 server: KB_VAULT_DIR default must point at /Volumes/南极熊
assert(
  /"\/Volumes\/南极熊"/m.test(configTs),
  "mobile_priority_config_kb_vault_root_missing",
);

console.log(JSON.stringify({
  ok: true,
  checks: [
    "bottom tabs",
    "bottom tabs automation contract",
    "api timeout/error resilience",
    "today console 待办优先 / 知识录入 / 知识查询 testIDs in correct order",
    "knowledge map/vault/editor entry",
    "calendar CRUD",
    "markdown/html editor",
    "cloudbase forwarder mobile compaction",
    "visual smoke auto pairing contract",
    "P0-A vault source truth explicit fields",
    "P0-B add-note single-shot Markdown + HTML + duplicate guard",
  ],
}, null, 2));
