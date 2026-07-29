import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  todoDueAt,
  todoNoteLinks,
  type CopilotNoteSummary,
  type CopilotProductApi,
  type CopilotTodo,
} from '../lib/copilot-api.js';
import type {
  KnowledgeBuildStatusReceipt,
  RendererTrashItem,
  WikiTruthReceipt,
} from '../../shared/domain-api.js';
import styles from './ScheduleWorkspace.module.css';
import { WorkspaceState } from './WorkspaceState.js';
import { VoiceInput } from '../components/VoiceInput/index.js';
import type { GlobalAssistantContext } from '../components/Assistant/types.js';

interface ScheduleWorkspaceProps {
  api: CopilotProductApi;
  onOpenNote?(path: string): void;
  onOpenKnowledge?(): void;
  onOpenAsk?(): void;
  captureDraft?: string;
  onCaptureDraftChange?(value: string): void;
  onAssistantContextChange?(context: GlobalAssistantContext): void;
  todoMemoryAdapter?(todo: CopilotTodo, memory: TodoMemory): Promise<void>;
}

type CaptureIndexFeedback =
  | { kind: 'queued'; message: string; retry: 'none' }
  | { kind: 'running'; message: string; retry: 'none' }
  | { kind: 'current'; message: string; retry: 'none' }
  | { kind: 'failed'; message: string; retry: 'rebuild' | 'requery' }
  | { kind: 'not-ready'; message: string; retry: 'rebuild' | 'requery' };

const WIKI_POLL_DELAYS_MS = [
  250,
  500,
  1_000,
  2_000,
  3_000,
  4_000,
  4_000,
  4_000,
] as const;

function initialBuildFeedback(
  build: KnowledgeBuildStatusReceipt,
): CaptureIndexFeedback {
  switch (build.state) {
    case 'queued':
      return { kind: 'queued', message: 'WIKI QUEUED · 本地笔记已排队。', retry: 'none' };
    case 'running':
      return { kind: 'running', message: 'WIKI RUNNING · 正在本地构建。', retry: 'none' };
    case 'failed':
      return { kind: 'failed', message: 'WIKI FAILED · 本地笔记已保留。', retry: 'rebuild' };
    case 'not-ready':
      return { kind: 'not-ready', message: 'WIKI NOT_READY · 本地笔记已保留。', retry: 'rebuild' };
    case 'ready':
      return { kind: 'not-ready', message: 'WIKI NOT_READY · 正在核对当前版本。', retry: 'requery' };
  }
}

function wikiFeedback(notePath: string, truth: WikiTruthReceipt): CaptureIndexFeedback {
  if (truth.notePath !== notePath) {
    return {
      kind: 'failed',
      message: 'WIKI FAILED · 返回路径与本地笔记不一致。',
      retry: 'requery',
    };
  }
  const build = truth.knowledgeBuild;
  if (build?.state === 'failed' || truth.truth === 'failed') {
    return {
      kind: 'failed',
      message: 'WIKI FAILED · 本地笔记已保留，可重试构建。',
      retry: 'rebuild',
    };
  }
  if (build?.state === 'queued') {
    return { kind: 'queued', message: 'WIKI QUEUED · 本地笔记已排队。', retry: 'none' };
  }
  if (build?.state === 'running') {
    return { kind: 'running', message: 'WIKI RUNNING · 正在本地构建。', retry: 'none' };
  }
  const projection = truth.current ?? truth.projection;
  const digestBoundCurrent = build?.state === 'ready'
    && truth.truth === 'current'
    && truth.expectedContentDigest !== null
    && projection?.status === 'current'
    && projection.notePath === notePath
    && projection.contentDigest === truth.expectedContentDigest;
  if (digestBoundCurrent) {
    return {
      kind: 'current',
      message: 'WIKI CURRENT · 当前笔记版本已完成知识构建。',
      retry: 'none',
    };
  }
  return {
    kind: 'not-ready',
    message: 'WIKI NOT_READY · 当前版本尚无可验证的 WIKI 结果。',
    retry: build?.state === 'not-ready' ? 'rebuild' : 'requery',
  };
}

function todoKey(todo: CopilotTodo): string {
  return String(todo.id);
}

function uniqueTodos(items: ReadonlyArray<CopilotTodo>): CopilotTodo[] {
  return [...new Map(items.map((todo) => [todoKey(todo), todo])).values()];
}

function toLocalInput(epoch: number | null): string {
  if (!epoch) return '';
  const date = new Date(epoch - new Date(epoch).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function localDateKey(epoch: number): string {
  const date = new Date(epoch);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return String(date.getFullYear()) + '-' + month + '-' + day;
}

function calendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => (
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
  ));
}

function monthDate(date: Date, offset: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

function notesFromList(
  value: ReadonlyArray<CopilotNoteSummary> | { items: CopilotNoteSummary[] },
): CopilotNoteSummary[] {
  return 'items' in value ? [...value.items] : [...value];
}

function displayDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date);
}

function displayTime(epoch: number | null): string {
  if (!epoch) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epoch));
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function trapDialogKeyboard(
  event: ReactKeyboardEvent<HTMLElement>,
  close: () => void,
): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getAttribute('aria-hidden') !== 'true');
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

interface TodoLog {
  id: string;
  createdAt: number;
  body: string;
}

interface TodoMemory {
  logs: TodoLog[];
  note: string;
}

type TodoSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed';

function todoSaveStateLabel(state: TodoSaveState): string {
  switch (state) {
    case 'idle':
      return '未修改';
    case 'dirty':
      return '未保存';
    case 'saving':
      return '保存中';
    case 'saved':
      return '已保存';
    case 'failed':
      return '保存失败';
  }
}

interface TodoRowProps {
  todo: CopilotTodo;
  memory?: TodoMemory;
  onToggle(todo: CopilotTodo): void;
  onRemove(todo: CopilotTodo): void;
  onOpenNote?(path: string): void;
  onSaveMemory(todo: CopilotTodo, memory: TodoMemory): void | Promise<void>;
}

