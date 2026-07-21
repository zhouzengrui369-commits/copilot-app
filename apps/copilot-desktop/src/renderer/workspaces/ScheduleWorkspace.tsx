import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import {
  todoDueAt,
  todoNoteLinks,
  type CopilotProductApi,
  type CopilotTodo,
} from '../lib/copilot-api.js';
import type { RendererTrashItem } from '../../shared/domain-api.js';
import styles from './ScheduleWorkspace.module.css';
import { WorkspaceState } from './WorkspaceState.js';

interface ScheduleWorkspaceProps {
  api: CopilotProductApi;
  onOpenNote?(path: string): void;
}

type ScheduleView = 'list' | 'calendar';

interface CalendarGroup {
  key: string;
  label: string;
  todos: CopilotTodo[];
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
  return `${date.getFullYear()}-${month}-${day}`;
}

function localDateLabel(epoch: number): string {
  const date = new Date(epoch);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function calendarGroups(todos: ReadonlyArray<CopilotTodo>): CalendarGroup[] {
  const dated = new Map<string, CalendarGroup>();
  const undated: CopilotTodo[] = [];
  for (const todo of todos) {
    const dueAt = todoDueAt(todo);
    if (dueAt === null) {
      undated.push(todo);
      continue;
    }
    const key = localDateKey(dueAt);
    const group = dated.get(key) ?? { key, label: localDateLabel(dueAt), todos: [] };
    group.todos.push(todo);
    dated.set(key, group);
  }
  const groups = [...dated.values()].sort((left, right) => left.key.localeCompare(right.key));
  for (const group of groups) {
    group.todos.sort((left, right) => (todoDueAt(left) ?? 0) - (todoDueAt(right) ?? 0));
  }
  return [...groups, { key: 'undated', label: '无日期', todos: undated }];
}

interface TodoRowProps {
  todo: CopilotTodo;
  onToggle(todo: CopilotTodo): void;
  onRemove(todo: CopilotTodo): void;
  onOpenNote?(path: string): void;
}

function TodoRow({ todo, onToggle, onRemove, onOpenNote }: TodoRowProps): ReactElement {
  return (
    <li data-status={todo.status}>
      <button type="button" className="todo-check" aria-label={`切换 ${todo.title}`} onClick={() => onToggle(todo)}>
        {todo.status === 'done' ? '✓' : '○'}
      </button>
      <div>
        <strong>{todo.title}</strong>
        <small>{toLocalInput(todoDueAt(todo)) || '未设置时间'}</small>
        {todoNoteLinks(todo).map((path) => (
          <button key={path} type="button" className="note-link-button" onClick={() => onOpenNote?.(path)}>{path}</button>
        ))}
      </div>
      <button type="button" className="icon-button" aria-label={`删除 ${todo.title}`} onClick={() => onRemove(todo)}>×</button>
    </li>
  );
}

export function ScheduleWorkspace({ api, onOpenNote }: ScheduleWorkspaceProps): ReactElement {
  const [todos, setTodos] = useState<CopilotTodo[]>([]);
  const [due, setDue] = useState<CopilotTodo[]>([]);
  const [view, setView] = useState<ScheduleView>('list');
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [notePath, setNotePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trashFeedback, setTrashFeedback] = useState<RendererTrashItem | null>(null);
  const notifiedIds = useRef(new Set<string>());
  const acknowledgedIds = useRef(new Set<string>());
  const permissionRequested = useRef(false);
  const activeNotifications = useRef(new Map<string, Notification>());

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [items, reminders] = await Promise.all([
        api.todos.list(),
        api.todos.listDue(Date.now()),
      ]);
      setTodos(uniqueTodos(items));
      setDue(uniqueTodos(reminders).filter((todo) => !acknowledgedIds.current.has(todoKey(todo))));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
      setError(cause instanceof Error ? cause.message : String(cause));
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
            tag: `copilot-todo-${key}`,
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

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setError(null);
    try {
      const epoch = dueAt ? new Date(dueAt).getTime() : null;
      await api.todos.create({
        title: title.trim(),
        dueAt: epoch,
        remindAt: epoch,
        linkedNotePaths: notePath.trim() ? [notePath.trim()] : [],
      });
      setTitle('');
      setDueAt('');
      setNotePath('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const mutate = async (operation: () => Promise<unknown>) => {
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggle = (todo: CopilotTodo) => void mutate(
    () => api.todos.update(todo.id, { status: todo.status === 'done' ? 'pending' : 'done' }),
  );

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
  const groups = useMemo(() => calendarGroups(todos), [todos]);

  return (
    <section className="workspace schedule-workspace" data-testid="schedule-workspace">
      <header className="workspace__header">
        <div>
          <h2>Schedule</h2>
          <p>待办、提醒和关联笔记都保存在本地。</p>
        </div>
        <div className={styles.viewSwitch} role="group" aria-label="日程视图">
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>列表视图</button>
          <button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>日历视图</button>
        </div>
      </header>

      {due.length > 0 ? (
        <aside className="reminder-stack" role="status" aria-live="assertive" aria-label="到期提醒">
          {due.map((todo) => (
            <div key={todoKey(todo)} className="reminder-card">
              <strong>提醒：{todo.title}</strong>
              <button type="button" onClick={() => void acknowledge(todo)}>知道了</button>
            </div>
          ))}
        </aside>
      ) : null}

      {trashFeedback ? (
        <p role="status" aria-live="polite" data-testid="schedule-trash-feedback">
          “{trashFeedback.title}”已移至回收站。{' '}
          <button type="button" onClick={undoRemove}>撤销删除</button>
        </p>
      ) : null}

      <form className="schedule-form" onSubmit={(event) => void create(event)}>
        <label>
          待办
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          到期与提醒时间
          <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </label>
        <label>
          关联笔记路径
          <input placeholder="例如 inbox/opc" value={notePath} onChange={(event) => setNotePath(event.target.value)} />
        </label>
        <button className="primary-button" type="submit" disabled={!title.trim()}>添加待办</button>
      </form>

      {loading ? <WorkspaceState kind="loading" title="正在读取日程…" /> : null}
      {error ? <WorkspaceState kind="error" title="日程操作失败" detail={error} action={<button onClick={() => void refresh()}>重试</button>} /> : null}
      {!loading && !error && todos.length === 0 ? (
        <WorkspaceState kind="empty" title="暂无待办" detail="添加一个带提醒的待办开始使用。" />
      ) : null}

      {view === 'list' ? (
        <ul className="todo-list" aria-label="待办列表">
          {todos.map((todo) => (
            <TodoRow key={todoKey(todo)} todo={todo} onToggle={toggle} onRemove={remove} onOpenNote={onOpenNote} />
          ))}
        </ul>
      ) : (
        <div className={styles.calendar} role="region" aria-label="日历视图">
          {todos.length === 0 ? <p className={styles.calendarEmpty}>日历中暂无待办</p> : null}
          {groups.map((group) => (
            <section key={group.key} className={styles.calendarGroup} role="group" aria-label={group.label}>
              <header className={styles.calendarGroupHeader}>
                <h3>{group.label}</h3>
                <span>{group.todos.length} 项</span>
              </header>
              {group.todos.length > 0 ? (
                <ul className="todo-list" aria-label={`${group.label}待办`}>
                  {group.todos.map((todo) => (
                    <TodoRow key={todoKey(todo)} todo={todo} onToggle={toggle} onRemove={remove} onOpenNote={onOpenNote} />
                  ))}
                </ul>
              ) : <p className={styles.emptyGroup}>0 项</p>}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
