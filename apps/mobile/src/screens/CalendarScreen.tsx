import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Color, Radius, Shadow, Size, Space, Type } from '@/constants/design';
import { Haptics } from '@/lib/haptics';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  fetchCalendarByDate,
  fetchCalendarRange,
  fetchToday,
  humanizeMobileError,
  updateCalendarEvent,
} from '@/lib/api';
import { loadMobileSession } from '@/lib/storage';
import type {
  Approval,
  MobileCalendarEvent,
  MobileCalendarKind,
  MobileCalendarStatus,
  MobileSession,
  MobileTodayAgendaItem,
} from '@/lib/types';

type EditorMode = 'create' | 'edit';
type CalendarViewMode = 'day' | 'week';
type CalendarKindFilter = MobileCalendarKind | 'all';
type CalendarFocus = { kind?: CalendarKindFilter; nonce: number };

type EditorState = {
  mode: EditorMode;
  draft: DraftEvent;
};

type DraftEvent = {
  id: string | null;
  date: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  kind: MobileCalendarKind;
  status: MobileCalendarStatus;
  // Phase6: opt-in calendar quick-note (autoOrganize + rawContent) fields.
  // Default behavior unchanged: when rawContent is empty or autoOrganize is false,
  // the server keeps the legacy { ok: true, event } response shape.
  rawContent?: string;
  autoOrganize?: boolean;
  tags?: string[];
  related?: string[];
};

const KIND_LABELS: Record<MobileCalendarKind, string> = {
  event: '事件',
  reminder: '提醒',
  task: '任务',
};

