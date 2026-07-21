import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  RefreshControl,
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
import { fetchKnowledgeAtlas, humanizeMobileError, listKb, parentKbPath, readKb } from '@/lib/api';
import { loadMobileSession } from '@/lib/storage';
import { parseHtml, type HtmlBlock } from '@/lib/htmlPreview';
import type { KbEntry, KbEntryKind, MobileKnowledgeAtlasResponse, MobileKnowledgeAtlasSource, MobileSession } from '@/lib/types';

type KnowledgeView = 'map' | 'vault' | 'sources';

type ReaderState =
  | { kind: 'idle' }
  | { kind: 'loading'; name: string }
  | { kind: 'ready'; name: string; fileKind: 'markdown' | 'html'; content: string; size: number; bytes: number }
  | { kind: 'error'; name: string; message: string };

function kindGlyph(kind: KbEntryKind): string {
  if (kind === 'directory') return '📁';
  if (kind === 'markdown') return '📝';
  if (kind === 'html') return '🌐';
  return '·';
}

function kindLabel(kind: KbEntryKind): string {
  if (kind === 'directory') return '目录';
  if (kind === 'markdown') return 'Markdown';
  if (kind === 'html') return 'HTML';
  return '文件';
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatPath(p: string): string {
  if (!p || p === '/') return 'vault 根目录';
  return p;
}

function joinPath(parent: string, child: string): string {
  if (!parent || parent === '/') return '/' + child;
  return parent + '/' + child;
}

// P1 contract: detect whether an atlas source path can be drilled into the
// existing editor. Returns the inferred kind, or null if the source is not
// drill-downable (missing path, unsupported type, etc.).
function drillDownKindFromPath(path: string, type?: string): "markdown" | "html" | null {
  const lower = String(path || "").toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  const t = String(type || "").toLowerCase();
  if (t === "markdown" || t === "html") return t as "markdown" | "html";
  return null;
}

function describeSourceDisabled(path: string, type?: string): string {
  if (!path) return "无路径 — 不可下钻";
  if (drillDownKindFromPath(path, type)) return "";
  return `不支持的类型: ${type || "未知"} — 只支持 .md / .html`;
}

export default function KnowledgeScreen({ onOpenEditor, onRePair, onOpenCapture }: { onOpenEditor?: (params: { path: string; mode: 'edit' | 'create' | 'preview'; kind?: 'markdown' | 'html' }) => void; onRePair?: () => void; onOpenCapture?: () => void } = {}) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<MobileSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [reader, setReader] = useState<ReaderState>({ kind: 'idle' });
  const [newMenuOpen, setNewMenuOpen] = useState<boolean>(false);
  const [view, setView] = useState<KnowledgeView>('map');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    let active = true;
    loadMobileSession()
      .then((stored) => active && setSession(stored))
      .finally(() => active && setLoadingSession(false));
    return () => {
      active = false;
    };
  }, []);

  const listQuery = useQuery({
    queryKey: ['kb-list', session?.serverUrl, session?.device.id, currentPath],
    enabled: Boolean(session),
    queryFn: () => listKb(session as MobileSession, currentPath, setSession),
  });

  const atlasQuery = useQuery({
    queryKey: ['knowledge-atlas', session?.serverUrl, session?.device.id],
    enabled: Boolean(session),
    queryFn: () => fetchKnowledgeAtlas(session as MobileSession, setSession),
  });

  const filteredSources = useMemo(() => {
    const rows = atlasQuery.data?.sourceStates || [];
    const query = searchText.trim().toLowerCase();
    if (!query) return rows.slice(0, 24);
    return rows.filter((row) => {
      const text = `${row.title} ${row.path} ${row.source} ${row.type} ${row.status} ${row.summary}`.toLowerCase();
      return text.includes(query);
    }).slice(0, 24);
  }, [atlasQuery.data?.sourceStates, searchText]);

  const readMutation = useMutation({
    mutationFn: async (entry: KbEntry) => {
      if (!session) throw new Error('not_paired');
      setReader({ kind: 'loading', name: entry.name });
      const result = await readKb(session, entry.path, setSession);
      return { entry, result };
    },
    onSuccess: ({ entry, result }) => {
      Haptics.tick();
      setReader({
        kind: 'ready',
        name: entry.name,
        fileKind: result.kind,
        content: result.content,
        size: result.size,
        bytes: result.bytes,
      });
    },
    onError: (err, entry) => {
      Haptics.error();
      setReader({
        kind: 'error',
        name: entry.name,
        message: humanizeMobileError(err instanceof Error ? err.message : String(err)),
      });
    },
  });

  function handleEntryPress(entry: KbEntry) {
    if (entry.kind === 'directory') {
      Haptics.tick();
      setReader({ kind: 'idle' });
      setCurrentPath(entry.path);
      return;
    }
    if (entry.kind === 'markdown') {
      if (onOpenEditor) {
        Haptics.tick();
        onOpenEditor({ path: entry.path, mode: 'edit', kind: 'markdown' });
        return;
      }
      readMutation.mutate(entry);
      return;
    }
    if (entry.kind === 'html') {
      // 2026-06-26 — HTML 默认走预览模式 (NJX 反馈: 显示源码不是 HTML 渲染)。在编辑器里可切回 source。
      if (onOpenEditor) {
        Haptics.tick();
        onOpenEditor({ path: entry.path, mode: 'preview', kind: 'html' });
        return;
      }
      readMutation.mutate(entry);
      return;
    }
    Haptics.warn();
    setReader({ kind: 'error', name: entry.name, message: '目前只支持浏览和编辑 .md / .html 文件' });
  }

  function handleBackToList() {
    Haptics.light();
    setReader({ kind: 'idle' });
  }

  function handleParent() {
    if (currentPath === '/') return;
    Haptics.tick();
    setReader({ kind: 'idle' });
    setCurrentPath(parentKbPath(currentPath));
  }

  function handleRetry() {
    Haptics.light();
    setReader({ kind: 'idle' });
    queryClient.invalidateQueries({ queryKey: ['kb-list'] });
  }

  // P1 contract: open an atlas source (Selected Source card or list row) in
  // the existing editor. Falls back to the reader flow when onOpenEditor
  // is not provided. Disabled when path is missing or unsupported.
  function openAtlasSource(source: MobileKnowledgeAtlasSource) {
    const path = String(source?.path || "").trim();
    const kind = drillDownKindFromPath(path, source?.type);
    if (!kind) {
      Haptics.warn();
      return;
    }
    if (onOpenEditor) {
      Haptics.tick();
      onOpenEditor({ path, mode: kind === "html" ? "preview" : "edit", kind });
      return;
    }
    Haptics.tick();
    setReader({ kind: "loading", name: source.title || path });
    readKb(session as MobileSession, path, setSession)
      .then((result) => {
        setReader({
          kind: "ready",
          name: source.title || path,
          fileKind: result.kind,
          content: result.content,
          size: result.size,
          bytes: result.bytes,
        });
      })
      .catch((err) => {
        Haptics.error();
        setReader({
          kind: "error",
          name: source.title || path,
          message: humanizeMobileError(err instanceof Error ? err.message : String(err)),
        });
      });
  }

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
            description="回到记录页完成 6 位配对码登录,即可浏览 Mac 工作台上的知识库。"
            tone="muted"
          />
        </View>
      </SafeAreaView>
    );
  }

  if (reader.kind === 'ready' || reader.kind === 'loading' || reader.kind === 'error') {
    return (
      <ReaderView
        state={reader}
        parentLabel={formatPath(currentPath)}
        onBack={handleBackToList}
        onRetry={handleRetry}
      />
    );
  }

  const entries = listQuery.data?.entries || [];
  const isRoot = currentPath === '/';
  const vaultReadOnly = Boolean(listQuery.data?.readOnly || listQuery.data?.vault?.writable === false);
  const vaultWriteReason = listQuery.data?.vault?.writeReason || "nas_root_read_only";

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={atlasQuery.isFetching || (view === 'vault' && listQuery.isFetching)}
            onRefresh={() => {
              void atlasQuery.refetch();
              if (view === 'vault') void listQuery.refetch();
            }}
          />
        }
      >
        <View style={styles.header}>
          <Text style={[Type.microBold, { color: Color.primary, letterSpacing: 0.5 }]}>知识库</Text>
          <Text style={[Type.displaySm, { color: Color.ink, marginTop: 2 }]}>知识地图</Text>

          <Pressable
            onPress={() => { Haptics.tick(); onOpenCapture?.(); }}
            style={({ pressed }) => [styles.quickNewButton, pressed && { opacity: 0.7 }]}
            testID="knowledge-quick-new"
            accessibilityLabel="快速新建笔记"
          >
            <Text style={styles.quickNewButtonGlyph}>+</Text>
            <Text style={styles.quickNewButtonLabel}>新建笔记</Text>
          </Pressable>
          <Text style={[Type.body, { color: Color.inkFaint, marginTop: 4 }]} numberOfLines={1}>
            {atlasQuery.data?.vault
              ? `源: ${atlasQuery.data.vault.vaultLabel || atlasQuery.data.vault.displayName}${atlasQuery.data.vault.vaultAvailable === false || atlasQuery.data.vault.status === "unavailable" ? " · 未挂载" : ""}`
              : listQuery.data?.vaultRoot
                ? `vault 根: ${listQuery.data.vaultRoot}`
                : "浏览知识地图、来源状态，并保留 markdown / html 编辑入口。"}
          </Text>
          {(atlasQuery.data?.vault?.vaultAvailable === false || atlasQuery.data?.vault?.status === "unavailable") ? (
            <Text style={[Type.caption, { color: Color.warnInk, marginTop: 4 }]} testID="mobile-knowledge-vault-warning">
              {(atlasQuery.data?.vault?.vaultFallbackReason || atlasQuery.data?.vault?.reason)
                ? `南极熊未挂载: ${atlasQuery.data?.vault?.vaultFallbackReason || atlasQuery.data?.vault?.reason}`
                : "南极熊未挂载,请检查 NAS 连接。"}
            </Text>
          ) : null}
        </View>

        <KnowledgeTabs value={view} onChange={setView} />

        {view === 'map' ? (
          <AtlasOverview
            atlas={atlasQuery.data || null}
            loading={atlasQuery.isLoading}
            error={atlasQuery.error}
            searchText={searchText}
            onSearchText={setSearchText}
            filteredSources={filteredSources}
            onRetry={() => atlasQuery.refetch()}
            onRePair={onRePair}
            onOpenSource={openAtlasSource}
            onOpenCategory={(cat) => { setSearchText(cat.title); setView('sources'); }}
          />
        ) : view === 'sources' ? (
          <SourceOverview
            atlas={atlasQuery.data || null}
            loading={atlasQuery.isLoading}
            error={atlasQuery.error}
            onRetry={() => atlasQuery.refetch()}
            onRePair={onRePair}
            onOpenSource={openAtlasSource}
          />
        ) : (
          <>
            <View style={styles.crumbCard}>
              <View style={styles.crumbHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[Type.captionBold, { color: Color.inkFaint, letterSpacing: 0.4 }]}>当前路径</Text>
                  <Text style={[Type.h3, { color: Color.ink, marginTop: 2 }]} numberOfLines={1}>
                    {formatPath(currentPath)}
                  </Text>
                  <Text style={[Type.caption, { color: Color.inkFaint, marginTop: 2 }]}>
                    vault 根: {listQuery.data?.vaultRoot || '/Users/njx/openclaw'}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="返回上级目录"
                  accessibilityState={{ disabled: isRoot }}
                  disabled={isRoot}
                  onPress={handleParent}
                  style={({ pressed }) => [
                    styles.upButton,
                    isRoot && styles.upButtonDisabled,
                    pressed && !isRoot && styles.upButtonPressed,
                  ]}
                >
                  <Text style={[Type.captionBold, { color: isRoot ? Color.inkDisabled : Color.primary }]}>← 上级</Text>
                </Pressable>
              </View>
            </View>

            {listQuery.isLoading ? (
              <View style={styles.center}>
                <ActivityIndicator color={Color.primary} />
                <Text style={[Type.body, { color: Color.inkFaint, marginTop: Space.sm }]}>正在读取目录…</Text>
              </View>
            ) : listQuery.error ? (
              <View style={styles.errorPanel}>
                <Text style={[Type.h3, { color: Color.dangerInk }]}>无法读取目录</Text>
                <Text style={[Type.bodySm, { color: Color.dangerInk, marginTop: Space.xs }]}>
                  {humanizeMobileError(
                    listQuery.error instanceof Error ? listQuery.error.message : String(listQuery.error),
                  )}
                </Text>
                <View style={{ marginTop: Space.md, alignSelf: 'flex-start' }}>
                  <Button label="重试" tone="secondary" size="sm" onPress={handleRetry} />
                </View>
              </View>
            ) : entries.length === 0 ? (
              <View style={styles.emptyPanel}>
                <EmptyState
                  icon="·"
                  title="空目录"
                  description="当前目录下没有可浏览的文件。点上级返回上一层。"
                  tone="muted"
                />
              </View>
            ) : (
              <View>
                <View style={styles.listActionRow}>
                  <Text style={[Type.caption, { color: Color.inkFaint, flex: 1 }]}>
                    {vaultReadOnly ? '南极熊只读 · 可浏览/预览，新增请回首页添加笔记' : '点击文件 = 编辑 · 点击目录 = 进入'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="新建笔记"
                    accessibilityState={{ disabled: vaultReadOnly }}
                    disabled={vaultReadOnly}
                    onPress={() => {
                      Haptics.tick();
                      setNewMenuOpen(true);
                    }}
                    style={({ pressed }) => [styles.newButton, vaultReadOnly && styles.newButtonDisabled, pressed && !vaultReadOnly && styles.newButtonPressed]}
                  >
                    <Text style={[Type.captionBold, { color: vaultReadOnly ? Color.inkDisabled : Color.onPrimary }]}>+ 新建</Text>
                  </Pressable>
                </View>
                {vaultReadOnly ? (
                  <View style={styles.readOnlyPanel} testID="mobile-knowledge-vault-readonly">
                    <Text style={[Type.bodySm, { color: Color.warnInk, fontWeight: '900' }]}>南极熊当前只读</Text>
                    <Text style={[Type.caption, { color: Color.inkMuted, marginTop: 2 }]}>
                      原因: {vaultWriteReason}。此页可浏览、搜索和预览;新增知识请用首页"添加笔记",会生成 Markdown + HTML 入库。
                    </Text>
                  </View>
                ) : null}
                <View style={styles.listCard}>
                  {entries.map((entry, index) => (
                    <EntryRow
                      key={`${entry.kind}-${entry.path}`}
                      entry={entry}
                      showTopBorder={index > 0}
                      onPress={() => handleEntryPress(entry)}
                    />
                  ))}
                  <Text style={[Type.micro, { color: Color.inkFaint, textAlign: 'center', paddingVertical: Space.md }]}>
                    共 {entries.length} 项 · 隐藏 . 开头的隐藏文件
                  </Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* 新建菜单 — 选 markdown / html */}
      <Modal visible={newMenuOpen} transparent animationType="fade" onRequestClose={() => setNewMenuOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={[Type.h2, { color: Color.ink }]}>新建笔记</Text>
            <Text style={[Type.bodySm, { color: Color.inkMuted, marginTop: Space.xs, lineHeight: 20 }]}>
              将在当前目录 <Text style={{ fontFamily: 'Menlo' }}>{formatPath(currentPath)}</Text> 下创建。
            </Text>
            <View style={styles.modalActions}>
              <NewKindButton
                glyph="📝"
                title="Markdown"
                hint=".md · 适合笔记/文档"
                onPress={() => {
                  setNewMenuOpen(false);
                  if (onOpenEditor) {
                    onOpenEditor({ path: currentPath, mode: 'create', kind: 'markdown' });
                  }
                }}
              />
              <NewKindButton
                glyph="🌐"
                title="HTML"
                hint=".html · 适合页面/模板"
                onPress={() => {
                  setNewMenuOpen(false);
                  if (onOpenEditor) {
                    onOpenEditor({ path: currentPath, mode: 'create', kind: 'html' });
                  }
                }}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消新建"
              onPress={() => {
                Haptics.light();
                setNewMenuOpen(false);
              }}
              style={({ pressed }) => [styles.modalCancel, pressed && styles.modalCancelPressed]}
            >
              <Text style={[Type.body, { color: Color.ink, textAlign: 'center' }]}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function KnowledgeTabs({ value, onChange }: { value: KnowledgeView; onChange: (value: KnowledgeView) => void }) {
  const tabs: Array<{ id: KnowledgeView; label: string }> = [
    { id: 'map', label: '地图' },
    { id: 'sources', label: '来源' },
    { id: 'vault', label: 'Vault' },
  ];
  return (
    <View style={styles.segmented}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.id}
          accessibilityRole="button"
          accessibilityState={{ selected: value === tab.id }}
          onPress={() => {
            Haptics.tick();
            onChange(tab.id);
          }}
          style={[styles.segment, value === tab.id && styles.segmentActive]}
        >
          <Text style={[Type.captionBold, { color: value === tab.id ? Color.primary : Color.inkFaint }]}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function AtlasOverview({
  atlas,
  loading,
  error,
  searchText,
  onSearchText,
  filteredSources,
  onRetry,
  onRePair,
  onOpenSource,
  onOpenCategory,
}: {
  atlas: MobileKnowledgeAtlasResponse | null;
  loading: boolean;
  error: unknown;
  searchText: string;
  onSearchText: (value: string) => void;
  filteredSources: MobileKnowledgeAtlasSource[];
  onRetry: () => void;
  onRePair?: () => void;
  onOpenSource: (source: MobileKnowledgeAtlasSource) => void;
  onOpenCategory: (category: { id?: string; title: string }) => void;
}) {
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Color.primary} />
        <Text style={[Type.body, { color: Color.inkFaint, marginTop: Space.sm }]}>正在读取知识地图…</Text>
      </View>
    );
  }
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isUnauthorized = /unauthorized|设备令牌|token_revoked|invalid_login|login_required/i.test(message);
    return (
      <View style={styles.errorPanel}>
        <Text style={[Type.h3, { color: Color.dangerInk }]}>无法读取知识地图</Text>
        <Text style={[Type.bodySm, { color: Color.dangerInk, marginTop: Space.xs }]}>
          {humanizeMobileError(message)}
        </Text>
        <View style={{ marginTop: Space.md, flexDirection: 'row', gap: Space.sm, alignSelf: 'flex-start' }}>
          <Button label="重试" tone="secondary" size="sm" onPress={onRetry} />
          {isUnauthorized && onRePair ? (
            <Button
              label="重新配对"
              tone="danger"
              size="sm"
              onPress={onRePair}
              testID="mobile-knowledge-repair"
            />
          ) : null}
        </View>
      </View>
    );
  }
  if (!atlas) return null;
  const selectedSource = filteredSources[0] || atlas.sourceStates[0] || null;
  return (
    <View style={styles.mapStack}>
      <View style={styles.summaryCard}>
        <Text style={[Type.captionBold, { color: Color.inkFaint }]}>ATLAS SUMMARY</Text>
        <Text style={[Type.h2, { color: Color.ink, marginTop: 4 }]}>全库知识地图</Text>
        <Text style={[Type.bodySm, { color: Color.inkMuted, marginTop: 4 }]}>
          {atlas.atlasSummary.summary || '汇总桌面知识库、NAS、本地笔记、Wiki 和生成产物。'}
        </Text>
        <View style={styles.metricGrid}>
          <MetricCell label="来源" value={atlas.atlasSummary.sourceCount} />
          <MetricCell label="分类" value={atlas.atlasSummary.categoryCount} />
          <MetricCell label="节点" value={atlas.atlasSummary.graphNodeCount} />
          <MetricCell label="待审" value={atlas.atlasSummary.reviewCount} />
        </View>
      </View>

      <TextInput
        value={searchText}
        onChangeText={onSearchText}
        placeholder="搜索知识地图、笔记、HTML、Markdown"
        placeholderTextColor={Color.inkDisabled}
        style={styles.searchInput}
      />

      <View style={styles.mapPanel}>
        <View style={styles.panelHeader}>
          <Text style={[Type.h3, { color: Color.ink }]}>Selected Source</Text>
          <Text style={[Type.caption, { color: Color.inkFaint }]}>当前来源</Text>
        </View>
        {selectedSource ? (
          (() => {
            const disabledReason = describeSourceDisabled(selectedSource.path || "", selectedSource.type);
            const drillable = !disabledReason;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  drillable
                    ? `打开 ${selectedSource.title} 进入编辑`
                    : `${selectedSource.title} 不可下钻: ${disabledReason}`
                }
                accessibilityState={{ disabled: !drillable }}
                testID="mobile-knowledge-selected-source"
                disabled={!drillable}
                onPress={() => {
                  if (!drillable) {
                    Haptics.warn();
                    return;
                  }
                  onOpenSource(selectedSource);
                }}
                style={({ pressed }) => [
                  styles.selectedSourceCard,
                  drillable && pressed && styles.selectedSourceCardPressed,
                  !drillable && styles.selectedSourceCardDisabled,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[Type.bodySm, { color: Color.ink, fontWeight: '900' }]} numberOfLines={2}>
                    {selectedSource.title}
                  </Text>
                  <Text style={[Type.caption, { color: Color.inkFaint, marginTop: 2 }]} numberOfLines={2}>
                    {selectedSource.path || selectedSource.source || '无路径'}
                  </Text>
                  <Text style={[Type.caption, { color: Color.inkMuted, marginTop: 4 }]} numberOfLines={3}>
                    {selectedSource.summary || (drillable ? '点击进入编辑器。' : disabledReason)}
                  </Text>
                </View>
                <View style={styles.sourceBadge}>
                  <Text style={[Type.microBold, { color: drillable ? Color.primary : Color.inkDisabled }]}>
                    {selectedSource.status || selectedSource.type}
                  </Text>
                </View>
              </Pressable>
            );
          })()
        ) : (
          <Text style={styles.emptyText}>暂无来源。</Text>
        )}
      </View>

      <View style={styles.mapPanel}>
        <View style={styles.panelHeader}>
          <Text style={[Type.h3, { color: Color.ink }]}>知识分类</Text>
          <Text style={[Type.caption, { color: Color.inkFaint }]}>{atlas.categories.length} 类</Text>
        </View>
        {atlas.categories.slice(0, 8).map((category) => (
          <Pressable
            key={category.id || category.title}
            style={({ pressed }) => [styles.categoryRow, pressed && { opacity: 0.7 }]}
            onPress={() => {
              Haptics.tick();
              onOpenCategory({ id: category.id, title: category.title });
            }}
            testID={`mobile-knowledge-category-${category.id || category.title}`}
            accessibilityLabel={`打开分类 ${category.title}`}
          >
            <View style={{ flex: 1 }}>
              <Text style={[Type.bodySm, { color: Color.ink, fontWeight: '900' }]}>{category.title}</Text>
              <Text style={[Type.caption, { color: Color.inkFaint }]} numberOfLines={2}>
                {category.summary || `${category.sourceCount} 来源 · ${category.wikiCount} Wiki`}
              </Text>
            </View>
            <Text style={[Type.microBold, { color: Color.primary }]}>{category.sourceCount}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.mapPanel}>
        <View style={styles.panelHeader}>
          <Text style={[Type.h3, { color: Color.ink }]}>来源检索</Text>
          <Text style={[Type.caption, { color: Color.inkFaint }]}>{filteredSources.length} 项</Text>
        </View>
        {filteredSources.length ? filteredSources.slice(0, 12).map((source) => (
          <SourceRow
            key={`${source.id}-${source.path}`}
            source={source}
            onOpen={onOpenSource}
          />
        )) : (
          <Text style={styles.emptyText}>没有匹配来源。</Text>
        )}
      </View>
    </View>
  );
}

function SourceOverview({
  atlas,
  loading,
  error,
  onRetry,
  onRePair,
  onOpenSource,
}: {
  atlas: MobileKnowledgeAtlasResponse | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onRePair?: () => void;
  onOpenSource: (source: MobileKnowledgeAtlasSource) => void;
}) {
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Color.primary} />
        <Text style={[Type.body, { color: Color.inkFaint, marginTop: Space.sm }]}>正在读取来源状态…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.errorPanel}>
        <Text style={[Type.h3, { color: Color.dangerInk }]}>无法读取来源状态</Text>
        <Text style={[Type.bodySm, { color: Color.dangerInk, marginTop: Space.xs }]}>
          {humanizeMobileError(error instanceof Error ? error.message : String(error))}
        </Text>
        <View style={{ marginTop: Space.md, alignSelf: 'flex-start' }}>
          <Button label="重试" tone="secondary" size="sm" onPress={onRetry} />
        </View>
      </View>
    );
  }
  const entries = Object.entries(atlas?.sources || {});
  return (
    <View style={styles.mapStack}>
      <View style={styles.mapPanel}>
        <View style={styles.panelHeader}>
          <Text style={[Type.h3, { color: Color.ink }]}>连接来源</Text>
          <Text style={[Type.caption, { color: Color.inkFaint }]}>{entries.length} 个</Text>
        </View>
        {entries.map(([key, source]) => (
          <View key={key} style={styles.sourceStateRow}>
            <View style={{ flex: 1 }}>
              <Text style={[Type.bodySm, { color: Color.ink, fontWeight: '900' }]}>{key}</Text>
              <Text style={[Type.caption, { color: Color.inkFaint }]} numberOfLines={2}>{source.root || source.reason || '无路径'}</Text>
            </View>
            <Text style={[Type.microBold, { color: source.status === 'connected' ? Color.okInk : Color.warnInk }]}>
              {source.status}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.mapPanel}>
        <View style={styles.panelHeader}>
          <Text style={[Type.h3, { color: Color.ink }]}>最近来源</Text>
          <Text style={[Type.caption, { color: Color.inkFaint }]}>{atlas?.sourceStates.length || 0} 项</Text>
        </View>
        {(atlas?.sourceStates || []).slice(0, 18).map((source) => (
          <SourceRow
            key={`${source.id}-${source.path}`}
            source={source}
            onOpen={onOpenSource}
          />
        ))}
      </View>
    </View>
  );
}

function MetricCell({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metricCell}>
      <Text style={[Type.h2, { color: Color.ink }]}>{value}</Text>
      <Text style={[Type.microBold, { color: Color.inkFaint }]}>{label}</Text>
    </View>
  );
}

