// 2026-07-02 — R5C: 录音状态拥有权上移到 App shell 层,跨 记录 / 知识 / 日程 / 设备
// 切 tab 不会丢草稿 / 已发起会话 / 已上传片段。新会话(chunked)走 R5B API。
//
// 设计要点:
//   - 状态默认 6 个模式:closed | recording | paused | transcribing | preview | saving | saved
//   - minimized=true 等价于 "不在主屏渲染工作台",但状态仍在 (用于粘底浮动条)
//   - R5B 会话 ID 在 start() 后异步拿到,失败也不阻塞 UI;只在 confirm 阶段
//     才要求 server 必须返回 sessionId 否则视为本地草稿。
//   - 切到「知识 / 日程 / 设备」tab 时 RecordingContext 不会被卸载;
//     Workspace 由 App.tsx 全屏渲染。
//
// 提供 hooks:
//   - useRecorder()        : 全部 state + actions
//   - useRecorderState()   : 只读 state
//
// 不在本文件触发任何 UI 副作用;副作用留到调用处 (TodayConsoleScreen / App)
// 用 useEffect 推送本地录音 / 转写。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import {
  describeOfflineAsrState,
  getOfflineAsrState,
  resetLocalSegmentsForNewRecording,
  subscribeOfflineAsr,
  type OfflineAsrState as _OfflineAsrState,
} from "@/lib/offlineAsr";

/**
 * RecorderContext 把「本地 ASR 是否就绪、引擎是什么、模型大小」从
 * offlineAsr 单例订阅进自己的 state。UI 不再读 transcriptionProvider
 * (R9B 之后残留的 Mac 端转写 provider 名),改读 offlineAsrStatus;
 * 只有 offlineAsrStatus === "ready" 且 engineId !== "mac-segment-fallback"
 * 时,UI 才会宣称「本地转写已就绪」。mac-segment-fallback 引擎下,UI
 * 必须用「远端片段兜底」语义,不允许伪造成"本地实时转写"。
 */
export type OfflineAsrStatusSnapshot = {
  status: _OfflineAsrState["status"];
  engineId: _OfflineAsrState["engineId"];
  modelLabel: string | null;
  expectedModelSizeMB: number | null;
  modelFilename: string | null;
  lastError: string | null;
  lastTranscript: string | null;
  describe: string;
};

export type RecorderMode =
  | "closed"
  | "recording"
  | "paused"
  | "transcribing"
  | "preview"
  | "saving"
  | "saved";

// 2026-07-04 — R10 live transcription state machine. Surfaced so the workbench
// and the shell overlay can tell the user the truth about the live path:
//   idle        — not recording / nothing uploaded yet
//   uploading   — a rolling live segment is being uploaded
//   waiting     — segment uploaded, waiting for Mac to transcribe it
//   received    — at least one transcript segment came back
//   unavailable — Mac has no transcription provider configured
//   failed      — a segment transcription failed on the server
export type LiveTranscriptionState =
  | "idle"
  | "uploading"
  | "waiting"
  | "received"
  | "unavailable"
  | "failed";

export type RecorderState = {
  // 会话与持续时间
  mode: RecorderMode;
  minimized: boolean;
  startedAt: string | null;
  seconds: number;
  paused: boolean;
  // 2026-07-04 — R11: 旧 transcriptionProvider 是「Mac 工作台语音转写服务」名字,
  // 不再作为主路径信号。保留字段只是为了让旧 reducer / persistence 不报 TS 错;
  // UI 一律改读 offlineAsr(下方)。
  transcriptionProvider: string | null;
  recorderSessionId: string | null;
  recorderSessionError: string | null;
  // R11: 本地 ASR 引擎快照(订阅 offlineAsr 单例)
  offlineAsr: OfflineAsrStatusSnapshot;
  // 内容
  title: string;
  transcript: string;
  audioUri: string;
  audioMime: string | null;
  durationSeconds: number | null;
  // 预览
  previewMarkdown: string;
  previewHtml: string;
  previewTab: "markdown" | "html";
  // 推送进度
  uploadedChunks: number;
  totalChunks: number;
  segmentsCount: number;
  // R10 实时转写:滚动上传的「片段」数(区别于「分片 chunk」)与实时转写状态
  liveSegmentsUploaded: number;
  liveTranscription: LiveTranscriptionState;
  // R18: 实时本地 ASR segment 数。source="offline" 且 engineId 是 sherpa-onnx
  //   或 whisper-rn 时计入。每次 transcribeOffline() 在录音期间成功后,
  //   recording UI 调用 recordLocalAsrSegment 递增。segmentsCount 字段专
  //   给「远端 polling segment」使用,两者并行递增可让 UI 区分真实本地
  //   转写 vs server-polling 兜底。
  localSegmentsCount: number;
  // 入库结果 (saved 模式才有)
  ingest: {
    ok: boolean;
    markdownPath: string;
    htmlPath: string;
    knowledgePath: string | null;
  } | null;
  lastError: string | null;
};

