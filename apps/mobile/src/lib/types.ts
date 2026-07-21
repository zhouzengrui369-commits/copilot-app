export type MobileDevice = {
  id: string;
  name: string;
  platform: string;
  appVersion: string;
  status: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type MobileSession = {
  serverUrl: string;
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  device: MobileDevice;
};

export type PairingClaimResponse = {
  ok: true;
  device?: MobileDevice;
  accessToken: string;
  accessExpiresAt?: string;
  refreshToken: string;
  refreshExpiresAt?: string;
};

export type MobileStatus = {
  tone: "ok" | "warn" | "critical" | string;
  gateway: "ok" | "unavailable" | string;
  summary: string;
};

export type MobileSourceState = {
  source: string;
  updatedAt: string;
  staleSeconds: number | null;
};

export type MobileAction = {
  id: string;
  kind: string;
  priority: string;
  title: string;
  summary: string;
  actionLabel: string;
  target?: { type?: string; id?: string };
  source: string;
  createdAt: string;
};

export type MobileTimelineItem = {
  id?: string;
  kind: string;
  title?: string;
  time?: string;
  status?: string;
  priority?: string;
  source?: string;
};

export type MobileTodayAgendaItem = {
  id: string;
  title: string;
  status: string;
  priority: string;
  source: string;
  start_at: string;
  due_at: string;
  updated_at: string;
};

export type MobileVoiceNote = {
  id: string;
  deviceId: string | null;
  date: string;
  title: string;
  transcriptText: string;
  status: string;
  source: string;
  language: string;
  durationSeconds: number | null;
  audioPath?: string | null;
  audioMime?: string | null;
  audioBytes?: number | null;
  audioUri?: string | null;
  transcriptionProvider?: string | null;
  knowledgeEntryId: string | null;
  calendarNoteId: string | null;
  knowledgePath?: string | null;
  markdownPath?: string | null;
  htmlPath?: string | null;
  createdAt: string;
  updatedAt: string;
  organizedAt: string | null;
  error: string;
};

export type MobileVoiceNoteOrganizeResponse = {
  ok: true;
  voiceNote: MobileVoiceNote;
  knowledgeEntry: Record<string, unknown>;
  calendarNote: Record<string, unknown>;
  markdownPath: string;
  htmlPath: string;
};

export type MobileAgent = {
  id: string;
  name: string;
  role: string;
  visualStatus: string;
  liveStatus: string;
  gateway: string;
  activeCount: number;
  unreadInbox: number;
  progressPercent: number;
  lastActivityAt: string;
  currentWork: { title?: string; status?: string } | null;
};

export type Approval = {
  id: string;
  task_id?: string | null;
  action: string;
  status: string;
  requested_at?: string;
  details?: string;
};

export type MobileToday = {
  ok: true;
  date: string;
  updatedAt: string;
  status: MobileStatus;
  source: {
    calendar: MobileSourceState;
    agentOps: MobileSourceState;
    gateway: MobileSourceState;
  };
  gateway: Record<string, unknown>;
  sources: Record<string, unknown>;
  agentOps: MobileAgent[];
  nextActions: MobileAction[];
  timeline: MobileTimelineItem[];
  todos?: MobileTodayAgendaItem[];
  events?: MobileTodayAgendaItem[];
  planItems?: MobileTodayAgendaItem[];
  approvals: Approval[];
  blocked: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  reports: Array<Record<string, unknown>>;
  holidays?: Array<Record<string, unknown>>;
  inbox?: Record<string, unknown>;
  stats: Record<string, unknown>;
};

export type MobileBootstrap = {
  ok: true;
  user: { id: string; role: string };
  service: { name: string; workspace: string; updatedAt: string };
  mobile: {
    apiVersion: string;
    platform: string;
    packageName: string;
    iosBundleIdentifier: string;
    distribution: string;
    updateChannel: string;
    syncModel: string;
    minSupportedAppVersion: string;
    latestAppVersion: string;
    latestAndroidVersionCode: number;
    latestIosAppVersion: string;
    latestIosBuildNumber: string;
    testFlightTrack: string;
    buildSha: string;
    nativeUpdateRequired: boolean;
    nativeCapabilities?: {
      audioRecording?: boolean;
      microphonePermission?: boolean;
      automaticTranscription?: boolean;
      backgroundRecording?: boolean;
    };
    localUrl?: string;
    lanUrls?: string[];
    publicUrl?: string;
  };
  featureFlags: {
    todayExecution?: boolean;
    chat?: boolean;
    approvals?: boolean;
    knowledgePreview?: boolean;
    voiceNotes?: boolean;
    voiceRecording?: boolean;
    voiceAutoTranscription?: boolean;
    voiceTranscriptionProvider?: string;
    offlineReadCache?: boolean;
    highRiskApprovalGate?: boolean;
    [key: string]: boolean | string | undefined;
  };

  vault?: MobileBootstrapVault;
  gateway: Record<string, unknown>;
  sources: Record<string, unknown>;
  agentOps: MobileAgent[];
  inbox: Record<string, unknown>;
  stats: Record<string, unknown>;
};

export type MobileBootstrapVault = {
  vaultRoot: string;
  vaultLabel: string;
  vaultAvailable: boolean;
  vaultFallbackReason: string | null;
  // legacy fields — kept for the previous batch; can be removed after one release cycle
  root?: string;
  status?: "connected" | "unavailable";
  reason?: string | null;
  writable?: boolean;
  writeReason?: string | null;
  graphPath?: string | null;
  displayName?: string;
  preferredEntries?: string[];
  kbVaultDir?: string;
};

export type ChatSession = {
  id: string;
  title: string;
  agent_id?: string;
  model_id?: string;
};

export type ChatMessage = {
  id: string;
  session_id: string;
  role: "user" | "assistant" | string;
  agent_id?: string | null;
  content: string;
  status: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// 2026-06-19 — Mate60 mobile knowledge base (KB) types
//   KnowledgeScreen 浏览 / NoteEditorScreen 编辑,都走这些类型。
//   path 约定:服务端 / 开头表示 vault 根,客户端统一保留 "/" 作为根。
// ---------------------------------------------------------------------------

export type KbEntryKind = "directory" | "markdown" | "html" | "other";

export type KbEntry = {
  name: string;
  kind: KbEntryKind;
  size: number;
  path: string;
};

export type KbListResponse = {
  ok: true;
  path: string;
  parent: string | null;
  vaultRoot: string;
  readOnly?: boolean;
  vault?: MobileBootstrapVault;
  entries: KbEntry[];
  total: number;
};

export type KbReadKind = "markdown" | "html";

export type KbReadResponse = {
  ok: true;
  path: string;
  name: string;
  kind: KbReadKind;
  size: number;
  bytes: number;
  content: string;
};

export type KbWriteKind = "markdown" | "html";

export type KbCreateRequest = {
  kind: KbWriteKind;
  title?: string;
  content?: string;
};

export type KbCreateResponse = {
  ok: true;
  path: string;
  name: string;
  kind: KbWriteKind;
  size: number;
  bytes: number;
};

export type KbWriteRequest = {
  content: string;
};

export type KbWriteResponse = {
  ok: true;
  path: string;
  name: string;
  kind: KbWriteKind;
  bytes: number;
};

export type KbDeleteResponse = {
  ok: true;
  path: string;
  name: string;
  bytes: number;
};

export type MobileKnowledgeAtlasSource = {
  id: string;
  title: string;
  path: string;
  source: string;
  type: string;
  status: string;
  updatedAt: string;
  summary: string;
};

export type MobileKnowledgeAtlasCategory = {
  id: string;
  title: string;
  status: string;
  sourceCount: number;
  wikiCount: number;
  summary: string;
};

export type MobileKnowledgeAtlasGraphNode = {
  id: string;
  label: string;
  type: string;
  source: string;
};

export type MobileKnowledgeAtlasGraphEdge = {
  id?: string;
  from: string;
  to: string;
  relation: string;
};

export type MobileKnowledgeAtlasResponse = {
  ok: true;
  updatedAt: string;
  sources: Record<string, { status: string; root: string; reason: string }>;
  sourceStates: MobileKnowledgeAtlasSource[];
  categories: MobileKnowledgeAtlasCategory[];
  noteCategories: MobileKnowledgeAtlasCategory[];
  atlasSummary: {
    sourceCount: number;
    categoryCount: number;
    graphNodeCount: number;
    graphEdgeCount: number;
    connectedSources: string[];
    reviewCount: number;
    summary: string;
  };
  focusItems: Array<Record<string, unknown>>;
  graph: {
    nodes: MobileKnowledgeAtlasGraphNode[];
    edges: MobileKnowledgeAtlasGraphEdge[];
  };
  live?: Record<string, unknown>;
  wikiStatus?: Record<string, unknown>;
  vault?: MobileBootstrapVault;
};

// ---------------------------------------------------------------------------
// 2026-06-19 — Mate60 mobile calendar CRUD types
//   时间统一 24h "HH:MM",null 表示未填(全天/不显示)。
//   数据库存本地 date + start/end time,API 出 date+HH:MM。
// ---------------------------------------------------------------------------

export type MobileCalendarKind = "event" | "reminder" | "task";
export type MobileCalendarStatus = "active" | "completed" | "cancelled";

export type MobileCalendarEvent = {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  description: string;
  status: MobileCalendarStatus;
  kind: MobileCalendarKind;
  source: string;
  // 2026-06-26 R3 — 关联笔记路径, mobile UI 可 "打开笔记"
  knowledgePath: string | null;
  knowledgeHtmlPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MobileCalendarListResponse = {
  ok: true;
  date: string;
  events: MobileCalendarEvent[];
};

export type MobileCalendarRangeResponse = {
  ok: true;
  start: string;
  end: string;
  events: MobileCalendarEvent[];
};

export type MobileCalendarEventResponse = {
  ok: true;
  event: MobileCalendarEvent;
  // T2 (v3): synchronous njx-knowledge stub-write result (only when autoOrganize=true)
  markdownPath?: string;
  htmlPath?: string;
  knowledgePath?: string;
  htmlUrl?: string;
  organizedAt?: string;
  syncWrite?: boolean;
  syncWriteError?: string;
  organizeJob?: {
    id: string;
    status: string;
    phase?: string;
    progress?: number;
    title?: string;
    date?: string;
    folder?: string;
    sourceHash?: string;
    qualityMode?: string;
    message?: string;
    error?: string | null;
    markdownPath?: string;
    htmlPath?: string;
    knowledgePath?: string;
    createdAt?: string;
    updatedAt?: string;
    finishedAt?: string | null;
  };
  reused?: boolean;
  knowledgeNotePipelineVersion?: string;
};

export type MobileCalendarDeleteResponse = {
  ok: true;
  id: string;
};

export type MobileCalendarCreateRequest = {
  date: string;
  title: string;
  description?: string;
  startTime?: string | null;
  endTime?: string | null;
  kind?: MobileCalendarKind;
  rawContent?: string;
  autoOrganize?: boolean;
  qualityMode?: string;
  requestedQualityMode?: string;
  useNkxLanding?: boolean;
  nkxLandingRootMode?: "auto" | "nkx" | "legacy";
  nkxLandingSubdirOverride?: string;
  tags?: string[];
  related?: string[];
};

export type MobileCalendarUpdateRequest = {
  title?: string;
  description?: string;
  startTime?: string | null;
  endTime?: string | null;
  status?: MobileCalendarStatus;
};

// ---------------------------------------------------------------------------
// 2026-06-22 — Mobile priority UI: 本地待同步笔记 (offline pending queue)
//   当 Mac 不可达 / write 失败时,记录依然先入本地队列,绝不假报成功。
//   status:
//     "pending"  - 等待恢复网络后同步
//     "syncing"  - 正在重试
//     "failed"   - 同步失败,可由用户编辑或删除
//   source:
//     "text"     - 纯文字快速笔记
//     "voice"    - 语音 + 转写文本
//     "voice_text" - 录音 + 手动补充文本
// ---------------------------------------------------------------------------

export type MobilePendingNoteStatus = "pending" | "syncing" | "failed";

export type MobilePendingNoteSource = "text" | "voice" | "voice_text";

export type MobilePendingNote = {
  id: string;
  title: string;
  body: string;
  transcript: string;
  hasAudio: boolean;
  audioUri: string;
  audioMime: string | null;
  durationSeconds: number | null;
  source: MobilePendingNoteSource;
  status: MobilePendingNoteStatus;
  createdAt: string;
  updatedAt: string;
  lastError: string;
  retryCount: number;
};

export type MobilePendingNotesSnapshot = {
  cachedAt: string;
  notes: MobilePendingNote[];
};

// ---------------------------------------------------------------------------
// 2026-07-02 — R5C: R5B recorder session/chunk/segment/ingest types.
// 服务端 (mobile server) 收到 startRecorderSession 后返回一个会话 ID,
// 客户端在 chunks/segments 阶段提交原始二进制与转写文本,最后调用 ingest
// 才会真正落库 (Markdown + HTML + 知识条目)。请求 / 响应结构与
// @openclaw-workbench/mobile/src/lib/api.ts 中的同名 wrapper 严格对应。
// ---------------------------------------------------------------------------

export type RecorderSessionLanguage = "zh-CN" | "en-US" | string;

export type RecorderSessionSource =
  | "audio_upload"
  | "manual_transcript"
  | "speech_recognition"
  | "live_draft"
  | string;

export type RecorderSegmentSource = "live" | "post";

export type RecorderSessionStartRequest = {
  date: string;
  language: RecorderSessionLanguage;
  title?: string;
  source?: RecorderSessionSource;
};

export type RecorderSessionStartPayload = {
  ok: true;
  session: {
    id: string;
    status?: string;
    title?: string;
    scene?: string;
    language?: string;
    totalChunks?: number;
    totalBytes?: number;
    durationMs?: number;
    startedAt?: string;
    updatedAt?: string;
  };
};

export type RecorderChunkRequest = {
  audioBase64: string;
  audioMime: string;
  chunkIndex: number;
  totalChunks: number;
  totalBytes: number;
  durationSeconds?: number | null;
  filename?: string;
  reset?: boolean;
};

export type RecorderChunkPayload = {
  ok: true;
  uploadedChunks: number;
  totalChunks: number;
};

export type RecorderSegmentsPayload = {
  ok: true;
  session: RecorderSessionStartPayload["session"];
  segments: Array<{
    id: string;
    segmentIndex?: number;
    chunkIndex?: number;
    text?: string;
    status?: string;
    provider?: string;
    createdAt?: string;
  }>;
};

export type RecorderIngestRequest = {
  title?: string;
  transcriptText: string;
  source?: RecorderSessionSource;
  language?: RecorderSessionLanguage;
  durationSeconds?: number | null;
  target?: "timeline" | "calendar" | "knowledge" | "wiki" | "all";
  confirm: true;
};

export type RecorderIngestPayload = {
  ok: true;
  status: "created" | "reused";
  job: {
    id: string;
    status?: string;
    target?: string;
    markdownPath?: string;
    htmlPath?: string;
    knowledgeEntryId?: string | null;
    calendarNoteId?: string | null;
  };
  voiceNote?: MobileVoiceNote;
  markdownPath?: string;
  htmlPath?: string;
  knowledgeEntryId?: string | null;
  calendarNoteId?: string | null;
};
