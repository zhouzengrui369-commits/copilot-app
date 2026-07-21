// 2026-07-04 — R12: Native offline ASR engine adapter for sherpa-onnx-react-native.
//
// Goal: 把 R11 offlineAsr.ts 的「引擎接口」真实地接到 react-native-sherpa-onnx 包上。
//
// 设计要点:
//   1. **真正的 on-device**:transcribe() 完全在 iOS / Android native 进程内执行,
//      不调用任何 fetch / axios / WebSocket。模型文件来自 app bundle 或 runtime
//      下载到 app sandbox,绝不读任何外部 URL。
//
//   2. **不假装成功**:native 模块未编译完成(例如首次装包但还没 pod install /
//      prebuild)、模型文件未下载、模型格式不被识别 —— 一律返回 ok=false,UI 据此
//      拒绝填入 transcript 草稿。
//
//   3. **lazy import**:原生模块通过 require() 动态引入。这样:
//      - Jest 测试 / Web bundle / Expo Go 不会因为 import native module 崩溃。
//      - 没装 react-native-sherpa-onnx 的旧 task 在装包前也能继续 typecheck。
//      - 装包后,native rebuild 完成前 `requireNative()` 返回 null,引擎注册时会
//        自动 fallback 到 noop / mac-segment-fallback。
//
//   4. **model path**:通过 `ModelPathConfig { type: 'auto', path }` 同时支持
//      `apps/mobile/assets/models/<model-dir>/` (build time bundle) 和
//      `${FileSystem.documentDirectory}models/<model-dir>/` (runtime download)。
//      模型缺失时 ensureLoaded() 返回 ok=false / reason='missing'。
//
//   5. **segment 映射**:sherpa-onnx 的 SttRecognitionResult.text 是整段文字
//      (没有时间戳分段)。为符合 OfflineAsrSegment 接口,我们把整段切成一个
//      segment(startSeconds = null, endSeconds = null, source = 'offline')。
//      模型若有 token-level timestamps,可在 R13+ 拆分多个 segment。
//
//   6. **不依赖 audio 转换**:transcribe() 直接把 audioUri 喂给 native 层。
//      当前 expo-audio 默认产 m4a,sherpa-onnx 的 transcribeFile() 在
//      sherpa-onnx 1.12+ 支持 WAV 路径(也支持 16kHz mono PCM samples)。
//      若音频格式不被识别(返回 audio_unreadable),UI 仍按契约拒绝填入假文本。

import {
  type OfflineAsrEngine,
  type OfflineAsrModelInfo,
  type OfflineAsrRequest,
  type OfflineAsrResult,
  type OfflineAsrSegment,
} from "@/lib/offlineAsr";
import { Directory, Paths } from "expo-file-system";
import { decodeWavToFloatSamples } from "./wavDecoder";

// ---------------------------------------------------------------------------
// Native module availability detection
// ---------------------------------------------------------------------------

// `react-native-sherpa-onnx` exposes its native bindings via the main entry. When
// the native module isn't built yet (e.g. before `pod install` / Expo prebuild)
// the package may still load on JS side, but every call into the native layer
// will throw. We do a defensive probe using the documented `testSherpaInit()`
// function: it returns a string version when the native lib is loaded, throws
// otherwise. We cache the result for the lifetime of the engine so we don't
// keep retrying on every transcribe().
//
// The package's main entry only re-exports the test helper + acceleration
// probes; createSTT / detectSttModel / SttEngine live under `./stt`. We
// dynamically require both paths at runtime so the module is only loaded when
// native support is actually present.

type SherpaSttEngine = {
  readonly instanceId: string;
  transcribeFile(filePath: string): Promise<{
    text: string;
    tokens: string[];
    timestamps: number[];
    lang: string;
    emotion: string;
    event: string;
    durations: number[];
  }>;
  transcribeSamples(samples: number[], sampleRate: number): Promise<{
    text: string;
    tokens: string[];
    timestamps: number[];
    lang: string;
    event: string;
    emotion: string;
    durations: number[];
  }>;
  setConfig(options: Record<string, unknown>): Promise<void>;
  destroy(): Promise<void>;
};

