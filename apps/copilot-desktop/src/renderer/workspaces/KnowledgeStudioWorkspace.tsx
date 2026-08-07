import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import type { WikiTruthReceipt } from '../../shared/domain-api.js';
import { KnowledgeGraph } from '../components/KnowledgeGraph/index.js';
import {
  createKgDataSource,
  normalizeNote,
  normalizeNoteList,
  type CopilotNote,
  type CopilotNoteSummary,
  type CopilotProductApi,
} from '../lib/copilot-api.js';
import { WorkspaceState } from './WorkspaceState.js';
import {
  buildKnowledgeReviewItems,
  knowledgeReviewState,
  scoreKnowledgeConnections,
  summarizeKnowledgeActivity,
  type KnowledgeReviewDecision,
  type KnowledgeReviewDecisionMap,
} from './knowledge-studio-model.js';
import styles from './KnowledgeStudioWorkspace.module.css';

const REVIEW_STORAGE_KEY = 'copilot.wiki-studio.review-decisions.v1';
const MAX_TRUTH_PROBES = 200;
const TRUTH_BATCH_SIZE = 8;

type StudioMode = 'wiki' | 'review' | 'graph';

interface KnowledgeStudioWorkspaceProps {
  api: CopilotProductApi;
  onOpenKnowledge?(path?: string): void;
  onOpenAsk?(): void;
}

function readReviewDecisions(): KnowledgeReviewDecisionMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(REVIEW_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: KnowledgeReviewDecisionMap = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const decision = (value as { decision?: unknown }).decision;
      const decidedAt = (value as { decidedAt?: unknown }).decidedAt;
      if (
        (decision !== 'accepted' && decision !== 'deferred')
        || typeof decidedAt !== 'number'
        || !Number.isFinite(decidedAt)
      ) continue;
      out[id] = { decision, decidedAt };
    }
    return out;
  } catch {
    return {};
  }
}

function storeReviewDecisions(decisions: KnowledgeReviewDecisionMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(decisions));
  } catch {
    // Review metadata is non-authoritative. Local knowledge truth is unaffected.
  }
}

async function loadTruths(
  api: CopilotProductApi,
  notes: readonly CopilotNoteSummary[],
): Promise<Record<string, WikiTruthReceipt>> {
  if (!api.wiki) return {};
  const selected = notes.slice(0, MAX_TRUTH_PROBES);
  const output: Record<string, WikiTruthReceipt> = {};
  for (let start = 0; start < selected.length; start += TRUTH_BATCH_SIZE) {
    const batch = selected.slice(start, start + TRUTH_BATCH_SIZE);
    const results = await Promise.all(batch.map(async (note) => {
      try {
        return [note.path, await api.wiki!.getForNote(note.path)] as const;
      } catch {
        return null;
      }
    }));
    for (const result of results) {
      if (result) output[result[0]] = result[1];
    }
  }
  return output;
}

function stateLabel(state: ReturnType<typeof knowledgeReviewState>): string {
  switch (state) {
    case 'current': return 'CURRENT';
    case 'queued': return 'QUEUED';
    case 'running': return 'RUNNING';
    case 'stale': return 'STALE';
    case 'failed': return 'FAILED';
    case 'missing': return 'MISSING';
    case 'not-ready': return 'NOT_READY';
  }
}

function decisionLabel(decision: KnowledgeReviewDecision | undefined): string {
  if (decision === 'accepted') return '已确认';
  if (decision === 'deferred') return '稍后处理';
  return '待审核';
}

function displayTime(value: number | null | undefined): string {
  if (!value) return '时间未记录';
  try {
    return new Date(value).toLocaleString('zh-CN');
  } catch {
    return '时间未记录';
  }
}

