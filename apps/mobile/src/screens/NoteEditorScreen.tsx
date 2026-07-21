import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Color, Radius, Shadow, Space, Type } from '@/constants/design';
import { Haptics } from '@/lib/haptics';
import { parseHtml, type HtmlBlock } from '@/lib/htmlPreview';
import {
  createKb,
  deleteKb,
  ensureKbExtension,
  humanizeMobileError,
  joinKbPath,
  kbBasenameFromPath,
  readKb,
  writeKb,
} from '@/lib/api';
import { loadMobileSession } from '@/lib/storage';
import type { MobileSession } from '@/lib/types';

type EditorMode = 'edit' | 'create' | 'preview';
type FileKind = 'markdown' | 'html';

type EditorProps = {
  /** vault 相对路径。create 模式下若用户没填后缀,会按 kind 自动补 */
  path: string;
  mode: EditorMode;
  /** create 模式必填;edit 模式可省略(由 read API 推断) */
  kind?: FileKind;
  /** 编辑成功后通知父级,通常用于回到列表 + 触发 refetch */
  onClose: (opts?: { saved?: boolean; deleted?: boolean; path?: string }) => void;
};

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; name: string }
  | { kind: 'ready'; name: string; fileKind: FileKind; content: string; bytes: number }
  | { kind: 'error'; name: string; message: string };

const DEFAULT_MD = (title: string) => `# ${title || '新笔记'}\n\n`;
const DEFAULT_HTML = (title: string) =>
  `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title || 'New Page'}</title>
</head>
<body>
  <h1>${title || 'New Page'}</h1>
  <p>在 Mobile 端编辑此 HTML 笔记。</p>
</body>
</html>
`;

function bytesText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function guessKind(path: string): FileKind {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return 'html';
}

