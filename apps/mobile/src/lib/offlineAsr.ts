// 2026-07-04 — R11/R12B: Offline On-Device ASR abstraction.
//
// NJX 切换战略:从「Mac/CloudBase 后端转写」切到「手机本地转写」,把
// 语音识别从运行时网络 / 服务器依赖里彻底拿出来。本文件是这个切换的
// 唯一抽象入口 —— UI、RecorderContext、TodayConsoleScreen 都不应该直接
// 引用具体引擎(whisper.rn / sherpa-onnx),只读 offlineAsr 提供的状态和
// 转写结果。
//
// 设计要点:
//   1. 状态机:
//
//        uninitialized -> checking -> missing
//                                     ready -> recording
//                                                  -> transcribing -> ready
//                                                  -> failed -> ready | missing
//
//      UI 严格按这张状态机绘制 copy;任何"服务器转写 / Mac 转写"语义只允许
//      作为远程 segment fallback 出现,且不得再被当作主路径。
//
//   2. 引擎可插拔:
//      提供 noopEngine / macSegmentFallbackEngine 两个 stub,以及
//      finalEngine 注册口。生产引擎(sherpa-onnx + bundled 模型)由
//      Android/iOS 原生模块装载:R12B 起默认装载 sherpa-onnx +
//      内置 Zipformer-small-CTC 中文 int8 模型(26 MB 已打进 APK assets),
//      完全不需要任何运行时网络 / 服务器下载。
//
//   3. 离线保证:
//      抽象明确写明引擎实现禁止 fetch()、禁止 import 任何 axios / http
//      客户端转写后端。所有转写必须在本机内存 + 本机模型文件上完成。
//      contract 会被 scripts/test-mobile-r11-offline-asr-contract.mjs 校验。
//
//   4. 不假装转写:
//      没有模型 / 模型没加载好时,绝不返回 fake transcript;只返回
//      reason="model_missing" / "model_loading" / "failed" 的空结果。
//      录音 UI 必须用这些 reason 拒绝提前填入文本,保持「不展示假转写」
//      的诚实性。
//
//   5. OTA 友好:
//      finalEngine 的注册接口是 module-scope singleton,可在 App 启动后
//      通过 setOfflineAsrEngine 替换;只要模型文件 / 引擎二进制在 native
//      package 里,OTA JS 就能热加载新的识别实现 —— 不需要再走 EAS 完整
//      rebuild,前提是 native pod / aar 已经把核心 ASR 引擎内嵌进 ipa/apk。
//
//   6. R12B 关键变化:
//      - 默认引擎从 `sherpa-onnx + Paraformer-zh (95 MB,运行时下载)` 改为
//        `sherpa-onnx + 内置 Zipformer-small-CTC 中文 int8 (26 MB,APK 打包)`。
//      - 模型文件随 APK 一起发布,首次启动 detectSttModel 自动从 assets 抽出
//        到 `${filesDir}/models/`,后续启动直接读 cache —— 整个 IO 都是本地。
//      - 不再依赖任何运行时网络 / 服务器 / 远端工作台。

import type { MobileSession } from "@/lib/types";

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

/**
 * 离线 ASR 引擎当前状态。所有 UI / RecorderContext 都从这里读。
 */
export type OfflineAsrStatus =
  | "uninitialized" // App 启动后第一次调用之前的初始态
  | "checking" // 正在检查模型文件 / 引擎二进制是否就绪
  | "missing" // 模型未安装(用户需要在「本地模型」面板里下载)
  | "loading" // 模型文件已发现,正在加载到内存(首次加载通常 3-8s)
  | "ready" // 模型加载完毕,可以转写
  | "recording" // 正在录音;引擎缓冲原始 PCM(若引擎支持),否则仅记录时长
  | "transcribing" // 录音结束 / 切片结束,正在调用引擎转写
  | "failed"; // 转写失败(reason 在 lastError);模型仍在 ready 状态,可重试

export type OfflineAsrEngineId = "noop" | "mac-segment-fallback" | "sherpa-onnx" | "whisper-rn";

