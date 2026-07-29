import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import type {
  KnowledgeBuildStatusReceipt,
  RendererTrashItem,
  WikiProjectionReceipt,
  WikiTruthReceipt,
} from '../../shared/domain-api.js';
import type { GlobalAssistantContext } from '../components/Assistant/types.js';
import { NoteDetail } from '../components/NoteDetail/index.js';
import {
  createNoteDataSource,
  normalizeNote,
  normalizeNoteList,
  type CopilotNote,
  type CopilotNoteInput,
  type CopilotNoteSummary,
  type CopilotProductApi,
} from '../lib/copilot-api.js';
import { WorkspaceState } from './WorkspaceState.js';
import styles from './KnowledgeWorkspace.module.css';

interface KnowledgeWorkspaceProps {
  api: CopilotProductApi;
  requestedPath?: string | null;
  onOpenAsk?(): void;
  onAssistantContextChange?(context: GlobalAssistantContext): void;
}

interface FolderNode {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  notes: CopilotNoteSummary[];
}

function parentFolderPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments.slice(0, -1).join('/') || '根目录';
}

function collectFolderNotes(folder: FolderNode): CopilotNoteSummary[] {
  return [
    ...folder.notes,
    ...[...folder.folders.values()].flatMap(collectFolderNotes),
  ];
}

function buildFolderTree(notes: CopilotNoteSummary[]): FolderNode {
  const root: FolderNode = {
    name: '',
    path: '',
    folders: new Map(),
    notes: [],
  };
  for (const note of notes) {
    const segments = note.path.split('/').filter(Boolean);
    const folders = segments.slice(0, -1);
    let current = root;
    for (const segment of folders) {
      const path = current.path ? `${current.path}/${segment}` : segment;
      let child = current.folders.get(segment);
      if (!child) {
        child = { name: segment, path, folders: new Map(), notes: [] };
        current.folders.set(segment, child);
      }
      current = child;
    }
    current.notes.push(note);
  }
  return root;
}

function documentFormat(path: string, body = ''): 'markdown' | 'html' {
  return /\.(?:html?|xhtml)$/iu.test(path) || /^\s*(?:<!doctype\s+html|<html|<article|<section|<main|<h[1-6]\b|<p\b)/iu.test(body)
    ? 'html'
    : 'markdown';
}

interface FolderTreeProps {
  root: FolderNode;
  selectedPath: string | null;
  selectedFolderPath: string | null;
  onSelectFolder(path: string): void;
  onSelect(path: string): void;
  onRemove(path: string): void;
}

