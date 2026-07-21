// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackupApprovalModal } from '../../src/renderer/components/Settings/BackupApprovalModal.js';
import type { BackupApprovalRequest } from '../../src/shared/backup-management.js';

const request: BackupApprovalRequest = {
  commandId: '11111111-1111-4111-8111-111111111111',
  commandDigest: 'a'.repeat(64),
  issuedAtMs: Date.now() - 1_000,
  deadlineMs: Date.now() + 60_000,
  action: 'delete',
  scopes: ['todos'],
  objectId: 'safe-object-id',
  bytes: 321,
  sha256: 'b'.repeat(64),
  destructiveWarning: 'Permanent encrypted object deletion.',
};

afterEach(() => {
  delete (window as unknown as { copilot?: unknown }).copilot;
});

describe('Backup approval modal r1', () => {
  it('defaults focus to Cancel and returns only the exact bound rejection', async () => {
    let listener: ((value: BackupApprovalRequest) => void) | null = null;
    const respondApproval = vi.fn().mockResolvedValue({ accepted: true });
    (window as unknown as { copilot: unknown }).copilot = {
      backup: {
        onApprovalRequest: (next: (value: BackupApprovalRequest) => void) => { listener = next; return () => undefined; },
        onApprovalLifecycle: () => () => undefined,
        respondApproval,
      },
    };
    render(<BackupApprovalModal />);
    await act(async () => listener?.(request));
    expect(screen.getByRole('dialog', { name: 'Encrypted backup approval' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.queryByText(/token|credential|local path/i)).not.toBeInTheDocument();
    expect(respondApproval).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(respondApproval).toHaveBeenCalledWith({
      commandId: request.commandId,
      commandDigest: request.commandDigest,
      deadlineMs: request.deadlineMs,
      decision: 'reject',
    });
  });

  it('disables exact-deadline confirmation and never auto-approves an expired prompt', async () => {
    let listener: ((value: BackupApprovalRequest) => void) | null = null;
    const respondApproval = vi.fn().mockResolvedValue({ accepted: true });
    (window as unknown as { copilot: unknown }).copilot = {
      backup: {
        onApprovalRequest: (next: (value: BackupApprovalRequest) => void) => { listener = next; return () => undefined; },
        onApprovalLifecycle: () => () => undefined,
        respondApproval,
      },
    };
    render(<BackupApprovalModal />);
    await act(async () => listener?.({ ...request, issuedAtMs: Date.now() - 60_000, deadlineMs: Date.now() }));
    const confirm = screen.getByRole('button', { name: 'Confirm once' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('expired');
    fireEvent.click(confirm);
    expect(respondApproval).not.toHaveBeenCalled();
  });

  it('submits an approval at most once while the exact response is pending', async () => {
    let listener: ((value: BackupApprovalRequest) => void) | null = null;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const respondApproval = vi.fn(() => pending);
    (window as unknown as { copilot: unknown }).copilot = {
      backup: {
        onApprovalRequest: (next: (value: BackupApprovalRequest) => void) => { listener = next; return () => undefined; },
        onApprovalLifecycle: () => () => undefined,
        respondApproval,
      },
    };
    render(<BackupApprovalModal />);
    await act(async () => listener?.({ ...request, deadlineMs: Date.now() + 60_000 }));
    const confirm = screen.getByRole('button', { name: 'Confirm once' });
    fireEvent.click(confirm);
    await act(async () => undefined);
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(respondApproval).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });
});