export type OfflineAsrModelInfo = {
  /** 引擎识别 ID,用于持久化(用户切换引擎不丢状态) */
  engineId: OfflineAsrEngineId;
  /** 给 UI 看的引擎名(中文) */
  engineLabel: string;
  /** 给 UI 看的模型描述(中文) */
  modelLabel: string;
  /** 模型预期大小(MB);模型缺失时仍然展示,引导用户预知下载体积 */
  expectedModelSizeMB: number;
  /** 模型文件名(android assets / ios bundle resource / 本地下载) */
  modelFilename: string;
  /** 是否支持流式(实时)转写;若 false,只能在 stop 后批量转写 */
  supportsStreaming: boolean;
  /** 是否支持中文 */
  chineseSupported: true;
  /** 当前生效的本地模型文件绝对路径,或 null 表示尚未加载 */
  loadedModelPath: string | null;
  /** 模型字节数,或 null 表示尚未加载 */
  loadedModelBytes: number | null;
  /** 模型加载时间 ISO 字符串,或 null 表示尚未加载 */
  loadedAt: string | null;
};

export type OfflineAsrState = {
  status: OfflineAsrStatus;
  engineId: OfflineAsrEngineId;
  modelInfo: OfflineAsrModelInfo | null;
  lastError: string | null;
  /**
   * 最近一次本地转写的 segments(append-only)。Segment 带 source 标签,
   * UI 看见 source === "offline" 才允许直接渲染中文文本;
   * source === "manual" 表示用户在录音中手动输入的草稿。
   */
  lastSegments: OfflineAsrSegment[];
  /** 最近一次成功的整段转写文本,或 null(失败 / 没转写过) */
  lastTranscript: string | null;
  /** 最近一次成功转写消耗的引擎时间(ms);仅做诊断用 */
  lastDurationMs: number | null;
};

/** 一段转写结果;source 决定 UI 如何展示。 */
export type OfflineAsrSegment = {
  /** 0-based segment index,本会话内单调递增 */
  index: number;
  /** 转写文本(trim 后非空) */
  text: string;
  /** 来源 */
  source: "offline" | "manual";
  /** 引擎 ID,用于 UI 角标;manual 时为 "manual" */
  engineId: OfflineAsrEngineId | "manual";
  /** ISO 时间戳 */
  at: string;
  /** 段起点(秒,相对本次录音起点);流式引擎才有意义 */
  startSeconds: number | null;
  /** 段终点(秒) */
  endSeconds: number | null;
  /** 引擎自带置信度 0..1;无置信度信息时为 null */
  confidence: number | null;
};

/** 引擎执行的输入参数。 */
export type OfflineAsrRequest = {
  /** 录音文件本地绝对路径(file://... 或 expo-file-system 内部路径) */
  audioUri: string;
  /** 音频 MIME;目前 m4a / wav 已知可被 sherpa-onnx 直接读取 */
  audioMime: string | null;
  /** 录音时长(秒) */
  durationSeconds: number;
  /** 语言;默认 zh-CN */
  language?: string;
  /**
   * 若 true,只转写新增的尾部段落(增量);false 时全量转写。
   * 模型不支持增量时,引擎可以选择忽略这个 flag 仍然全量返回。
   */
  incremental?: boolean;
};

/** 引擎返回的转写结果。 */
export type OfflineAsrResult =
  | {
      ok: true;
      segments: OfflineAsrSegment[];
      fullTranscript: string;
      durationMs: number;
      engineId: OfflineAsrEngineId;
    }
  | {
      ok: false;
      reason: "model_missing" | "model_loading" | "engine_unavailable" | "audio_unreadable" | "failed";
      message: string;
      engineId: OfflineAsrEngineId;
    };

// ---------------------------------------------------------------------------
// 引擎接口
// ---------------------------------------------------------------------------

/**
 * 离线 ASR 引擎的统一接口。所有引擎(noop / mac-fallback / sherpa-onnx /
 * whisper-rn)都必须实现这个接口,UI 永远只通过此接口访问引擎。
 *
 * 关键约束:
 *   - engineId 必须全局唯一,且与 OfflineAsrEngineId 联合类型兼容
 *   - getModelInfo() 任何状态下都必须返回当前引擎的预期模型信息
 *     (即使模型尚未加载,expectedModelSizeMB 仍然要真实)
 *   - transcribe() 在 status !== "ready" 时必须返回 ok=false,且 reason
 *     严格使用 "model_missing" / "model_loading" —— UI 用此拒绝填入假文本
 *   - 严禁在引擎实现里 fetch() / axios / WebSocket 调用任何转写后端
 */
