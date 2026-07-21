// 2026-07-04 — R12B: Native offline ASR engine registry.
//
// 单一入口 `tryRegisterNativeOfflineAsr()`,被 App.tsx 在启动时调用。
// 它按优先级顺序尝试把真实 native 引擎装载到 offlineAsr 单例里:
//
//   1. sherpa-onnx-react-native + bundled SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8
//      (主选 — 26 MB 已打进 APK assets/models/,首启动零网络)
//   2. sherpa-onnx-react-native + SHERPA_PARAFORMER_ZH
//      (兜底 — 95 MB,需运行时下载)
//   3. whisper.rn              (备选引擎 — 社区最成熟)
//   4. (already-installed) mac-segment-fallback — R9B polling 兜底
//
// 每一步都做探测 → 不假装成功。若所有 native 引擎都不可用,该函数返回 false,
// offlineAsr 仍保持 mac-segment-fallback 引擎,UI 显示「远端片段兜底」语义。

import {
  setOfflineAsrEngine,
  setOfflineAsrReady,
  type OfflineAsrEngine,
} from "@/lib/offlineAsr";
import {
  createSherpaOnnxEngine,
  probeSherpaOnnxEngine,
  SHERPA_PARAFORMER_ZH,
  SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8,
} from "./sherpaOnnxEngine";
import {
  createWhisperRnEngine,
  probeWhisperRnEngine,
  WHISPER_TINY_MULTILINGUAL,
} from "./whisperRnEngine";

export type NativeEngineRegistrationResult =
  | { registered: true; engineId: "sherpa-onnx" | "whisper-rn"; engineLabel: string }
  | { registered: false; reason: string };

/**
 * Attempt to register the best available native offline ASR engine. Safe to
 * call from App.tsx useEffect — never throws, never blocks UI for more than
 * a few hundred ms.
 *
 * This function is idempotent: calling it twice will re-probe and re-register.
 * In dev / test environments (where native modules aren't built), it returns
 * `registered: false` and leaves offlineAsr on its default
 * mac-segment-fallback engine.
 *
 * R12B 优先级(R12 已把 bundled zipformer 加进来):
 *   1. sherpa-onnx + **bundled** SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8 (主选)
 *      —— 模型文件 26 MB 已经打进 APK assets,首启动零网络依赖。
 *   2. sherpa-onnx + SHERPA_PARAFORMER_ZH (大模型,需运行时下载,兜底)
 *   3. whisper.rn + WHISPER_TINY_MULTILINGUAL (备选引擎)
 *   4. mac-segment-fallback (R5B polling 远端兜底)
 */
export async function tryRegisterNativeOfflineAsr(): Promise<NativeEngineRegistrationResult> {
  // Probe 1 (R12B): sherpa-onnx + bundled zipformer small CTC zh int8 (26 MB)。
  //   APK 已经把模型打进 assets/models/<modelDirName>/,首次启动 detectSttModel
  //   会直接从 assets 抽出,后续启动走 filesDir cache —— 全部本地 IO,无网络。
  try {
    const bundledProbe = await probeSherpaOnnxEngine(
      SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8,
    );
    if (bundledProbe === "ready") {
      const engine = createSherpaOnnxEngine(SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8);
      const loaded = await engine.ensureLoaded();
      if (loaded.ok) {
        setOfflineAsrEngine(engine);
        // R19: setOfflineAsrEngine resets status to "uninitialized" by design —
        // flip it back to "ready" once ensureLoaded has actually succeeded so
        // UI's offlineAsrReady check (status === "ready" && engineId in
        // {sherpa-onnx, whisper-rn}) lights up the recorder workbench.
        setOfflineAsrReady();
        return {
          registered: true,
          engineId: "sherpa-onnx",
          engineLabel: SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8.engineLabel,
        };
      }
      // Model found but init failed — fall through to next engine.
    }
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        "[engines] sherpa-onnx bundled probe crashed, falling back:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Probe 2: sherpa-onnx + Paraformer-zh (R12 主选,95 MB,需运行时下载)。
  //   这里保留路径以兼容没有 bundled zipformer 的旧 build,以及用户手动把
  //   Paraformer 模型塞进 document 沙盒的场景。
  try {
    const sherpaProbe = await probeSherpaOnnxEngine(SHERPA_PARAFORMER_ZH);
    if (sherpaProbe === "ready") {
      const engine = createSherpaOnnxEngine(SHERPA_PARAFORMER_ZH);
      const loaded = await engine.ensureLoaded();
      if (loaded.ok) {
        setOfflineAsrEngine(engine);
        setOfflineAsrReady();
        return {
          registered: true,
          engineId: "sherpa-onnx",
          engineLabel: SHERPA_PARAFORMER_ZH.engineLabel,
        };
      }
    }
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        "[engines] sherpa-onnx paraformer probe crashed, falling back:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Probe 3: whisper.rn fallback
  try {
    const whisperProbe = await probeWhisperRnEngine();
    if (whisperProbe === "ready") {
      const engine = createWhisperRnEngine(WHISPER_TINY_MULTILINGUAL);
      const loaded = await engine.ensureLoaded();
      if (loaded.ok) {
        setOfflineAsrEngine(engine);
        setOfflineAsrReady();
        return {
          registered: true,
          engineId: "whisper-rn",
          engineLabel: WHISPER_TINY_MULTILINGUAL.engineLabel,
        };
      }
    }
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        "[engines] whisper.rn probe crashed, falling back:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    registered: false,
    reason:
      "未找到可用的本地 ASR 引擎。sherpa-onnx 和 whisper.rn 模块都未完成 native rebuild。请跑 `pod install` (iOS) 或 `./gradlew assembleDebug` (Android) 后重新启动 App。",
  };
}

// Re-export the descriptor / factory functions so other modules can use them
// directly without reaching into individual engine files.
export {
  createSherpaOnnxEngine,
  probeSherpaOnnxEngine,
  SHERPA_PARAFORMER_ZH,
  SHERPA_ZIPFORMER_STREAMING_ZH,
  SHERPA_BUNDLED_ZIPFORMER_SMALL_CTC_ZH_INT8,
} from "./sherpaOnnxEngine";
export {
  createWhisperRnEngine,
  probeWhisperRnEngine,
  WHISPER_TINY_MULTILINGUAL,
  WHISPER_BASE_MULTILINGUAL,
} from "./whisperRnEngine";

/**
 * Build a no-op OfflineAsrEngine that always reports engine_unavailable. This
 * is the last-resort fallback before mac-segment-fallback — used in jest
 * tests and the web bundle where neither sherpa nor whisper modules exist.
 *
 * Mirrors the contract of `noopEngine` exported from offlineAsr.ts, but lives
 * here so R12 contract tests can grep the engines/ directory for the
 * registration path without depending on offlineAsr.ts internals.
 */
export function createUnavailableStubEngine(engineId: string, message: string): OfflineAsrEngine {
  return {
    engineId: "noop",
    engineLabel: engineId,
    getModelInfo: () => ({
      engineId: "noop",
      engineLabel: engineId,
      modelLabel: message,
      expectedModelSizeMB: 0,
      modelFilename: "",
      supportsStreaming: false,
      chineseSupported: true,
      loadedModelPath: null,
      loadedModelBytes: null,
      loadedAt: null,
    }),
    ensureLoaded: async () => ({ ok: false, reason: "unsupported", message }),
    transcribe: async () => ({
      ok: false,
      reason: "engine_unavailable",
      message,
      engineId: "noop",
    }),
    release: async () => undefined,
  };
}