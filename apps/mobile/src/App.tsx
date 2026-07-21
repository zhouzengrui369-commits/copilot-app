import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import CalendarScreen from '@/screens/CalendarScreen';
import CaptureScreen from '@/screens/CaptureScreen';
import DeviceScreen from '@/screens/DeviceScreen';
import KnowledgeScreen from '@/screens/KnowledgeScreen';
import NoteEditorScreen from '@/screens/NoteEditorScreen';
import TodayConsoleScreen from '@/screens/TodayConsoleScreen';
import { Color, Radius, Space, Type, Motion } from '@/constants/design';
import { Haptics } from '@/lib/haptics';
import { RecorderProvider, useRecorder } from '@/lib/RecorderContext';
import { bootstrapOfflineAsr } from '@/lib/offlineAsr';
import { tryRegisterNativeOfflineAsr } from '@/lib/engines';
import { RecorderWorkspace } from '@/components/RecorderWorkspace';

type AppTab = 'record' | 'knowledge' | 'calendar' | 'device';
type CalendarOpenParams = { kind?: 'all' | 'event' | 'task' | 'reminder' };
type CalendarFocus = CalendarOpenParams & { nonce: number };

type EditorOpenParams = { path: string; mode: 'edit' | 'create' | 'preview'; kind?: 'markdown' | 'html' };

type EditorTarget = EditorOpenParams | null;

// 2026-06-26 — Recorder floating bar lives in TodayConsoleScreen (own state, own render)

const tabs: Array<{ key: AppTab; label: string; marker: string; testID: string }> = [
  { key: 'record', label: '记录', marker: '✎', testID: 'mobile-tab-record' },
  { key: 'knowledge', label: '知识', marker: '✦', testID: 'mobile-tab-knowledge' },
  { key: 'calendar', label: '日程', marker: '▦', testID: 'mobile-tab-calendar' },
  { key: 'device', label: '设备', marker: '⚙', testID: 'mobile-tab-device' },
];