export interface OfflineAsrEngine {
  readonly engineId: OfflineAsrEngineId;
  readonly engineLabel: string;
  getModelInfo(): OfflineAsrModelInfo;
  /**
   * 检查 + 加载本地模型。可重复调用:已加载时是 no-op;
   * 缺失时返回 ok=false("model_missing");失败返回 ok=false("failed")。
   */
  ensureLoaded(): Promise<
    | { ok: true; modelInfo: OfflineAsrModelInfo; loadedAt: string }
    | { ok: false; reason: "missing" | "failed" | "unsupported"; message: string }
  >;
  /**
   * 同步执行转写。引擎实现内部负责把音频读成 PCM,送给本地模型,
   * 把识别结果按 segment 输出。失败时务必返回 ok=false。
   */
  transcribe(req: OfflineAsrRequest): Promise<OfflineAsrResult>;
  /** 释放模型(可用于省电 / 释放磁盘)。已释放后 transcribe 会自动重新加载。 */
  release(): Promise<void>;
}

// ---------------------------------------------------------------------------
// 全局注册表 + 当前状态订阅
// ---------------------------------------------------------------------------

type OfflineAsrListener = (snapshot: OfflineAsrState) => void;

let registeredEngine: OfflineAsrEngine | null = null;
let currentState: OfflineAsrState = {
  status: "uninitialized",
  engineId: "noop",
  modelInfo: null,
  lastError: null,
  lastSegments: [],
  lastTranscript: null,
  lastDurationMs: null,
};
const listeners = new Set<OfflineAsrListener>();

function emit() {
  for (const listener of listeners) listener(currentState);
}

function setState(patch: Partial<OfflineAsrState>) {
  currentState = { ...currentState, ...patch };
  emit();
}

export function setOfflineAsrEngine(engine: OfflineAsrEngine): void {
  registeredEngine = engine;
  setState({
    engineId: engine.engineId,
    modelInfo: engine.getModelInfo(),
    // Reset transient state — a new engine starts uninitialized until the
    // caller runs `ensureLoaded` again.
    status: "uninitialized",
    lastError: null,
    lastSegments: [],
    lastTranscript: null,
    lastDurationMs: null,
  });
}

/**
 * 2026-07-06 — R19: explicitly mark the registered engine as ready. setOfflineAsrEngine
 * always resets status to "uninitialized" so the caller must flip it back to "ready"
 * once `ensureLoaded()` actually succeeds. Engines/index.ts calls this after the
 * successful probe + ensureLoaded path so UI screens (which require status === "ready"
 * AND engineId ∈ {sherpa-onnx, whisper-rn}) render "本地 ASR 已就绪" rather than
 * "本地 ASR 未就绪".
 */
export function setOfflineAsrReady(): void {
  if (!registeredEngine) return;
  setState({
    status: "ready",
    lastError: null,
    modelInfo: registeredEngine.getModelInfo(),
  });
}

export function getOfflineAsrEngine(): OfflineAsrEngine | null {
  return registeredEngine;
}

export function getOfflineAsrState(): OfflineAsrState {
  return currentState;
}

export function subscribeOfflineAsr(listener: OfflineAsrListener): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// 公共操作:check / load / transcribe
// ---------------------------------------------------------------------------

/**
 * App 启动 + workbench 打开时调用。检查当前引擎的模型状态;
 * 没注册引擎时返回 { ok: false, reason: "engine_unavailable" } —— UI 据此
 * 渲染「本地 ASR 引擎未注册,等待 native 包就绪」横幅。
 */
export async function checkOfflineAsr(): Promise<
  | { ok: true; status: "ready"; modelInfo: OfflineAsrModelInfo }
  | { ok: false; reason: "engine_unavailable" | "missing" | "failed"; message: string }
