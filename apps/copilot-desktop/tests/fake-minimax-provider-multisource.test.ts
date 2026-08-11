import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeMiniMaxProvider,
  type FakeMiniMaxProvider,
} from './e2e/helpers/fake-minimax-provider.js';

const providers: FakeMiniMaxProvider[] = [];

async function requestGroundedAnswer(
  prompt: string,
): Promise<{ status: number; content: string }> {
  const provider = await startFakeMiniMaxProvider({ profile: 'grounded-rag' });
  providers.push(provider);
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'MiniMax-M3',
      stream: true,
      messages: [
        { role: 'system', content: 'grounded test' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const body = await response.text();
  const firstData = body
    .split('\n')
    .find((line) => line.startsWith('data: {'))
    ?.slice('data: '.length);
  const parsed = firstData ? JSON.parse(firstData) as {
    choices?: Array<{ delta?: { content?: string } }>;
  } : null;
  return {
    status: response.status,
    content: parsed?.choices?.[0]?.delta?.content ?? '',
  };
}

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

describe('fake MiniMax grounded multi-source citations', () => {
  it('cites all unique numbered note paths in prompt order', async () => {
    const result = await requestGroundedAnswer([
      '用户问题: 多来源事实',
      '',
      '可用笔记 (note_path → 正文片段):',
      '(1) [e2e/source-a]',
      'source A',
      '',
      '(2) [e2e/source-b]',
      'source B',
      '',
      '(3) [e2e/source-a]',
      'duplicate source A',
    ].join('\n'));

    expect(result.status).toBe(200);
    expect(result.content).toBe(
      '该回答仅依据已完成索引的本地笔记。'
      + '(来源: e2e/source-a) (来源: e2e/source-b)',
    );
  });

  it('rejects a grounded prompt without any numbered local note path', async () => {
    const result = await requestGroundedAnswer('用户问题: 没有可用笔记');

    expect(result.status).toBe(422);
    expect(result.content).toBe('');
  });
});
