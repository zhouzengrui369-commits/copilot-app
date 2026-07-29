import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import type {
  CopilotProductApi,
  CopilotRagAnswer,
  CopilotRagStreamHandle,
  CopilotTodo,
} from '../lib/copilot-api.js';
import { WorkspaceState } from './WorkspaceState.js';
import styles from './AskWorkspace.module.css';

interface AskWorkspaceProps {
  api: CopilotProductApi;
  onOpenSource?(path: string): void;
  onOpenTodo?(id: string | number): void;
}

type SourceTruthState = 'CHECKING' | 'LOCAL_PRESENT' | 'MISSING' | 'UNAVAILABLE' | 'UNKNOWN';
type CopyTruthState = 'COPIED' | 'COPY_UNAVAILABLE';
type KnownEvidence = 'vector' | 'kg-entity' | 'kg-neighbor';

interface SourceReceipt {
  key: string;
  notePath: string;
  displayPath: string;
  status: SourceTruthState;
  reasonCode: string;
  evidence?: KnownEvidence[];
  score?: number;
  title?: string;
  preview?: string;
}

interface CheckedSources {
  fingerprint: string;
  receipts: SourceReceipt[];
}

interface RagErrorReceipt {
  message: string;
  reasonCode: string;
}

interface CompletedExchange {
  question: string;
  answer: CopilotRagAnswer;
}

interface FrozenTodoPayload {
  question: string;
  answer: string;
  sourcePaths: string[];
}

const KNOWN_EVIDENCE = new Set<KnownEvidence>(['vector', 'kg-entity', 'kg-neighbor']);
const PREVIEW_LIMIT = 240;

