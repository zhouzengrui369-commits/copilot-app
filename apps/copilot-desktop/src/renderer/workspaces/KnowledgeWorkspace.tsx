import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import type { KgEntity, RendererTrashItem } from '../../shared/domain-api.js';
import { KnowledgeGraph } from '../components/KnowledgeGraph/index.js';
import { NoteDetail } from '../components/NoteDetail/index.js';
import {
  createKgDataSource,
  createNoteDataSource,
  normalizeNote,
  normalizeNoteList,
  type CopilotNote,
  type CopilotNoteInput,
  type CopilotNoteSummary,
  type CopilotProductApi,
} from '../lib/copilot-api.js';
import { WorkspaceState } from './WorkspaceState.js';

interface KnowledgeWorkspaceProps {
  api: CopilotProductApi;
  requestedPath?: string | null;
}

const EMPTY_DRAFT: CopilotNoteInput = {
  path: '',
  title: '',
  body: '',
  tags: [],
  type: 'note',
  status: 'active',
};

function pathForTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `inbox/${normalized || `note-${Date.now()}`}`;
}

function toDraft(note: CopilotNote): CopilotNoteInput {
  return {
    path: note.path,
    title: note.title,
    body: note.body,
    tags: note.tags ?? [],
    type: note.type ?? 'note',
    status: note.status ?? 'active',
  };
}

export function KnowledgeWorkspace({ api, requestedPath }: KnowledgeWorkspaceProps): ReactElement {
  const [notes, setNotes] = useState<CopilotNoteSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<CopilotNoteInput>(EMPTY_DRAFT);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphVersion, setGraphVersion] = useState(0);
  const [trashFeedback, setTrashFeedback] = useState<RendererTrashItem | null>(null);

  const noteSource = useMemo(() => createNoteDataSource(api), [api]);
  const graphSource = useMemo(() => createKgDataSource(api), [api, graphVersion]);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = normalizeNoteList(await api.notes.list());
      setNotes(result);
      setSelectedPath((current) => current ?? result[0]?.path ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const openEditor = async (path: string) => {
    setError(null);
    try {
      const note = normalizeNote(await api.notes.get(path));
      if (!note) throw new Error('笔记不存在或已被删除。');
      setEditingPath(path);
      setDraft(toDraft(note));
      setSelectedPath(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    if (requestedPath) void openEditor(requestedPath);
  }, [requestedPath]);

  const beginCreate = () => {
    setEditingPath(null);
    setDraft(EMPTY_DRAFT);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const input = {
      ...draft,
      path: draft.path.trim() || pathForTitle(draft.title),
      title: draft.title.trim(),
      body: draft.body,
      tags: draft.tags ?? [],
    };
    if (!input.title) {
      setError('标题不能为空。');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const note = editingPath
        ? await api.notes.update(editingPath, input)
        : await api.notes.create(input);
      if (!note) throw new Error('保存失败，未返回笔记。');
      if (editingPath && editingPath !== note.path) {
        await api.kg.reindexNote(editingPath);
      }
      await api.kg.reindexNote(note.path);
      setSelectedPath(note.path);
      setEditingPath(note.path);
      setDraft(toDraft(note));
      setGraphVersion((version) => version + 1);
      await loadNotes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (path: string) => {
    if (!window.confirm(`将笔记 ${path} 移至回收站？可在本机撤销或恢复。`)) return;
    setError(null);
    try {
      if (!api.trash) throw new Error('可逆回收站暂不可用，未删除任何内容。');
      const moved = await api.trash.moveNote(path);
      setTrashFeedback(moved);
      if (selectedPath === path) setSelectedPath(null);
      if (editingPath === path) beginCreate();
      setGraphVersion((version) => version + 1);
      await loadNotes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const undoRemove = async () => {
    if (!trashFeedback || !api.trash) return;
    setError(null);
    try {
      await api.trash.restore({
        trashId: trashFeedback.trashId,
        revision: trashFeedback.revision,
      });
      setTrashFeedback(null);
      setGraphVersion((version) => version + 1);
      await loadNotes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const selectFromGraph = (entity: KgEntity) => {
    const path = entity.source_notes.find(Boolean);
    if (path) {
      setSelectedPath(path);
      void openEditor(path);
    }
  };

  return (
    <section className="workspace" data-testid="knowledge-workspace">
      <header className="workspace__header">
        <div>
          <h2>Knowledge</h2>
          <p>笔记、知识图谱与反向引用都保存在本机。</p>
        </div>
        <button type="button" className="primary-button" onClick={beginCreate}>
          新建笔记
        </button>
      </header>

      {error ? (
        <WorkspaceState
          kind="error"
          title="知识工作区操作失败"
          detail={error}
          action={<button onClick={() => void loadNotes()}>重试</button>}
        />
      ) : null}

      {trashFeedback ? (
        <p role="status" aria-live="polite" data-testid="knowledge-trash-feedback">
          “{trashFeedback.title}”已移至回收站。{' '}
          <button type="button" onClick={() => void undoRemove()}>撤销删除</button>
        </p>
      ) : null}

      <div className="knowledge-layout">
        <aside className="note-list" aria-label="笔记列表">
          <h3>笔记</h3>
          {loading ? <WorkspaceState kind="loading" title="正在读取本地笔记…" /> : null}
          {!loading && notes.length === 0 ? (
            <WorkspaceState kind="empty" title="还没有笔记" detail="新建第一条笔记后会自动进入知识图谱。" />
          ) : null}
          <ul>
            {notes.map((note) => (
              <li key={note.path} data-active={selectedPath === note.path ? 'true' : 'false'}>
                <button type="button" onClick={() => void openEditor(note.path)}>
                  <strong>{note.title}</strong>
                  <small>{note.path}</small>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`删除 ${note.title}`}
                  onClick={() => void remove(note.path)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="knowledge-main">
          <form className="note-editor" onSubmit={(event) => void save(event)}>
            <div className="section-heading">
              <h3>{editingPath ? '编辑笔记' : '新建笔记'}</h3>
              <span>{editingPath ?? '尚未保存'}</span>
            </div>
            <label>
              标题
              <input
                aria-label="笔记标题"
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              />
            </label>
            <label>
              路径
              <input
                aria-label="笔记路径"
                placeholder="留空将按标题生成 inbox/..."
                value={draft.path}
                onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))}
              />
            </label>
            <label>
              标签（逗号分隔）
              <input
                aria-label="笔记标签"
                value={(draft.tags ?? []).join(', ')}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean),
                }))}
              />
            </label>
            <label>
              Markdown
              <textarea
                aria-label="笔记正文"
                rows={10}
                value={draft.body}
                onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
              />
            </label>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? '保存并索引中…' : '保存并更新图谱'}
            </button>
          </form>

          <div className="graph-panel">
            <div className="section-heading">
              <h3>知识图谱 2D</h3>
              <span>点击节点打开来源笔记</span>
            </div>
            <KnowledgeGraph
              key={graphVersion}
              dataSource={graphSource}
              onNodeClick={selectFromGraph}
              width={760}
              height={420}
            />
          </div>
        </div>

        <NoteDetail
          noteId={selectedPath}
          dataSource={noteSource}
          onNavigate={(path) => void openEditor(path)}
          onClose={() => setSelectedPath(null)}
        />
      </div>
    </section>
  );
}
