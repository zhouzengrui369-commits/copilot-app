// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceWorkspace } from '../src/renderer/workspaces/VoiceWorkspace.js';
import type { CopilotProductApi } from '../src/renderer/lib/copilot-api.js';

vi.mock('../src/renderer/components/VoiceInput/index.js', () => ({
  VoiceInput: ({ onTranscriptDraft }: {
    onTranscriptDraft?(text: string, requestId: string): void;
  }) => React.createElement(
    'button',
    {
      type: 'button',
      'data-testid': 'voice-workspace-local-result',
      onClick: () => onTranscriptDraft?.(
        'Voice route 本地转写',
        'de305d54-75b4-431b-adb2-eb6b9e546014',
      ),
    },
    'LOCAL ASR · NOT_READY',
  ),
}));

function api(): CopilotProductApi {
  return {
    notes: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      create: vi.fn(async (input) => ({
        ...input,
        path: 'inbox/voice-explicit',
        body: input.body,
        localState: 'LOCAL_SAVED' as const,
        knowledgeBuild: { state: 'queued' as const, revision: 'voice-explicit' },
      })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      getBacklinks: vi.fn(async () => []),
    },
    kg: {
      getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
      reindexNote: vi.fn(async () => ({ entitiesAdded: 1, entitiesLinked: 0 })),
    },
    rag: { ask: vi.fn(async () => ({ text: '', sources: [] })) },
    todos: {
      list: vi.fn(async () => []),
      create: vi.fn(async (input) => ({ id: 'todo', status: 'pending', ...input })),
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      listDue: vi.fn(async () => []),
      markReminderFired: vi.fn(async () => null),
    },
  };
}

describe('VoiceWorkspace local draft ownership', () => {
  it('reuses Schedule explicit-save flow and cannot persist on transcript delivery', async () => {
    const productApi = api();
    render(<VoiceWorkspace api={productApi} />);
    await waitFor(() => expect(productApi.todos.list).toHaveBeenCalled());
    fireEvent.click(screen.getByText('开始本地语音'));
    fireEvent.click(screen.getByTestId('voice-workspace-local-result'));
    expect(screen.getByTestId('today-capture-draft')).toHaveValue('Voice route 本地转写');
    expect(productApi.notes.create).not.toHaveBeenCalled();
    expect(productApi.kg.reindexNote).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存为本地笔记' }));
    });
    expect(productApi.notes.create).toHaveBeenCalledTimes(1);
    expect(productApi.kg.reindexNote).not.toHaveBeenCalled();
    expect(screen.getByText('已保存到本地笔记。')).toBeInTheDocument();
  });
});