> {
  if (!registeredEngine) {
    setState({
      status: "missing",
      engineId: "noop",
      lastError: "本地 ASR 引擎未注册,需要 native rebuild 安装 sherpa-onnx 或 whisper.rn。",
    });
    return {
      ok: false,
      reason: "engine_unavailable",
      message: "本地 ASR 引擎未注册",
    };
  }
  setState({ status: "checking", lastError: null });
  const result = await registeredEngine.ensureLoaded();
  if (result.ok) {
    setState({
      status: "ready",
      modelInfo: result.modelInfo,
      lastError: null,
    });
    return { ok: true, status: "ready", modelInfo: result.modelInfo };
  }
  if (result.reason === "missing") {
    setState({
      status: "missing",
      modelInfo: registeredEngine.getModelInfo(),
      lastError: result.message,
    });
    return { ok: false, reason: "missing", message: result.message };
  }
  setState({
    status: "failed",
    modelInfo: registeredEngine.getModelInfo(),
    lastError: result.message,
  });
  return { ok: false, reason: "failed", message: result.message };
}

/**
 * 用当前引擎转写一段录音。**绝不假装成功**:引擎不可用 / 模型缺失时,
 * 返回的 segments 为空数组,UI 必须用 ok=false 拒绝填入 transcript 草稿。
 */
export async function transcribeOffline(req: OfflineAsrRequest): Promise<OfflineAsrResult> {
  if (!registeredEngine) {
    return {
      ok: false,
      reason: "engine_unavailable",
      message: "本地 ASR 引擎未注册",
      engineId: "noop",
    };
  }
  setState({ status: "transcribing", lastError: null });
  try {
    const result = await registeredEngine.transcribe(req);
    if (result.ok) {
      const merged = [...currentState.lastSegments, ...result.segments];
      setState({
        status: "ready",
        lastSegments: merged,
        lastTranscript: result.fullTranscript,
        lastDurationMs: result.durationMs,
      });
      return result;
    }
    setState({
      status: result.reason === "model_missing" || result.reason === "model_loading" ? "missing" : "failed",
      lastError: result.message,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setState({ status: "failed", lastError: message });
    return {
      ok: false,
      reason: "failed",
      message,
      engineId: registeredEngine.engineId,
    };
  }
}

/** 把用户手动输入的草稿登记为 manual segment(不进 lastTranscript 的「自动转写」字段)。 */
export function recordManualSegment(text: string): OfflineAsrSegment | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const seg: OfflineAsrSegment = {
    index: currentState.lastSegments.length,
    text: trimmed,
    source: "manual",
    engineId: "manual",
    at: new Date().toISOString(),
    startSeconds: null,
    endSeconds: null,
    confidence: null,
  };
  setState({ lastSegments: [...currentState.lastSegments, seg] });
  return seg;
}

// ---------------------------------------------------------------------------
// 2026-07-06 — R18: real-time local ASR segment push.
//
// 在 R17 之前,recording 流程只通过 mac-segment-fallback 路径(把 server polling
// segments 当作「远端兜底」)往 lastSegments 推入文字;真正的本地引擎只在 stop 后
// 一次性 transcribe()。这导致一个核心问题:录音中 UI 永远显示「远端兜底转写片段
// 待命中」,即使 sherpa-onnx 已经 ready 也不会有任何文字出现。
//
// R18 把这个路径打通:每次 recorder 滚动产出新分片时,recording UI 在上传到服务
// 器的同时也调用 transcribeOffline() 在本机执行,成功就把 segment 标记为本地
// engineId 推进 lastSegments。本函数 recordLocalAsrSegment(text, ...) 就是这
// 段本地转写结果的入口点(外部 transcribe 包装层负责调用)。
//
// 关键约束:
//   - engineId 必须是已注册的本地引擎 id(sherpa-onnx / whisper-rn),
//     防止误把 noop / mac-segment-fallback 的产物标成本地成功;
//   - segment.source = "offline",与 mac-segment-fallback 共享同一渲染路径,
//     但 engineId 不同让 UI 可以显式标出「本地 ASR」还是「远端兜底」;
//   - lastTranscript 在 lastSegments 之后重建,与 manual 路径保持一致;
//   - 不刷新 status / engineId,只追加 segments,避免把状态机写乱。
// ---------------------------------------------------------------------------

/**
 * 在录音中,把一条本地 ASR 转写片段登记进 lastSegments。**不会**改变
 * OfflineAsrState.engineId / status(那些字段由 ensureLoaded / transcribe
 * 流程把控);只追加 segments,让 UI 立刻看到「本地 ASR 已实时转写 X 段」。
 *
 * @param text       本地引擎识别出的中文文本(已 trim)
 * @param startSec   段起点(秒,相对本次录音起点);流式引擎才有意义
 * @param endSec     段终点(秒)
 * @param engineId   本地引擎 ID,sherpa-onnx / whisper-rn;若与当前 engineId
 *                   不一致,以传入的为准用于这个 segment 的标定
 */
export function recordLocalAsrSegment(
  text: string,
  startSeconds: number | null = null,
  endSeconds: number | null = null,
  engineId: "sherpa-onnx" | "whisper-rn" = "sherpa-onnx",
): OfflineAsrSegment | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const seg: OfflineAsrSegment = {
    index: currentState.lastSegments.length,
    text: trimmed,
    source: "offline",
    engineId,
    at: new Date().toISOString(),
    startSeconds,
    endSeconds,
    confidence: null,
  };
  const merged = [...currentState.lastSegments, seg];
  setState({
    lastSegments: merged,
    lastTranscript: merged.map((s) => s.text).join("\n"),
    lastDurationMs: null,
  });
  return seg;
}