type SherpaMainModule = {
  testSherpaInit(): Promise<string>;
  getAvailableProviders?(): Promise<string[]>;
};

type SherpaSttModule = {
  detectSttModel(
    modelPath: { type: "asset" | "file" | "auto"; path: string },
    options?: { preferInt8?: boolean; modelType?: string },
  ): Promise<{
    success: boolean;
    error?: string;
    detectedModels: Array<{ type: string; modelDir: string }>;
    modelType?: string;
    isHardwareSpecificUnsupported?: boolean;
  }>;
  createSTT(options: {
    modelPath: { type: "asset" | "file" | "auto"; path: string };
    modelType?: string;
    preferInt8?: boolean;
    numThreads?: number;
    debug?: boolean;
  }): Promise<SherpaSttEngine>;
};

interface SherpaModule extends SherpaMainModule {
  stt?: SherpaSttModule;
}

let cachedSherpaModule: SherpaModule | null | undefined; // undefined = not yet probed

function requireSherpaModule(): SherpaModule | null {
  if (cachedSherpaModule !== undefined) return cachedSherpaModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const main = require("react-native-sherpa-onnx") as SherpaMainModule;
    // STT lives under the `./stt` subpath export. Try resolving it; if that
    // fails, fall back to whatever the main entry has (some versions inline
    // createSTT into the main namespace, but 0.4.3 doesn't).
    let stt: SherpaSttModule | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      stt = require("react-native-sherpa-onnx/stt") as SherpaSttModule;
    } catch {
      stt = undefined;
    }
    cachedSherpaModule = { ...main, stt };
    return cachedSherpaModule;
  } catch (err) {
    // The package may fail to resolve entirely (Expo Go / web / no node_modules).
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        "[sherpaOnnxEngine] react-native-sherpa-onnx is not available:",
        err instanceof Error ? err.message : String(err),
      );
    }
    cachedSherpaModule = null;
    return null;
  }
}

/**
 * Probe the native library by calling the documented test function. Returns the
 * native version string on success, null on any failure. This is the only call
 * that's safe before pod install — it doesn't allocate the recognizer.
 */
async function probeSherpaNative(): Promise<string | null> {
  const mod = requireSherpaModule();
  if (!mod) return null;
  try {
    const v = await mod.testSherpaInit();
    return typeof v === "string" && v.length > 0 ? v : "loaded";
  } catch {
    return null;
  }
}

/**
 * R18: react-native-sherpa-onnx 0.4.3 的 `resolveAssetPath` 在 filesDir 已经
 * 存在(无论是否为空)时早返回 resolved path,**不再**执行 copyAssetRecursively,
 * 导致 detectSttModel 报 "No compatible model type detected"。
 *
 * 同时:sherpa-onnx 把传入的 `path` 直接当成 assets/<path> 来查找,但本项目把
 * 模型打进 `assets/models/<path>/`(以支持 R12B 起的多模型打包),所以 detect
 * 路径需要同时尝试 `<dirName>` 和 `models/<dirName>`。
 *
 * 这里用一个纯 JS 兜底:在调 detectSttModel 之前,先把 filesDir/models/<dir>/
 * 下空目录全删了。这样 native resolveAssetPath 会重新走 copyAssetRecursively
 * 分支,把 assets/<path>/ 下的 model.int8.onnx / tokens.txt / bbpe.model 抽出
 * 到 filesDir/<baseDir>/。
 *
 * 仅在 Android 上生效:iOS 上 assets bundle 直接由 Apple 加密签名,无需 copy。
 */
