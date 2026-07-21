// 2026-07-04 — R12: Whisper.rn fallback engine adapter.
//
// Goal: 当 sherpa-onnx-react-native 不可用 / 装包失败 / native module 编译失败
// 时,fallback 到 whisper.rn 包继续提供本地 ASR。
//
// 设计要点:
//   - 与 sherpaOnnxEngine.ts 同样的 lazy-require / 探测 / 不假装成功模式。
//   - Whisper 模型比 Paraformer 大,中文 CER 高(whisper-tiny 12-15% / base 14-18%),
//     但社区最成熟(793 stars,mybigday 维护,2026-05 还在更新 0.6.0)。
//   - Whisper.rn 的 initWhisper() 需要 filePath 指向 ggml-*.bin 模型文件,
//     以及 (iOS) 可选 CoreML 资产。模型路径走同样的 "auto" 思路(先 bundle
//     后 document sandbox)。
//   - transcribe() 返回的 segments[] 带有 t0/t1 时间戳,所以我们可以填
//     startSeconds / endSeconds,这是比 sherpaOnnxEngine 更完整的 mapping。

import {
  type OfflineAsrEngine,
  type OfflineAsrModelInfo,
  type OfflineAsrRequest,
  type OfflineAsrResult,
  type OfflineAsrSegment,
} from "@/lib/offlineAsr";

type WhisperSegment = {
  text: string;
  t0: number;
  t1: number;
};

type WhisperTranscribeResult = {
  result: string;
  segments: WhisperSegment[];
};

type WhisperContext = {
  ptr: number;
  id: number;
  gpu: boolean;
  reasonNoGPU: string;
  transcribe(
    filePathOrBase64: string,
    options?: {
      language?: string;
      translate?: boolean;
      maxThreads?: number;
    },
  ): { stop: () => Promise<void>; promise: Promise<WhisperTranscribeResult> };
  release(): Promise<void>;
};

type WhisperModule = {
  initWhisper(opts: {
    filePath: string | number;
    isBundleAsset?: boolean;
    useGpu?: boolean;
    useCoreMLIos?: boolean;
    useFlashAttn?: boolean;
    coreMLModelAsset?: {
      filename: string;
      assets: Array<string | number>;
    };
  }): Promise<WhisperContext>;
  releaseAllWhisper(): Promise<void>;
  libVersion: string;
  isUseCoreML: boolean;
};

let cachedWhisperModule: WhisperModule | null | undefined;

function requireWhisperModule(): WhisperModule | null {
  if (cachedWhisperModule !== undefined) return cachedWhisperModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("whisper.rn") as WhisperModule;
    cachedWhisperModule = mod;
    return mod;
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        "[whisperRnEngine] whisper.rn is not available:",
        err instanceof Error ? err.message : String(err),
      );
    }
    cachedWhisperModule = null;
    return null;
  }
}

export type WhisperModelDescriptor = {
  /** engine id — kept as "sherpa-onnx" type family so UI distinguishes fallback. */
  engineLabel: string;
  /** model file name (without directory) — the ggml-*.bin file. */
  modelFilename: string;
  /** expected size in MB */
  expectedModelSizeMB: number;
  /** human-readable label for UI */
  modelLabel: string;
  /** source URL */
  modelSource: string;
  /** model license */
  modelLicense: string;
};

/**
 * Whisper tiny (Chinese supported via multilingual variant) — smallest model,
 * ~75 MB. We pick tiny because the iOS app bundle size is constrained.
 * Bigger models (base/small) are documented as fallback options if quality
 * turns out insufficient.
 */
export const WHISPER_TINY_MULTILINGUAL: WhisperModelDescriptor = {
  engineLabel: "Whisper.rn (tiny multilingual)",
  modelFilename: "ggml-tiny.bin",
  expectedModelSizeMB: 75,
  modelLabel: "Whisper tiny 多语言",
  modelSource: "https://huggingface.co/ggerganov/whisper.cpp/tree/main",
  modelLicense: "MIT",
};

export const WHISPER_BASE_MULTILINGUAL: WhisperModelDescriptor = {
  engineLabel: "Whisper.rn (base multilingual)",
  modelFilename: "ggml-base.bin",
  expectedModelSizeMB: 142,
  modelLabel: "Whisper base 多语言",
  modelSource: "https://huggingface.co/ggerganov/whisper.cpp/tree/main",
  modelLicense: "MIT",
};

/**
 * Build an OfflineAsrEngine backed by whisper.rn. Pure function — no module
 * side effects. Caller decides when to register.
 */