/**
 * 统计当前 lastSegments 中本地引擎(sherpa-onnx / whisper-rn)的 segment 数。
 * 给 RecorderContext / TodayConsoleScreen UI 用,以区分「本地 ASR 转写 X 段」
 * 与「远端兜底拉取 Y 个片段」,从而在 voiceHeroMeta / voiceRealtimeRow
 * 准确显示「实时转写由本地 ASR 完成」。
 */
export function getLocalSegmentsCount(): number {
  let count = 0;
  for (const s of currentState.lastSegments) {
    if (s.engineId === "sherpa-onnx" || s.engineId === "whisper-rn") count += 1;
  }
  return count;
}

/** R18: 录音停止 / 关闭工作台时清空 segments 计数,避免下一轮录音继承旧数。 */
export function resetLocalSegmentsForNewRecording(): void {
  setState({ lastSegments: [], lastTranscript: null, lastDurationMs: null });
}

/** UI 用 —— 把当前状态翻译成 1 句人话。 */
export function describeOfflineAsrState(state: OfflineAsrState = currentState): string {
  switch (state.status) {
    case "uninitialized":
      return "本地 ASR 尚未检查";
    case "checking":
      return "正在检查本地 ASR 引擎";
    case "missing":
      return state.modelInfo
        ? `本地模型未安装: ${state.modelInfo.modelLabel} (${state.modelInfo.expectedModelSizeMB} MB)`
        : "本地 ASR 引擎未注册";
    case "loading":
      return `正在加载本地模型: ${state.modelInfo?.modelLabel ?? "?"}`;
    case "ready":
      return state.modelInfo
        ? `本地 ASR 就绪: ${state.modelInfo.modelLabel}`
        : "本地 ASR 就绪";
    case "recording":
      return "录音中,本地 ASR 待命中";
    case "transcribing":
      return "本地 ASR 正在转写";
    case "failed":
      return `本地 ASR 失败: ${state.lastError ?? "未知原因"}`;
  }
}

// ---------------------------------------------------------------------------
// 引擎实现:NOOP (开发态 fallback)
// ---------------------------------------------------------------------------

/**
 * 开发态兜底引擎。注册到 offlineAsr 后,UI 立刻看到「本地 ASR 引擎未注册」
 * —— 不返回任何 fake transcript,也不假装成 ready。这样保证在没有 native
 * 包的情况下,UI 永远不会展示假转写。
 *
 * 真正的生产引擎(sherpa-onnx / whisper.rn)在 native rebuild 后由
 * App.tsx 的 useEffect 注册进来。
 */