function SourceRow({ source, onOpen }: { source: MobileKnowledgeAtlasSource; onOpen: (source: MobileKnowledgeAtlasSource) => void }) {
  const disabledReason = describeSourceDisabled(source.path || "", source.type);
  const drillable = !disabledReason;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        drillable
          ? `打开 ${source.title} 进入编辑`
          : `${source.title} 不可下钻: ${disabledReason}`
      }
      accessibilityState={{ disabled: !drillable }}
      testID={`mobile-knowledge-source-row-${source.id}`}
      disabled={!drillable}
      onPress={() => {
        if (!drillable) {
          Haptics.warn();
          return;
        }
        onOpen(source);
      }}
      style={({ pressed }) => [
        styles.sourceRow,
        drillable && pressed && styles.sourceRowPressed,
        !drillable && styles.sourceRowDisabled,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[Type.bodySm, { color: drillable ? Color.ink : Color.inkDisabled, fontWeight: '900' }]} numberOfLines={1}>{source.title}</Text>
        <Text style={[Type.caption, { color: Color.inkFaint }]} numberOfLines={1}>{source.path || source.source}</Text>
        {source.summary ? (
          <Text style={[Type.caption, { color: Color.inkMuted, marginTop: 2 }]} numberOfLines={2}>{source.summary}</Text>
        ) : null}
        {!drillable ? (
          <Text style={[Type.micro, { color: Color.inkDisabled, marginTop: 2 }]}>{disabledReason}</Text>
        ) : null}
      </View>
      <View style={styles.sourceBadge}>
        <Text style={[Type.microBold, { color: drillable ? Color.primary : Color.inkDisabled }]}>{source.status || source.type}</Text>
      </View>
    </Pressable>
  );
}

