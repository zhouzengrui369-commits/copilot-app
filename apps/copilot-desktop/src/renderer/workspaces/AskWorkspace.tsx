import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import type {
  CopilotProductApi,
  CopilotRagAnswer,
  CopilotRagStreamHandle,
} from '../lib/copilot-api.js';
import type { RagSourceDetail } from '../../shared/domain-api.js';
import { WorkspaceState } from './WorkspaceState.js';

interface AskWorkspaceProps {
  api: CopilotProductApi;
  onOpenSource?(path: string): void;
}

export function AskWorkspace({ api, onOpenSource }: AskWorkspaceProps): ReactElement {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<CopilotRagAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeStream = useRef<CopilotRagStreamHandle | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => () => {
    requestSequence.current += 1;
    void activeStream.current?.cancel().catch(() => undefined);
    activeStream.current = null;
  }, []);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const query = question.trim();
    if (!query) return;
    requestSequence.current += 1;
    const sequence = requestSequence.current;
    await activeStream.current?.cancel().catch(() => undefined);
    activeStream.current = null;
    setLoading(true);
    setError(null);
    setAnswer(null);
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
          setAnswer((current) => ({
            ...finalAnswer,
            sourceDetails: finalAnswer.sourceDetails ?? current?.sourceDetails,
          }));
        }
      } else {
        const finalAnswer = await api.rag.ask(query);
        if (requestSequence.current === sequence) setAnswer(finalAnswer);
      }
    } catch (cause) {
      if (requestSequence.current === sequence && !isAbortError(cause)) {
        setAnswer(null);
        setError(friendlyRagError(cause));
      }
    } finally {
      if (requestSequence.current === sequence) {
        activeStream.current = null;
        setLoading(false);
      }
    }
  };

  const cancel = async () => {
    const handle = activeStream.current;
    if (!handle) return;
    await handle.cancel().catch(() => undefined);
  };

  const sourceDetails = answer ? explainSources(answer) : [];

  return (
    <section className="workspace ask-workspace" data-testid="ask-workspace">
      <header className="workspace__header">
        <div>
          <h2>Ask</h2>
          <p>仅基于本地知识库回答，并显示可核对的来源。</p>
        </div>
      </header>
      <form className="ask-form" onSubmit={(event) => void ask(event)}>
        <label htmlFor="ask-question">问题</label>
        <div>
          <input
            id="ask-question"
            value={question}
            placeholder="例如：OPC 是什么？"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="primary-button" type="submit" disabled={loading || !question.trim()}>
            {loading ? '检索中…' : '提问'}
          </button>
          {loading && api.rag.stream ? (
            <button type="button" onClick={() => void cancel()}>取消</button>
          ) : null}
        </div>
      </form>
      {loading ? <WorkspaceState kind="loading" title="正在检索本地知识并生成回答…" /> : null}
      {error ? <WorkspaceState kind="error" title="问答失败" detail={error} /> : null}
      {answer ? (
        <article className="answer-card" aria-live="polite">
          <h3>回答</h3>
          <p data-testid="rag-answer">{answer.text || '知识库内未找到相关笔记。'}</p>
          <h4>Sources</h4>
          {sourceDetails.length === 0 ? (
            <WorkspaceState kind="empty" title="本次回答没有可引用来源" />
          ) : (
            <ul className="source-list">
              {sourceDetails.map((source) => (
                <li key={source.notePath}>
                  <mark title={explainEvidence(source)}>
                    <button type="button" onClick={() => onOpenSource?.(source.notePath)}>
                      {source.notePath}
                    </button>
                  </mark>
                </li>
              ))}
            </ul>
          )}
        </article>
      ) : null}
    </section>
  );
}

function explainSources(answer: CopilotRagAnswer): RagSourceDetail[] {
  if (answer.sourceDetails?.length) return answer.sourceDetails;
  return answer.sources.map((notePath) => ({ notePath, evidence: ['vector'], score: 0 }));
}

function explainEvidence(source: RagSourceDetail): string {
  const labels = source.evidence.map((evidence) => ({
    vector: '向量相似度',
    'kg-entity': '知识图谱实体',
    'kg-neighbor': '知识图谱邻接',
  })[evidence]);
  return `引用依据：${labels.join(' + ')}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function friendlyRagError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('[CONFIG_REQUIRED]')) return '请先在设置中完成模型服务配置。';
  if (message.includes('[OFFLINE]')) return '本地 AI 服务暂不可用，请确认服务已启动后重试。';
  if (message === 'offline') return 'offline';
  return '本地知识问答失败，请稍后重试。';
}
