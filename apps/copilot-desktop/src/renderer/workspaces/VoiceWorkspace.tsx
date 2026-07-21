import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { VoiceInput } from '../components/VoiceInput/index.js';
import type { CopilotProductApi } from '../lib/copilot-api.js';
import { WorkspaceState } from './WorkspaceState.js';

interface VoiceWorkspaceProps {
  api: CopilotProductApi;
}

function titleForTranscript(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 32 ? `${oneLine.slice(0, 32)}…` : oneLine;
}

export function VoiceWorkspace({ api }: VoiceWorkspaceProps): ReactElement {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [detail, setDetail] = useState<string | null>(null);

  const persistTranscript = useCallback(async (text: string) => {
    const capturedAt = Date.now();
    const path = `inbox/voice-${capturedAt}`;
    setState('saving');
    setDetail(null);
    try {
      const note = await api.notes.create({
        path,
        title: titleForTranscript(text) || '语音笔记',
        body: text,
        tags: ['voice'],
        type: 'note',
        status: 'active',
      });
      await api.kg.reindexNote(note.path);
      setState('saved');
      setDetail(note.path);
    } catch (cause) {
      setState('error');
      setDetail(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }, [api]);

  return (
    <section className="workspace voice-workspace" data-testid="voice-workspace">
      <header className="workspace__header">
        <div>
          <h2>Voice</h2>
          <p>转写成功后自动创建本地笔记，并触发知识图谱增量索引。</p>
        </div>
      </header>
      <VoiceInput onTranscribe={persistTranscript} showProviderBadge />
      {state === 'saving' ? <WorkspaceState kind="loading" title="正在保存并更新索引…" /> : null}
      {state === 'saved' ? <WorkspaceState kind="success" title="语音笔记已入库" detail={detail ?? undefined} /> : null}
      {state === 'error' ? <WorkspaceState kind="error" title="转写成功，但入库失败" detail={detail ?? undefined} /> : null}
    </section>
  );
}