function NewKindButton({
  glyph,
  title,
  hint,
  onPress,
}: {
  glyph: string;
  title: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`新建 ${title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.newKindBtn, pressed && styles.newKindBtnPressed]}
    >
      <Text style={styles.newKindGlyph}>{glyph}</Text>
      <Text style={[Type.h3, { color: Color.ink, marginTop: Space.xs }]}>{title}</Text>
      <Text style={[Type.caption, { color: Color.inkFaint, marginTop: 2 }]}>{hint}</Text>
    </Pressable>
  );
}

/* ---------- 子组件 ---------- */

function EntryRow({
  entry,
  onPress,
  showTopBorder,
}: {
  entry: KbEntry;
  onPress: () => void;
  showTopBorder: boolean;
}) {
  const press = useState(new Animated.Value(1))[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.name} (${kindLabel(entry.kind)})`}
      onPress={onPress}
      onPressIn={() => {
        Animated.timing(press, {
          toValue: 0.97,
          duration: 100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      }}
      onPressOut={() => {
        Animated.timing(press, {
          toValue: 1,
          duration: 120,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      }}
    >
      <Animated.View
        style={[
          styles.entryRow,
          showTopBorder && styles.entryRowTopBorder,
          { transform: [{ scale: press }] },
        ]}
      >
        <Text style={styles.entryGlyph}>{kindGlyph(entry.kind)}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[Type.h3, { color: Color.ink }]} numberOfLines={1}>
            {entry.name}
          </Text>
          <Text style={[Type.caption, { color: Color.inkFaint, marginTop: 2 }]}>
            {kindLabel(entry.kind)}
            {entry.kind !== 'directory' ? ` · ${formatBytes(entry.size)}` : ''}
          </Text>
        </View>
        <Text style={[Type.captionBold, { color: Color.inkFaint }]}>
          {entry.kind === 'directory' ? '进入' : entry.kind === 'markdown' || entry.kind === 'html' ? '编辑' : '—'}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function ReaderView({
  state,
  parentLabel,
  onBack,
  onRetry,
}: {
  state: ReaderState;
  parentLabel: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <View style={styles.readerHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回列表"
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
        >
          <Text style={[Type.captionBold, { color: Color.primary }]}>← 列表</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[Type.captionBold, { color: Color.inkFaint, letterSpacing: 0.4 }]}>
            {parentLabel}
          </Text>
          <Text style={[Type.h2, { color: Color.ink, marginTop: 2 }]} numberOfLines={1}>
            {state.kind === 'idle' ? '' : state.name}
          </Text>
        </View>
      </View>

      {state.kind === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={Color.primary} />
          <Text style={[Type.body, { color: Color.inkFaint, marginTop: Space.sm }]}>正在读取文件…</Text>
        </View>
      ) : state.kind === 'error' ? (
        <View style={styles.center}>
          <View style={styles.errorPanel}>
            <Text style={[Type.h3, { color: Color.dangerInk }]}>无法打开文件</Text>
            <Text style={[Type.bodySm, { color: Color.dangerInk, marginTop: Space.xs }]}>
              {state.message}
            </Text>
            <View style={{ marginTop: Space.md, alignSelf: 'flex-start' }}>
              <Button label="返回列表" tone="secondary" size="sm" onPress={onBack} />
            </View>
          </View>
        </View>
      ) : state.kind === 'ready' ? (
        <ScrollView contentContainerStyle={styles.readerContent} showsVerticalScrollIndicator>
          <View style={styles.readerMeta}>
            <Text style={[Type.microBold, { color: Color.primary }]}>
              {state.fileKind === 'markdown' ? '📝 MARKDOWN' : '🌐 HTML'}
            </Text>
            <Text style={[Type.caption, { color: Color.inkFaint, marginTop: 2 }]}>
              {formatBytes(state.bytes)} · 只读(在编辑器里修改)
            </Text>
          </View>
          {state.fileKind === 'markdown' ? (
            <MarkdownContent text={state.content} />
          ) : (
            <HtmlPreview text={state.content} />
          )}
        </ScrollView>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={Color.primary} />
        </View>
      )}

      <View style={styles.readerFooter}>
        <Button label="刷新" tone="secondary" size="sm" onPress={onRetry} />
      </View>
    </SafeAreaView>
  );
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <View style={styles.markdownBlock}>
      <Text style={[Type.body, { color: Color.ink, lineHeight: 24 }]} selectable>
        {text}
      </Text>
    </View>
  );
}

function HtmlNotReadyPlaceholder({ text }: { text: string }) {
  return (
    <View>
      <View style={styles.htmlBanner}>
        <Text style={[Type.h3, { color: Color.warnInk }]}>HTML 预览降级</Text>
        <Text style={[Type.bodySm, { color: Color.warnInk, marginTop: Space.xs }]}>
          当前为降级渲染,只显示块级结构和纯文本。如需完整浏览器渲染,可在桌面端打开。
        </Text>
      </View>
      <HtmlPreview text={text} />
    </View>
  );
}

function HtmlPreview({ text }: { text: string }) {
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const blocks = useMemo(() => parseHtml(text), [text]);
  return (
    <View>
      <View style={styles.previewToggle}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="切换到预览"
          testID="mobile-html-preview-toggle"
          onPress={() => setViewMode(viewMode === "preview" ? "source" : "preview")}
          style={({ pressed }) => [styles.previewToggleButton, viewMode === "preview" && styles.previewToggleButtonActive, pressed && styles.previewToggleButtonPressed]}
        >
          <Text style={[Type.captionBold, { color: viewMode === "preview" ? Color.onPrimary : Color.primary }]}>
            {viewMode === "preview" ? "预览" : "切换到预览"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="切换到源码"
          onPress={() => setViewMode(viewMode === "source" ? "preview" : "source")}
          style={({ pressed }) => [styles.previewToggleButton, viewMode === "source" && styles.previewToggleButtonActive, pressed && styles.previewToggleButtonPressed]}
        >
          <Text style={[Type.captionBold, { color: viewMode === "source" ? Color.onPrimary : Color.primary }]}>
            {viewMode === "source" ? "源码" : "切换到源码"}
          </Text>
        </Pressable>
      </View>
      {viewMode === "preview" ? (
        <HtmlBlocksView blocks={blocks} />
      ) : (
        <View style={styles.markdownBlock}>
          <Text style={[Type.mono, { color: Color.inkMuted, lineHeight: 20 }]} selectable>
            {text}
          </Text>
        </View>
      )}
    </View>
  );
}

function HtmlBlocksView({ blocks }: { blocks: HtmlBlock[] }) {
  if (blocks.length === 0) {
    return (
      <View style={styles.markdownBlock}>
        <Text style={[Type.body, { color: Color.inkFaint }]}>空 HTML</Text>
      </View>
    );
  }
  return (
    <View style={styles.htmlPreviewBlock} testID="mobile-html-preview">
      {blocks.map((block, index) => (
        <HtmlBlockRow key={`${block.kind}-${index}`} block={block} />
      ))}
    </View>
  );
}

function HtmlBlockRow({ block }: { block: HtmlBlock }) {
  if (block.kind === "heading") {
    const sizeMap = { 1: Type.h1, 2: Type.h2, 3: Type.h3, 4: Type.h3, 5: Type.bodyLg, 6: Type.bodyLg } as const;
    const textStyle = sizeMap[block.level];
    return (
      <Text
        style={[
          textStyle,
          { color: Color.ink, fontWeight: "800", marginTop: Space.md, marginBottom: Space.xs },
        ]}
        selectable
      >
        {block.text}
      </Text>
    );
  }
  if (block.kind === "paragraph") {
    return (
      <Text style={[Type.body, { color: Color.ink, lineHeight: 22, marginBottom: Space.sm }]} selectable>
        {block.text}
      </Text>
    );
  }
  if (block.kind === "list") {
    return (
      <View style={{ marginBottom: Space.sm, gap: 4 }}>
        {block.items.map((item, index) => (
          <Text
            key={`${index}-${item}`}
            style={[Type.body, { color: Color.ink, lineHeight: 22 }]}
            selectable
          >
            {block.ordered ? `${index + 1}. ` : "• "}{item}
          </Text>
        ))}
      </View>
    );
  }
  if (block.kind === "code") {
    return (
      <View style={styles.codeBlock}>
        <Text style={[Type.mono, { color: Color.ink, lineHeight: 20 }]} selectable>
          {block.text}
        </Text>
      </View>
    );
  }
  if (block.kind === "quote") {
    return (
      <View style={styles.quoteBlock}>
        <Text style={[Type.body, { color: Color.inkMuted, lineHeight: 22, fontStyle: "italic" }]} selectable>
          {block.text}
        </Text>
      </View>
    );
  }
  if (block.kind === "rule") {
    return <View style={styles.ruleBlock} />;
  }
  return null;
}

/* ---------- 样式 ---------- */

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: Color.surfaceSubtle,
  },
  content: {
    padding: Space.lg,
    paddingBottom: 140,
    gap: Space.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  quickNewButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Color.primary,
    borderRadius: 10,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    alignSelf: "flex-start",
    marginTop: Space.sm,
  },
  quickNewButtonGlyph: { fontSize: 18, color: Color.surface, fontWeight: "900", marginRight: Space.xs },
  quickNewButtonLabel: { ...Type.body, color: Color.surface, fontWeight: "900" },

  header: {
    marginBottom: Space.xs,
  },
  segmented: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: Color.surfaceMuted,
    padding: 4,
    borderRadius: Radius.md,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: Color.surface,
    ...Shadow.sm,
  },
  mapStack: {
    gap: Space.md,
  },
  summaryCard: {
    backgroundColor: Color.surface,
    borderWidth: 1,
    borderColor: Color.border,
    borderRadius: Radius.lg,
    padding: Space.lg,
    ...Shadow.sm,
  },
  metricGrid: {
    flexDirection: 'row',
    gap: Space.sm,
    marginTop: Space.md,
  },
  metricCell: {
    flex: 1,
    minHeight: 62,
    borderRadius: Radius.md,
    backgroundColor: Color.surfaceMuted,
    borderWidth: 1,
    borderColor: Color.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    minHeight: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.border,
    backgroundColor: Color.surface,
    color: Color.ink,
    paddingHorizontal: Space.md,
    ...Type.body,
  },
  mapPanel: {
    backgroundColor: Color.surface,
    borderWidth: 1,
    borderColor: Color.border,
    borderRadius: Radius.lg,
    padding: Space.lg,
    gap: Space.sm,
    ...Shadow.sm,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  previewToggle: {
    flexDirection: 'row',
    gap: Space.sm,
    marginBottom: Space.sm,
  },
  previewToggleButton: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Color.primarySoft,
    backgroundColor: Color.surface,
  },
  previewToggleButtonActive: {
    backgroundColor: Color.primary,
    borderColor: Color.primary,
  },
  previewToggleButtonPressed: {
    backgroundColor: Color.primarySoft,
  },
  htmlPreviewBlock: {
    backgroundColor: Color.surface,
    borderWidth: 1,
    borderColor: Color.border,
    borderRadius: Radius.md,
    padding: Space.lg,
    gap: 2,
  },
  codeBlock: {
    backgroundColor: Color.surfaceMuted,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Color.borderSoft,
    padding: Space.md,
    marginBottom: Space.sm,
  },
  quoteBlock: {
    borderLeftWidth: 3,
    borderLeftColor: Color.primarySoft,
    paddingLeft: Space.md,
    marginBottom: Space.sm,
  },
  ruleBlock: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Color.border,
    marginVertical: Space.md,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.borderSoft,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    paddingVertical: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.borderSoft,
  },
  selectedSourceCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.borderSoft,
    backgroundColor: Color.surfaceMuted,
    padding: Space.md,
  },
  selectedSourceCardPressed: {
    backgroundColor: Color.primarySofter,
    borderColor: Color.primarySoft,
  },
  selectedSourceCardDisabled: {
    opacity: 0.55,
  },
  sourceRowPressed: {
    backgroundColor: Color.primarySofter,
  },
  sourceRowDisabled: {
    opacity: 0.55,
  },
  sourceStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.borderSoft,
  },
  sourceBadge: {
    maxWidth: 92,
    borderRadius: Radius.pill,
    backgroundColor: Color.primarySofter,
    borderWidth: 1,
    borderColor: Color.primarySoft,
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
  },
  emptyText: {
    ...Type.bodySm,
    color: Color.inkFaint,
    textAlign: 'center',
    paddingVertical: Space.lg,
  },
  crumbCard: {
    backgroundColor: Color.surface,
    borderWidth: 1,
    borderColor: Color.border,
    borderRadius: Radius.lg,
    padding: Space.lg,
    ...Shadow.sm,
  },
  crumbHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  upButton: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.primarySoft,
    backgroundColor: Color.primarySofter,
  },
  upButtonDisabled: {
    backgroundColor: Color.surfaceMuted,
    borderColor: Color.border,
  },
  upButtonPressed: {
    backgroundColor: Color.primarySoft,
  },
  emptyPanel: {
    marginTop: Space.sm,
  },
  errorPanel: {
    backgroundColor: Color.dangerSoft,
    borderColor: Color.dangerBorder,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.lg,
  },
  listCard: {
    backgroundColor: Color.surface,
    borderWidth: 1,
    borderColor: Color.border,
    borderRadius: Radius.lg,
    paddingHorizontal: Space.md,
    ...Shadow.sm,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.sm,
  },
  entryRowTopBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.borderSoft,
  },
  entryGlyph: {
    fontSize: 22,
    width: 28,
    textAlign: 'center',
  },
  readerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    backgroundColor: Color.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Color.border,
  },
  backButton: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.primarySoft,
    backgroundColor: Color.primarySofter,
  },
  backButtonPressed: {
    backgroundColor: Color.primarySoft,
  },
  readerContent: {
    padding: Space.lg,
    paddingBottom: 100,
    gap: Space.md,
  },
  readerMeta: {
    backgroundColor: Color.primarySofter,
    borderColor: Color.primarySoft,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  markdownBlock: {
    backgroundColor: Color.surface,
    borderColor: Color.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.lg,
  },
  htmlBanner: {
    backgroundColor: Color.warnSoft,
    borderColor: Color.warnBorder,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.lg,
  },
  readerFooter: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    backgroundColor: Color.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.border,
  },
  // 新建按钮 + 新建菜单
  listActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    marginBottom: Space.sm,
  },
  newButton: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    backgroundColor: Color.primary,
  },
  newButtonPressed: {
    backgroundColor: Color.primaryDeep,
  },
  newButtonDisabled: {
    backgroundColor: Color.surfaceMuted,
    borderWidth: 1,
    borderColor: Color.border,
  },
  readOnlyPanel: {
    backgroundColor: Color.warnSoft,
    borderColor: Color.warnBorder,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.md,
    marginBottom: Space.sm,
  },
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
    marginTop: Space.md,
    marginBottom: Space.sm,
  },
  modalCancel: {
    paddingVertical: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.border,
    backgroundColor: Color.surface,
  },
  modalCancelPressed: {
    backgroundColor: Color.surfaceMuted,
  },
  newKindBtn: {
    flex: 1,
    padding: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.border,
    backgroundColor: Color.surface,
    alignItems: 'center',
  },
  newKindBtnPressed: {
    backgroundColor: Color.primarySofter,
    borderColor: Color.primarySoft,
  },
  newKindGlyph: {
    fontSize: 28,
  },
});

void joinPath;
