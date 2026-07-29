import { useState } from 'react';
import type { ReactElement } from 'react';
import type { CopilotProductApi } from '../lib/copilot-api.js';
import { ScheduleWorkspace } from './ScheduleWorkspace.js';

interface VoiceWorkspaceProps {
  api: CopilotProductApi;
}

export function VoiceWorkspace({ api }: VoiceWorkspaceProps): ReactElement {
  const [captureDraft, setCaptureDraft] = useState('');
  return (
    <ScheduleWorkspace
      api={api}
      captureDraft={captureDraft}
      onCaptureDraftChange={setCaptureDraft}
    />
  );
}