export default function App() {
  const [tab, setTab] = useState<AppTab>('record');
  const [editor, setEditor] = useState<EditorTarget>(null);
  const [calendarFocus, setCalendarFocus] = useState<CalendarFocus>({ kind: 'all', nonce: 0 });
  // 2026-06-22 — Pairing submit hitbox fix.
  // When the user is on the pairing screen (no session yet), the fixed bottom
  // tab bar covers `mobile-pair-submit` on iPhone 800-px screens (y≈802). Hide
  // the tab bar until pairing completes.
  const [pairingMode, setPairingMode] = useState(false);
  // 2026-06-25 — Capture overlay state (lives in AppShell so the JSX below can use it)
  const [captureOpen, setCaptureOpen] = useState(false);
  // 2026-06-26 — Capture draft (录音完成后转写内容预填)
  const [captureDraft, setCaptureDraft] = useState<{ title?: string; body?: string } | null>(null);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          // 2026-06-26 — NJX 反馈: 页面切换要缓存, 减少重复 fetch. 5 min staleTime.
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5 * 60_000 },
        },
      }),
    [],
  );

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <RecorderProvider>
          <AppShell
            tab={tab}
            onChangeTab={setTab}
            calendarFocus={calendarFocus}
            onOpenCalendar={(params) => {
              setCalendarFocus({ kind: params?.kind ?? 'all', nonce: Date.now() });
              setTab('calendar');
            }}
            editor={editor}
            pairingMode={pairingMode}
            onOpenEditor={(params) => setEditor(params)}
            onCloseEditor={() => setEditor(null)}
            onPairingStateChange={setPairingMode}
            captureOpen={captureOpen}
            onCloseCapture={() => { setCaptureOpen(false); setCaptureDraft(null); }}
            onOpenCapture={(draft) => { setCaptureDraft(draft || null); setCaptureOpen(true); }}
            captureDraft={captureDraft}
          />
        </RecorderProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function AppShell({
  tab,
  onChangeTab,
  calendarFocus,
  onOpenCalendar,
  editor,
  pairingMode,
  onOpenEditor,
  onCloseEditor,
  onPairingStateChange,
  captureOpen,
  onCloseCapture,
  onOpenCapture,
  captureDraft,
}: {
  tab: AppTab;
  onChangeTab: (t: AppTab) => void;
  calendarFocus: CalendarFocus;
  onOpenCalendar: (params?: CalendarOpenParams) => void;
  editor: EditorTarget;
  pairingMode: boolean;
  onOpenEditor: (params: EditorOpenParams) => void;
  onCloseEditor: () => void;
  onPairingStateChange: (active: boolean) => void;
  captureOpen: boolean;
  onCloseCapture: () => void;
  onOpenCapture: (draft?: { title?: string; body?: string }) => void;
  captureDraft: { title?: string; body?: string } | null;
}) {
  // 2026-06-25 — Re-pair key. When the user requests a fresh pairing
  // (e.g. from a knowledge error state on persistent 401), the key bump forces
  // TodayConsole and Knowledge to remount so the in-memory session resets to
  // null and the pairing UI is shown.
  const [sessionKey, setSessionKey] = useState(0);
  async function handleRePair() {
    try {
      const { clearMobileSession } = await import('@/lib/storage');
      await clearMobileSession();
    } catch {
      // Storage may be unavailable in some test environments; the key bump
      // still remounts the screens so the in-memory state resets.
    }
    setSessionKey((k) => k + 1);
  }
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(1)).current;
  const previousTab = useRef<AppTab>(tab);

  useEffect(() => {
    if (previousTab.current !== tab) {
      previousTab.current = tab;
      fade.setValue(0.4);
      Animated.timing(fade, {
        toValue: 1,
        duration: Motion.duration.base,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }
  }, [tab, fade]);

  if (captureOpen) {
    return (
      <View style={styles.shell}>
        <StatusBar barStyle="dark-content" backgroundColor={Color.surface} />
          <CaptureScreen
            onClose={onCloseCapture}
            onOpenEditor={(path, kind) => {
              onCloseCapture();
              onOpenEditor({ path, mode: kind === 'html' ? 'preview' : 'edit', kind });
            }}
            initialBody={captureDraft?.body || ""}
            initialTitle={captureDraft?.title || ""}
        />
      </View>
    );
  }

  if (editor) {
    return (
      <View style={styles.shell}>
        <StatusBar barStyle="dark-content" backgroundColor={Color.surface} />
        <NoteEditorScreen path={editor.path} mode={editor.mode} kind={editor.kind} onClose={onCloseEditor} />
      </View>
    );
  }

  // 配对模式下隐藏底部 tab bar,避免在 iPhone 800 屏 y≈802 处覆盖
  // mobile-pair-submit 的点击区。
  const hideTabBar = tab === 'record' && pairingMode;

  // Recorder workspace 全屏优先:在 App shell 这一层就接管整个屏幕,
  // 不依赖 TodayConsoleScreen 渲染,即使切换到 知识 / 日程 / 设备 仍能保持。
  return <AppShellContent
    tab={tab}
    onChangeTab={onChangeTab}
    calendarFocus={calendarFocus}
    onOpenCalendar={onOpenCalendar}
    pairingMode={pairingMode}
    onPairingStateChange={onPairingStateChange}
    onOpenEditor={onOpenEditor}
    onOpenCapture={onOpenCapture}
    onRePair={handleRePair}
    sessionKey={sessionKey}
    hideTabBar={hideTabBar}
    fade={fade}
    insets={insets}
  />;
}

// 内部组件:可以 hook to RecorderContext
function AppShellContent(props: {
  tab: AppTab;
  onChangeTab: (t: AppTab) => void;
  calendarFocus: CalendarFocus;
  onOpenCalendar: (params?: CalendarOpenParams) => void;
  pairingMode: boolean;
  onPairingStateChange: (active: boolean) => void;
  onOpenEditor: (params: EditorOpenParams) => void;
  onOpenCapture: (draft?: { title?: string; body?: string }) => void;
  onRePair: () => void;
  sessionKey: number;
  hideTabBar: boolean;
  fade: Animated.Value;
  insets: { top: number; bottom: number; left: number; right: number };
}) {
  const recorder = useRecorder();
  const {
    tab,
    onChangeTab,
    calendarFocus,
    onOpenCalendar,
    pairingMode,
    onPairingStateChange,
    onOpenEditor,
    onOpenCapture,
    onRePair,
    sessionKey,
    hideTabBar,
    fade,
    insets,
  } = props;
  const floatingActive = recorder.state.mode !== "closed" && recorder.state.minimized && tab !== 'record';
  // 2026-07-02 — R6D: shell 层 RecorderWorkspace 兜底;
  //   用户切到知识/日程/设备且未最小化时接管整个屏幕,会话/草稿/分片状态不丢。
  const shellWorkspaceActive = recorder.state.mode !== "closed" && !recorder.state.minimized && tab !== 'record';

  // 2026-07-04 — R12: 启动时挂 mac-segment-fallback 兜底,然后异步尝试装载真实 native 引擎。
  //   2026-07-06 — R17: 顺序与语义都改了:
  //   - 第一步 `bootstrapOfflineAsr()` 只挂 noop,UI 立刻看到「本地 ASR 引擎未注册」。
  //   - 第二步 `tryRegisterNativeOfflineAsr()` 探测 + 注册;成功 → sherpa-onnx 接管;
  //     失败 → 仍保留 noop 引擎,UI 会显示具体失败原因(不会自动悄悄落到 mac-segment-fallback)。
  //   - 远端兜底(mac-segment-fallback)现在是「显式 opt-in」,只在调用方主动调用
  //     setRemoteSegmentFallbackEngine() 时才会启用。R17 验收点:
  //     "Do not count server/network transcription as success for this R17 task"
  //     "Remote/Mac/server transcription may remain as explicit degraded fallback only".
  //   - effect 只跑一次(空依赖数组);setOfflineAsrEngine 内部会重置 status 到 uninitialized,
  //     后续 ensureLoaded() 由 UI / RecorderWorkspace 在用户交互时触发。
  useEffect(() => {
    bootstrapOfflineAsr();
    let cancelled = false;
    void (async () => {
      const result = await tryRegisterNativeOfflineAsr();
      if (cancelled) return;
      if (result.registered) {
        // eslint-disable-next-line no-console
        console.info(
          "[App] native offline ASR registered:",
          result.engineId,
          result.engineLabel,
        );
        return;
      }
      // 注册失败:不再自动回退到 mac-segment-fallback(那是 R17 前的旧行为,
      // 会让 UI 误以为「本地 ASR 已就绪」实际上却在用远端 polling 兜底)。
      // 失败原因会写到 offlineAsr state.lastError,UI 据此渲染红色横幅。
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.info(
          "[App] native offline ASR registration FAILED — UI will show 引擎未就绪:",
          result.reason,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.shell}>
      <StatusBar barStyle="dark-content" backgroundColor={Color.surfaceSubtle} />
      <Animated.View style={[styles.content, { opacity: fade }]}>
        <View
          style={[styles.scene, tab !== 'record' && styles.sceneHidden]}
          pointerEvents={tab === 'record' ? 'auto' : 'none'}
        >
          <TodayConsoleScreen
            key={`record-${sessionKey}`}
            onOpenKnowledge={() => onChangeTab('knowledge')}
            onOpenCalendar={onOpenCalendar}
            onPairingStateChange={onPairingStateChange}
            onRePair={onRePair}
            onOpenCapture={onOpenCapture}
          />
        </View>
        {tab === 'knowledge' ? (
          <KnowledgeScreen
            key={`knowledge-${sessionKey}`}
            onOpenEditor={onOpenEditor}
            onRePair={onRePair}
            onOpenCapture={onOpenCapture}
          />
        ) : null}
        {tab === 'calendar' ? <CalendarScreen onOpenEditor={onOpenEditor} focus={calendarFocus} /> : null}
        {tab === 'device' ? <DeviceScreen /> : null}
      </Animated.View>
      {hideTabBar ? null : (
        <SafeAreaView
          edges={['bottom']}
          style={[styles.tabBarWrap, { paddingBottom: Math.max(insets.bottom, Space.sm) }]}
          testID="mobile-bottom-tab-bar"
        >
          <View style={styles.tabBar}>
            {tabs.map((t) => (
              <TabButton
                key={t.key}
                active={tab === t.key}
                label={t.label}
                marker={t.marker}
                testID={t.testID}
                onPress={() => {
                  if (t.key !== tab) {
                    Haptics.tick();
                    onChangeTab(t.key);
                  }
                }}
              />
            ))}
          </View>
      </SafeAreaView>
      )}
      {shellWorkspaceActive ? (
        <View style={styles.shellWorkspaceOverlay} testID="mobile-shell-recorder-workspace">
          <RecorderWorkspace onCloseRequest={() => onChangeTab('record')} />
        </View>
      ) : null}
      {/* 2026-07-02 — R5C minimized 浮动条:跨 tab 仍可见,带 timer/status/restore/stop */}
      {floatingActive ? <ContextRecorderFloatingBar onRestore={() => onChangeTab('record')} /> : null}
    </View>
  );
}

// 浮动条:从 context 拿 timer / paused,跨 tab 可见。
function ContextRecorderFloatingBar({ onRestore }: { onRestore?: () => void }) {
  const { state, actions } = useRecorder();
  const insets = useSafeAreaInsets();
  const s = Math.max(0, state.seconds);
  const minutes = Math.floor(s / 60);
  const ss = s % 60;
  const fmt = `${minutes.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
  const statusLabel =
    state.mode === 'recording' ? (state.paused ? '已暂停' : '录音中')
      : state.mode === 'transcribing' ? '后台转写中'
      : state.mode === 'preview' ? '待确认入库'
      : state.mode === 'saving' ? '正在入库'
      : state.mode === 'saved' ? '已入库'
      : '录音';
  return (
    <View
      style={[styles.contextBarWrap, { paddingBottom: Math.max(insets.bottom, 4) + 64 }]}
      pointerEvents="box-none"
      testID="mobile-recorder-floating-bar"
    >
      <View style={styles.contextBar}>
        <View style={styles.contextBarLeft}>
          <View style={[styles.contextBarDot, (state.paused || state.mode === 'transcribing') && styles.contextBarDotIdle]} />
          <Text style={styles.contextBarTime}>{fmt}</Text>
          <Text style={styles.contextBarHint}>{statusLabel} · 跨 tab 可见</Text>
        </View>
        <View style={styles.contextBarActions}>
          <Pressable
            onPress={() => { Haptics.warn(); actions.close(); }}
            hitSlop={8}
            testID="mobile-recorder-floating-cancel"
            accessibilityLabel="取消录音"
            style={({ pressed }) => [styles.contextBarGhost, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.contextBarGhostText}>取消</Text>
          </Pressable>
          <Pressable
            onPress={() => { Haptics.tick(); onRestore?.(); actions.restore(); }}
            hitSlop={8}
            testID="mobile-recorder-floating-restore"
            accessibilityLabel="展开语音工作台"
            style={({ pressed }) => [styles.contextBarStop, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.contextBarStopText}>展开</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function RecorderFloatingBar({
  seconds,
  paused,
  onStop,
  onCancel,
}: {
  seconds: number;
  paused: boolean;
  onStop: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  };
  return (
    <View
      style={[styles.recorderBarWrap, { paddingBottom: Math.max(insets.bottom, 4) + 64 }]}
      pointerEvents="box-none"
      testID="mobile-recorder-floating-bar"
    >
      <View style={styles.recorderBar}>
        <View style={styles.recorderBarLeft}>
          <View style={[styles.recorderBarDot, paused && styles.recorderBarDotPaused]} />
          <Text style={styles.recorderBarTime}>{fmt(seconds)}</Text>
          <Text style={styles.recorderBarHint}>{paused ? "已暂停" : "录音中 · 跨 tab 可见"}</Text>
        </View>
        <View style={styles.recorderBarActions}>
          <Pressable
            onPress={onCancel}
            hitSlop={8}
            style={({ pressed }) => [styles.recorderBarBtnGhost, pressed && { opacity: 0.7 }]}
            testID="mobile-recorder-floating-cancel"
            accessibilityLabel="取消录音"
          >
            <Text style={styles.recorderBarBtnGhostText}>取消</Text>
          </Pressable>
          <Pressable
            onPress={onStop}
            hitSlop={8}
            style={({ pressed }) => [styles.recorderBarBtnStop, pressed && { opacity: 0.85 }]}
            testID="mobile-recorder-floating-stop"
            accessibilityLabel="停止录音"
          >
            <Text style={styles.recorderBarBtnStopText}>停止</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function TabButton({
  active,
  label,
  marker,
  testID,
  onPress,
}: {
  active: boolean;
  label: string;
  marker: string;
  testID?: string;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`主导航 ${label}`}
      accessibilityHint={`切换到${label}页面`}
      testID={testID}
      onPress={onPress}
      onPressIn={() => {
        Animated.timing(scale, {
          toValue: 0.94,
          duration: Motion.duration.fast,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      }}
      onPressOut={() => {
        Animated.timing(scale, {
          toValue: 1,
          duration: Motion.duration.fast,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      }}
      style={({ pressed }) => [styles.tabButton, pressed && styles.tabButtonPressed]}
    >
      <Animated.View style={[styles.tabInner, active && styles.tabInnerActive, { transform: [{ scale }] }]}>
        <Text style={[styles.tabMarker, active && styles.tabMarkerActive]}>{marker}</Text>
        <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: Color.surface },
  content: { flex: 1 },
  scene: { flex: 1 },
  sceneHidden: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0,
  },
  tabBarWrap: {
    backgroundColor: Color.surface,
    borderTopWidth: 1,
    borderTopColor: Color.border,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: Space.sm,
    paddingTop: Space.xs,
  },
  tabButton: {
    flex: 1,
    paddingVertical: Space.xs,
  },
  tabButtonPressed: {
    opacity: 0.7,
  },
  tabInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.xs,
    borderRadius: Radius.md,
    gap: 2,
  },
  tabInnerActive: {
    backgroundColor: Color.primarySofter,
  },
  tabMarker: {
    ...Type.microBold,
    color: Color.inkFaint,
    lineHeight: 14,
  },
  tabMarkerActive: {
    color: Color.primary,
  },
  tabText: {
    ...Type.captionBold,
    color: Color.inkFaint,
    lineHeight: 16,
  },
  tabTextActive: {
    color: Color.primary,
  },
  recorderBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
  },
  recorderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Color.dangerInk,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  recorderBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  recorderBarDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  recorderBarDotPaused: { backgroundColor: '#fbbf24' },
  recorderBarTime: { color: '#fff', fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  recorderBarHint: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginLeft: 4 },
  recorderBarActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recorderBarBtnGhost: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  recorderBarBtnGhostText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
  recorderBarBtnStop: { backgroundColor: '#fff', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6 },
  recorderBarBtnStopText: { color: Color.dangerInk, fontSize: 12, fontWeight: '900' },

  // R5C context-driven 浮动条(跨 tab 可见)
  contextBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
  },
  contextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Color.dangerInk,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  contextBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  contextBarDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  contextBarDotIdle: { backgroundColor: '#fbbf24' },
  contextBarTime: { color: '#fff', fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  contextBarHint: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginLeft: 4 },
  contextBarActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contextBarGhost: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  contextBarGhostText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
  contextBarStop: { backgroundColor: '#fff', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6 },
  contextBarStopText: { color: Color.dangerInk, fontSize: 12, fontWeight: '900' },
  shellWorkspaceOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Color.surface || '#f5f7f9',
    zIndex: 30,
    elevation: 12,
  },
});

void Platform;