function FolderTree({
  root,
  selectedPath,
  selectedFolderPath,
  onSelectFolder,
  onSelect,
  onRemove,
}: FolderTreeProps): ReactElement {
  const renderNote = (note: CopilotNoteSummary): ReactElement => (
    <li
      key={note.path}
      role="treeitem"
      aria-label={`${note.title} ${note.path}`}
      data-active={selectedPath === note.path ? 'true' : 'false'}
      className={styles.fileNode}
    >
      <button type="button" onClick={() => onSelect(note.path)}>
        <strong>{note.title}</strong>
        <small>{note.path.split('/').at(-1) ?? note.path}</small>
      </button>
      <button
        type="button"
        className="secondary-button"
        aria-label={`删除 ${note.title}`}
        onClick={() => onRemove(note.path)}
      >
        删除
      </button>
    </li>
  );
  const renderFolder = (folder: FolderNode): ReactElement => {
    const noteCount = collectFolderNotes(folder).length;
    return (
      <li
        key={folder.path}
        role="treeitem"
        aria-label={`${folder.name} 文件夹`}
        aria-expanded="true"
        data-active={selectedFolderPath === folder.path ? 'true' : 'false'}
        className={styles.folderNode}
      >
        <button
          type="button"
          className={styles.folderLabel}
          aria-label={`${folder.name} · ${noteCount} 条笔记`}
          onClick={() => onSelectFolder(folder.path)}
        >
          <span>▾ {folder.name}</span>
          <small>{noteCount}</small>
        </button>
        <ul role="group">
          {[...folder.folders.values()]
            .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
            .map(renderFolder)}
          {folder.notes
            .slice()
            .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
            .map(renderNote)}
        </ul>
      </li>
    );
  };

  return (
    <ul className={styles.folderTree} role="tree" aria-label="知识文件夹目录">
      {[...root.folders.values()]
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
        .map(renderFolder)}
      {root.notes.map(renderNote)}
    </ul>
  );
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

const EXCERPT_MAX_LENGTH = 80;
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

interface LocalSaveReceipt {
  path: string;
  localState: 'LOCAL_SAVED';
  knowledgeBuild: KnowledgeBuildStatusReceipt;
}

function normalizeForExcerptCompare(value: string | undefined | null): string {
  return (value ?? '')
    .replace(/^#+\s*/, '')
    .replace(/[`*_~>]+/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function summarizeExcerpt(body: string | undefined | null, title?: string | null): string {
  if (!body) return '';
  const titleNormalized = normalizeForExcerptCompare(title);
  const candidate = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => {
      if (line.length === 0) return false;
      if (!titleNormalized) return true;
      return normalizeForExcerptCompare(line) !== titleNormalized;
    });
  if (!candidate) return '';
  if (candidate.length <= EXCERPT_MAX_LENGTH) return candidate;
  return `${candidate.slice(0, EXCERPT_MAX_LENGTH).trimEnd()}…`;
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

function requireLocalSaveReceipt(note: CopilotNote, expectedPath: string): LocalSaveReceipt {
  if (
    note.path !== expectedPath
    || note.localState !== 'LOCAL_SAVED'
    || !note.knowledgeBuild
  ) {
    throw new Error('本地保存凭据不完整；未把后台构建状态显示为成功。');
  }
  return {
    path: note.path,
    localState: note.localState,
    knowledgeBuild: note.knowledgeBuild,
  };
}

function digestBoundCurrentProjection(
  truth: WikiTruthReceipt | null,
  path: string | null,
): WikiProjectionReceipt | null {
  const projection = truth?.current ?? null;
  if (
    !truth
    || !path
    || truth.notePath !== path
    || truth.truth !== 'current'
    || truth.knowledgeBuild?.state !== 'ready'
    || !truth.expectedContentDigest
    || !projection
    || projection.notePath !== path
    || projection.status !== 'current'
    || projection.contentDigest !== truth.expectedContentDigest
  ) {
    return null;
  }
  return projection;
}

interface MocReturnState {
  folderPath: string | null;
  selectedPath: string | null;
  selectedTopic: string | null;
  search: string;
  scrollTop: number;
}

export function KnowledgeWorkspace({
  api,
  requestedPath,
  onAssistantContextChange,
}: KnowledgeWorkspaceProps): ReactElement {
  const browserPrototype = import.meta.env.VITE_COPILOT_BROWSER_PROTOTYPE === '1'
    || Boolean(window.__COPILOT_BROWSER_PROTOTYPE__);
  const [notes, setNotes] = useState<CopilotNoteSummary[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [documentReaderPath, setDocumentReaderPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<CopilotNoteInput>(EMPTY_DRAFT);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trashFeedback, setTrashFeedback] = useState<RendererTrashItem | null>(null);
  const [inspectorMode, setInspectorMode] = useState<'detail' | 'editor'>('detail');
  const [search, setSearch] = useState('');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [documentFormats, setDocumentFormats] = useState<Record<string, 'markdown' | 'html'>>({});
  const [wikiTruth, setWikiTruth] = useState<WikiTruthReceipt | null>(null);
  const [wikiLoading, setWikiLoading] = useState(false);
  const [wikiReadFailed, setWikiReadFailed] = useState(false);
  const [wikiPollExhausted, setWikiPollExhausted] = useState(false);
  const [wikiRefreshToken, setWikiRefreshToken] = useState(0);
  const [wikiRetrying, setWikiRetrying] = useState(false);
  const [lastCommit, setLastCommit] = useState<LocalSaveReceipt | null>(null);
  const [detailReadyPath, setDetailReadyPath] = useState<string | null>(null);
  const [folderWikiTruths, setFolderWikiTruths] = useState<Record<string, WikiTruthReceipt>>({});
  const wikiPollGenerationRef = useRef(0);
  const wikiPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wikiPollQueueRef = useRef<Promise<void>>(Promise.resolve());
  const folderTruthGenerationRef = useRef(0);
  const mocScrollRef = useRef<HTMLDivElement | null>(null);
  const mocReturnRef = useRef<MocReturnState | null>(null);

  const noteSource = useMemo(() => createNoteDataSource(api), [api]);

  useEffect(() => {
    const path = selectedPath;
    setDetailReadyPath(null);
    if (!path) return;
    let cancelled = false;
    void Promise.all([
      noteSource.getNote(path),
      noteSource.getBacklinks(path),
    ]).catch(() => undefined).finally(() => {
      window.setTimeout(() => {
        if (!cancelled) setDetailReadyPath(path);
      }, 0);
    });
    return () => {
      cancelled = true;
    };
  }, [noteSource, selectedPath]);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = normalizeNoteList(await api.notes.list());
      setNotes(result);
      setSelectedPath((current) => current ?? result[0]?.path ?? null);
      setSelectedFolderPath((current) => current ?? (
        result[0] ? parentFolderPath(result[0].path) : null
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (loading) return;
    if (notes.length === 0) {
      setDocumentFormats((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }
    let cancelled = false;
    const paths = new Set<string>();
    for (const note of notes) {
      if (note.path) paths.add(note.path);
    }
    void (async () => {
      for (const path of paths) {
        if (cancelled) break;
        try {
          const note = normalizeNote(await api.notes.get(path));
          if (cancelled) return;
          const format = documentFormat(path, note?.body ?? '');
          setDocumentFormats((current) => {
            if (current[path] === format) return current;
            return { ...current, [path]: format };
          });
        } catch {
          if (cancelled) return;
          setDocumentFormats((current) => {
            if (current[path] === undefined) return current;
            const next = { ...current };
            delete next[path];
            return next;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, loading, notes]);

  const openEditor = async (path: string) => {
    setError(null);
    try {
      const note = normalizeNote(await api.notes.get(path));
      if (!note) throw new Error('笔记不存在或已被删除。');
      setEditingPath(path);
      setDraft(toDraft(note));
      setSelectedPath(path);
      setInspectorMode('editor');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    if (requestedPath) {
      setSelectedPath(requestedPath);
      setSelectedFolderPath(parentFolderPath(requestedPath));
      setSelectedTopic(null);
      setDocumentReaderPath(null);
      setInspectorMode('detail');
    }
  }, [requestedPath]);

  const cancelWikiPoll = useCallback(() => {
    wikiPollGenerationRef.current += 1;
    if (wikiPollTimerRef.current) {
      clearTimeout(wikiPollTimerRef.current);
      wikiPollTimerRef.current = null;
    }
  }, []);

  const startWikiPoll = useCallback((path: string) => {
    cancelWikiPoll();
    const generation = wikiPollGenerationRef.current;
    setWikiTruth(null);
    setWikiLoading(true);
    setWikiReadFailed(false);
    setWikiPollExhausted(false);

    if (!api.wiki) {
      setWikiLoading(false);
      setWikiReadFailed(true);
      return;
    }

    const runAttempt = (attempt: number) => {
      wikiPollQueueRef.current = wikiPollQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (generation !== wikiPollGenerationRef.current) return;
          try {
            const result = await api.wiki!.getForNote(path);
            if (
              generation !== wikiPollGenerationRef.current
              || result.notePath !== path
            ) {
              if (generation === wikiPollGenerationRef.current) {
                setWikiTruth(null);
                setWikiReadFailed(true);
                setWikiLoading(false);
              }
              return;
            }
            setWikiTruth(result);
            setWikiReadFailed(false);
            const pending = result.knowledgeBuild?.state === 'queued'
              || result.knowledgeBuild?.state === 'running';
            const nextDelayMs = WIKI_POLL_DELAYS_MS[attempt];
            if (pending && nextDelayMs !== undefined) {
              wikiPollTimerRef.current = setTimeout(() => {
                wikiPollTimerRef.current = null;
                runAttempt(attempt + 1);
              }, nextDelayMs);
              return;
            }
            setWikiPollExhausted(pending);
            setWikiLoading(false);
          } catch {
            if (generation !== wikiPollGenerationRef.current) return;
            setWikiTruth(null);
            setWikiReadFailed(true);
            setWikiPollExhausted(false);
            setWikiLoading(false);
          }
        });
    };

    runAttempt(0);
  }, [api, cancelWikiPoll]);

  useEffect(() => {
    if (!selectedPath) {
      cancelWikiPoll();
      setWikiTruth(null);
      setWikiLoading(false);
      setWikiReadFailed(false);
      setWikiPollExhausted(false);
      return;
    }
    startWikiPoll(selectedPath);
    return cancelWikiPoll;
  }, [
    cancelWikiPoll,
    selectedPath,
    startWikiPoll,
    wikiRefreshToken,
  ]);

  const beginCreate = () => {
    setDocumentReaderPath(null);
    setEditingPath(null);
    setDraft(EMPTY_DRAFT);
    setInspectorMode('editor');
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
    folderTruthGenerationRef.current += 1;
    setFolderWikiTruths({});
    setSaving(true);
    setError(null);
    try {
      const note = editingPath
        ? await api.notes.update(editingPath, input)
        : await api.notes.create(input);
      if (!note) throw new Error('保存失败，未返回本地提交凭据。');
      const expectedPath = editingPath ?? input.path;
      const receipt = requireLocalSaveReceipt(note, expectedPath);
      setLastCommit(receipt);
      setWikiTruth(null);
      setWikiReadFailed(false);
      setWikiPollExhausted(false);
      setSelectedPath(note.path);
      setSelectedFolderPath(parentFolderPath(note.path));
      setDocumentReaderPath(null);
      setEditingPath(note.path);
      setDraft(toDraft(note));
      setInspectorMode('detail');
      setWikiRefreshToken((token) => token + 1);
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
      if (documentReaderPath === path) setDocumentReaderPath(null);
      if (editingPath === path) beginCreate();
      folderTruthGenerationRef.current += 1;
      setFolderWikiTruths({});
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
      folderTruthGenerationRef.current += 1;
      setFolderWikiTruths({});
      await loadNotes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const filteredNotes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter((note) => `${note.title} ${note.path} ${(note.tags ?? []).join(' ')}`.toLowerCase().includes(needle));
  }, [notes, search]);
  const folderTree = useMemo(() => buildFolderTree(filteredNotes), [filteredNotes]);
  const folderScopeNotes = useMemo(() => {
    if (!selectedFolderPath) return filteredNotes;
    if (selectedFolderPath === '根目录') {
      return filteredNotes.filter((note) => !note.path.includes('/'));
    }
    const prefix = `${selectedFolderPath}/`;
    return filteredNotes.filter((note) => note.path.startsWith(prefix));
  }, [filteredNotes, selectedFolderPath]);
  const mocScopeNotes = folderScopeNotes;
  const mocGroups = useMemo(() => {
    const groups = new Map<string, CopilotNoteSummary[]>();
    for (const note of mocScopeNotes) {
      const pathSegments = note.path.split('/').filter(Boolean);
      const parentPath = pathSegments.slice(0, -1).join('/') || '根目录';
      const label = note.tags?.[0]?.trim() || parentPath;
      groups.set(label, [...(groups.get(label) ?? []), note]);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'zh-CN'));
  }, [mocScopeNotes]);
  useEffect(() => {
    const generation = folderTruthGenerationRef.current + 1;
    folderTruthGenerationRef.current = generation;
    setFolderWikiTruths({});
    if (!api.wiki || folderScopeNotes.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.all(folderScopeNotes.map(async (note) => {
      try {
        return [note.path, await api.wiki!.getForNote(note.path)] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (cancelled || generation !== folderTruthGenerationRef.current) return;
      setFolderWikiTruths(Object.fromEntries(
        entries.filter((entry): entry is readonly [string, WikiTruthReceipt] => entry !== null),
      ));
    });
    return () => {
      cancelled = true;
    };
  }, [api, folderScopeNotes, wikiRefreshToken]);
  const folderCurrentProjections = useMemo(() => new Map(
    folderScopeNotes.flatMap((note) => {
      const projection = digestBoundCurrentProjection(folderWikiTruths[note.path] ?? null, note.path);
      return projection ? [[note.path, projection] as const] : [];
    }),
  ), [folderScopeNotes, folderWikiTruths]);
  const folderAllCurrent = folderScopeNotes.length > 0
    && folderCurrentProjections.size === folderScopeNotes.length;
  const folderTruthLabel = browserPrototype
    ? '按更新时间/标签分组 · PROTOTYPE_DERIVED'
    : folderAllCurrent
      ? 'NOTE_CURRENT_ONLY · FOLDER_NOT_CURRENT'
      : folderCurrentProjections.size > 0
        ? 'PARTIAL_NOT_CURRENT'
        : 'NOT_READY';
  const folderRecentNotes = useMemo(() => folderScopeNotes
    .slice()
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)), [folderScopeNotes]);
  const mocRecentNotes = folderRecentNotes;
  const selectedWikiTruth = wikiTruth?.notePath === selectedPath ? wikiTruth : null;
  const visibleWikiProjection = digestBoundCurrentProjection(selectedWikiTruth, selectedPath);
  const rawDocumentSource = useMemo(() => ({
    getNote: (path: string) => noteSource.getNote(path),
    getBacklinks: (path: string) => noteSource.getBacklinks(path),
  }), [noteSource]);
  const commitBuildState = lastCommit?.path === selectedPath
    ? lastCommit.knowledgeBuild.state
    : null;
  const wikiBuildState = selectedWikiTruth?.knowledgeBuild?.state ?? commitBuildState;
  const failClosedWikiTruthState = selectedWikiTruth?.truth === 'current'
    ? 'not-ready'
    : selectedWikiTruth?.truth ?? 'not-ready';
  const wikiUiState = !selectedPath
    ? 'not-ready'
    : wikiReadFailed
      ? 'query-failed'
      : wikiBuildState === 'queued' || wikiBuildState === 'running'
        ? wikiBuildState
        : wikiBuildState === 'failed' || wikiBuildState === 'not-ready'
          ? wikiBuildState
          : visibleWikiProjection
            ? 'current'
            : failClosedWikiTruthState;
  const wikiChip = !selectedPath
    ? 'NOT_READY'
    : wikiReadFailed
      ? 'QUERY_FAILED'
      : wikiBuildState === 'queued' || wikiBuildState === 'running'
        ? wikiBuildState.toUpperCase()
        : wikiBuildState === 'failed' || wikiBuildState === 'not-ready'
          ? wikiBuildState.toUpperCase()
          : wikiLoading
            ? 'CHECKING'
            : visibleWikiProjection
              ? 'CURRENT'
              : selectedWikiTruth?.truth === 'current'
                ? 'NOT_READY'
                : (selectedWikiTruth ? selectedWikiTruth.truth.toUpperCase() : 'MISSING');
  const wikiChipClass = visibleWikiProjection
    ? styles.wikiTruthCurrent
    : selectedWikiTruth?.truth === 'stale'
      ? styles.wikiTruthStale
      : selectedWikiTruth?.truth === 'failed' || wikiBuildState === 'failed'
        ? styles.wikiTruthFailed
        : styles.wikiTruthMissing;
  const wikiEmptyValue = wikiBuildState === 'queued'
    ? 'QUEUED'
    : wikiBuildState === 'running'
      ? 'RUNNING'
      : wikiReadFailed
        ? 'QUERY_FAILED'
        : selectedWikiTruth?.truth === 'failed' || wikiBuildState === 'failed'
    ? 'FAILED'
    : selectedWikiTruth?.truth === 'stale'
      ? 'STALE'
    : selectedWikiTruth?.truth === 'missing'
      ? 'NO_PROJECTION'
      : 'NOT_READY';
  const visibleWikiProvenance = visibleWikiProjection?.provenance ?? null;
  const wikiRetryAvailable = wikiReadFailed
    || wikiPollExhausted
    || wikiBuildState === 'failed'
    || wikiBuildState === 'not-ready'
    || selectedWikiTruth?.truth === 'failed';
  const detailPreviewReady = Boolean(visibleWikiProjection);
  const selectedNoteSummary = notes.find((note) => note.path === selectedPath) ?? null;

  const selectFolder = (path: string) => {
    setSelectedFolderPath(path);
    setSelectedTopic(null);
    setDocumentReaderPath(null);
    setSelectedPath(null);
    setInspectorMode('detail');
  };

  const openOrganizedDocument = async (path: string) => {
    if (!documentReaderPath) {
      mocReturnRef.current = {
        folderPath: selectedFolderPath,
        selectedPath,
        selectedTopic,
        search,
        scrollTop: mocScrollRef.current?.scrollTop ?? 0,
      };
    }
    setSelectedPath(path);
    setSelectedFolderPath(parentFolderPath(path));
    setInspectorMode('detail');
    setDocumentReaderPath(path);
    setWikiReadFailed(false);
    setError(null);
    if (!api.wiki) return;
    try {
      const truth = await api.wiki.getForNote(path);
      setWikiTruth(truth);
    } catch (cause) {
      setWikiReadFailed(true);
    }
  };

  const returnToMoc = () => {
    const restore = mocReturnRef.current;
    setDocumentReaderPath(null);
    if (!restore) return;
    setSelectedFolderPath(restore.folderPath);
    setSelectedPath(restore.selectedPath);
    setSelectedTopic(restore.selectedTopic);
    setSearch(restore.search);
    window.setTimeout(() => {
      if (mocScrollRef.current) mocScrollRef.current.scrollTop = restore.scrollTop;
    }, 0);
  };

  const retryWiki = async () => {
    const path = selectedPath;
    if (!path || wikiRetrying) return;
    setWikiRetrying(true);
    setError(null);
    try {
      if (!api.wiki) throw new Error('WIKI 查询 IPC 尚未就绪。');
      if (
        !wikiReadFailed
        && (
          wikiBuildState === 'failed'
          || wikiBuildState === 'not-ready'
          || selectedWikiTruth?.truth === 'failed'
        )
      ) {
        const current = normalizeNote(await api.notes.get(path));
        if (!current || current.path !== path) {
          throw new Error('当前路径笔记不存在，未执行后台重试。');
        }
        const saved = await api.notes.update(path, toDraft(current));
        if (!saved) throw new Error('后台重试未返回本地提交凭据。');
        setLastCommit(requireLocalSaveReceipt(saved, path));
      }
      setWikiRefreshToken((token) => token + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWikiRetrying(false);
    }
  };

  useEffect(() => {
    if (!onAssistantContextChange) return;
    const sourceReady = Boolean(visibleWikiProjection && selectedPath);
    const assistantWikiTruth: NonNullable<GlobalAssistantContext['wikiTruth']> =
      visibleWikiProjection
        ? 'CURRENT'
        : wikiReadFailed
          || selectedWikiTruth?.truth === 'failed'
          || wikiBuildState === 'failed'
          ? 'FAILED'
          : selectedWikiTruth?.truth === 'stale'
            ? 'STALE'
            : selectedWikiTruth?.truth === 'missing'
              ? 'MISSING'
              : selectedPath
                ? 'NOT_READY'
                : 'MISSING';
    const location = documentReaderPath
      ? `文档 ${documentReaderPath}`
      : `MOC ${selectedFolderPath ?? '根目录'}`;
    onAssistantContextChange({
      route: 'knowledge',
      subtitle: `知识 · ${location} · WIKI ${assistantWikiTruth}`,
      truth: browserPrototype
        ? 'NOT_PROBED'
        : sourceReady
          ? 'READY'
          : assistantWikiTruth === 'STALE'
            ? 'STALE'
            : assistantWikiTruth === 'FAILED'
              ? 'ERROR'
              : 'NO_SOURCE',
      sourceCount: sourceReady ? 1 : 0,
      folderPath: selectedFolderPath ?? '根目录',
      documentPath: selectedPath,
      wikiTruth: assistantWikiTruth,
    });
  }, [
    browserPrototype,
    documentReaderPath,
    onAssistantContextChange,
    selectedFolderPath,
    selectedPath,
    selectedWikiTruth?.truth,
    visibleWikiProjection,
    wikiBuildState,
    wikiReadFailed,
  ]);

  return (
    <section
      className="workspace knowledge-workspace"
      data-testid="knowledge-workspace"
      data-assistant-avoid="critical"
    >
      <header className="workspace__header workspace-header">
        <div>
          <h2>知识</h2>
          <p>{browserPrototype
            ? 'PROTOTYPE fixture：验收 2D MOC 阅读与整理后预览；不是本地知识库运行凭据。'
            : '从真实本地路径浏览文件夹与 2D MOC；整理后内容仅在 WIKI current 后显示。'}</p>
        </div>
        <div className={styles.layoutActions}>
          <button
            type="button"
            aria-expanded={!railCollapsed}
            onClick={() => setRailCollapsed((current) => !current)}
          >
            {railCollapsed ? '展开知识目录' : '收起知识目录'}
          </button>
          <button
            type="button"
            aria-expanded={!inspectorCollapsed}
            onClick={() => setInspectorCollapsed((current) => !current)}
          >
            {inspectorCollapsed ? '展开整理预览' : '收起整理预览'}
          </button>
          <button type="button" className="primary-button" onClick={beginCreate}>
            新建笔记
          </button>
        </div>
      </header>

      <div
        className={[
          styles.knowledgeBody,
          documentReaderPath ? styles.readerMode : '',
          railCollapsed ? styles.railCollapsed : '',
          inspectorCollapsed ? styles.inspectorCollapsed : '',
          'knowledge-grid',
        ].filter(Boolean).join(' ')}
        data-reader-layout={documentReaderPath ? 'full-span' : 'moc-three-column'}
      >
      <aside
        className={`note-list ${styles.mocRail} moc-nav`}
        role="navigation"
        aria-label="知识地图"
        hidden={railCollapsed || Boolean(documentReaderPath)}
        aria-hidden={railCollapsed || Boolean(documentReaderPath)}
        style={documentReaderPath ? { display: 'none' } : undefined}
      >
        <div className={styles.mapHeader}>
          <strong>知识地图</strong>
          <span>本地文件夹投影</span>
        </div>
        <label className={`${styles.searchLabel} moc-search`}>搜索本地知识<input aria-label="搜索本地知识" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        {loading ? <WorkspaceState kind="loading" title="正在读取本地笔记…" /> : null}
        {!loading && notes.length === 0 ? (
          <WorkspaceState
            kind="empty"
            title="还没有笔记"
            detail={browserPrototype
              ? '这是 PROTOTYPE empty fixture；不是本地知识库空状态。'
              : '先从今天快速记录，或新建第一条笔记。'}
          />
        ) : null}
        <FolderTree
          root={folderTree}
          selectedPath={selectedPath}
          selectedFolderPath={selectedFolderPath}
          onSelectFolder={selectFolder}
          onSelect={(path) => {
            setSelectedPath(path);
            setSelectedFolderPath(parentFolderPath(path));
            setDocumentReaderPath(null);
            setInspectorMode('detail');
          }}
          onRemove={(path) => void remove(path)}
        />
      </aside>

      <main className={`${styles.reader} moc-main`}>
        {documentReaderPath ? (
          <section
            className={styles.documentReader}
            data-testid="knowledge-document-reader"
            data-document-path={documentReaderPath}
            data-wiki-state={wikiUiState}
            data-assistant-avoid="critical"
          >
            <header className={styles.documentReaderHeader}>
              <button
                type="button"
                onClick={returnToMoc}
              >
                ← 返回 {selectedFolderPath ?? '本地'} MOC
              </button>
              <div>
                <span>
                  {visibleWikiProjection
                    ? '完整原文 · WIKI CURRENT 已核验'
                    : '完整原始文档'}
                </span>
                <strong className={wikiChipClass}>
                  WIKI {wikiChip.replaceAll('-', '_')}
                </strong>
                <small>{documentReaderPath}</small>
              </div>
              <button type="button" onClick={() => void openEditor(documentReaderPath)}>
                查看 / 编辑原始笔记
              </button>
            </header>
            <NoteDetail
              noteId={documentReaderPath}
              dataSource={rawDocumentSource}
              presentation="page"
              onNavigate={(path) => void openOrganizedDocument(path)}
              onClose={returnToMoc}
            />
          </section>
        ) : (
        <>
        <div className={`${styles.breadcrumb} breadcrumb`}>知识 / 本地 MOC / {selectedPath ?? '概览'}</div>
        <div className={`${styles.viewTabs} view-tabs`} role="tablist" aria-label="知识视图">
          <button type="button" role="tab" aria-selected="true" className="view-tab active">
            2D MOC 阅读
          </button>
          <span className={styles.postMvpGraph} aria-disabled="true">
            3D 节点可视化知识图谱 · MVP 后
          </span>
        </div>

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

          <div
            ref={mocScrollRef}
            className={`${styles.mocReader} moc-section`}
            data-testid="knowledge-moc-reader"
          >
            <div
              className={styles.folderMoc}
              data-testid="knowledge-folder-moc"
              data-folder-path={selectedFolderPath ?? '根目录'}
            >
            <section className={`${styles.mocHero} moc-hero`}>
              <div>
                <h3>{selectedFolderPath ?? '根目录'} 知识 MOC</h3>
                <p data-testid="folder-wiki-overview">
                  {folderAllCurrent
                    ? `此知识空间包含 ${mocScopeNotes.length} 条本地笔记；当前可按主题、阅读路径和最近变化浏览。`
                    : '原始目录仍可浏览；文件夹 WIKI 尚未达到可用状态，不生成假主题或假摘要。'}
                </p>
                <ul className={styles.mocHeroMeta} aria-label="MOC 真实计数">
                  <li><strong data-testid="moc-total-count">{mocScopeNotes.length}</strong><span>条当前文件夹笔记</span></li>
                  <li><strong data-testid="moc-group-count">{mocGroups.length}</strong><span>个真实分组</span></li>
                  <li><strong data-testid="moc-selected-count">{folderCurrentProjections.size}</strong><span>条 current 阅读候选</span></li>
                </ul>
              </div>
              <div className={`${styles.mocHeroTruth} moc-meta`}>
                <span
                  className="truth-chip truth-chip--unknown"
                  data-testid="folder-wiki-truth"
                >
                  {folderTruthLabel}
                </span>
                <p>
                  {browserPrototype
                    ? 'Browser fixture 仅验证文件夹 MOC 交互，不代表文件夹 runtime 已完成。'
                    : '当前只使用真实本地结构；folder receipt 未完成前不得显示为 CURRENT。'}
                </p>
                <span id="moc-truth-chip" data-testid="moc-truth-chip" hidden>
                  {browserPrototype ? 'PROTOTYPE_DERIVED' : 'LOCAL_DERIVED'}
                </span>
                <p data-testid="moc-wiki-not-current">
                  {folderAllCurrent
                    ? '笔记级 WIKI 均为 current；文件夹级 projection 仍是 P1 runtime gap。'
                    : 'WIKI 生成字段未达到文件夹级 current，保持隐藏。'}
                </p>
              </div>
            </section>
            <section className={styles.wikiValue} data-testid="folder-wiki-value">
              <strong>WIKI 如何帮助整理这个知识空间</strong>
              <p>
                WIKI 将当前文件夹/工作区的本地资料整理为总览、阅读路径、主题分类、最近变化和可核对来源；
                帮助你先理解主题再阅读原文，不替代原始文档，也不改变本地数据真值。
              </p>
            </section>
            {mocGroups.length === 0 && !loading ? (
              <WorkspaceState
                kind="empty"
                title={notes.length === 0 ? '本地 MOC 暂无笔记' : '当前筛选下没有可阅读的笔记'}
                detail={notes.length === 0
                  ? '先从今天快速记录，或新建第一条本地笔记；这里将按真实标签与路径组织。'
                  : '调整搜索词或清空筛选条件以查看全部真实笔记。'}
                action={notes.length === 0 ? (
                  <button type="button" className="primary-button" onClick={beginCreate}>新建第一条本地笔记</button>
                ) : (
                  <button type="button" onClick={() => setSearch('')}>清空搜索</button>
                )}
              />
            ) : null}
            <section
              className={`${styles.readingPath} moc-path`}
              aria-label="建议阅读路径"
              data-testid="folder-reading-path"
            >
              {mocRecentNotes.slice(0, 4).map((note, index) => (
                <button
                  key={note.path}
                  type="button"
                  className="path-step"
                  data-testid={`moc-reading-step-${index}`}
                  onClick={() => void openOrganizedDocument(note.path)}
                >
                  <span>{index + 1}</span>
                  <strong>{note.title}</strong>
                  <small>{folderCurrentProjections.has(note.path) ? '整理后可阅读' : '待 WIKI 整理'}</small>
                </button>
              ))}
            </section>
            <section
              className={`${styles.topicGrid} moc-cards`}
              aria-label="核心主题"
              data-testid="folder-topics"
            >
              {mocGroups.map(([label, items], groupIndex) => (
                <article
                  key={label}
                  className="moc-card"
                  data-testid={`moc-topic-${label}`}
                  data-selected={selectedTopic === label ? 'true' : 'false'}
                >
                  <h4>
                    <button
                      type="button"
                      aria-label={`选择主题 ${label}`}
                      aria-controls={`moc-topic-documents-${groupIndex}`}
                      aria-expanded={selectedTopic === null || selectedTopic === label}
                      onClick={() => setSelectedTopic(label)}
                    >
                      {label}
                    </button>
                  </h4>
                  <p>{items.length} 条真实本地笔记</p>
                  <div
                    id={`moc-topic-documents-${groupIndex}`}
                    className={styles.topicDocuments}
                    hidden={selectedTopic !== null && selectedTopic !== label}
                  >
                  {items.slice(0, 3).map((note) => (
                    <div
                      key={note.path}
                      className={styles.topicNote}
                      data-document-format={documentFormats[note.path] ?? 'markdown'}
                    >
                      <button
                        type="button"
                        data-testid={`moc-topic-note-${note.path}`}
                        onClick={() => void openOrganizedDocument(note.path)}
                      >
                        {note.title}
                      </button>
                      <small className={styles.topicPath}>
                        <span className={styles.documentFormat}>
                          {documentFormats[note.path] === 'html' ? 'HTML' : 'Markdown'}
                        </span>
                        {note.path}
                      </small>
                      {folderCurrentProjections.get(note.path)?.summary ? (
                        <p className={styles.topicExcerpt} data-testid={`moc-topic-excerpt-${note.path}`}>
                          {summarizeExcerpt(
                            folderCurrentProjections.get(note.path)?.summary ?? '',
                            note.title,
                          )}
                        </p>
                      ) : (
                        <p className={styles.topicExcerptEmpty} data-testid={`moc-topic-excerpt-empty-${note.path}`}>
                          选择文档后，仅在 WIKI CURRENT 时显示整理后预览。
                        </p>
                      )}
                      {(note.tags ?? []).length > 0 ? (
                        <ul className={styles.topicTags} aria-label={`${note.title} 的标签`}>
                          {note.tags!.map((tag) => (
                            <li key={tag}>#{tag}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                  </div>
                </article>
              ))}
            </section>
            <section
              className={styles.recentChanges}
              data-testid="folder-recent-changes"
              aria-labelledby="folder-recent-title"
            >
              <header>
                <div>
                  <h4 id="folder-recent-title">最近进入此 MOC</h4>
                  <p>按真实本地更新时间排列；不是模型生成时间线。</p>
                </div>
                <span>{mocRecentNotes.length} 条</span>
              </header>
              <ol>
                {mocRecentNotes.slice(0, 6).map((note) => (
                  <li key={note.path}>
                    <button type="button" onClick={() => void openOrganizedDocument(note.path)}>
                      <strong>{note.title}</strong>
                      <small>
                        {note.updatedAt
                          ? new Date(note.updatedAt).toLocaleString('zh-CN')
                          : '更新时间未知'}
                      </small>
                    </button>
                    <span data-current={folderCurrentProjections.has(note.path) ? 'true' : 'false'}>
                      {folderCurrentProjections.has(note.path) ? '可阅读' : '待整理'}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <details className={styles.folderSources} data-testid="folder-wiki-sources">
              <summary>来源与整理状态 · {folderScopeNotes.length} 条本地笔记</summary>
              <ul>
                {folderScopeNotes.map((note) => (
                  <li key={note.path}>
                    <code>{note.path}</code>
                    <span>{folderCurrentProjections.has(note.path) ? 'NOTE_CURRENT' : 'NOT_READY'}</span>
                  </li>
                ))}
              </ul>
            </details>
            </div>
          </div>
        </>
        )}
      </main>

      <aside
        className={`${styles.inspector} knowledge-inspector`}
        aria-label="笔记详情"
        hidden={inspectorCollapsed || Boolean(documentReaderPath)}
        aria-hidden={inspectorCollapsed || Boolean(documentReaderPath)}
        style={documentReaderPath ? { display: 'none' } : undefined}
      >
        <div className={styles.inspectorHeader}>
          <div className={styles.inspectorTitle}>
            <strong>
              {inspectorMode === 'editor'
                ? (editingPath ? '编辑笔记' : '新建笔记')
                : '当前文档摘要'}
            </strong>
            {inspectorMode === 'detail' ? <span>来自文件夹 WIKI</span> : null}
          </div>
          {selectedPath && inspectorMode === 'detail' ? <button type="button" onClick={() => void openEditor(selectedPath)}>编辑原始笔记</button> : null}
        </div>
        {inspectorMode === 'editor' ? (
          <form className={`note-editor ${styles.noteEditor}`} onSubmit={(event) => void save(event)}>
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
              {saving ? '本地保存中…' : '保存到本地'}
            </button>
          </form>
        ) : null}
        {inspectorMode === 'detail' && selectedPath && detailPreviewReady && detailReadyPath !== selectedPath ? (
          <WorkspaceState kind="loading" title="正在打开所选笔记…" />
        ) : null}
        {selectedPath && detailPreviewReady ? (
          <section
            className={styles.compactPreview}
            hidden={inspectorMode !== 'detail' || detailReadyPath !== selectedPath}
            aria-hidden={inspectorMode !== 'detail' || detailReadyPath !== selectedPath}
            data-testid="wiki-organized-preview-current"
            data-wiki-state="current"
          >
            <>
            <span className={styles.wikiTruthCurrent}>WIKI CURRENT</span>
            <h3 data-testid="knowledge-note-compact-title">
              {selectedNoteSummary?.title ?? selectedPath}
            </h3>
            <code>{selectedPath}</code>
            <p>{visibleWikiProjection?.summary ?? '整理后摘要为空。'}</p>
            <div className={styles.compactPreviewActions}>
              <button
                type="button"
                className="primary-button"
                onClick={() => void openOrganizedDocument(selectedPath)}
              >
                全页阅读
              </button>
              <button type="button" onClick={() => void openEditor(selectedPath)}>
                查看 / 编辑原始笔记
              </button>
            </div>
            </>
          </section>
        ) : selectedPath && inspectorMode === 'detail' ? (
          <div
            className={styles.organizedPreviewGate}
            data-testid="wiki-organized-preview-gated"
            data-wiki-state={wikiUiState}
          >
            <strong>整理后内容尚不可预览</strong>
            <p>
              原始笔记已保留；只有 digest-bound WIKI 达到 CURRENT 后，才显示整理后的文档内容。
            </p>
            <span>{wikiChip}</span>
            <button
              type="button"
              onClick={() => void openOrganizedDocument(selectedPath)}
            >
              阅读原始文档
            </button>
          </div>
        ) : inspectorMode === 'detail' ? (
          <WorkspaceState
            kind="unknown"
            title="尚未选择笔记"
            detail="从左侧文件夹目录或中栏 MOC 分类选择一条本地笔记；整理后预览将在 WIKI current 后显示。"
          />
        ) : null}
        <details className={styles.wikiTruth} data-testid="wiki-truth-details">
          <summary>
            <strong>整理状态与生成详情</strong>
            <span className={`${styles.wikiTruthChip} ${wikiChipClass}`} data-testid="wiki-truth-chip">
              {wikiChip}
            </span>
          </summary>
          <section
            className={styles.wikiTruthBody}
            data-testid="wiki-truth-block"
            data-wiki-state={wikiUiState}
          >
          {lastCommit?.path === selectedPath ? (
            <p className={styles.commitReceipt} data-testid="knowledge-save-receipt">
              <strong>{lastCommit.localState}</strong>
              <span data-build-state={lastCommit.knowledgeBuild.state}>
                {lastCommit.knowledgeBuild.state.toUpperCase()}
              </span>
              <code data-testid="knowledge-save-path">{lastCommit.path}</code>
            </p>
          ) : null}
          <p>
            {visibleWikiProjection
              ? '投影摘要与当前本地笔记内容摘要一致。'
              : wikiBuildState === 'queued'
                ? '本地笔记已保存；WIKI 后台任务正在排队。'
                : wikiBuildState === 'running'
                  ? '本地笔记已保存；WIKI 正在后台构建。'
              : selectedWikiTruth?.truth === 'stale'
                ? '当前笔记内容已变化；旧投影字段已隐藏。'
                : selectedWikiTruth?.truth === 'failed'
                  ? '当前内容的投影构建失败；本地笔记仍已保存。'
                  : selectedWikiTruth?.truth === 'missing'
                    ? '当前本地笔记尚无投影。'
                    : '摘要、标签、实体与关系在确认并写入本地前不会显示为已完成。'}
          </p>
          <ul className={styles.wikiTruthList} aria-label="WIKI 真值字段">
            <li><span>摘要</span><strong data-testid="wiki-truth-summary">{visibleWikiProjection?.summary ?? wikiEmptyValue}</strong></li>
            <li><span>标签</span><strong data-testid="wiki-truth-tags">{visibleWikiProjection?.tags.join('、') || wikiEmptyValue}</strong></li>
            <li><span>实体</span><strong data-testid="wiki-truth-entities">{visibleWikiProjection?.entityIds.join('、') || wikiEmptyValue}</strong></li>
            <li><span>关系</span><strong data-testid="wiki-truth-relations">{visibleWikiProjection?.relationSignatures.join('、') || wikiEmptyValue}</strong></li>
          </ul>
          {selectedWikiTruth?.expectedContentDigest ? (
            <p className={styles.wikiDiagnostic} data-testid="wiki-truth-digest">
              <span>内容摘要</span><code>{selectedWikiTruth.expectedContentDigest}</code>
            </p>
          ) : null}
          {visibleWikiProvenance ? (
            <p className={styles.wikiDiagnostic} data-testid="wiki-truth-provenance">
              <span>来源</span>
              <code>{visibleWikiProvenance.provider} / {visibleWikiProvenance.model} / {visibleWikiProvenance.generatedAt}</code>
            </p>
          ) : null}
          {selectedWikiTruth?.truth === 'failed' ? (
            <p className={styles.wikiFailure} data-testid="wiki-truth-failure">
              {selectedWikiTruth.projection?.failureStage ?? 'provider'} / {selectedWikiTruth.projection?.failureReason ?? 'WIKI_BUILD_FAILED'}
            </p>
          ) : null}
          {wikiPollExhausted ? (
            <p className={styles.wikiFailure} data-testid="wiki-poll-exhausted">
              有界检查已停止；后台状态仍为 {wikiBuildState?.toUpperCase()}。
            </p>
          ) : null}
          {wikiRetryAvailable ? (
            <button
              type="button"
              data-testid="wiki-retry-exact-path"
              disabled={wikiRetrying}
              onClick={() => void retryWiki()}
            >
              {wikiRetrying ? '重试中…' : '重试当前路径 WIKI'}
            </button>
          ) : null}
          </section>
        </details>
      </aside>
      </div>

    </section>
  );
}