export function KnowledgeStudioWorkspace({
  api,
  onOpenKnowledge,
  onOpenAsk,
}: KnowledgeStudioWorkspaceProps): ReactElement {
  const [notes, setNotes] = useState<CopilotNoteSummary[]>([]);
  const [truths, setTruths] = useState<Record<string, WikiTruthReceipt>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<CopilotNote | null>(null);
  const [mode, setMode] = useState<StudioMode>('wiki');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<Awaited<ReturnType<typeof api.kg.getSubgraph>> | null>(null);
  const [decisions, setDecisions] = useState<KnowledgeReviewDecisionMap>(() => readReviewDecisions());
  const [retryingPath, setRetryingPath] = useState<string | null>(null);

  const loadStudio = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const noteList = normalizeNoteList(await api.notes.list());
      const [nextTruths, nextGraph] = await Promise.all([
        loadTruths(api, noteList),
        api.kg.getSubgraph(180).catch(() => ({ nodes: [], edges: [], degree: {} })),
      ]);
      setNotes(noteList);
      setTruths(nextTruths);
      setGraph(nextGraph);
      setSelectedPath((current) => (
        current && noteList.some((note) => note.path === current)
          ? current
          : noteList[0]?.path ?? null
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void loadStudio(false);
  }, [loadStudio]);

  useEffect(() => {
    if (!selectedPath) {
      setSelectedNote(null);
      return;
    }
    let cancelled = false;
    void api.notes.get(selectedPath).then((value) => {
      if (!cancelled) setSelectedNote(normalizeNote(value));
    }).catch(() => {
      if (!cancelled) setSelectedNote(null);
    });
    return () => {
      cancelled = true;
    };
  }, [api, selectedPath]);

  const filteredNotes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter((note) => (
      `${note.title} ${note.path} ${(note.tags ?? []).join(' ')}`.toLowerCase().includes(needle)
    ));
  }, [notes, search]);

  const reviewItems = useMemo(
    () => buildKnowledgeReviewItems(notes, truths, decisions),
    [decisions, notes, truths],
  );
  const attentionItems = useMemo(
    () => reviewItems.filter((item) => item.needsAttention),
    [reviewItems],
  );
  const activity = useMemo(
    () => summarizeKnowledgeActivity(notes, truths),
    [notes, truths],
  );
  const connections = useMemo(
    () => scoreKnowledgeConnections(graph ?? { nodes: [], edges: [], degree: {} }, 8),
    [graph],
  );
  const graphDataSource = useMemo(() => createKgDataSource(api), [api]);
  const selectedTruth = selectedPath ? truths[selectedPath] ?? null : null;
  const selectedProjection = selectedTruth?.truth === 'current'
    ? selectedTruth.current ?? selectedTruth.projection
    : selectedTruth?.latest ?? selectedTruth?.projection ?? null;
  const selectedReview = selectedPath
    ? reviewItems.find((item) => item.notePath === selectedPath) ?? null
    : null;

  const recordDecision = (id: string, decision: KnowledgeReviewDecision) => {
    setDecisions((current) => {
      const next = {
        ...current,
        [id]: { decision, decidedAt: Date.now() },
      };
      storeReviewDecisions(next);
      return next;
    });
  };

  const retryProjection = async (path: string) => {
    if (retryingPath) return;
    setRetryingPath(path);
    setError(null);
    try {
      await api.kg.reindexNote(path);
      if (api.wiki) {
        const next = await api.wiki.getForNote(path);
        setTruths((current) => ({ ...current, [path]: next }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRetryingPath(null);
    }
  };

  if (loading) {
    return <WorkspaceState kind="loading" title="正在读取本地 Wiki Studio…" />;
  }

  return (
    <section className={styles.root} data-testid="knowledge-studio" aria-label="Wiki Studio">
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>LOCAL-FIRST · WIKI STUDIO</span>
          <h2>知识编排台</h2>
          <p>
            资料保留为本地真值；WIKI 负责整理，Review 负责人工判断，Activity 负责恢复状态，Graph 负责发现连接。
          </p>
        </div>
        <div className={styles.heroActions}>
          <button type="button" onClick={() => onOpenKnowledge?.(selectedPath ?? undefined)}>
            打开知识编辑器
          </button>
          <button type="button" onClick={() => onOpenAsk?.()}>基于知识提问</button>
          <button type="button" onClick={() => void loadStudio(true)} disabled={refreshing}>
            {refreshing ? '刷新中…' : '刷新本地状态'}
          </button>
        </div>
      </header>

      {error ? (
        <WorkspaceState
          kind="error"
          title="知识编排操作失败"
          detail={error}
          action={<button type="button" onClick={() => void loadStudio(true)}>重新读取</button>}
        />
      ) : null}

      <div className={styles.metrics} aria-label="知识状态摘要">
        <article><strong>{activity.total}</strong><span>本地资料</span></article>
        <article data-tone="ready"><strong>{activity.current}</strong><span>WIKI current</span></article>
        <article data-tone="working"><strong>{activity.queued + activity.running}</strong><span>处理中</span></article>
        <article data-tone="danger"><strong>{activity.failed + activity.stale + activity.notReady}</strong><span>需处理</span></article>
        <article><strong>{attentionItems.length}</strong><span>待人工审核</span></article>
      </div>

      <div className={styles.columns}>
        <aside className={styles.sourceRail} data-testid="studio-source-rail">
          <div className={styles.sectionHeader}>
            <div><strong>Sources</strong><span>本地资料</span></div>
            <span>{filteredNotes.length}</span>
          </div>
          <label className={styles.searchLabel}>
            <span>搜索资料</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="标题 / 路径 / 标签"
              aria-label="搜索知识资料"
            />
          </label>
          <div className={styles.sourceList} role="list">
            {filteredNotes.map((note) => {
              const state = knowledgeReviewState(truths[note.path]);
              return (
                <button
                  key={note.path}
                  type="button"
                  className={styles.sourceCard}
                  data-active={selectedPath === note.path ? 'true' : 'false'}
                  data-state={state}
                  onClick={() => setSelectedPath(note.path)}
                >
                  <span className={styles.sourceTitle}>{note.title}</span>
                  <small>{note.path}</small>
                  <span className={styles.stateChip}>{stateLabel(state)}</span>
                </button>
              );
            })}
          </div>
          {filteredNotes.length === 0 ? (
            <WorkspaceState
              kind="empty"
              title="没有匹配的本地资料"
              detail={notes.length === 0 ? '先在知识编辑器或今天页面保存第一条本地资料。' : '清空搜索词以查看全部资料。'}
            />
          ) : null}
        </aside>

        <main className={styles.center} data-testid="studio-center">
          <div className={styles.tabs} role="tablist" aria-label="Wiki Studio 视图">
            {([
              ['wiki', 'Wiki'],
              ['review', `Review ${attentionItems.length}`],
              ['graph', 'Graph'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                data-active={mode === id ? 'true' : 'false'}
                onClick={() => setMode(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'wiki' ? (
            selectedPath ? (
              <article className={styles.wikiDocument} data-testid="studio-wiki-document">
                <header>
                  <div>
                    <span className={styles.stateChip}>{stateLabel(knowledgeReviewState(selectedTruth))}</span>
                    <h3>{selectedNote?.title ?? selectedPath}</h3>
                    <code>{selectedPath}</code>
                  </div>
                  <div className={styles.documentActions}>
                    <button type="button" onClick={() => onOpenKnowledge?.(selectedPath)}>阅读 / 编辑原文</button>
                    <button type="button" onClick={() => onOpenAsk?.()}>继续提问</button>
                  </div>
                </header>

                <section className={styles.wikiBlock}>
                  <h4>WIKI 整理结果</h4>
                  {selectedTruth?.truth === 'current' && selectedProjection ? (
                    <>
                      <p>{selectedProjection.summary ?? '当前 projection 未提供摘要。'}</p>
                      <div className={styles.tagRow}>
                        {selectedProjection.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                      </div>
                      <dl className={styles.provenance}>
                        <div><dt>Provider</dt><dd>{selectedProjection.provenance?.provider ?? '未记录'}</dd></div>
                        <div><dt>Model</dt><dd>{selectedProjection.provenance?.model ?? '未记录'}</dd></div>
                        <div><dt>Generated</dt><dd>{displayTime(selectedProjection.generatedAt)}</dd></div>
                        <div><dt>Entities</dt><dd>{selectedProjection.entityIds.length}</dd></div>
                      </dl>
                    </>
                  ) : (
                    <WorkspaceState
                      kind={selectedTruth?.truth === 'failed' ? 'error' : 'empty'}
                      title="整理结果尚不可作为当前真值"
                      detail="原始资料仍完整保留。只有 digest-bound WIKI CURRENT 才显示为可用整理结果。"
                      action={selectedPath ? (
                        <button
                          type="button"
                          disabled={retryingPath === selectedPath}
                          onClick={() => void retryProjection(selectedPath)}
                        >
                          {retryingPath === selectedPath ? '重新整理中…' : '重新整理'}
                        </button>
                      ) : undefined}
                    />
                  )}
                </section>

                <section className={styles.rawPreview}>
                  <h4>Raw Source · 本地原文</h4>
                  <p>{selectedNote?.body?.slice(0, 1200) || '未读取到原文内容。'}</p>
                </section>
              </article>
            ) : <WorkspaceState kind="empty" title="选择一条本地资料" />
          ) : null}

          {mode === 'review' ? (
            <section className={styles.reviewQueue} data-testid="studio-review-queue">
              <header>
                <div>
                  <h3>Review Queue</h3>
                  <p>人工审核元数据只保存在本机，不改变笔记/WIKI/KG 的事实真值。</p>
                </div>
                <strong>{attentionItems.length} 待处理</strong>
              </header>
              <div className={styles.reviewList}>
                {reviewItems.map((item) => (
                  <article key={item.id} className={styles.reviewCard} data-state={item.state}>
                    <button type="button" className={styles.reviewSelect} onClick={() => setSelectedPath(item.notePath)}>
                      <span className={styles.stateChip}>{stateLabel(item.state)}</span>
                      <strong>{item.title}</strong>
                      <small>{item.notePath}</small>
                      <p>{item.summary ?? '当前没有可审核摘要；保留原始资料并等待重新整理。'}</p>
                    </button>
                    <div className={styles.reviewMeta}>
                      <span>{decisionLabel(item.decision?.decision)}</span>
                      <span>{item.provider && item.model ? `${item.provider} · ${item.model}` : '无模型凭据'}</span>
                    </div>
                    <div className={styles.reviewActions}>
                      {item.state === 'current' ? (
                        <button type="button" onClick={() => recordDecision(item.id, 'accepted')}>确认已读</button>
                      ) : null}
                      <button type="button" onClick={() => recordDecision(item.id, 'deferred')}>稍后处理</button>
                      {item.state === 'failed' || item.state === 'stale' || item.state === 'not-ready' || item.state === 'missing' ? (
                        <button
                          type="button"
                          disabled={retryingPath === item.notePath}
                          onClick={() => void retryProjection(item.notePath)}
                        >
                          {retryingPath === item.notePath ? '重试中…' : '重新整理'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {mode === 'graph' ? (
            <section className={styles.graphPanel} data-testid="studio-graph-panel">
              <header>
                <div>
                  <h3>Local Knowledge Graph</h3>
                  <p>现有本地 KG 是唯一图谱真值；Wiki Studio 只提供组织和发现视图。</p>
                </div>
                <span>{graph?.nodes.length ?? 0} nodes · {graph?.edges.length ?? 0} edges</span>
              </header>
              <div className={styles.graphCanvas}>
                <KnowledgeGraph
                  dataSource={graphDataSource}
                  width={720}
                  height={520}
                  onNodeClick={(entity) => {
                    const path = entity.source_notes?.[0];
                    if (path) setSelectedPath(path);
                  }}
                />
              </div>
            </section>
          ) : null}
        </main>

        <aside className={styles.insightRail} data-testid="studio-insight-rail">
          <section className={styles.insightSection}>
            <div className={styles.sectionHeader}>
              <div><strong>Activity</strong><span>持久构建状态</span></div>
              <span>{activity.queued + activity.running + activity.failed}</span>
            </div>
            <div className={styles.activityList}>
              {reviewItems
                .filter((item) => item.state !== 'current')
                .slice(0, 8)
                .map((item) => (
                  <button key={item.id} type="button" onClick={() => setSelectedPath(item.notePath)}>
                    <span data-state={item.state}>{stateLabel(item.state)}</span>
                    <strong>{item.title}</strong>
                    <small>{item.notePath}</small>
                  </button>
                ))}
              {reviewItems.every((item) => item.state === 'current') ? (
                <p className={styles.emptyNote}>当前没有排队、运行、失败或过期的知识构建。</p>
              ) : null}
            </div>
          </section>

          <section className={styles.insightSection}>
            <div className={styles.sectionHeader}>
              <div><strong>4-Signal Connections</strong><span>clean-room relevance</span></div>
              <span>{connections.length}</span>
            </div>
            <div className={styles.connectionList}>
              {connections.map((connection) => (
                <article key={connection.id}>
                  <header><strong>{connection.fromName}</strong><span>↔</span><strong>{connection.toName}</strong></header>
                  <p>相关度 {connection.score.toFixed(2)}</p>
                  <div>
                    <span>直连 {connection.directLink}</span>
                    <span>来源 {connection.sourceOverlap.toFixed(2)}</span>
                    <span>AA {connection.adamicAdar.toFixed(2)}</span>
                    <span>类型 {connection.typeAffinity}</span>
                  </div>
                  {connection.sharedSources.length > 0 ? <small>{connection.sharedSources.slice(0, 2).join(' · ')}</small> : null}
                </article>
              ))}
              {connections.length === 0 ? (
                <p className={styles.emptyNote}>本地图谱暂未形成可排序的连接证据。</p>
              ) : null}
            </div>
          </section>

          <section className={styles.boundary}>
            <strong>实现边界</strong>
            <p>
              借鉴 llm_wiki 的 Raw → Wiki → Review、持久队列和 4-Signal 方法；代码按 Copilot 现有 Electron/TypeScript/SQLite 接口 clean-room 重写，没有复制 GPL 上游源码，也没有新增第二数据库或向量库。
            </p>
            {selectedReview ? <small>当前审核：{decisionLabel(selectedReview.decision?.decision)}</small> : null}
          </section>
        </aside>
      </div>
    </section>
  );
}

export default KnowledgeStudioWorkspace;