function TodoRow({
  todo,
  memory,
  onToggle,
  onRemove,
  onOpenNote,
  onSaveMemory,
}: TodoRowProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [logDraft, setLogDraft] = useState('');
  const [note, setNote] = useState(memory?.note ?? '');
  const [logSaveState, setLogSaveState] = useState<TodoSaveState>('idle');
  const [noteSaveState, setNoteSaveState] = useState<TodoSaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveState: TodoSaveState = logSaveState === 'saving' || noteSaveState === 'saving'
    ? 'saving'
    : logSaveState === 'failed' || noteSaveState === 'failed'
      ? 'failed'
      : logSaveState === 'dirty' || noteSaveState === 'dirty'
        ? 'dirty'
        : 'idle';
  const saving = saveState === 'saving';

  useEffect(() => {
    if (!expanded) {
      setLogDraft('');
      setNote(memory?.note ?? '');
      setLogSaveState('idle');
      setNoteSaveState('idle');
      setSaveError(null);
    }
  }, [expanded, memory]);

  const saveMemory = async () => {
    const nextLogs = [...(memory?.logs ?? [])];
    const body = logDraft.trim();
    const nextNote = note.trim();
    const logChanged = body.length > 0;
    const noteChanged = nextNote !== (memory?.note ?? '');
    if (!logChanged && !noteChanged) return;
    if (body) {
      const createdAt = Date.now();
      nextLogs.push({
        id: String(createdAt) + '-' + String(nextLogs.length),
        createdAt,
        body,
      });
    }
    if (logChanged) setLogSaveState('saving');
    if (noteChanged) setNoteSaveState('saving');
    setSaveError(null);
    try {
      const result = onSaveMemory(todo, { logs: nextLogs, note: nextNote });
      if (result && typeof result.then === 'function') await result;
      if (logChanged) setLogSaveState('saved');
      if (noteChanged) setNoteSaveState('saved');
      setLogDraft('');
      setExpanded(false);
    } catch (cause) {
      if (logChanged) setLogSaveState('failed');
      if (noteChanged) setNoteSaveState('failed');
      setSaveError(errorMessage(cause));
    }
  };

  const cancelMemory = () => {
    setLogDraft('');
    setNote(memory?.note ?? '');
    setLogSaveState('idle');
    setNoteSaveState('idle');
    setSaveError(null);
    setExpanded(false);
  };

  const toggleMemoryEditor = () => {
    if (!expanded) {
      setLogSaveState('idle');
      setNoteSaveState('idle');
      setSaveError(null);
    }
    setExpanded((current) => !current);
  };

  const editorId = 'todo-memory-editor-' + todoKey(todo);

  return (
    <li className="todo" data-status={todo.status} data-testid={'todo-card-' + todoKey(todo)}>
      <input
        type="checkbox"
        checked={todo.status === 'done'}
        aria-label={'完成 ' + todo.title}
        onChange={() => onToggle(todo)}
      />
      <div className={styles.todoCardBody}>
        <button
          type="button"
          className={styles.todoCardTrigger}
          aria-expanded={expanded}
          aria-controls={editorId}
          aria-label={(expanded ? '收起待办 ' : '展开待办 ') + todo.title}
          onClick={toggleMemoryEditor}
        >
          <strong>{todo.title}</strong>
          <small>{toLocalInput(todoDueAt(todo)) || '未设置时间'}</small>
        </button>
        {memory && !expanded ? (
          <div
            className={styles.todoMemorySummary}
            data-testid={'todo-memory-summary-' + todoKey(todo)}
            data-save-state="saved"
            role="status"
          >
            {memory.logs.length > 0 ? (
              <span>执行日志（{memory.logs.length}）：{memory.logs[memory.logs.length - 1]?.body}</span>
            ) : null}
            {memory.note ? <span>备注：{memory.note}</span> : null}
            <span
              data-testid={'todo-log-save-state-' + todoKey(todo)}
              data-save-state="saved"
            >
              执行日志状态：已保存
            </span>
            <span
              data-testid={'todo-note-save-state-' + todoKey(todo)}
              data-save-state="saved"
            >
              备注状态：已保存
            </span>
            <small>已保存到当前页面内存 · PROTOTYPE / NOT_RUNTIME_PROOF</small>
          </div>
        ) : null}
        {expanded ? (
          <div
            id={editorId}
            className={styles.todoMemoryEditor}
            data-testid={editorId}
            data-save-state={saveState}
            data-assistant-avoid="critical"
          >
            <div className={styles.prototypeLabel}>PROTOTYPE / NOT_RUNTIME_PROOF · 仅保存在当前页面内存</div>
            <p>执行日志与备注仅保存在页面内存，不写入本地数据库或运行时。</p>
            <div role="status" aria-live="polite" className={styles.todoSaveStates}>
              <span
                data-testid={'todo-log-save-state-' + todoKey(todo)}
                data-save-state={logSaveState}
              >
                执行日志状态：{todoSaveStateLabel(logSaveState)}
              </span>
              <span
                data-testid={'todo-note-save-state-' + todoKey(todo)}
                data-save-state={noteSaveState}
              >
                备注状态：{todoSaveStateLabel(noteSaveState)}
              </span>
            </div>
            {saveError ? (
              <p role="alert">
                保存失败：{saveError}。编辑内容已保留，可重试；未写入页面内存。
              </p>
            ) : null}
            {memory?.logs.length ? (
              <ol className={styles.logHistory} aria-label="执行日志历史">
                {memory.logs.map((log) => (
                  <li key={log.id}>
                    <time>{displayTime(log.createdAt)}</time>
                    <span>{log.body}</span>
                  </li>
                ))}
              </ol>
            ) : <p className={styles.emptyCopy}>还没有执行日志。</p>}
            <label>
              新增执行日志
              <textarea
                value={logDraft}
                onChange={(event) => {
                  const value = event.target.value;
                  setLogDraft(value);
                  setLogSaveState(value.trim() ? 'dirty' : 'idle');
                  setSaveError(null);
                }}
                rows={2}
              />
            </label>
            <label>
              备注
              <textarea
                value={note}
                onChange={(event) => {
                  const value = event.target.value;
                  setNote(value);
                  setNoteSaveState(value.trim() === (memory?.note ?? '') ? 'idle' : 'dirty');
                  setSaveError(null);
                }}
                rows={2}
              />
            </label>
            <div className={styles.knowledgeLinks} aria-label="关联知识">
              <strong>关联知识</strong>
              {todoNoteLinks(todo).length > 0 ? todoNoteLinks(todo).map((path) => (
                <button key={path} type="button" className="tag" onClick={() => onOpenNote?.(path)}>{path}</button>
              )) : <span>暂无关联知识</span>}
            </div>
            <div className={styles.todoMemoryActions}>
              <button type="button" className="btn" aria-label="取消编辑待办详情" onClick={cancelMemory}>取消</button>
              <button
                type="button"
                className="btn primary"
                aria-label={saveError ? '重试保存待办详情' : '保存待办详情'}
                onClick={() => void saveMemory()}
                disabled={saving || saveState === 'idle'}
              >
                {saving ? '保存中…' : saveError ? '重试保存' : '保存'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={`icon-btn ${styles.todoDeleteButton}`}
        aria-label={'删除 ' + todo.title}
        onClick={() => onRemove(todo)}
      >
        删除
      </button>
    </li>
  );
}


export function ScheduleWorkspace({
  api,
  onOpenNote,
  onOpenKnowledge,
  captureDraft = '',
  onCaptureDraftChange,
  onAssistantContextChange,
  todoMemoryAdapter,
}: ScheduleWorkspaceProps): ReactElement {
  const browserPrototype = import.meta.env.VITE_COPILOT_BROWSER_PROTOTYPE === '1';
  const [todos, setTodos] = useState<CopilotTodo[]>([]);
  const [due, setDue] = useState<CopilotTodo[]>([]);
  const [notes, setNotes] = useState<CopilotNoteSummary[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [confirmedDueAt, setConfirmedDueAt] = useState('');
  const [dueDecisionConfirmed, setDueDecisionConfirmed] = useState(false);
  const [dateDraftTouched, setDateDraftTouched] = useState(false);
  const [dateGridCursor, setDateGridCursor] = useState(() => new Date());
  const [dateViewMonth, setDateViewMonth] = useState(() => new Date());
  const [notePath, setNotePath] = useState('');
  const [noteQuery, setNoteQuery] = useState('');
  const [todoMemories, setTodoMemories] = useState<Record<string, TodoMemory>>({});
  const [todoDialogOpen, setTodoDialogOpen] = useState(false);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [captureImmersiveOpen, setCaptureImmersiveOpen] = useState(false);
  const [discardDraftOpen, setDiscardDraftOpen] = useState(false);
  const [discardFromImmersive, setDiscardFromImmersive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trashFeedback, setTrashFeedback] = useState<RendererTrashItem | null>(null);
  const [captureSaving, setCaptureSaving] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturedNotePath, setCapturedNotePath] = useState<string | null>(null);
  const [capturedNoteBody, setCapturedNoteBody] = useState('');
  const [captureIndexFeedback, setCaptureIndexFeedback] = useState<CaptureIndexFeedback | null>(null);
  const [captureRetrying, setCaptureRetrying] = useState(false);
  const captureRef = useRef<HTMLElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const modalBackgroundRef = useRef<HTMLElement>(null);
  const todoTriggerRef = useRef<HTMLButtonElement>(null);
  const todoTitleRef = useRef<HTMLInputElement>(null);
  const dateTriggerRef = useRef<HTMLButtonElement>(null);
  const dateGridRef = useRef<HTMLDivElement>(null);
  const captureExpandRef = useRef<HTMLButtonElement>(null);
  const immersiveDraftRef = useRef<HTMLTextAreaElement>(null);
  const discardReturnRef = useRef<HTMLButtonElement | null>(null);
  const keepDraftRef = useRef<HTMLButtonElement>(null);
  const captureDraftRef = useRef(captureDraft);
  const captureWikiRunRef = useRef(0);
  const captureWikiTimerRef = useRef<number | null>(null);
  const notifiedIds = useRef(new Set<string>());
  const acknowledgedIds = useRef(new Set<string>());
  const permissionRequested = useRef(false);
  const activeNotifications = useRef(new Map<string, Notification>());
  captureDraftRef.current = captureDraft;
  const modalOpen = todoDialogOpen || captureImmersiveOpen || discardDraftOpen;

  useEffect(() => {
    const background = modalBackgroundRef.current;
    if (!background) return;
    if (modalOpen) {
      background.setAttribute('inert', '');
      background.setAttribute('aria-hidden', 'true');
    } else {
      background.removeAttribute('inert');
      background.removeAttribute('aria-hidden');
    }
    return () => {
      background.removeAttribute('inert');
      background.removeAttribute('aria-hidden');
    };
  }, [modalOpen]);

  useEffect(() => {
    if (todoDialogOpen) todoTitleRef.current?.focus();
  }, [todoDialogOpen]);

  useEffect(() => {
    if (captureImmersiveOpen) immersiveDraftRef.current?.focus();
  }, [captureImmersiveOpen]);

  useEffect(() => {
    if (discardDraftOpen) keepDraftRef.current?.focus();
  }, [discardDraftOpen]);

  const changeCaptureDraft = useCallback((value: string) => {
    captureDraftRef.current = value;
    onCaptureDraftChange?.(value);
  }, [onCaptureDraftChange]);

  const appendTranscriptDraft = useCallback((text: string) => {
    const current = captureDraftRef.current;
    changeCaptureDraft(current + (current ? '\n' : '') + text);
  }, [changeCaptureDraft]);

  const cancelCaptureWikiPoll = useCallback(() => {
    captureWikiRunRef.current += 1;
    if (captureWikiTimerRef.current !== null) {
      window.clearTimeout(captureWikiTimerRef.current);
      captureWikiTimerRef.current = null;
    }
  }, []);

  const startCaptureWikiPoll = useCallback((path: string) => {
    cancelCaptureWikiPoll();
    const run = captureWikiRunRef.current;
    if (!api.wiki) {
      setCaptureIndexFeedback({
        kind: 'failed',
        message: 'WIKI FAILED · 本地 WIKI 查询不可用；笔记已保留。',
        retry: 'requery',
      });
      return;
    }
    const poll = async (attempt: number): Promise<void> => {
      try {
        const truth = await api.wiki!.getForNote(path);
        if (captureWikiRunRef.current !== run) return;
        const feedback = wikiFeedback(path, truth);
        setCaptureIndexFeedback(feedback);
        if (feedback.kind !== 'queued' && feedback.kind !== 'running') return;
        const nextDelayMs = WIKI_POLL_DELAYS_MS[attempt];
        if (nextDelayMs === undefined) {
          setCaptureIndexFeedback({
            kind: 'not-ready',
            message: 'WIKI NOT_READY · 本次查询已停止，可按需重试。',
            retry: 'requery',
          });
          return;
        }
        captureWikiTimerRef.current = window.setTimeout(() => {
          captureWikiTimerRef.current = null;
          void poll(attempt + 1);
        }, nextDelayMs);
      } catch (cause) {
        if (captureWikiRunRef.current !== run) return;
        setCaptureIndexFeedback({
          kind: 'failed',
          message: 'WIKI FAILED · 查询失败：' + errorMessage(cause),
          retry: 'requery',
        });
      }
    };
    void poll(0);
  }, [api, cancelCaptureWikiPoll]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [items, reminders, listedNotes] = await Promise.all([
        api.todos.list(),
        api.todos.listDue(Date.now()),
        api.notes.list(),
      ]);
      setTodos(uniqueTodos(items));
      setDue(uniqueTodos(reminders).filter((todo) => !acknowledgedIds.current.has(todoKey(todo))));
      setNotes(notesFromList(listedNotes));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  const acknowledge = useCallback(async (todo: CopilotTodo) => {
    setError(null);
    try {
      await api.todos.markReminderFired(todo.id);
      const key = todoKey(todo);
      acknowledgedIds.current.add(key);
      activeNotifications.current.get(key)?.close();
      activeNotifications.current.delete(key);
      setDue((current) => current.filter((item) => todoKey(item) !== key));
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [api, refresh]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    const sendSystemNotifications = async () => {
      if (typeof Notification === 'undefined') return;
      let permission = Notification.permission;
      if (permission === 'default' && typeof Notification.requestPermission === 'function') {
        if (permissionRequested.current) return;
        permissionRequested.current = true;
        try {
          permission = await Notification.requestPermission();
        } catch {
          return;
        }
      }
      if (cancelled || permission !== 'granted') return;
      for (const todo of due) {
        const key = todoKey(todo);
        if (notifiedIds.current.has(key) || acknowledgedIds.current.has(key)) continue;
        notifiedIds.current.add(key);
        try {
          const notification = new Notification('到期提醒', {
            body: todo.title,
            tag: 'copilot-todo-' + key,
            requireInteraction: true,
          });
          activeNotifications.current.set(key, notification);
          notification.onclick = () => {
            window.focus();
            void acknowledge(todo);
          };
          notification.onclose = () => activeNotifications.current.delete(key);
        } catch {
          notifiedIds.current.delete(key);
        }
      }
    };
    void sendSystemNotifications();
    return () => { cancelled = true; };
  }, [acknowledge, due]);

  useEffect(() => () => {
    activeNotifications.current.forEach((notification) => notification.close());
    activeNotifications.current.clear();
  }, []);

  useEffect(() => () => cancelCaptureWikiPoll(), [cancelCaptureWikiPoll]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !title.trim()
      || datePopoverOpen
      || (dueAt !== '' && dueAt !== confirmedDueAt)
    ) return;
    setError(null);
    try {
      const epoch = dueAt !== '' && dueAt === confirmedDueAt
        ? new Date(confirmedDueAt).getTime()
        : null;
      await api.todos.create({
        title: title.trim(),
        dueAt: epoch,
        remindAt: epoch,
        linkedNotePaths: notePath.trim() ? [notePath.trim()] : [],
      });
      setTitle('');
      setDueAt('');
      setConfirmedDueAt('');
      setDueDecisionConfirmed(false);
      setDateDraftTouched(false);
      setNotePath('');
      setNoteQuery('');
      setDatePopoverOpen(false);
      setTodoDialogOpen(false);
      modalBackgroundRef.current?.removeAttribute('inert');
      modalBackgroundRef.current?.removeAttribute('aria-hidden');
      todoTriggerRef.current?.focus();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const mutate = async (operation: () => Promise<unknown>) => {
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const toggle = (todo: CopilotTodo) => void mutate(
    () => api.todos.update(todo.id, { status: todo.status === 'done' ? 'pending' : 'done' }),
  );

  const saveTodoMemory = (todo: CopilotTodo, memory: TodoMemory): void | Promise<void> => {
    if (
      browserPrototype
      && new URLSearchParams(window.location.search).get('todoMemoryFixture') === 'reject'
    ) {
      return Promise.resolve().then(() => {
        throw new Error('PROTOTYPE_TODO_MEMORY_REJECT');
      });
    }
    if (todoMemoryAdapter) {
      return todoMemoryAdapter(todo, memory).then(() => {
        setTodoMemories((current) => ({ ...current, [todoKey(todo)]: memory }));
      });
    }
    return new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        setTodoMemories((current) => ({ ...current, [todoKey(todo)]: memory }));
        resolve();
      });
    });
  };

  const remove = (todo: CopilotTodo) => void mutate(async () => {
    if (!api.trash) throw new Error('可逆回收站暂不可用，未删除任何内容。');
    setTrashFeedback(await api.trash.moveTodo(todo.id));
  });

  const undoRemove = () => void mutate(async () => {
    if (!trashFeedback || !api.trash) return;
    await api.trash.restore({
      trashId: trashFeedback.trashId,
      revision: trashFeedback.revision,
    });
    setTrashFeedback(null);
  });

  const selectedKey = localDateKey(selectedDate.getTime());
  const todayKey = localDateKey(Date.now());
  const dueIsConfirmed = dueDecisionConfirmed && dueAt === confirmedDueAt;
  const dueNeedsConfirmation = dateDraftTouched && dueAt !== confirmedDueAt;
  const dueConfirmationState = dueIsConfirmed
    ? 'confirmed'
    : dateDraftTouched
      ? 'pending'
      : 'empty';
  const updateDueAt = (next: string) => {
    setDueAt(next);
    setDateDraftTouched(true);
  };
  const closeTodoDialog = () => {
    setDatePopoverOpen(false);
    setDueAt(confirmedDueAt);
    setDateDraftTouched(false);
    setTodoDialogOpen(false);
    modalBackgroundRef.current?.removeAttribute('inert');
    modalBackgroundRef.current?.removeAttribute('aria-hidden');
    todoTriggerRef.current?.focus();
  };
  const openDatePopover = () => {
    const initial = confirmedDueAt ? new Date(confirmedDueAt) : new Date(selectedDate);
    setDueAt(confirmedDueAt);
    setDateDraftTouched(false);
    setDateGridCursor(initial);
    setDateViewMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
    setDatePopoverOpen(true);
  };
  const cancelDateSelection = () => {
    setDueAt(confirmedDueAt);
    setDateDraftTouched(false);
    setDatePopoverOpen(false);
    dateTriggerRef.current?.focus();
  };
  const commitDateSelection = () => {
    if (!dateDraftTouched) return;
    setConfirmedDueAt(dueAt);
    setDueDecisionConfirmed(true);
    setDateDraftTouched(false);
    setDatePopoverOpen(false);
    dateTriggerRef.current?.focus();
  };
  const useSuggestedDate = (offsetDays: number) => {
    const suggestion = new Date(selectedDate);
    suggestion.setDate(suggestion.getDate() + offsetDays);
    suggestion.setHours(9, 0, 0, 0);
    updateDueAt(toLocalInput(suggestion.getTime()));
    setDateGridCursor(suggestion);
    setDateViewMonth(new Date(suggestion.getFullYear(), suggestion.getMonth(), 1));
  };
  const chooseGridDate = (date: Date) => {
    const time = dueAt.split('T')[1] || '09:00';
    updateDueAt(localDateKey(date.getTime()) + 'T' + time);
    setDateGridCursor(date);
    setDateViewMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };
  const focusGridDate = (date: Date) => {
    const selector = '[data-date-key="' + localDateKey(date.getTime()) + '"]';
    dateGridRef.current?.querySelector<HTMLButtonElement>(selector)?.focus();
    setDateGridCursor(date);
    setDateViewMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    window.requestAnimationFrame(() => {
      dateGridRef.current?.querySelector<HTMLButtonElement>(selector)?.focus();
    });
  };
  const handleGridKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    let next: Date | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        next = new Date(dateGridCursor.getFullYear(), dateGridCursor.getMonth(), dateGridCursor.getDate() - 1);
        break;
      case 'ArrowRight':
        next = new Date(dateGridCursor.getFullYear(), dateGridCursor.getMonth(), dateGridCursor.getDate() + 1);
        break;
      case 'ArrowUp':
        next = new Date(dateGridCursor.getFullYear(), dateGridCursor.getMonth(), dateGridCursor.getDate() - 7);
        break;
      case 'ArrowDown':
        next = new Date(dateGridCursor.getFullYear(), dateGridCursor.getMonth(), dateGridCursor.getDate() + 7);
        break;
      case 'PageUp':
        next = monthDate(dateGridCursor, -1);
        break;
      case 'PageDown':
        next = monthDate(dateGridCursor, 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    chooseGridDate(next);
    focusGridDate(next);
  };
  const focusMainCalendarDate = (date: Date) => {
    const key = localDateKey(date.getTime());
    setSelectedDate(date);
    window.requestAnimationFrame(() => {
      calendarRef.current
        ?.querySelector<HTMLButtonElement>('[data-calendar-date-key="' + key + '"]')
        ?.focus();
    });
  };
  const handleMainCalendarKey = (event: ReactKeyboardEvent<HTMLButtonElement>, date: Date) => {
    let next: Date | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        next = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
        break;
      case 'ArrowRight':
        next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
        break;
      case 'ArrowUp':
        next = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7);
        break;
      case 'ArrowDown':
        next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
        break;
      case 'PageUp':
        next = monthDate(date, -1);
        break;
      case 'PageDown':
        next = monthDate(date, 1);
        break;
      case 'Home':
        next = new Date();
        break;
      default:
        return;
    }
    event.preventDefault();
    focusMainCalendarDate(next);
  };
  const closeCaptureImmersive = () => {
    setCaptureImmersiveOpen(false);
    modalBackgroundRef.current?.removeAttribute('inert');
    modalBackgroundRef.current?.removeAttribute('aria-hidden');
    captureExpandRef.current?.focus();
  };
  const requestDiscardDraft = (trigger: HTMLButtonElement, immersive: boolean) => {
    if (!captureDraft.trim()) return;
    discardReturnRef.current = trigger;
    setDiscardFromImmersive(immersive);
    if (immersive) setCaptureImmersiveOpen(false);
    setDiscardDraftOpen(true);
  };
  const keepCaptureDraft = () => {
    setDiscardDraftOpen(false);
    if (discardFromImmersive) {
      setCaptureImmersiveOpen(true);
    } else {
      modalBackgroundRef.current?.removeAttribute('inert');
      modalBackgroundRef.current?.removeAttribute('aria-hidden');
      discardReturnRef.current?.focus();
    }
  };
  const discardCaptureDraft = () => {
    changeCaptureDraft('');
    setDiscardDraftOpen(false);
    setDiscardFromImmersive(false);
    modalBackgroundRef.current?.removeAttribute('inert');
    modalBackgroundRef.current?.removeAttribute('aria-hidden');
    discardReturnRef.current?.focus();
  };
  const monthDays = useMemo(() => calendarDays(selectedDate), [selectedDate]);
  const dateGridDays = useMemo(() => calendarDays(dateViewMonth), [dateViewMonth]);
  const dayTodos = useMemo(() => todos.filter((todo) => {
    const epoch = todoDueAt(todo);
    return epoch !== null && localDateKey(epoch) === selectedKey;
  }), [selectedKey, todos]);
  const dayNotes = useMemo(() => notes.filter((note) => {
    const epoch = note.updatedAt ?? note.updated_at;
    return typeof epoch === 'number' && localDateKey(epoch) === selectedKey;
  }), [notes, selectedKey]);
  const todoDates = useMemo(() => new Set(
    todos.map(todoDueAt).filter((epoch): epoch is number => epoch !== null).map(localDateKey),
  ), [todos]);
  const noteDates = useMemo(() => new Set(
    notes
      .map((note) => note.updatedAt ?? note.updated_at)
      .filter((epoch): epoch is number => typeof epoch === 'number')
      .map(localDateKey),
  ), [notes]);
  const pendingTodoCount = dayTodos.filter((todo) => todo.status === 'pending').length;
  const selectedNote = notes.find((note) => note.path === notePath) ?? null;
  const noteCandidates = useMemo(() => {
    const query = noteQuery.trim().toLocaleLowerCase();
    return notes.filter((note) => (
      !query
      || note.title.toLocaleLowerCase().includes(query)
      || note.path.toLocaleLowerCase().includes(query)
      || (note.tags ?? []).some((tag) => tag.toLocaleLowerCase().includes(query))
    )).slice(0, 8);
  }, [noteQuery, notes]);

  useEffect(() => {
    onAssistantContextChange?.({
      route: 'schedule',
      subtitle: selectedKey
        + ' · ' + String(pendingTodoCount) + ' 项未完成'
        + (notePath ? ' · 关联 ' + notePath : ''),
      truth: browserPrototype
        ? 'NOT_PROBED'
        : error
          ? 'ERROR'
          : loading
            ? 'CHECKING'
            : notePath
            ? 'READY'
            : 'NO_SOURCE',
      sourceCount: notePath ? 1 : 0,
      selectedDate: selectedKey,
      todoCount: pendingTodoCount,
      notePath: notePath || null,
    });
  }, [
    browserPrototype,
    error,
    loading,
    notePath,
    onAssistantContextChange,
    pendingTodoCount,
    selectedKey,
  ]);

  const saveCapture = async () => {
    const body = captureDraft.trim();
    if (!body || !onCaptureDraftChange) return;
    cancelCaptureWikiPoll();
    setCaptureSaving(true);
    setCaptureError(null);
    setCapturedNotePath(null);
    setCapturedNoteBody('');
    setCaptureIndexFeedback(null);
    try {
      const firstLine = body.split(/\r?\n/, 1)[0]?.trim() ?? '';
      const stamp = Date.now();
      const note = await api.notes.create({
        path: 'inbox/' + selectedKey + '/capture-' + String(stamp),
        title: firstLine.slice(0, 60) || '记录 ' + displayDate(selectedDate),
        body,
        tags: ['inbox'],
        type: 'note',
        status: 'active',
      });
      if (note.localState !== 'LOCAL_SAVED' || !note.knowledgeBuild || !note.path) {
        throw new Error('本地保存回执无效');
      }
      if (captureDraftRef.current.trim() === body) changeCaptureDraft('');
      setCapturedNotePath(note.path);
      setCapturedNoteBody(body);
      setCaptureIndexFeedback(initialBuildFeedback(note.knowledgeBuild));
      startCaptureWikiPoll(note.path);
    } catch (cause) {
      setCaptureError(errorMessage(cause));
    } finally {
      setCaptureSaving(false);
    }
  };

  const retryCaptureWiki = async () => {
    if (!capturedNotePath || !captureIndexFeedback || captureRetrying) return;
    setCaptureRetrying(true);
    setCaptureError(null);
    try {
      if (captureIndexFeedback.retry === 'rebuild') {
        const note = await api.notes.update(capturedNotePath, { body: capturedNoteBody });
        if (
          !note
          || note.path !== capturedNotePath
          || note.localState !== 'LOCAL_SAVED'
          || !note.knowledgeBuild
        ) {
          throw new Error('本地重试回执无效');
        }
        setCaptureIndexFeedback(initialBuildFeedback(note.knowledgeBuild));
      }
      startCaptureWikiPoll(capturedNotePath);
    } catch (cause) {
      setCaptureIndexFeedback({
        kind: 'failed',
        message: 'WIKI FAILED · 重试失败：' + errorMessage(cause),
        retry: 'rebuild',
      });
    } finally {
      setCaptureRetrying(false);
    }
  };

  const captureWikiBusy = captureSaving
    || captureRetrying
    || captureIndexFeedback?.kind === 'queued'
    || captureIndexFeedback?.kind === 'running';
  const captureWikiBadge = captureIndexFeedback
    ? 'WIKI ' + captureIndexFeedback.kind.replace('-', '_').toUpperCase()
    : 'NOT_PROBED';

  return (
    <section
      ref={modalBackgroundRef}
      className="workspace schedule-workspace"
      data-testid="schedule-workspace"
      data-modal-open={modalOpen ? 'true' : 'false'}
    >
      <header className="workspace-header">
        <div data-testid="today-heading-copy" data-assistant-avoid="critical">
          <h1>{selectedKey === todayKey ? '今天' : '所选日期'} · {displayDate(selectedDate)}</h1>
          <p>{browserPrototype
            ? 'PROTOTYPE fixture：只验收日程、记录与知识导航交互，不代表本地运行。'
            : '围绕一天的日程查看知识、记录知识和应用知识。'}</p>
        </div>
        <div className="workspace-actions" data-assistant-avoid="critical">
          <button type="button" className="btn primary" onClick={() => captureRef.current?.scrollIntoView({ block: 'start' })}>快速记录</button>
          <button type="button" className="btn" onClick={onOpenKnowledge}>打开知识 MOC</button>
        </div>
      </header>

      <div className="today-grid">
        <aside className="calendar-rail" aria-label="日历与当日概览">
          <div className="month-head">
            <h2>{selectedDate.getFullYear()} 年 {selectedDate.getMonth() + 1} 月</h2>
            <span>日历视图</span>
          </div>
          <div ref={calendarRef} className="month" aria-label="月历">
            {['一', '二', '三', '四', '五', '六', '日'].map((day) => <b key={day}>{day}</b>)}
            {monthDays.map((date) => {
              const key = localDateKey(date.getTime());
              const selected = key === selectedKey;
              const today = key === todayKey;
              const classes = ['day'];
              if (date.getMonth() !== selectedDate.getMonth()) classes.push('muted');
              if (todoDates.has(key) || noteDates.has(key)) classes.push('has-note');
              if (selected) classes.push('today');
              return (
                <button
                  type="button"
                  key={key}
                  className={classes.join(' ')}
                  data-calendar-date-key={key}
                  aria-label={'选择日期 ' + key}
                  aria-pressed={selected}
                  aria-current={today ? 'date' : undefined}
                  onClick={() => setSelectedDate(date)}
                  onKeyDown={(event) => handleMainCalendarKey(event, date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="agenda-mini">
            <h3>{selectedKey === todayKey ? '今天概览' : displayDate(selectedDate)}</h3>
            {dayTodos.length > 0 || dayNotes.length > 0 ? (
              <>
                {dayTodos.slice(0, 2).map((todo) => (
                  <div key={'todo-' + todoKey(todo)} className="mini-item">
                    <time>{displayTime(todoDueAt(todo))}</time>
                    {todo.title}
                  </div>
                ))}
                {dayNotes.slice(0, Math.max(0, 3 - Math.min(dayTodos.length, 2))).map((note) => (
                  <button
                    key={'note-' + note.path}
                    type="button"
                    className={`mini-item ${styles.miniNote}`}
                    aria-label={'打开笔记 ' + note.title}
                    onClick={() => onOpenNote?.(note.path)}
                  >
                    <time>{displayTime(note.updatedAt ?? note.updated_at ?? null)}</time>
                    {note.title}
                  </button>
                ))}
              </>
            ) : <p className={styles.emptyCopy}>{browserPrototype
              ? '这一天的浏览器 fixture 没有待办。'
              : '这一天还没有本地笔记或待办。'}</p>}
          </div>
          <button type="button" className="btn" onClick={() => setSelectedDate(new Date())}>回到今天</button>
        </aside>

        <section className="day-workbench">
          <div
            className="day-title"
            data-testid="today-key-overview"
            data-assistant-avoid="critical"
          >
            <div>
              <h2 data-testid="selected-date-heading">
                {displayDate(selectedDate)} · {selectedKey === todayKey ? '今天' : '所选日期'}工作与生活
              </h2>
              <p data-testid="selected-date-feedback">当前选中：{selectedKey}</p>
              <p>
                {dayNotes.length} 条当天笔记 · {dayTodos.length} 项当天待办 ·{' '}
                {browserPrototype ? 'PROTOTYPE FIXTURE / NOT_RUNTIME_PROOF' : '数据来自本地知识与日程'}
              </p>
            </div>
            <span className="spacer" />
            <span className="badge accent">本地日记</span>
          </div>

          {due.length > 0 ? (
            <aside className={styles.reminderStack} role="status" aria-live="assertive" aria-label="到期提醒">
              {due.map((todo) => (
                <div key={todoKey(todo)}>
                  <strong>提醒：{todo.title}</strong>
                  <button type="button" className="btn" onClick={() => void acknowledge(todo)}>知道了</button>
                </div>
              ))}
            </aside>
          ) : null}

          {trashFeedback ? (
            <p role="status" aria-live="polite" data-testid="schedule-trash-feedback">
              “{trashFeedback.title}”已移至回收站。{' '}
              <button type="button" className="btn quiet" onClick={undoRemove}>撤销删除</button>
            </p>
          ) : null}

          <section
            ref={captureRef}
            className="capture"
            id="quick-capture"
            aria-labelledby="capture-title"
            data-testid="today-capture-card"
            data-assistant-avoid="critical"
          >
            <div className="capture-top">
              <strong id="capture-title">快速记录 · 本地草稿</strong>
              <span>文字始终可用；语音仅使用 App 内嵌本地模型。</span>
              <div className={styles.captureToolbar}>
                <small data-testid="today-capture-count">{captureDraft.length} 字</small>
                <button
                  ref={captureExpandRef}
                  type="button"
                  className="btn"
                  onClick={() => setCaptureImmersiveOpen(true)}
                >
                  展开编辑
                </button>
              </div>
            </div>
            <div className="capture-grid" data-testid="today-capture-composition">
              <section className="capture-live" aria-label="文字与本地语音录入">
                <header className="capture-section-head">
                  <strong>实时文字与本地语音</strong>
                  <small>{captureDraft ? 'draft=true' : 'draft=false'}</small>
                </header>
                <div className="transcript-stream" data-testid="today-transcript-stream">
                  <label className="transcript-line">
                    <span>本地草稿</span>
                    <textarea
                      data-testid="today-capture-draft"
                      aria-label="快速记录草稿"
                      rows={4}
                      placeholder="写下想法、决定或需要跟进的事项…"
                      value={captureDraft}
                      onChange={(event) => changeCaptureDraft(event.target.value)}
                    />
                  </label>
                </div>
                <small className="live-hint">草稿只在确认后写入本地笔记；不会切换到远程语音识别。</small>
                <details className={styles.voiceDisclosure}>
                  <summary>开始本地语音</summary>
                  <p>语音转写只进入可编辑草稿，用户确认后才写入本地笔记。</p>
                  <VoiceInput onTranscriptDraft={appendTranscriptDraft} />
                </details>
              </section>
              <aside
                className="capture-enrichment"
                aria-label="保存与知识索引真值"
                aria-live="polite"
                aria-busy={captureWikiBusy}
                data-testid="today-capture-enrichment"
              >
                <header className="capture-section-head">
                  <strong>本地保存与 WIKI</strong>
                  <span className={captureIndexFeedback?.kind === 'current' ? 'badge accent' : 'badge unknown'}>
                    {captureWikiBadge}
                  </span>
                </header>
                <p className={styles.truthCopy}>固定顺序：本地笔记保存成功后，才按返回路径查询后台 WIKI 真值。</p>
                {captureError ? <p className={styles.captureError} role="alert">保存失败：{captureError}。草稿已保留。</p> : null}
                {capturedNotePath ? (
                  <div className={styles.captureTruth} role="status">
                    <strong>{browserPrototype ? '已保存到浏览器内存 fixture；不是本地运行凭据。' : '已保存到本地笔记。'}</strong>
                    <code>{capturedNotePath}</code>
                    <button type="button" className="btn" onClick={() => onOpenNote?.(capturedNotePath)}>打开笔记</button>
                  </div>
                ) : <p className={styles.emptyCopy}>尚未保存；没有知识索引结果。</p>}
                {captureIndexFeedback ? (
                  <p
                    data-testid="capture-index-truth"
                    className={captureIndexFeedback.kind === 'current' ? styles.captureSuccess : styles.captureWarning}
                    role="status"
                  >
                    {captureIndexFeedback.message}
                    {captureIndexFeedback.retry !== 'none' && capturedNotePath ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="btn quiet"
                          onClick={() => void retryCaptureWiki()}
                          disabled={captureRetrying}
                        >
                          {captureRetrying ? '重试中…' : '重试 WIKI'}
                        </button>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </aside>
            </div>
            <div className="capture-actions">
              <button
                type="button"
                className="btn"
                aria-label="取消草稿"
                onClick={(event) => requestDiscardDraft(event.currentTarget, false)}
                disabled={!captureDraft}
              >
                取消草稿
              </button>
              <button type="button" className="btn primary" onClick={() => void saveCapture()} disabled={!captureDraft.trim() || captureSaving}>
                {captureSaving ? '保存中…' : '保存为本地笔记'}
              </button>
              <span className="hint">草稿 → 用户确认 → 本地笔记 → 后台 WIKI / RAG</span>
            </div>
          </section>

          {captureImmersiveOpen ? createPortal((
            <div className={styles.modalBackdrop}>
              <section
                className={`${styles.modalCard} ${styles.immersiveDialog}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="immersive-capture-title"
                data-assistant-avoid="critical"
                onKeyDown={(event) => trapDialogKeyboard(event, closeCaptureImmersive)}
              >
                <header className={styles.modalHeader}>
                  <div>
                    <h2 id="immersive-capture-title">沉浸式快速记录</h2>
                    <p>同一份本地草稿 · {captureDraft.length} 字</p>
                  </div>
                  <button type="button" className="btn" onClick={closeCaptureImmersive}>关闭</button>
                </header>
                <div className={styles.immersiveGrid}>
                  <label className={styles.immersiveEditor}>
                    沉浸式快速记录草稿
                    <textarea
                      ref={immersiveDraftRef}
                      aria-label="沉浸式快速记录草稿"
                      value={captureDraft}
                      onChange={(event) => changeCaptureDraft(event.target.value)}
                    />
                  </label>
                  <aside className={styles.immersiveTruth}>
                    <strong>本地保存与 WIKI</strong>
                    <span className="badge unknown">{captureWikiBadge}</span>
                    <p>PROTOTYPE / NOT_RUNTIME_PROOF</p>
                    <p>先确认保存原始笔记，再按 exact path 查询后台 WIKI 真值。</p>
                    {capturedNotePath ? <code>{capturedNotePath}</code> : <span>尚未保存</span>}
                  </aside>
                </div>
                <footer className={styles.dialogActions}>
                  <button
                    type="button"
                    className="btn"
                    aria-label="取消沉浸式草稿"
                    onClick={(event) => requestDiscardDraft(event.currentTarget, true)}
                    disabled={!captureDraft}
                  >
                    取消草稿
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void saveCapture()}
                    disabled={!captureDraft.trim() || captureSaving}
                  >
                    {captureSaving ? '保存中…' : '保存为本地笔记'}
                  </button>
                </footer>
              </section>
            </div>
          ), document.body) : null}

          <section
            className="day-section"
            aria-labelledby="today-notes-title"
            data-testid="today-notes"
          >
            <div className="section-title">
              <h3 id="today-notes-title">当日笔记</h3>
              <span>{dayNotes.length} 条</span>
            </div>
            {loading ? <WorkspaceState kind="loading" title="正在读取当日笔记…" /> : null}
            {error ? (
              <WorkspaceState
                kind="error"
                title="当日笔记读取失败"
                detail={error}
                action={<button onClick={() => void refresh()}>重试</button>}
              />
            ) : null}
            {!loading && !error && dayNotes.length === 0 ? (
              <p className={styles.timelineEmpty}>
                {browserPrototype
                  ? '选中日期没有笔记 · PROTOTYPE / NOT_RUNTIME_PROOF。'
                  : '选中日期还没有本地笔记。'}
              </p>
            ) : null}
            {dayNotes.length > 0 ? (
              <ul className={styles.dayNoteList}>
                {dayNotes.map((note) => (
                  <li key={note.path}>
                    <button
                      type="button"
                      className={styles.dayNoteButton}
                      aria-label={'打开笔记 ' + note.title}
                      onClick={() => onOpenNote?.(note.path)}
                    >
                      <strong>{note.title}</strong>
                      <code>{note.path}</code>
                      <span>{displayTime(note.updatedAt ?? note.updated_at ?? null)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="day-section" aria-labelledby="today-timeline-title">
            <div className="section-title"><h3 id="today-timeline-title">时间线</h3><span>仅展示选中日期的本地待办</span></div>
            {dayTodos.length > 0 || dayNotes.length > 0 ? (
              <ol className="timeline">
                {dayTodos.map((todo) => (
                  <li key={todoKey(todo)}>
                    <time>{displayTime(todoDueAt(todo))}</time>
                    <span className="timeline-mark" />
                    <article className="timeline-card">
                      <strong>{todo.title}</strong>
                      <p>{todo.status === 'done' ? '已完成' : '待完成'} · 本地日程</p>
                      <div className="links">
                        {todoNoteLinks(todo).map((path) => (
                          <button key={path} type="button" className="tag" onClick={() => onOpenNote?.(path)}>打开笔记：{path}</button>
                        ))}
                      </div>
                    </article>
                  </li>
                ))}
                {dayNotes.map((note) => (
                  <li key={'note-' + note.path}>
                    <time>{displayTime(note.updatedAt ?? note.updated_at ?? null)}</time>
                    <span className="timeline-mark" />
                    <article className="timeline-card">
                      <strong>{note.title}</strong>
                      <p>本地笔记 · {note.path}</p>
                      <div className="links">
                        <button
                          type="button"
                          className="tag"
                          onClick={() => onOpenNote?.(note.path)}
                        >
                          打开笔记：{note.path}
                        </button>
                      </div>
                    </article>
                  </li>
                ))}
              </ol>
            ) : <p className={`${styles.emptyCopy} ${styles.timelineEmpty}`} data-testid="today-timeline-empty">选中日期没有时间线项目。</p>}
          </section>

          <section className="day-section" aria-labelledby="today-todos-title">
            <div className="section-title">
              <h3 id="today-todos-title">待办</h3>
              <span>{dayTodos.filter((todo) => todo.status === 'pending').length} 项未完成</span>
              <button
                ref={todoTriggerRef}
                type="button"
                className="btn primary"
                data-assistant-avoid="critical"
                onClick={() => setTodoDialogOpen(true)}
              >
                + 新增待办
              </button>
            </div>
            <ul className="todo-list" aria-label="待办列表" data-testid="today-todo-list">
              {loading ? (
                <li className={styles.todoState} data-testid="today-todo-loading">
                  <WorkspaceState kind="loading" title="正在读取今日安排…" />
                </li>
              ) : null}
              {error ? (
                <li className={styles.todoState} data-testid="today-todo-error">
                  <WorkspaceState kind="error" title="日程操作失败" detail={error} action={<button onClick={() => void refresh()}>重试</button>} />
                </li>
              ) : null}
              {!loading && !error && dayTodos.length === 0 ? (
                <li className={styles.todoState} data-testid="today-todo-empty">
                  <WorkspaceState
                    kind="empty"
                    title="暂无待办"
                    detail={browserPrototype
                      ? '选中日期暂无待办 · PROTOTYPE / NOT_RUNTIME_PROOF；不是本地数据库空状态。'
                      : '选中日期暂无待办；这是真实的本地空状态；可添加一个带提醒的待办开始使用。'}
                  />
                </li>
              ) : null}
              {dayTodos.map((todo) => <TodoRow key={todoKey(todo)} todo={todo} memory={todoMemories[todoKey(todo)]} onToggle={toggle} onRemove={remove} onOpenNote={onOpenNote} onSaveMemory={saveTodoMemory} />)}
            </ul>
          </section>

          {todoDialogOpen ? createPortal((
            <div className={styles.modalBackdrop}>
              <form
                className={styles.modalCard}
                role="dialog"
                aria-modal="true"
                aria-labelledby="todo-dialog-title"
                aria-describedby={error
                  ? 'todo-dialog-description todo-dialog-error'
                  : 'todo-dialog-description'}
                data-assistant-avoid="critical"
                onKeyDown={(event) => trapDialogKeyboard(event, closeTodoDialog)}
                onSubmit={(event) => void create(event)}
              >
                <header className={styles.modalHeader}>
                  <div>
                    <h2 id="todo-dialog-title">新增待办</h2>
                    <p id="todo-dialog-description">把行动放进所选日期，并可关联本地知识。</p>
                  </div>
                  <button type="button" className="btn" onClick={closeTodoDialog}>关闭</button>
                </header>
                <div className={styles.dialogForm}>
                  <label>
                    待办标题
                    <input
                      ref={todoTitleRef}
                      aria-label="待办标题"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <div className={styles.dateField}>
                    <span>日期与提醒</span>
                    <button
                      ref={dateTriggerRef}
                      type="button"
                      className={styles.dateButton}
                      aria-label={confirmedDueAt
                        ? '已选择 ' + confirmedDueAt.replace('T', ' ')
                        : dueDecisionConfirmed
                          ? '无日期（已确认）'
                          : '选择日期与提醒'}
                      onClick={openDatePopover}
                    >
                      {confirmedDueAt
                        ? confirmedDueAt.replace('T', ' ')
                        : dueDecisionConfirmed
                          ? '无日期'
                          : '选择日期与提醒'}
                    </button>
                    {datePopoverOpen ? (
                      <section
                        className={styles.datePopover}
                        role="dialog"
                        aria-labelledby="todo-date-popover-title"
                        data-testid="todo-date-confirmation"
                        data-confirmation-state={dueConfirmationState}
                        onKeyDown={(event) => {
                          if (event.key !== 'Escape') return;
                          event.preventDefault();
                          event.stopPropagation();
                          cancelDateSelection();
                        }}
                      >
                        <header>
                          <h3 id="todo-date-popover-title">选择日期与提醒</h3>
                          <span>临时值只有确认后才写入待办。</span>
                        </header>
                        <div className={styles.dateShortcuts}>
                          <button type="button" className="btn" onClick={() => useSuggestedDate(0)}>今天 09:00</button>
                          <button type="button" className="btn" onClick={() => useSuggestedDate(1)}>明天 09:00</button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setDueAt('');
                              setDateDraftTouched(true);
                            }}
                          >
                            无日期
                          </button>
                        </div>
                        <div className={styles.dateGridToolbar}>
                          <button
                            type="button"
                            className="btn"
                            aria-label="上个月"
                            onClick={() => {
                              const next = monthDate(dateGridCursor, -1);
                              chooseGridDate(next);
                              focusGridDate(next);
                            }}
                          >
                            ‹
                          </button>
                          <strong data-testid="date-grid-month">
                            {dateViewMonth.getFullYear()} 年 {dateViewMonth.getMonth() + 1} 月
                          </strong>
                          <button
                            type="button"
                            className="btn"
                            aria-label="下个月"
                            onClick={() => {
                              const next = monthDate(dateGridCursor, 1);
                              chooseGridDate(next);
                              focusGridDate(next);
                            }}
                          >
                            ›
                          </button>
                        </div>
                        <div
                          ref={dateGridRef}
                          className={styles.dateMonthGrid}
                          role="grid"
                          aria-label="日期月历"
                        >
                          {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
                            <span role="columnheader" key={day}>{day}</span>
                          ))}
                          {dateGridDays.map((date) => {
                            const key = localDateKey(date.getTime());
                            const today = key === localDateKey(Date.now());
                            const confirmed = Boolean(confirmedDueAt)
                              && key === confirmedDueAt.split('T')[0];
                            const temporary = dateDraftTouched
                              ? Boolean(dueAt) && key === dueAt.split('T')[0]
                              : key === localDateKey(dateGridCursor.getTime());
                            const label = key
                              + (today ? ' 今天' : '')
                              + (confirmed ? ' 已确认' : '')
                              + (temporary ? ' 临时选择' : '');
                            return (
                              <button
                                type="button"
                                role="gridcell"
                                key={key}
                                data-date-key={key}
                                className={date.getMonth() === dateViewMonth.getMonth()
                                  ? styles.dateGridDay
                                  : `${styles.dateGridDay} ${styles.dateGridDayMuted}`}
                                aria-label={label}
                                aria-current={today ? 'date' : undefined}
                                aria-selected={temporary}
                                tabIndex={temporary ? 0 : -1}
                                onClick={() => chooseGridDate(date)}
                                onKeyDown={handleGridKey}
                              >
                                {date.getDate()}
                              </button>
                            );
                          })}
                        </div>
                        <label>
                          临时日期与提醒时间
                          <input
                            aria-label="临时日期与提醒时间"
                            type="datetime-local"
                            value={dueAt}
                            onInput={(event) => updateDueAt(event.currentTarget.value)}
                            onChange={(event) => updateDueAt(event.currentTarget.value)}
                          />
                        </label>
                        <p aria-live="polite">
                          {dateDraftTouched
                            ? dueAt
                              ? '待确认：' + dueAt.replace('T', ' ')
                              : '待确认：无日期'
                            : dueAt
                              ? '已选择：' + dueAt.replace('T', ' ')
                              : dueDecisionConfirmed
                                ? '已确认：无日期'
                                : '尚未选择日期'}
                        </p>
                        <footer className={styles.dialogActions}>
                          <button type="button" className="btn" onClick={cancelDateSelection}>取消日期选择</button>
                          <button
                            type="button"
                            className="btn primary"
                            onClick={commitDateSelection}
                            disabled={!dateDraftTouched}
                          >
                            使用此时间
                          </button>
                        </footer>
                      </section>
                    ) : null}
                  </div>
                  <div className={styles.noteChooser}>
                    <label htmlFor="todo-note-search">关联笔记</label>
                    <input
                      id="todo-note-search"
                      role="combobox"
                      aria-label="搜索关联笔记"
                      aria-controls="todo-note-candidates"
                      aria-expanded={noteCandidates.length > 0}
                      aria-autocomplete="list"
                      placeholder="按标题、标签或路径搜索本地笔记"
                      value={noteQuery}
                      onChange={(event) => setNoteQuery(event.target.value)}
                    />
                    {selectedNote ? (
                      <div className={styles.selectedNote} role="status">
                        <span>已关联：{selectedNote.title}</span>
                        <code>{selectedNote.path}</code>
                        <button
                          type="button"
                          className="btn"
                          aria-label={'移除关联 ' + selectedNote.title}
                          onClick={() => setNotePath('')}
                        >
                          移除
                        </button>
                      </div>
                    ) : null}
                    <div
                      id="todo-note-candidates"
                      className={styles.noteCandidates}
                      role="listbox"
                      aria-label="本地笔记候选"
                    >
                      {noteCandidates.map((note) => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={note.path === notePath}
                          key={note.path}
                          onClick={() => {
                            setNotePath(note.path);
                            setNoteQuery('');
                          }}
                        >
                          <strong>{note.title}</strong>
                          <code>{note.path}</code>
                        </button>
                      ))}
                      {noteCandidates.length === 0 ? <span>没有匹配的本地笔记。</span> : null}
                    </div>
                  </div>
                  {error ? <p id="todo-dialog-error" role="alert">待办保存失败：{error}</p> : null}
                  <p className={styles.prototypeLabel}>PROTOTYPE / NOT_RUNTIME_PROOF · Browser 只保存页面内 fixture。</p>
                </div>
                <footer className={styles.dialogActions}>
                  <button type="button" className="btn" onClick={closeTodoDialog}>取消</button>
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={!title.trim() || dueNeedsConfirmation || datePopoverOpen}
                  >
                    添加待办
                  </button>
                </footer>
              </form>
            </div>
          ), document.body) : null}

          {discardDraftOpen ? createPortal((
            <div className={styles.modalBackdrop}>
              <section
                className={`${styles.modalCard} ${styles.confirmDialog}`}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="discard-draft-title"
                aria-describedby="discard-draft-description"
                onKeyDown={(event) => trapDialogKeyboard(event, keepCaptureDraft)}
              >
                <header className={styles.modalHeader}>
                  <div>
                    <h2 id="discard-draft-title">放弃本地草稿？</h2>
                    <p id="discard-draft-description">草稿尚未保存。放弃后，本次输入将被清空。</p>
                  </div>
                </header>
                <footer className={styles.dialogActions}>
                  <button ref={keepDraftRef} type="button" className="btn" onClick={keepCaptureDraft}>继续编辑</button>
                  <button type="button" className="btn primary" onClick={discardCaptureDraft}>放弃草稿</button>
                </footer>
              </section>
            </div>
          ), document.body) : null}
        </section>
      </div>
    </section>
  );
}