export const noopEngine: OfflineAsrEngine = {
  engineId: "noop",
  engineLabel: "未注册 (开发兜底)",
  getModelInfo: () => ({
    engineId: "noop",
    engineLabel: "未注册 (开发兜底)",
    modelLabel: "无 (需 native rebuild 安装 sherpa-onnx 或 whisper.rn)",
    expectedModelSizeMB: 0,
    modelFilename: "",
    supportsStreaming: false,
    chineseSupported: true,
    loadedModelPath: null,
    loadedModelBytes: null,
    loadedAt: null,
  }),
  ensureLoaded: async () => ({
    ok: false,
    reason: "unsupported",
    message: "本地 ASR 引擎未注册;需要 native rebuild 安装 sherpa-onnx 或 whisper.rn。",
  }),
  transcribe: async (req) => ({
    ok: false,
    reason: "engine_unavailable",
    message: "本地 ASR 引擎未注册;无法转写。",
    engineId: "noop",
  }),
  release: async () => undefined,
};

// ---------------------------------------------------------------------------
// 引擎实现:Mac segment 兜底 (R9B 轮询回来的 segments)
// ---------------------------------------------------------------------------

/**
 * 短期兜底:不调用任何 native 引擎,而是把现有 R5B 录音会话里已经轮询
 * 回来的 server-side segments 重新打 offline 标签喂给 UI。这样
 * TodayConsoleScreen 的 polling 路径可以继续把 server 端已经返回的
 * 中文文本拼到草稿里,但语义上不再把 "Mac 后台转写" 当作主路径 —
 * UI 上看到的所有中文文本都是 source="offline" 标记,只是引擎 ID
 * 暴露为 "mac-segment-fallback",明确告知用户这些是远端产物。
 *
 * 这条路径在 native rebuild 完成后,会被 sherpa-onnx / whisper.rn
 * 直接顶掉 —— 本接口的契约不变,UI 不需要任何改动。
 */
export function makeMacSegmentFallbackEngine(): OfflineAsrEngine {
  return {
    engineId: "mac-segment-fallback",
    engineLabel: "远端片段兜底 (R5B 录音会话已轮询 segments)",
    getModelInfo: () => ({
      engineId: "mac-segment-fallback",
      engineLabel: "远端片段兜底 (R5B 录音会话已轮询 segments)",
      modelLabel: "无 (依赖 Mac 工作台 R5B 录音会话轮询 segments)",
      expectedModelSizeMB: 0,
      modelFilename: "",
      supportsStreaming: false,
      chineseSupported: true,
      loadedModelPath: null,
      loadedModelBytes: null,
      loadedAt: null,
    }),
    ensureLoaded: async () => ({
      ok: true,
      modelInfo: {
        engineId: "mac-segment-fallback",
        engineLabel: "远端片段兜底 (R5B 录音会话已轮询 segments)",
        modelLabel: "无 (依赖 Mac 工作台 R5B 录音会话轮询 segments)",
        expectedModelSizeMB: 0,
        modelFilename: "",
        supportsStreaming: false,
        chineseSupported: true,
        loadedModelPath: null,
        loadedModelBytes: null,
        loadedAt: null,
      },
      loadedAt: new Date().toISOString(),
    }),
    // This engine does not actually call transcribe() — TodayConsoleScreen
    // pushes pre-collected segments into recordMacSegment() below. The
    // transcribe() entry is here only to satisfy the interface contract
    // and is never invoked.
    transcribe: async () => ({
      ok: false,
      reason: "engine_unavailable",
      message: "mac-segment-fallback 引擎不直接转写;segments 由 polling 层推入 recordMacSegment()。",
      engineId: "mac-segment-fallback",
    }),
    release: async () => undefined,
  };
}

/**
 * R5B polling 路径把 server 端转写片段登记为「远端兜底 segment」。
 * 注意:这些 segment 的 text 来自 Mac 工作台,所以 UI 必须以
 * source="offline" + engineId="mac-segment-fallback" 渲染,并且显式
 * 提示用户「这是远端工作台产出的文字,本地模型未安装时回退到此通道」。
 */
export function recordMacSegment(text: string, startSeconds: number | null = null, endSeconds: number | null = null): OfflineAsrSegment | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const seg: OfflineAsrSegment = {
    index: currentState.lastSegments.length,
    text: trimmed,
    source: "offline",
    engineId: "mac-segment-fallback",
    at: new Date().toISOString(),
    startSeconds,
    endSeconds,
    confidence: null,
  };
  setState({
    lastSegments: [...currentState.lastSegments, seg],
    // full transcript is rebuilt from the merged segment list so manual edits
    // upstream can still be reflected after a merge.
    lastTranscript: [...currentState.lastSegments, seg].map((s) => s.text).join("\n"),
  });
  return seg;
}