export function createWhisperRnEngine(
  descriptor: WhisperModelDescriptor = WHISPER_TINY_MULTILINGUAL,
): OfflineAsrEngine {
  const engineLabel = descriptor.engineLabel;
  const modelLabel = descriptor.modelLabel;

  const buildModelInfo = (
    loadedAt: string | null = null,
    path: string | null = null,
  ): OfflineAsrModelInfo => ({
    engineId: "whisper-rn",
    engineLabel,
    modelLabel,
    expectedModelSizeMB: descriptor.expectedModelSizeMB,
    modelFilename: descriptor.modelFilename,
    supportsStreaming: true, // whisper.rn has transcribeRealtime()
    chineseSupported: true,
    loadedModelPath: path,
    loadedModelBytes: null,
    loadedAt,
  });

  let context: WhisperContext | null = null;

  return {
    engineId: "whisper-rn",
    engineLabel,
    getModelInfo: () => buildModelInfo(),

    async ensureLoaded() {
      const mod = requireWhisperModule();
      if (!mod) {
        return {
          ok: false,
          reason: "unsupported",
          message:
            "whisper.rn 模块未装载。需要 `pod install` / `gradlew assembleDebug` 后才能使用本地 ASR fallback。",
        };
      }
      try {
        // Try asset bundle first, then document sandbox. We can't directly probe
        // either path; we hand both to initWhisper via require() / absolute path.
        // For now we use isBundleAsset=true with the modelFilename — Metro will
        // resolve it from the JS bundle. If model is not in bundle, the call
        // throws "no such file" and we surface model_missing.
        context = await mod.initWhisper({
          filePath: descriptor.modelFilename,
          isBundleAsset: true,
          useGpu: false, // mobile devices: GPU off is safer for first cut
        });
        const loadedAt = new Date().toISOString();
        const info = buildModelInfo(loadedAt, descriptor.modelFilename);
        return { ok: true, modelInfo: info, loadedAt };
      } catch (err) {
        context = null;
        const message = err instanceof Error ? err.message : String(err);
        // Distinguish "model not in bundle" from other failures.
        if (/asset|no such|not found|cannot find|ENOENT|404/i.test(message)) {
          return {
            ok: false,
            reason: "missing",
            message:
              `Whisper 模型未找到 (${descriptor.modelFilename})。` +
              `请在「设置 → 本地 ASR 模型」点击下载 ${modelLabel} (≈${descriptor.expectedModelSizeMB} MB)。`,
          };
        }
        return {
          ok: false,
          reason: "failed",
          message: `whisper.rn 引擎初始化失败: ${message}`,
        };
      }
    },

    async transcribe(req: OfflineAsrRequest): Promise<OfflineAsrResult> {
      if (!context) {
        return {
          ok: false,
          reason: "engine_unavailable",
          message: "whisper.rn 引擎尚未加载",
          engineId: "whisper-rn",
        };
      }
      try {
        const startedAt = Date.now();
        const { promise } = context.transcribe(req.audioUri, {
          language: req.language === "zh-CN" ? "zh" : req.language || "auto",
        });
        const result = await promise;
        const durationMs = Date.now() - startedAt;
        const text = (result?.result || "").trim();
        if (!text) {
          return {
            ok: false,
            reason: "audio_unreadable",
            message: "whisper.rn 未识别到任何语音内容",
            engineId: "whisper-rn",
          };
        }
        const segments: OfflineAsrSegment[] = (result?.segments || []).map(
          (seg: WhisperSegment, idx: number) => ({
            index: idx,
            text: (seg.text || "").trim(),
            source: "offline" as const,
            engineId: "whisper-rn",
            at: new Date().toISOString(),
            startSeconds: typeof seg.t0 === "number" ? seg.t0 / 100 : null,
            endSeconds: typeof seg.t1 === "number" ? seg.t1 / 100 : null,
            confidence: null,
          }),
        );
        // Whisper sometimes returns no segments but only top-level text. In
        // that case synthesize a single segment to keep the OfflineAsrSegment
        // contract consistent.
        if (segments.length === 0) {
          segments.push({
            index: 0,
            text,
            source: "offline",
            engineId: "whisper-rn",
            at: new Date().toISOString(),
            startSeconds: null,
            endSeconds: null,
            confidence: null,
          });
        }
        return {
          ok: true,
          segments,
          fullTranscript: segments.map((s) => s.text).join(" "),
          durationMs,
          engineId: "whisper-rn",
        };
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
          engineId: "whisper-rn",
        };
      }
    },

    async release() {
      if (context) {
        try {
          await context.release();
        } catch {
          // best-effort
        }
        context = null;
      }
    },
  };
}

/**
 * Probe whether whisper.rn is importable. Does NOT initialize the context.
 * Used by R12 contract test to distinguish "package missing" from
 * "native module not built" from "engine initialized".
 */
export async function probeWhisperRnEngine(): Promise<
  "ready" | "module-missing" | "native-not-linked" | "missing-model" | "init-failed"
> {
  const mod = requireWhisperModule();
  if (!mod) return "module-missing";
  // No cheap probe function like sherpa's testSherpaInit(). The cleanest way
  // to detect native-not-linked is to try initWhisper() with a known-bad path
  // — if it throws "no such file" the module IS linked but model is missing;
  // if it throws a TurboModule "not found" error the native side is missing.
  try {
    const ctx = await mod.initWhisper({
      filePath: "__probe__.bin",
      isBundleAsset: true,
    });
    // If somehow it succeeded, immediately release.
    await ctx.release().catch(() => undefined);
    return "ready";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/asset|no such|not found|cannot find|ENOENT|404|__probe__/i.test(msg)) {
      return "missing-model";
    }
    // Likely TurboModule not found, or native library not loaded.
    if (/TurboModule|NativeModule|RNGestureHandler|could not be found/i.test(msg)) {
      return "native-not-linked";
    }
    return "init-failed";
  }
}