export function AskWorkspace({ api, onOpenSource, onOpenTodo }: AskWorkspaceProps): ReactElement {
  const [question, setQuestion] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [answer, setAnswer] = useState<CopilotRagAnswer | null>(null);
  const [completedExchange, setCompletedExchange] = useState<CompletedExchange | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RagErrorReceipt | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [copyStates, setCopyStates] = useState<Record<string, CopyTruthState>>({});
  const [checkedSources, setCheckedSources] = useState<CheckedSources>({
    fingerprint: '',
    receipts: [],
  });
  const [todoPayload, setTodoPayload] = useState<FrozenTodoPayload | null>(null);
  const [todoTitle, setTodoTitle] = useState('');
  const [todoDue, setTodoDue] = useState('');
  const [todoSaving, setTodoSaving] = useState(false);
  const [todoError, setTodoError] = useState<string | null>(null);
  const [todoReceipt, setTodoReceipt] = useState<CopilotTodo | null>(null);
  const activeStream = useRef<CopilotRagStreamHandle | null>(null);
  const requestSequence = useRef(0);
  const sourceCheckSequence = useRef(0);

  useEffect(() => () => {
    requestSequence.current += 1;
    sourceCheckSequence.current += 1;
    void activeStream.current?.cancel().catch(() => undefined);
    activeStream.current = null;
  }, []);

  const normalizedSources = answer ? normalizeSources(answer) : [];
  const sourceFingerprint = answer ? fingerprintSources(normalizedSources) : 'NO_ANSWER';
  const sourceReceipts = checkedSources.fingerprint === sourceFingerprint
    ? checkedSources.receipts
    : normalizedSources;

  useEffect(() => {
    const sequence = sourceCheckSequence.current + 1;
    sourceCheckSequence.current = sequence;
    if (!answer) {
      setCheckedSources({ fingerprint: 'NO_ANSWER', receipts: [] });
      return;
    }

    setCheckedSources({ fingerprint: sourceFingerprint, receipts: normalizedSources });
    for (const receipt of normalizedSources) {
      if (receipt.status !== 'CHECKING') continue;
      void api.notes.get(receipt.notePath).then((document) => {
        if (sourceCheckSequence.current !== sequence) return;
        const resolved = resolveLocalReceipt(receipt, document);
        setCheckedSources((current) => ({
          fingerprint: sourceFingerprint,
          receipts: (current.fingerprint === sourceFingerprint ? current.receipts : normalizedSources)
            .map((candidate) => candidate.key === receipt.key ? resolved : candidate),
        }));
      }).catch(() => {
        if (sourceCheckSequence.current !== sequence) return;
        const unavailable = {
          ...receipt,
          status: 'UNAVAILABLE' as const,
          reasonCode: 'SOURCE_NOTE_UNAVAILABLE',
        };
        setCheckedSources((current) => ({
          fingerprint: sourceFingerprint,
          receipts: (current.fingerprint === sourceFingerprint ? current.receipts : normalizedSources)
            .map((candidate) => candidate.key === receipt.key ? unavailable : candidate),
        }));
      });
    }

    return () => {
      sourceCheckSequence.current += 1;
    };
  }, [api.notes, sourceFingerprint]);

  const runAsk = async (query: string) => {
    requestSequence.current += 1;
    sourceCheckSequence.current += 1;
    const sequence = requestSequence.current;
    await activeStream.current?.cancel().catch(() => undefined);
    activeStream.current = null;
    setLastQuery(query);
    setLoading(true);
    setError(null);
    setCancelled(false);
    setCopyStates({});
    setAnswer(null);
    setCompletedExchange(null);
    setTodoPayload(null);
    setTodoError(null);
    setTodoReceipt(null);
    try {
      if (api.rag.stream) {
        const handle = api.rag.stream(query, (streamEvent) => {
          if (requestSequence.current !== sequence || streamEvent.type !== 'delta') return;
          setAnswer((current) => ({
            text: `${current?.text ?? ''}${streamEvent.delta}`,
            sources: streamEvent.sources.map((source) => source.notePath),
            sourceDetails: streamEvent.sources,
          }));
        });
        activeStream.current = handle;
        const finalAnswer = await handle.done;
        if (requestSequence.current === sequence) {
          setAnswer(finalAnswer);
          setCompletedExchange({ question: query, answer: finalAnswer });
        }
      } else {
        const finalAnswer = await api.rag.ask(query);
        if (requestSequence.current === sequence) {
          setAnswer(finalAnswer);
          setCompletedExchange({ question: query, answer: finalAnswer });
        }
      }
    } catch (cause) {
      if (requestSequence.current === sequence && !isAbortError(cause)) {
        setAnswer(null);
        setCompletedExchange(null);
        setError(friendlyRagError(cause));
      }
    } finally {
      if (requestSequence.current === sequence) {
        activeStream.current = null;
        setLoading(false);
      }
    }
  };

  const ask = (event: FormEvent) => {
    event.preventDefault();
    const query = question.trim();
    if (!query || loading) return;
    void runAsk(query);
  };

  const cancel = async () => {
    const handle = activeStream.current;
    if (!handle) return;
    requestSequence.current += 1;
    sourceCheckSequence.current += 1;
    activeStream.current = null;
    setLoading(false);
    setCancelled(true);
    setCompletedExchange(null);
    await handle.cancel().catch(() => undefined);
  };

  const copyVisibleText = async (key: string, text: string) => {
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('clipboard unavailable');
      await clipboard.writeText(text);
      setCopyStates((current) => ({ ...current, [key]: 'COPIED' }));
    } catch {
      setCopyStates((current) => ({ ...current, [key]: 'COPY_UNAVAILABLE' }));
    }
  };

  const answerText = answer?.text || '知识库内未找到相关笔记。';
  const sourceSummary = summarizeSources(sourceReceipts);
  const sourceTruthState = answer ? sourceSummary.state : 'NOT_PROBED';
  const sourceTruthLabel = answer
    ? `${sourceReceipts.length} source${sourceReceipts.length === 1 ? '' : 's'} · ${sourceSummary.state}`
    : '模型与来源 · NOT_PROBED';
  const sourceTruthBadge = answer && sourceSummary.state === 'LOCAL_PRESENT'
    ? 'ok'
    : answer && sourceSummary.state === 'CHECKING'
      ? 'checking'
      : 'unknown';
  const sourcePaths = sourceReceipts.map((source) => source.notePath).filter(Boolean);
  const todoEligible = Boolean(
    completedExchange
    && answer
    && completedExchange.answer.text === answer.text
    && sourceReceipts.length > 0
    && sourceReceipts.every((source) => source.status === 'LOCAL_PRESENT' && source.notePath),
  );

  const openTodoComposer = () => {
    if (!todoEligible || !completedExchange) return;
    const frozen = {
      question: completedExchange.question,
      answer: completedExchange.answer.text,
      sourcePaths: [...sourcePaths],
    };
    setTodoPayload(frozen);
    setTodoTitle(frozen.question.slice(0, 120));
    setTodoDue('');
    setTodoError(null);
    setTodoReceipt(null);
  };

  const createTodo = async (event: FormEvent) => {
    event.preventDefault();
    if (!todoPayload || !todoTitle.trim() || todoSaving) return;
    const dueAt = todoDue ? new Date(todoDue).getTime() : null;
    if (todoDue && !Number.isFinite(dueAt)) {
      setTodoError('截止时间无效，未创建待办。');
      return;
    }
    setTodoSaving(true);
    setTodoError(null);
    try {
      const created = await api.todos.create({
        title: todoTitle.trim(),
        body: todoPayload.answer,
        dueAt,
        remindAt: dueAt,
        linkedNotePaths: todoPayload.sourcePaths,
      });
      const listed = await api.todos.list();
      const canonical = listed.find((todo) => String(todo.id) === String(created.id));
      assertTodoReadback(canonical, {
        ...created,
        title: todoTitle.trim(),
        body: todoPayload.answer,
        dueAt,
        linkedNotePaths: todoPayload.sourcePaths,
      });
      setTodoReceipt(canonical);
      setTodoPayload(null);
    } catch (cause) {
      setTodoError(`待办未创建：${errorMessage(cause)}`);
    } finally {
      setTodoSaving(false);
    }
  };

  const startNewConversation = () => {
    requestSequence.current += 1;
    sourceCheckSequence.current += 1;
    const handle = activeStream.current;
    activeStream.current = null;
    void handle?.cancel().catch(() => undefined);
    setQuestion('');
    setLastQuery('');
    setAnswer(null);
    setCompletedExchange(null);
    setLoading(false);
    setError(null);
    setCancelled(false);
    setCopyStates({});
    setCheckedSources({ fingerprint: 'NO_ANSWER', receipts: [] });
    setTodoPayload(null);
    setTodoError(null);
    setTodoReceipt(null);
  };

  return (
    <section className={`workspace ask-workspace ${styles.workspace}`} data-testid="ask-workspace">
      <header className="workspace__header workspace-header">
        <div>
          <h2 id="conversation-title">对话</h2>
          <p>查看当前上下文、核对来源，并进行更详细的连续提问。</p>
        </div>
        <div className="workspace-actions">
          <button className="btn primary primary-button" type="button" onClick={startNewConversation}>
            新建对话
          </button>
          <span className="badge unknown" data-testid="ask-header-truth">模型 NOT_PROBED</span>
        </div>
      </header>
      <div className={`chat-grid ${styles.chatGrid}`} data-testid="ask-demo-grid">
        <aside className={`chat-history ${styles.chatHistory}`} aria-label="历史对话">
          <h2>历史对话</h2>
          <div className={`history-list ${styles.historyList}`}>
            <section
              className={`history-item active ${styles.historyItem}`}
              data-truth-state="NOT_PROBED"
            >
              <strong>{lastQuery || '本地对话历史'}</strong>
              <small>
                {lastQuery
                  ? '当前会话 · 尚未持久化为历史记录'
                  : 'NOT_PROBED · 当前版本未读取历史记录'}
              </small>
            </section>
          </div>
          <p className={styles.historyBoundary}>
            历史记录能力未探测，不显示 Demo fixture。
          </p>
        </aside>

        <article className={`chat-main ${styles.chatMain}`}>
          <header className={`chat-main-head ${styles.chatMainHead}`}>
            <div>
              <h2>{lastQuery ? '当前本地问答' : '新对话'}</h2>
              <p>上下文：本地笔记 · 知识图谱 · 可核对 sources</p>
            </div>
            <span className="spacer" />
            <span className={`badge ${sourceTruthBadge}`} data-testid="ask-source-count">
              {sourceTruthLabel}
            </span>
          </header>

          <div className={`chat-thread ${styles.chatThread}`} aria-live="polite">
            {!lastQuery && !loading && !answer && !error && !cancelled ? (
              <div className={`message ${styles.message} ${styles.emptyMessage}`} data-testid="ask-empty-truth">
                <strong>基于本地知识开始提问</strong>
                <p>回答只使用本地笔记与知识图谱；检索完成后才显示可核对来源。</p>
                <div className={styles.truthRow}>
                  <span className="badge unknown">NOT_PROBED</span>
                  <span className="badge unknown">NO_SOURCE</span>
                </div>
              </div>
            ) : null}

            {lastQuery ? (
              <div className={`message user ${styles.message} ${styles.userMessage}`}>
                <p>{lastQuery}</p>
              </div>
            ) : null}

            {loading ? (
              <div className={styles.stateSlot}>
                <WorkspaceState kind="loading" title="正在检索本地知识并生成回答…" />
              </div>
            ) : null}
            {cancelled ? (
              <div className={styles.stateSlot}>
                <WorkspaceState kind="unavailable" title="已取消本次问答" detail="RAG_REQUEST_CANCELLED" />
              </div>
            ) : null}
            {error ? (
              <div className={styles.stateSlot}>
                <WorkspaceState
                  kind="error"
                  title="问答失败"
                  detail={`${error.message}（${error.reasonCode}）`}
                  action={(
                    <div className="ask-actions">
                      <button type="button" disabled={!lastQuery || loading} onClick={() => void runAsk(lastQuery)}>
                        重试
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyVisibleText('error-diagnostic', `问答失败\n${error.reasonCode}`)}
                      >
                        复制诊断
                      </button>
                      <CopyFeedback state={copyStates['error-diagnostic']} testId="copy-status-error-diagnostic" />
                    </div>
                  )}
                />
              </div>
            ) : null}

            {answer ? (
              <article
                className={`answer-card message ${styles.answerCard}`}
                aria-live="polite"
                tabIndex={0}
              >
                <div className="answer-card__heading">
                  <h3>回答</h3>
                  <button type="button" onClick={() => void copyVisibleText('answer', answerText)}>
                    复制回答
                  </button>
                  <CopyFeedback state={copyStates.answer} testId="copy-status-answer" />
                </div>
                <p className="answer-card__text" data-testid="rag-answer">{answerText}</p>
                <div className={styles.answerActions}>
                  <button
                    type="button"
                    data-testid="ask-create-todo"
                    disabled={!todoEligible}
                    onClick={openTodoComposer}
                  >
                    转为待办
                  </button>
                  {!todoEligible ? <small>全部来源核对为 LOCAL_PRESENT 后可创建</small> : null}
                </div>
                {todoPayload ? (
                  <form className={styles.todoComposer} onSubmit={(event) => void createTodo(event)}>
                    <strong>确认待办</strong>
                    <p>回答正文与全部来源将原样保存；截止时间可留空，归入“未安排”。</p>
                    <label>
                      标题
                      <input
                        aria-label="待办标题"
                        value={todoTitle}
                        onChange={(event) => setTodoTitle(event.target.value)}
                      />
                    </label>
                    <label>
                      截止时间（可选）
                      <input
                        aria-label="待办截止时间"
                        type="datetime-local"
                        value={todoDue}
                        onChange={(event) => setTodoDue(event.target.value)}
                      />
                    </label>
                    <p data-testid="todo-source-count">保留 {todoPayload.sourcePaths.length} 条来源</p>
                    {todoError ? <p role="alert">{todoError}</p> : null}
                    <div>
                      <button type="button" disabled={todoSaving} onClick={() => setTodoPayload(null)}>取消</button>
                      <button type="submit" disabled={todoSaving || !todoTitle.trim()}>
                        {todoSaving ? '正在创建…' : '创建待办'}
                      </button>
                    </div>
                  </form>
                ) : null}
                {todoReceipt ? (
                  <div className={styles.todoReceipt} role="status" data-testid="ask-todo-success">
                    <strong>待办已保存并完成本地回读</strong>
                    <span>{todoReceipt.title}</span>
                    <button type="button" onClick={() => onOpenTodo?.(todoReceipt.id)}>查看待办</button>
                  </div>
                ) : null}
              </article>
            ) : null}
          </div>

          <div className={`followups ${styles.followups}`} aria-label="建议追问">
            {['列出 MOC 验收标准', '生成今天的待办', '查看不同来源的分歧'].map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => setQuestion(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>

          <form className={`ask-form chat-compose ${styles.chatCompose}`} onSubmit={ask}>
            <label className="sr-only" htmlFor="ask-question">问题</label>
            <textarea
              id="ask-question"
              value={question}
              placeholder="围绕当前对话继续详细提问……"
              onChange={(event) => setQuestion(event.target.value)}
            />
            <div className={styles.composeActions}>
              <button
                className="btn primary primary-button"
                type="submit"
                aria-label="提问"
                disabled={loading || !question.trim()}
              >
                {loading ? '检索中…' : '发送'}
              </button>
              {loading && api.rag.stream ? (
                <button type="button" onClick={() => void cancel()}>取消</button>
              ) : null}
            </div>
          </form>
        </article>

        <aside className={`chat-evidence evidence-panel ${styles.chatEvidence}`}>
          <h2>本轮 Sources</h2>
          <div
            className="answer-source-truth"
            data-testid="answer-source-truth"
            data-truth-state={sourceTruthState}
          >
            {answer ? (
              <WorkspaceState
                kind={sourceSummary.kind}
                title={sourceSummary.title}
                detail={sourceSummary.reasonCode}
              />
            ) : (
              <WorkspaceState
                kind="unknown"
                title="尚未检索本地来源"
                detail="NOT_PROBED / NO_SOURCE"
              />
            )}
          </div>

          {sourceReceipts.length === 0 ? null : (
            <ul className={`source-list ${styles.sourceList}`}>
              {sourceReceipts.map((source) => (
                <li
                  className={`source-receipt ${styles.sourceReceipt}`}
                  data-testid={`source-receipt-${source.key}`}
                  data-truth-state={source.status}
                  key={source.key}
                  tabIndex={0}
                >
                  <div className="source-receipt__heading">
                    <button
                      type="button"
                      disabled={source.status !== 'LOCAL_PRESENT' || !onOpenSource || !source.notePath}
                      onClick={() => {
                        if (source.status === 'LOCAL_PRESENT' && source.notePath) onOpenSource?.(source.notePath);
                      }}
                    >
                      {source.displayPath}
                    </button>
                    <strong className="source-receipt__status">{source.status}</strong>
                  </div>
                  <p className="source-receipt__reason">Reason: {source.reasonCode}</p>
                  {source.evidence && source.score !== undefined ? (
                    <p>
                      <mark title={explainEvidence(source.evidence)}>
                        {explainEvidence(source.evidence)} · score {source.score}
                      </mark>
                    </p>
                  ) : null}
                  {source.title ? <p className="source-receipt__title">标题：{source.title}</p> : null}
                  {source.preview ? <p className="source-receipt__preview">预览：{source.preview}</p> : null}
                  <div className="source-receipt__actions">
                    <button
                      type="button"
                      onClick={() => void copyVisibleText(`source-${source.key}`, sourceReceiptText(source))}
                    >
                      复制来源凭据 {source.displayPath}
                    </button>
                    <CopyFeedback state={copyStates[`source-${source.key}`]} testId={`copy-status-source-${source.key}`} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <section className={`panel risk-rail ${styles.truthPanel}`}>
            <header className="panel-head">
              <h3>回答真值</h3>
            </header>
            <div className="panel-body">
              <span className={`badge ${sourceTruthBadge}`}>
                {answer ? `当前：${sourceSummary.state}` : 'NOT_PROBED / NO_SOURCE'}
              </span>
              <p>正式回答必须显示检索依据和 source preview；无来源、stale 或 unknown 不得绿色。</p>
            </div>
          </section>

          <aside className={`ask-diagnostics ${styles.diagnostics}`} aria-label="稳定诊断" tabIndex={0}>
            <div className="ask-diagnostics__heading">
              <h4>Diagnostics</h4>
              <button
                type="button"
                onClick={() => void copyVisibleText(
                  'source-diagnostics',
                  answer ? sourceDiagnosticsText(sourceReceipts) : 'NOT_PROBED\nNO_SOURCE',
                )}
              >
                复制来源诊断
              </button>
              <CopyFeedback state={copyStates['source-diagnostics']} testId="copy-status-source-diagnostics" />
            </div>
            <ul>
              {sourceReceipts.length === 0 ? (
                <li>{answer ? 'NO_SOURCE' : 'NOT_PROBED / NO_SOURCE'}</li>
              ) : sourceReceipts.map((source) => (
                <li key={`diagnostic-${source.key}`}>
                  {source.displayPath}: {source.status} / {source.reasonCode}
                </li>
              ))}
            </ul>
          </aside>
        </aside>
      </div>
    </section>
  );
}

function normalizeSources(answer: CopilotRagAnswer): SourceReceipt[] {
  const rawSources: unknown[] = Array.isArray(answer.sources) ? answer.sources : [];
  const rawDetails: unknown[] = Array.isArray(answer.sourceDetails) ? answer.sourceDetails : [];
  const sourcePaths: string[] = [];
  const invalidReceipts: SourceReceipt[] = [];

  rawSources.forEach((rawSource, index) => {
    const notePath = normalizePath(rawSource);
    if (!notePath) {
      invalidReceipts.push(unknownReceipt(`invalid-source-${index}`, '', `无效来源 #${index + 1}`, 'SOURCE_DETAIL_INVALID'));
      return;
    }
    sourcePaths.push(notePath);
  });

  const details = rawDetails.map((rawDetail, index) => normalizeDetail(rawDetail, index));
  for (const detail of details) {
    if (!detail.notePath) {
      invalidReceipts.push(unknownReceipt(detail.key, '', `无效来源详情 #${detail.index + 1}`, 'SOURCE_DETAIL_INVALID'));
    }
  }

  const sourceCounts = countPaths(sourcePaths);
  const detailCounts = countPaths(details.map((detail) => detail.notePath).filter(Boolean));
  const orderedPaths = stableUnique([...sourcePaths, ...details.map((detail) => detail.notePath).filter(Boolean)]);

  const receipts = orderedPaths.map((notePath) => {
    const sourceCount = sourceCounts.get(notePath) ?? 0;
    const detailCount = detailCounts.get(notePath) ?? 0;
    const detail = details.find((candidate) => candidate.notePath === notePath);
    if (sourceCount > 1 || detailCount > 1) {
      return unknownReceipt(notePath, notePath, notePath, 'SOURCE_ID_DUPLICATE');
    }
    if (sourceCount !== 1 || detailCount !== 1) {
      return unknownReceipt(
        notePath,
        notePath,
        notePath,
        sourceCount === 1 && rawDetails.length === 0 ? 'SOURCE_DETAILS_ABSENT' : 'SOURCE_ID_MISMATCH',
      );
    }
    if (!detail?.valid || !detail.evidence || detail.score === undefined) {
      return unknownReceipt(notePath, notePath, notePath, 'SOURCE_DETAIL_INVALID');
    }
    return {
      key: notePath,
      notePath,
      displayPath: notePath,
      status: 'CHECKING' as const,
      reasonCode: 'SOURCE_CHECKING',
      evidence: detail.evidence,
      score: detail.score,
    };
  });

  return [...receipts, ...invalidReceipts];
}

function normalizeDetail(value: unknown, index: number): {
  key: string;
  index: number;
  notePath: string;
  valid: boolean;
  evidence?: KnownEvidence[];
  score?: number;
} {
  if (!isRecord(value)) return { key: `invalid-detail-${index}`, index, notePath: '', valid: false };
  const notePath = normalizePath(value.notePath);
  const rawEvidence = Array.isArray(value.evidence) ? value.evidence : [];
  const evidence = stableUnique(rawEvidence.filter(
    (candidate): candidate is KnownEvidence =>
      typeof candidate === 'string' && KNOWN_EVIDENCE.has(candidate as KnownEvidence),
  ));
  const evidenceValid = rawEvidence.length > 0 && evidence.length === rawEvidence.length;
  const score = typeof value.score === 'number' && Number.isFinite(value.score) ? value.score : undefined;
  return {
    key: notePath || `invalid-detail-${index}`,
    index,
    notePath,
    valid: Boolean(notePath) && evidenceValid && score !== undefined,
    evidence: evidenceValid ? evidence : undefined,
    score,
  };
}

function resolveLocalReceipt(receipt: SourceReceipt, document: unknown): SourceReceipt {
  if (!document) return { ...receipt, status: 'MISSING', reasonCode: 'SOURCE_NOTE_MISSING' };
  if (!isRecord(document)) {
    return unknownReceipt(receipt.key, receipt.notePath, receipt.displayPath, 'SOURCE_DETAIL_INVALID');
  }
  const note = isRecord(document.note) ? document.note : document;
  const returnedPath = normalizePath(note.path);
  if (!returnedPath || returnedPath !== receipt.notePath) {
    return unknownReceipt(receipt.key, receipt.notePath, receipt.displayPath, 'SOURCE_ID_MISMATCH');
  }
  const title = typeof note.title === 'string' && note.title.trim() ? note.title.trim() : receipt.notePath;
  const body = typeof document.body === 'string'
    ? document.body
    : typeof note.body === 'string'
      ? note.body
      : '';
  return {
    ...receipt,
    status: 'LOCAL_PRESENT',
    reasonCode: 'SOURCE_LOCAL_PRESENT',
    title,
    preview: normalizePreview(body),
  };
}

function unknownReceipt(key: string, notePath: string, displayPath: string, reasonCode: string): SourceReceipt {
  return { key, notePath, displayPath, status: 'UNKNOWN', reasonCode };
}

function summarizeSources(receipts: SourceReceipt[]): {
  kind: 'checking' | 'unknown' | 'unavailable' | 'success';
  state: string;
  title: string;
  reasonCode: string;
} {
  if (receipts.length === 0) {
    return { kind: 'unknown', state: 'NO_SOURCE', title: '未核对：本次回答无可验证来源', reasonCode: 'NO_SOURCE' };
  }
  if (receipts.some((receipt) => receipt.status === 'CHECKING')) {
    return { kind: 'checking', state: 'CHECKING', title: '正在核对本地来源', reasonCode: 'SOURCE_CHECKING' };
  }
  if (receipts.every((receipt) => receipt.status === 'LOCAL_PRESENT')) {
    return {
      kind: 'success',
      state: 'LOCAL_PRESENT',
      title: `已核对 ${receipts.length} 条本地来源`,
      reasonCode: 'SOURCE_LOCAL_PRESENT',
    };
  }
  if (receipts.every((receipt) => receipt.status === 'UNAVAILABLE')) {
    return {
      kind: 'unavailable',
      state: 'UNAVAILABLE',
      title: '来源暂不可核对',
      reasonCode: 'SOURCE_NOTE_UNAVAILABLE',
    };
  }
  return {
    kind: 'unknown',
    state: 'UNKNOWN',
    title: '未核对：没有完整可验证的来源集合',
    reasonCode: receipts.some((receipt) => receipt.status === 'LOCAL_PRESENT')
      ? 'SOURCE_VERIFICATION_PARTIAL'
      : 'NO_VERIFIED_SOURCE',
  };
}

function fingerprintSources(receipts: SourceReceipt[]): string {
  return JSON.stringify(receipts.map((receipt) => ({
    key: receipt.key,
    notePath: receipt.notePath,
    status: receipt.status,
    reasonCode: receipt.reasonCode,
    evidence: receipt.evidence,
    score: receipt.score,
  })));
}

function sourceReceiptText(source: SourceReceipt): string {
  return [
    `路径：${source.displayPath}`,
    `状态：${source.status}`,
    `原因：${source.reasonCode}`,
    source.evidence ? `依据：${explainEvidence(source.evidence)}` : '',
    source.score !== undefined ? `分数：${source.score}` : '',
    source.title ? `标题：${source.title}` : '',
    source.preview ? `预览：${source.preview}` : '',
  ].filter(Boolean).join('\n');
}

function sourceDiagnosticsText(receipts: SourceReceipt[]): string {
  if (receipts.length === 0) return 'NO_SOURCE';
  return receipts.map((source) => `${source.displayPath}: ${source.status} / ${source.reasonCode}`).join('\n');
}

function explainEvidence(evidence: KnownEvidence[]): string {
  const labels: Record<KnownEvidence, string> = {
    vector: '向量相似度',
    'kg-entity': '知识图谱实体',
    'kg-neighbor': '知识图谱邻接',
  };
  return `引用依据：${evidence.map((item) => labels[item]).join(' + ')}`;
}

function normalizePreview(body: string): string {
  const normalized = body
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= PREVIEW_LIMIT) return normalized;
  return `${normalized.slice(0, PREVIEW_LIMIT - 1).trimEnd()}…`;
}

function normalizePath(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function countPaths(paths: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
  return counts;
}

function stableUnique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function CopyFeedback({ state, testId }: { state?: CopyTruthState; testId: string }): ReactElement | null {
  if (!state) return null;
  return <span role="status" data-testid={testId}>{state === 'COPIED' ? '已复制' : '复制不可用'}</span>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertTodoReadback(
  actual: CopilotTodo | undefined,
  expected: CopilotTodo,
): asserts actual is CopilotTodo {
  const actualLinks = actual?.linkedNotePaths ?? actual?.note_links ?? [];
  const expectedLinks = expected.linkedNotePaths ?? expected.note_links ?? [];
  const actualDue = actual?.dueAt ?? actual?.due_at_ms ?? null;
  const expectedDue = expected.dueAt ?? expected.due_at_ms ?? null;
  const matches = actual
    && String(actual.id) === String(expected.id)
    && actual.title === expected.title
    && (actual.body ?? '') === (expected.body ?? '')
    && actual.status === expected.status
    && actualDue === expectedDue
    && JSON.stringify(actualLinks) === JSON.stringify(expectedLinks);
  if (!matches) throw new Error('TODO_CANONICAL_READBACK_FAILED');
}

function friendlyRagError(error: unknown): RagErrorReceipt {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('[CONFIG_REQUIRED]')) {
    return { message: '请先在设置中完成模型服务配置。', reasonCode: 'RAG_CONFIG_REQUIRED' };
  }
  if (message.includes('[OFFLINE]') || message === 'offline') {
    return { message: '本地 AI 服务暂不可用，请确认服务已启动后重试。', reasonCode: 'RAG_OFFLINE' };
  }
  return { message: '本地知识问答失败，请稍后重试。', reasonCode: 'RAG_REQUEST_FAILED' };
}