// ---------------------------------------------------------------------------
// 一次性 helper:在 RecorderContext 启动时挂 noop + mac-segment-fallback。
// 这样 native rebuild 完成前 UI 不会卡死,polling 路径可以继续把 server
// segments 喂给 UI;native rebuild 完成后调用 setOfflineAsrEngine(realEngine)
// 即可无缝切换,UI 状态机不需要任何迁移。
// ---------------------------------------------------------------------------

let booted = false;
let remoteFallbackAllowed = true;

/**
 * 在 App.tsx 启动时调用一次。R17 起 **不再** 把 mac-segment-fallback 顶成
 * 默认引擎 —— 默认只挂 `noop`,这样 UI 立刻看到「本地 ASR 引擎未注册」,
 * 等待 native 引擎探测完成后再切到 sherpa-onnx / whisper.rn。
 *
 * mac-segment-fallback 现在必须 **显式** 由调用方(例如 R9B 的 polling 路径)
 * 通过 `setRemoteSegmentFallbackEngine()` 启用,且必须带上明确的 reason:
 *   "本机无引擎可用,显式回退到远端 polling segments"
 * 任何「悄悄」落到 mac-segment-fallback 的代码路径,UI 都会以
 * `engineId === "mac-segment-fallback"` 显式标出来 —— 这是 R17 验收点:
 *   "Do not count server/network transcription as success for this R17 task"
 *   "Remote/Mac/server transcription may remain as explicit degraded fallback
 *    only, clearly labeled as fallback"
 */
export function bootstrapOfflineAsr(): void {
  if (booted) return;
  booted = true;
  // 默认只挂 noop,UI 会看到 modelInfo=null,describe() = "本地 ASR 引擎未注册"
  setOfflineAsrEngine(noopEngine);
}

/**
 * 把远端片段兜底引擎显式打开。仅当调用方明确知道本机引擎不可用、且
 * 用户已同意使用 R5B polling segments 时才调用。会把当前注册的引擎
 * 替换成 mac-segment-fallback,UI 文案会用「远端兜底」标识。
 *
 * 内部带 reason 文案,会写到 OfflineAsrState.lastError,UI 据此渲染
 * 「远端兜底」角标 + reason 详情。**不会**模拟"本地 ASR 已就绪"。
 */
export function setRemoteSegmentFallbackEngine(reason: string): void {
  remoteFallbackAllowed = true;
  setOfflineAsrEngine(makeMacSegmentFallbackEngine());
  // 把 lastError 写成"显式远端兜底"原因,UI 据此把按钮/状态条标成 fallback。
  setState({
    status: "ready",
    lastError: reason,
  });
  // 主动推一次 checkOfflineAsr 把 ready 状态落实。
  void checkOfflineAsr().catch(() => {
    /* swallow — UI 已拿到 lastError */
  });
}

/**
 * 关闭远端兜底,回到 noop(等待真实 native 引擎注册)。
 */
export function clearRemoteSegmentFallbackEngine(): void {
  remoteFallbackAllowed = false;
  setOfflineAsrEngine(noopEngine);
}

export function isRemoteSegmentFallbackAllowed(): boolean {
  return remoteFallbackAllowed;
}

// ---------------------------------------------------------------------------
// 调试 / 诊断:让上层能在不引入 React 的地方读到 engineId
// ---------------------------------------------------------------------------

/** 给 RecorderContext / UI 用 —— 把 Mac session id 绑定到当前录音会话,只用于诊断。 */
export function noteRecordingSession(_sessionId: string | null): void {
  // intentionally empty: 当前 task 不持久化 engine 维度的 session 关联。
  // 真实 native 引擎上线后,这里负责把 audio segments 按 recorder session
  // 维度缓存到本地,这样 stop 后 incremental transcribe 才有依据。
}

/** 给契约测试用 —— 强制重置状态机(测试开始前)。 */
export function __resetOfflineAsrForTests(): void {
  registeredEngine = null;
  booted = false;
  remoteFallbackAllowed = true;
  currentState = {
    status: "uninitialized",
    engineId: "noop",
    modelInfo: null,
    lastError: null,
    lastSegments: [],
    lastTranscript: null,
    lastDurationMs: null,
  };
  listeners.clear();
}