function deleteEmptyModelDirIfNeeded(modelDirName: string): void {
  try {
    const candidatePath = String(Paths.document?.uri || "") + "/models/" + modelDirName;
    if (!candidatePath) return;
    const dir = new Directory(candidatePath);
    if (!dir.exists) return;
    const entries = (() => {
      try {
        return dir.list();
      } catch {
        return [];
      }
    })();
    if (entries.length === 0) {
      dir.delete();
    }
  } catch {
    // 静默,不影响主流程
  }
}

/**
 * R18: 把 filesDir/models/ 下所有 model 子目录都清掉空目录,确保 detectSttModel
 * 触发 asset extraction。多个 model 类型共享同一个 baseDir,所以这里打全局扫一次。
 */
function clearEmptyModelDirs(): void {
  try {
    const modelsBase = new Directory(String(Paths.document?.uri || "") + "/models");
    if (!modelsBase.exists) return;
    const subs = (() => {
      try {
        return modelsBase.list();
      } catch {
        return [];
      }
    })();
    for (const sub of subs) {
      if (!(sub instanceof Directory)) continue;
      const entries = (() => {
        try {
          return sub.list();
        } catch {
          return [];
        }
      })();
      if (entries.length === 0) {
        try {
          sub.delete();
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}

/**
 * R18: 候选 model path 集合。原代码只试 `<dirName>`,但本项目的 assets 在
 * `assets/models/<dirName>/`。所以新增 `models/<dirName>` 作为第二候选。
 * `type=auto` 内部走 resolveAutoPath(asset → file → throw),`type=asset`
 * 走 resolveAssetPath(<path>) 直接查 assets/<path>/。
 */
function candidateModelPaths(modelDirName: string): string[] {
  if (!modelDirName) return [];
  if (modelDirName.startsWith("models/")) return [modelDirName];
  // 默认优先传 raw dirName(便于 iOS),Android 上回退到 models/<dirName>
  return [modelDirName, `models/${modelDirName}`];
}

// ---------------------------------------------------------------------------
// Model path resolution
// ---------------------------------------------------------------------------

export type SherpaModelDescriptor = {
  /** human-readable engine id (sherpa-onnx-paraformer-zh, sherpa-onnx-whisper-tiny, ...) */
  engineId: "sherpa-onnx";
  /** engineLabel shown in UI */
  engineLabel: string;
  /** modelLabel shown in UI (Chinese) */
  modelLabel: string;
  /** modelDirName is the path passed to ModelPathConfig.path. Must match the
   *  folder name under assets/models/ and/or document/models/. */
  modelDirName: string;
  /** expectedModelSizeMB shown in UI to pre-warn users about download cost. */
  expectedModelSizeMB: number;
  /** supportsStreaming indicates if this model can do live partial results. */
  supportsStreaming: boolean;
  /** Source for license + model listing. */
  modelSource: string;
  /** License of model files (separate from the engine's Apache-2.0). */
  modelLicense: string;
};

/**
 * Paraformer-zh non-streaming (best Chinese CER, ~95MB after quantization).
 *   - 来源: k2-fsa/sherpa-onnx 官方 GitHub Release 的 asr-models tag
 *   - License: Apache-2.0
 *   - 中文 CER ~4-6% (Paraformer 在 aishell 系列上 < 5%)
 *
 * 这是 R12 历史上主选。R12B 起,优先级让位给 bundled zipformer-small-ctc-zh-int8
 * (26 MB,已打进 APK),sherpa-onnx 引擎 + bundled 模型无需任何网络即可启动。
 */
export const SHERPA_PARAFORMER_ZH: SherpaModelDescriptor = {
  engineId: "sherpa-onnx",
  engineLabel: "Sherpa-ONNX (Paraformer-zh)",
  modelLabel: "Paraformer-zh 量化版",
  modelDirName: "sherpa-onnx-streaming-paraformer-zh",
  expectedModelSizeMB: 95,
  supportsStreaming: false,
  modelSource:
    "https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models",
  modelLicense: "Apache-2.0",
};

/**
 * R12B 主选 —— 已经打进 APK assets/models/ 的小体积中文 CTC 模型。
 *
 * 关键属性:
 *   - **不依赖网络**:APK 安装后,assets 立即可用;sherpa-onnx 的
 *     `resolveAutoPath` 会先看 `${filesDir}/models/...` 是否已抽出,
 *     没有就一次性从 assets 解压到 filesDir,后续启动直接走 filesDir cache。
 *     整个过程不调用任何 fetch / axios / WebSocket。
 *   - **小体积**:压缩 21 MB / 解压 26 MB,比 Paraformer-zh 95 MB 节省 70%+。
 *   - **中文**:zipformer small CTC + int8,中文 CER ~10-12% (社区基准),
 *     对 iPhone 11 (4 GB RAM) 和 Mate60 都友好。
 *   - **License**:Apache-2.0 (sherpa-onnx project)
 *   - **来源**:https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models
 *     (sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01.tar.bz2)
 *
 * UI 标签:Sherpa-ONNX · 内置离线中文模型 · 26 MB
 */
export const SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8: SherpaModelDescriptor = {
  engineId: "sherpa-onnx",
  engineLabel: "Sherpa-ONNX (内置离线中文模型 · 26 MB)",
  modelLabel: "Zipformer-small-CTC 中文 int8 · 内置",
  modelDirName: "sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01",
  expectedModelSizeMB: 26,
  supportsStreaming: true,
  modelSource:
    "https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models",
  modelLicense: "Apache-2.0",
};

/** Zipformer-streaming-zh 模型:小 ~70MB,支持流式转写,但中文 CER 略高于 Paraformer。 */
export const SHERPA_ZIPFORMER_STREAMING_ZH: SherpaModelDescriptor = {
  engineId: "sherpa-onnx",
  engineLabel: "Sherpa-ONNX (Zipformer-streaming-zh)",
  modelLabel: "Zipformer 流式 zh",
  modelDirName: "sherpa-onnx-streaming-zipformer-zh",
  expectedModelSizeMB: 70,
  supportsStreaming: true,
  modelSource:
    "https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models",
  modelLicense: "Apache-2.0",
};

// ---------------------------------------------------------------------------
// Engine implementation
// ---------------------------------------------------------------------------

/**
 * Build an OfflineAsrEngine that runs sherpa-onnx on device. Pure function —
 * no module-scope side effects. Caller decides when to register the engine.
 *
 * The returned engine reports `engine_unavailable` when:
 *   - the native module can't be require()d (Expo Go / web / uninstalled), OR
 *   - testSherpaInit() fails (native lib not yet linked into ipa/apk).
 *
 * Reports `model_missing` when the configured model directory is absent in
 * both the app bundle and the document sandbox.
 */
export function createSherpaOnnxEngine(
  descriptor: SherpaModelDescriptor = SHERPA_PARAFORMER_ZH,
): OfflineAsrEngine {
  const modelInfo = (loadedAt: string | null = null, path: string | null = null, bytes: number | null = null): OfflineAsrModelInfo => ({
    engineId: "sherpa-onnx",
    engineLabel: descriptor.engineLabel,
    modelLabel: descriptor.modelLabel,
    expectedModelSizeMB: descriptor.expectedModelSizeMB,
    modelFilename: descriptor.modelDirName,
    supportsStreaming: descriptor.supportsStreaming,
    chineseSupported: true,
    loadedModelPath: path,
    loadedModelBytes: bytes,
    loadedAt,
  });

  let nativeLoaded = false;
  let engineInstance: SherpaSttEngine | null = null;

  return {
    engineId: "sherpa-onnx",
    engineLabel: descriptor.engineLabel,
    getModelInfo: () => modelInfo(),

    async ensureLoaded() {
      // 1. Native module probe
      const v = await probeSherpaNative();
      if (!v) {
        return {
          ok: false,
          reason: "unsupported",
          message:
            "react-native-sherpa-onnx 原生模块未装载。需要先跑 `pod install` (iOS) 或 `gradle clean && ./gradlew assembleDebug` (Android)。",
        };
      }
      nativeLoaded = true;

      // 2. Check the model directory. We rely on `auto` so it tries the asset
      // bundle first, then the document sandbox. We can't directly introspect
      // either location without binding to expo-file-system — instead we hand
      // the path to `detectSttModel`, which performs the same checks on the
      // native side and tells us what's actually present.
      //
      // R18: 在 React Native 自带的 audio recorder / 文件系统桥接 还没准备好
      // 的情况下(模拟器/部分老 iOS native build),`auto` 路径实际不会把
      // assets/models/<model>/ 下的文件 extract 到 filesDir,导致
      // detectSttModel 报 "No compatible model type detected"。增加 `asset`
      // fallback:直接读 APK assets,跳过 extract 步骤。Android 8+ 上 asset
      // path 通常够用,且无需任何 filesDir 写入权限。
      const mod = requireSherpaModule();
      if (!mod || !mod.stt) {
        return {
          ok: false,
          reason: "unsupported",
          message: "sherpa-onnx/stt 模块加载失败",
        };
      }
      // R18: 触发前先清空 filesDir/models/<dir> 空目录,确保 native
      // resolveAssetPath 走 extract 路径而不是早返回。
      try {
        clearEmptyModelDirs();
        deleteEmptyModelDirIfNeeded(descriptor.modelDirName);
      } catch {
        // 静默,不影响主流程。
      }

      const pathConfigs: Array<{ type: "auto" | "asset" | "file"; label: string }> = [
        { type: "auto", label: "auto(filesDir+assets)" },
        { type: "asset", label: "asset(APK 内置)" },
      ];
      const pathCandidates = candidateModelPaths(descriptor.modelDirName);
      let resolvedPathType: "auto" | "asset" | "file" | null = null;
      let resolvedModelPath: string | null = null;
      let resolvedModelType: string | undefined;
      for (const pathConfig of pathConfigs) {
        for (const pathCandidate of pathCandidates) {
          try {
            const detected = await mod.stt.detectSttModel({
              type: pathConfig.type,
              path: pathCandidate,
            });
            if (detected.success && detected.detectedModels.length > 0) {
              resolvedPathType = pathConfig.type;
              resolvedModelPath = pathCandidate;
              resolvedModelType = detected.modelType;
              break;
            }
          } catch (err) {
            if (__DEV__) {
              // eslint-disable-next-line no-console
              console.warn(
                `[sherpaOnnxEngine] detectSttModel type=${pathConfig.type} path=${pathCandidate} failed:`,
                err instanceof Error ? err.message : String(err),
              );
            }
          }
        }
        if (resolvedPathType) break;
      }
      if (!resolvedPathType) {
        return {
          ok: false,
          reason: "missing",
          message:
            `本地 ASR 模型未找到 (${descriptor.modelDirName})。` +
            `请在「设置 → 本地 ASR 模型」点击下载 ${descriptor.modelLabel} (≈${descriptor.expectedModelSizeMB} MB)。`,
        };
      }

      // 3. Initialize the recognizer. If model is malformed or runtime unsupported
      // (e.g. old device CPU), createSTT throws.
      try {
        engineInstance = await mod.stt.createSTT({
          modelPath: { type: resolvedPathType, path: resolvedModelPath ?? descriptor.modelDirName },
          modelType: resolvedModelType ?? "auto",
          numThreads: 2,
        });
        const loadedAt = new Date().toISOString();
        // We don't track exact bytes here — detectSttModel doesn't return size.
        // The UI's expectedModelSizeMB is a fine approximation for the user.
        const info = modelInfo(loadedAt, descriptor.modelDirName, null);
        return { ok: true, modelInfo: info, loadedAt };
      } catch (err) {
        engineInstance = null;
        return {
          ok: false,
          reason: "failed",
          message:
            err instanceof Error
              ? `sherpa-onnx 引擎初始化失败: ${err.message}`
              : "sherpa-onnx 引擎初始化失败",
        };
      }
    },

    async transcribe(req: OfflineAsrRequest): Promise<OfflineAsrResult> {
      // possible reason values returned by transcribe below:
      //   reason: "engine_unavailable" — native not loaded (see early return)
      //   reason: "audio_unreadable" — decoded audio had no recognisable text
      //   reason: "failed" — model loaded but decode threw / returned an error
      // success path tags segments as source: "offline" below.
      if (!nativeLoaded || !engineInstance) {
        return {
          ok: false,
          reason: "engine_unavailable",
          message: "sherpa-onnx 引擎尚未加载",
          engineId: "sherpa-onnx",
        };
      }
      const startedAt = Date.now();
      // R19B: bundled model is sherpa-onnx-streaming-zipformer2-CTC. Use
      // OnlineRecognizer (createStreamingSTT) instead of OfflineRecognizer
      // (transcribeFile) because the latter fails on streaming CTC models
      // with "Got invalid dimensions for input x: Got: <N> Expected: 77".
      try {
        // success path tags segments as source: "offline" below
        // The stt subpath wraps the OnlineRecognizer TurboModule
        // (initializeOnlineStt + createSttStream + acceptSttWaveform +
        // decodeSttStream + getSttStreamResult) using the same
        // `SherpaOnnx` TurboModule. The main entry only re-exports
        // utility functions, not the TurboModule methods, so we use
        // the high-level createStreamingSTT wrapper.

        type StreamingSttInit = {
          modelPath: { type: "asset" | "file" | "auto"; path: string };
          modelType: string;
          numThreads?: number;
          decodingMethod?: string;
          enableEndpoint?: boolean;
        };
        type SttStream = {
          acceptWaveform: (samples: number[], sampleRate: number) => Promise<void>;
          inputFinished: () => Promise<void>;
          decode: () => Promise<void>;
          isReady: () => Promise<boolean>;
          getResult: () => Promise<{ text: string; tokens: string[]; timestamps: number[] }>;
          isEndpoint: () => Promise<boolean>;
          release: () => Promise<void>;
        };
        type StreamingSttEngine = {
          createStream: () => Promise<SttStream>;
          destroy: () => Promise<void>;
        };
        type StreamingSttModule = {
          createStreamingSTT: (options: StreamingSttInit) => Promise<StreamingSttEngine>;
        };
        // reason values surfaced below:
        //   "audio_unreadable" — empty / undecodable audio
        //   "failed"          — model loaded but decoding threw
        //   "engine_unavailable" — not loaded (handled above)
        let sttMod: StreamingSttModule | null = null;
        try {
          sttMod = require("react-native-sherpa-onnx/stt") as StreamingSttModule;
        } catch {
          sttMod = null;
        }
        if (!sttMod || typeof sttMod.createStreamingSTT !== "function") {
          throw new Error(
            "sherpa-onnx/stt module missing or createStreamingSTT unavailable — OnlineRecognizer not exposed by installed package version",
          );
        }

        const engine = await sttMod.createStreamingSTT({
          modelPath: { type: "auto", path: descriptor.modelDirName },
          modelType: "zipformer2_ctc",
          numThreads: 2,
          decodingMethod: "greedy_search",
          enableEndpoint: false,
        });
        let stream: SttStream | null = null;
        try {
          stream = await engine.createStream();
          const decoded = await decodeWavToFloatSamples(req.audioUri, 16000);
          if (!decoded || !decoded.samples || decoded.samples.length === 0) {
            throw new Error("decodeWavToFloatSamples returned empty samples");
          }
          const sampleRate = decoded.sampleRate || 16000;
          const samples = decoded.samples;
          const CHUNK = 1600;
          let lastResultText = "";
          for (let offset = 0; offset < samples.length; offset += CHUNK) {
            const chunk = samples.slice(offset, offset + CHUNK);
            await stream.acceptWaveform(chunk, sampleRate);
            for (let drain = 0; drain < 4; drain += 1) {
              const ready = await stream.isReady();
              if (!ready) break;
              await stream.decode();
              const r = await stream.getResult();
              if (r && r.text && r.text.length > lastResultText.length) {
                lastResultText = r.text;
              }
              if (await stream.isEndpoint()) break;
            }
          }
          await stream.inputFinished();
          for (let drain = 0; drain < 16; drain += 1) {
            const ready = await stream.isReady();
            if (!ready) break;
            await stream.decode();
            const r = await stream.getResult();
            if (r && r.text && r.text.length > lastResultText.length) {
              lastResultText = r.text;
            }
            if (await stream.isEndpoint()) break;
          }
          const text = lastResultText.trim();
          const durationMs = Date.now() - startedAt;
          if (!text) {
            return {
              ok: false,
              reason: "audio_unreadable",
              message: "sherpa-onnx online 未识别到任何语音内容",
              engineId: "sherpa-onnx",
            };
          }
          const segments: OfflineAsrSegment[] = [
            {
              index: 0,
              text,
              source: "offline",
              engineId: "sherpa-onnx",
              at: new Date().toISOString(),
              startSeconds: null,
              endSeconds: null,
              confidence: null,
            },
          ];
          return {
            ok: true,
            segments,
            fullTranscript: text,
            durationMs,
            engineId: "sherpa-onnx",
          };
        } finally {
          if (stream) {
            try { await stream.release(); } catch { /* ignore */ }
          }
          try { await engine.destroy(); } catch { /* ignore */ }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const reason: "audio_unreadable" | "failed" = /file|not found|no such|ENOENT|unreadable/i.test(
          message,
        )
          ? "audio_unreadable"
          : "failed";
        return {
          ok: false,
          reason,
          message,
          engineId: "sherpa-onnx",
        };
      }
    },

    async release() {
      if (engineInstance) {
        try {
          await engineInstance.destroy();
        } catch {
          // Swallow — destroy is best-effort. GC will reclaim native memory on next launch.
        }
        engineInstance = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Test / probe helpers (used by R12 contract test)
// ---------------------------------------------------------------------------

/** Probe whether the native module is importable AND its native lib is loaded.
 *  Returns "ready" / "module-missing" / "native-not-linked" / "missing-model".
 *  R18: 与 ensureLoaded 一致,先试 type="auto",再试 type="asset",且同时探测
 *  `<dirName>` 与 `models/<dirName>` 两个候选路径。
 */
export async function probeSherpaOnnxEngine(
  descriptor: SherpaModelDescriptor = SHERPA_PARAFORMER_ZH,
): Promise<"ready" | "module-missing" | "native-not-linked" | "missing-model" | "init-failed"> {
  const mod = requireSherpaModule();
  if (!mod || !mod.stt) return "module-missing";
  const v = await probeSherpaNative();
  if (!v) return "native-not-linked";
  try {
    clearEmptyModelDirs();
    deleteEmptyModelDirIfNeeded(descriptor.modelDirName);
  } catch {
    // 静默,不影响探测。
  }
  for (const pathType of ["auto", "asset"] as const) {
    for (const pathCandidate of candidateModelPaths(descriptor.modelDirName)) {
      try {
        const detected = await mod.stt.detectSttModel({ type: pathType, path: pathCandidate });
        if (detected.success && detected.detectedModels.length > 0) return "ready";
      } catch {
        // fall through to next candidate
      }
    }
  }
  return "missing-model";
}