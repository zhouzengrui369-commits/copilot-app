import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { registerBackupIpc } from '../../src/main/backup-integration/ipc';
import { BackupManagementSettings } from '../../src/renderer/components/Settings/BackupManagementSettings';

const SNAPSHOT = '11111111-1111-4111-8111-111111111111';
const DIGEST = 'a'.repeat(64);

function installBridge() {
  const state = {
    enabled: true,
    configured: true,
    region: 'ap-shanghai',
    platformProtection: 'macOS Keychain via Electron safeStorage' as const,
    catalog: [{ snapshotId: SNAPSHOT, sha256: 'b'.repeat(64), bytes: 4096, createdAtMs: 1, status: 'verified' as const }],
    allowedScopes: ['note-markdown', 'note-metadata', 'todos'] as const,
    activeOperation: null,
    schedulingAvailable: false as const,
    replaceCurrentAvailable: false as const,
    recoveryRequired: false,
  };
  const preview = {
    snapshotId: SNAPSHOT, files: 3, records: 2, conflicts: [], mode: 'import-as-copy' as const,
    selectedScopes: ['note-markdown', 'note-metadata', 'todos'] as const,
    previewDigest: DIGEST, generation: 7, replaceCurrentAvailable: false as const,
  };
  const bridge = {
    getState: vi.fn().mockResolvedValue(state),
    restorePreview: vi.fn().mockResolvedValue(preview),
    restoreApply: vi.fn().mockResolvedValue({
      snapshotId: SNAPSHOT, previewDigest: DIGEST, importedNotes: 1, importedTodos: 1,
      importNamespace: `backup-import-${SNAPSHOT}`, conflictCount: 0,
      rollbackStatus: 'not-required', replaceCurrentAvailable: false,
    }),
    prepareEnable: vi.fn(), enable: vi.fn(), disable: vi.fn(), create: vi.fn(),
    upload: vi.fn(), downloadVerify: vi.fn(), deleteRemote: vi.fn(), respondApproval: vi.fn(),
    onApprovalRequest: vi.fn(() => () => undefined),
    onApprovalLifecycle: vi.fn(() => () => undefined),
  };
  (window as unknown as { copilot: unknown }).copilot = { backup: bridge };
  return { bridge, preview };
}

describe('Backup restore import-as-copy UI', () => {
  it('keeps preview and apply separate, passes the exact binding, and uses truthful non-overwrite copy', async () => {
    const { bridge, preview } = installBridge();
    render(<BackupManagementSettings />);
    await screen.findByText(/State: ON/);

    const apply = screen.getByRole('button', { name: 'Import verified copy' });
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Restore preview' }));
    const previewContainer = await screen.findByTestId('backup-restore-preview');
    const digestCode = previewContainer.querySelector('p > code');
    expect(digestCode?.parentElement?.firstChild?.textContent).toBe('Preview digest: ');
    expect(digestCode?.textContent).toBe(DIGEST);
    expect(screen.getByText(/never overwrites current notes or Todos/i)).toBeInTheDocument();
    expect(screen.getByText(/fresh one-shot approval and a new download\/verification/i)).toBeInTheDocument();
    expect(apply).toBeEnabled();

    fireEvent.click(apply);
    await waitFor(() => expect(bridge.restoreApply).toHaveBeenCalledWith({
      snapshotId: SNAPSHOT,
      selectedScopes: [...preview.selectedScopes],
      previewDigest: DIGEST,
      generation: 7,
    }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Imported verified copy: 1 notes and 1 Todos/);
    expect(screen.getByRole('status')).toHaveTextContent(/Current data was not replaced/);
  });
});

describe('Backup restore apply IPC boundary', () => {
  it('accepts only the exact payload keys and forwards no replace-current or plaintext fields', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
    const runtime = { restoreApply: vi.fn(async (value) => value) };
    registerBackupIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      () => runtime as never,
      (event) => (event as { trusted?: boolean }).trusted === true,
    );
    const request = {
      snapshotId: SNAPSHOT,
      selectedScopes: ['note-markdown', 'note-metadata', 'todos'],
      previewDigest: DIGEST,
      generation: 7,
    };
    await expect(handlers.get('copilot:backup:restore-apply')?.({ trusted: true }, request))
      .resolves.toEqual(request);
    expect(runtime.restoreApply).toHaveBeenCalledWith(request);
    expect(() => handlers.get('copilot:backup:restore-apply')?.(
      { trusted: true },
      { ...request, replaceCurrent: true },
    )).toThrowError(expect.objectContaining({ code: 'PRESIGN_FORBIDDEN' }));
    expect(() => handlers.get('copilot:backup:restore-apply')?.(
      { trusted: true },
      { ...request, plaintext: '# forbidden' },
    )).toThrowError(expect.objectContaining({ code: 'PRESIGN_FORBIDDEN' }));
  });
});