const STATUS_LABELS: Record<MobileCalendarStatus, string> = {
  active: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

const STATUS_TONE: Record<MobileCalendarStatus, { bg: string; ink: string; border: string }> = {
  active: { bg: Color.infoSoft, ink: Color.infoInk, border: Color.infoBorder },
  completed: { bg: Color.okSoft, ink: Color.okInk, border: Color.okBorder },
  cancelled: { bg: Color.dangerSoft, ink: Color.dangerInk, border: Color.dangerBorder },
};

const KIND_TONE: Record<MobileCalendarKind, { bg: string; ink: string; border: string }> = {
  event: { bg: Color.primarySofter, ink: Color.primary, border: Color.primarySoft },
  reminder: { bg: Color.warnSoft, ink: Color.warnInk, border: Color.warnBorder },
  task: { bg: Color.infoSoft, ink: Color.infoInk, border: Color.infoBorder },
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 底部 Tab Bar 的视觉高度 + 间隔：让新建日程 FAB 浮在 Tab Bar 上方
// (PM 06-22 复测：iPhone 800 高屏底部 Tap y=802 时 FAB hit-region 完全落在 Tab Bar 之后)
const TAB_BAR_LIFT = 60;

function todayLocalKey(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function shiftDate(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function startOfWeek(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() - day);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatDateDisplay(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}

function formatWeekday(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return weekdays[utc.getUTCDay()] || '';
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (!start && !end) return '全天';
  if (start && end) return `${start} – ${end}`;
  if (start) return `${start} 开始`;
  if (end) return `至 ${end}`;
  return '全天';
}

function isCompletedStatus(status: MobileCalendarStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

function isTodayTodoEvent(event: MobileCalendarEvent): boolean {
  return event.id.startsWith('mobile-today-todo:') || event.id.startsWith('mobile-today-approval:');
}

function datePart(value: unknown): string {
  return String(value || '').slice(0, 10);
}

function agendaItemBelongsToDate(item: MobileTodayAgendaItem, dateKey: string): boolean {
  const dueDate = datePart(item.due_at);
  const startDate = datePart(item.start_at);
  if (dueDate) return dueDate === dateKey;
  if (startDate) return startDate === dateKey;
  return false;
}

function approvalBelongsToDate(approval: Approval, dateKey: string): boolean {
  return datePart(approval.requested_at) === dateKey;
}

function todoToCalendarEvent(todo: MobileTodayAgendaItem, dateKey: string): MobileCalendarEvent {
  const date = datePart(todo.due_at) || datePart(todo.start_at) || dateKey;
  const status = String(todo.status || '').toLowerCase();
  const done = status === 'done' || status === 'complete' || status === 'completed' || status === 'closed';
  return {
    id: `mobile-today-todo:${todo.id}`,
    date,
    startTime: null,
    endTime: null,
    title: todo.title || '未命名待办',
    description: `${todo.priority ? `优先级: ${todo.priority}` : '桌面执行台待办'} · 来源: ${todo.source || 'today'}`,
    status: done ? 'completed' : 'active',
    kind: 'task',
    source: `today:${todo.source || 'todo'}`,
    knowledgePath: null,
    knowledgeHtmlPath: null,
    createdAt: todo.start_at || todo.updated_at || new Date().toISOString(),
    updatedAt: todo.updated_at || todo.due_at || new Date().toISOString(),
  };
}

function approvalToCalendarEvent(approval: Approval, dateKey: string): MobileCalendarEvent {
  const title = mobileNonEmptyText(approval.details, 80) || mobileNonEmptyText(approval.action, 80) || '待审批动作';
  return {
    id: `mobile-today-approval:${approval.id}`,
    date: (approval.requested_at || dateKey).slice(0, 10) || dateKey,
    startTime: null,
    endTime: null,
    title: `审批: ${title}`,
    description: `${approval.task_id ? `任务: ${approval.task_id}` : '桌面执行台审批'} · 状态: ${approval.status || 'pending'}`,
    status: 'active',
    kind: 'task',
    source: 'today:approval',
    knowledgePath: null,
    knowledgeHtmlPath: null,
    createdAt: approval.requested_at || new Date().toISOString(),
    updatedAt: approval.requested_at || new Date().toISOString(),
  };
}

function mobileNonEmptyText(value: unknown, max: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function mergeCalendarEventsWithTodos(events: MobileCalendarEvent[], todos: MobileCalendarEvent[]): MobileCalendarEvent[] {
  const seen = new Set(events.map((event) => `${event.kind}:${event.title}:${event.date}`.toLowerCase()));
  const merged = [...events];
  for (const todo of todos) {
    const key = `${todo.kind}:${todo.title}:${todo.date}`.toLowerCase();
    if (!seen.has(key)) merged.push(todo);
  }
  return merged;
}

function makeBlankDraft(dateKey: string): DraftEvent {
  return {
    id: null,
    date: dateKey,
    title: '',
    description: '',
    startTime: '',
    endTime: '',
    kind: 'event',
    status: 'active',
  };
}

function draftFromEvent(event: MobileCalendarEvent): DraftEvent {
  return {
    id: event.id,
    date: event.date,
    title: event.title,
    description: event.description || '',
    startTime: event.startTime || '',
    endTime: event.endTime || '',
    kind: event.kind,
    status: event.status,
  };
}

function validateDraftTime(start: string, end: string): string | null {
  if (!start && !end) return null;
  if (!start || !end) return '开始和结束时间需同时填写';
  if (start > end) return '结束时间必须晚于开始时间';
  return null;
}

export default function CalendarScreen({
  onOpenEditor,
  focus,
}: {
  onOpenEditor?: (params: { path: string; mode: "edit" | "create" | "preview"; kind?: "markdown" | "html" }) => void;
  focus?: CalendarFocus;
} = {}) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<MobileSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [dateKey, setDateKey] = useState<string>(() => todayLocalKey());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('day');
  const [editor, setEditor] = useState<EditorState | null>(null);
  // 2026-06-25 — 日程页 kind 过滤:全部 / 事件 / 待办 / 提醒
  const [kindFilter, setKindFilter] = useState<CalendarKindFilter>('all');
  const [deleteTarget, setDeleteTarget] = useState<MobileCalendarEvent | null>(null);
  const [actionError, setActionError] = useState<string>('');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let active = true;
    loadMobileSession()
      .then((stored) => active && setSession(stored))
      .finally(() => active && setLoadingSession(false));
    return () => {
      active = false;
    };
  }, []);

  const today = useMemo(() => todayLocalKey(), []);

  useEffect(() => {
    if (!focus?.nonce) return;
    setDateKey(today);
    setViewMode('day');
    setKindFilter(focus.kind || 'all');
    setActionError('');
  }, [focus?.nonce, focus?.kind, today]);

  const isToday = dateKey === today;
  const weekStart = useMemo(() => startOfWeek(dateKey), [dateKey]);
  const weekEnd = useMemo(() => shiftDate(weekStart, 6), [weekStart]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_item, index) => shiftDate(weekStart, index)), [weekStart]);

  const eventsQuery = useQuery({
    queryKey: ['mobile-calendar', session?.serverUrl, session?.device.id, dateKey],
    enabled: Boolean(session),
    queryFn: () => fetchCalendarByDate(session as MobileSession, dateKey, setSession),
  });

  const weekQuery = useQuery({
    queryKey: ['mobile-calendar-week', session?.serverUrl, session?.device.id, weekStart, weekEnd],
    enabled: Boolean(session),
    queryFn: () => fetchCalendarRange(session as MobileSession, { start: weekStart, end: weekEnd }, setSession),
  });

  const todayQuery = useQuery({
    queryKey: ['mobile-calendar-today-agenda', session?.serverUrl, session?.device.id, dateKey],
    enabled: Boolean(session),
    queryFn: () => fetchToday(session as MobileSession, dateKey, setSession),
  });

  const events = eventsQuery.data?.events || [];
  const weekEvents = weekQuery.data?.events || [];
  const todayTodoEvents = useMemo(
    () => (todayQuery.data?.todos || [])
      .filter((todo) => agendaItemBelongsToDate(todo, dateKey))
      .map((todo) => todoToCalendarEvent(todo, dateKey)),
    [todayQuery.data?.todos, dateKey],
  );
  const todayApprovalEvents = useMemo(
    () => (todayQuery.data?.approvals || [])
      .filter((approval) => approvalBelongsToDate(approval, dateKey))
      .map((approval) => approvalToCalendarEvent(approval, dateKey)),
    [todayQuery.data?.approvals, dateKey],
  );
  const todayTaskEvents = useMemo(
    () => [...todayTodoEvents, ...todayApprovalEvents],
    [todayTodoEvents, todayApprovalEvents],
  );
  const dayEvents = useMemo(
    () => mergeCalendarEventsWithTodos(events, todayTaskEvents),
    [events, todayTaskEvents],
  );
  const baseVisibleEvents = viewMode === 'week' ? weekEvents : dayEvents;
  const visibleEvents = useMemo(
    () => (kindFilter === 'all' ? baseVisibleEvents : baseVisibleEvents.filter((event) => event.kind === kindFilter)),
    [baseVisibleEvents, kindFilter],
  );
  const activeLoading = viewMode === 'week' ? weekQuery.isLoading : (eventsQuery.isLoading || todayQuery.isLoading);
  const activeError = viewMode === 'week' ? weekQuery.error : (eventsQuery.error || todayQuery.error);

  const goPrevDay = useCallback(() => {
    Haptics.tick();
    setDateKey((current) => shiftDate(current, -1));
    setActionError('');
  }, []);

  const goNextDay = useCallback(() => {
    Haptics.tick();
    setDateKey((current) => shiftDate(current, 1));
    setActionError('');
  }, []);

  const goToday = useCallback(() => {
    Haptics.tick();
    setDateKey(today);
    setActionError('');
  }, [today]);

  const openEventEditor = useCallback((kind: MobileCalendarKind = "event") => {
    Haptics.tick();
    setEditor({ mode: 'create', draft: { ...makeBlankDraft(dateKey), kind } });
  }, [dateKey]);

  const openCreate = useCallback(() => {
    Haptics.tick();
    setEditor({ mode: 'create', draft: makeBlankDraft(dateKey) });
  }, [dateKey]);

  const openEdit = useCallback((event: MobileCalendarEvent) => {
    Haptics.tick();
    setEditor({ mode: 'edit', draft: draftFromEvent(event) });
  }, []);

  const closeEditor = useCallback(() => {
    setEditor(null);
  }, []);

  const closeDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const createMutation = useMutation({
    mutationFn: async (draft: DraftEvent) => {
      if (!session) throw new Error(humanizeMobileError('not_paired'));
      const payload: Record<string, unknown> = {
        date: draft.date,
        title: draft.title.trim(),
        description: draft.description.trim(),
        startTime: draft.startTime || null,
        endTime: draft.endTime || null,
        kind: draft.kind,
      };
      // Phase6: only forward quick-note fields when the user explicitly opts in.
      // Default behavior stays unchanged when rawContent is empty / autoOrganize is false.
      if (draft.rawContent && draft.rawContent.trim()) {
        payload.rawContent = draft.rawContent.trim();
        payload.autoOrganize = draft.autoOrganize === true;
      }
      if (Array.isArray(draft.tags) && draft.tags.length) payload.tags = draft.tags;
      if (Array.isArray(draft.related) && draft.related.length) payload.related = draft.related;
      return createCalendarEvent(session, payload as Parameters<typeof createCalendarEvent>[1], setSession);
    },
    onSuccess: (data) => {
      Haptics.success();
      setEditor(null);
      setActionError('');
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar-week'] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar-today-agenda'] });
      const job = (data as { organizeJob?: { id?: string } }).organizeJob;
      if (job && job.id) {
        void queryClient.invalidateQueries({ queryKey: ['mobile-calendar'] });
        void queryClient.invalidateQueries({ queryKey: ['knowledge-organize-jobs'] });
      }
      void data;
    },
    onError: (err) => {
      Haptics.error();
      setActionError(humanizeMobileError(err instanceof Error ? err.message : String(err)));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (draft: DraftEvent) => {
      if (!session) throw new Error(humanizeMobileError('not_paired'));
      if (!draft.id) throw new Error(humanizeMobileError('missing_id'));
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        startTime: draft.startTime || null,
        endTime: draft.endTime || null,
        status: draft.status,
      };
      return updateCalendarEvent(session, draft.id, payload, setSession);
    },
    onSuccess: (data) => {
      Haptics.success();
      setEditor(null);
      setActionError('');
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar-week'] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar-today-agenda'] });
      void data;
    },
    onError: (err) => {
      Haptics.error();
      setActionError(humanizeMobileError(err instanceof Error ? err.message : String(err)));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (eventId: string) => {
      if (!session) throw new Error(humanizeMobileError('not_paired'));
      return deleteCalendarEvent(session, eventId, setSession);
    },
    onSuccess: () => {
      Haptics.success();
      setDeleteTarget(null);
      setActionError('');
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar-week'] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar-today-agenda'] });
    },
    onError: (err) => {
      Haptics.error();
      setActionError(humanizeMobileError(err instanceof Error ? err.message : String(err)));
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (event: MobileCalendarEvent) => {
      if (!session) throw new Error(humanizeMobileError('not_paired'));
      const nextStatus: MobileCalendarStatus = event.status === 'completed' ? 'active' : 'completed';
      return updateCalendarEvent(
        session,
        event.id,
        { status: nextStatus },
        setSession,
      );
    },
    onSuccess: () => {
      Haptics.tick();
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar-week'] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-calendar-today-agenda'] });
    },
    onError: (err) => {
      Haptics.error();
      setActionError(humanizeMobileError(err instanceof Error ? err.message : String(err)));
    },
  });

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
            icon="历"
            title="尚未配对"
            description="回到记录页完成 6 位配对码登录,即可浏览与管理日程。"
            tone="muted"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={eventsQuery.isFetching || weekQuery.isFetching || todayQuery.isFetching}
            onRefresh={() => {
              void eventsQuery.refetch();
              void weekQuery.refetch();
              void todayQuery.refetch();
            }}
          />
        }
      >
        <View style={styles.header}>
          <Text style={[Type.microBold, { color: Color.primary, letterSpacing: 0.5 }]}>今日日程</Text>
          <Text style={[Type.displaySm, { color: Color.ink, marginTop: 2 }]}>今天做什么</Text>
          <Text style={[Type.body, { color: Color.inkFaint, marginTop: 4 }]}>
            {isToday ? "默认显示今天的日程与待办；可切到周视图查看整周。" : "已跳到其他日期；点击「回到今天」返回。"}
          </Text>
        </View>

        <View style={styles.segmented}>
          {(['day', 'week'] as CalendarViewMode[]).map((mode) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityState={{ selected: viewMode === mode }}
              onPress={() => {
                Haptics.tick();
                setViewMode(mode);
              }}
              style={[styles.viewSegment, viewMode === mode && styles.viewSegmentActive]}
            >
              <Text style={[Type.captionBold, { color: viewMode === mode ? Color.primary : Color.inkFaint }]}>
                {mode === 'day' ? '日视图' : '周视图'}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.dateCard}>
          <View style={styles.dateHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="前一天"
              onPress={goPrevDay}
              style={({ pressed }) => [styles.dayNav, pressed && styles.dayNavPressed]}
            >
              <Text style={[Type.captionBold, { color: Color.primary }]}>← 前一天</Text>
            </Pressable>
            <View style={styles.dateCenter}>
              <Text style={[Type.h2, { color: Color.ink }]}>{formatDateDisplay(dateKey)}</Text>
              <Text style={[Type.caption, { color: Color.inkFaint, marginTop: 2 }]}>
                {formatWeekday(dateKey)}
                {isToday ? ' · 今天' : ''}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="后一天"
              onPress={goNextDay}
              style={({ pressed }) => [styles.dayNav, pressed && styles.dayNavPressed]}
            >
              <Text style={[Type.captionBold, { color: Color.primary }]}>后一天 →</Text>
            </Pressable>
          </View>
          <View style={styles.dateFooter}>
            <Text style={[Type.caption, { color: Color.inkFaint, flex: 1 }]}>
              {viewMode === 'week'
                ? `${weekStart} 至 ${weekEnd}`
                : kindFilter === 'task'
                  ? `共 ${visibleEvents.length} 条待办 · 桌面待办 ${todayTaskEvents.length}`
                  : `共 ${dayEvents.length} 项 · 待办 ${todayTaskEvents.length}`}
            </Text>
            {!isToday ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="回到今天"
                onPress={goToday}
                style={({ pressed }) => [styles.todayPill, pressed && styles.todayPillPressed]}
              >
                <Text style={[Type.captionBold, { color: Color.onPrimary }]}>回到今天</Text>
              </Pressable>
            ) : (
              <View style={styles.todayPillActive}>
                <Text style={[Type.captionBold, { color: Color.primary }]}>今天</Text>
              </View>
            )}
          </View>
        </View>

        <WeekStrip days={weekDays} selected={dateKey} events={weekEvents} onSelect={(next) => {
          Haptics.tick();
          setDateKey(next);
          setActionError('');
        }} />

        {/* 2026-06-25 — kind 过滤 tab:全部 / 事件 / 待办 / 提醒 */}
        <View style={styles.kindFilterRow} testID="calendar-kind-filter">
          {([
            { key: "all", label: "全部" },
            { key: "event", label: "事件" },
            { key: "task", label: "待办" },
            { key: "reminder", label: "提醒" },
          ] as const).map((item) => (
            <Pressable
              key={item.key}
              accessibilityLabel={item.label}
              onPress={() => { Haptics.tick(); setKindFilter(item.key as CalendarKindFilter); }}
              style={({ pressed }) => [
                styles.kindFilterChip,
                kindFilter === item.key && styles.kindFilterChipActive,
                pressed && { opacity: 0.7 },
              ]}
              testID={`calendar-kind-${item.key}`}
            >
              <Text style={[styles.kindFilterLabel, kindFilter === item.key && styles.kindFilterLabelActive]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <CalendarStats events={visibleEvents} mode={viewMode} />

        {actionError ? (
          <View style={styles.errorBanner}>
            <Text style={[Type.captionBold, { color: Color.dangerInk }]}>{actionError}</Text>
          </View>
        ) : null}

        {activeLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Color.primary} />
            <Text style={[Type.body, { color: Color.inkFaint, marginTop: Space.sm }]}>正在读取日程…</Text>
          </View>
        ) : activeError ? (
          <View style={styles.errorPanel}>
            <Text style={[Type.h3, { color: Color.dangerInk }]}>无法读取日程</Text>
            <Text style={[Type.bodySm, { color: Color.dangerInk, marginTop: Space.xs }]}>
              {humanizeMobileError(activeError instanceof Error ? activeError.message : String(activeError))}
            </Text>
            <View style={{ marginTop: Space.md, alignSelf: 'flex-start' }}>
              <Button label="重试" tone="secondary" size="sm" onPress={() => viewMode === 'week' ? weekQuery.refetch() : eventsQuery.refetch()} />
            </View>
          </View>
        ) : visibleEvents.length === 0 ? (
          <View style={styles.emptyPanel} testID="mobile-calendar-empty">
            <EmptyState
              icon="历"
              title={viewMode === 'week' ? '本周还没有日程' : kindFilter === 'task' ? '今日还没有待办' : '今日还没有日程'}
              description={kindFilter === 'task' ? '已读取桌面执行台待办源,当前日期没有待办。下拉刷新或回到记录页确认同步状态。' : '桌面端 calendar / tasks / reminders 三个源都为空。点击右下角 + 新建,或前后切日试试。'}
              tone="muted"
            />
            <View style={{ marginTop: Space.md, flexDirection: 'row', gap: Space.sm }}>
              <Button label="刷新" tone="primary" size="sm" onPress={() => { void eventsQuery.refetch(); void weekQuery.refetch(); void todayQuery.refetch(); }} />
              <Button label="新建日程" tone="secondary" size="sm" onPress={openCreate} />
            </View>
          </View>
        ) : (
          <View style={styles.listCard}>
            {visibleEvents.map((event, index) => {
              const readOnlyTodo = isTodayTodoEvent(event);
              const readOnlyMessage = "该待办来自桌面执行台,手机端当前只读展示;请在桌面智能助理处理。";
              return (
                <EventRow
                  key={event.id}
                  event={event}
                  showTopBorder={index > 0}
                  readOnly={readOnlyTodo}
                  onPress={() => readOnlyTodo ? setActionError(readOnlyMessage) : openEdit(event)}
                  onToggleStatus={() => readOnlyTodo ? setActionError(readOnlyMessage) : toggleStatusMutation.mutate(event)}
                  onLongPress={() => readOnlyTodo ? setActionError(readOnlyMessage) : setDeleteTarget(event)}
                  onOpenNote={(p) => {
                    if (p && onOpenEditor) {
                      Haptics.tick();
                      onOpenEditor({ path: p, mode: "preview", kind: p.toLowerCase().endsWith(".md") || p.toLowerCase().endsWith(".markdown") ? "markdown" : "html" });
                    }
                  }}
                  busy={toggleStatusMutation.isPending}
                />
              );
            })}
            <Text style={[Type.micro, { color: Color.inkFaint, textAlign: 'center', paddingVertical: Space.md }]}>
              日程可长按删除 / 点击编辑;桌面待办只读展示,避免手机端假写入。
            </Text>
          </View>
        )}
      </ScrollView>
        <Pressable
          accessibilityLabel="新建日程/待办/提醒"
          onPress={() => { Haptics.tick(); openEventEditor("event"); }}
          style={({ pressed }) => [styles.calendarFab, pressed && { opacity: 0.7 }]}
          testID="calendar-fab-new"
        >
          <Text style={styles.calendarFabGlyph}>+</Text>
        </Pressable>


      {editor ? (
        <EventEditor
          state={editor}
          onChange={(draft) => setEditor({ mode: editor.mode, draft })}
          onClose={closeEditor}
          onSave={(draft) => {
            setActionError('');
            if (!draft.title.trim()) {
              setActionError(humanizeMobileError('title_required'));
              return;
            }
            const timeError = validateDraftTime(draft.startTime, draft.endTime);
            if (timeError) {
              setActionError(timeError);
              return;
            }
            if (editor.mode === 'create') createMutation.mutate(draft);
            else updateMutation.mutate(draft);
          }}
          busy={createMutation.isPending || updateMutation.isPending}
          error={actionError}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteConfirm
          event={deleteTarget}
          busy={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onCancel={closeDelete}
        />
      ) : null}
    </SafeAreaView>
  );
}

/* ---------- 子组件 ---------- */

function WeekStrip({
  days,
  selected,
  events,
  onSelect,
}: {
  days: string[];
  selected: string;
  events: MobileCalendarEvent[];
  onSelect: (dateKey: string) => void;
}) {
  return (
    <View style={styles.weekStrip}>
      {days.map((day) => {
        const selectedDay = day === selected;
        const count = events.filter((event) => event.date === day).length;
        return (
          <Pressable
            key={day}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedDay }}
            onPress={() => onSelect(day)}
            style={[styles.weekDay, selectedDay && styles.weekDayActive]}
          >
            <Text style={[Type.microBold, { color: selectedDay ? Color.primary : Color.inkFaint }]}>
              {formatWeekday(day).replace('周', '')}
            </Text>
            <Text style={[Type.h3, { color: selectedDay ? Color.primary : Color.ink }]}>
              {Number(day.slice(-2))}
            </Text>
            <Text style={[Type.micro, { color: count ? Color.primary : Color.inkDisabled }]}>
              {count ? `${count}项` : '空'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CalendarStats({ events, mode }: { events: MobileCalendarEvent[]; mode: CalendarViewMode }) {
  const active = events.filter((event) => event.status === 'active').length;
  const tasks = events.filter((event) => event.kind === 'task').length;
  const reminders = events.filter((event) => event.kind === 'reminder').length;
  return (
    <View style={styles.statsGrid}>
      <StatCell label={mode === 'week' ? '本周' : '当天'} value={events.length} />
      <StatCell label="未完成" value={active} />
      <StatCell label="待办" value={tasks} />
      <StatCell label="提醒" value={reminders} />
    </View>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statCell}>
      <Text style={[Type.h2, { color: Color.ink }]}>{value}</Text>
      <Text style={[Type.microBold, { color: Color.inkFaint }]}>{label}</Text>
    </View>
  );
}

function EventRow({
  event,
  showTopBorder,
  readOnly,
  onPress,
  onToggleStatus,
  onLongPress,
  onOpenNote,
  busy,
}: {
  event: MobileCalendarEvent;
  showTopBorder: boolean;
  readOnly?: boolean;
  onPress: () => void;
  onToggleStatus: () => void;
  onLongPress: () => void;
  onOpenNote?: (path: string) => void;
  busy: boolean;
}) {
  const completed = isCompletedStatus(event.status);
  const statusTone = STATUS_TONE[event.status];
  const kindTone = KIND_TONE[event.kind];
  const press = useState(new Animated.Value(1))[0];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.title} ${formatTimeRange(event.startTime, event.endTime)}`}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      onPressIn={() => {
        Animated.timing(press, {
          toValue: 0.98,
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
          styles.eventRow,
          showTopBorder && styles.eventRowTopBorder,
          { transform: [{ scale: press }] },
        ]}
      >
        <View style={styles.eventTimeCol}>
          <Text
            style={[
              Type.mono,
              { color: completed ? Color.inkDisabled : Color.ink },
            ]}
          >
            {event.startTime || '全天'}
          </Text>
          {event.endTime ? (
            <Text style={[Type.caption, { color: Color.inkFaint, marginTop: 2 }]}>至 {event.endTime}</Text>
          ) : null}
        </View>
        <View style={styles.eventMain}>
          <Text
            style={[
              Type.h3,
              {
                color: completed ? Color.inkDisabled : Color.ink,
                textDecorationLine: completed ? 'line-through' : 'none',
              },
            ]}
            numberOfLines={2}
          >
            {event.title}
          </Text>
          {event.description ? (
            <Text
              style={[
                Type.caption,
                { color: completed ? Color.inkDisabled : Color.inkMuted, marginTop: 2 },
              ]}
              numberOfLines={2}
            >
              {event.description}
            </Text>
          ) : null}
          <View style={styles.eventTagRow}>
            <View style={[styles.tagPill, { backgroundColor: kindTone.bg, borderColor: kindTone.border }]}>
              <Text style={[Type.microBold, { color: kindTone.ink }]}>{KIND_LABELS[event.kind]}</Text>
            </View>
            <Pressable
              accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
              accessibilityLabel={readOnly ? "桌面待办只读" : `切换状态:当前 ${STATUS_LABELS[event.status]}`}
              onPress={onToggleStatus}
              disabled={busy}
              style={({ pressed }) => [
                styles.tagPill,
                {
                  backgroundColor: statusTone.bg,
                  borderColor: statusTone.border,
                  opacity: busy ? 0.5 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[Type.microBold, { color: statusTone.ink }]}>{STATUS_LABELS[event.status]}</Text>
            </Pressable>
            {readOnly ? (
              <View style={[styles.tagPill, { backgroundColor: Color.surfaceSubtle, borderColor: Color.borderSoft }]}>
                <Text style={[Type.microBold, { color: Color.inkFaint }]}>桌面待办</Text>
              </View>
            ) : null}
            {(event.knowledgePath || event.knowledgeHtmlPath) && onOpenNote ? (
              <Pressable
                accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
                accessibilityLabel="打开关联笔记"
                onPress={(e) => {
                  e.stopPropagation?.();
                  const p = event.knowledgeHtmlPath || event.knowledgePath;
                  if (p) onOpenNote(p);
                }}
                hitSlop={8}
                style={({ pressed }) => [styles.openNoteBtn, pressed && { opacity: 0.7 }]}
                testID={`calendar-open-note-${event.id}`}
              >
                <Text style={styles.openNoteBtnText}>📄 打开笔记</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

function EventEditor({
  state,
  onChange,
  onClose,
  onSave,
  busy,
  error,
}: {
  state: EditorState;
  onChange: (next: DraftEvent) => void;
  onClose: () => void;
  onSave: (draft: DraftEvent) => void;
  busy: boolean;
  error: string;
}) {
  const { draft, mode } = state;

  const updateField = <K extends keyof DraftEvent>(key: K, value: DraftEvent[K]) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalScrim}
      >
        <View style={styles.editorCard}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: Space.lg }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[Type.h2, { color: Color.ink }]}>
              {mode === 'create' ? '新建日程' : '编辑日程'}
            </Text>
            <Text style={[Type.bodySm, { color: Color.inkMuted, marginTop: Space.xs, lineHeight: 20 }]}>
              所有字段必填或可留空。开始/结束时间需同时填写,且结束必须晚于开始。
            </Text>

            <Text style={[styles.fieldLabel, { marginTop: Space.lg }]}>日期 (YYYY-MM-DD)</Text>
            <TextInput
              value={draft.date}
              onChangeText={(value) => {
                const cleaned = value.replace(/[^0-9-]/g, '').slice(0, 10);
                updateField('date', cleaned);
              }}
              placeholder="2026-06-19"
              placeholderTextColor={Color.inkDisabled}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              style={styles.input}
            />

            <Text style={[styles.fieldLabel, { marginTop: Space.md }]}>标题</Text>
            <TextInput
              value={draft.title}
              onChangeText={(value) => updateField('title', value)}
              placeholder="例如:跟客户对方案"
              placeholderTextColor={Color.inkDisabled}
              style={styles.input}
              maxLength={200}
            />

            <Text style={[styles.fieldLabel, { marginTop: Space.md }]}>描述 (可选)</Text>
            <TextInput
              value={draft.description}
              onChangeText={(value) => updateField('description', value)}
              placeholder="补充背景、参与人、地点等"
              placeholderTextColor={Color.inkDisabled}
              multiline
              style={[styles.input, styles.inputMulti]}
              maxLength={4000}
            />

            <View style={styles.timeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>开始时间</Text>
                <TextInput
                  value={draft.startTime}
                  onChangeText={(value) => {
                    const cleaned = value.replace(/[^0-9:]/g, '').slice(0, 5);
                    updateField('startTime', cleaned);
                  }}
                  placeholder="10:00"
                  placeholderTextColor={Color.inkDisabled}
                  keyboardType="numbers-and-punctuation"
                  style={styles.input}
                  maxLength={5}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>结束时间</Text>
                <TextInput
                  value={draft.endTime}
                  onChangeText={(value) => {
                    const cleaned = value.replace(/[^0-9:]/g, '').slice(0, 5);
                    updateField('endTime', cleaned);
                  }}
                  placeholder="11:00"
                  placeholderTextColor={Color.inkDisabled}
                  keyboardType="numbers-and-punctuation"
                  style={styles.input}
                  maxLength={5}
                />
              </View>
            </View>
            <Text style={[Type.caption, { color: Color.inkFaint, marginTop: Space.xs }]}>
              留空表示全天;只填一个会保存时报错。
            </Text>

            <Text style={[styles.fieldLabel, { marginTop: Space.md }]}>类型</Text>
            <View style={styles.segmentRow}>
              {(['event', 'reminder', 'task'] as MobileCalendarKind[]).map((kind) => (
                <Pressable
                  key={kind}
                  onPress={() => updateField('kind', kind)}
                  style={[styles.segment, draft.kind === kind && styles.segmentActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: draft.kind === kind }}
                >
                  <Text
                    style={[
                      Type.captionBold,
                      { color: draft.kind === kind ? Color.primary : Color.inkMuted },
                    ]}
                  >
                    {KIND_LABELS[kind]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {mode === 'edit' ? (
              <>
                <Text style={[styles.fieldLabel, { marginTop: Space.md }]}>状态</Text>
                <View style={styles.segmentRow}>
                  {(['active', 'completed', 'cancelled'] as MobileCalendarStatus[]).map((status) => (
                    <Pressable
                      key={status}
                      onPress={() => updateField('status', status)}
                      style={[
                        styles.segment,
                        draft.status === status && styles.segmentActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: draft.status === status }}
                    >
                      <Text
                        style={[
                          Type.captionBold,
                          {
                            color:
                              draft.status === status ? Color.primary : Color.inkMuted,
                          },
                        ]}
                      >
                        {STATUS_LABELS[status]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {/* Phase6: opt-in quick note. Default behavior unchanged when toggle is off. */}
            {mode === 'create' ? (
              <View style={[styles.quickNoteCard, { marginTop: Space.md }]}>
                <View style={styles.quickNoteHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[Type.bodySm, { color: Color.ink, fontWeight: '700' }]}>
                      同时作为快速笔记触发知识库整理
                    </Text>
                    <Text style={[Type.caption, { color: Color.inkMuted, marginTop: 2 }]}>
                      开启后下方原文会被送入后台 knowledge note 整理任务，不等待 LLM。
                    </Text>
                  </View>
                  <Switch
                    value={Boolean(draft.autoOrganize)}
                    onValueChange={(value) => updateField('autoOrganize', value)}
                    disabled={busy}
                  />
                </View>
                {draft.autoOrganize ? (
                  <>
                    <Text style={[styles.fieldLabel, { marginTop: Space.sm }]}>笔记原文</Text>
                    <TextInput
                      value={draft.rawContent || ''}
                      onChangeText={(value) => updateField('rawContent', value)}
                      placeholder="原始笔记内容，例：会议要点 / 客户反馈 / 待办整理"
                      placeholderTextColor={Color.inkDisabled}
                      multiline
                      style={[styles.input, styles.inputMulti, { minHeight: 96 }]}
                    />
                    <Text style={[styles.fieldLabel, { marginTop: Space.sm }]}>
                      标签 (逗号分隔, 可选)
                    </Text>
                    <TextInput
                      value={(draft.tags || []).join(', ')}
                      onChangeText={(value) =>
                        updateField(
                          'tags',
                          value
                            .split(/[,，]/)
                            .map((t) => t.trim())
                            .filter(Boolean)
                            .slice(0, 20),
                        )
                      }
                      placeholder="客户A, 复盘, 待跟进"
                      placeholderTextColor={Color.inkDisabled}
                      style={styles.input}
                    />
                    <Text style={[styles.fieldLabel, { marginTop: Space.sm }]}>
                      关联条目 (逗号分隔, 可选)
                    </Text>
                    <TextInput
                      value={(draft.related || []).join(', ')}
                      onChangeText={(value) =>
                        updateField(
                          'related',
                          value
                            .split(/[,，]/)
                            .map((t) => t.trim())
                            .filter(Boolean)
                            .slice(0, 20),
                        )
                      }
                      placeholder="note-xxx, daily/2026-07-01"
                      placeholderTextColor={Color.inkDisabled}
                      style={styles.input}
                    />
                  </>
                ) : null}
              </View>
            ) : null}

            {error ? (
              <View style={[styles.errorBanner, { marginTop: Space.md }]}>
                <Text style={[Type.captionBold, { color: Color.dangerInk }]}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.editorActions}>
              <Button
                label={busy ? '保存中' : mode === 'create' ? '新建' : '保存'}
                tone="primary"
                size="md"
                fullWidth
                disabled={busy}
                onPress={() => onSave(draft)}
              />
              <View style={{ height: Space.sm }} />
              <Button
                label="取消"
                tone="secondary"
                size="md"
                fullWidth
                disabled={busy}
                onPress={onClose}
              />
            </View>
          
</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DeleteConfirm({
  event,
  busy,
  onConfirm,
  onCancel,
}: {
  event: MobileCalendarEvent;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalScrim}>
        <View style={styles.deleteCard}>
          <Text style={[Type.h2, { color: Color.ink }]}>删除日程</Text>
          <Text style={[Type.bodySm, { color: Color.inkMuted, marginTop: Space.xs, lineHeight: 20 }]}>
            确定删除 "{event.title}" 吗?删除后不可恢复。
          </Text>
          <View style={[styles.eventSummary, { marginTop: Space.md }]}>
            <Text style={[Type.caption, { color: Color.inkFaint }]}>
              {event.date} · {formatTimeRange(event.startTime, event.endTime)}
            </Text>
          </View>
          <View style={styles.editorActions}>
            <Button
              label={busy ? '删除中' : '确认删除'}
              tone="danger"
              size="md"
              fullWidth
              disabled={busy}
              onPress={onConfirm}
            />
            <View style={{ height: Space.sm }} />
            <Button label="取消" tone="secondary" size="md" fullWidth disabled={busy} onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- 校验 hooks ---------- */

export function isValidCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isValidCalendarTime(value: string): boolean {
  return TIME_RE.test(value);
}

/* ---------- 样式 ---------- */

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: Color.surfaceSubtle,
  },
  content: {
    padding: Space.lg,
    // FAB (56) + TAB_BAR_LIFT (60) + insets.bottom + 间距,确保最后一行不被遮挡
    paddingBottom: 56 + TAB_BAR_LIFT + Space.xxl + Space.xl,
    gap: Space.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  header: {
    marginBottom: Space.xs,
  },
  kindFilterRow: {
    flexDirection: "row",
    gap: Space.sm,
    marginTop: Space.md,
    marginBottom: Space.sm,
  },
  kindFilterChip: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Color.border,
    backgroundColor: Color.surface,
  },
  kindFilterChipActive: { backgroundColor: Color.primary, borderColor: Color.primary },
  kindFilterLabel: { ...Type.bodySm, color: Color.inkMuted, fontWeight: "700" },
  kindFilterLabelActive: { color: Color.surface, fontWeight: "900" },
  calendarFab: {
    position: "absolute",
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Color.primary,
    alignItems: "center",
    justifyContent: "center",
    ...Shadow.md,
  },
  calendarFabGlyph: { color: Color.surface, fontSize: 32, lineHeight: 36, fontWeight: "900" },
    segmented: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: Color.surfaceMuted,
    padding: 4,
    borderRadius: Radius.md,
  },
  viewSegment: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewSegmentActive: {
    backgroundColor: Color.surface,
    ...Shadow.sm,
  },
  dateCard: {
    backgroundColor: Color.surface,
    borderWidth: 1,
    borderColor: Color.border,
    borderRadius: Radius.lg,
    padding: Space.lg,
    ...Shadow.sm,
  },
  dateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  dayNav: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.primarySoft,
    backgroundColor: Color.primarySofter,
  },
  dayNavPressed: {
    backgroundColor: Color.primarySoft,
  },
  dateCenter: {
    flex: 1,
    alignItems: 'center',
  },
  dateFooter: {
    marginTop: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  todayPill: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    backgroundColor: Color.primary,
  },
  todayPillPressed: {
    backgroundColor: Color.primaryDeep,
  },
  todayPillActive: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Color.primarySoft,
    backgroundColor: Color.primarySofter,
  },
  weekStrip: {
    flexDirection: 'row',
    gap: Space.xs,
    backgroundColor: Color.surface,
    borderWidth: 1,
    borderColor: Color.border,
    borderRadius: Radius.lg,
    padding: Space.sm,
    ...Shadow.sm,
  },
  weekDay: {
    flex: 1,
    minHeight: 70,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    backgroundColor: Color.surfaceMuted,
    borderWidth: 1,
    borderColor: Color.borderSoft,
  },
  weekDayActive: {
    backgroundColor: Color.primarySofter,
    borderColor: Color.primarySoft,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  statCell: {
    flex: 1,
    minHeight: 62,
    borderRadius: Radius.md,
    backgroundColor: Color.surface,
    borderWidth: 1,
    borderColor: Color.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.sm,
  },
  listCard: {
    backgroundColor: Color.surface,
    borderWidth: 1,
    borderColor: Color.border,
    borderRadius: Radius.lg,
    paddingHorizontal: Space.md,
    ...Shadow.sm,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.sm,
  },
  eventRowTopBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.borderSoft,
  },
  eventTimeCol: {
    minWidth: 64,
    paddingTop: 2,
  },
  eventMain: {
    flex: 1,
  },
  eventTagRow: {
    flexDirection: 'row',
    gap: Space.sm,
    marginTop: Space.sm,
  },
  openNoteBtn: {
    alignSelf: 'flex-start',
    marginTop: Space.sm,
    paddingHorizontal: Space.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Color.primarySofter,
  },
  openNoteBtnText: {
    ...Type.captionBold,
    color: Color.primary,
  },
  tagPill: {
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
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
  errorBanner: {
    backgroundColor: Color.dangerSoft,
    borderColor: Color.dangerBorder,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  // Phase6: quick-note opt-in card (visible only in 'create' mode when toggle on)
  quickNoteCard: {
    backgroundColor: Color.infoSoft,
    borderColor: Color.infoBorder,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  quickNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  fab: {
    position: 'absolute',
    right: Space.lg,
    bottom: Space.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.lg,
  },
  fabPressed: {
    backgroundColor: Color.primaryDeep,
    transform: [{ scale: 0.97 }],
  },
  fabIcon: {
    color: Color.onPrimary,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
  },
  modalScrim: {
    flex: 1,
    backgroundColor: Color.scrim,
    justifyContent: 'center',
    padding: Space.lg,
  },
  editorCard: {
    backgroundColor: Color.surface,
    borderRadius: Radius.lg,
    maxHeight: '90%',
    ...Shadow.lg,
  },
  deleteCard: {
    backgroundColor: Color.surface,
    borderRadius: Radius.lg,
    padding: Space.lg,
    ...Shadow.lg,
  },
  fieldLabel: {
    ...Type.captionBold,
    color: Color.inkFaint,
    letterSpacing: 0.4,
    marginBottom: Space.xs,
  },
  input: {
    backgroundColor: Color.surfaceMuted,
    borderColor: Color.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    minHeight: Size.inputMd,
    color: Color.ink,
    ...Type.body,
  },
  inputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  timeRow: {
    flexDirection: 'row',
    gap: Space.md,
    marginTop: Space.md,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  segment: {
    flex: 1,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.border,
    backgroundColor: Color.surface,
    alignItems: 'center',
  },
  segmentActive: {
    borderColor: Color.primarySoft,
    backgroundColor: Color.primarySofter,
  },
  editorActions: {
    marginTop: Space.lg,
  },
  eventSummary: {
    backgroundColor: Color.surfaceMuted,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
});