// ---------------------------------------------------------------------------
// 2026-07-06 — R17: 本地 ASR 运行期诊断 + 强校验
//
// Mate60 1.0.8 acceptance 发现:UI 一直在显示「远端兜底」,说明
// mac-segment-fallback 是默认兜底,真正的 sherpa-onnx 引擎探测一旦
// 失败就会悄悄回退。R17 把"运行期是否真的使用本地引擎"做成可读字段,
// 任何 UI 决策都必须先看 isLocalAsrMainPath():false 才能显示"远端兜底"。
// ---------------------------------------------------------------------------

/**
 * 当前 offlineAsr 是否就是本地引擎主路径(sherpa-onnx / whisper.rn),
 * 状态机是 ready/recording/transcribing。false 表示:
 *   - 引擎未注册 (noop) —— 本地引擎探测失败
 *   - 引擎是 mac-segment-fallback —— 显式远端兜底,UI 必须显式标注
 *   - 状态是 missing / loading / failed / uninitialized —— 等待中
 */
export function isLocalAsrMainPath(): boolean {
  if (currentState.engineId !== "sherpa-onnx" && currentState.engineId !== "whisper-rn") return false;
  if (currentState.status === "ready" || currentState.status === "recording" || currentState.status === "transcribing") return true;
  return false;
}

export type OfflineAsrRuntimeDiagnostic = {
  engineId: OfflineAsrEngineId | null;
  status: OfflineAsrStatus;
  isLocalAsrMainPath: boolean;
  isRemoteFallback: boolean;
  describe: string;
  modelLabel: string | null;
  expectedModelSizeMB: number | null;
  lastError: string | null;
  loadedAt: string | null;
  /** 详细诊断:对 UI / RecorderWorkspace 暴露,带可读的"应该用什么"建议 */
  guidance: string;
};

/**
 * 把当前 offlineAsr 状态翻译成 1 段人话 + 1 段建议。
 * 任何调用方都可以读这个对象,不需要自己展开 status / engineId。
 */
export function getOfflineAsrRuntimeDiagnostic(): OfflineAsrRuntimeDiagnostic {
  const state = currentState;
  const isLocalMain = isLocalAsrMainPath();
  const isRemote = state.engineId === "mac-segment-fallback" && state.status === "ready";
  const isLocalRegistered = state.engineId === "sherpa-onnx" || state.engineId === "whisper-rn";
  let guidance: string;
  if (isLocalMain) {
    guidance = `本地 ASR 主路径已就绪 (${state.modelInfo?.engineLabel || state.engineId})。录音中可走端侧实时转写。`;
  } else if (isRemote) {
    guidance = `远端片段兜底已显式启用: ${state.lastError || "无 reason 详情"}。本机引擎未注册或探测失败,UI 不应把这条路径当成"实时转写"展示。`;
  } else if (isLocalRegistered) {
    guidance = `本地 ASR 引擎 (${state.engineId}) 已注册但未 ready (status=${state.status}): ${state.lastError || "等待 init / 加载 / 失败排查"}`;
  } else if (state.engineId === "noop") {
    guidance = "本地 ASR 引擎未注册。sherpa-onnx / whisper.rn 模块未在 native 端装载,或模型文件未发现。运行 `tryRegisterNativeOfflineAsr()` 重新探测。";
  } else {
    guidance = `本地 ASR 引擎未知: ${state.engineId}, status=${state.status}`;
  }
  return {
    engineId: state.engineId,
    status: state.status,
    isLocalAsrMainPath: isLocalMain,
    isRemoteFallback: isRemote,
    describe: describeOfflineAsrState(state),
    modelLabel: state.modelInfo?.modelLabel ?? null,
    expectedModelSizeMB: state.modelInfo?.expectedModelSizeMB ?? null,
    lastError: state.lastError,
    loadedAt: state.modelInfo?.loadedAt ?? null,
    guidance,
  };
}

// ---------------------------------------------------------------------------
// (silence unused-import warning in build pipelines that strip TS types)
export type _OfflineAsrDiagnosticCarrier = MobileSession;