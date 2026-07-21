// 2026-07-02 — R5C: 全屏 Recorder Workspace.
//
// 2026-07-06 — R17: 新增 pause / resume / stop 控制 + 波形可视化;明确区分
//   - 本地 ASR 主路径 (sherpa-onnx / whisper.rn): UI 用绿色「本地 ASR · 模型」
//   - 远端兜底 (mac-segment-fallback): UI 红色角标「远端兜底」+ reason
//   - 引擎未就绪 (noop / missing / failed): UI 红色「未就绪」+ lastError 详情
// 任何状态下都不再以"Mac 后台转写"作为主路径 copy。
import { useCallback, useEffect, useRef } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Color, Radius, Space, Type } from "@/constants/design";
import { Button } from "@/components/Button";
import { useRecorder } from "@/lib/RecorderContext";
import { Haptics } from "@/lib/haptics";

type RecorderWorkspaceProps = {
  // 父组件可提供 minimizable / closeable; 默认都启用。
  onCloseRequest?: () => void;
};

export function RecorderWorkspace({ onCloseRequest }: RecorderWorkspaceProps) {
  const { state, actions } = useRecorder();
  const { mode, minimized, seconds, paused, transcript, title, audioUri, durationSeconds,
    previewMarkdown, previewHtml, previewTab, lastError, totalChunks, uploadedChunks,
    segmentsCount, localSegmentsCount, recorderSessionId, recorderSessionError, transcriptionProvider,
    offlineAsr, ingest } = state;

  const onMinimize = useCallback(() => {
    Haptics.tick();
    actions.minimize();
  }, [actions]);

  const onExit = useCallback(() => {
    Haptics.warn();
    if (onCloseRequest) onCloseRequest();
    else actions.close();
  }, [actions, onCloseRequest]);

  // R17: pause/resume/stop handlers. These mirror the inline workbench controls
  // in TodayConsoleScreen so the full-screen workspace shows the same Yuanbao-
  // style audio header.
  const onPause = useCallback(() => {
    Haptics.tick();
    actions.setPaused(true);
  }, [actions]);

  const onResume = useCallback(() => {
    Haptics.tick();
    actions.setPaused(false);
  }, [actions]);

  const onStopAndPreview = useCallback(() => {
    Haptics.success();
    // 通知父组件,父组件的 onCloseRequest 默认会切回 record tab 并触发
    // TodayConsoleScreen 的 stopVoiceRecording。这里 workspace 只标记状态。
    actions.setPaused(false);
    if (onCloseRequest) onCloseRequest();
  }, [actions, onCloseRequest]);

  // 简易的"录音中"波形可视化:用 8 个固定高度 + 秒数驱动颜色明暗,避免引入
  // 新的原生模块。R18 可用 expo-av meter 替换为真实音频幅度。
  const waveformBars = useRef<number[]>([0.3, 0.55, 0.7, 0.85, 0.65, 0.45, 0.6, 0.4]);
  useEffect(() => {
    if (mode !== "recording" || paused) return undefined;
    const t = setInterval(() => {
      // 持续滚动一组伪随机高度,视觉上"波动";以秒为种子可重现
      const seed = Math.floor(performance.now() / 220) % 8;
      waveformBars.current = waveformBars.current.map((_, i) => {
        const v = 0.3 + Math.abs(Math.sin((seed + i) * 1.3)) * 0.6;
        return v;
      });
    }, 220);
    return () => clearInterval(t);
  }, [mode, paused]);

  if (minimized) return null;
  if (mode === "closed") return null;

  const recording = mode === "recording" || (mode === "transcribing" && !previewMarkdown);
  const transcribing = mode === "transcribing";
  const previewing = mode === "preview" || mode === "saving" || mode === "saved";
  const minSec = Math.floor(seconds / 60);
  const sec = seconds % 60;
  const prettyTime = `${String(minSec).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  // R11/R17: 旧 transcriptionProvider 不再作为主路径信号;若 Provider 还是 null
  // (即从未配对过),UI 直接用 offlineAsr 状态机驱动文案。远端工作台转写 /
  // CloudBase 中继只作为「远端兜底」出现在 mac-segment-fallback 引擎的描述里。
  const offlineStatus = offlineAsr.status;
  const offlineEngineId = offlineAsr.engineId;
  const offlineDescribe = offlineAsr.describe;
  const isOfflineEngineReady =
    offlineStatus === "ready" &&
    (offlineEngineId === "sherpa-onnx" || offlineEngineId === "whisper-rn");
  const isMacFallback =
    offlineStatus === "ready" && offlineEngineId === "mac-segment-fallback";
  // R17: 三种状态的「诊断条」颜色,顶部 statusCard 直接用
  const diagnosticTone: "ok" | "warn" | "danger" = isOfflineEngineReady
    ? "ok"
    : isMacFallback
      ? "warn"
      : "danger";
  const providerLabel = isOfflineEngineReady
    ? `本地 ASR · ${offlineAsr.modelLabel || offlineEngineId}`
    : isMacFallback
      ? "本地引擎未安装 · 远端片段兜底"
      : offlineStatus === "missing"
        ? offlineAsr.expectedModelSizeMB
          ? `本地模型未安装 (${offlineAsr.expectedModelSizeMB} MB)`
          : "本地模型未安装"
        : offlineStatus === "loading"
          ? "本地模型加载中"
          : offlineStatus === "transcribing"
            ? "本地 ASR 转写中"
            : offlineStatus === "failed"
              ? `本地 ASR 失败: ${offlineAsr.lastError || "未知原因"}`
              : offlineStatus === "uninitialized"
                ? "本地 ASR 引擎未注册"
                : offlineDescribe;
  const providerToneColor = diagnosticTone === "ok"
    ? Color.okInk || "#0f766e"
    : diagnosticTone === "warn"
      ? Color.warnInk || "#b45309"
      : Color.dangerInk || "#dc2626";
  const providerToneBg = diagnosticTone === "ok"
    ? (Color.okSoft || "#ecfdf5")
    : diagnosticTone === "warn"
      ? (Color.warnSoft || "#fff7ed")
      : (Color.dangerSoft || "#fef2f2");

  return (
    <SafeAreaView style={styles.shell} edges={["top", "bottom"]} testID="mobile-recorder-workspace-page">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="最小化语音录音工作台"
          onPress={onMinimize}
          testID="mobile-recorder-workspace-minimize"
          style={styles.headerBtn}
        >
          <Text style={styles.headerBtnText}>最小化</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.kicker}>语音录音</Text>
          <Text style={styles.title}>{recording ? "录音中" : transcribing ? "后台转写" : previewing ? "预览并确认入库" : "语音工作台"}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭语音录音工作台"
          onPress={onExit}
          testID="mobile-recorder-workspace-close"
          style={[styles.headerBtn, styles.headerBtnDanger]}
        >
          <Text style={[styles.headerBtnText, styles.headerBtnDangerText]}>退出</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.body}
          testID="mobile-recorder-workspace-scroll"
        >
          {/* 1. 状态 + 时长 卡片 */}
          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={[styles.dot, paused && styles.dotPaused]} />
              <Text style={styles.statusLabel}>
                {recording
                  ? paused ? "已暂停" : "录音中"
                  : transcribing
                    ? offlineStatus === "transcribing"
                      ? "本地 ASR 转写中"
                      : offlineStatus === "ready" && offlineEngineId === "mac-segment-fallback"
                        ? "拉取远端转写片段中"
                        : "等待本地 ASR 引擎"
                    : mode === "saving"
                      ? "正在入库"
                      : mode === "saved"
                        ? "已生成 Markdown + HTML"
                        : "等待确认入库"}
              </Text>
            </View>
            <Text style={styles.timer}>{prettyTime}</Text>
            <Text style={styles.statusMeta} testID="mobile-recorder-offline-asr-status">
              {durationSeconds ? `录音时长 ${Math.round(durationSeconds)}s` : "未采集音频"} · {providerLabel}
            </Text>
            {totalChunks > 0 ? (
              <Text style={styles.statusMeta} testID="mobile-recorder-asr-segment-meta">
                已上传 chunks {uploadedChunks} / {totalChunks} · 本地 ASR 段 {localSegmentsCount} · 远端兜底段 {segmentsCount}
                {recorderSessionId ? ` · session ${recorderSessionId.slice(0, 8)}…` : " · session 未建立"}
              </Text>
            ) : null}
            {recorderSessionError ? (
              <Text style={styles.warnText} testID="mobile-recorder-workspace-session-error">
                R5B 会话建立失败: {recorderSessionError}（本地草稿仍可继续编辑并预览，确认入库会尝试再次创建会话）
              </Text>
            ) : null}

            {/* R17: 波形可视化(Yuanbao 风格)。录音中且未暂停时 8 个柱形在波动,
                暂停时变静态暗色,停止后整行隐藏。 */}
            {recording ? (
              <View style={styles.waveformRow} testID="mobile-recorder-waveform">
                {waveformBars.current.map((v, i) => (
                  <View
                    key={i}
                    style={[
                      styles.waveformBar,
                      {
                        height: 6 + (paused ? 4 : v * 18),
                        backgroundColor: paused ? "#cbd5e1" : "#dc2626",
                        opacity: paused ? 0.5 : 0.85 + v * 0.15,
                      },
                    ]}
                  />
                ))}
              </View>
            ) : null}

            {/* R17: ASR 主路径诊断条 — 显式区分「本地 / 远端兜底 / 未就绪」,
                任何状态变化都会写进 lastError,UI 直接读。 */}
            <View
              style={[styles.asrDiagnostic, { backgroundColor: providerToneBg, borderColor: providerToneColor }]}
              testID="mobile-recorder-asr-diagnostic"
            >
              <Text style={[styles.asrDiagnosticLabel, { color: providerToneColor }]}>
                {isOfflineEngineReady
                  ? "🟢 本地 ASR 主路径"
                  : isMacFallback
                    ? "🟠 远端片段兜底"
                    : "🔴 本地 ASR 未就绪"}
              </Text>
              <Text style={styles.asrDiagnosticText}>
                {isOfflineEngineReady
                  ? `本地引擎 ${offlineAsr.modelLabel || offlineEngineId} 已就绪;录音过程实时转写由端侧模型执行,不会走任何网络。`
                  : isMacFallback
                    ? `远端兜底已显式启用:${offlineAsr.lastError || "无 reason 详情"}。本机引擎未就绪;UI 不应把这条路径当成「实时转写」展示。`
                    : offlineStatus === "missing"
                      ? `本地 ASR 引擎未发现 — ${offlineAsr.lastError || "native rebuild 后会自动启用"}`
                      : offlineStatus === "failed"
                        ? `本地 ASR 失败 — ${offlineAsr.lastError || "未知原因"}`
                        : offlineStatus === "uninitialized"
                          ? "本地 ASR 引擎未注册 — 等待 native 包就绪"
                          : offlineDescribe}
              </Text>
            </View>
          </View>

          {/* R17: 录音控制条。模仿元宝 / 主流录音 App 的 Yuanbao 风格:
              录音中 → 居中三个按钮:暂停 / 红色停止(主操作) / 后台;
              暂停中 → 恢复 / 停止。
              这些 testID 是稳定接口,会被 contract test 抓取。 */}
          {recording ? (
            <View style={styles.recordingControlBar} testID="mobile-recorder-control-bar">
              {!paused ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="暂停录音"
                  testID="mobile-recorder-pause"
                  onPress={onPause}
                  style={({ pressed }) => [styles.recordingControlBtn, styles.recordingControlSecondary, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.recordingControlGlyph}>⏸</Text>
                  <Text style={styles.recordingControlLabel}>暂停</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="恢复录音"
                  testID="mobile-recorder-resume"
                  onPress={onResume}
                  style={({ pressed }) => [styles.recordingControlBtn, styles.recordingControlPrimary, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[styles.recordingControlGlyph, { color: "#fff" }]}>▶</Text>
                  <Text style={[styles.recordingControlLabel, { color: "#fff" }]}>继续</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="停止录音并预览"
                testID="mobile-recorder-stop-end"
                onPress={onStopAndPreview}
                style={({ pressed }) => [styles.recordingControlBtn, styles.recordingControlStop, pressed && { opacity: 0.85 }]}
              >
                <View style={styles.recordingControlStopSquare} />
                <Text style={[styles.recordingControlLabel, { color: "#fff" }]}>停止</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="后台转写(最小化)"
                testID="mobile-recorder-background"
                onPress={onMinimize}
                style={({ pressed }) => [styles.recordingControlBtn, styles.recordingControlSecondary, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.recordingControlGlyph}>▾</Text>
                <Text style={styles.recordingControlLabel}>后台</Text>
              </Pressable>
            </View>
          ) : null}

          {/* 2. Realtime transcript / 手动 draft */}
          <View style={styles.transcriptCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>实时转写 / 手动草稿</Text>
              <Text style={styles.sectionMeta} testID="mobile-recorder-local-asr-segment-count">
                {recording
                  ? localSegmentsCount > 0
                    ? `本地 ASR 段 ${localSegmentsCount} · 端侧实时转写`
                    : "等待首个本地 ASR 实时分段"
                  : localSegmentsCount > 0
                    ? `本地 ASR 段 ${localSegmentsCount}`
                    : "可手动输入或粘贴转写"}
              </Text>
            </View>
            <Text style={styles.helpText}>
              {isOfflineEngineReady
                ? localSegmentsCount > 0
                  ? `本地 ASR 引擎 (${offlineAsr.modelLabel || offlineEngineId}) 已就绪,录音中已实时转写 ${localSegmentsCount} 段,文本会自动写入下方输入框。`
                  : `本地 ASR 引擎 (${offlineAsr.modelLabel || offlineEngineId}) 已就绪,录音过程中可以继续手动写草稿;停止后本地模型会自动转写整段录音并填入下方输入框。`
                : isMacFallback
                  ? `本地 ASR 引擎未安装 (${offlineAsr.lastError || "无 reason"}),目前依赖远端工作台轮询 segments。下方输入框是实时草稿与手动补录;停止后会自动填入已轮询到的远端片段。`
                  : offlineStatus === "missing"
                    ? "本地 ASR 引擎未就绪(模型未安装或未注册 native 包)。下方输入框是草稿区,可手动输入或粘贴转写文本保存;待 native rebuild 后会自动启用。"
                    : offlineStatus === "loading"
                      ? "本地模型加载中(首次通常 3-8 秒)。可继续写草稿。"
                      : offlineStatus === "failed"
                        ? `本地 ASR 引擎加载失败: ${offlineAsr.lastError || "未知原因"}。下方输入框是草稿区,可手动输入或粘贴转写文本保存。`
                        : "本地 ASR 引擎正在初始化。下方输入框是草稿区,可手动输入或粘贴转写文本保存。"}
            </Text>
            <TextInput
              accessibilityLabel="实时转写和手动草稿输入"
              testID="mobile-recorder-transcript-input"
              value={transcript}
              onChangeText={actions.setTranscript}
              placeholder={isOfflineEngineReady
                ? localSegmentsCount > 0
                  ? `本地 ASR 已实时转写 ${localSegmentsCount} 段 · 可继续输入或粘贴`
                  : "本地 ASR 已就绪 · 可在录音中先写要点,停止后会转写整段"
                : "可在录音中先写要点;停止后可粘贴转写文本"}
              placeholderTextColor={Color.inkDisabled || "#98a2b3"}
              multiline
              style={styles.transcriptInput}
            />
          </View>

          {/* 3. 实时状态:草稿计时器与心跳;但不假装成实时 ASR */}
          <View style={styles.helpCard} testID="mobile-recorder-honesty">
            <Text style={styles.helpTitle}>诚实状态</Text>
            <Text style={styles.helpText}>
              • 当前主路径是「本地 ASR」;native rebuild 完成后由手机端模型直接转写,不依赖网络或 Mac 工作台。
              {"\n"}• 如果本地引擎未就绪,远端 R5B 录音会话的轮询 segments 会作为「远端片段兜底」自动填入,UI 角标会标注「mac-segment-fallback」。
              {"\n"}• 入库 (Markdown + HTML) 只在用户主动按"确认入库"后才会触发,本地/远端转写都不会自动入库。
            </Text>
          </View>

          {/* 4. 预览 Markdown / HTML */}
          {previewing ? (
            <View style={styles.previewCard} testID="mobile-recorder-preview-card">
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>预览</Text>
                <Text style={styles.sectionMeta}>确认后入库</Text>
              </View>
              <TextInput
                accessibilityLabel="语音记录标题"
                testID="mobile-recorder-title-input"
                value={title}
                onChangeText={actions.setTitle}
                placeholder="标题,可留空"
                placeholderTextColor={Color.inkDisabled || "#98a2b3"}
                style={styles.titleInput}
              />
              <View style={styles.previewTabs}>
                <Pressable
                  onPress={() => actions.setPreviewTab("markdown")}
                  style={[styles.previewTab, previewTab === "markdown" && styles.previewTabActive]}
                  testID="mobile-recorder-preview-tab-markdown"
                >
                  <Text style={[styles.previewTabText, previewTab === "markdown" && styles.previewTabTextActive]}>Markdown</Text>
                </Pressable>
                <Pressable
                  onPress={() => actions.setPreviewTab("html")}
                  style={[styles.previewTab, previewTab === "html" && styles.previewTabActive]}
                  testID="mobile-recorder-preview-tab-html"
                >
                  <Text style={[styles.previewTabText, previewTab === "html" && styles.previewTabTextActive]}>HTML</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.previewBox} nestedScrollEnabled>
                <Text selectable style={styles.previewText} testID={previewTab === "markdown" ? "mobile-recorder-preview-markdown" : "mobile-recorder-preview-html"}>
                  {previewTab === "markdown" ? previewMarkdown : previewHtml}
                </Text>
              </ScrollView>
              {lastError ? (
                <Text style={styles.warnText} testID="mobile-recorder-preview-error">
                  {lastError}
                </Text>
              ) : null}
              {ingest ? (
                <View style={styles.successBanner} testID="mobile-recorder-preview-saved">
                  <Text style={styles.helpTitle}>已入库</Text>
                  <Text style={styles.helpText}>Markdown: {ingest.markdownPath || "-"}</Text>
                  <Text style={styles.helpText}>HTML: {ingest.htmlPath || "-"}</Text>
                  {ingest.knowledgePath ? <Text style={styles.helpText}>知识路径: {ingest.knowledgePath}</Text> : null}
                </View>
              ) : null}
              <View style={styles.actionRow}>
                <Button
                  label={mode === "saving" ? "正在入库" : "确认入库"}
                  tone="primary"
                  size="md"
                  loading={mode === "saving"}
                  disabled={mode === "saving" || !transcript.trim() || !audioUri}
                  onPress={() => actions.setMode("saving")}
                  testID="mobile-recorder-confirm-ingest"
                />
                <Button
                  label="继续编辑"
                  tone="secondary"
                  size="md"
                  onPress={() => actions.setPreviewTab("markdown")}
                  testID="mobile-recorder-continue-edit"
                />
                <Button
                  label="退出本次录音"
                  tone="secondary"
                  size="md"
                  onPress={onExit}
                  testID="mobile-recorder-exit"
                />
              </View>
            </View>
          ) : null}
        </ScrollView>
        {/* 5. 底部粘底:任何状态下都可以最小化或退出,不再依赖 Header */}
        <View style={styles.footer} testID="mobile-recorder-workspace-footer">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="最小化语音录音(让出屏幕)"
            onPress={onMinimize}
            testID="mobile-recorder-workspace-footer-minimize"
            style={({ pressed }) => [styles.footerBtn, styles.footerGhost, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.footerGhostText}>最小化</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="退出本次录音"
            onPress={onExit}
            testID="mobile-recorder-workspace-footer-close"
            style={({ pressed }) => [styles.footerBtn, styles.footerDanger, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.footerDangerText}>退出本次录音</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: Color.surface || "#f5f7f9" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Color.border || "#e5e7eb",
    backgroundColor: Color.surface || "#ffffff",
    gap: Space.sm,
  },
  headerBtn: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    backgroundColor: Color.surfaceMuted || "#f3f4f6",
  },
  headerBtnText: { ...Type.captionBold, color: Color.ink || "#111827" },
  headerBtnDanger: { backgroundColor: "rgba(220,38,38,0.08)" },
  headerBtnDangerText: { color: "#dc2626" },
  headerCenter: { flex: 1, alignItems: "center" },
  kicker: { ...Type.microBold, color: Color.inkFaint || "#6b7280" },
  title: { ...Type.body, fontWeight: "900", color: Color.ink || "#111827" },
  body: { padding: Space.md, gap: Space.md, paddingBottom: Space.xl * 3 },
  statusCard: {
    borderRadius: Radius.lg || 12,
    backgroundColor: Color.surface || "#fff",
    borderWidth: 1,
    borderColor: Color.border || "#e5e7eb",
    padding: Space.md,
    gap: Space.xs,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#dc2626" },
  dotPaused: { backgroundColor: "#fbbf24" },
  statusLabel: { ...Type.body, fontWeight: "900", color: Color.ink || "#111827" },
  timer: { fontSize: 36, fontWeight: "900", fontVariant: ["tabular-nums"], color: Color.ink || "#111827" },
  statusMeta: { ...Type.caption, color: Color.inkFaint || "#6b7280" },
  warnText: { ...Type.caption, color: "#b45309" },
  // R17: 录音中波形可视化 + ASR 主路径诊断条
  waveformRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    height: 28,
    marginTop: 4,
  },
  waveformBar: {
    width: 4,
    borderRadius: 2,
  },
  asrDiagnostic: {
    marginTop: 6,
    padding: Space.sm,
    borderRadius: Radius.md || 8,
    borderWidth: 1,
    gap: 2,
  },
  asrDiagnosticLabel: { ...Type.captionBold, fontWeight: "900" },
  asrDiagnosticText: { ...Type.caption, color: Color.inkMuted || "#374151" },
  // R17: 录音中控制条(Yuanbao 风格)
  recordingControlBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    gap: Space.sm,
    paddingVertical: Space.md,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.lg || 12,
    backgroundColor: Color.surface || "#fff",
    borderWidth: 1,
    borderColor: Color.border || "#e5e7eb",
  },
  recordingControlBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 48,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.md || 8,
  },
  recordingControlPrimary: { backgroundColor: Color.primary || "#0f766e" },
  recordingControlSecondary: {
    backgroundColor: Color.surfaceMuted || "#f3f4f6",
    borderWidth: 1,
    borderColor: Color.border || "#e5e7eb",
  },
  recordingControlStop: { backgroundColor: "#dc2626" },
  recordingControlStopSquare: {
    width: 12,
    height: 12,
    backgroundColor: "#fff",
    borderRadius: 2,
  },
  recordingControlGlyph: { fontSize: 16, color: Color.ink || "#111827", fontWeight: "900" },
  recordingControlLabel: { ...Type.captionBold, color: Color.ink || "#111827" },
  transcriptCard: {
    borderRadius: Radius.lg || 12,
    backgroundColor: Color.surface || "#fff",
    borderWidth: 1,
    borderColor: Color.border || "#e5e7eb",
    padding: Space.md,
    gap: Space.sm,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { ...Type.body, fontWeight: "900", color: Color.ink || "#111827" },
  sectionMeta: { ...Type.caption, color: Color.inkFaint || "#6b7280" },
  transcriptInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: Color.border || "#e5e7eb",
    borderRadius: Radius.md || 8,
    padding: Space.sm,
    color: Color.ink || "#111827",
    textAlignVertical: "top",
  },
  helpCard: {
    borderRadius: Radius.lg || 12,
    backgroundColor: (Color.surface || "#fff"),
    borderLeftWidth: 3,
    borderLeftColor: Color.primary || "#0f766e",
    padding: Space.md,
    gap: 4,
  },
  helpTitle: { ...Type.bodySm, color: Color.ink || "#111827", fontWeight: "900" },
  helpText: { ...Type.caption, color: Color.inkMuted || "#374151" },
  previewCard: {
    borderRadius: Radius.lg || 12,
    backgroundColor: Color.surface || "#fff",
    borderWidth: 1,
    borderColor: Color.border || "#e5e7eb",
    padding: Space.md,
    gap: Space.sm,
  },
  titleInput: {
    borderWidth: 1,
    borderColor: Color.border || "#e5e7eb",
    borderRadius: Radius.md || 8,
    padding: Space.sm,
    color: Color.ink || "#111827",
  },
  previewTabs: { flexDirection: "row", gap: Space.xs },
  previewTab: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.md || 8,
    backgroundColor: Color.surfaceMuted || "#f3f4f6",
  },
  previewTabActive: { backgroundColor: (Color.primary || "#0f766e") + "22" },
  previewTabText: { ...Type.captionBold, color: Color.inkFaint || "#6b7280" },
  previewTabTextActive: { color: Color.primary || "#0f766e" },
  previewBox: {
    maxHeight: 260,
    borderWidth: 1,
    borderColor: Color.border || "#e5e7eb",
    borderRadius: Radius.md || 8,
    padding: Space.sm,
    backgroundColor: Color.surfaceSubtle || "#fafafa",
  },
  previewText: { ...Type.caption, color: Color.ink || "#111827", lineHeight: 20 },
  successBanner: {
    borderRadius: Radius.md || 8,
    backgroundColor: "#ecfdf5",
    padding: Space.sm,
    gap: 2,
  },
  actionRow: { flexDirection: "row", gap: Space.sm, flexWrap: "wrap" },
  footer: {
    flexDirection: "row",
    gap: Space.sm,
    padding: Space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.border || "#e5e7eb",
    backgroundColor: Color.surface || "#fff",
  },
  footerBtn: { flex: 1, paddingVertical: Space.sm, borderRadius: Radius.md || 8, alignItems: "center" },
  footerGhost: { backgroundColor: Color.surfaceMuted || "#f3f4f6" },
  footerGhostText: { ...Type.body, fontWeight: "900", color: Color.ink || "#111827" },
  footerDanger: { backgroundColor: "#dc2626" },
  footerDangerText: { ...Type.body, fontWeight: "900", color: "#fff" },
});
