import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandGlyph } from "@/components/brand-glyph";
import { SkeletonText } from "@/components/Skeleton";
import { Button } from "@/components/Button";
import { QRScanModal } from "@/components/QRScanModal";
import { Color, Radius, Shadow, Size, Space, Type } from "@/constants/design";
import { Haptics } from "@/lib/haptics";
import { RecorderFloatingBar } from "@/App";
import { useRecorder, type RecorderMode } from "@/lib/RecorderContext";
import {
  claimPairing,
  createVoiceNote,
  createChatSession,
  addKnowledgeNote,
  fetchBootstrap,
  fetchKnowledgeAtlas,
  fetchToday,
  humanizeMobileError,
  listVoiceNotes,
  listRecorderSegments,
  normalizeServerUrl,
  organizeVoiceNote,
  finalizeRecorderIngest,
  resolveApproval,
  sendChatMessage,
  startRecorderSession,
  todayKey,
  transcribeVoiceNote,
  uploadRecorderAudio,
  uploadRecorderLiveSegment,
} from "@/lib/api";
import {
  clearAllRecorderLocalState,
  clearRecorderRecoveryMarker,
  loadLastSyncTimestamp,
  loadMobileSession,
  loadPendingNotes,
  loadRecorderDraft,
  loadRecorderRecoveryMarker,
  loadTodayCache,
  removePendingNote,
  saveLastSyncTimestamp,
  savePendingNote,
  saveRecorderDraft,
  saveRecorderRecoveryMarker,
  saveTodayCache,
  updatePendingNoteStatus,
} from "@/lib/storage";
import {
  extractPairingPayloadFromText,
  isQRScanPayload,
  requestQRScannerPermission,
  type QRScanPermissionState,
} from "@/lib/qrPairing";
import {
  getOfflineAsrState,
  isLocalAsrMainPath,
  recordLocalAsrSegment,
  transcribeOffline,
} from "@/lib/offlineAsr";
import type {
  ChatMessage,
  MobileAction,
  MobileAgent,
  MobileBootstrapVault,
  MobilePendingNote,
  MobilePendingNoteSource,
  MobileSession,
  MobileTimelineItem,
  MobileToday,
  MobileTodayAgendaItem,
  MobileVoiceNoteOrganizeResponse,
} from "@/lib/types";

// 执行台内部次级 tab(展开后)
const consoleTabs = ["voice", "chat", "approvals"] as const;
type ConsoleTab = typeof consoleTabs[number];
type SectionTab = "capture" | "console";
type VoiceWorkbenchMode = "closed" | "recording" | "minimized" | "transcribing" | "preview" | "saving" | "saved";
type VoicePreviewTab = "markdown" | "html";

const agents = ["main", "boss", "worker"] as const;
const experienceVersion = "中文验收版 1.0.8";
const macPrimaryCopy = "Mac 是唯一数据真相源，手机只负责查看、对话、审批和接管。";

// 2026-07-06 — R19: emulator-only QA helper.
//
// Emulator AVDs without host audio injection cannot produce real microphone
// audio, so the rolling 12-second live segment in rollLiveSegment() always
// transcribes silence and returns ok=false. This gate hides a debug-only
// button that, when the user taps it, reads the bundled sherpa-onnx
// test_wavs/0.wav from filesDir/models/.../ and feeds it through the SAME
// transcribeOffline() → recordLocalAsrSegment() path the rolling segments
// use. The result is rendered in the same voice workbench textarea.
//
// This is gated by extra.r19QaAudioAction === true in app.json (set only for
// the R19 emulator-validation build, never for production Mate60). Without
// the flag the button does not render.
const R19_QA_AUDIO_FLAG =
  (Constants.expoConfig?.extra as { r19QaAudioAction?: boolean } | undefined)?.r19QaAudioAction === true;

// R19: bundled sherpa-onnx model directory name (must match the assets layout).
const R19_BUNDLED_MODEL_DIR = "sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01";

// R19: same placeholder we ship in the production textarea so the QA-injected
// segment is visually indistinguishable from a real one.
const R19_QA_TEST_WAV = "0.wav";

type AgentId = typeof agents[number];
type VoiceRecordTarget = "note" | "chat";

const agentLabels: Record<string, string> = {
  main: "主智能体",
  boss: "老板视角",
  worker: "执行智能体",
};

const statusLabels: Record<string, string> = {
  ok: "正常",
  warn: "需关注",
  critical: "需接管",
  unavailable: "不可用",
  unknown: "未确认",
  active: "进行中",
  open: "待处理",
  blocked: "阻塞",
  complete: "已完成",
  completed: "已完成",
  error: "异常",
  failed: "失败",
  gateway: "网关",
  pending: "等待中",
  running: "运行中",
  sent: "已发送",
  approved: "已批准",
  rejected: "已拒绝",
  ready: "就绪",
  idle: "空闲",
  degraded: "降级",
  healthy: "健康",
  unhealthy: "异常",
  manual_action: "等待人工",
  waiting_manual: "等待人工",
  review_required: "需要复核",
  gateway_unavailable: "网关不可用",
  offline_read_only: "离线只读",
};

const sourceLabels: Record<string, string> = {
  calendar: "日程",
  agent_ops: "智能体",
  agentops: "智能体",
  agentOps: "智能体",
  chat: "对话",
  gateway: "网关",
  tasks: "任务",
  approvals: "审批",
  reports: "报告",
  notes: "笔记",
  inbox: "收件箱",
  source: "来源",
  api: "接口",
  cache: "缓存",
  fallback: "备用源",
  live: "实时",
  mobile: "手机端",
  workbench: "工作台",
  calendar_notes: "日程笔记",
  system_ops: "系统运维",
};

const actionLabels: Record<string, string> = {
  open: "打开",
  continue: "继续处理",
  review: "复核",
  approve: "审批",
  resolve: "处理",
  inspect: "查看",
  retry: "重试",
  resume: "恢复",
};

const approvalActionLabels: Record<string, string> = {
  approve: "批准",
  reject: "拒绝",
  computer_use: "桌面操作",
  file_write: "写入文件",
  shell_command: "执行命令",
  network_access: "网络访问",
  send_message: "发送消息",
  final_delivery: "最终交付",
};

function getPreviewWorkbenchUrl() {
  const configured = typeof globalThis === "object"
    ? (globalThis as typeof globalThis & { __OPENCLAW_MOBILE_DEFAULT_WORKBENCH_URL?: string }).__OPENCLAW_MOBILE_DEFAULT_WORKBENCH_URL
    : "";
  if (configured) return configured;

  const envConfigured = typeof globalThis === "object"
    ? (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_OPENCLAW_WORKBENCH_URL
    : "";
  if (envConfigured) return envConfigured;

  if (Platform.OS === "ios" && Device.isDevice === false) return "http://127.0.0.1:38888";

  const location = typeof globalThis === "object" && "location" in globalThis ? globalThis.location : null;
  const webHost = typeof location?.hostname === "string" ? location.hostname : "";
  if (webHost && webHost !== "localhost") return `http://${webHost}:38888`;
  if (webHost === "localhost") return "http://127.0.0.1:38888";

  const constants = Constants as typeof Constants & {
    expoConfig?: { hostUri?: string };
    manifest?: { debuggerHost?: string; hostUri?: string };
    manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
  };
  const hostUri =
    constants.expoConfig?.hostUri ||
    constants.manifest?.hostUri ||
    constants.manifest?.debuggerHost ||
    constants.manifest2?.extra?.expoClient?.hostUri ||
    "";
  const nativeHost = hostUri.split(":")[0];
  if (nativeHost && nativeHost !== "localhost" && nativeHost !== "127.0.0.1") {
    return `http://${nativeHost}:38888`;
  }
  const publicBrokerUrl = getPublicBrokerUrl();
  if (publicBrokerUrl) return publicBrokerUrl;
  return "https://";
}

function getPublicBrokerUrl() {
  const extra = Constants.expoConfig?.extra as { openclaw?: { publicBrokerUrl?: string } } | undefined;
  return String(extra?.openclaw?.publicBrokerUrl || "").replace(/\/+$/, "");
}

function labelAgent(agentId?: string) {
  if (!agentId) return "智能体";
  return agentLabels[agentId.toLowerCase()] || "智能体";
}

function labelStatus(value?: string | null) {
  if (!value) return "未确认";
  const key = String(value).toLowerCase();
  return statusLabels[key] || "未识别状态";
}

function labelSource(value?: string | null) {
  if (!value) return "来源";
  return sourceLabels[String(value)] || sourceLabels[String(value).toLowerCase()] || "其他来源";
}

function labelAction(value?: string | null) {
  if (!value) return "查看";
  const key = String(value).trim().toLowerCase();
  return actionLabels[key] || value;
}

function labelApprovalAction(value?: string | null) {
  if (!value) return "操作";
  const key = String(value).trim().toLowerCase();
  return approvalActionLabels[key] || String(value).replace(/_/g, " ");
}

function isWebRuntime() {
  return Platform.OS === "web";
}

function staleText(seconds: number | null | undefined) {
  if (seconds == null) return "无延迟数据";
  if (seconds < 15) return "刚刚更新";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} 分钟前`;
}

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
}

function webSearchParams(url: string) {
  if (typeof URL === "undefined") return {};
  try {
    const parsed = new URL(url);
    return {
      server: parsed.searchParams.get("server") || "",
      code: parsed.searchParams.get("code") || "",
    };
  } catch {
    return {};
  }
}

function primaryNextAction(today: MobileToday | null, usingCache: boolean) {
  if (usingCache) return "恢复网络后再发送或审批";
  const first = today?.nextActions?.[0];
  if (first?.title) return first.title;
  if ((today?.approvals || []).length > 0) return "先处理待审批动作";
  if ((today?.blocked || []).length > 0) return "查看阻塞任务并决定是否接管";
  if (!today) return "连接 Mac 工作台并下拉刷新";
  return "今日暂无明确待办，可直接发起对话";
}

function trustSignal(today: MobileToday | null, usingCache: boolean) {
  if (usingCache) return "缓存视图，不允许写入";
  const gateway = labelStatus(today?.status.gateway);
  const summary = today?.status.summary || "等待 Mac 返回状态";
  return `${gateway} · ${summary}`;
}

function handoffSignal(today: MobileToday | null, tone: string, usingCache: boolean) {
  if (usingCache) return "需要恢复连接";
  if ((today?.approvals || []).length > 0) return "需要审批";
  if (tone === "critical") return "建议接管";
  if (tone === "warn") return "需要关注";
  return "暂不需要接管";
}

function makeLocalNoteId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `local-${Date.now().toString(36)}-${random}`;
}

function buildPendingNote(params: {
  title: string;
  body: string;
  transcript: string;
  audioUri: string;
  audioMime: string | null;
  durationSeconds: number | null;
  source: MobilePendingNoteSource;
}): MobilePendingNote {
  const now = new Date().toISOString();
  return {
    id: makeLocalNoteId(),
    title: params.title,
    body: params.body,
    transcript: params.transcript,
    hasAudio: Boolean(params.audioUri),
    audioUri: params.audioUri,
    audioMime: params.audioMime,
    durationSeconds: params.durationSeconds,
    source: params.source,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    lastError: "",
    retryCount: 0,
  };
}

function describePendingStatus(note: MobilePendingNote) {
  if (note.status === "syncing") return "同步中";
  if (note.status === "failed") {
    return note.lastError ? `同步失败 · ${note.lastError}` : "同步失败，可重试";
  }
  return note.lastError ? `等待同步 · ${note.lastError}` : "等待恢复网络后同步";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildVoicePreviewMarkdown(params: { title: string; transcript: string; durationSeconds: number | null }) {
  const title = params.title.trim() || `手机语音记录 ${todayKey()}`;
  const transcript = params.transcript.trim() || "（等待转写或手动输入）";
  return [
    `# ${title}`,
    "",
    `- 来源: 手机语音记录`,
    `- 日期: ${todayKey()}`,
    `- 时长: ${formatDuration(params.durationSeconds)}`,
    "",
    "## 转写正文",
    "",
    transcript,
  ].join("\n");
}

function buildVoicePreviewHtml(params: { title: string; transcript: string; durationSeconds: number | null }) {
  const title = escapeHtml(params.title.trim() || `手机语音记录 ${todayKey()}`);
  const transcript = escapeHtml(params.transcript.trim() || "（等待转写或手动输入）").replace(/\n/g, "<br />");
  return [
    "<article>",
    `  <h1>${title}</h1>`,
    `  <p><strong>来源:</strong> 手机语音记录 · <strong>日期:</strong> ${todayKey()} · <strong>时长:</strong> ${formatDuration(params.durationSeconds)}</p>`,
    "  <h2>转写正文</h2>",
    `  <p>${transcript}</p>`,
    "</article>",
  ].join("\n");
}

type OpenCalendarParams = { kind?: "all" | "event" | "task" | "reminder" };

