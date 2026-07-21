import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BackupManagementSettings } from '../../src/renderer/components/Settings/BackupManagementSettings';
import { registerBackupIpc } from '../../src/main/backup-integration/ipc';

const draft = {
  consentId: '11111111-1111-4111-8111-111111111111',
  region: 'ap-shanghai',
  bucket: 'copilot-123456',
  selectedScopes: ['note-markdown', 'note-metadata'] as const,
  estimatedEncryptedBytes: 4096,
  counts: { notes: 1 },
  retentionAndDelete: 'Retention and exact-object delete disclosure',
  keyLoss: 'Key loss makes ciphertext unrestorable',
  cloudCannotDecrypt: 'Cloud cannot decrypt',
  exactFirstUpload: 'Create one encrypted local snapshot; upload only after a separate Upload click.' as const,
  issuedAtMs: Date.now(),
  expiresAtMs: Date.now() + 60_000,
};

function installBackupBridge() {
  const state = {
    enabled: false,
    configured: true,
    region: 'ap-shanghai',
    platformProtection: 'macOS Keychain via Electron safeStorage' as const,
    catalog: [],
    allowedScopes: [],
    activeOperation: null,
    schedulingAvailable: false as const,
    replaceCurrentAvailable: false as const,
  };
  const bridge = {
    getState: vi.fn().mockResolvedValue(state),
    prepareEnable: vi.fn().mockResolvedValue(draft),
    enable: vi.fn().mockResolvedValue({ ...state, enabled: true }),
    disable: vi.fn(), create: vi.fn(), upload: vi.fn(), downloadVerify: vi.fn(), restorePreview: vi.fn(), deleteRemote: vi.fn(),
  };
  (window as unknown as { copilot: unknown }).copilot = { backup: bridge };
  return bridge;
}

describe('Backup owner consent UI', () => {
  it('has no direct switch or prechecked scope and shows the complete consent before enable', async () => {
    const bridge = installBackupBridge();
    render(<BackupManagementSettings />);
    await screen.findByText(/State: OFF/);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.every((item) => !item.checked)).toBe(true);
    expect(screen.getByRole('button', { name: 'Review owner consent' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Notes metadata + Markdown'));
    fireEvent.click(screen.getByRole('button', { name: 'Review owner consent' }));
    await screen.findByText(/Estimated encrypted bytes: 4096/);
    expect(screen.getByText(/Retention and exact-object delete/)).toBeInTheDocument();
    expect(screen.getByText(/Key loss makes ciphertext unrestorable/)).toBeInTheDocument();
    expect(screen.getByText(/Cloud cannot decrypt/)).toBeInTheDocument();
    expect(screen.getByText(/Exact first action: Create one encrypted local snapshot/)).toBeInTheDocument();
    expect(bridge.prepareEnable).toHaveBeenCalledWith(['note-markdown', 'note-metadata']);
    expect(screen.getByRole('button', { name: 'Enable after explicit consent' })).toBeDisabled();
    for (const label of [
      /Retention and exact-object delete/,
      /Key loss makes ciphertext unrestorable/,
      /Cloud cannot decrypt/,
      /Exact first action: Create one encrypted local snapshot/,
    ]) fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(screen.getByRole('button', { name: 'Enable after explicit consent' }));
    await waitFor(() => expect(bridge.enable).toHaveBeenCalledTimes(1));
    expect(bridge.enable.mock.calls[0]?.[0]).not.toHaveProperty('approved');
  });
});

describe('Backup IPC trust boundary', () => {
  it('rejects an untrusted renderer before touching runtime', () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
    const runtime = { getState: vi.fn() };
    registerBackupIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, () => runtime as never, (event) => (event as { trusted?: boolean }).trusted === true);
    expect(() => handlers.get('copilot:backup:get-state')?.({ trusted: false })).toThrowError(expect.objectContaining({ code: 'PRESIGN_FORBIDDEN' }));
    expect(runtime.getState).not.toHaveBeenCalled();
  });
});