export default function NoteEditorScreen({ path, mode, kind, onClose }: EditorProps) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<MobileSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'idle' });
  const [content, setContent] = useState<string>('');
  const [dirty, setDirty] = useState<boolean>(false);
  const [deleteModal, setDeleteModal] = useState<boolean>(false);
  const [createName, setCreateName] = useState<string>('');
  const [createKind, setCreateKind] = useState<FileKind>(kind || 'markdown');
  const [createError, setCreateError] = useState<string | null>(null);

  // 进入页面读 session
  useEffect(() => {
    let active = true;
    loadMobileSession()
      .then((stored) => active && setSession(stored))
      .finally(() => active && setLoadingSession(false));
    return () => {
      active = false;
    };
  }, []);

  // 推断 file kind + 文件名
  const fileKind: FileKind = useMemo(() => {
    if (mode === 'create') return createKind;
    return kind || guessKind(path);
  }, [mode, createKind, kind, path]);

  const fileName = useMemo(() => kbBasenameFromPath(path), [path]);

  // edit/preview 模式:拉取现有内容。HTML 预览必须能独立打开,
  // 否则从知识库点 .html 会停在 loading 或退回源码视图。
  useEffect(() => {
    if (mode !== 'edit' && mode !== 'preview') return;
    if (!session) return;
    let active = true;
    setLoadState({ kind: 'loading', name: fileName });
    (async () => {
      try {
        const result = await readKb(session, path, setSession);
        if (!active) return;
        setLoadState({
          kind: 'ready',
          name: fileName,
          fileKind: result.kind,
          content: result.content,
          bytes: result.bytes,
        });
        setContent(result.content);
        setDirty(false);
      } catch (err) {
        if (!active) return;
        const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
        Haptics.error();
        setLoadState({ kind: 'error', name: fileName, message });
      }
    })();
    return () => {
      active = false;
    };
    // session.path 已在外层 useMemo 提取,防止闭包问题
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, session?.serverUrl, path]);

  const previewBlocks = useMemo(
    () => (loadState.kind === 'ready' ? parseHtml(loadState.content) : []),
    [loadState],
  );

  // create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('not_paired');
      const finalName = ensureKbExtension(createName.trim() || 'untitled', createKind);
      // path 是父目录(以 / 开头或 "/")
      const parent = path;
      const finalPath = joinKbPath(parent, finalName);
      const title = createName.trim() || (createKind === 'markdown' ? '新笔记' : 'New Page');
      const seed = createKind === 'markdown' ? DEFAULT_MD(title) : DEFAULT_HTML(title);
      const result = await createKb(session, finalPath, { kind: createKind, title, content: seed }, setSession);
      return { result, finalPath, finalName };
    },
    onSuccess: ({ result, finalPath }) => {
      Haptics.tick();
      queryClient.invalidateQueries({ queryKey: ['kb-list'] });
      onClose({ saved: true, path: finalPath, deleted: false });
      void result;
    },
    onError: (err) => {
      Haptics.error();
      setCreateError(humanizeMobileError(err instanceof Error ? err.message : String(err)));
    },
  });

  // save mutation(edit 模式)
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('not_paired');
      const result = await writeKb(session, path, { content }, setSession);
      return result;
    },
    onSuccess: () => {
      Haptics.tick();
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['kb-list'] });
      onClose({ saved: true, path, deleted: false });
    },
    onError: (err) => {
      Haptics.error();
      const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
      setLoadState({ kind: 'error', name: fileName, message });
    },
  });

  // delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('not_paired');
      const result = await deleteKb(session, path, setSession);
      return result;
    },
    onSuccess: () => {
      Haptics.tick();
      queryClient.invalidateQueries({ queryKey: ['kb-list'] });
      onClose({ deleted: true, path });
    },
    onError: (err) => {
      Haptics.error();
      const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
      setLoadState({ kind: 'error', name: fileName, message });
    },
  });

  // --- create 模式 UI 单独走分支(简单) ---
  if (mode === 'preview') {
    // 2026-06-26 — 2026-06-26 NJX Mate60 反馈: vault 列表点 .html 显示源码不是 HTML 渲染。
    // Preview 模式: 只读 + 渲染 HtmlPreviewBlocks。右上角"切到 source"按钮。
    if (loadState.kind !== 'ready') {
      return (
        <SafeAreaView style={styles.shell} edges={["top"]}>
          <View style={styles.headerBar}>
            <Pressable onPress={() => onClose()} hitSlop={12} style={styles.headerBtn} testID="note-editor-close"><Text style={[Type.bodySm, { color: Color.primary, fontWeight: '700' }]}>关闭</Text></Pressable>
            <Text style={[Type.h2, { color: Color.ink, fontWeight: '900' }]} numberOfLines={1}>HTML 预览</Text>
            <View style={styles.headerBtn} />
          </View>
          {loadState.kind === 'loading' ? (
            <View style={styles.center}><ActivityIndicator color={Color.primary} /><Text style={[Type.body, { color: Color.inkFaint, marginTop: Space.sm }]}>正在读取 {loadState.name}…</Text></View>
          ) : loadState.kind === 'error' ? (
            <View style={styles.errorPanel}>
              <Text style={[Type.h3, { color: Color.dangerInk }]}>无法读取文件</Text>
              <Text style={[Type.bodySm, { color: Color.dangerInk, marginTop: Space.xs }]}>{loadState.message}</Text>
            </View>
          ) : null}
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.shell} edges={["top"]}>
        <View style={styles.headerBar}>
          <Pressable onPress={() => onClose()} hitSlop={12} style={styles.headerBtn} testID="note-editor-close"><Text style={[Type.bodySm, { color: Color.primary, fontWeight: '700' }]}>关闭</Text></Pressable>
          <Text style={[Type.h2, { color: Color.ink, fontWeight: '900' }]} numberOfLines={1}>{loadState.name}</Text>
          <Pressable
            onPress={() => onClose({ path, mode: 'edit', kind: loadState.fileKind } as never)}
            hitSlop={12}
            style={[styles.headerBtnPrimary, { paddingHorizontal: Space.sm }]}
            testID="note-preview-edit"
          >
            <Text style={[Type.captionBold, { color: Color.onPrimary }]}>编辑源码</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: Space.lg, paddingBottom: 80 }} testID="mobile-html-preview">
          <Text style={[Type.caption, { color: Color.inkFaint, marginBottom: Space.sm }]} numberOfLines={1}>{path}</Text>
          {previewBlocks.length ? (
            <View><HtmlPreviewBlocks blocks={previewBlocks} /></View>
          ) : (
            <Text style={[Type.body, { color: Color.inkFaint }]}>空 HTML</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (mode === 'create') {
    const previewFinalName = ensureKbExtension(createName.trim() || 'untitled', createKind);
    const previewFinalPath = joinKbPath(path, previewFinalName);
    return (
      <SafeAreaView style={styles.shell} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.headerBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消新建"
              onPress={() => {
                Haptics.light();
                onClose();
              }}
              style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
            >
              <Text style={[Type.captionBold, { color: Color.primary }]}>取消</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[Type.captionBold, { color: Color.inkFaint, letterSpacing: 0.4 }]}>新建笔记</Text>
              <Text style={[Type.h2, { color: Color.ink, marginTop: 2 }]} numberOfLines={1}>
                {createKind === 'markdown' ? 'Markdown' : 'HTML'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="确认创建"
              onPress={() => {
                Haptics.tick();
                setCreateError(null);
                createMutation.mutate();
              }}
              disabled={createMutation.isPending}
              style={({ pressed }) => [
                styles.headerBtnPrimary,
                pressed && styles.headerBtnPrimaryPressed,
                createMutation.isPending && styles.headerBtnDisabled,
              ]}
            >
              {createMutation.isPending ? (
                <ActivityIndicator color={Color.onPrimary} size="small" />
              ) : (
                <Text style={[Type.captionBold, { color: Color.onPrimary }]}>创建</Text>
              )}
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.createContent} showsVerticalScrollIndicator={false}>
            <View style={styles.createCard}>
              <Text style={[Type.captionBold, { color: Color.inkFaint, letterSpacing: 0.4 }]}>类型</Text>
              <View style={styles.kindRow}>
                <KindChip
                  active={createKind === 'markdown'}
                  label="Markdown"
                  hint=".md"
                  onPress={() => {
                    Haptics.tick();
                    setCreateKind('markdown');
                  }}
                />
                <KindChip
                  active={createKind === 'html'}
                  label="HTML"
                  hint=".html"
                  onPress={() => {
                    Haptics.tick();
                    setCreateKind('html');
                  }}
                />
              </View>
            </View>

            <View style={styles.createCard}>
              <Text style={[Type.captionBold, { color: Color.inkFaint, letterSpacing: 0.4 }]}>文件名</Text>
              <TextInput
                value={createName}
                onChangeText={(t) => {
                  setCreateName(t);
                  setCreateError(null);
                }}
                placeholder={createKind === 'markdown' ? 'untitled.md' : 'untitled.html'}
                placeholderTextColor={Color.inkDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                style={styles.createInput}
                accessibilityLabel="文件名输入框"
              />
              <Text style={[Type.caption, { color: Color.inkFaint, marginTop: Space.sm }]}>
                将保存到: <Text style={{ fontFamily: 'Menlo' }}>{previewFinalPath}</Text>
              </Text>
            </View>

            {createError ? (
              <View style={styles.errorPanel}>
                <Text style={[Type.bodySm, { color: Color.dangerInk }]}>{createError}</Text>
              </View>
            ) : null}

            <View style={styles.helpCard}>
              <Text style={[Type.captionBold, { color: Color.inkFaint, letterSpacing: 0.4 }]}>提示</Text>
              <Text style={[Type.bodySm, { color: Color.inkMuted, marginTop: Space.xs, lineHeight: 20 }]}>
                创建后会跳到编辑视图。Markdown 笔记显示纯文本预览;HTML 笔记显示源码与可读预览。
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // --- edit 模式 ---
  if (loadingSession) {
    return (
      <SafeAreaView style={styles.shell} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={Color.primary} />
          <Text style={[Type.body, { color: Color.inkFaint, marginTop: Space.sm }]}>正在读取工作台登录态…</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!session) {
    return (
      <SafeAreaView style={styles.shell} edges={['top']}>
        <View style={styles.center}>
          <EmptyState
            icon="·"
            title="尚未配对"
            description="回到记录页完成 6 位配对码登录,即可编辑 Mac 工作台上的笔记。"
            tone="muted"
          />
          <View style={{ marginTop: Space.lg }}>
            <Button label="返回" tone="secondary" size="sm" onPress={() => onClose()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (loadState.kind === 'loading' || loadState.kind === 'idle') {
    return (
      <SafeAreaView style={styles.shell} edges={['top']}>
        <View style={styles.headerBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={() => onClose()}
            style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
          >
            <Text style={[Type.captionBold, { color: Color.primary }]}>← 返回</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[Type.captionBold, { color: Color.inkFaint, letterSpacing: 0.4 }]}>编辑器</Text>
            <Text style={[Type.h2, { color: Color.ink, marginTop: 2 }]} numberOfLines={1}>
              {fileName}
            </Text>
          </View>
          <View style={{ width: 64 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={Color.primary} />
          <Text style={[Type.body, { color: Color.inkFaint, marginTop: Space.sm }]}>正在读取 {fileName}…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadState.kind === 'error') {
    return (
      <SafeAreaView style={styles.shell} edges={['top']}>
        <View style={styles.headerBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={() => onClose()}
            style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
          >
            <Text style={[Type.captionBold, { color: Color.primary }]}>← 返回</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[Type.captionBold, { color: Color.dangerInk, letterSpacing: 0.4 }]}>无法打开</Text>
            <Text style={[Type.h2, { color: Color.ink, marginTop: 2 }]} numberOfLines={1}>
              {loadState.name}
            </Text>
          </View>
          <View style={{ width: 64 }} />
        </View>
        <View style={styles.center}>
          <View style={styles.errorPanel}>
            <Text style={[Type.h3, { color: Color.dangerInk }]}>打开失败</Text>
            <Text style={[Type.bodySm, { color: Color.dangerInk, marginTop: Space.xs }]}>{loadState.message}</Text>
            <View style={{ flexDirection: 'row', gap: Space.sm, marginTop: Space.md }}>
              <Button label="返回" tone="secondary" size="sm" onPress={() => onClose()} />
              <Button
                label="重试"
                tone="primary"
                size="sm"
                onPress={() => {
                  Haptics.light();
                  setLoadState({ kind: 'loading', name: fileName });
                  (async () => {
                    try {
                      const result = await readKb(session, path, setSession);
                      setLoadState({ kind: 'ready', name: fileName, fileKind: result.kind, content: result.content, bytes: result.bytes });
                      setContent(result.content);
                      setDirty(false);
                    } catch (err) {
                      const message = humanizeMobileError(err instanceof Error ? err.message : String(err));
                      setLoadState({ kind: 'error', name: fileName, message });
                    }
                  })();
                }}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ready
  const ready = loadState;

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <View style={styles.headerBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => {
            Haptics.light();
            onClose();
          }}
          style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
        >
          <Text style={[Type.captionBold, { color: Color.primary }]}>← 返回</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[Type.captionBold, { color: Color.inkFaint, letterSpacing: 0.4 }]}>
            {ready.fileKind === 'markdown' ? '📝 MARKDOWN' : '🌐 HTML'}
          </Text>
          <Text style={[Type.h2, { color: Color.ink, marginTop: 2 }]} numberOfLines={1}>
            {ready.name}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="保存"
          accessibilityState={{ disabled: !dirty || saveMutation.isPending, busy: saveMutation.isPending }}
          disabled={!dirty || saveMutation.isPending}
          onPress={() => {
            Haptics.tick();
            saveMutation.mutate();
          }}
          style={({ pressed }) => [
            styles.headerBtnPrimary,
            pressed && styles.headerBtnPrimaryPressed,
            (!dirty || saveMutation.isPending) && styles.headerBtnDisabled,
          ]}
        >
          {saveMutation.isPending ? (
            <ActivityIndicator color={Color.onPrimary} size="small" />
          ) : (
            <Text style={[Type.captionBold, { color: Color.onPrimary }]}>
              {dirty ? '保存' : '已保存'}
            </Text>
          )}
        </Pressable>
      </View>

      <View style={styles.modeBar}>
        <Text style={[Type.microBold, { color: ready.fileKind === 'markdown' ? Color.primary : Color.warnInk }]}>
            {ready.fileKind === 'markdown' ? 'Markdown 笔记' : 'HTML 笔记 · 预览 + 源码'}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={[Type.micro, { color: Color.inkFaint }]} numberOfLines={1}>
          {bytesText(content.length)} {dirty ? '· 未保存' : ''}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {ready.fileKind === 'markdown' ? (
          <MarkdownEditor
            content={content}
            onChange={(t) => {
              setContent(t);
              if (!dirty) setDirty(true);
            }}
          />
        ) : (
          <HtmlEditor
            content={content}
            onChange={(t) => {
              setContent(t);
              if (!dirty) setDirty(true);
            }}
          />
        )}
      </KeyboardAvoidingView>

      <View style={styles.bottomBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="删除文件"
          onPress={() => {
            Haptics.warn();
            setDeleteModal(true);
          }}
          style={({ pressed }) => [styles.deleteBtn, pressed && styles.deleteBtnPressed]}
        >
          <Text style={[Type.captionBold, { color: Color.onPrimary }]}>🗑 删除文件</Text>
        </Pressable>
        <Text style={[Type.caption, { color: Color.inkFaint, marginLeft: Space.md, flex: 1 }]} numberOfLines={1}>
          {path}
        </Text>
      </View>

      {/* 删除确认弹窗 */}
      <Modal
        visible={deleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModal(false)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={[Type.h2, { color: Color.ink }]}>删除这份笔记?</Text>
            <Text style={[Type.bodySm, { color: Color.inkMuted, marginTop: Space.sm, lineHeight: 20 }]}>
              <Text style={{ fontWeight: '800' }}>{ready.name}</Text> 将从 Mac 工作台 vault 永久删除。该操作不可撤销,审计日志会记录 high risk。
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="取消删除"
                onPress={() => {
                  Haptics.light();
                  setDeleteModal(false);
                }}
                style={({ pressed }) => [styles.modalCancel, pressed && styles.modalCancelPressed]}
              >
                <Text style={[Type.body, { color: Color.ink }]}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="确认删除"
                accessibilityState={{ busy: deleteMutation.isPending }}
                disabled={deleteMutation.isPending}
                onPress={() => {
                  Haptics.error();
                  deleteMutation.mutate();
                }}
                style={({ pressed }) => [
                  styles.modalDelete,
                  pressed && styles.modalDeletePressed,
                  deleteMutation.isPending && styles.headerBtnDisabled,
                ]}
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator color={Color.onPrimary} size="small" />
                ) : (
                  <Text style={[Type.body, { color: Color.onPrimary, fontWeight: '800' }]}>确认删除</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------- 子组件 ---------- */

function KindChip({
  active,
  label,
  hint,
  onPress,
}: {
  active: boolean;
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.kindChip,
        active && styles.kindChipActive,
        pressed && !active && styles.kindChipPressed,
      ]}
    >
      <Text style={[Type.body, { color: active ? Color.onPrimary : Color.ink, fontWeight: '800' }]}>
        {label}
      </Text>
      {hint ? (
        <Text style={[Type.micro, { color: active ? Color.onPrimary : Color.inkFaint, marginTop: 2 }]}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Markdown 编辑器:TextInput + 下方纯文本预览(不引入 react-native-markdown-display,避免 native rebuild 风险)。
 */
function MarkdownEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (t: string) => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.editorPane, styles.editorPaneTop]}>
        <TextInput
          value={content}
          onChangeText={onChange}
          multiline
          autoCapitalize="sentences"
          autoCorrect
          spellCheck
          textAlignVertical="top"
          style={styles.editorInput}
          accessibilityLabel="Markdown 编辑区"
          placeholder="# 标题\n\n开始写..."
          placeholderTextColor={Color.inkDisabled}
        />
      </View>
      <View style={styles.previewDivider} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.previewScroll} showsVerticalScrollIndicator>
        <View style={styles.previewMetaRow}>
          <Text style={[Type.microBold, { color: Color.inkFaint, letterSpacing: 0.4 }]}>预览(纯文本)</Text>
        </View>
        <Text style={[Type.body, { color: Color.ink, lineHeight: 22 }]} selectable>
          {content || '在上面的编辑区输入 markdown,这里会显示纯文本预览。'}
        </Text>
      </ScrollView>
    </View>
  );
}

/**
 * HTML 编辑器:源码 + 纯 RN 预览。避免新增 WebView/native 依赖,但让手机端可直接验收 HTML 阅读效果。
 */
function HtmlEditor({ content, onChange }: { content: string; onChange: (t: string) => void }) {
  const blocks = useMemo(() => parseHtml(content), [content]);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.previewScroll} showsVerticalScrollIndicator>
        <View style={styles.previewMetaRow}>
          <Text style={[Type.microBold, { color: Color.inkFaint, letterSpacing: 0.4 }]}>HTML 预览</Text>
          <Text style={[Type.micro, { color: Color.inkFaint }]}>源码在下方可编辑</Text>
        </View>
        <HtmlPreviewBlocks blocks={blocks} />
      </ScrollView>
      <View style={styles.previewDivider} />
      <View style={[styles.editorPane, { minHeight: 220 }]}>
        <TextInput
          value={content}
          onChangeText={onChange}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textAlignVertical="top"
          style={[styles.editorInput, styles.editorInputMono]}
          accessibilityLabel="HTML 源码编辑区"
          placeholder="<!doctype html>\n..."
          placeholderTextColor={Color.inkDisabled}
        />
      </View>
    </View>
  );
}

function HtmlPreviewBlocks({ blocks }: { blocks: HtmlBlock[] }) {
  if (!blocks.length) {
    return <Text style={[Type.body, { color: Color.inkFaint }]}>空 HTML</Text>;
  }
  return (
    <View style={styles.htmlPreviewBlock} testID="mobile-html-preview">
      {blocks.map((block, index) => (
        <HtmlPreviewBlock key={`${block.kind}-${index}`} block={block} />
      ))}
    </View>
  );
}

function HtmlPreviewBlock({ block }: { block: HtmlBlock }) {
  if (block.kind === 'heading') {
    const headingStyle = block.level <= 1 ? Type.h1 : block.level === 2 ? Type.h2 : Type.h3;
    return (
      <Text style={[headingStyle, styles.htmlHeading]} selectable>
        {block.text}
      </Text>
    );
  }
  if (block.kind === 'list') {
    return (
      <View style={styles.htmlList}>
        {block.items.map((item, index) => (
          <Text key={`${index}-${item}`} style={[Type.body, styles.htmlText]} selectable>
            {block.ordered ? `${index + 1}. ` : '• '}
            {item}
          </Text>
        ))}
      </View>
    );
  }
  if (block.kind === 'code') {
    return (
      <Text style={[Type.mono, styles.htmlCode]} selectable>
        {block.text}
      </Text>
    );
  }
  if (block.kind === 'quote') {
    return (
      <Text style={[Type.body, styles.htmlQuote]} selectable>
        {block.text}
      </Text>
    );
  }
  if (block.kind === 'rule') {
    return <View style={styles.htmlRule} />;
  }
  return (
    <Text style={[Type.body, styles.htmlText]} selectable>
      {block.text}
    </Text>
  );
}

/* ---------- 样式 ---------- */

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: Color.surfaceSubtle,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    backgroundColor: Color.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Color.border,
  },
  headerBtn: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.primarySoft,
    backgroundColor: Color.primarySofter,
  },
  headerBtnPressed: {
    backgroundColor: Color.primarySoft,
  },
  headerBtnPrimary: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    backgroundColor: Color.primary,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnPrimaryPressed: {
    backgroundColor: Color.primaryDeep,
  },
  headerBtnDisabled: {
    opacity: 0.4,
  },
  modeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    backgroundColor: Color.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Color.border,
  },
  editorPane: {
    backgroundColor: Color.surface,
  },
  editorPaneFull: {
    flex: 1,
    padding: Space.lg,
  },
  editorPaneTop: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    minHeight: 180,
  },
  editorInput: {
    fontSize: 15,
    lineHeight: 22,
    color: Color.ink,
    padding: 0,
  },
  editorInputMono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 13,
    lineHeight: 20,
  },
  previewDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Color.border,
  },
  previewScroll: {
    padding: Space.lg,
    paddingBottom: 160,
  },
  previewMetaRow: {
    marginBottom: Space.sm,
  },
  htmlPreviewBlock: {
    gap: Space.sm,
  },
  htmlHeading: {
    color: Color.ink,
    marginTop: Space.sm,
    marginBottom: Space.xs,
  },
  htmlText: {
    color: Color.ink,
    lineHeight: 22,
    marginBottom: Space.xs,
  },
  htmlList: {
    gap: 4,
    marginBottom: Space.sm,
  },
  htmlCode: {
    color: Color.ink,
    backgroundColor: Color.surfaceMuted,
    borderColor: Color.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.md,
    marginBottom: Space.sm,
  },
  htmlQuote: {
    color: Color.inkMuted,
    lineHeight: 22,
    borderLeftWidth: 3,
    borderLeftColor: Color.primarySoft,
    paddingLeft: Space.md,
    marginBottom: Space.sm,
  },
  htmlRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Color.border,
    marginVertical: Space.md,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    backgroundColor: Color.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.border,
    gap: Space.sm,
  },
  deleteBtn: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    backgroundColor: Color.danger,
    minWidth: 120,
    alignItems: 'center',
  },
  deleteBtnPressed: {
    backgroundColor: '#8B1812',
  },
  errorPanel: {
    backgroundColor: Color.dangerSoft,
    borderColor: Color.dangerBorder,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.lg,
    alignSelf: 'stretch',
    marginHorizontal: Space.lg,
  },
  // create 模式样式
  createContent: {
    padding: Space.lg,
    gap: Space.md,
  },
  createCard: {
    backgroundColor: Color.surface,
    borderColor: Color.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Space.lg,
    ...Shadow.sm,
  },
  createInput: {
    marginTop: Space.sm,
    fontSize: 17,
    fontWeight: '700',
    color: Color.ink,
    borderBottomWidth: 1,
    borderBottomColor: Color.border,
    paddingVertical: Space.sm,
  },
  kindRow: {
    flexDirection: 'row',
    gap: Space.md,
    marginTop: Space.sm,
  },
  kindChip: {
    flex: 1,
    padding: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.border,
    backgroundColor: Color.surfaceMuted,
    alignItems: 'center',
  },
  kindChipActive: {
    backgroundColor: Color.primary,
    borderColor: Color.primary,
  },
  kindChipPressed: {
    backgroundColor: Color.primarySofter,
  },
  helpCard: {
    backgroundColor: Color.infoSoft,
    borderColor: Color.infoBorder,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.lg,
  },
  // modal
  modalScrim: {
    flex: 1,
    backgroundColor: Color.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  modalCard: {
    backgroundColor: Color.surface,
    borderRadius: Radius.lg,
    padding: Space.lg,
    alignSelf: 'stretch',
    maxWidth: 360,
    ...Shadow.lg,
  },
  modalActions: {
    flexDirection: 'row',
    gap: Space.sm,
    marginTop: Space.lg,
    justifyContent: 'flex-end',
  },
  modalCancel: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.border,
    backgroundColor: Color.surface,
  },
  modalCancelPressed: {
    backgroundColor: Color.surfaceMuted,
  },
  modalDelete: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Color.danger,
  },
  modalDeletePressed: {
    backgroundColor: '#8B1812',
  },
});