export default function TodayConsoleScreen({ onOpenKnowledge, onOpenCalendar, onPairingStateChange, onRePair, onOpenCapture }: { onOpenKnowledge?: () => void; onOpenCalendar?: (params?: OpenCalendarParams) => void; onPairingStateChange?: (active: boolean) => void; onRePair?: () => void; onOpenCapture?: () => void } = {}) {
  const queryClient = useQueryClient();
  const { state: appRecorderState, actions: recorderActions } = useRecorder();
  const {
    close: recorderClose,
    restore: recorderRestore,
    minimize: recorderMinimize,
    reportChunk: recorderReportChunk,
    reportSegment: recorderReportSegment,
    reportTotalChunks: recorderReportTotalChunks,
    reportLiveSegmentUploaded: recorderReportLiveSegmentUploaded,
    reportLocalAsrSegment: recorderReportLocalAsrSegment,
    setLiveTranscription: recorderSetLiveTranscription,
    setAudio: recorderSetAudio,
    setMode: recorderSetMode,
    setPaused: recorderSetPaused,
    setPreviewTab: recorderSetPreviewTab,
    setRecorderSession: recorderSetSession,
    setSeconds: recorderSetSeconds,
    setTitle: recorderSetTitle,
    setTranscript: recorderSetTranscript,
    start: recorderStart,
  } = recorderActions;
  const [session, setSession] = useState<MobileSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [serverUrl, setServerUrl] = useState(getPreviewWorkbenchUrl);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingError, setPairingError] = useState("");
  // R17: QR 扫码 modal 状态 + 权限状态
  const [qrScanOpen, setQRScanOpen] = useState(false);
  const [qrScanError, setQRScanError] = useState("");
  const [qrScannerAvailable, setQrScannerAvailable] = useState(false);
  const [qrScannerPermission, setQrScannerPermission] = useState<QRScanPermissionState>("unknown");
  const [section, setSection] = useState<SectionTab>("capture");
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("voice");
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("main");
  // 语音输入默认折叠,首屏只露文字 + 添加笔记
  const [showVoice, setShowVoice] = useState(false);
  const [chatSessionId, setChatSessionId] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [voiceTitle, setVoiceTitle] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceResult, setVoiceResult] = useState<MobileVoiceNoteOrganizeResponse | null>(null);
  const [voiceNoteModal, setVoiceNoteModal] = useState<{ id: string; title: string; transcriptText: string; status?: string | null; knowledgePath?: string; htmlPath?: string } | null>(null);
  const [voiceRecorderError, setVoiceRecorderError] = useState("");
  const [voiceWorkbenchMode, setVoiceWorkbenchMode] = useState<VoiceWorkbenchMode>("closed");
  // 2026-07-03 — R7 stale recorder recovery.
  // Tracks when the workbench last saw progress; surface a recovery banner
  // when a "preview" / "transcribing" / "saving" state has had no movement
  // for > RECOVERY_STALE_MS. Also let users explicitly clear the stale
  // local state without deleting server data (server stays in
  // mobile_recording_sessions; mobile just stops blocking the home page).
  const [voiceWorkbenchStaleSince, setVoiceWorkbenchStaleSince] = useState<string | null>(null);
  const [voiceRecoveryDismissed, setVoiceRecoveryDismissed] = useState(false);
  // Boot-time stale marker from storage: if the device crashed / was killed
  // mid-recording, the previous JS engine wrote a small recovery blob. We
  // surface it on cold start without blocking first-render.
  const [bootRecoveryMarker, setBootRecoveryMarker] = useState<{ voiceNoteId: string | null; recorderSessionId: string | null; writtenAt: string | null } | null>(null);
  const recorderProgressSigRef = useRef<string>("");
  const RECOVERY_STALE_MS = 60_000;
  const [voicePreviewTab, setVoicePreviewTab] = useState<VoicePreviewTab>("markdown");
  const [autoOrganizing, setAutoOrganizing] = useState(false);
  const [pendingTranscriptionVoiceNoteId, setPendingTranscriptionVoiceNoteId] = useState<string | null>(null);
  const [recordedAudioUri, setRecordedAudioUri] = useState("");
  const [recordedAudioMime, setRecordedAudioMime] = useState<string | null>(null);
  const [recordedDurationSeconds, setRecordedDurationSeconds] = useState<number | null>(null);
  const [mobileRecorderSessionId, setMobileRecorderSessionId] = useState<string | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<VoiceRecordTarget | null>(null);
  // 2026-07-04 — R10 live transcription: while a NOTE recording is active we run
  // a rolling segment loop (record ~12s → finalize → upload → keep recording).
  // `noteLiveActive` stays true across segment boundaries so the workbench does
  // not flicker while the recorder briefly stops between rolling segments.
  const [noteLiveActive, setNoteLiveActive] = useState(false);
  const noteLiveActiveRef = useRef(false);
  const liveSegmentIndexRef = useRef(0);
  const liveSegmentBusyRef = useRef(false);
  const liveChunkTotalRef = useRef(0);
  const [chatRecordedAudioUri, setChatRecordedAudioUri] = useState("");
  const [chatRecordedDurationSeconds, setChatRecordedDurationSeconds] = useState<number | null>(null);
  const [chatVoiceError, setChatVoiceError] = useState("");
  const [cachedToday, setCachedToday] = useState<{ cachedAt: string; today: MobileToday } | null>(null);

  // 快速文本笔记状态
  const [quickTitle, setQuickTitle] = useState("");
  const [quickBody, setQuickBody] = useState("");
  const [quickSaveError, setQuickSaveError] = useState("");
  const [quickSavePending, setQuickSavePending] = useState(false);
  const [quickSavedResult, setQuickSavedResult] = useState<MobileVoiceNoteOrganizeResponse | null>(null);
  // 防止重复保存:同一个 in-flight 笔记在保存完成前会持这个 id
  const [quickInFlightId, setQuickInFlightId] = useState<string | null>(null);

  // 知识搜索(首屏直接可用,只过滤本机已缓存的来源 / 笔记;不主动拉远端)
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const scrollRef = useRef<ScrollView | null>(null);

  // 离线/待同步队列
  const [pendingNotes, setPendingNotes] = useState<MobilePendingNote[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncingIds, setSyncingIds] = useState<string[]>([]);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 250);

  useEffect(() => {
    let active = true;
    Promise.all([loadMobileSession(), loadTodayCache(), loadPendingNotes(), loadLastSyncTimestamp()])
      .then(async ([storedSession, cache, pending, sync]) => {
        let effectiveSession = storedSession;
        if (effectiveSession?.serverUrl) {
          setServerUrl(normalizeServerUrl(effectiveSession.serverUrl) || effectiveSession.serverUrl);
        }
        if (!active) return;
        setSession(effectiveSession);
        setCachedToday(cache);
        setPendingNotes(pending);
        setLastSyncAt(sync);
      })
      .finally(() => active && setLoadingSession(false));
    return () => {
      active = false;
    };
  }, []);

  // 配对屏出现时隐藏底部 tab bar,否则会盖住 mobile-pair-submit
  // 的点击区(iPhone 800 屏 y≈802);配对成功后自动恢复。
  useEffect(() => {
    if (!onPairingStateChange) return;
    onPairingStateChange(!loadingSession && !session);
  }, [loadingSession, session, onPairingStateChange]);

  useEffect(() => {
    function applyPairingUrl(url: string | null) {
      if (!url) return;
      const parsed = Linking.parse(url);
      const webParams = webSearchParams(url);
      const params = parsed.queryParams || {};
      const nextServer = firstParam(params.server) || webParams.server || "";
      const nextCode = (firstParam(params.code) || webParams.code || "").replace(/\D/g, "").slice(0, 6);
      const isPairLink = parsed.hostname === "pair" || parsed.path === "pair" || Boolean(nextServer || nextCode);
      if (!isPairLink) return;
      if (nextServer) setServerUrl(nextServer);
      if (nextCode) setPairingCode(nextCode);
    }

    void Linking.getInitialURL().then(applyPairingUrl);
    if (typeof globalThis === "object" && "location" in globalThis && typeof globalThis.location?.href === "string") {
      applyPairingUrl(globalThis.location.href);
    }
    const subscription = Linking.addEventListener("url", (event) => applyPairingUrl(event.url));
    return () => subscription.remove();
  }, []);

  // R17: 检测 QR 扫码模块是否可用(native rebuild 后才会有 expo-camera),
  // 并在第一次需要时请求权限。无相机时,UI 自动降级到「手动粘贴 / 剪贴板」。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // dynamic import; native module not linked → promise resolves null
        // @ts-ignore — expo-camera is an optional native dep; resolves to null when missing.
        const mod = await import("expo-camera").catch(() => null);
        if (cancelled) return;
        const has = Boolean(mod && mod && typeof (mod as { requestCameraPermissionsAsync?: unknown }).requestCameraPermissionsAsync === "function");
        setQrScannerAvailable(has);
      } catch {
        if (!cancelled) setQrScannerAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // R17: 把扫描结果 / 剪贴板文本 / 手动粘贴的内容统一走这个 helper:
  // - 解析出 server URL + 6 位配对码
  // - 自动填到 serverUrl / pairingCode
  // - 自动触发配对 mutation,不需要用户再点「连接」
  // - 解析失败时把错误回写到 qrScanError,Modal 内部显示出来
  //
  // 注:pairMutation 是用 useMutation 定义的,必须在 useMutation 调用之后才能
  // 引用,所以这里改成 useRef + 实际函数体在 pairMutation 之后定义。
  const pairMutationRef = useRef<{ mutate: () => void } | null>(null);

  const handleScannedPayload = useCallback(
    (rawPayload: string) => {
      if (!rawPayload || !rawPayload.trim()) {
        setQRScanError("扫描结果为空。请确认 QR 码清晰,或使用「手动粘贴」继续。");
        setQRScanOpen(true);
        return;
      }
      if (!isQRScanPayload(rawPayload)) {
        setQRScanError(
          `扫描结果不是 OpenClaw 配对 QR 码: "${rawPayload.slice(0, 32)}${rawPayload.length > 32 ? "…" : ""}"。请扫描桌面端系统设置里的二维码,或使用「手动粘贴」。`,
        );
        setQRScanOpen(true);
        return;
      }
      const parsed = extractPairingPayloadFromText(rawPayload);
      if (!parsed) {
        setQRScanError(
          "QR 码格式不识别(应包含 server= 和 code= 两个参数)。请重新生成桌面端配对码后重试。",
        );
        setQRScanOpen(true);
        return;
      }
      setQRScanError("");
      if (parsed.server) setServerUrl(parsed.server);
      if (parsed.code) setPairingCode(parsed.code);
      Haptics.success();
      // 解析成功后,自动进入「连接并进入记录」流程。
      // 用 setTimeout 推到下一个宏任务,保证 setServerUrl/setPairingCode 完成。
      setTimeout(() => {
        if (pairMutationRef.current) pairMutationRef.current.mutate();
      }, 0);
    },
    [],
  );

  const bootstrapQuery = useQuery({
    queryKey: ["mobile-bootstrap", session?.serverUrl, session?.device.id],
    enabled: Boolean(session),
    queryFn: () => fetchBootstrap(session as MobileSession, setSession),
    // 2026-07-04 R8: NAS vault status can flip from unavailable → connected
    // while the user keeps the app open. A 60s auto-refresh clears the stale
    // "未挂载" banner without requiring a manual pull-to-refresh.
    refetchInterval: 60_000,
  });

  const todayQuery = useQuery({
    queryKey: ["mobile-today", session?.serverUrl, todayKey()],
    enabled: Boolean(session),
    queryFn: () => fetchToday(session as MobileSession, todayKey(), setSession),
    refetchInterval: 30_000,
  });

  const voiceQuery = useQuery({
    queryKey: ["mobile-voice-notes", session?.serverUrl, session?.device.id, todayKey()],
    enabled: Boolean(session),
    queryFn: () => listVoiceNotes(session as MobileSession, todayKey(), setSession),
    refetchInterval: pendingTranscriptionVoiceNoteId ? 3000 : false,
  });

  // 首屏直接展示已缓存的知识地图,搜索只过滤本地缓存 — 不发起额外请求
  const atlasQuery = useQuery({
    queryKey: ["knowledge-atlas", session?.serverUrl, session?.device.id],
    enabled: Boolean(session),
    queryFn: () => fetchKnowledgeAtlas(session as MobileSession, setSession),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!pendingTranscriptionVoiceNoteId) return;
    const note = voiceQuery.data?.voiceNotes.find((row) => row.id === pendingTranscriptionVoiceNoteId);
    if (!note) return;
    const transcript = String(note.transcriptText || "").trim();
    if (note.status === "transcript_ready" && transcript) {
      setVoiceTranscript((current) => {
        const draft = current.trim();
        if (!draft) return transcript;
        if (draft.includes(transcript)) return current;
        return `${draft}\n\n---\n远端兜底转写\n${transcript}`;
      });
      setVoiceRecorderError("");
      setAutoOrganizing(false);
      setPendingTranscriptionVoiceNoteId(null);
      setVoiceWorkbenchMode("preview");
      setVoicePreviewTab("markdown");
      Haptics.success();
      void queryClient.invalidateQueries({ queryKey: ["mobile-today"] });
      return;
    }
    if (note.status === "transcription_failed") {
      setAutoOrganizing(false);
      setPendingTranscriptionVoiceNoteId(null);
      setVoiceWorkbenchMode("preview");
      setVoiceRecorderError(`自动转写失败: ${humanizeMobileError(note.error || "transcription_failed")}. 录音已保留,可手动输入或稍后重试。`);
      Haptics.error();
    }
  }, [pendingTranscriptionVoiceNoteId, voiceQuery.data?.voiceNotes, queryClient]);

  useEffect(() => {
    if (todayQuery.data) {
      void saveTodayCache(todayQuery.data);
      setCachedToday({ cachedAt: new Date().toISOString(), today: todayQuery.data });
      void saveLastSyncTimestamp();
      setLastSyncAt(new Date().toISOString());
    }
  }, [todayQuery.data]);

  const today = todayQuery.data || cachedToday?.today || null;
  const usingCache = !todayQuery.data && Boolean(cachedToday?.today);
  const offlineReadOnly = usingCache;
  const statusTone = today?.status.tone || "critical";
  const webPreview = isWebRuntime();
  const cleanServerUrl = serverUrl.trim();
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const serverWasNormalized = Boolean(cleanServerUrl && normalizedServerUrl && cleanServerUrl !== normalizedServerUrl);
  const publicBrokerUrl = getPublicBrokerUrl();
  const serverLooksReady = Boolean(normalizedServerUrl) && normalizedServerUrl !== "https://" && normalizedServerUrl !== "http://";
  const serverMode = normalizedServerUrl.includes("openclaw-relay")
    ? "CloudBase 公网中转"
    : normalizedServerUrl.includes(":38888")
    ? "同 Wi-Fi Mac"
    : normalizedServerUrl.startsWith("https://")
      ? "公网 HTTPS"
      : webPreview
        ? "网页同源"
        : "待确认";
  const pairingServerOptions = useMemo(() => {
    const rows = [
      { label: "当前地址", value: normalizeServerUrl(getPreviewWorkbenchUrl()) },
      { label: "同 Wi-Fi Mac", value: "http://192.168.0.105:38888" },
      { label: "测试端口", value: "http://192.168.0.105:38890" },
      publicBrokerUrl ? { label: "公网中转", value: publicBrokerUrl } : null,
    ].filter(Boolean) as Array<{ label: string; value: string }>;
    const seen = new Set<string>();
    return rows.filter((row) => {
      const value = normalizeServerUrl(row.value);
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }, [publicBrokerUrl]);
  const visibleUpdatedAt = today?.updatedAt || bootstrapQuery.data?.service.updatedAt;
  const mission = {
    next: primaryNextAction(today, usingCache),
    trust: trustSignal(today, usingCache),
    handoff: handoffSignal(today, statusTone, usingCache),
    updated: shortTime(visibleUpdatedAt),
  };
  const liveRecordingSeconds = Math.max(0, Math.round((recorderState.durationMillis || 0) / 1000));
  const noteRecordingActive = (recorderState.isRecording || noteLiveActive) && recordingTarget === "note";
  const chatRecordingActive = recorderState.isRecording && recordingTarget === "chat";
  const activeVoiceDurationSeconds = recordedDurationSeconds ?? (noteRecordingActive ? liveRecordingSeconds : null);
  const activeChatVoiceDurationSeconds = chatRecordedDurationSeconds ?? (chatRecordingActive ? liveRecordingSeconds : null);
  const hasRecordedAudio = Boolean(recordedAudioUri || recordedDurationSeconds || noteRecordingActive);
  const autoTranscriptionReady = Boolean(bootstrapQuery.data?.featureFlags?.voiceAutoTranscription);
  // R11: autoTranscriptionLabel 不再作为「主 ASR 路径是否就绪」的唯一信号。
  // 本地 ASR 状态机 (appRecorderState.offlineAsr) 才是主路径;
  // autoTranscriptionReady 只表示「Mac 工作台是否还提供 R5B 录音会话转写服务」,
  // 作为 R9B 远端兜底的次级信号。UI 文案必须如实展示两者优先级。
  const offlineAsrReady =
    appRecorderState.offlineAsr.status === "ready" &&
    (appRecorderState.offlineAsr.engineId === "sherpa-onnx" ||
      appRecorderState.offlineAsr.engineId === "whisper-rn");
  const offlineAsrMacFallback =
    appRecorderState.offlineAsr.status === "ready" &&
    appRecorderState.offlineAsr.engineId === "mac-segment-fallback";
  // R18: 派生录音中实时本地 ASR 状态(用于 voiceHeroMeta / realtime row 决定
  //   头行文案是否提到「本地 ASR 已实时转写 X 段」而不是「远端兜底」)。
  const voiceLocalLive = appRecorderState.localSegmentsCount > 0;
  const voiceLocalLiveLabel = voiceLocalLive
    ? `本地 ASR 已实时转写 ${appRecorderState.localSegmentsCount} 段`
    : null;
  const autoTranscriptionLabel = offlineAsrReady
    ? "本地 ASR 就绪"
    : offlineAsrMacFallback
      ? "本地未装 · 远端兜底"
      : appRecorderState.offlineAsr.status === "missing"
        ? "本地未装"
        : appRecorderState.offlineAsr.status === "loading"
          ? "本地加载中"
          : appRecorderState.offlineAsr.status === "failed"
            ? "本地失败"
            : bootstrapQuery.isFetching
              ? "检测中"
              : autoTranscriptionReady
                ? "远端兜底可用"
                : "未配置";
  const hasVoiceTranscript = Boolean(voiceTranscript.trim());
  const canAutoTranscribe = Boolean(recordedAudioUri && (offlineAsrReady || offlineAsrMacFallback || autoTranscriptionReady));
  const hasChatRecordedAudio = Boolean(chatRecordedAudioUri || chatRecordedDurationSeconds || chatRecordingActive);
  const canTranscribeChatVoice = Boolean(chatRecordedAudioUri && (offlineAsrReady || offlineAsrMacFallback || autoTranscriptionReady));
  const voiceWorkbenchOpen = voiceWorkbenchMode !== "closed";
  const voiceWorkbenchMinimized = voiceWorkbenchMode === "minimized";
  const voicePreviewTitle = voiceTitle.trim() || `手机语音记录 ${todayKey()}`;
  const voicePreviewMarkdown = buildVoicePreviewMarkdown({
    title: voicePreviewTitle,
    transcript: voiceTranscript,
    durationSeconds: activeVoiceDurationSeconds,
  });
  const voicePreviewHtml = buildVoicePreviewHtml({
    title: voicePreviewTitle,
    transcript: voiceTranscript,
    durationSeconds: activeVoiceDurationSeconds,
  });

  // R5C — mirror the real TodayConsole recorder into App-shell context so a
  // minimized recorder remains visible across Knowledge / Calendar / Device.
  useEffect(() => {
    if (voiceWorkbenchMode === "closed") {
      if (!noteRecordingActive && !autoOrganizing && !recordedAudioUri && !voiceTranscript.trim() && appRecorderState.mode !== "closed") {
        recorderClose();
      }
      return;
    }
    const nextMode: RecorderMode = voiceWorkbenchMode === "minimized"
      ? noteRecordingActive
        ? "recording"
        : autoOrganizing || pendingTranscriptionVoiceNoteId
          ? "transcribing"
          : recordedAudioUri || voiceTranscript.trim()
            ? "preview"
            : "recording"
      : noteRecordingActive
        ? "recording"
        : autoOrganizing || voiceWorkbenchMode === "transcribing"
          ? "transcribing"
          : voiceWorkbenchMode === "saving"
            ? "saving"
            : voiceWorkbenchMode === "saved"
              ? "saved"
              : "preview";
    if (appRecorderState.mode === "closed") recorderStart();
    if (appRecorderState.mode !== nextMode) recorderSetMode(nextMode);
    if (voiceWorkbenchMode === "minimized" && !appRecorderState.minimized) recorderMinimize();
    if (voiceWorkbenchMode !== "minimized" && appRecorderState.minimized) recorderRestore();
  }, [
    autoOrganizing,
    noteRecordingActive,
    pendingTranscriptionVoiceNoteId,
    recordedAudioUri,
    recorderClose,
    recorderMinimize,
    recorderRestore,
    recorderSetMode,
    appRecorderState.minimized,
    appRecorderState.mode,
    recorderStart,
    voiceTranscript,
    voiceWorkbenchMode,
  ]);

  useEffect(() => {
    if (appRecorderState.mode === "closed") return;
    recorderSetSeconds(activeVoiceDurationSeconds ?? liveRecordingSeconds);
    recorderSetTitle(voicePreviewTitle);
    recorderSetTranscript(voiceTranscript);
    recorderSetPreviewTab(voicePreviewTab);
    if (recordedAudioUri) {
      recorderSetAudio({
        uri: recordedAudioUri,
        mime: recordedAudioMime,
        durationSeconds: activeVoiceDurationSeconds || 0,
      });
    }
  }, [
    activeVoiceDurationSeconds,
    liveRecordingSeconds,
    recordedAudioMime,
    recordedAudioUri,
    appRecorderState.mode,
    recorderSetAudio,
    recorderSetPreviewTab,
    recorderSetSeconds,
    recorderSetTitle,
    recorderSetTranscript,
    voicePreviewTab,
    voicePreviewTitle,
    voiceTranscript,
  ]);

  useEffect(() => {
    if (!noteRecordingActive) return;
    setShowVoice(true);
    setVoiceWorkbenchMode((mode) => mode === "minimized" ? "minimized" : "recording");
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 80);
    return () => clearTimeout(timer);
  }, [noteRecordingActive]);

  // 2026-07-04 — R9B: realtime / near-realtime transcript loop.
  //
  // Mate60 1.0.8 acceptance still left the recording workbench feeling like
  // "record now, maybe see text after stop". R9 fixed the *stop* path (chunked
  // upload + segment poll after stop), but the *during recording* phase was
  // still blank. R9B adds a low-frequency polling loop that, while the
  // recorder workbench is open AND recording is active, calls
  // `listRecorderSegments()` on the existing R5B recorder session and merges
  // any new segments into the visible transcript draft.
  //
  // Constraints:
  //   * Polling interval is fixed at RECORDER_SEGMENT_POLL_MS (10s, well above
  //     the 8s floor the task contract requires) so the CloudBase relay and
  //     Mac workbench are not hammered.
  //   * Only fires while `noteRecordingActive` AND the workbench is open AND
  //     not minimized AND we have a `mobileRecorderSessionId`. Closing,
  //     minimizing, or finishing the recording tears the timer down
  //     immediately.
  //   * Segment text is merged without duplication: a Set ref tracks every
  //     segment id we have already appended, so re-polls are no-ops for old
  //     segments and append-only for new ones.
  //   * Failure is silent: realtime polling must not race with the stop /
  //     retry handlers that already surface the same error via
  //     `voiceRecorderError`.
  const RECORDER_SEGMENT_POLL_MS = 10_000;
  const seenSegmentIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Reset the seen-set whenever the R5B session id changes (new recording).
    // Without this, a second recording on the same JS heap would skip the
    // first segment of every poll because the ids overlap.
    if (!mobileRecorderSessionId) {
      if (seenSegmentIdsRef.current.size > 0) seenSegmentIdsRef.current = new Set();
      return undefined;
    }
    if (!noteRecordingActive) return undefined;
    if (!voiceWorkbenchOpen || voiceWorkbenchMinimized) return undefined;
    if (!session) return undefined;

    let cancelled = false;
    const fetchSegments = async () => {
      if (cancelled) return;
      try {
        const segResp = await listRecorderSegments(session, mobileRecorderSessionId, setSession);
        if (cancelled) return;
        const segments = Array.isArray(segResp.segments) ? segResp.segments : [];
        if (segments.length === 0) return;
        const seen = seenSegmentIdsRef.current;
        const freshTexts: string[] = [];
        let freshCount = 0;
        for (const seg of segments) {
          const id = String(seg?.id || "").trim();
          const text = String(seg?.text || "").trim();
          if (!text) continue;
          if (id) {
            if (seen.has(id)) continue;
            seen.add(id);
            freshCount += 1;
          }
          freshTexts.push(text);
        }
        if (freshTexts.length === 0) return;
        setVoiceTranscript((current) => {
          const draft = String(current || "").trim();
          const merged = freshTexts.join("\n");
          if (!draft) return merged;
          // Avoid re-appending if the same exact merged text already lives in
          // the draft — defensive against server-side segment-list overlaps.
          if (draft.includes(merged)) return current;
          return `${draft}\n\n---\n远端兜底片段 (实时)\n${merged}`;
        });
        if (freshCount > 0) {
          for (let i = 0; i < freshCount; i += 1) recorderReportSegment();
          recorderSetLiveTranscription("received");
        }
      } catch {
        // Realtime poll errors are intentionally silent — the dedicated retry
        // button (retryVoiceWorkbenchSync) and the stop handler surface any
        // meaningful failure with a real humanized message.
      }
    };
    // Kick off one immediate fetch so the user does not have to wait the
    // first interval to see Mac's first segment, if any.
    void fetchSegments();
    const timer = setInterval(fetchSegments, RECORDER_SEGMENT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    mobileRecorderSessionId,
    noteRecordingActive,
    voiceWorkbenchOpen,
    voiceWorkbenchMinimized,
    voiceWorkbenchMode,
    session,
    recorderReportSegment,
    recorderSetLiveTranscription,
  ]);

  // Keep a ref mirror of noteLiveActive so the async rolling loop below can
  // bail out synchronously the instant the user stops, without waiting for the
  // effect cleanup to run.
  useEffect(() => {
    noteLiveActiveRef.current = noteLiveActive;
  }, [noteLiveActive]);

  // 2026-07-04 — R10 live transcription rolling segment loop.
  //
  // Expo Audio (managed) cannot stream the active recording's bytes mid-record,
  // so we approximate realtime by ROLLING the single recorder every
  // LIVE_SEGMENT_MS: stop the current segment, immediately restart, and upload
  // the just-finished segment to the /live-segments endpoint in the background.
  // The server transcribes each completed segment; the R9B poll loop above then
  // merges the returned text into voiceTranscript BEFORE the user stops. Small
  // gaps between rolling segments are acceptable for R10 (documented); an
  // invisible continuous recording is a later native/R11 task. This is the real
  // upload-during-recording path — the stop handler is no longer the first or
  // only upload point.
  const LIVE_SEGMENT_MS = 12_000;
  useEffect(() => {
    if (recordingTarget !== "note") return undefined;
    if (!noteLiveActive) return undefined;
    if (!mobileRecorderSessionId || !session) return undefined;

    let cancelled = false;
    const activeRecorderSessionId = mobileRecorderSessionId;
    const rollLiveSegment = async () => {
      if (cancelled || !noteLiveActiveRef.current) return;
      // R17: 用户暂停时,滚动分片循环静默跳过,既不停止原生 recorder
      // 也不发新分片;resume 后会立刻从下一个 LIVE_SEGMENT_MS 间隔续上。
      if (appRecorderState.paused) return;
      if (liveSegmentBusyRef.current) return;
      liveSegmentBusyRef.current = true;
      try {
        // Finalize the current rolling segment, then immediately restart so the
        // gap before the next segment is minimal.
        await audioRecorder.stop();
        const status = audioRecorder.getStatus();
        const segmentUri = audioRecorder.uri || status.url || "";
        const segmentIndex = liveSegmentIndexRef.current;
        const segmentStartSeconds = segmentIndex * Math.round(LIVE_SEGMENT_MS / 1000);
        liveSegmentIndexRef.current += 1;
        if (!cancelled && noteLiveActiveRef.current) {
          await audioRecorder.prepareToRecordAsync();
          audioRecorder.record();
        }
        if (!segmentUri) return;
        recorderSetLiveTranscription("uploading");
        const uploaded = await uploadRecorderLiveSegment(
          session,
          activeRecorderSessionId,
          {
            segmentIndex,
            audioUri: segmentUri,
            durationSeconds: Math.round(LIVE_SEGMENT_MS / 1000),
            language: "zh-CN",
          },
          setSession,
        );
        recorderReportLiveSegmentUploaded();
        const chunksUploaded = Math.max(1, Number(uploaded.chunksUploaded || 1));
        liveChunkTotalRef.current += chunksUploaded;
        recorderReportTotalChunks(liveChunkTotalRef.current);
        for (let i = 0; i < chunksUploaded; i += 1) recorderReportChunk();
        if (uploaded.transcriptionConfigured === false || uploaded.status === "provider_unavailable") {
          recorderSetLiveTranscription("unavailable");
          setVoiceRecorderError(offlineAsrReady
            ? "本地 ASR 引擎未响应;录音仍在分片上传,可在下方手动输入草稿。"
            : offlineAsrMacFallback
              ? "远端兜底转写未配置;录音仍在分片上传,可在下方手动输入草稿。"
              : "本地 ASR 引擎尚未就绪;native rebuild 完成后自动启用。录音仍在分片上传,可在下方手动输入草稿。");
        } else {
          recorderSetLiveTranscription("waiting");
        }
        // R18: 录音中本地 ASR 主路径 — 与 server upload 并行调用
        // transcribeOffline() 把刚停止的分片给本地引擎(默认 sherpa-onnx)
        // 直接转写,成功立即把 segment 推到 voiceTranscript,**不再等
        // server polling**。失败时静默 fallback 到既有 polling。
        //
        // 关键守护:
        //   - 只在本地引擎 ready 且 isLocalAsrMainPath() 为 true 才调,
        //     避免 noop / missing / loading 阶段重复打日志;
        //   - 即便本地端 ok=true 也允许 polling 在后台继续跑,因为 Mac 工
        //     作台协同编辑仍依赖 segments;两边都到时,UI 优先显示本地
        //     段数(localSegmentsCount),polling 段数 segmentsCount 作辅证;
        //   - 失败不抛、不打 error,只在最后一段命中 recorderSetLiveTranscription
        //     以外的"received/failed"分支太重,R18 选择只更新计数器 + 内嵌
        //     文本;真正失败仍然交给 stopVoiceRecording 一次整体 transcribe 兜底。
        if (!cancelled && isLocalAsrMainPath()) {
          try {
            // best-effort,不 await 抛异常给上层 try/catch
            void (async () => {
              try {
                const lowerUri = String(segmentUri || "").toLowerCase();
                const audioMime = lowerUri.endsWith(".m4a")
                  ? "audio/m4a"
                  : lowerUri.endsWith(".wav")
                    ? "audio/wav"
                    : lowerUri.endsWith(".mp3")
                      ? "audio/mpeg"
                      : "audio/m4a";
                const result = await transcribeOffline({
                  audioUri: segmentUri,
                  audioMime,
                  durationSeconds: Math.round(LIVE_SEGMENT_MS / 1000),
                  language: "zh-CN",
                });
                if (cancelled || !noteLiveActiveRef.current) return;
                if (!result.ok || !result.segments || result.segments.length === 0) {
                  return;
                }
                const engineId = result.engineId;
                if (engineId !== "sherpa-onnx" && engineId !== "whisper-rn") {
                  return;
                }
                let firstNewSegment: string | null = null;
                for (const seg of result.segments) {
                  const recorded = recordLocalAsrSegment(
                    seg.text,
                    segmentStartSeconds,
                    segmentStartSeconds + Math.round(LIVE_SEGMENT_MS / 1000),
                    engineId,
                  );
                  if (!recorded) continue;
                  recorderReportLocalAsrSegment();
                  if (firstNewSegment === null) firstNewSegment = seg.text;
                }
                if (firstNewSegment) {
                  setVoiceTranscript((current) => {
                    const draft = String(current || "").trim();
                    if (!draft) return firstNewSegment;
                    if (draft.includes(firstNewSegment)) return current;
                    return `${draft}\n\n---\n本地 ASR 片段\n${firstNewSegment}`;
                  });
                }
                if (appRecorderState.offlineAsr.engineId === engineId) {
                  // engineId 已经就是这个本地引擎,只更新 lastError,不动 status。
                }
              } catch {
                // 静默失败 — 不打断录音;UI 仍是 polling 兜底。
              }
            })();
          } catch {
            // 整段保护,不应影响主流程。
          }
        }
      } catch (err) {
        // Rolling upload failures are non-fatal: the recorder keeps going and
        // the next segment retries. Surface a soft hint but never stop recording.
        recorderSetLiveTranscription("failed");
        setVoiceRecorderError(`实时分片上传失败,已继续录音: ${humanizeMobileError(err instanceof Error ? err.message : String(err))}`);
      } finally {
        liveSegmentBusyRef.current = false;
      }
    };
    const timer = setInterval(rollLiveSegment, LIVE_SEGMENT_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    noteLiveActive,
    mobileRecorderSessionId,
    session,
    recordingTarget,
    audioRecorder,
    appRecorderState.paused,
    appRecorderState.offlineAsr.engineId,
    appRecorderState.offlineAsr.status,
    offlineAsrMacFallback,
    offlineAsrReady,
    recorderReportChunk,
    recorderReportTotalChunks,
    recorderReportLiveSegmentUploaded,
    recorderReportLocalAsrSegment,
    recorderSetLiveTranscription,
  ]);

  // 2026-07-03 — R7: detect a stale voice workbench by re-reading only when
  // the local state changes. Any progress event (recorder-state tick,
  // transcript edit, mode advance, transcript-ready callback, etc.) bumps
  // the signature so the staleness timestamp resets. If no progress is seen
  // for > RECOVERY_STALE_MS, mark stale and surface the recovery banner.
  const voiceProgressSignature =
    `${voiceWorkbenchMode}|${recordedAudioUri || ""}|${recordedDurationSeconds ?? 0}|${voiceTranscript.length}|${autoOrganizing ? 1 : 0}|${pendingTranscriptionVoiceNoteId || ""}|${voiceRecorderError || ""}|${voiceWorkbenchMode === "saved" ? voiceResult?.voiceNote?.id || "" : mobileRecorderSessionId || ""}`;
  useEffect(() => {
    if (voiceWorkbenchMode === "closed") {
      recorderProgressSigRef.current = "";
      if (voiceWorkbenchStaleSince !== null) setVoiceWorkbenchStaleSince(null);
      return;
    }
    if (recorderProgressSigRef.current !== voiceProgressSignature) {
      recorderProgressSigRef.current = voiceProgressSignature;
      if (voiceWorkbenchStaleSince !== null) setVoiceWorkbenchStaleSince(null);
      return;
    }
    // No change since last tick — schedule a stale check after the threshold.
    const handle = setTimeout(() => {
      setVoiceWorkbenchStaleSince((current) => current ?? new Date().toISOString());
    }, RECOVERY_STALE_MS);
    return () => clearTimeout(handle);
  }, [voiceProgressSignature, voiceWorkbenchMode, voiceWorkbenchStaleSince]);
  const voiceWorkbenchStale = voiceWorkbenchStaleSince !== null;
  const voiceWorkbenchProgressRecoveryVisible = voiceWorkbenchStale && !voiceRecoveryDismissed;

  // 2026-07-03 — R7: boot-time stale recovery marker. The previous JS
  // engine, before being killed mid-recording, persisted a small JSON
  // describing what was left in flight. We read it on cold start so the
  // user can dismiss it explicitly instead of seeing a phantom "still
  // recording" indicator with no underlying state.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadRecorderRecoveryMarker(), loadRecorderDraft()])
      .then(([marker, draft]) => {
        if (cancelled) return;
        if (!marker) return;
        setBootRecoveryMarker({
          voiceNoteId: marker.voiceNoteId,
          recorderSessionId: marker.recorderSessionId,
          writtenAt: marker.writtenAt,
        });
        // Draft persistence is opt-in: keep the in-memory recorder state
        // authoritative on cold start, but offer a "restore" gesture for
        // the rare case the user wants the prior draft text back.
        if (draft && draft.transcript && !voiceTranscript.trim()) {
          // No auto-restore: surface in recovery banner below.
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-07-03 — R7: persist a per-device marker every time the workbench
  // leaves "closed" so a crash/kill can be recovered on next launch.
  // Cleared automatically on dismiss/discard paths below.
  useEffect(() => {
    if (voiceWorkbenchMode === "closed") {
      void clearRecorderRecoveryMarker();
      return;
    }
    const normalize = voiceWorkbenchMode === "recording" || voiceWorkbenchMode === "transcribing" || voiceWorkbenchMode === "preview" || voiceWorkbenchMode === "saving" || voiceWorkbenchMode === "saved"
      ? voiceWorkbenchMode
      : "preview";
    void saveRecorderRecoveryMarker({
      mode: normalize,
      voiceNoteId: voiceResult?.voiceNote?.id || null,
      recorderSessionId: mobileRecorderSessionId,
      hasTranscript: Boolean(voiceTranscript.trim()),
      recordedAudio: Boolean(recordedAudioUri),
    });
  }, [voiceWorkbenchMode, mobileRecorderSessionId, voiceResult, voiceTranscript, recordedAudioUri]);

  // 2026-07-03 — R7: persist the draft text so a forced restart still has
  // recoverable local transcript. Audio URI is on the local file system
  // and is NOT persisted (Expo audio files are ephemeral); only the
  // editable surfaces — title / transcript / preview — are saved.
  useEffect(() => {
    if (voiceWorkbenchMode === "closed") return;
    void saveRecorderDraft({
      title: voiceTitle,
      transcript: voiceTranscript,
      audioUri: "",
      audioMime: null,
      durationSeconds: activeVoiceDurationSeconds,
      previewMarkdown: voicePreviewMarkdown,
      previewHtml: voicePreviewHtml,
      startedAt: null,
    });
  }, [
    voiceWorkbenchMode,
    voiceTitle,
    voiceTranscript,
    activeVoiceDurationSeconds,
    voicePreviewMarkdown,
    voicePreviewHtml,
  ]);

  // 快速文本笔记待同步:从 pending 队列中筛选 source=text
  const pendingCount = pendingNotes.length;

  // 首屏可见的今日待办 / 日程预览(最多 3 条)
  // P1 contract: if events/todos/planItems are all empty but nextActions has
  // rows, fall back to nextActions as 待办 so the home screen never claims
  // "今天没有日程或待办" while the agent still has actionable next steps.
  const agendaPreview = useMemo(() => {
    const events = today?.events || [];
    const todos = today?.todos || [];
    const planItems = today?.planItems || [];
    const nextActions = today?.nextActions || [];
    if (events.length + todos.length + planItems.length > 0) {
      return [
        ...events.slice(0, 2).map((row) => ({ ...row, lane: "日程" as const })),
        ...todos.slice(0, 2).map((row) => ({ ...row, lane: "待办" as const })),
        ...planItems.slice(0, 1).map((row) => ({ ...row, lane: "计划" as const })),
      ];
    }
    // No calendar / todo / plan rows — surface next actions separately so the
    // user does not expect them to appear as same-day calendar todos.
    return nextActions.slice(0, 3).map((row) => ({
      id: String(row.id || row.title || row.createdAt || ""),
      title: row.title,
      status: row.priority ? `P${row.priority.toUpperCase()}` : "open",
      priority: row.priority,
      source: row.source,
      start_at: row.createdAt,
      due_at: row.createdAt,
      updated_at: row.createdAt,
      lane: "下一步" as const,
    }));
  }, [today]);
  const eventsTotal = today?.events?.length || 0;
  const todosTotal = today?.todos?.length || 0;
  const planTotal = today?.planItems?.length || 0;
  const nextActionsTotal = today?.nextActions?.length || 0;
  const nextActionsFallbackVisible = eventsTotal + todosTotal + planTotal === 0 && nextActionsTotal > 0;
  const todoPanelMeta = nextActionsFallbackVisible
    ? `${eventsTotal} 日程 · ${todosTotal} 待办 · ${planTotal} 计划 · ${nextActionsTotal} 下一步`
    : `${eventsTotal} 日程 · ${todosTotal} 待办 · ${planTotal} 计划`;

  // 首屏可见的本地缓存知识搜索(仅匹配缓存的 title / summary / path,失败 / 离线都直接说"连接后继续")
  const knowledgePreview = useMemo(() => {
    const sources = atlasQuery.data?.sourceStates || [];
    const query = knowledgeQuery.trim().toLowerCase();
    if (!query) return sources.slice(0, 5);
    return sources
      .filter((row) => {
        const text = `${row.title} ${row.path} ${row.source} ${row.summary}`.toLowerCase();
        return text.includes(query);
      })
      .slice(0, 5);
  }, [atlasQuery.data, knowledgeQuery]);
  const knowledgeOffline = !atlasQuery.data && Boolean(knowledgeQuery.trim());

  const setRecordingError = (target: VoiceRecordTarget, message: string) => {
    if (target === "chat") setChatVoiceError(message);
    else setVoiceRecorderError(message);
  };

  const startVoiceRecording = async (target: VoiceRecordTarget) => {
    if (offlineReadOnly) {
      setRecordingError(target, humanizeMobileError("offline_read_only"));
      return;
    }
    if (recorderState.isRecording) {
      setRecordingError(target, "请先停止当前录音");
      return;
    }
    setRecordingError(target, "");
    if (target === "note") {
      setShowVoice(true);
      setVoiceWorkbenchMode("recording");
      setVoicePreviewTab("markdown");
    }
    if (target === "note") {
      setVoiceResult(null);
      setRecordedAudioUri("");
      setRecordedAudioMime(null);
      setRecordedDurationSeconds(null);
    } else {
      setChatRecordedAudioUri("");
      setChatRecordedDurationSeconds(null);
    }
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("microphone_permission_denied");
      await setAudioModeAsync({
        allowsRecording: true,
        allowsBackgroundRecording: true,
        playsInSilentMode: true,
      });
      setRecordingTarget(target);
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      if (target === "note") {
        // R10: initialize live segment loop state. The rolling loop effect
        // (gated on noteLiveActive + mobileRecorderSessionId) starts uploading
        // ~12s segments during recording; the transcript fills in before stop.
        liveSegmentIndexRef.current = 0;
        liveSegmentBusyRef.current = false;
        liveChunkTotalRef.current = 0;
        noteLiveActiveRef.current = true;
        setNoteLiveActive(true);
        recorderSetLiveTranscription("waiting");
      }
      if (target === "note" && session) {
        void startRecorderSession(
          session,
          {
            title: voiceTitle.trim() || `手机语音记录 ${todayKey()}`,
            scene: "mobile_personal_recorder",
            retentionHours: 24,
            metadata: { entry: "today_console", startedAt: new Date().toISOString() },
          },
          setSession,
        )
          .then((data) => {
            const id = data.session?.id || null;
            setMobileRecorderSessionId(id);
            recorderSetSession({ id, provider: null, error: null });
          })
          .catch((err) => {
            const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
            recorderSetSession({ id: null, provider: null, error: message });
            setVoiceRecorderError(`R5B 记录会话未建立,录音仍保留: ${message}`);
          });
      }
      Haptics.heavy();
    } catch (err) {
      setRecordingTarget(null);
      noteLiveActiveRef.current = false;
      setNoteLiveActive(false);
      setRecordingError(target, humanizeMobileError(err instanceof Error ? err.message : String(err)));
    }
  };

  // 2026-06-26 — Cancel recording (NJX 反馈: 录音需要取消入口)
  const cancelVoiceRecording = async () => {
    const target = recordingTarget;
    // R10: stop the rolling live-segment loop synchronously before we tear the
    // recorder down, so no in-flight roll restarts the recorder after cancel.
    noteLiveActiveRef.current = false;
    setNoteLiveActive(false);
    try {
      if (recorderState.isRecording) {
        await audioRecorder.stop();
      }
    } catch (e) {
      void e;
    }
    setRecordingTarget(null);
    setVoiceResult(null);
    if (target === "note" || voiceWorkbenchOpen) {
      setVoiceWorkbenchMode("closed");
      setPendingTranscriptionVoiceNoteId(null);
      setAutoOrganizing(false);
      setRecordedAudioUri("");
      setRecordedAudioMime(null);
      setRecordedDurationSeconds(null);
      setMobileRecorderSessionId(null);
      recorderSetSession({ id: null, provider: null, error: null });
      setVoiceRecorderError("");
    }
    Haptics.warn();
  };
  const stopVoiceRecording = async () => {
    const target = recordingTarget || "note";
    setRecordingError(target, "");
    // R10: stop the rolling live-segment loop synchronously. The stop handler
    // now only flushes the FINAL partial segment — it is no longer the first or
    // only upload point, because rolling segments were already uploaded and
    // transcribed during recording.
    if (target === "note") {
      noteLiveActiveRef.current = false;
      setNoteLiveActive(false);
    }
    try {
      await audioRecorder.stop();
      Haptics.success();
      const status = audioRecorder.getStatus();
      const durationSeconds = Math.max(1, Math.round(((status.durationMillis || recorderState.durationMillis) || audioRecorder.currentTime * 1000 || 0) / 1000));
      const uri = audioRecorder.uri || status.url || "";
      const lowerUri = uri.toLowerCase();
      const mime = lowerUri.endsWith(".m4a") ? "audio/m4a"
        : lowerUri.endsWith(".mp3") ? "audio/mpeg"
        : lowerUri.endsWith(".wav") ? "audio/wav"
        : "audio/m4a";
      if (target === "chat") {
        setChatRecordedAudioUri(uri);
        setChatRecordedDurationSeconds(durationSeconds);
      } else {
        setRecordedAudioUri(uri);
        setRecordedAudioMime(mime);
        setRecordedDurationSeconds(durationSeconds);
        setShowVoice(true);
        if (!voiceTitle.trim()) setVoiceTitle(`手机语音记录 ${todayKey()}`);
      }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      setRecordingTarget(null);
      // 2026-07-04 R9: note recording now goes through the R5B recorder session
      // path end-to-end. We DO NOT fall back to the legacy /voice-notes/:id/
      // audio-chunk + transcribeVoiceNote path here — that path produced
      // EXCEED_MAX_PAYLOAD_SIZE on CloudBase relay for 60-90s Mate60 takes
      // and violated the R6 "实时录音" promise. Stop handling is:
      //   1. uploadRecorderAudio()  (chunks <recorderChunkBytes each, see api.ts)
      //   2. listRecorderSegments() — pull server-side transcript (if any)
      //   3. set workbench to "preview", surface "已完成分片上传,等待转写结果"
      //      so the user can manually add text or wait for segments to land.
      if (target === "note" && session && uri) {
        void (async () => {
          let r5SessionId = mobileRecorderSessionId;
          try {
            if (!r5SessionId) {
              const created = await startRecorderSession(
                session,
                {
                  title: voiceTitle.trim() || `手机语音记录 ${todayKey()}`,
                  scene: "mobile_personal_recorder",
                  retentionHours: 24,
                  metadata: { entry: "today_console", stoppedAt: new Date().toISOString() },
                },
                setSession,
              );
              r5SessionId = created.session?.id || null;
              setMobileRecorderSessionId(r5SessionId);
              recorderSetSession({ id: r5SessionId, provider: null, error: null });
            }
            if (!r5SessionId) throw new Error("recorder_session_missing");
            const uploaded = await uploadRecorderAudio(
              session,
              r5SessionId,
              {
                audioUri: uri,
                durationSeconds,
                // R10: send empty transcriptText so the server transcribes the
                // final partial segment itself (same provider as live segments),
                // rather than echoing the accumulated live transcript back and
                // duplicating it in the segment poll.
                transcriptText: "",
                language: "zh-CN",
              },
              setSession,
            );
            recorderReportTotalChunks(uploaded.totalChunks);
            for (let index = 0; index < uploaded.uploadedChunks; index += 1) recorderReportChunk();
            // R18: 录音停止后,本地 ASR 主路径立即对整段录音 transcribe 一次,
            //   保证 voiceTranscript 至少有一条「本地 ASR 已转写」段落(若
            //   rolling loop 已填了若干段,这里负责收尾,避免最后片段沉默)。
            //   转写失败时静默回退到 server polling,不会因此报错打断流程。
            if (isLocalAsrMainPath()) {
              try {
                const result = await transcribeOffline({
                  audioUri: uri,
                  audioMime: mime,
                  durationSeconds,
                  language: "zh-CN",
                });
                if (result.ok && result.segments && result.segments.length > 0) {
                  const engineId = result.engineId;
                  if (engineId === "sherpa-onnx" || engineId === "whisper-rn") {
                    const fullText = String(result.fullTranscript || "").trim();
                    if (fullText) {
                      setVoiceTranscript((current) => {
                        const draft = String(current || "").trim();
                        if (!draft) return fullText;
                        // 若 rolling loop 已经填过这段,这里不再重复
                        if (draft.includes(fullText)) return current;
                        return `${draft}\n\n---\n本地 ASR 整段转写\n${fullText}`;
                      });
                    }
                    for (const seg of result.segments) {
                      const recorded = recordLocalAsrSegment(
                        seg.text,
                        null,
                        null,
                        engineId,
                      );
                      if (recorded) recorderReportLocalAsrSegment();
                    }
                    setVoiceRecorderError("");
                  }
                }
              } catch {
                // 静默,继续走 server polling fallback。
              }
            }
            // 录音停止后只做分片上传 + 拉取 segments;用户确认后才入库。
            // 不再调用 autoTranscribeMutation / transcribeVoiceNote(legacy)。
            try {
              const segResp = await listRecorderSegments(session, r5SessionId, setSession);
              const merged = (segResp.segments || [])
                .map((seg) => String(seg.text || "").trim())
                .filter(Boolean)
                .join("\n");
              if (merged) {
                setVoiceTranscript((current) => {
                  const draft = current.trim();
                  if (!draft) return merged;
                  if (draft.includes(merged)) return current;
                  return `${draft}\n\n---\n远端兜底片段\n${merged}`;
                });
                setVoiceRecorderError((prev) => (prev.startsWith("本地 ASR") ? "" : (prev || "")));
              } else if (isLocalAsrMainPath()) {
                // 本地端已经在 rolling loop 收尾,无需额外提示;
                // 仅在完全没拿到任何文本时才提示用户手动输入。
                const state = getOfflineAsrState();
                if (state.lastTranscript && state.lastTranscript.trim()) {
                  setVoiceRecorderError("");
                }
              } else {
                setVoiceRecorderError("已完成分片上传,等待转写结果;可先在下方手动补充或粘贴转写文本。");
              }
            } catch (segErr) {
              const segMessage = humanizeMobileError(segErr instanceof Error ? segErr.message : String(segErr));
              setVoiceRecorderError(`分片已上传,但转写片段拉取失败: ${segMessage}。可在下方手动补充转写文本。`);
            }
            // 走到 preview,等用户确认入库;保留 confirmVoicePreviewSave 的 R5B
            // finalize 分支,确保确认时走 finalizeRecorderIngest。
            setVoiceWorkbenchMode("preview");
            setVoicePreviewTab("markdown");
            setShowVoice(true);
            setAutoOrganizing(false);
            setPendingTranscriptionVoiceNoteId(null);
          } catch (err) {
            const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
            recorderSetSession({ id: r5SessionId, provider: null, error: message });
            setVoiceRecorderError(`R5B 录音分片上传失败: ${message}。请检查 CloudBase 公网中继后重试,或直接在下方手动输入转写文本。`);
            setVoiceWorkbenchMode("preview");
            setVoicePreviewTab("markdown");
            setShowVoice(true);
            setAutoOrganizing(false);
            setPendingTranscriptionVoiceNoteId(null);
          }
        })();
      } else if (target === "note") {
        // 录音停止后只做转写和预览;用户确认后才入库。
        setVoiceWorkbenchMode("preview");
        setVoicePreviewTab("markdown");
        setAutoOrganizing(false);
        setPendingTranscriptionVoiceNoteId(null);
        if (!voiceTranscript.trim() && !session) {
          setVoiceRecorderError("本地 ASR 引擎未注册。录音已保存,请在转写区输入或粘贴文字后确认入库。");
        }
      }
    } catch (err) {
      setRecordingTarget(null);
      setRecordingError(target, humanizeMobileError(err instanceof Error ? err.message : String(err)));
    }
  };

  // 2026-07-06 — R19 emulator QA action.
  //
  // Hidden in production: gated by extra.r19QaAudioAction === true in
  // app.json. When the user taps the corresponding debug button in the
  // voice workbench header, this function:
  //   1. Reads the bundled sherpa-onnx test_wavs/0.wav from filesDir.
  //   2. Calls transcribeOffline() — the SAME engine entry point that the
  //      rolling 12s segments in rollLiveSegment() use.
  //   3. On success, pushes the result via recordLocalAsrSegment() (same
  //      R18 path), updates voiceTranscript with the same merge policy the
  //      rolling path uses, and bumps localSegmentsCount via
  //      recorderReportLocalAsrSegment().
  //
  // The transcript text then renders in the same `mobile-voice-workbench-
  // transcript` textarea where real microphone-driven ASR would appear,
  // proving the entire UI pipeline works end-to-end on the emulator
  // without requiring host audio injection.
  const runR19QaAudioTranscribe = useCallback(async () => {
    if (!R19_QA_AUDIO_FLAG) {
      console.warn("[R19 QA] runR19QaAudioTranscribe blocked: flag disabled");
      return;
    }
    try {
      const Files = (await import("expo-file-system")) as typeof import("expo-file-system");
      const baseUri = String(Files.Paths?.document?.uri || "");
      if (!baseUri) {
        console.warn("[R19 QA] expo-file-system Paths.document.uri missing");
        return;
      }
      const wavUri = `${baseUri}models/${R19_BUNDLED_MODEL_DIR}/test_wavs/${R19_QA_TEST_WAV}`;
      // R19: 8k.wav is a clean 16-bit mono 8 kHz PCM WAV with no LIST chunk.
      // 0.wav from the bundled zipformer corpus contains a LIST/INFO chunk
      // (Lavf57.8.100) between fmt and data which sherpa-onnx's WaveReader
      // does not skip, leaving only ~561 samples readable for the recognizer
      // (the model expects >= 77 frames and fails with
      // "Got invalid dimensions for input x: Got: 561 Expected: 77"). 8k.wav
      // is the simplest bundled audio that streams cleanly through
      // transcribeFile().
      const wavUriNo8k = wavUri.replace(/\/0\.wav$/, "/8k.wav");
      // R19: Android's sherpa-onnx transcribeFile uses java.io.File(path), which
      // does NOT understand the "file:///" URI prefix — passing the raw URI
      // reports the file as size=0 / non-existent. Strip the scheme so the
      // recognizer sees a plain filesystem path it can stat.
      const wavPathForSherpa = wavUriNo8k.startsWith("file://")
        ? wavUriNo8k.slice("file://".length)
        : wavUriNo8k;
      console.log("[R19 QA] transcribing bundled test wav:", wavPathForSherpa);
          const result = await transcribeOffline({
            audioUri: wavPathForSherpa,
            audioMime: "audio/wav",
            durationSeconds: 8,
            language: "zh-CN",
          });
          console.log(
            `[R19 QA] transcribeOffline ok=${result.ok} engine=${result.engineId} segments=${result.ok ? result.segments.length : 0}`,
          );
      if (!result.ok || !result.segments || result.segments.length === 0) {
        console.warn("[R19 QA] no segments returned:", result.ok ? "" : result.reason, result.ok ? "" : result.message);
        return;
      }
      const engineId = result.engineId;
      if (engineId !== "sherpa-onnx" && engineId !== "whisper-rn") {
        console.warn("[R19 QA] wrong engineId:", engineId);
        return;
      }
      let firstNewSegment: string | null = null;
      for (const seg of result.segments) {
        const recorded = recordLocalAsrSegment(seg.text, 0, 8, engineId);
        if (!recorded) continue;
        recorderReportLocalAsrSegment();
        if (firstNewSegment === null) firstNewSegment = seg.text;
      }
      if (firstNewSegment) {
        setVoiceTranscript((current) => {
          const draft = String(current || "").trim();
          if (!draft) return firstNewSegment;
          if (draft.includes(firstNewSegment)) return current;
          return `${draft}\n\n---\n本地 ASR 片段\n${firstNewSegment}`;
        });
        Haptics.success();
      }
    } catch (err) {
      console.warn("[R19 QA] failed:", err instanceof Error ? err.message : String(err));
      Haptics.error();
    }
  }, [recorderReportLocalAsrSegment]);

  const pairMutation = useMutation({
    mutationFn: () => claimPairing(serverUrl, pairingCode),
    onSuccess: (next) => {
      Haptics.success();
      setSession(next);
      setPairingError("");
      setPairingCode("");
      void queryClient.invalidateQueries({ queryKey: ["mobile-bootstrap"] });
      void queryClient.invalidateQueries({ queryKey: ["mobile-today"] });
    },
    onError: (err) => {
      Haptics.error();
      setPairingError(humanizeMobileError(err instanceof Error ? err.message : String(err)));
    },
  });
  // R17: 把 pairMutation.mutate 暴露给 R17 QR 扫描 helper。
  // handleScannedPayload 必须在 pairMutation 之后才能引用它,所以用 ref
  // 把 mutate 函数暴露出去。
  useEffect(() => {
    pairMutationRef.current = { mutate: () => pairMutation.mutate() };
    return () => {
      pairMutationRef.current = null;
    };
  }, [pairMutation]);
  const pairButtonDisabled = pairMutation.isPending || !serverLooksReady || pairingCode.length !== 6;
  const pairButtonLabel = pairMutation.isPending
    ? "正在连接 Mac"
    : !serverLooksReady
      ? "先填 Mac 地址"
      : pairingCode.length !== 6
        ? "输入 6 位码"
        : "连接并进入记录";

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error(humanizeMobileError("not_paired"));
      if (offlineReadOnly) throw new Error(humanizeMobileError("offline_read_only"));
      const content = chatInput.trim();
      if (!content) throw new Error(humanizeMobileError("empty_message"));
      const activeSession = chatSessionId
        ? { id: chatSessionId }
        : await createChatSession(session, selectedAgent, setSession);
      setChatSessionId(activeSession.id);
      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        session_id: activeSession.id,
        role: "user",
        content,
        status: "sent",
        created_at: new Date().toISOString(),
      };
      setChatMessages((rows) => [...rows, optimistic]);
      setChatInput("");
      return sendChatMessage(session, { sessionId: activeSession.id, agentId: selectedAgent, message: content }, setSession);
    },
    onSuccess: (data) => {
      Haptics.success();
      if (data.assistant) setChatMessages((rows) => [...rows, data.assistant as ChatMessage]);
      void queryClient.invalidateQueries({ queryKey: ["mobile-today"] });
    },
    onError: (err) => {
      Haptics.error();
      const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
      setChatMessages((rows) => [
        ...rows,
        {
          id: `error-${Date.now()}`,
          session_id: chatSessionId || "local",
          role: "assistant",
          content: `发送失败：${message}`,
          status: "gateway_unavailable",
          created_at: new Date().toISOString(),
        },
      ]);
    },
  });

  const approvalMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      if (!session) throw new Error(humanizeMobileError("not_paired"));
      if (offlineReadOnly) throw new Error(humanizeMobileError("offline_read_only"));
      return resolveApproval(session, id, decision, setSession);
    },
    onSuccess: () => {
      Haptics.success();
      void queryClient.invalidateQueries({ queryKey: ["mobile-today"] });
      void queryClient.invalidateQueries({ queryKey: ["mobile-bootstrap"] });
    },
    onError: () => Haptics.error(),
  });

  // 快速文本笔记保存:有 session 时直传,无 session 或失败时降级到 pending 队列
  // 防重复保存:同一 in-flight id 不会被并发触发;成功后切换为「继续添加」状态,composer 自动清空。
  const saveQuickNote = useCallback(async () => {
    setQuickSaveError("");
    setQuickSavedResult(null);
    const title = quickTitle.trim() || "手机速记";
    const body = quickBody.trim();
    if (!body) {
      setQuickSaveError("请先写一点内容");
      return;
    }
    if (quickSavePending) {
      // 同一笔正在保存中:忽略,避免重复 POST
      return;
    }
    setQuickSavePending(true);
    const inFlightId = makeLocalNoteId();
    setQuickInFlightId(inFlightId);
    const note = buildPendingNote({
      title,
      body,
      transcript: "",
      audioUri: "",
      audioMime: null,
      durationSeconds: null,
      source: "text",
    });
    note.id = inFlightId;
    try {
      if (!session) {
        note.status = "pending";
        note.lastError = "未配对,先在设备 tab 完成 6 位配对码登录,或继续保存在本机待同步";
        await savePendingNote(note);
        setPendingNotes((rows) => [note, ...rows]);
        setQuickTitle("");
        setQuickBody("");
        Haptics.warn();
        return;
      }
      note.status = "syncing";
      await savePendingNote(note);
      setPendingNotes((rows) => [note, ...rows]);
      try {
        // 2026-06-24 — P0-B: single-shot add-note returns both Markdown + HTML paths
        // and dedupes by (device_id, source_hash) so duplicate clicks of the
        // primary action cannot create a second note.
        const result = await addKnowledgeNote(
          session,
          {
            title,
            body,
            transcriptText: body,
            source: "manual_transcript",
            language: "zh-CN",
            durationSeconds: null,
          },
          setSession,
        );
        await removePendingNote(note.id);
        setPendingNotes((rows) => rows.filter((row) => row.id !== note.id));
        // 成功路径:把 Markdown + HTML 路径 + 已保存事实暴露给 UI
        const saved = {
          ok: true as const,
          voiceNote: result.voiceNote,
          knowledgeEntry: {} as Record<string, unknown>,
          calendarNote: {} as Record<string, unknown>,
          markdownPath: result.markdownPath || "",
          htmlPath: result.htmlPath || "",
        } as MobileVoiceNoteOrganizeResponse;
        setQuickSavedResult(saved);
        setVoiceResult(saved);
        setQuickTitle("");
        setQuickBody("");
        Haptics.success();
        void queryClient.invalidateQueries({ queryKey: ["mobile-voice-notes"] });
        void queryClient.invalidateQueries({ queryKey: ["mobile-today"] });
      } catch (err) {
        const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
        await updatePendingNoteStatus(note.id, "failed", { lastError: message, retryCount: note.retryCount + 1 });
        setPendingNotes((rows) => rows.map((row) => row.id === note.id ? { ...row, status: "failed", lastError: message, retryCount: row.retryCount + 1, updatedAt: new Date().toISOString() } : row));
        setQuickSaveError(`未保存成功,已暂存: ${message}`);
        Haptics.error();
      }
    } finally {
      setQuickSavePending(false);
      setQuickInFlightId(null);
    }
  }, [quickTitle, quickBody, quickSavePending, session, queryClient]);

  // 2026-07-01 — Voice workbench:停止后只自动转写,不自动入库;用户确认预览后再保存。
  const autoTranscribeMutation = useMutation({
    mutationFn: async (params: { audioUri: string; mime: string; durationSeconds: number; title: string }) => {
      if (!session) throw new Error("未配对");
      const created = await createVoiceNote(
        session,
        {
          date: todayKey(),
          title: params.title,
          transcriptText: "",
          source: "audio_upload",
          language: "zh-CN",
          durationSeconds: params.durationSeconds,
        },
        setSession,
      );
      const transcribed = await transcribeVoiceNote(
        session,
        created.voiceNote.id,
        { audioUri: params.audioUri, durationSeconds: params.durationSeconds, language: "zh-CN", async: true },
        setSession,
      );
      return transcribed;
    },
    onSuccess: (result) => {
      Haptics.tick();
      setPendingTranscriptionVoiceNoteId(result.voiceNote.id);
      setAutoOrganizing(true);
      setShowVoice(true);
      setVoiceRecorderError("");
      setVoiceWorkbenchMode("transcribing");
      setVoicePreviewTab("markdown");
      void queryClient.invalidateQueries({ queryKey: ["mobile-voice-notes"] });
    },
    onError: (err) => {
      setAutoOrganizing(false);
      setPendingTranscriptionVoiceNoteId(null);
      setShowVoice(true);
      setVoiceWorkbenchMode("preview");
      const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
      setRecordingError("note", message);
      setVoiceRecorderError(message);
    },
  });

  // 2. Hook into stopVoiceRecording: when target is "note" and has audio, auto-organize
  // Find the part where recorded audio is set


  const retryPendingNote = useCallback(async (note: MobilePendingNote) => {
    if (!session) {
      await updatePendingNoteStatus(note.id, "pending", { lastError: "未配对,请先在设备 tab 完成 6 位配对码登录" });
      setPendingNotes((rows) => rows.map((row) => row.id === note.id ? { ...row, status: "pending", lastError: "未配对,请先在设备 tab 完成 6 位配对码登录", updatedAt: new Date().toISOString() } : row));
      return;
    }
    setSyncingIds((rows) => [...rows, note.id]);
    try {
      await updatePendingNoteStatus(note.id, "syncing", { lastError: "" });
      setPendingNotes((rows) => rows.map((row) => row.id === note.id ? { ...row, status: "syncing", lastError: "", updatedAt: new Date().toISOString() } : row));
      const content = note.body || note.transcript;
      if (!content) {
        await updatePendingNoteStatus(note.id, "failed", { lastError: "笔记内容为空,无法同步" });
        setPendingNotes((rows) => rows.map((row) => row.id === note.id ? { ...row, status: "failed", lastError: "笔记内容为空,无法同步", updatedAt: new Date().toISOString() } : row));
        return;
      }
      const result = note.source === "text"
        ? await addKnowledgeNote(
            session,
            {
              title: note.title || "手机速记",
              body: content,
              transcriptText: content,
              source: "manual_transcript",
              language: "zh-CN",
              durationSeconds: null,
            },
            setSession,
          )
        : await (async () => {
            const created = await createVoiceNote(
              session,
              {
                date: todayKey(),
                title: note.title || "手机速记",
                transcriptText: content,
                source: "speech_recognition",
                language: "zh-CN",
                durationSeconds: note.durationSeconds,
              },
              setSession,
            );
            return organizeVoiceNote(session, created.voiceNote.id, setSession);
          })();
      await removePendingNote(note.id);
      setPendingNotes((rows) => rows.filter((row) => row.id !== note.id));
      setVoiceResult(
        note.source === "text"
          ? ({
              ok: true as const,
              voiceNote: result.voiceNote,
              knowledgeEntry: {} as Record<string, unknown>,
              calendarNote: {} as Record<string, unknown>,
              markdownPath: "markdownPath" in result ? result.markdownPath || "" : "",
              htmlPath: "htmlPath" in result ? result.htmlPath || "" : "",
            } as MobileVoiceNoteOrganizeResponse)
          : (result as MobileVoiceNoteOrganizeResponse),
      );
      Haptics.success();
      void queryClient.invalidateQueries({ queryKey: ["mobile-voice-notes"] });
      void queryClient.invalidateQueries({ queryKey: ["mobile-today"] });
    } catch (err) {
      const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
      await updatePendingNoteStatus(note.id, "failed", { lastError: message, retryCount: note.retryCount + 1 });
      setPendingNotes((rows) => rows.map((row) => row.id === note.id ? { ...row, status: "failed", lastError: message, retryCount: row.retryCount + 1, updatedAt: new Date().toISOString() } : row));
      Haptics.error();
    } finally {
      setSyncingIds((rows) => rows.filter((id) => id !== note.id));
    }
  }, [session, queryClient]);

  const discardPendingNote = useCallback(async (note: MobilePendingNote) => {
    await removePendingNote(note.id);
    setPendingNotes((rows) => rows.filter((row) => row.id !== note.id));
    Haptics.light();
  }, []);

  // 连接恢复后自动回放待同步笔记。否则用户会在 Mac 已恢复时仍看到
  // "网关异常 · 待同步",误以为手机端不可用。
  useEffect(() => {
    if (!session || offlineReadOnly || pendingNotes.length === 0) return;
    if (!bootstrapQuery.isSuccess && !todayQuery.isSuccess) return;
    const retryable = pendingNotes.filter((note) => {
      if (syncingIds.includes(note.id)) return false;
      if (note.status === "syncing") return false;
      return note.status === "pending" || note.retryCount < 3;
    });
    if (!retryable.length) return;
    let cancelled = false;
    (async () => {
      for (const note of retryable.slice(0, 3)) {
        if (cancelled) return;
        await retryPendingNote(note);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    session,
    offlineReadOnly,
    pendingNotes,
    syncingIds,
    retryPendingNote,
    bootstrapQuery.isSuccess,
    todayQuery.isSuccess,
  ]);

  // 语音笔记保存:失败时降级到 pending 队列(录音 + 转写文本保留)
  const persistVoiceOrQueue = useCallback(async () => {
    const title = voiceTitle.trim() || `手机语音记录 ${todayKey()}`;
    const transcript = voiceTranscript.trim();
    if (!session) {
      const note = buildPendingNote({
        title,
        body: transcript,
        transcript,
        audioUri: recordedAudioUri,
        audioMime: recordedAudioMime,
        durationSeconds: activeVoiceDurationSeconds,
        source: recordedAudioUri && transcript ? "voice_text" : "voice",
      });
      await savePendingNote(note);
      setPendingNotes((rows) => [note, ...rows]);
      Haptics.warn();
      setVoiceResult(null);
      setVoiceTitle("");
      setVoiceTranscript("");
      setRecordedAudioUri("");
      setRecordedAudioMime(null);
      setRecordedDurationSeconds(null);
      return;
    }
    try {
      let transcriptText = transcript;
      if (!transcriptText && !recordedAudioUri) {
        throw new Error(humanizeMobileError("transcript_required"));
      }
      const created = await createVoiceNote(
        session,
        {
          date: todayKey(),
          title,
          transcriptText,
          source: transcriptText ? hasRecordedAudio ? "speech_recognition" : "manual_transcript" : "audio_upload",
          language: "zh-CN",
          durationSeconds: activeVoiceDurationSeconds,
        },
        setSession,
      );
      if (!transcriptText && recordedAudioUri) {
        const transcribed = await transcribeVoiceNote(
          session,
          created.voiceNote.id,
          {
            audioUri: recordedAudioUri,
            durationSeconds: activeVoiceDurationSeconds,
            language: "zh-CN",
          },
          setSession,
        );
        transcriptText = String(transcribed.transcriptText || "").trim();
        setVoiceTranscript(transcriptText);
      }
      const result = await organizeVoiceNote(session, created.voiceNote.id, setSession);
      Haptics.success();
      setVoiceResult(result);
      setVoiceTitle("");
      setVoiceTranscript("");
      setVoiceRecorderError("");
      setRecordedAudioUri("");
      setRecordedAudioMime(null);
      setRecordedDurationSeconds(null);
      void queryClient.invalidateQueries({ queryKey: ["mobile-voice-notes"] });
      void queryClient.invalidateQueries({ queryKey: ["mobile-today"] });
    } catch (err) {
      const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
      const note = buildPendingNote({
        title,
        body: transcript,
        transcript,
        audioUri: recordedAudioUri,
        audioMime: recordedAudioMime,
        durationSeconds: activeVoiceDurationSeconds,
        source: recordedAudioUri && transcript ? "voice_text" : "voice",
      });
      note.status = "failed";
      note.lastError = message;
      await savePendingNote(note);
      setPendingNotes((rows) => [note, ...rows]);
      setShowVoice(true);
      setVoiceRecorderError(`未保存成功,已暂存: ${message}`);
      Haptics.error();
    }
  }, [voiceTitle, voiceTranscript, recordedAudioUri, recordedAudioMime, activeVoiceDurationSeconds, session, hasRecordedAudio, autoTranscriptionReady, queryClient]);

  const chatVoiceMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error(humanizeMobileError("not_paired"));
      if (offlineReadOnly) throw new Error(humanizeMobileError("offline_read_only"));
      if (!chatRecordedAudioUri) throw new Error(humanizeMobileError("audio_required"));
      if (!autoTranscriptionReady) throw new Error(humanizeMobileError("transcription_provider_unavailable"));
      const created = await createVoiceNote(
        session,
        {
          date: todayKey(),
          title: `手机语音对话 ${todayKey()}`,
          transcriptText: "",
          source: "audio_upload",
          language: "zh-CN",
          durationSeconds: activeChatVoiceDurationSeconds,
        },
        setSession,
      );
      const transcribed = await transcribeVoiceNote(
        session,
        created.voiceNote.id,
        {
          audioUri: chatRecordedAudioUri,
          durationSeconds: activeChatVoiceDurationSeconds,
          language: "zh-CN",
        },
        setSession,
      );
      return transcribed;
    },
    onSuccess: (result) => {
      Haptics.success();
      const transcript = String(result.transcriptText || "").trim();
      if (transcript) setChatInput((current) => (current.trim() ? `${current.trim()}\n${transcript}` : transcript));
      setChatVoiceError("");
      setChatRecordedAudioUri("");
      setChatRecordedDurationSeconds(null);
      void queryClient.invalidateQueries({ queryKey: ["mobile-voice-notes"] });
    },
    onError: (err) => {
      Haptics.error();
      setChatVoiceError(humanizeMobileError(err instanceof Error ? err.message : String(err)));
    },
  });
  const voiceSaveDisabled = recorderState.isRecording || (!hasVoiceTranscript && !canAutoTranscribe);
  const voiceSaveLabel = !hasVoiceTranscript && recordedAudioUri
    ? autoTranscriptionReady ? "转文字并保存" : "用转写文本保存"
    : "添加笔记";
  // 录音后必须把「转写内容 / 手动补录」留在首屏可见区,不能只藏在执行台里。
  const voiceManualFallbackActive = Boolean(noteRecordingActive || hasRecordedAudio || hasVoiceTranscript || voiceRecorderError);
  const chatVoiceDisabled = offlineReadOnly || chatVoiceMutation.isPending || recorderState.isRecording || !canTranscribeChatVoice;
  const chatVoiceLabel = offlineReadOnly
    ? "离线只读"
    : chatVoiceMutation.isPending
      ? "转写中"
      : !hasChatRecordedAudio
        ? "先录音"
        : autoTranscriptionReady
          ? "转写到输入框"
          : "需要手动输入";

  const renderVoiceManualFallback = (compact = false, force = false) => {
    if (!force && !voiceManualFallbackActive) return null;
    const meta = noteRecordingActive
      ? `${formatDuration(activeVoiceDurationSeconds || 0)} · ${autoTranscriptionLabel}`
      : hasVoiceTranscript
      ? "转写内容可编辑"
      : offlineAsrReady
        ? "本地 ASR 未出文本,可手动输入或稍候"
        : offlineAsrMacFallback
          ? "远端兜底未返回片段,可手动输入或稍候"
          : appRecorderState.offlineAsr.status === "missing"
            ? "本地 ASR 模型未安装"
            : appRecorderState.offlineAsr.status === "loading"
              ? "本地 ASR 模型加载中"
              : appRecorderState.offlineAsr.status === "failed"
                ? `本地 ASR 失败: ${appRecorderState.offlineAsr.lastError || "未知原因"}`
                : autoTranscriptionReady
                  ? "自动转写失败"
                  : "本地 ASR 尚未就绪";
    return (
      <View style={compact ? styles.panelCompact : styles.panel} testID="mobile-voice-manual-fallback">
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>实时转写 / 手动草稿</Text>
          <Text style={styles.panelMeta}>{meta}</Text>
        </View>
        <Text style={[styles.body, { color: Color.inkFaint, marginBottom: Space.sm }]}>
          {noteRecordingActive
            ? "正在录音。这里固定显示草稿面板;可边录边输入要点,停止后本地 ASR 自动转写填入。"
            : hasVoiceTranscript
            ? "下面是当前转写内容,可直接修改后保存为 Markdown + HTML。"
            : offlineAsrReady
              ? "本地 ASR 引擎已就绪,但本次未产出文本。可手动输入或粘贴已有转写文本后保存。"
              : offlineAsrMacFallback
                ? "本地引擎未安装,目前依赖远端工作台轮询 segments。可手动输入或粘贴转写文本保存。"
                : appRecorderState.offlineAsr.status === "missing"
                  ? "本地 ASR 引擎未安装(待 native rebuild 后会自动启用)。可手动输入或粘贴转写文本保存。"
                  : appRecorderState.offlineAsr.status === "loading"
                    ? "本地 ASR 模型加载中。可手动输入或粘贴转写文本保存。"
                    : appRecorderState.offlineAsr.status === "failed"
                      ? `本地 ASR 转写失败: ${appRecorderState.offlineAsr.lastError || "未知原因"}。可手动输入或粘贴转写文本保存。`
                      : "本地 ASR 尚未就绪。录音已保留,可手动输入或粘贴转写文本保存。"}
        </Text>
        <TextInput
          value={voiceTranscript}
          onChangeText={setVoiceTranscript}
          placeholder="录音时可同步输入实时草稿;也可停止后查看/粘贴转写文本"
          placeholderTextColor={Color.inkDisabled}
          multiline
          style={styles.transcriptInput}
          testID="mobile-voice-manual-transcript"
        />
        <Button
          label={hasVoiceTranscript ? "保存为 Markdown + HTML" : "先输入转写文本"}
          tone="primary"
          size="sm"
          onPress={async () => {
            if (!session || !hasVoiceTranscript) return;
            try {
              const result = await addKnowledgeNote(
                session,
                {
                  title: voiceTitle.trim() || `手机语音转写 ${todayKey()}`,
                  body: voiceTranscript.trim(),
                  transcriptText: voiceTranscript.trim(),
                  source: "manual_transcript",
                  language: "zh-CN",
                  durationSeconds: activeVoiceDurationSeconds,
                },
                setSession,
              );
              Haptics.success();
              setVoiceResult({
                ok: true as const,
                voiceNote: result.voiceNote,
                knowledgeEntry: {} as Record<string, unknown>,
                calendarNote: {} as Record<string, unknown>,
                markdownPath: result.markdownPath || "",
                htmlPath: result.htmlPath || "",
              } as MobileVoiceNoteOrganizeResponse);
              setVoiceTitle("");
              setVoiceTranscript("");
              setVoiceRecorderError("");
              setRecordedAudioUri("");
              setRecordedAudioMime(null);
              setRecordedDurationSeconds(null);
              void queryClient.invalidateQueries({ queryKey: ["mobile-voice-notes"] });
              void queryClient.invalidateQueries({ queryKey: ["mobile-today"] });
            } catch (err) {
              Haptics.error();
              setVoiceRecorderError(humanizeMobileError(err instanceof Error ? err.message : String(err)));
            }
          }}
          disabled={noteRecordingActive || !hasVoiceTranscript}
          testID="mobile-voice-manual-save"
        />
      </View>
    );
  };

  const confirmVoicePreviewSave = async () => {
    if (!session || voiceWorkbenchMode === "saving") return;
    const transcript = voiceTranscript.trim();
    if (!transcript) {
      setVoiceRecorderError("请先确认转写文本,或在草稿区手动输入内容。");
      Haptics.warn();
      return;
    }
    setVoiceWorkbenchMode("saving");
    setVoiceRecorderError("");
    Haptics.tick();
    try {
      let saved: MobileVoiceNoteOrganizeResponse;
      if (mobileRecorderSessionId) {
        const result = await finalizeRecorderIngest(
          session,
          mobileRecorderSessionId,
          {
            title: voicePreviewTitle,
            transcriptText: transcript,
            source: recordedAudioUri ? "speech_recognition" : "manual_transcript",
            language: "zh-CN",
            durationSeconds: activeVoiceDurationSeconds,
            target: "all",
          },
          setSession,
        );
        if (!result.voiceNote) {
          throw new Error("recorder_ingest_missing_voice_note");
        }
        saved = {
          ok: true as const,
          voiceNote: result.voiceNote,
          knowledgeEntry: {
            id: result.knowledgeEntryId || result.job.knowledgeEntryId || "",
          },
          calendarNote: {
            id: result.calendarNoteId || result.job.calendarNoteId || "",
          },
          markdownPath: result.markdownPath || result.job.markdownPath || "",
          htmlPath: result.htmlPath || result.job.htmlPath || "",
        } as MobileVoiceNoteOrganizeResponse;
      } else {
        const result = await addKnowledgeNote(
          session,
          {
            title: voicePreviewTitle,
            body: transcript,
            transcriptText: transcript,
            source: recordedAudioUri ? "speech_recognition" : "manual_transcript",
            language: "zh-CN",
            durationSeconds: activeVoiceDurationSeconds,
          },
          setSession,
        );
        saved = {
          ok: true as const,
          voiceNote: result.voiceNote,
          knowledgeEntry: {} as Record<string, unknown>,
          calendarNote: {} as Record<string, unknown>,
          markdownPath: result.markdownPath || "",
          htmlPath: result.htmlPath || "",
        } as MobileVoiceNoteOrganizeResponse;
      }
      setVoiceResult(saved);
      setVoiceWorkbenchMode("saved");
      setPendingTranscriptionVoiceNoteId(null);
      setAutoOrganizing(false);
      setMobileRecorderSessionId(null);
      setRecordedAudioUri("");
      setRecordedAudioMime(null);
      setRecordedDurationSeconds(null);
      Haptics.success();
      void queryClient.invalidateQueries({ queryKey: ["mobile-voice-notes"] });
      void queryClient.invalidateQueries({ queryKey: ["mobile-today"] });
      void queryClient.invalidateQueries({ queryKey: ["mobile-knowledge-atlas"] });
    } catch (err) {
      setVoiceWorkbenchMode("preview");
      setVoiceRecorderError(humanizeMobileError(err instanceof Error ? err.message : String(err)));
      Haptics.error();
    }
  };

  const closeVoiceWorkbench = () => {
    setVoiceWorkbenchMode("closed");
    setPendingTranscriptionVoiceNoteId(null);
    setAutoOrganizing(false);
    setMobileRecorderSessionId(null);
    setVoiceTitle("");
    setVoiceTranscript("");
    setVoiceRecorderError("");
    setRecordedAudioUri("");
    setRecordedAudioMime(null);
    setRecordedDurationSeconds(null);
    setAutoOrganizing(false);
    setVoiceRecoveryDismissed(false);
    setVoiceWorkbenchStaleSince(null);
    void clearAllRecorderLocalState();
  };

  // 2026-07-03 — R7: refresh is hoisted so retryVoiceWorkbenchSync below can
  // include it in its dep array without tripping TDZ / "used before
  // declaration" errors.
  const refresh = useCallback(() => {
    void bootstrapQuery.refetch();
    void todayQuery.refetch();
    void voiceQuery.refetch();
    void atlasQuery.refetch();
    void loadLastSyncTimestamp().then(setLastSyncAt);
  }, [bootstrapQuery, todayQuery, voiceQuery, atlasQuery]);

  // 2026-07-03 — R7: discard-stale action. Used both by the recovery banner
  // inside the workbench and the boot-time stale banner on the home page.
  // Resets every per-device recorder artifact without touching server-owned
  // mobile_recording_sessions (the user's prior session is left exactly as
  // it was on Mac; mobile just stops pinning the UI to it).
  const discardStaleVoiceWorkbench = useCallback(async () => {
    if (recorderState.isRecording) {
      try { await audioRecorder.stop(); } catch { /* ignore */ }
    }
    setRecordingTarget(null);
    setVoiceResult(null);
    setVoiceWorkbenchMode("closed");
    setPendingTranscriptionVoiceNoteId(null);
    setAutoOrganizing(false);
    setMobileRecorderSessionId(null);
    setVoiceTitle("");
    setVoiceTranscript("");
    setVoiceRecorderError("");
    setRecordedAudioUri("");
    setRecordedAudioMime(null);
    setRecordedDurationSeconds(null);
    setShowVoice(false);
    setVoiceRecoveryDismissed(false);
    setVoiceWorkbenchStaleSince(null);
    try { await audioRecorder.stop(); } catch { /* ignore */ }
    await clearAllRecorderLocalState();
    try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch { /* ignore */ }
    Haptics.warn();
  }, [recorderState.isRecording, audioRecorder]);

  // 2026-07-03 — R7: recover an in-flight recorder session without
  // forcing a fresh recording. Re-opens the workbench from "minimized"
  // (or boot) back to the right mode based on whether we have audio,
  // transcript, or both. Refuses to start a fresh recorder if one was
  // already running (preserving the in-flight chunks/segments).
  const reopenVoiceWorkbench = useCallback(() => {
    setVoiceRecoveryDismissed(false);
    setVoiceWorkbenchStaleSince(null);
    const nextMode: VoiceWorkbenchMode =
      noteRecordingActive ? "recording"
        : autoOrganizing || pendingTranscriptionVoiceNoteId ? "transcribing"
        : voiceWorkbenchMode === "saving" ? "saving"
        : voiceWorkbenchMode === "saved" ? "saved"
        : recordedAudioUri || voiceTranscript.trim() ? "preview"
        : "recording";
    setVoiceWorkbenchMode(nextMode);
    setShowVoice(true);
    Haptics.tick();
  }, [
    noteRecordingActive,
    autoOrganizing,
    pendingTranscriptionVoiceNoteId,
    voiceWorkbenchMode,
    recordedAudioUri,
    voiceTranscript,
  ]);

  // 2026-07-03 — R7: retry the last network slice. Re-runs the
  // auto-transcription (when nothing is pending) or re-issues finalize.
  // Safe to call repeatedly; treated as a single retry tick.
  //
  // 2026-07-04 R9: for the note recording flow we no longer fall back to
  // autoTranscribeMutation (legacy /voice-notes/:id/audio-chunk path that
  // 413'd on CloudBase relay). Retry now re-polls the R5B recorder session
  // segments; if the server still hasn't produced text, surface a clear
  // manual-fallback message instead of pretending the legacy path works.
  const retryVoiceWorkbenchSync = useCallback(async () => {
    if (!session) {
      setVoiceRecorderError("未配对 Mac 工作台,请先在设备 tab 完成 6 位配对码登录,再重试同步。");
      Haptics.error();
      return;
    }
    Haptics.tick();
    if (
      voiceWorkbenchMode === "preview" &&
      !voiceTranscript.trim() &&
      !pendingTranscriptionVoiceNoteId
    ) {
      if (mobileRecorderSessionId) {
        try {
          setVoiceRecorderError("");
          const segResp = await listRecorderSegments(session, mobileRecorderSessionId, setSession);
          const merged = (segResp.segments || [])
            .map((seg) => String(seg.text || "").trim())
            .filter(Boolean)
            .join("\n");
          if (merged) {
            setVoiceTranscript(merged);
            setVoiceRecorderError("");
            return;
          }
          setVoiceRecorderError(offlineAsrReady
            ? "本地 ASR 尚未产出转写片段;可稍后再次重试,或在下方手动输入转写文本。"
            : offlineAsrMacFallback
              ? "远端兜底未返回转写片段;可稍后再次重试,或在下方手动输入转写文本。"
              : `本地 ASR 引擎未就绪 (${appRecorderState.offlineAsr.describe})。可手动输入或粘贴转写文本。`);
          return;
        } catch (err) {
          const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
          setVoiceRecorderError(`转写片段拉取失败: ${message}。请保持网络后再次重试。`);
          return;
        }
      }
      // 没有 R5B session id(本地录音,从未成功创建会话):直接走手动草稿路径。
      setVoiceRecorderError("未找到 R5B 录音会话,请先在下方手动输入转写文本,或重新录音。");
      return;
    }
    if (voiceWorkbenchMode === "preview" && voiceTranscript.trim()) {
      void confirmVoicePreviewSave();
      return;
    }
    if (voiceWorkbenchMode === "transcribing" && pendingTranscriptionVoiceNoteId) {
      void queryClient.invalidateQueries({ queryKey: ["mobile-voice-notes"] });
      return;
    }
    if (voiceWorkbenchMode === "saved") {
      // Already saved — nothing to retry. Surface the success banner is already there.
      return;
    }
    // Default fallback: refresh home queries so any server-side change is picked up.
    refresh();
  }, [
    session,
    voiceWorkbenchMode,
    voiceTranscript,
    recordedAudioUri,
    pendingTranscriptionVoiceNoteId,
    recordedAudioMime,
    recordedDurationSeconds,
    voiceTitle,
    mobileRecorderSessionId,
    autoTranscribeMutation,
    confirmVoicePreviewSave,
    queryClient,
    refresh,
  ]);

  useEffect(() => {
    if (!session) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh, session]);

  if (loadingSession) {
    return (
      <ScreenShell>
        <View style={styles.center}>
          <ActivityIndicator color="#0f766e" />
          <Text style={styles.muted}>正在读取本机设备令牌</Text>
        </View>
      </ScreenShell>
    );
  }

  if (!session) {
    return (
      <ScreenShell>
        <ScrollView contentContainerStyle={styles.pairing} keyboardShouldPersistTaps="handled">
          <View style={styles.productStamp}>
            <Text style={styles.productStampText}>安装成功 · {experienceVersion}</Text>
            <Text style={styles.productStampMeta}>如果仍看到英文或 Expo 诊断页，说明手机没有拿到这版更新，需要重新打开 App 或发布 OTA。</Text>
          </View>

          <View style={styles.pairingHero}>
            <View style={styles.heroBrandRow}>
              <BrandGlyph size={48} />
              <Text style={styles.kicker}>OpenClaw 随身分身</Text>
            </View>
            <Text style={styles.title}>连接 Mac，马上记今天</Text>
            <Text style={styles.body}>手动输入地址和 6 位码即可继续；扫码打不开也不影响配对。也可不连，先把笔记存在本机待同步。</Text>
          </View>

          <View style={styles.readinessPanel}>
            <ReadinessRow label="中文界面" value="已启用" tone="ok" />
            <ReadinessRow label="安装入口" value={webPreview ? "iPhone 网页应用" : "内测安装包"} tone="ok" />
            <ReadinessRow label="连接方式" value={serverMode} tone={serverLooksReady ? "ok" : "warn"} />
            <ReadinessRow label="配对状态" value={pairingCode.length === 6 ? "6 位已就绪" : "等待桌面端生成"} tone={pairingCode.length === 6 ? "ok" : "warn"} />
          </View>

          <View style={styles.formPanel}>
            <View style={styles.formHeader}>
              <Text style={styles.panelTitle}>连接 Mac 工作台</Text>
              <Text style={styles.panelMeta}>同一 Wi-Fi 优先</Text>
            </View>
            <Text style={styles.fieldLabel}>Mac 连接地址</Text>
            <TextInput
              testID="mobile-pair-server-url"
              accessibilityLabel="Mac 工作台连接地址"
              autoCapitalize="none"
              keyboardType="url"
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://192.168.0.107:38888"
              placeholderTextColor="#98a2b3"
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>6 位配对码</Text>
            <TextInput
              testID="mobile-pair-code"
              accessibilityLabel="6 位配对码"
              value={pairingCode}
              onChangeText={(value) => setPairingCode(value.replace(/\D/g, "").slice(0, 6))}
              placeholder="输入 6 位码"
              placeholderTextColor="#98a2b3"
              keyboardType="number-pad"
              style={[styles.input, styles.codeInput]}
              maxLength={6}
            />
            {pairingError ? <Text style={styles.errorText}>{pairingError}</Text> : null}
            <PrimaryButton
              label={pairButtonLabel}
              icon="→"
              disabled={pairButtonDisabled}
              onPress={() => pairMutation.mutate()}
              testID="mobile-pair-submit"
            />
            <Text style={styles.helperText}>
              {normalizedServerUrl.includes("openclaw-relay")
                ? "CloudBase 公网中转：手机和 Mac 不在同一网络时使用这个地址。"
                : normalizedServerUrl.includes(":38888")
                  ? "局域网直连：示例 http://192.168.x.x:38888，必须同一 Wi-Fi。"
                  : publicBrokerUrl
                    ? `外网访问建议使用：${publicBrokerUrl}`
                    : "公网 HTTPS 地址用于外网访问；局域网地址只适合同一 Wi-Fi。"}
            </Text>
            <View style={styles.pairingQuickServers} testID="mobile-pair-server-shortcuts">
              {pairingServerOptions.map((option) => {
                const value = normalizeServerUrl(option.value);
                const active = normalizedServerUrl === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityLabel={`选择${option.label}地址`}
                    accessibilityRole="button"
                    onPress={() => setServerUrl(value)}
                    style={[styles.pairingQuickServerButton, active && styles.pairingQuickServerButtonActive]}
                    testID={`mobile-pair-server-shortcut-${option.label}`}
                  >
                    <Text style={[styles.pairingQuickServerLabel, active && styles.pairingQuickServerLabelActive]}>{option.label}</Text>
                    <Text numberOfLines={1} style={[styles.pairingQuickServerValue, active && styles.pairingQuickServerValueActive]}>{value}</Text>
                  </Pressable>
                );
              })}
            </View>
            {serverWasNormalized ? <Text style={styles.helperText}>已自动纠正为：{normalizedServerUrl}</Text> : null}
          </View>

          {/* R17: QR 扫码入口。桌面端工作台已显示 QR 码;手机端用这个入口
              拉起扫码 UI,识别到 openclaw://pair?... 深链后自动填入地址和
              6 位配对码,直接进入「连接并进入记录」。无相机权限时降级到
              剪贴板 / 手动粘贴,不让扫码失败把用户卡在配对屏。 */}
          <View style={styles.formPanel} testID="mobile-qr-scan-panel">
            <View style={styles.formHeader}>
              <Text style={styles.panelTitle}>扫码配对</Text>
              <Text style={styles.panelMeta}>桌面端系统设置 → 手机配对 → 二维码</Text>
            </View>
            <Text style={styles.body}>
              用相机扫描桌面端显示的二维码。识别后会自动填入 Mac 地址和 6 位配对码。
              相机权限被拒或暂未安装扫码模块时,可从剪贴板/手动粘贴回退。
            </Text>
            <PrimaryButton
              label="打开扫码"
              icon="▦"
              disabled={false}
              onPress={() => {
                Haptics.tick();
                setQRScanOpen(true);
              }}
              testID="mobile-pair-qr-open"
            />
            <View style={styles.qrScanActionsRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="从剪贴板读取扫码内容"
                testID="mobile-pair-qr-clipboard"
                onPress={async () => {
                  Haptics.tick();
                  try {
                    // @ts-ignore — expo-clipboard is optional; resolves to null at runtime when missing.
                    const Clipboard = await import("expo-clipboard").catch(() => null);
                    if (!Clipboard || typeof Clipboard.getStringAsync !== "function") {
                      setQRScanError("剪贴板模块未装载,无法读取。请直接打开扫码或手动粘贴。");
                      setQRScanOpen(true);
                      return;
                    }
                    const text = await Clipboard.getStringAsync();
                    if (!text) {
                      setQRScanError("剪贴板为空。请先在桌面端复制 QR 链接,或直接打开扫码。");
                      setQRScanOpen(true);
                      return;
                    }
                    handleScannedPayload(text);
                  } catch (err) {
                    setQRScanError(`读取剪贴板失败: ${err instanceof Error ? err.message : String(err)}`);
                    setQRScanOpen(true);
                  }
                }}
                style={({ pressed }) => [styles.qrScanSecondaryBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.qrScanSecondaryText}>从剪贴板读</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="手动粘贴 QR 内容"
                testID="mobile-pair-qr-manual"
                onPress={() => {
                  Haptics.tick();
                  setQRScanOpen(true);
                }}
                style={({ pressed }) => [styles.qrScanSecondaryBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.qrScanSecondaryText}>手动粘贴</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.quickGrid}>
            <HelpCard title="扫码打不开" text="不用扫码，手动输入 Mac 地址和 6 位码即可配对。" />
            <HelpCard title="没有数据" text="先确认同一 Wi-Fi，再下拉刷新记录首页。" />
          </View>
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>安全边界</Text>
            <Text style={styles.noticeText}>{macPrimaryCopy} 离线只能看最后缓存，不能发送、审批或绕过人工门控。</Text>
          </View>
          <View style={styles.setupGrid}>
            <PairingStep index="1" title="打开桌面端" text="Mac 上进入 系统设置 > 手机配对，点击生成 6 位码。" />
            <PairingStep index="2" title="填入配对码" text="如果从二维码进入，地址和配对码会自动带入。" />
            <PairingStep index="3" title="进入记录" text="配对成功后可快速记录、查看今日日程、搜索知识地图。" />
          </View>
        </ScrollView>

        {/* R17: QR 扫码 modal — 包装在 pairing 屏外(已配对后不显示)。
            Modal 内部根据 qrScannerAvailable 走"相机"或"剪贴板+手动粘贴"两条路。 */}
        <QRScanModal
          visible={qrScanOpen}
          scannerAvailable={qrScannerAvailable}
          scannerPermission={qrScannerPermission}
          initialError={qrScanError}
          onClose={() => {
            setQRScanOpen(false);
            setQRScanError("");
          }}
          onScanned={(payload) => {
            handleScannedPayload(payload);
            setQRScanOpen(false);
            setQRScanError("");
          }}
          onRequestPermission={async () => {
            Haptics.tick();
            const result = await requestQRScannerPermission();
            setQrScannerPermission(result);
            if (result === "denied" || result === "unavailable") {
              setQRScanError(
                result === "denied"
                  ? "相机权限被拒绝,无法扫码。可在系统设置里重新允许,或使用「手动粘贴」/「从剪贴板读」继续配对。"
                  : "相机扫码模块不可用(native rebuild 后会启用)。请使用「手动粘贴」或「从剪贴板读」继续配对。",
              );
            } else {
              setQRScanError("");
            }
          }}
        />
      </ScreenShell>
    );
  }

  // ===== 已配对:渲染新的"记录"首页 + 折叠的"执行台" =====
  return (
    <ScreenShell>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={todayQuery.isFetching} onRefresh={refresh} />}
          contentContainerStyle={styles.scrollContent}
        >
          {/* 2026-07-03 — R7 stale recorder recovery banner.
              Appears at the very top of the home page so the user always has
              a way out before any other content renders. Surfaces a
              continue / discard / retry choice when the workbench was left
              stuck or when a cold-start picked up a marker from the
              previous JS engine. */}
          {voiceWorkbenchOpen && voiceWorkbenchProgressRecoveryVisible ? (
            <View style={styles.voiceRecoveryBanner} testID="mobile-voice-recovery-banner">
              <Text style={styles.voiceRecoveryBannerTitle}>语音工作台似乎无响应</Text>
              <Text style={styles.voiceRecoveryBannerBody}>
                {voiceRecorderError ? `上次错误:${voiceRecorderError};` : "已超过 60 秒未推进。"}
                不会自动删除服务器上的旧会话,可选择继续、丢弃本地草稿、重试同步。
              </Text>
              <View style={styles.voiceRecoveryBannerActions}>
                <Button
                  label="继续编辑"
                  tone="primary"
                  size="sm"
                  onPress={() => {
                    setVoiceRecoveryDismissed(true);
                    setVoiceWorkbenchStaleSince(null);
                    Haptics.tick();
                  }}
                  testID="mobile-voice-recovery-continue"
                />
                <Button
                  label="丢弃本地草稿"
                  tone="secondary"
                  size="sm"
                  onPress={discardStaleVoiceWorkbench}
                  testID="mobile-voice-recovery-discard"
                />
                <Button
                  label="重试同步"
                  tone="secondary"
                  size="sm"
                  onPress={retryVoiceWorkbenchSync}
                  testID="mobile-voice-recovery-retry"
                />
              </View>
            </View>
          ) : null}
          {bootRecoveryMarker && !voiceWorkbenchOpen ? (
            <View style={styles.voiceRecoveryBanner} testID="mobile-voice-boot-recovery">
              <Text style={styles.voiceRecoveryBannerTitle}>检测到上次未完成的录音</Text>
              <Text style={styles.voiceRecoveryBannerBody}>
                上次录音于 {shortTime(bootRecoveryMarker.writtenAt ?? undefined)} 没有正常结束。
                {bootRecoveryMarker.recorderSessionId ? ` 服务端仍有会话 ${bootRecoveryMarker.recorderSessionId.slice(0, 8)}…,不会自动删除。` : ""}
                {" "}可以选择继续(回到预览/转写界面)或丢弃本地草稿重新开始。
              </Text>
              <View style={styles.voiceRecoveryBannerActions}>
                <Button
                  label="继续上次录音"
                  tone="primary"
                  size="sm"
                  onPress={() => {
                    setVoiceWorkbenchMode("preview");
                    setShowVoice(true);
                    Haptics.tick();
                  }}
                  testID="mobile-voice-recovery-boot-continue"
                />
                <Button
                  label="丢弃本地草稿"
                  tone="secondary"
                  size="sm"
                  onPress={async () => {
                    await clearAllRecorderLocalState();
                    setBootRecoveryMarker(null);
                    Haptics.warn();
                  }}
                  testID="mobile-voice-recovery-boot-discard"
                />
                <Button
                  label="忽略"
                  tone="ghost"
                  size="sm"
                  onPress={() => {
                    setBootRecoveryMarker(null);
                    Haptics.light();
                  }}
                  testID="mobile-voice-recovery-boot-dismiss"
                />
              </View>
            </View>
          ) : null}

          {/* 2026-07-03 — R7: voice workbench is now an INLINE section (was a
              fullscreen Modal). Live + preview + recovery buttons stay
              accessible, but the home page sections remain visible below.
              testID `mobile-voice-workbench-page` is preserved so existing
              regression tests keep passing. */}
          {voiceWorkbenchOpen && !voiceWorkbenchMinimized ? (
            <View style={styles.voiceWorkbenchInline} testID="mobile-voice-workbench-page">
              <View style={styles.voiceWorkbenchHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="最小化语音录音"
                  testID="mobile-voice-workbench-minimize"
                  onPress={() => setVoiceWorkbenchMode("minimized")}
                  style={styles.voiceWorkbenchHeaderButton}
                >
                  <Text style={styles.voiceWorkbenchHeaderButtonText}>最小化</Text>
                </Pressable>
                <View style={{ alignItems: "center", flex: 1 }}>
                  <Text style={styles.voiceWorkbenchKicker}>语音记录</Text>
                  <Text style={styles.voiceWorkbenchHeaderTitle}>
                    {noteRecordingActive ? "语音草稿工作台" : autoOrganizing || voiceWorkbenchMode === "transcribing" ? "后台转写中" : voiceWorkbenchMode === "saved" ? "已生成笔记" : "预览并确认入库"}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="关闭语音录音"
                  testID="mobile-recorder-workspace-close"
                  onPress={noteRecordingActive ? cancelVoiceRecording : closeVoiceWorkbench}
                  style={styles.voiceWorkbenchHeaderButton}
                >
                  <Text style={styles.voiceWorkbenchHeaderButtonText}>{noteRecordingActive ? "取消" : "退出"}</Text>
                </Pressable>
              </View>

              {/* R19: emulator-only hidden QA action. Only rendered when
                  extra.r19QaAudioAction === true in app.json. Lets the
                  emulator acceptance script push a real bundled test WAV
                  through the same transcribeOffline() → recordLocalAsrSegment()
                  pipeline that rollLiveSegment uses, so the workbench
                  textarea renders real local ASR text without needing host
                  microphone injection. Not visible in production builds. */}
              {R19_QA_AUDIO_FLAG && noteRecordingActive ? (
                <View style={styles.voiceWorkbenchPanel}>
                  <View style={styles.panelHeader}>
                    <Text style={styles.panelTitle}>R19 调试 · 模拟录音输入</Text>
                    <Text style={styles.panelMeta}>仅 emulator / R19 构建可见</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="导入测试音频并转写"
                    testID="mobile-r19-qa-audio-transcribe"
                    onPress={() => {
                      void runR19QaAudioTranscribe();
                    }}
                    style={({ pressed }) => [styles.voiceWorkbenchHeaderButton, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.voiceWorkbenchHeaderButtonText}>导入测试音频 · 走真实本地 ASR</Text>
                  </Pressable>
                </View>
              ) : null}

              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={styles.voiceWorkbenchBodyWrap}
                contentContainerStyle={styles.voiceWorkbenchBody}
                testID="mobile-recorder-workspace-page"
              >
                {/* 2026-07-04 R9 — 实时录音前置提示:R5B recorder session 走的是
                    分片实时上传路径(录音时按 ~96KB 分片持续上传,CloudBase 公网
                    中继不再 413)。远端兜底把分片拼装/转写仍是停止后启动;这里只是
                    强调「录音期间已经在传输,不是等停止才一次性把整段录音抛给
                    远端」。不再使用「这里不是流式 ASR」这种把实时录音误解成
                    ASR 流式输出的措辞。R11: native rebuild 后,这段提示会
                    被「本地 ASR 已就绪,停止后立即在手机端转写」整段替换。 */}
                {!noteRecordingActive && voiceWorkbenchMode !== "saved" && voiceWorkbenchMode !== "transcribing" ? (
                  <View
                    style={offlineAsrReady || offlineAsrMacFallback ? styles.voicePreflightReady : styles.voicePreflightWarn}
                    testID="mobile-voice-workbench-preflight"
                  >
                    <Text style={offlineAsrReady || offlineAsrMacFallback ? styles.voicePreflightReadyTitle : styles.voicePreflightWarnTitle}>
                      {offlineAsrReady
                        ? "实时录音 · 本地 ASR 引擎已就绪"
                        : offlineAsrMacFallback
                          ? "实时录音 · 本地 ASR 未装,远端片段兜底"
                          : appRecorderState.offlineAsr.status === "loading"
                            ? "实时录音 · 本地 ASR 模型加载中"
                            : appRecorderState.offlineAsr.status === "missing"
                              ? `实时录音 · 本地 ASR 未安装 (${appRecorderState.offlineAsr.expectedModelSizeMB ?? "?"} MB),待 native rebuild`
                              : bootstrapQuery.isFetching
                                ? "实时录音 · 正在检查本地 ASR 引擎..."
                                : "实时录音 · 本地 ASR 尚未就绪"}
                    </Text>
                    <Text style={styles.voicePreflightBody}>
                      {offlineAsrReady
                        ? "录音期间按小分片实时上传到工作台;停止录音后手机端本地模型会自动转写,完成前可先在下方输入草稿或粘贴转写文本。"
                        : offlineAsrMacFallback
                          ? "本地 ASR 模型未安装,native rebuild 完成后会自动接管。期间会通过 R5B 录音会话轮询 segments 作为兜底,可在下方手动输入草稿或粘贴转写文本。"
                          : appRecorderState.offlineAsr.status === "loading"
                            ? "本地 ASR 模型正在加载(首次通常 3-8 秒)。录音期间仍按小分片实时上传,完成前可先在下方输入草稿。"
                            : appRecorderState.offlineAsr.status === "missing"
                              ? `本地 ASR 模型未安装。native rebuild 后会自动启用 (${appRecorderState.offlineAsr.expectedModelSizeMB ?? "?"} MB),期间可手动输入或粘贴转写文本。`
                              : "本地 ASR 引擎尚未就绪;native rebuild 完成后会自动启用。期间可在下方手动输入或粘贴转写文本,然后点「确认入库」。"}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.voiceHeroCard}>
                  <Text style={styles.voiceHeroLabel}>{noteRecordingActive ? "正在录音" : voiceWorkbenchMode === "transcribing" ? "正在上传分片" : voiceWorkbenchMode === "saved" ? "已入库" : "等待确认"}</Text>
                  <Text style={styles.voiceHeroTime}>{formatDuration(activeVoiceDurationSeconds ?? liveRecordingSeconds)}</Text>
                  {/* 2026-07-06 — R18: voiceHeroMeta now优先展示本地 ASR 实时
                      转写段数;只有当本地 ASR 已就绪 但 本地 segment 为 0 时,
                      才退回到"等待首个本地 ASR 实时分段"。远端兜底只在本地
                      ASR 显式失败 后 才出现,不再作为 active recording 主
                      状态。 */}
                  <Text style={styles.voiceHeroMeta} testID="mobile-voice-workbench-hero-meta">
                    {noteRecordingActive
                      ? voiceLocalLive
                        ? `录音中 · 实时分片上传 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"} · ${voiceLocalLiveLabel}${appRecorderState.segmentsCount > 0 ? ` · 远端已拉取 ${appRecorderState.segmentsCount} 个片段作辅助` : ""}`
                        : offlineAsrReady
                          ? `录音中 · 实时分片上传 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"} · 本地 ASR 已就绪,等待首个实时分段`
                          : offlineAsrMacFallback
                            ? `录音中 · 实时分片上传 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"} · 本地 ASR 未装,等待远端片段兜底(已拉取 ${appRecorderState.segmentsCount} 个片段)`
                            : `录音中 · 实时分片上传 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"} · 本地 ASR 初始化中,等待首个实时分段`
                      : voiceWorkbenchMode === "transcribing"
                        ? voiceLocalLive
                          ? `分片上传中 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"} · 本地 ASR 已实时转写 ${appRecorderState.localSegmentsCount} 段,服务端同步上传中`
                          : offlineAsrReady
                            ? `分片上传中 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"} · 本地 ASR 整段转写已启动`
                            : offlineAsrMacFallback
                              ? `分片上传中 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"} · 等待远端分段拉取`
                              : `分片上传中 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"} · 本地 ASR 尚未启动`
                        : voiceWorkbenchMode === "saved"
                          ? "已生成 Markdown + HTML · 关闭后可继续录音"
                          : voiceLocalLive
                            ? `实时录音完成 · 本地 ASR 已实时转写 ${appRecorderState.localSegmentsCount} 段${appRecorderState.segmentsCount > 0 ? ` · 远端辅助 ${appRecorderState.segmentsCount} 段` : ""}`
                            : offlineAsrReady
                              ? `实时录音完成 · 等待本地 ASR 整段转写`
                              : offlineAsrMacFallback
                                ? `实时录音完成 · 等待远端兜底片段 ${appRecorderState.segmentsCount > 0 ? `(${appRecorderState.segmentsCount} 个片段)` : ""}`
                                : "实时录音完成 · 本地 ASR 未就绪,可手动输入文本"}
                  </Text>
                </View>

                {/* 2026-07-04 R9B: dedicated realtime/near-realtime transcript status row.
                    Surfaces (a) whether the polling loop is active, (b) the interval in
                    seconds, and (c) the segment count + chunk progress. Hidden once the
                    recorder stops so the workbench collapses back to the preview pane. */}
                {noteRecordingActive ? (
                  <View style={styles.voiceRealtimeRow} testID="mobile-recorder-realtime-status">
                    <View style={styles.voiceRealtimeDot} />
                    <Text style={styles.voiceRealtimeRowText}>
                      {voiceLocalLive
                        ? `${voiceLocalLiveLabel}${appRecorderState.segmentsCount > 0 ? ` · 远端辅助已拉取 ${appRecorderState.segmentsCount} 个片段` : ""} · 每 10 秒轮询一次`
                        : appRecorderState.segmentsCount > 0
                          ? `远端兜底已拉取 ${appRecorderState.segmentsCount} 个片段 · 每 10 秒轮询一次 · 本地 ASR 暂未返段`
                          : offlineAsrReady
                            ? `本地 ASR 已就绪,等待首个实时分段转写 · 已上传 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"} 个分片`
                            : offlineAsrMacFallback
                              ? `等待远端兜底转写片段 · 每 10 秒轮询一次 · 已上传 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"} 个分片`
                              : `录音中 · 本地 ASR 初始化中,等待引擎就绪信号`}
                    </Text>
                  </View>
                ) : null}

                {/* 2026-07-04 R10: explicit live-transcription state row. Distinguishes
                    the four real states of the live segment pipeline so the UI never
                    pretends realtime is running:
                      - uploaded but nothing transcribed yet (uploading/waiting)
                      - transcript segment received
                      - provider unavailable
                      - segment transcription failed */}
                {noteRecordingActive ? (
                  <View style={styles.voiceRealtimeRow} testID="mobile-recorder-live-transcription-status">
                    <View style={styles.voiceRealtimeDot} />
                    <Text style={styles.voiceRealtimeRowText}>
                      {voiceLocalLive
                        ? `${voiceLocalLiveLabel} · 已上传 ${appRecorderState.liveSegmentsUploaded} 个分段${appRecorderState.segmentsCount > 0 ? ` · 远端同步拉取 ${appRecorderState.segmentsCount} 个片段` : ""}`
                        : appRecorderState.liveTranscription === "received"
                          ? `远端转写片段到达 · 已拉取 ${appRecorderState.segmentsCount} 个片段 · 已上传 ${appRecorderState.liveSegmentsUploaded} 个实时分段`
                          : appRecorderState.liveTranscription === "unavailable"
                            ? offlineAsrReady
                              ? `本地 ASR 引擎未响应实时转写 · 已上传 ${appRecorderState.liveSegmentsUploaded} 个实时分段,可手动输入草稿`
                              : offlineAsrMacFallback
                                ? `远端兜底未配置实时转写 · 已上传 ${appRecorderState.liveSegmentsUploaded} 个实时分段,可手动输入草稿`
                                : `本地 ASR 引擎未就绪 · 已上传 ${appRecorderState.liveSegmentsUploaded} 个实时分段,可手动输入草稿`
                            : appRecorderState.liveTranscription === "failed"
                              ? `实时分段上传失败 · 录音仍在继续,可手动输入或稍后重试 · 已上传 ${appRecorderState.liveSegmentsUploaded} 个实时分段`
                              : appRecorderState.liveSegmentsUploaded > 0
                                ? offlineAsrReady
                                  ? `实时分段已上传 ${appRecorderState.liveSegmentsUploaded} 个 · 本地 ASR 正在转写首个分段 · 每 ${Math.round(LIVE_SEGMENT_MS / 1000)} 秒滚动一次`
                                  : offlineAsrMacFallback
                                    ? `实时分段已上传 ${appRecorderState.liveSegmentsUploaded} 个 · 等待远端兜底拉取转写片段 · 每 10 秒轮询一次`
                                    : `实时分段已上传 ${appRecorderState.liveSegmentsUploaded} 个 · 本地 ASR 未就绪,等待引擎信号`
                                : offlineAsrReady
                                  ? `录音中 · 本地 ASR 已就绪,等待首个实时分段 (每 ${Math.round(LIVE_SEGMENT_MS / 1000)} 秒滚动一次)`
                                  : offlineAsrMacFallback
                                    ? `录音中 · 等待远端兜底转写片段 · 每 10 秒轮询一次`
                                    : `录音中 · 正在录制首个实时分段 (每 ${Math.round(LIVE_SEGMENT_MS / 1000)} 秒上传一次)`}
                    </Text>
                  </View>
                ) : null}


                <View style={styles.voiceWorkbenchPanel}>
                  <View style={styles.panelHeader}>
                    <Text style={styles.panelTitle}>实时转写 / 手动草稿</Text>
                    <Text style={styles.panelMeta}>{noteRecordingActive ? "录音中可写草稿" : "停止后可修订"}</Text>
                  </View>
                  <TextInput
                    value={voiceTranscript}
                    onChangeText={setVoiceTranscript}
                    placeholder={noteRecordingActive
                      ? voiceLocalLive
                        ? `本地 ASR 已实时转写 ${appRecorderState.localSegmentsCount} 段;继续录音会自动追加,也可手动输入要点或粘贴已有转写。`
                        : offlineAsrReady
                          ? `本地 ASR 已就绪,等待第一个实时分段写入。也可手动输入要点或粘贴已有转写。`
                          : offlineAsrMacFallback
                            ? `等待远端兜底转写片段(每 10 秒轮询)。也可手动输入要点或粘贴已有转写。`
                            : `本地 ASR 初始化中。也可手动输入要点或粘贴已有转写。`
                      : voiceLocalLive
                        ? `本地 ASR 已实时转写 ${appRecorderState.localSegmentsCount} 段 · 停止后会自动合并整段文本。`
                        : offlineAsrReady
                          ? `本地 ASR 已就绪 · 停止后会自动转写整段录音并填入文本。`
                          : offlineAsrMacFallback
                            ? `本地 ASR 未装 · 停止后由远端兜底合并文本。`
                            : `本地 ASR 未就绪 · 可手动粘贴转写。`}
                    placeholderTextColor={Color.inkDisabled}
                    multiline
                    style={styles.voiceWorkbenchTranscript}
                    testID="mobile-voice-workbench-transcript"
                  />
                  {noteRecordingActive ? (
                    <Text style={styles.helperText} testID="mobile-voice-workbench-realtime-hint">
                      {voiceLocalLive
                        ? `${voiceLocalLiveLabel} · 已上传分片 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"}${appRecorderState.segmentsCount > 0 ? ` · 远端已拉取 ${appRecorderState.segmentsCount} 个片段作辅助` : ""}。可在下方输入草稿,本地 ASR 会自动合并。`
                        : offlineAsrReady
                          ? `本地 ASR 已就绪,等待首个实时分段 · 已上传分片 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"}。可在下方先输入草稿,本地 ASR 会自动合并。`
                          : offlineAsrMacFallback
                            ? `等待远端兜底转写片段 · 每 10 秒轮询一次 · 已上传分片 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"}${appRecorderState.segmentsCount > 0 ? ` · 已拉取 ${appRecorderState.segmentsCount} 个片段` : ""}。`
                            : `本地 ASR 初始化中 · 已上传分片 ${appRecorderState.uploadedChunks}/${appRecorderState.totalChunks || "—"}。可在下方输入草稿。`}
                    </Text>
                  ) : null}
                  {autoOrganizing || voiceWorkbenchMode === "transcribing" ? (
                    <Text style={styles.helperText} testID="mobile-voice-workbench-transcribing">
                      {offlineAsrReady
                        ? "本地 ASR 转写中。可点\"最小化\"继续查看其他页面,完成后这里会自动填入文字并生成 Markdown / HTML 预览。"
                        : offlineAsrMacFallback
                          ? "远端兜底转写中(本地模型未装)。可点\"最小化\"继续查看其他页面,完成后这里会自动填入文字并生成 Markdown / HTML 预览。"
                          : `本地 ASR 转写中。可点"最小化"继续查看其他页面,完成后这里会自动填入文字并生成 Markdown / HTML 预览。`}
                    </Text>
                  ) : null}
                  {noteRecordingActive ? (
                    <View style={styles.voiceWorkbenchActionRow} testID="mobile-voice-workbench-control-bar">
                      {appRecorderState.paused ? (
                        <Button label="继续录音" tone="primary" size="md" onPress={() => { Haptics.tick(); recorderSetPaused(false); }} testID="mobile-voice-workbench-resume" />
                      ) : (
                        <Button label="暂停" tone="secondary" size="md" onPress={() => { Haptics.tick(); recorderSetPaused(true); }} testID="mobile-voice-workbench-pause" />
                      )}
                      <Button label="停止并预览" tone="danger" size="md" onPress={stopVoiceRecording} testID="mobile-voice-workbench-stop-end" />
                      <Button label="后台查看" tone="secondary" size="md" onPress={() => setVoiceWorkbenchMode("minimized")} testID="mobile-voice-workbench-background" />
                    </View>
                  ) : null}
                </View>

                {!noteRecordingActive ? (
                  <View style={styles.voiceWorkbenchPanel} testID="mobile-voice-workbench-preview">
                    <View style={styles.panelHeader}>
                      <Text style={styles.panelTitle}>Markdown / HTML 预览</Text>
                      <Text style={styles.panelMeta}>确认后入库</Text>
                    </View>
                    <TextInput
                      value={voiceTitle}
                      onChangeText={setVoiceTitle}
                      placeholder="标题,可留空"
                      placeholderTextColor={Color.inkDisabled}
                      style={styles.input}
                      testID="mobile-voice-workbench-title"
                    />
                    <View style={styles.voicePreviewTabs}>
                      <Pressable
                        onPress={() => setVoicePreviewTab("markdown")}
                        style={[styles.voicePreviewTab, voicePreviewTab === "markdown" && styles.voicePreviewTabActive]}
                        testID="mobile-voice-preview-md-tab"
                      >
                        <Text style={[styles.voicePreviewTabText, voicePreviewTab === "markdown" && styles.voicePreviewTabTextActive]}>Markdown</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setVoicePreviewTab("html")}
                        style={[styles.voicePreviewTab, voicePreviewTab === "html" && styles.voicePreviewTabActive]}
                        testID="mobile-voice-preview-html-tab"
                      >
                        <Text style={[styles.voicePreviewTabText, voicePreviewTab === "html" && styles.voicePreviewTabTextActive]}>HTML</Text>
                      </Pressable>
                    </View>
                    <ScrollView style={styles.voicePreviewBox} nestedScrollEnabled>
                      <Text selectable style={styles.voicePreviewText}>
                        {voicePreviewTab === "markdown" ? voicePreviewMarkdown : voicePreviewHtml}
                      </Text>
                    </ScrollView>
                    {voiceWorkbenchMode === "saved" && voiceResult ? (
                      <View style={styles.successBanner} testID="mobile-voice-workbench-saved">
                        <Text style={styles.successTitle}>Markdown + HTML 已入库</Text>
                        <Text style={styles.successText}>Markdown: {voiceResult.markdownPath || "-"}</Text>
                        <Text style={styles.successText}>HTML: {voiceResult.htmlPath || "-"}</Text>
                      </View>
                    ) : (
                      <View style={styles.voiceWorkbenchActionRow}>
                        <Button
                          label={voiceWorkbenchMode === "saving" ? "正在入库" : voiceRecorderError ? "用手动转写文本入库" : "确认入库"}
                          tone="primary"
                          size="md"
                          loading={voiceWorkbenchMode === "saving"}
                          disabled={voiceWorkbenchMode === "saving" || !voiceTranscript.trim()}
                          onPress={confirmVoicePreviewSave}
                          testID="mobile-voice-workbench-confirm"
                        />
                        <Button label="继续编辑" tone="secondary" size="md" onPress={() => setVoicePreviewTab("markdown")} testID="mobile-voice-workbench-edit" />
                        <Button label="退出本次录音" tone="secondary" size="md" onPress={closeVoiceWorkbench} testID="mobile-voice-workbench-exit" />
                      </View>
                    )}
                  </View>
                ) : null}
              </ScrollView>

              {/* 2026-07-03 — sticky安全退出栏:任何状态下都可以最小化或退出
                  (Modal 版本里靠 Modal 的底部安全区;inline 版本粘在 section 末尾) */}
              {!noteRecordingActive ? (
                <View style={styles.voiceWorkbenchFooter} testID="mobile-voice-workbench-footer">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="最小化语音录音(让出屏幕)"
                    testID="mobile-voice-workbench-footer-minimize"
                    onPress={() => setVoiceWorkbenchMode("minimized")}
                    style={({ pressed }) => [styles.voiceWorkbenchFooterBtn, styles.voiceWorkbenchFooterGhost, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.voiceWorkbenchFooterGhostText}>最小化(后台转写/草稿)</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="退出本次录音"
                    testID="mobile-voice-workbench-footer-close"
                    onPress={closeVoiceWorkbench}
                    style={({ pressed }) => [styles.voiceWorkbenchFooterBtn, styles.voiceWorkbenchFooterDanger, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.voiceWorkbenchFooterDangerText}>退出本次录音</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* 1. 紧凑同步条 — 不占据首屏大半行 */}
          <SyncBanner
            today={today}
            usingCache={usingCache}
            pendingCount={pendingCount}
            lastSyncAt={lastSyncAt}
            vault={bootstrapQuery.data?.vault}
          />

          {/* 2. 待办优先 — 紧凑,只剩 3 个 actionable 行 + 一个打开完整日程入口 */}
          <View
            testID="mobile-todo-priority-panel"
            accessibilityLabel="待办优先"
            style={styles.panelCompact}
          >
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>待办优先</Text>
              <Text style={styles.panelMeta}>{todoPanelMeta}</Text>
            </View>
            <View style={styles.agendaCompactList}>
              {agendaPreview.length ? (
                agendaPreview.slice(0, 3).map((row, index) => (
                  <AgendaRow key={`${row.lane}-${row.id || index}`} row={row} />
                ))
              ) : (
                <Text style={styles.emptyText} testID="mobile-todo-priority-empty">今天桌面端没有日程 / 待办 / 计划;下拉刷新或去"日程"新建。</Text>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="打开完整日程"
              testID="mobile-todo-priority-open-schedule"
              onPress={() => {
                Haptics.tick();
                onOpenCalendar?.({ kind: "task" });
              }}
              style={({ pressed }) => [styles.openScheduleButtonCompact, pressed && styles.openScheduleButtonPressed]}
            >
              <Text style={[Type.bodySm, { color: Color.primary, fontWeight: "900" }]}>打开完整日程</Text>
              <Text style={[Type.h3, { color: Color.primary, marginLeft: Space.sm }]}>→</Text>
            </Pressable>
          </View>

          {/* 2026-06-25 — Quick action card:把「添加笔记」入口提到首屏 */}
          <View style={styles.quickActionsCard} testID="record-quick-actions">
            <Pressable
              onPress={() => { Haptics.tick(); onOpenCapture?.(); }}
              style={({ pressed }) => [styles.quickAction, styles.quickActionPrimary, pressed && styles.quickActionPressed]}
              testID="record-add-note"
              accessibilityLabel="添加笔记"
            >
              <Text style={styles.quickActionGlyph}>✎</Text>
              <Text style={styles.quickActionLabel}>添加笔记</Text>
              <Text style={styles.quickActionHint}>文本 / 录音 / Markdown+HTML</Text>
            </Pressable>
            <Pressable
              onPress={() => { Haptics.tick(); onOpenKnowledge?.(); }}
              style={({ pressed }) => [styles.quickAction, pressed && styles.quickActionPressed]}
              testID="record-go-knowledge"
              accessibilityLabel="知识地图"
            >
              <Text style={[styles.quickActionGlyph, { color: Color.primary }]}>✦</Text>
              <Text style={[styles.quickActionLabel, { color: Color.primary }]}>知识地图</Text>
              <Text style={[styles.quickActionHint, { color: Color.inkMuted }]}>搜索 / 浏览 / 编辑</Text>
            </Pressable>
          </View>

          {/* 2026-06-25 — 首屏三卡提炼:待办 / 语音 / 时间线 (原 知识录入已迁到独立 CaptureScreen 页) */}
          <View style={styles.summaryCardRow} testID="record-summary-cards">
            <Pressable
              onPress={() => { Haptics.tick(); onOpenCalendar?.({ kind: "task" }); }}
              style={({ pressed }) => [styles.summaryCard, styles.summaryCardTodo, pressed && { opacity: 0.7 }]}
              testID="record-card-todo"
              accessibilityLabel="今日待办"
            >
              <View style={styles.summaryCardHeader}>
                <Text style={styles.summaryCardGlyph}>✓</Text>
                <Text style={styles.summaryCardLabel}>待办</Text>
              </View>
              {/* 2026-07-04 R8: read from `today` (query + cache fallback) so the KPI stays
                  consistent with the top summary even on a cold start / cache-only render. */}
              <Text style={styles.summaryCardCount}>{((today?.todos?.length ?? 0) + (today?.approvals?.length ?? 0))}</Text>
              <Text style={styles.summaryCardHint}>待处理 / 待审批</Text>
            </Pressable>
            <Pressable
              onPress={() => { Haptics.tick(); startVoiceRecording("note"); }}
              style={({ pressed }) => [styles.summaryCard, styles.summaryCardVoice, pressed && { opacity: 0.7 }]}
              testID="mobile-voice-record"
              accessible
              accessibilityRole="button"
              accessibilityLabel="语音录入"
            >
              <View style={styles.summaryCardHeader}>
                <Text style={styles.summaryCardGlyph}>◉</Text>
                <Text style={styles.summaryCardLabel}>语音</Text>
              </View>
              <Text style={styles.summaryCardCount}>{noteRecordingActive ? "录音中" : "一键"}</Text>
              <Text style={styles.summaryCardHint}>转写 + Markdown+HTML</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.tick();
                setSection("console");
                setConsoleTab("voice");
                setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
              }}
              style={({ pressed }) => [styles.summaryCard, styles.summaryCardTimeline, pressed && { opacity: 0.7 }]}
              testID="record-card-timeline"
              accessibilityLabel="时间线" 
            >
              <View style={styles.summaryCardHeader}>
                <Text style={styles.summaryCardGlyph}>▤</Text>
                <Text style={styles.summaryCardLabel}>时间线</Text>
              </View>
              {/* 2026-07-04 R8: same `today` (query + cache) merge so the 时间线 card does
                  not flash 0 while the cached payload is still hydrating. */}
              <Text style={styles.summaryCardCount}>{(today?.events?.length ?? 0) + (voiceQuery.data?.voiceNotes?.length ?? 0)}</Text>
              <Text style={styles.summaryCardHint}>今日事件 / 笔记</Text>
            </Pressable>
          </View>

          {/* 2026-06-25 — 展开语音输入面板 (NJX 首屏录音入口) */}
          <View style={styles.panelCompact} testID="mobile-voice-toggle">
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>语音输入</Text>
              <Pressable
                onPress={() => { Haptics.tick(); setShowVoice((v) => !v); }}
                accessibilityLabel={showVoice ? "收起语音输入" : "展开语音输入"}
                testID="mobile-voice-toggle-button"
                hitSlop={8}
              >
                <Text style={[Type.captionBold, { color: Color.primary }]}>{showVoice ? "收起 ▴" : "展开 ▾"}</Text>
              </Pressable>
            </View>
            {showVoice ? (
              <View>
                <Text style={[styles.body, { color: Color.inkFaint, marginBottom: Space.sm }]}>
                  点语音卡片直接录音;这里展开后可看转写文本与手动输入入口。
                </Text>
              <Text style={[Type.caption, { color: Color.inkMuted }]}>
                  {noteRecordingActive ? `录音中 ${formatDuration(activeVoiceDurationSeconds || 0)} · ${autoTranscriptionLabel}` : voiceTranscript ? "已转写: " + voiceTranscript.slice(0, 30) + "…" : "点击「语音」卡片开始录音"}
                </Text>
              </View>
            ) : (
              <Text style={[Type.caption, { color: Color.inkMuted }]}>默认折叠 · 点击右上「展开」查看语音说明</Text>
            )}
          </View>

          {!noteRecordingActive ? renderVoiceManualFallback(true) : null}

          {/* 4. 知识查询 — 紧凑,只露搜索框 + 1 个 preview 行 */}
          <View
            testID="mobile-knowledge-query-panel"
            accessibilityLabel="知识查询"
            style={styles.panelCompact}
          >
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>知识查询</Text>
              <Text style={styles.panelMeta}>地图 / 笔记 / HTML</Text>
            </View>
            <TextInput
              testID="mobile-knowledge-search"
              accessibilityLabel="搜索知识地图、笔记、HTML、Markdown"
              value={knowledgeQuery}
              onChangeText={setKnowledgeQuery}
              placeholder="搜索知识地图、笔记、HTML、Markdown"
              placeholderTextColor="#98a2b3"
              style={styles.input}
            />
            {knowledgePreview.length ? (
              <View>
                {knowledgePreview.slice(0, 1).map((row) => (
                  <Pressable
                    key={`${row.id}-${row.path}`}
                    accessibilityRole="button"
                    accessibilityLabel={`打开知识来源 ${row.title}`}
                    onPress={() => onOpenKnowledge?.()}
                    style={({ pressed }) => [styles.knowledgeRow, pressed && styles.knowledgeRowPressed]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[Type.bodySm, { color: Color.ink, fontWeight: "900" }]} numberOfLines={1}>{row.title}</Text>
                      <Text style={[Type.caption, { color: Color.inkFaint, marginTop: 2 }]} numberOfLines={1}>{row.path || row.source}</Text>
                    </View>
                    <Text style={[Type.microBold, { color: Color.primary }]}>打开</Text>
                  </Pressable>
                ))}
                <Text style={styles.helperText}>点击去"知识"标签查看完整地图与 Vault。</Text>
              </View>
            ) : atlasQuery.error ? (
              <ErrorBanner message={humanizeMobileError(atlasQuery.error instanceof Error ? atlasQuery.error.message : String(atlasQuery.error))} onRePair={onRePair} />
            ) : knowledgeOffline ? (
              <Text style={styles.helperText}>连接恢复后可继续搜索完整内容。</Text>
            ) : (
              <Text style={styles.helperText}>暂无知识条目,先去"知识"标签同步或新建。</Text>
            )}
          </View>

          {/* 待同步队列 — 仅在非空时显示,不挤占前三面板 */}
          {pendingNotes.length > 0 ? (
            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>待同步笔记</Text>
                <Text style={styles.panelMeta}>{pendingNotes.length} 项</Text>
              </View>
              {pendingNotes.map((note) => (
                <PendingNoteRow
                  key={note.id}
                  note={note}
                  syncing={syncingIds.includes(note.id)}
                  onRetry={() => retryPendingNote(note)}
                  onDiscard={() => discardPendingNote(note)}
                />
              ))}
            </View>
          ) : null}

          {voiceQuery.data?.voiceNotes?.length ? (
            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>今天已保存</Text>
                <Text style={styles.panelMeta}>{voiceQuery.data.voiceNotes.length} 条</Text>
              </View>
              {voiceQuery.data.voiceNotes.map((note) => (
                <View key={note.id} style={styles.listItem}>
                  <View style={styles.itemMain}>
                    <Text style={styles.itemTitle}>{note.title}</Text>
                    <Text style={styles.itemText} numberOfLines={3}>{note.transcriptText || "(暂无转写文本)"}</Text>
                    <Text style={styles.itemMeta}>{labelStatus(note.status)} · {note.durationSeconds ? formatDuration(note.durationSeconds) : "无录音时长"} · {shortTime(note.updatedAt)}</Text>
                    <View style={styles.itemActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`查看 ${note.title} 转写全文`}
                        testID={`voice-note-view-${note.id}`}
                        onPress={() => setVoiceNoteModal({
                          id: note.id, title: note.title, transcriptText: note.transcriptText,
                          status: note.status, knowledgePath: note.knowledgePath ?? note.markdownPath ?? "",
                          htmlPath: note.htmlPath ?? "",
                        })}
                        style={({ pressed }) => [styles.itemActionBtn, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={styles.itemActionText}>查看转写</Text>
                      </Pressable>
                      {String(note.status || "").toLowerCase() === "failed" || String(note.status || "").toLowerCase() === "error" ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`重新整理 ${note.title}`}
                          testID={`voice-note-retry-${note.id}`}
                          onPress={() => {
                            setVoiceNoteModal(null);
                            Haptics.tick();
                            setRecordingError("note", "已标记重新整理, 请在工作台查看最新状态");
                            void queryClient.invalidateQueries({ queryKey: ["mobile-voice-notes"] });
                          }}
                          style={({ pressed }) => [styles.itemActionBtn, styles.itemActionBtnPrimary, pressed && { opacity: 0.7 }]}
                        >
                          <Text style={[styles.itemActionText, { color: Color.onPrimary }]}>重新整理</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* 折叠的执行台(老"执行台"内容降级在这里,不再占据首屏) */}
          <View style={styles.consoleToggleRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={section === "capture" ? "展开执行台" : "收起执行台"}
              testID="mobile-section-toggle"
              onPress={() => {
                Haptics.tick();
                setSection(section === "capture" ? "console" : "capture");
              }}
              style={({ pressed }) => [styles.consoleToggle, pressed && styles.consoleTogglePressed]}
            >
              <Text style={[Type.bodySm, { color: Color.primary, fontWeight: "900" }]}>
                {section === "capture" ? "展开执行台 (对话 / 审批 / 智能体状态)" : "收起执行台,回到快速记录"}
              </Text>
            </Pressable>
          </View>

          {section === "console" ? (
            <View style={styles.sectionStack}>
              <StatusPanel tone={statusTone} today={today} usingCache={usingCache} />
              <ActionList actions={today?.nextActions || []} />
              <AgentStrip agents={today?.agentOps || bootstrapQuery.data?.agentOps || []} />
              <AgendaPanel today={today} />

              <View style={styles.segmented}>
                {consoleTabs.map((item) => (
                  <Pressable
                    key={item}
                    testID={`record-segment-${item}`}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={`执行台 ${consoleLabel(item)}`}
                    accessibilityState={{ selected: consoleTab === item }}
                    style={[styles.segment, consoleTab === item && styles.segmentActive]}
                    onPress={() => {
                      Haptics.tick();
                      setConsoleTab(item);
                      if (item === "voice") {
                        void startVoiceRecording("note");
                      }
                    }}
                  >
                    <Text style={[styles.segmentText, consoleTab === item && styles.segmentTextActive]}>{consoleLabel(item)}</Text>
                  </Pressable>
                ))}
              </View>

              {consoleTab === "voice" ? (
                <View style={styles.panel}>
                  <View style={styles.panelHeader}>
                    <Text style={styles.panelTitle}>今天已保存</Text>
                    <Text style={styles.panelMeta}>{voiceQuery.data?.voiceNotes.length || 0} 条</Text>
                  </View>
                  {(voiceQuery.data?.voiceNotes || []).length ? voiceQuery.data?.voiceNotes.map((note) => (
                    <View key={note.id} style={styles.listItem}>
                      <View style={styles.itemMain}>
                        <Text style={styles.itemTitle}>{note.title}</Text>
                        <Text style={styles.itemText} numberOfLines={3}>{note.transcriptText || "(暂无转写文本)"}</Text>
                        <Text style={styles.itemMeta}>{labelStatus(note.status)} · {note.durationSeconds ? formatDuration(note.durationSeconds) : "无录音时长"} · {shortTime(note.updatedAt)}</Text>
                        <View style={styles.itemActions}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`查看 ${note.title} 转写全文`}
                            testID={`voice-note-view-${note.id}`}
                            onPress={() => setVoiceNoteModal({
                              id: note.id, title: note.title, transcriptText: note.transcriptText,
                              status: note.status, knowledgePath: note.knowledgePath ?? note.markdownPath ?? "",
                              htmlPath: note.htmlPath ?? "",
                            })}
                            style={({ pressed }) => [styles.itemActionBtn, pressed && { opacity: 0.7 }]}
                          >
                            <Text style={styles.itemActionText}>查看转写</Text>
                          </Pressable>
                          {String(note.status || "").toLowerCase() === "failed" || String(note.status || "").toLowerCase() === "error" ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`重新整理 ${note.title}`}
                              testID={`voice-note-retry-${note.id}`}
                              onPress={() => {
                                setVoiceNoteModal(null);
                                Haptics.tick();
                                setRecordingError("note", "已标记重新整理, 请在工作台查看最新状态");
                                void queryClient.invalidateQueries({ queryKey: ["mobile-voice-notes"] });
                              }}
                              style={({ pressed }) => [styles.itemActionBtn, styles.itemActionBtnPrimary, pressed && { opacity: 0.7 }]}
                            >
                              <Text style={[styles.itemActionText, { color: Color.onPrimary }]}>重新整理</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  )) : (
                    <Text style={styles.emptyText}>今天还没有手机语音笔记。</Text>
                  )}
                </View>
              ) : null}

              {consoleTab === "chat" ? (
                <View style={styles.panel}>
                  <View style={styles.panelHeader}>
                    <Text style={styles.panelTitle}>随时对话</Text>
                    <Text style={styles.panelMeta}>主智能体 / 老板视角 / 执行智能体</Text>
                  </View>
                  {offlineReadOnly ? <ReadOnlyBanner /> : null}
                  <AssistantContextPanel today={today} />
                  <View style={styles.agentSwitch}>
                    {agents.map((agent) => (
                      <Pressable
                        key={agent}
                        style={[styles.agentButton, selectedAgent === agent && styles.agentButtonActive]}
                        onPress={() => setSelectedAgent(agent)}
                      >
                        <Text style={[styles.agentButtonText, selectedAgent === agent && styles.agentButtonTextActive]}>{labelAgent(agent)}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.chatBox}>
                    {chatMessages.length ? chatMessages.map((message) => (
                      <View key={message.id} style={[styles.message, message.role === "user" ? styles.userMessage : styles.assistantMessage]}>
                        <Text style={styles.messageRole}>{message.role === "user" ? "我" : labelAgent(selectedAgent)}</Text>
                        <Text style={styles.messageText}>{message.content}</Text>
                        <Text style={styles.messageStatus}>{labelStatus(message.status)}</Text>
                      </View>
                    )) : (
                      <Text style={styles.emptyText}>手机端对话会复用桌面工作台的知识源和模型配置。失败时会显示真实网关状态，不伪装成已回复。</Text>
                    )}
                  </View>
                  <View style={styles.voiceChatPanel}>
                    <View style={styles.panelHeader}>
                      <View>
                        <Text style={styles.panelTitle}>语音转文字后发送</Text>
                        <Text style={styles.panelMeta}>先转写到输入框，确认后再发送</Text>
                      </View>
                      <Text style={styles.panelMeta}>{autoTranscriptionLabel}</Text>
                    </View>
                    <View style={styles.recorderTray}>
                      <View style={styles.recorderHeader}>
                        <View style={styles.recorderStatus}>
                          <Text style={styles.recorderLabel}>{chatRecordingActive ? "正在录音" : hasChatRecordedAudio ? "录音已保存" : "准备录音"}</Text>
                          <Text style={styles.recorderTime}>{formatDuration(activeChatVoiceDurationSeconds ?? (chatRecordingActive ? liveRecordingSeconds : 0))}</Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={chatRecordingActive ? "停止" : "录音"}
                          style={[styles.recordButton, chatRecordingActive && styles.stopRecordButton, (offlineReadOnly || (recorderState.isRecording && !chatRecordingActive)) && styles.disabledButton]}
                          disabled={offlineReadOnly || (recorderState.isRecording && !chatRecordingActive)}
                          onPress={chatRecordingActive ? stopVoiceRecording : () => startVoiceRecording("chat")}
                        >
                          <Text style={styles.recordButtonText}>{chatRecordingActive ? "停止" : "录音"}</Text>
                        </Pressable>
                      </View>
                    </View>
                    <PrimaryButton
                      label={chatVoiceLabel}
                      icon="→"
                      disabled={chatVoiceDisabled}
                      onPress={() => chatVoiceMutation.mutate()}
                    />
                    {chatVoiceError ? <ErrorBanner message={chatVoiceError} onRePair={onRePair} /> : null}
                    <Text style={styles.helperText}>转写结果只会进入下方输入框；确认文本无误后，再点击发送给 {labelAgent(selectedAgent)}。</Text>
                  </View>
                  <TextInput
                    value={chatInput}
                    onChangeText={setChatInput}
                    placeholder="输入要交给智能体处理的事项"
                    placeholderTextColor="#98a2b3"
                    multiline
                    style={[styles.input, styles.chatInput]}
                  />
                  <PrimaryButton
                    label={offlineReadOnly ? "离线只读" : sendMutation.isPending ? "发送中" : "发送"}
                    icon="→"
                    disabled={offlineReadOnly || sendMutation.isPending || chatVoiceMutation.isPending || !chatInput.trim()}
                    onPress={() => sendMutation.mutate()}
                  />
                </View>
              ) : null}

              {consoleTab === "approvals" ? (
                <View style={styles.sectionStack}>
                  <View style={styles.panel}>
                    <View style={styles.panelHeader}>
                      <Text style={styles.panelTitle}>审批与接管</Text>
                      <Text style={styles.panelMeta}>{today?.approvals?.length || 0} 项待处理</Text>
                    </View>
                    {offlineReadOnly ? <ReadOnlyBanner /> : null}
                    {(today?.approvals || []).length ? today?.approvals.map((approval) => (
                      <View key={approval.id} style={styles.listItem}>
                        <View style={styles.itemMain}>
                          <Text style={styles.itemTitle}>{labelApprovalAction(approval.action)} · {approval.task_id ? `任务 ${approval.task_id}` : "未绑定任务"}</Text>
                          <Text style={styles.itemMeta}>{approval.requested_at || "等待确认"} · 来源 {labelSource("approvals")}</Text>
                        </View>
                        <View style={styles.rowActions}>
                          <SmallButton label="拒绝" tone="danger" disabled={offlineReadOnly || approvalMutation.isPending} onPress={() => approvalMutation.mutate({ id: approval.id, decision: "rejected" })} />
                          <SmallButton label="批准" tone="ok" disabled={offlineReadOnly || approvalMutation.isPending} onPress={() => approvalMutation.mutate({ id: approval.id, decision: "approved" })} />
                        </View>
                      </View>
                    )) : (
                      <Text style={styles.emptyText}>暂无待审批动作。高风险动作仍保留人工确认，不在手机端绕过。</Text>
                    )}
                    {approvalMutation.error ? <ErrorBanner message={humanizeMobileError(approvalMutation.error instanceof Error ? approvalMutation.error.message : String(approvalMutation.error))} onRePair={onRePair} /> : null}
                  </View>
                  <View style={styles.panel}>
                    <View style={styles.panelHeader}>
                      <Text style={styles.panelTitle}>阻塞任务</Text>
                      <Text style={styles.panelMeta}>{today?.blocked?.length || 0} 项</Text>
                    </View>
                    {(today?.blocked || []).slice(0, 8).map((item) => (
                      <View key={String(item.id || item.title)} style={styles.listItem}>
                        <View style={styles.itemMain}>
                          <Text style={styles.itemTitle}>{String(item.title || item.name || "阻塞任务")}</Text>
                          <Text style={styles.itemMeta}>{labelStatus(String(item.status || "blocked"))} · {labelAgent(String(item.agentId || item.agent_id || ""))}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <Timeline rows={today?.timeline || []} />
            </View>
          ) : null}

          {todayQuery.error && !usingCache ? <ErrorBanner message={humanizeMobileError(todayQuery.error instanceof Error ? todayQuery.error.message : String(todayQuery.error))} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
      {chatRecordingActive ? (
        <RecorderFloatingBar
          seconds={liveRecordingSeconds}
          paused={false}
          onStop={stopVoiceRecording}
          onCancel={cancelVoiceRecording}
        />
      ) : null}
      {voiceWorkbenchMinimized ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="展开语音录音工作台"
          testID="mobile-voice-workbench-mini"
          onPress={() => setVoiceWorkbenchMode(autoOrganizing ? "transcribing" : noteRecordingActive ? "recording" : recordedAudioUri || voiceTranscript.trim() ? "preview" : "recording")}
          style={styles.voiceWorkbenchMini}
        >
          <View style={styles.voiceWorkbenchMiniDot} />
          <View style={{ flex: 1 }}>
            <Text style={styles.voiceWorkbenchMiniTitle}>语音记录进行中</Text>
            <Text style={styles.voiceWorkbenchMiniMeta}>
              {noteRecordingActive ? `${formatDuration(liveRecordingSeconds)} · 录音中` : autoOrganizing ? "转写中" : "待确认入库"}
            </Text>
          </View>
          <Text style={styles.voiceWorkbenchMiniAction}>展开</Text>
        </Pressable>
      ) : null}
      {/* 2026-06-26 — R4: voice note 转写全文查看 modal (NJX: 语音录入无查看转写入口) */}
      <Modal
        visible={Boolean(voiceNoteModal)}
        transparent
        animationType="fade"
        onRequestClose={() => setVoiceNoteModal(null)}
      >
        <Pressable
          accessibilityLabel="关闭转写全文"
          onPress={() => setVoiceNoteModal(null)}
          style={styles.voiceModalScrim}
          testID="voice-note-modal-close"
        >
          <Pressable
            onPress={() => {}}
            style={styles.voiceModalCard}
            testID="voice-note-modal-card"
          >
            {voiceNoteModal ? (
              <>
                <Text style={styles.voiceModalTitle}>{voiceNoteModal.title}</Text>
                <Text style={styles.voiceModalMeta}>状态 {labelStatus(voiceNoteModal.status)}</Text>
                <ScrollView style={styles.voiceModalBody} contentContainerStyle={{ padding: Space.md }}>
                  <Text style={styles.voiceModalTranscript} selectable>
                    {voiceNoteModal.transcriptText || "(暂无转写文本)"}
                  </Text>
                </ScrollView>
                {voiceNoteModal.knowledgePath ? (
                  <Text style={styles.voiceModalPath}>Markdown: {voiceNoteModal.knowledgePath}</Text>
                ) : null}
                {voiceNoteModal.htmlPath ? (
                  <Text style={styles.voiceModalPath}>HTML: {voiceNoteModal.htmlPath}</Text>
                ) : null}
                <Pressable
                  onPress={() => setVoiceNoteModal(null)}
                  style={({ pressed }) => [styles.voiceModalClose, pressed && { opacity: 0.7 }]}
                  testID="voice-note-modal-dismiss"
                >
                  <Text style={styles.voiceModalCloseText}>关闭</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenShell>
  );
}

function consoleLabel(tab: ConsoleTab) {
  if (tab === "voice") return "语音";
  if (tab === "chat") return "对话";
  if (tab === "approvals") return "审批";
  return "执行";
}

function ScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.shell}>
      {children}
    </SafeAreaView>
  );
}

function SyncBanner({ today, usingCache, pendingCount, lastSyncAt, vault }: { today: MobileToday | null; usingCache: boolean; pendingCount: number; lastSyncAt: string | null; vault: MobileBootstrapVault | null | undefined }) {
  let tone: "ok" | "warn" | "danger" = "ok";
  let title = "Mac 已连接";
  if (usingCache) {
    tone = "warn";
    title = "离线只读";
  } else if (pendingCount > 0) {
    tone = "warn";
    title = `${pendingCount} 项等待同步`;
  } else if (today?.status.gateway === "unavailable") {
    tone = "warn";
    title = "Mac 已连接 · Agent 网关待恢复";
  }
  const lastSync = lastSyncAt ? shortTime(lastSyncAt) : "从未同步";
  // Vault source truth from bootstrap (P0-A: vaultLabel / vaultAvailable / vaultFallbackReason).
  // 2026-07-04 R8: also honor today.sources.nas (auto-refreshed every 30s) so a
  // freshly restored NAS clears the stale "未挂载" warning even if the bootstrap
  // query hasn't refetched yet.
  const vaultName = vault?.vaultLabel || vault?.displayName || vault?.vaultRoot || vault?.root || "vault";
  const nasSourceStatus = (today?.sources?.nas as { status?: string } | undefined)?.status;
  const nasSourceConnected = nasSourceStatus === "connected";
  const vaultAvailable = vault?.vaultAvailable === true || nasSourceConnected;
  const vaultFallbackReason =
    vault?.vaultFallbackReason || vault?.reason || (nasSourceConnected ? null : "请检查 NAS");
  const vaultStatus = vaultAvailable
    ? "已连接"
    : `未挂载 · ${vaultFallbackReason || "请检查 NAS"}`;
  const toneStyle = tone === "ok" ? styles.syncOk : tone === "warn" ? styles.syncWarn : styles.syncDanger;
  // 紧凑一行式:状态 + 待同步数 + 知识库源 + 最近同步
  const inlineStatus = pendingCount > 0 ? `${title} · ${pendingCount} 项待同步` : title;
  return (
    <View
      testID="mobile-sync-banner"
      accessibilityLabel={`同步状态: ${title}`}
      style={[styles.syncBannerCompact, toneStyle]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[Type.caption, { color: Color.ink, fontWeight: "900" }]} numberOfLines={1}>
          {inlineStatus} · 源 {vaultName}{vaultStatus === "已连接" ? "" : ` · ${vaultStatus}`} · 同步 {lastSync}
        </Text>
      </View>
    </View>
  );
}

function PairingStep({ index, title, text }: { index: string; title: string; text: string }) {
  return (
    <View style={styles.setupCard}>
      <Text style={styles.setupIndex}>{index}</Text>
      <View style={styles.setupBody}>
        <Text style={styles.setupTitle}>{title}</Text>
        <Text style={styles.setupText}>{text}</Text>
      </View>
    </View>
  );
}

function HelpCard({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.helpCard}>
      <Text style={styles.helpTitle}>{title}</Text>
      <Text style={styles.helpText}>{text}</Text>
    </View>
  );
}

function ReadinessRow({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" }) {
  return (
    <View style={styles.readinessRow}>
      <Text style={styles.readinessLabel}>{label}</Text>
      <Text style={[styles.readinessValue, tone === "ok" ? styles.readinessOk : styles.readinessWarn]}>{value}</Text>
    </View>
  );
}

function Header({ today, usingCache, onRefresh }: { today: MobileToday | null; usingCache: boolean; onRefresh: () => void }) {
  const subtitle = usingCache ? "离线缓存" : today?.date || todayKey();
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.kicker}>今天先做</Text>
        <Text style={styles.title}>待办优先</Text>
        <Text style={styles.subtle}>{subtitle} · 更新 {shortTime(today?.updatedAt)}</Text>
      </View>
      <IconButton label="刷新" onPress={onRefresh} />
    </View>
  );
}

function StatusPanel({ tone, today, usingCache }: { tone: string; today: MobileToday | null; usingCache: boolean }) {
  const style = tone === "ok" ? styles.statusOk : tone === "warn" ? styles.statusWarn : styles.statusCritical;
  return (
    <View style={[styles.statusPanel, style]}>
      <View style={styles.panelHeader}>
        <Text style={styles.statusTitle}>{today?.status.summary || "正在连接 Mac 工作台"}</Text>
        <Text style={styles.statusPill}>{usingCache ? "离线缓存" : labelStatus(today?.status.gateway)}</Text>
      </View>
      <View style={styles.sourceGrid}>
        {today ? Object.entries(today.source).map(([key, value]) => (
          <View key={key} style={styles.sourceCell}>
            <Text style={styles.sourceKey}>{labelSource(key)}</Text>
            <Text style={styles.sourceValue}>{labelSource(value.source)}</Text>
            <Text style={styles.sourceMeta}>{staleText(value.staleSeconds)}</Text>
          </View>
        )) : null}
      </View>
    </View>
  );
}

function AgendaPanel({ today }: { today: MobileToday | null }) {
  const events = today?.events || [];
  const todos = today?.todos || [];
  const planItems = today?.planItems || [];
  const visibleRows = [
    ...events.slice(0, 3).map((row) => ({ ...row, lane: "日程" })),
    ...todos.slice(0, 12).map((row) => ({ ...row, lane: "待办" })),
    ...planItems.slice(0, 3).map((row) => ({ ...row, lane: "计划" })),
  ];
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>完整待办与日程</Text>
        <Text style={styles.panelMeta}>{events.length} 日程 · {todos.length} 待办 · {planItems.length} 计划</Text>
      </View>
      <View style={styles.agendaStats}>
        <AgendaStat label="日程" value={events.length} />
        <AgendaStat label="待办" value={todos.length} />
        <AgendaStat label="计划" value={planItems.length} />
      </View>
      {visibleRows.length ? visibleRows.map((row, index) => (
        <AgendaRow key={`${row.lane}-${row.id || index}`} row={row} />
      )) : (
        <Text style={styles.emptyText}>今天没有来自日程、待办或计划的可执行项；若桌面端有数据，请下拉刷新。</Text>
      )}
    </View>
  );
}

function AssistantContextPanel({ today }: { today: MobileToday | null }) {
  const events = today?.events || [];
  const todos = today?.todos || [];
  const actions = today?.nextActions || [];
  return (
    <View style={styles.contextPanel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>今日上下文</Text>
        <Text style={styles.panelMeta}>发送前自动带入判断线索</Text>
      </View>
      <View style={styles.contextGrid}>
        <ContextCell label="下一步" value={actions[0]?.title || "暂无明确行动"} />
        <ContextCell label="日程" value={events[0]?.title || `${events.length} 条`} />
        <ContextCell label="待办" value={todos[0]?.title || `${todos.length} 条`} />
      </View>
    </View>
  );
}

function AgendaStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.agendaStat}>
      <Text style={styles.agendaStatValue}>{value}</Text>
      <Text style={styles.agendaStatLabel}>{label}</Text>
    </View>
  );
}

function ContextCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.contextCell}>
      <Text style={styles.agendaStatLabel}>{label}</Text>
      <Text style={styles.contextValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function AgendaRow({ row }: { row: MobileTodayAgendaItem & { lane: string } }) {
  const time = row.start_at || row.due_at || row.updated_at;
  return (
    <View style={styles.agendaRow}>
      <View style={styles.agendaLane}>
        <Text style={styles.agendaLaneText}>{row.lane}</Text>
      </View>
      <View style={styles.itemMain}>
        <Text style={styles.itemTitle} numberOfLines={2}>{row.title || "未命名事项"}</Text>
        <Text style={styles.itemMeta}>{labelStatus(row.status || "open")} · {shortTime(time)} · {labelSource(row.source || row.lane)}</Text>
      </View>
    </View>
  );
}

function PendingNoteRow({ note, syncing, onRetry, onDiscard }: { note: MobilePendingNote; syncing: boolean; onRetry: () => void; onDiscard: () => void }) {
  const statusText = syncing ? "同步中" : describePendingStatus(note);
  const tone = syncing || note.status === "syncing" ? "info" : note.status === "failed" ? "danger" : "warn";
  const toneStyle = tone === "info" ? styles.pendingInfo : tone === "danger" ? styles.pendingDanger : styles.pendingWarn;
  return (
    <View style={styles.pendingCard}>
      <View style={styles.pendingHeader}>
        <Text style={[Type.bodySm, { color: Color.ink, fontWeight: "900" }]} numberOfLines={1}>{note.title || "未命名笔记"}</Text>
        <Text style={[Type.micro, { color: Color.inkFaint }]}>{shortTime(note.updatedAt)}</Text>
      </View>
      {(note.body || note.transcript) ? (
        <Text style={[Type.caption, { color: Color.inkMuted, marginTop: 2 }]} numberOfLines={3}>{note.body || note.transcript}</Text>
      ) : null}
      <View style={[styles.pendingStatus, toneStyle]}>
        <Text style={[Type.caption, { color: Color.ink, fontWeight: "800" }]}>{statusText}</Text>
      </View>
      <View style={styles.pendingActions}>
        <SmallButton label="重试" tone="ok" disabled={syncing} onPress={onRetry} />
        <SmallButton label="丢弃" tone="danger" disabled={syncing} onPress={onDiscard} />
      </View>
    </View>
  );
}

function ActionList({ actions }: { actions: MobileAction[] }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>下一步行动</Text>
        <Text style={styles.panelMeta}>{actions.length} 项</Text>
      </View>
      {actions.length ? actions.map((action) => (
        <View key={action.id} style={styles.listItem}>
          <Text style={[styles.priority, priorityStyle(action.priority)]}>{action.priority || "P2"}</Text>
          <View style={styles.itemMain}>
            <Text style={styles.itemTitle}>{action.title}</Text>
            <Text style={styles.itemText}>{action.summary}</Text>
            <Text style={styles.itemMeta}>{labelSource(action.source)} · {shortTime(action.createdAt)}</Text>
          </View>
          <Text style={styles.actionLabel}>{labelAction(action.actionLabel)}</Text>
        </View>
      )) : (
        <Text style={styles.emptyText}>暂无明确下一步。若网关或日程源不可用，此处会保持空态而不是生成假任务。</Text>
      )}
    </View>
  );
}

function AgentStrip({ agents: rows }: { agents: MobileAgent[] }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>智能体状态</Text>
        <Text style={styles.panelMeta}>主智能体 / 老板视角 / 执行智能体</Text>
      </View>
      <View style={styles.agentGrid}>
        {rows.slice(0, 3).map((agent) => (
          <View key={agent.id} style={styles.agentCard}>
            <Text style={styles.agentName}>{labelAgent(agent.id) || agent.name}</Text>
            <Text style={styles.agentStatus}>{labelStatus(agent.liveStatus)}</Text>
            <Text style={styles.agentWork} numberOfLines={3}>{agent.currentWork?.title || "无正在执行证据"}</Text>
            <Text style={styles.agentMeta}>{agent.activeCount} 项进行中 · {shortTime(agent.lastActivityAt)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Timeline({ rows }: { rows: MobileTimelineItem[] }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>今日时间线</Text>
        <Text style={styles.panelMeta}>{rows.length} 条</Text>
      </View>
      {rows.slice(0, 12).map((row, index) => (
        <View key={`${row.kind}-${row.id || index}`} style={styles.timelineItem}>
          <Text style={styles.timelineTime}>{shortTime(row.time)}</Text>
          <View style={styles.timelineDot} />
          <View style={styles.itemMain}>
            <Text style={styles.itemTitle}>{row.title || row.kind}</Text>
            <Text style={styles.itemMeta}>{labelSource(row.kind)} · {labelStatus(row.status || "open")} · {labelSource(row.source || "source")}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function ErrorBanner({ message, onRePair }: { message: string; onRePair?: () => void }) {
  const isUnauthorized = /unauthorized|设备令牌|token_revoked|invalid_login|login_required/i.test(message);
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
      {isUnauthorized && onRePair ? (
        <Pressable
          onPress={onRePair}
          accessibilityRole="button"
          accessibilityLabel="重新配对"
          testID="mobile-repair-button"
          style={({ pressed }) => [styles.repairButton, pressed && styles.repairButtonPressed]}
        >
          <Text style={styles.repairButtonText}>重新配对</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ReadOnlyBanner() {
  return (
    <View style={styles.readOnlyBanner}>
      <Text style={styles.readOnlyText}>当前显示离线缓存。Mac 是唯一真相源，恢复连接前不能发送、审批或修改。</Text>
    </View>
  );
}

function PrimaryButton({
  label,
  icon,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  icon: string;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[styles.primaryButton, disabled && styles.disabledButton]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.primaryIcon}>{icon}</Text>
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function SmallButton({ label, tone, disabled, onPress }: { label: string; tone: "ok" | "danger"; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[styles.smallButton, tone === "ok" ? styles.smallOk : styles.smallDanger, disabled && styles.disabledButton]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.smallButtonText, tone === "danger" && styles.smallDangerText]}>{label}</Text>
    </Pressable>
  );
}

function IconButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={styles.iconButton} onPress={onPress} accessibilityLabel="刷新">
      <Text style={styles.iconButtonText}>{label}</Text>
    </Pressable>
  );
}

function shortTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(seconds: number | null | undefined) {
  const safe = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function priorityStyle(priority: string) {
  const p = priority.toUpperCase();
  return p === "P0" ? styles.p0 : p === "P1" ? styles.p1 : styles.p2;
}

const styles = StyleSheet.create({
  // 容器
  shell: { flex: 1, backgroundColor: Color.surfaceSubtle },
  // 紧凑首屏:更小 padding + 紧密 gap,腾出 390x844 视口空间
  scrollContent: { padding: Space.md, paddingTop: Space.sm, paddingBottom: 140, gap: Space.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: Space.md, padding: Space.xl },

  // 配对屏
  pairing: { flexGrow: 1, justifyContent: "flex-start", padding: Space.xl, paddingTop: Space.lg, paddingBottom: 140, gap: Space.md },
  productStamp: { borderWidth: 1, borderColor: Color.primarySoft, backgroundColor: Color.primarySofter, borderRadius: Radius.md, paddingHorizontal: Space.md, paddingVertical: Space.sm, gap: 2 },
  productStampText: { ...Type.body, color: Color.primary, fontWeight: "900" },
  productStampMeta: { ...Type.caption, color: Color.inkMuted },
  pairingHero: { gap: Space.sm },
  heroBrandRow: { flexDirection: "row", alignItems: "center", gap: Space.md },
  readinessPanel: { backgroundColor: Color.surface, borderWidth: 1, borderColor: Color.infoBorder, borderRadius: Radius.md, paddingHorizontal: Space.md, paddingVertical: 6 },
  readinessRow: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Color.infoBg },
  readinessLabel: { ...Type.bodySm, color: Color.inkMuted, fontWeight: "800" },
  readinessValue: { flexShrink: 1, textAlign: "right", ...Type.bodySm, fontWeight: "900" },
  readinessOk: { color: Color.okInk },
  readinessWarn: { color: Color.warnInk },
  setupGrid: { gap: Space.sm },
  quickGrid: { flexDirection: "row", gap: Space.md },
  pairingQuickServers: { gap: Space.sm, marginTop: Space.sm },
  pairingQuickServerButton: {
    borderWidth: 1,
    borderColor: Color.border,
    backgroundColor: Color.surfaceMuted,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  pairingQuickServerButtonActive: { borderColor: Color.primary, backgroundColor: Color.primarySofter },
  pairingQuickServerLabel: { ...Type.captionBold, color: Color.ink },
  pairingQuickServerLabelActive: { color: Color.primary },
  pairingQuickServerValue: { ...Type.micro, color: Color.inkFaint, marginTop: 2 },
  pairingQuickServerValueActive: { color: Color.primary },
  helpCard: { flex: 1, minHeight: 84, borderWidth: 1, borderColor: Color.border, backgroundColor: Color.surface, borderRadius: Radius.md, padding: Space.md, gap: 2 },
  helpTitle: { ...Type.bodySm, color: Color.ink, fontWeight: "900" },
  helpText: { ...Type.caption, color: Color.inkFaint },
  setupCard: { flexDirection: "row", alignItems: "flex-start", gap: Space.md, backgroundColor: Color.surface, borderWidth: 1, borderColor: Color.border, borderRadius: Radius.md, padding: Space.md },
  setupBody: { flex: 1, gap: 2 },
  setupIndex: { width: 26, height: 26, borderRadius: Radius.xs, overflow: "hidden", textAlign: "center", paddingTop: 4, backgroundColor: Color.okSoft, color: Color.okInk, fontWeight: "900" },
  setupTitle: { ...Type.bodySm, color: Color.ink, fontWeight: "900" },
  setupText: { flex: 1, ...Type.caption, color: Color.inkFaint },
  formPanel: { backgroundColor: Color.surface, borderWidth: 1, borderColor: Color.border, borderRadius: Radius.md, padding: Space.md, gap: Space.sm },
  formHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Space.md, marginBottom: 2 },
  fieldLabel: { ...Type.bodySm, color: Color.inkMuted, fontWeight: "900" },
  // R17: QR 扫码入口(配对屏)
  qrScanActionsRow: { flexDirection: "row", gap: Space.sm, marginTop: Space.xs },
  qrScanSecondaryBtn: {
    flex: 1,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.border,
    backgroundColor: Color.surfaceMuted,
    alignItems: "center",
  },
  qrScanSecondaryText: { ...Type.captionBold, color: Color.ink },

  // Header
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: Space.md },
  kicker: { ...Type.microBold, color: Color.primary, letterSpacing: 0.4 },
  title: { ...Type.displaySm, color: Color.ink },
  subtle: { ...Type.bodySm, color: Color.inkFaint, marginTop: 4 },

  // Sync banner
  syncBanner: { flexDirection: "row", alignItems: "center", gap: Space.md, padding: Space.md, borderRadius: Radius.md, borderWidth: 1 },
  // 紧凑单行同步条 — 首屏只占 1 行
  syncBannerCompact: { flexDirection: "row", alignItems: "center", gap: Space.sm, paddingHorizontal: Space.md, paddingVertical: Space.xs, borderRadius: Radius.md, borderWidth: 1 },
  syncOk: { backgroundColor: Color.okSoft, borderColor: Color.okBorder },
  syncWarn: { backgroundColor: Color.warnSoft, borderColor: Color.warnBorder },
  syncDanger: { backgroundColor: Color.dangerSoft, borderColor: Color.dangerBorder },

  // 通用
  helperText: { ...Type.caption, color: Color.inkFaint },
  body: { ...Type.bodyLg, color: Color.inkMuted },
  input: { minHeight: Size.inputMd, borderWidth: 1, borderColor: Color.border, backgroundColor: Color.surface, color: Color.ink, borderRadius: Radius.md, paddingHorizontal: Space.md, paddingVertical: Space.sm, ...Type.bodyLg },
  codeInput: { ...Type.monoLg, letterSpacing: 0, textAlign: "center" },
  chatInput: { minHeight: 96, textAlignVertical: "top" },
  voiceInput: { minHeight: 140, textAlignVertical: "top" },
  quickInput: { minHeight: 60, textAlignVertical: "top" },
  buttonRow: { flexDirection: "row", gap: Space.sm, alignItems: "center" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Color.border, marginVertical: Space.sm },
  openScheduleButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: Radius.md, borderWidth: 1, borderColor: Color.primary, backgroundColor: Color.primarySofter, paddingHorizontal: Space.lg },
  openScheduleButtonPressed: { backgroundColor: Color.primarySoft },
  alertRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: Radius.sm, backgroundColor: Color.warnSoft, borderWidth: 1, borderColor: Color.warnBorder },
  alertLabel: { ...Type.bodySm, color: Color.warnInk, fontWeight: "900" },
  alertValue: { ...Type.bodySm, color: Color.ink, fontWeight: "800" },
  continueButton: { marginTop: Space.sm, paddingVertical: Space.sm, paddingHorizontal: Space.md, borderRadius: Radius.md, borderWidth: 1, borderColor: Color.primarySoft, backgroundColor: Color.primarySofter, alignItems: "center" },
  continueButtonPressed: { backgroundColor: Color.primarySoft },
  manualFallbackBox: { borderRadius: Radius.md, borderWidth: 1, borderColor: Color.warnBorder, backgroundColor: Color.warnSoft, padding: Space.md, gap: 2 },

  // Knowledge preview
  knowledgeRow: { flexDirection: "row", alignItems: "center", gap: Space.md, paddingVertical: Space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Color.borderSoft },
  knowledgeRowPressed: { backgroundColor: Color.surfaceMuted },

  // Pending notes
  pendingCard: { borderWidth: 1, borderColor: Color.warnBorder, backgroundColor: Color.warnSoft, borderRadius: Radius.md, padding: Space.md, gap: 4, marginTop: Space.sm },
  pendingHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Space.md },
  pendingStatus: { paddingHorizontal: Space.sm, paddingVertical: 4, borderRadius: Radius.sm, marginTop: 4 },
  pendingInfo: { backgroundColor: Color.infoSoft, borderWidth: 1, borderColor: Color.infoBorder },
  pendingWarn: { backgroundColor: Color.warnBg, borderWidth: 1, borderColor: Color.warnBorder },
  pendingDanger: { backgroundColor: Color.dangerSoft, borderWidth: 1, borderColor: Color.dangerBorder },
  pendingActions: { flexDirection: "row", gap: Space.sm, alignItems: "center", marginTop: Space.sm },

  // Console toggle
  consoleToggleRow: { flexDirection: "row", justifyContent: "center", marginTop: Space.sm },
  consoleToggle: { paddingHorizontal: Space.lg, paddingVertical: Space.sm, borderRadius: Radius.pill, backgroundColor: Color.primarySofter, borderWidth: 1, borderColor: Color.primarySoft },
  consoleTogglePressed: { backgroundColor: Color.primarySoft },

  // Segmented
  segmented: { flexDirection: "row", gap: 6, backgroundColor: Color.surfaceMuted, padding: 4, borderRadius: Radius.md },
  segment: { flex: 1, minHeight: 40, borderRadius: Radius.sm, alignItems: "center", justifyContent: "center" },
  segmentActive: { backgroundColor: Color.surface, ...Shadow.sm },
  segmentText: { ...Type.bodySm, color: Color.inkFaint, fontWeight: "700" },
  segmentTextActive: { color: Color.ink, fontWeight: "800" },

  // Sections
  sectionStack: { gap: Space.md },
  panel: { backgroundColor: Color.surface, borderWidth: 1, borderColor: Color.border, borderRadius: Radius.lg, padding: Space.lg, gap: Space.md, ...Shadow.sm },
  // 紧凑面板 — 首屏优先,没有大块统计/grid,适合 390x844 视口
  summaryCardRow: {
    flexDirection: "row",
    gap: Space.sm,
    marginBottom: Space.lg,
  },
  quickActionsCard: {
    flexDirection: "row",
    gap: Space.md,
    marginBottom: Space.lg,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: Color.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.border,
    padding: Space.md,
    minHeight: 96,
  },
  summaryCardTodo: { borderLeftWidth: 3, borderLeftColor: Color.primary },
  summaryCardVoice: { borderLeftWidth: 3, borderLeftColor: Color.dangerInk },
  transcriptInput: { ...Type.body, color: Color.ink, backgroundColor: Color.surfaceMuted, borderRadius: Radius.md, paddingHorizontal: Space.md, paddingVertical: Space.md, minHeight: 100, textAlignVertical: "top", marginBottom: Space.sm },
  summaryCardTimeline: { borderLeftWidth: 3, borderLeftColor: Color.warnInk },
  summaryCardHeader: { flexDirection: "row", alignItems: "center", marginBottom: Space.xs },
  summaryCardGlyph: { fontSize: 20, marginRight: Space.xs, color: Color.primary },
  summaryCardLabel: { ...Type.body, color: Color.ink, fontWeight: "900" },
  summaryCardCount: { ...Type.h2, color: Color.ink, fontWeight: "900", marginVertical: 2 },
  summaryCardHint: { ...Type.caption, color: Color.inkMuted },

  quickAction: {
    flex: 1,
    backgroundColor: Color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Color.border,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    minHeight: 92,
    justifyContent: "center",
  },
  quickActionPrimary: {
    backgroundColor: Color.primary,
    borderColor: Color.primary,
  },
  quickActionPressed: { opacity: 0.7 },
  quickActionGlyph: { fontSize: 28, lineHeight: 32, color: Color.surface, marginBottom: 4 },
  quickActionLabel: { ...Type.body, color: Color.surface, fontWeight: "900" },
  quickActionHint: { ...Type.caption, color: "#A7F3D0", marginTop: 4 },

  panelCompact: { backgroundColor: Color.surface, borderWidth: 1, borderColor: Color.border, borderRadius: Radius.lg, padding: Space.md, gap: Space.sm, ...Shadow.sm },
  agendaCompactList: { gap: 2 },
  openScheduleButtonCompact: { flexDirection: "row", alignItems: "center", justifyContent: "center", minHeight: 40, borderRadius: Radius.md, borderWidth: 1, borderColor: Color.primary, backgroundColor: Color.primarySofter, paddingHorizontal: Space.md, marginTop: 2 },
  voiceToggle: { marginTop: 2, paddingVertical: Space.sm, paddingHorizontal: Space.md, borderRadius: Radius.md, borderWidth: 1, borderColor: Color.borderSoft, backgroundColor: Color.surfaceMuted, alignItems: "center" },
  voiceTogglePressed: { backgroundColor: Color.primarySofter },
  voiceExpanded: { gap: Space.sm, marginTop: 2 },
  panelHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Space.md },
  panelTitle: { ...Type.h2, color: Color.ink },
  panelMeta: { ...Type.caption, color: Color.inkFaint },

  // Status
  statusPanel: { borderRadius: Radius.md, padding: Space.lg, borderWidth: 1, gap: Space.md },
  statusOk: { backgroundColor: Color.okSoft, borderColor: Color.okBorder },
  statusWarn: { backgroundColor: Color.warnSoft, borderColor: Color.warnBorder },
  statusCritical: { backgroundColor: Color.dangerSoft, borderColor: Color.dangerBorder },
  statusTitle: { flex: 1, ...Type.h3, color: Color.ink },
  statusPill: { color: Color.primary, backgroundColor: Color.surface, borderRadius: Radius.pill, paddingHorizontal: Space.md, paddingVertical: 4, ...Type.microBold, overflow: "hidden" },

  // Source grid
  sourceGrid: { flexDirection: "row", flexWrap: "wrap", gap: Space.sm },
  sourceCell: { flexBasis: "31%", flexGrow: 1, backgroundColor: "rgba(255,255,255,0.72)", borderRadius: Radius.md, padding: Space.md, gap: 2 },
  sourceKey: { ...Type.microBold, color: Color.ink },
  sourceValue: { ...Type.micro, color: Color.inkMuted },
  sourceMeta: { ...Type.micro, color: Color.inkFaint },

  // Agenda/context
  agendaStats: { flexDirection: "row", gap: Space.sm },
  agendaStat: { flex: 1, minHeight: 58, borderRadius: Radius.md, backgroundColor: Color.surfaceMuted, borderWidth: 1, borderColor: Color.borderSoft, alignItems: "center", justifyContent: "center", gap: 2 },
  agendaStatValue: { ...Type.h2, color: Color.ink },
  agendaStatLabel: { ...Type.microBold, color: Color.inkFaint },
  agendaRow: { flexDirection: "row", alignItems: "flex-start", gap: Space.md, paddingVertical: Space.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Color.borderSoft },
  agendaLane: { minWidth: 42, borderRadius: Radius.sm, backgroundColor: Color.primarySofter, borderWidth: 1, borderColor: Color.primarySoft, alignItems: "center", paddingVertical: 5, paddingHorizontal: 6 },
  agendaLaneText: { ...Type.microBold, color: Color.primary },
  contextPanel: { backgroundColor: Color.infoSoft, borderWidth: 1, borderColor: Color.infoBorder, borderRadius: Radius.md, padding: Space.md, gap: Space.md },
  contextGrid: { flexDirection: "row", flexWrap: "wrap", gap: Space.sm },
  contextCell: { flexBasis: "31%", flexGrow: 1, minHeight: 70, borderRadius: Radius.md, backgroundColor: Color.surface, padding: Space.md, gap: 2 },
  contextValue: { ...Type.bodySm, color: Color.ink, fontWeight: "800" },

  // List
  listItem: { flexDirection: "row", alignItems: "flex-start", gap: Space.md, paddingVertical: Space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Color.borderSoft },
  priority: { width: 38, height: 30, borderRadius: Radius.sm, textAlign: "center", textAlignVertical: "center", overflow: "hidden", ...Type.microBold, paddingTop: 7 },
  p0: { color: Color.dangerInk, backgroundColor: Color.dangerBg },
  p1: { color: Color.warnInk, backgroundColor: Color.warnBg },
  p2: { color: Color.infoInk, backgroundColor: Color.infoBg },
  itemMain: { flex: 1, gap: 4 },
  itemTitle: { ...Type.h3, color: Color.ink },
  itemText: { ...Type.bodySm, color: Color.inkMuted },
  itemActions: { flexDirection: 'row', gap: Space.sm, marginTop: Space.sm, flexWrap: 'wrap' },
  itemActionBtn: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.primary,
    backgroundColor: Color.surface,
  },
  itemActionBtnPrimary: {
    backgroundColor: Color.primary,
    borderColor: Color.primary,
  },
  itemActionText: {
    color: Color.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  voiceWorkbenchShell: { flex: 1, backgroundColor: Color.surfaceSubtle },
  // 2026-07-03 — R7: voice workbench is now an inline section on the home page
  // (was a fullscreen Modal). The wrapper gives it a card-like background so
  // it visually separates from the other home sections while still allowing
  // the rest of the home content to remain visible / scrollable.
  voiceWorkbenchInline: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Color.primarySoft,
    backgroundColor: Color.surface,
    marginBottom: Space.md,
    overflow: "hidden",
    ...Shadow.md,
  },
  voiceRecoveryBanner: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Color.warnBorder,
    backgroundColor: Color.warnSoft,
    padding: Space.md,
    marginBottom: Space.md,
    gap: Space.sm,
  },
  voiceRecoveryBannerTitle: { ...Type.body, fontWeight: "900", color: Color.warnInk },
  voiceRecoveryBannerBody: { ...Type.bodySm, color: Color.ink, lineHeight: 20 },
  voiceRecoveryBannerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Space.sm,
    alignItems: "center",
    marginTop: Space.xs,
  },
  voiceWorkbenchBodyWrap: { maxHeight: 480 },
  voiceWorkbenchHeader: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Space.md,
    borderBottomWidth: 1,
    borderBottomColor: Color.border,
    backgroundColor: Color.surface,
    gap: Space.sm,
  },
  voiceWorkbenchHeaderButton: {
    minWidth: 64,
    minHeight: 40,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Color.surfaceMuted,
    paddingHorizontal: Space.sm,
  },
  voiceWorkbenchHeaderButtonText: { ...Type.captionBold, color: Color.primary },
  voiceWorkbenchKicker: { ...Type.microBold, color: Color.primary },
  voiceWorkbenchHeaderTitle: { ...Type.h3, color: Color.ink, fontWeight: "900" },
  voiceWorkbenchBody: { padding: Space.md, paddingBottom: Space.md, gap: Space.md },
  voiceHeroCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Color.primarySoft,
    backgroundColor: Color.primarySofter,
    padding: Space.lg,
    gap: Space.xs,
  },
  voiceHeroLabel: { ...Type.bodySm, color: Color.primary, fontWeight: "900" },
  voiceHeroTime: { ...Type.displaySm, color: Color.ink, fontVariant: ["tabular-nums"] },
  voiceHeroMeta: { ...Type.bodySm, color: Color.inkMuted },
  // 2026-07-04 R9B: realtime/near-realtime transcript status row.
  // Slim pill with a pulsing dot, sits directly under the voice hero card so
  // the user always knows the polling loop is running (or, on idle, what to
  // expect). Uses the same okInk colour family so it reads as a live signal
  // rather than a warning.
  voiceRealtimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.okBorder,
    backgroundColor: Color.okSoft,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  voiceRealtimeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Color.recording,
  },
  voiceRealtimeRowText: {
    ...Type.caption,
    color: Color.okInk,
    fontWeight: "800",
    flexShrink: 1,
  },
  voiceWorkbenchPanel: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Color.border,
    backgroundColor: Color.surface,
    padding: Space.md,
    gap: Space.md,
    ...Shadow.sm,
  },
  voiceWorkbenchTranscript: {
    ...Type.body,
    color: Color.ink,
    backgroundColor: Color.surfaceMuted,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.borderSoft,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
    minHeight: 220,
    textAlignVertical: "top",
  },
  voiceWorkbenchActionRow: { flexDirection: "row", flexWrap: "wrap", gap: Space.sm, alignItems: "center" },
  voiceWorkbenchError: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.warnBorder,
    backgroundColor: Color.warnSoft,
    padding: Space.md,
  },
  voiceWorkbenchErrorText: { ...Type.bodySm, color: Color.warnInk, fontWeight: "800" },
  voicePreviewTabs: {
    flexDirection: "row",
    gap: Space.xs,
    padding: 4,
    borderRadius: Radius.md,
    backgroundColor: Color.surfaceMuted,
  },
  voicePreviewTab: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: Radius.sm },
  voicePreviewTabActive: { backgroundColor: Color.surface, ...Shadow.sm },
  voicePreviewTabText: { ...Type.captionBold, color: Color.inkFaint },
  voicePreviewTabTextActive: { color: Color.primary },
  voicePreviewBox: {
    maxHeight: 260,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.borderSoft,
    backgroundColor: Color.surfaceMuted,
    padding: Space.md,
  },
  voicePreviewText: { ...Type.bodySm, color: Color.ink, lineHeight: 22, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: undefined }) },
  voiceWorkbenchMini: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 86,
    minHeight: 58,
    borderRadius: Radius.lg,
    backgroundColor: Color.ink,
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    ...Shadow.lg,
  },
  // 2026-07-02 — provider 可用性前置提示条(避免把后台转写误导成实时 ASR)
  voicePreflightReady: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.okBorder,
    backgroundColor: Color.okSoft,
    padding: Space.md,
    gap: 4,
  },
  voicePreflightWarn: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.warnBorder,
    backgroundColor: Color.warnSoft,
    padding: Space.md,
    gap: 4,
  },
  voicePreflightReadyTitle: { ...Type.bodySm, color: Color.okInk, fontWeight: "900" },
  voicePreflightWarnTitle: { ...Type.bodySm, color: Color.warnInk, fontWeight: "900" },
  voicePreflightBody: { ...Type.bodySm, color: Color.inkMuted, lineHeight: 20 },
  // 粘底安全退出栏:键盘弹起也能点到
  voiceWorkbenchFooter: {
    flexDirection: "row",
    gap: Space.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderTopWidth: 1,
    borderTopColor: Color.border,
    backgroundColor: Color.surface,
    ...Shadow.sm,
  },
  voiceWorkbenchFooterBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Space.md,
  },
  voiceWorkbenchFooterGhost: {
    borderWidth: 1,
    borderColor: Color.primary,
    backgroundColor: Color.surface,
  },
  voiceWorkbenchFooterGhostText: { ...Type.bodySm, color: Color.primary, fontWeight: "800" },
  voiceWorkbenchFooterDanger: {
    backgroundColor: Color.dangerBg,
    borderWidth: 1,
    borderColor: Color.dangerBorder,
  },
  voiceWorkbenchFooterDangerText: { ...Type.bodySm, color: Color.dangerInk, fontWeight: "900" },
  voiceWorkbenchMiniDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Color.recording },
  voiceWorkbenchMiniTitle: { ...Type.bodySm, color: Color.surface, fontWeight: "900" },
  voiceWorkbenchMiniMeta: { ...Type.caption, color: "rgba(255,255,255,0.72)" },
  voiceWorkbenchMiniAction: { ...Type.captionBold, color: Color.primarySoft },
  voiceModalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Space.lg,
  },
  voiceModalCard: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '80%',
    backgroundColor: Color.surface,
    borderRadius: Radius.lg,
    padding: Space.lg,
    ...Shadow.lg,
  },
  voiceModalTitle: { ...Type.h2, color: Color.ink, fontWeight: '900' },
  voiceModalMeta: { ...Type.bodySm, color: Color.inkFaint, marginTop: Space.xs },
  voiceModalBody: { marginTop: Space.md, maxHeight: 320 },
  voiceModalTranscript: { ...Type.body, color: Color.ink, lineHeight: 22 },
  voiceModalPath: { ...Type.micro, color: Color.inkFaint, marginTop: Space.xs },
  voiceModalClose: {
    marginTop: Space.md,
    alignSelf: 'flex-end',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    backgroundColor: Color.primary,
    borderRadius: Radius.md,
  },
  voiceModalCloseText: { color: Color.onPrimary, fontWeight: '700' },
  itemMeta: { ...Type.caption, color: Color.inkFaint },
  actionLabel: { ...Type.microBold, color: Color.primary },

  // Agent
  agentGrid: { flexDirection: "row", gap: Space.md },
  agentCard: { flex: 1, minHeight: 124, borderWidth: 1, borderColor: Color.border, borderRadius: Radius.md, padding: Space.md, gap: 4, backgroundColor: Color.surfaceMuted },
  agentName: { ...Type.h3, color: Color.ink },
  agentStatus: { ...Type.microBold, color: Color.primary },
  agentWork: { ...Type.caption, color: Color.inkMuted, minHeight: 54 },
  agentMeta: { ...Type.micro, color: Color.inkFaint },

  // Timeline
  timelineItem: { flexDirection: "row", alignItems: "flex-start", gap: Space.md, paddingVertical: Space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Color.borderSoft },
  timelineTime: { width: 56, ...Type.caption, color: Color.inkFaint },
  timelineDot: { width: 10, height: 10, marginTop: 6, borderRadius: Radius.pill, backgroundColor: Color.primary },

  // Agent switch
  agentSwitch: { flexDirection: "row", gap: Space.sm },
  agentButton: { flex: 1, borderWidth: 1, borderColor: Color.border, borderRadius: Radius.md, minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: Color.surface },
  agentButtonActive: { borderColor: Color.primary, backgroundColor: Color.primarySofter },
  agentButtonText: { ...Type.bodySm, color: Color.inkFaint, fontWeight: "900" },
  agentButtonTextActive: { color: Color.primary },

  // Chat
  chatBox: { minHeight: 200, gap: Space.md },
  voiceChatPanel: { borderWidth: 1, borderColor: Color.infoBorder, backgroundColor: Color.infoSoft, borderRadius: Radius.md, padding: Space.md, gap: Space.md },
  message: { maxWidth: "92%", borderRadius: Radius.lg, padding: Space.md, gap: 4 },
  userMessage: { alignSelf: "flex-end", backgroundColor: Color.primary },
  assistantMessage: { alignSelf: "flex-start", backgroundColor: Color.surfaceMuted, borderWidth: 1, borderColor: Color.border },
  messageRole: { ...Type.microBold, color: Color.onDarkMuted },
  messageText: { ...Type.body, color: Color.ink, lineHeight: 22 },
  messageStatus: { ...Type.micro, color: Color.inkFaint },

  // Buttons
  rowActions: { gap: Space.sm, alignItems: "flex-end" },
  primaryButton: { minHeight: Size.buttonLg, borderRadius: Radius.md, backgroundColor: Color.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Space.sm, ...Shadow.sm },
  primaryIcon: { ...Type.h3, color: Color.onPrimary, fontWeight: "900" },
  primaryText: { ...Type.h3, color: Color.onPrimary, fontWeight: "900" },
  disabledButton: { opacity: 0.45 },
  smallButton: { minWidth: 60, minHeight: 36, borderRadius: Radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: Space.md },
  smallOk: { backgroundColor: Color.primary },
  smallDanger: { backgroundColor: Color.dangerBg, borderWidth: 1, borderColor: Color.dangerBorder },
  smallButtonText: { ...Type.microBold, color: Color.onPrimary },
  smallDangerText: { color: Color.dangerInk },
  iconButton: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Color.surface, borderWidth: 1, borderColor: Color.border, alignItems: "center", justifyContent: "center" },
  iconButtonText: { ...Type.microBold, color: Color.primary },

  // Banners
  errorBanner: { borderRadius: Radius.md, borderWidth: 1, borderColor: Color.dangerBorder, backgroundColor: Color.dangerSoft, padding: Space.md },
  repairButton: { alignSelf: "flex-start", marginTop: Space.sm, backgroundColor: Color.dangerInk, paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: Radius.md },
  repairButtonPressed: { backgroundColor: "#8B1A12" },
  repairButtonText: { ...Type.bodySm, color: "#FFFFFF", fontWeight: "700" },
  readOnlyBanner: { borderRadius: Radius.md, borderWidth: 1, borderColor: Color.warnBorder, backgroundColor: Color.warnSoft, padding: Space.md },
  readOnlyText: { ...Type.bodySm, color: Color.warnInk, fontWeight: "700" },

  // Recorder
  recorderTray: { borderRadius: Radius.md, backgroundColor: Color.surfaceMuted, padding: Space.lg, gap: Space.md },
  recorderHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Space.md },
  recorderStatus: { flex: 1, gap: 4 },
  recorderLabel: { ...Type.bodySm, color: Color.inkMuted, fontWeight: "900" },
  recorderTime: { ...Type.monoLg, color: Color.ink },
  recordButton: { minWidth: 88, minHeight: 48, borderRadius: Radius.md, backgroundColor: Color.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: Space.lg, ...Shadow.sm },
  stopRecordButton: { backgroundColor: Color.recording, ...Shadow.sm },
  recordButtonText: { ...Type.bodyLg, color: Color.onPrimary, fontWeight: "900" },
  recorderMetaGrid: { flexDirection: "row", gap: Space.sm },
  recorderMetaCell: { flex: 1, minHeight: 60, borderRadius: Radius.md, backgroundColor: Color.surface, padding: Space.md, justifyContent: "center", gap: 2 },
  recorderMetaLabel: { ...Type.micro, color: Color.inkFaint, fontWeight: "800" },
  recorderMetaValue: { ...Type.bodySm, color: Color.ink, fontWeight: "900" },

  // Success / error / empty / notice
  successBanner: { borderRadius: Radius.md, borderWidth: 1, borderColor: Color.okBorder, backgroundColor: Color.okSoft, padding: Space.md, gap: 2 },
  successTitle: { ...Type.body, color: Color.okInk, fontWeight: "900" },
  successText: { ...Type.bodySm, color: Color.inkMuted },
  errorText: { ...Type.bodySm, color: Color.dangerInk },
  emptyText: { ...Type.bodySm, color: Color.inkFaint, textAlign: "center", paddingVertical: Space.lg },
  muted: { color: Color.inkFaint },
  notice: { borderWidth: 1, borderColor: Color.infoBorder, backgroundColor: Color.infoSoft, borderRadius: Radius.md, padding: Space.md, gap: 2 },
  noticeTitle: { ...Type.bodySm, color: Color.infoInk, fontWeight: "900" },
  noticeText: { ...Type.bodySm, color: Color.inkMuted },
});