export type RecorderActions = {
  start: () => void;
  setSeconds: (next: number) => void;
  setPaused: (next: boolean) => void;
  setAudio: (params: { uri: string; mime: string | null; durationSeconds: number }) => void;
  setTitle: (next: string) => void;
  setTranscript: (next: string) => void;
  setPreviewTab: (next: "markdown" | "html") => void;
  setMode: (next: RecorderMode) => void;
  minimize: () => void;
  restore: () => void;
  setRecorderSession: (params: { id: string | null; provider: string | null; error?: string | null }) => void;
  reportChunk: () => void;
  reportTotalChunks: (total: number) => void;
  reportSegment: () => void;
  reportLiveSegmentUploaded: () => void;
  reportLocalAsrSegment: () => void;
  setLiveTranscription: (next: LiveTranscriptionState) => void;
  setIngest: (ingest: RecorderState["ingest"]) => void;
  setError: (message: string | null) => void;
  close: () => void;
};

const initialState: RecorderState = {
  mode: "closed",
  minimized: false,
  startedAt: null,
  seconds: 0,
  paused: false,
  transcriptionProvider: null,
  recorderSessionId: null,
  recorderSessionError: null,
  offlineAsr: {
    status: "uninitialized",
    engineId: "noop",
    modelLabel: null,
    expectedModelSizeMB: null,
    modelFilename: null,
    lastError: null,
    lastTranscript: null,
    describe: "本地 ASR 尚未检查",
  },
  title: "",
  transcript: "",
  audioUri: "",
  audioMime: null,
  durationSeconds: null,
  previewMarkdown: "",
  previewHtml: "",
  previewTab: "markdown",
  uploadedChunks: 0,
  totalChunks: 0,
  segmentsCount: 0,
  liveSegmentsUploaded: 0,
  liveTranscription: "idle",
  localSegmentsCount: 0,
  ingest: null,
  lastError: null,
};

const RecorderContext = createContext<{
  state: RecorderState;
  actions: RecorderActions;
} | null>(null);

function nowIso() {
  return new Date().toISOString();
}

function toSnapshot(state: _OfflineAsrState): OfflineAsrStatusSnapshot {
  return {
    status: state.status,
    engineId: state.engineId,
    modelLabel: state.modelInfo?.modelLabel ?? null,
    expectedModelSizeMB: state.modelInfo?.expectedModelSizeMB ?? null,
    modelFilename: state.modelInfo?.modelFilename ?? null,
    lastError: state.lastError,
    lastTranscript: state.lastTranscript,
    describe: describeOfflineAsrState(state),
  };
}

