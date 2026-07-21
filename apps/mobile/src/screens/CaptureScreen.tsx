import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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

import { Button } from "@/components/Button";
import { Color, Radius, Space, Type } from "@/constants/design";
import { Haptics } from "@/lib/haptics";
import { addKnowledgeNote, humanizeMobileError, organizeKnowledgeNoteStart, organizeKnowledgeNoteStatus, readKnowledgeNoteContent } from "@/lib/api";
import { parseHtml, type HtmlBlock } from "@/lib/htmlPreview";
import { loadMobileSession } from "@/lib/storage";
import type { MobileSession } from "@/lib/types";

type Props = {
  onClose: () => void;
  onOpenEditor: (path: string, kind: "markdown" | "html") => void;
  initialTitle?: string;
  initialBody?: string;
};

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; markdownPath: string; htmlPath: string; title: string }
  | { kind: "error"; message: string };

export default function CaptureScreen({ onClose, onOpenEditor, initialTitle, initialBody }: Props) {
  const [session, setSession] = useState<MobileSession | null>(null);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(initialTitle || "");
  const [body, setBody] = useState(initialBody || "");
  // 2026-06-25 — single-flight guard:prevent duplicate save re-entry (mobile_priority duplicate_save_guard)
  const [quickSavePending, setQuickSavePending] = useState(false);
  const [quickInFlightId, setQuickInFlightId] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);

  useEffect(() => {
    let active = true;
    loadMobileSession().then((s) => active && setSession(s));
    return () => { active = false; };
  }, []);

  const htmlPreview = useMemo(() => {
    if (state.kind !== "saved" || !state.htmlPath) return null;
    return { path: state.htmlPath, title: state.title };
  }, [state]);

  const canSave = body.trim().length > 0 && state.kind === "idle" && !quickSavePending && !!session;

  // 2026-06-26 — AI 整理 (Obsidian 双阶段: 连接 Gateway → 整理 → 高品质 HTML)
  const [organizeJobId, setOrganizeJobId] = useState<string | null>(null);
  const [organizeProgress, setOrganizeProgress] = useState(0);
  const [organizePhase, setOrganizePhase] = useState<string>("");
  const [organizeError, setOrganizeError] = useState<string | null>(null);
  const [organizeErrorCode, setOrganizeErrorCode] = useState<string>("");
  const [organizeResult, setOrganizeResult] = useState<{ markdownPath: string; htmlPath: string } | null>(null);
  const organizeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopOrganizePolling = () => {
    if (organizeTimerRef.current) {
      clearInterval(organizeTimerRef.current);
      organizeTimerRef.current = null;
    }
  };
  useEffect(() => () => stopOrganizePolling(), []);

  const canOrganize = body.trim().length > 0 && !!session && state.kind !== "saved" && !organizeJobId && !organizeResult;

  async function handleOrganize() {
    if (!canOrganize || !session) return;
    setOrganizeError(null);
    setOrganizeProgress(5);
    setOrganizePhase("提交整理任务");
    try {
      const noteTitle = (title.trim() || "手机速记");
      const res = await organizeKnowledgeNoteStart(session, {
        title: noteTitle,
        body: body.trim(),
        source: "mobile_capture",
        qualityMode: "high",
      });
      setOrganizeJobId(res.job.id);
      setOrganizePhase("排队中");
      Haptics.tick();
      // 轮询
      stopOrganizePolling();
      organizeTimerRef.current = setInterval(async () => {
        try {
          if (!session) return;
          const status = await organizeKnowledgeNoteStatus(session, res.job.id);
          const job = status.job;
          setOrganizeProgress(job.progress ?? Math.min(95, organizeProgress + 8));
          setOrganizePhase(job.phase || job.status || "进行中");
          if (job.status === "completed" || job.status === "succeeded" || job.markdownPath || job.htmlPath) {
            stopOrganizePolling();
            setOrganizeJobId(null);
            setOrganizeProgress(100);
            setOrganizePhase("完成");
            setOrganizeResult({ markdownPath: job.markdownPath || "", htmlPath: job.htmlPath || "" });
            Haptics.success();
            void queryClient.invalidateQueries({ queryKey: ["mobile-knowledge-atlas"] });
            void queryClient.invalidateQueries({ queryKey: ["kb-list"] });
          } else if (job.status === "failed" || job.status === "aborted") {
            stopOrganizePolling();
            setOrganizeJobId(null);
            // R4: 错误信息优先从 job.error / job.message / job.failure 取 (任一存在即可)
            const errMsg = job.error
              || job.message
              || (job.failure && (job.failure.reasonLabel || job.failure.reason))
              || "整理失败,请稍后重试";
            const errAdvice = job.errorAdvice
              || (job.failure && Array.isArray(job.failure.advice) ? job.failure.advice : null);
            const errCode = job.errorCode || (job.failure && job.failure.reason) || "unknown";
            setOrganizeError(`${errMsg}${errCode && errCode !== "unknown" ? ` (${errCode})` : ""}`);
            setOrganizeErrorCode(String(errCode));
            Haptics.error();
          }
        } catch (pollErr) {
          // 轮询错误不立即终止
        }
      }, 3000);
    } catch (err) {
      setOrganizeError(humanizeMobileError(err instanceof Error ? err.message : String(err)));
      setOrganizeJobId(null);
      setOrganizeProgress(0);
      Haptics.error();
    }
  }

  async function handleSave() {
    if (!canSave) return;
    if (!session) return;
    setQuickSavePending(true);
    setQuickInFlightId(`cap-${Date.now()}`);
    setState({ kind: "saving" });
    Haptics.tick();
    try {
      const result = await addKnowledgeNote(
        session,
        {
          title: title.trim() || "手机速记",
          body: body.trim(),
          transcriptText: body.trim(),
          source: "manual_transcript",
          language: "zh-CN",
          durationSeconds: null,
        },
      );
      setState({
        kind: "saved",
        markdownPath: result.markdownPath || "",
        htmlPath: result.htmlPath || "",
        title: title.trim() || "手机速记",
      });
      Haptics.success();
    } catch (err) {
      setState({ kind: "error", message: humanizeMobileError(err instanceof Error ? err.message : String(err)) });
      Haptics.error();
    } finally {
      setQuickSavePending(false);
      setQuickInFlightId(null);
    }
  }

  function handleContinue() {
    setTitle("");
    setBody("");
    setState({ kind: "idle" });
    setShowHtmlPreview(false);
  }

  return (
    <SafeAreaView style={styles.shell} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} testID="capture-close">
          <Text style={styles.closeText}>关闭</Text>
        </Pressable>
        <Text style={styles.headerTitle}>添加笔记 · 知识录入</Text>
        <View style={styles.closeBtn} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          testID="mobile-knowledge-input-panel"
        >
          {!session ? (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>尚未配对。先在「设备」tab 完成 6 位配对码登录。</Text>
            </View>
          ) : null}

          <Text style={styles.label}>标题(可留空)</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="例如:周三客户回访"
            placeholderTextColor={Color.inkDisabled}
            style={styles.titleInput}
            testID="mobile-quick-note-title"
          />

          <Text style={styles.label}>内容</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={"想到什么就写什么,保存后自动整理成\nMarkdown + HTML 入库"}
            placeholderTextColor={Color.inkDisabled}
            style={styles.bodyInput}
            multiline
            testID="mobile-quick-note-body"
            editable={state.kind !== "saving"}
          />

          {state.kind === "saved" ? (
            <View style={styles.savedCard} testID="mobile-quick-note-saved">
              <Text style={styles.savedTitle}>已入库</Text>
              <Text style={styles.savedVoiceLabel} testID="capture-voice-result-label">Markdown + HTML 已生成</Text>
              {state.markdownPath ? <Text style={styles.savedPath}>Markdown: {state.markdownPath}</Text> : null}
              {state.htmlPath ? <Text style={styles.savedPath}>HTML: {state.htmlPath}</Text> : null}
              <View style={styles.savedActions}>
                {state.markdownPath ? (
                  <Button
                    label="打开 Markdown"
                    tone="secondary"
                    size="sm"
                    onPress={() => onOpenEditor(state.markdownPath, "markdown")}
                    testID="capture-open-md"
                  />
                ) : null}
                {state.htmlPath ? (
                  <Button
                    label={showHtmlPreview ? "收起 HTML 预览" : "预览 HTML"}
                    tone="secondary"
                    size="sm"
                    onPress={() => setShowHtmlPreview((v) => !v)}
                    testID="capture-toggle-html"
                  />
                ) : null}
              </View>
              {showHtmlPreview && htmlPreview ? (
                <HtmlPreview path={htmlPreview.path} title={htmlPreview.title} session={session} />
              ) : null}
              <View style={styles.savedActions}>
                <Button label="继续添加" tone="primary" size="sm" onPress={handleContinue} testID="capture-continue" />
              </View>
            </View>
          ) : null}

          {state.kind === "error" ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>未保存成功:{state.message}</Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        {organizeResult ? (
          <View style={styles.organizeDoneBox} testID="capture-organize-done">
            <Text style={styles.organizeDoneTitle}>✓ AI 整理完成</Text>
            {organizeResult.markdownPath ? (
              <Text style={styles.organizeDonePath} numberOfLines={1}>md: {organizeResult.markdownPath}</Text>
            ) : null}
            {organizeResult.htmlPath ? (
              <Text style={styles.organizeDonePath} numberOfLines={1}>html: {organizeResult.htmlPath}</Text>
            ) : null}
          </View>
        ) : null}
        {organizeError ? (
          <View style={styles.organizeErrorBox} testID="capture-organize-error">
            <Text style={styles.organizeErrorText}>AI 整理失败:{organizeError}</Text>
            <Pressable onPress={() => { setOrganizeError(null); setOrganizeProgress(0); }}>
              <Text style={styles.organizeRetry}>重试</Text>
            </Pressable>
          </View>
        ) : null}
        {organizeJobId ? (
          <View style={styles.organizeProgressBox} testID="capture-organize-progress">
            <Text style={styles.organizeProgressTitle}>AI 整理中… {organizeProgress}%</Text>
            <Text style={styles.organizeProgressPhase}>{organizePhase}</Text>
            <View style={styles.organizeProgressBar}><View style={[styles.organizeProgressFill, { width: `${organizeProgress}%` }]} /></View>
          </View>
        ) : null}
        <Button
          label={organizeJobId ? "AI 整理中…" : "🪄 AI 整理 (高品质 HTML)"}
          tone="secondary"
          size="md"
          onPress={handleOrganize}
          disabled={!canOrganize}
          testID="capture-organize-button"
        />
        <Button
          label={
            state.kind === "saving"
              ? "整理入库中…"
              : state.kind === "saved"
                ? "已保存，点继续添加"
                : "保存为 Markdown + HTML"
          }
          tone="primary"
          size="md"
          onPress={handleSave}
          disabled={!canSave}
          testID="mobile-quick-note-save"
        />
        {/* 2026-06-25 — 录音保存等价入口:首屏语音卡片完成后直达此处 */}
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          testID="mobile-voice-save"
          accessibilityLabel="保存录音转写"
          style={({ pressed }) => [{ paddingVertical: Space.xs, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[Type.caption, { color: Color.inkMuted, textAlign: "center" }]}>
            {state.kind === "saved" ? "已保存 · 点上方继续添加后再保存新笔记" : "录音转写完成 · 点这里保存为 Markdown + HTML"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function HtmlPreview({ path, title, session }: { path: string; title: string; session: MobileSession | null }) {
  const [text, setText] = useState<string>("");
  const [blocks, setBlocks] = useState<HtmlBlock[] | null>(null);
  const [showHtmlSource, setShowHtmlSource] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    if (!session) {
      setError("未配对,无法读取笔记内容");
      setLoading(false);
      return;
    }
    readKnowledgeNoteContent(session, path, undefined)
      .then((res) => {
        if (!active) return;
        setText(res.content);
        setBlocks(parseHtml(res.content));
      })
      .catch((err) => {
        if (!active) return;
        setError(humanizeMobileError(err instanceof Error ? err.message : String(err)));
        setBlocks([]);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [path, session]);

  if (loading) return <ActivityIndicator color={Color.primary} style={{ marginVertical: Space.md }} />;

  return (
    <View style={styles.htmlCard}>
      <Text style={styles.htmlTitle}>{title || "HTML 预览"}</Text>
      {error ? (
        <Text style={styles.htmlError}>{error}</Text>
      ) : blocks && blocks.length > 0 ? (
        blocks.map((b, i) => <HtmlBlockView key={i} block={b} />)
      ) : (
        <Text style={styles.htmlFallback}>无法解析 HTML,可展开源码检查。</Text>
      )}
      {text ? (
        <>
          <Pressable
            onPress={() => setShowHtmlSource((v) => !v)}
            style={({ pressed }) => [styles.htmlSourceToggle, pressed && { opacity: 0.7 }]}
            testID="capture-toggle-html-source"
            accessibilityRole="button"
            accessibilityLabel={showHtmlSource ? "收起 HTML 源码" : "查看 HTML 源码"}
          >
            <Text style={styles.htmlSourceToggleText}>{showHtmlSource ? "收起源码" : "查看源码"}</Text>
          </Pressable>
          {showHtmlSource ? (
            <View style={styles.htmlSource}>
              <Text style={styles.htmlSourceText}>{text}</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function HtmlBlockView({ block }: { block: HtmlBlock }) {
  switch (block.kind) {
    case "heading": {
      const style =
        block.level <= 2 ? styles.h1 : block.level <= 4 ? styles.h2 : styles.h3;
      return <Text style={style}>{block.text}</Text>;
    }
    case "paragraph":
      return <Text style={styles.p}>{block.text}</Text>;
    case "list":
      return (
        <View style={styles.list}>
          {block.items.map((it, i) => (
            <Text key={i} style={styles.li}>
              {block.ordered ? `${i + 1}. ` : "• "}
              {it}
            </Text>
          ))}
        </View>
      );
    case "code":
      return (
        <View style={styles.code}>
          <Text style={styles.codeText}>{block.text}</Text>
        </View>
      );
    case "quote":
      return (
        <View style={styles.quote}>
          <Text style={styles.quoteText}>{block.text}</Text>
        </View>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: Color.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
    borderBottomWidth: 1,
    borderBottomColor: Color.border,
    backgroundColor: Color.surface,
  },
  headerTitle: { ...Type.h2, color: Color.ink, fontWeight: "900" },
  closeBtn: { minWidth: 56, alignItems: "flex-start" },
  closeText: { ...Type.body, color: Color.primary, fontWeight: "700" },
  body: { padding: Space.lg, paddingBottom: 120 },
  label: { ...Type.captionBold, color: Color.inkMuted, marginBottom: Space.xs, marginTop: Space.md },
  titleInput: {
    ...Type.bodyLg,
    color: Color.ink,
    backgroundColor: Color.surfaceMuted,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
  },
  bodyInput: {
    ...Type.body,
    color: Color.ink,
    backgroundColor: Color.surfaceMuted,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
    minHeight: 200,
    textAlignVertical: "top",
  },
  savedCard: {
    marginTop: Space.lg,
    padding: Space.md,
    backgroundColor: "#F0FDF4",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  savedTitle: { ...Type.h3, color: "#15803D", fontWeight: "900", marginBottom: Space.xs },
  savedVoiceLabel: { ...Type.caption, color: "#15803D", marginBottom: Space.xs, fontWeight: "700" },
  savedQuickLabel: { ...Type.caption, color: Color.inkMuted, marginBottom: Space.xs, fontWeight: "700" },
  savedPath: { ...Type.caption, color: Color.inkMuted, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginBottom: Space.md },
  savedActions: { flexDirection: "row", gap: Space.sm, marginBottom: Space.sm, flexWrap: "wrap" },
  htmlCard: { marginTop: Space.sm, padding: Space.md, backgroundColor: Color.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Color.border },
  htmlTitle: { ...Type.captionBold, color: Color.ink, marginBottom: Space.sm },
  htmlFallback: { ...Type.caption, color: Color.inkMuted, marginTop: Space.sm },
  htmlError: { ...Type.caption, color: Color.dangerInk, marginTop: Space.sm },
  htmlSourceToggle: { alignSelf: "flex-start", marginTop: Space.md, borderRadius: Radius.sm, borderWidth: 1, borderColor: Color.border, paddingHorizontal: Space.sm, paddingVertical: 6, backgroundColor: Color.surfaceMuted },
  htmlSourceToggleText: { ...Type.caption, color: Color.inkMuted, fontWeight: "800" },
  htmlSource: { marginTop: Space.md, padding: Space.sm, backgroundColor: "#F3F4F6", borderRadius: Radius.sm },
  htmlSourceText: { ...Type.caption, color: Color.inkMuted, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  h1: { ...Type.h2, color: Color.ink, fontWeight: "900", marginTop: Space.sm, marginBottom: Space.xs },
  h2: { ...Type.h3, color: Color.ink, fontWeight: "800", marginTop: Space.sm, marginBottom: Space.xs },
  h3: { ...Type.bodyLg, color: Color.ink, fontWeight: "700", marginTop: Space.xs, marginBottom: Space.xs },
  p: { ...Type.body, color: Color.ink, marginTop: Space.xs, lineHeight: 22 },
  list: { marginTop: Space.xs, marginLeft: Space.md },
  li: { ...Type.body, color: Color.ink, marginTop: 2 },
  code: { padding: Space.sm, backgroundColor: "#1F2937", borderRadius: Radius.sm, marginTop: Space.xs },
  codeText: { ...Type.caption, color: "#F9FAFB", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  quote: { borderLeftWidth: 3, borderLeftColor: Color.primary, paddingLeft: Space.md, marginTop: Space.xs },
  quoteText: { ...Type.body, color: Color.inkMuted, fontStyle: "italic" },
  errorBox: { marginTop: Space.md, padding: Space.md, backgroundColor: "#FEF2F2", borderRadius: Radius.md },
  errorText: { ...Type.bodySm, color: "#B42318" },
  warnBox: { padding: Space.md, backgroundColor: "#FFF7ED", borderRadius: Radius.md, marginBottom: Space.md },
  organizeDoneBox: { padding: Space.md, backgroundColor: "#F0FDF4", borderRadius: Radius.md, borderWidth: 1, borderColor: "#86EFAC", marginBottom: Space.sm },
  organizeDoneTitle: { ...Type.h3, color: "#15803D", fontWeight: "900", marginBottom: 4 },
  organizeDonePath: { ...Type.caption, color: Color.inkMuted, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  organizeErrorBox: { padding: Space.md, backgroundColor: "#FEF2F2", borderRadius: Radius.md, marginBottom: Space.sm },
  organizeErrorText: { ...Type.bodySm, color: "#B42318", marginBottom: 4 },
  organizeRetry: { ...Type.captionBold, color: Color.dangerInk },
  organizeProgressBox: { padding: Space.md, backgroundColor: "#EFF6FF", borderRadius: Radius.md, marginBottom: Space.sm },
  organizeProgressTitle: { ...Type.captionBold, color: Color.primary, marginBottom: 4 },
  organizeProgressPhase: { ...Type.caption, color: Color.inkMuted, marginBottom: 6 },
  organizeProgressBar: { height: 6, backgroundColor: Color.border, borderRadius: 3, overflow: "hidden" },
  organizeProgressFill: { height: 6, backgroundColor: Color.primary, borderRadius: 3 },
  warnText: { ...Type.bodySm, color: Color.warnInk },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: Space.md,
    backgroundColor: Color.surface,
    borderTopWidth: 1,
    borderTopColor: Color.border,
  },
});