export function RecorderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RecorderState>(initialState);
  // 每次 mode 切换的 ctxVersion,方便上层 useEffect 钩到 mode 变化。
  const ctxVersion = useRef(0);

  // 2026-07-04 — R11: 订阅 offlineAsr 单例,把「本地 ASR 状态机」镜像进
  // RecorderState。RecorderWorkspace / TodayConsoleScreen 全部读
  // state.offlineAsr,不再读 transcriptionProvider 来判断 ASR 是否就绪。
  useEffect(() => {
    // 先吃一次当前快照,避免 UI 闪一下「uninitialized」。
    const snapshot = getOfflineAsrState();
    setState((prev) => ({ ...prev, offlineAsr: toSnapshot(snapshot) }));
    return subscribeOfflineAsr((next) => {
      setState((prev) => ({ ...prev, offlineAsr: toSnapshot(next) }));
    });
  }, []);

  const start = useCallback(() => {
    ctxVersion.current += 1;
    // R18: 新会话开始时,清空 offlineAsr.lastSegments,让 localSegmentsCount
    //   从 0 起步。lastTranscript / lastDurationMs 同时清空,避免旧数据混入。
    resetLocalSegmentsForNewRecording();
    setState((prev) => ({
      ...prev,
      mode: "recording",
      minimized: false,
      startedAt: nowIso(),
      seconds: 0,
      paused: false,
      recorderSessionId: null,
      recorderSessionError: null,
      uploadedChunks: 0,
      totalChunks: 0,
      segmentsCount: 0,
      liveSegmentsUploaded: 0,
      liveTranscription: "idle",
      localSegmentsCount: 0,
      ingest: null,
      lastError: null,
    }));
  }, []);

  const close = useCallback(() => {
    ctxVersion.current += 1;
    resetLocalSegmentsForNewRecording();
    setState({ ...initialState });
  }, []);

  const minimize = useCallback(() => {
    setState((prev) => ({ ...prev, minimized: true }));
  }, []);

  const restore = useCallback(() => {
    setState((prev) => ({ ...prev, minimized: false }));
  }, []);

  const setMode = useCallback((next: RecorderMode) => {
    setState((prev) => (prev.mode === next ? prev : { ...prev, mode: next }));
  }, []);

  const setSeconds = useCallback((next: number) => {
    setState((prev) => (prev.seconds === next ? prev : { ...prev, seconds: next }));
  }, []);

  const setPaused = useCallback((next: boolean) => {
    setState((prev) => ({ ...prev, paused: next }));
  }, []);

  const setAudio = useCallback(
    (params: { uri: string; mime: string | null; durationSeconds: number }) => {
      setState((prev) => {
        if (prev.audioUri === params.uri && prev.audioMime === params.mime && prev.durationSeconds === params.durationSeconds) return prev;
        return {
          ...prev,
          audioUri: params.uri,
          audioMime: params.mime,
          durationSeconds: params.durationSeconds,
        };
      });
    },
    [],
  );

  const setTitle = useCallback((next: string) => {
    setState((prev) => (prev.title === next ? prev : { ...prev, title: next }));
  }, []);

  const setTranscript = useCallback((next: string) => {
    setState((prev) => (prev.transcript === next ? prev : { ...prev, transcript: next }));
  }, []);

  const setPreviewTab = useCallback((next: "markdown" | "html") => {
    setState((prev) => (prev.previewTab === next ? prev : { ...prev, previewTab: next }));
  }, []);

  const setRecorderSession = useCallback(
    (params: { id: string | null; provider: string | null; error?: string | null }) => {
      setState((prev) => ({
        ...prev,
        recorderSessionId: params.id,
        transcriptionProvider: params.provider,
        recorderSessionError: params.error ?? null,
      }));
    },
    [],
  );

  const reportChunk = useCallback(() => {
    setState((prev) => ({ ...prev, uploadedChunks: prev.uploadedChunks + 1 }));
  }, []);

  const reportTotalChunks = useCallback((total: number) => {
    setState((prev) => ({ ...prev, totalChunks: Math.max(prev.totalChunks, total) }));
  }, []);

  const reportSegment = useCallback(() => {
    setState((prev) => ({ ...prev, segmentsCount: prev.segmentsCount + 1 }));
  }, []);

  const reportLiveSegmentUploaded = useCallback(() => {
    setState((prev) => ({ ...prev, liveSegmentsUploaded: prev.liveSegmentsUploaded + 1 }));
  }, []);

  const reportLocalAsrSegment = useCallback(() => {
    setState((prev) => ({
      ...prev,
      localSegmentsCount: prev.localSegmentsCount + 1,
    }));
  }, []);

  const setLiveTranscription = useCallback((next: LiveTranscriptionState) => {
    setState((prev) => (prev.liveTranscription === next ? prev : { ...prev, liveTranscription: next }));
  }, []);

  const setIngest = useCallback((ingest: RecorderState["ingest"]) => {
    setState((prev) => ({ ...prev, ingest }));
  }, []);

  const setError = useCallback((message: string | null) => {
    setState((prev) => ({ ...prev, lastError: message }));
  }, []);

  const value = useMemo<{ state: RecorderState; actions: RecorderActions }>(() => {
    return {
      state,
      actions: {
        start,
        setSeconds,
        setPaused,
        setAudio,
        setTitle,
        setTranscript,
        setPreviewTab,
        setMode,
        minimize,
        restore,
        setRecorderSession,
        reportChunk,
        reportTotalChunks,
        reportSegment,
        reportLiveSegmentUploaded,
        reportLocalAsrSegment,
        setLiveTranscription,
        setIngest,
        setError,
        close,
      },
    };
  }, [
    state,
    start,
    setSeconds,
    setPaused,
    setAudio,
    setTitle,
    setTranscript,
    setPreviewTab,
    setMode,
    minimize,
    restore,
    setRecorderSession,
    reportChunk,
    reportTotalChunks,
    reportSegment,
    reportLiveSegmentUploaded,
    reportLocalAsrSegment,
    setLiveTranscription,
    setIngest,
    setError,
    close,
  ]);

  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}

export function useRecorder() {
  const ctx = useContext(RecorderContext);
  if (!ctx) throw new Error("useRecorder must be used inside <RecorderProvider>");
  return ctx;
}

export function useRecorderState() {
  return useRecorder().state;
}

// 持久化键名(供 storage.ts 复用)
export const RecorderPersistedKeys = {
  draft: "openclaw.mobile.recorder.draft.v1",
  session: "openclaw.mobile.recorder.session.v1",
} as const;
