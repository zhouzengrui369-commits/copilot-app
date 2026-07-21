import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteApprovalRequest } from '../../src/shared/remote-management';
import { RemoteApprovalModal } from '../../src/renderer/components/RemoteManagement/RemoteApprovalModal';

const request: RemoteApprovalRequest = {
  approvalToken: Buffer.alloc(32, 7).toString('base64url'),
  commandDigest: 'a'.repeat(64),
  deadlineMs: Date.now() + 60_000,
  commandId: '33333333-3333-4333-8333-333333333333',
  controllerId: 'controller-01',
  initiatedBy: 'ai',
  action: 'note.move_to_trash',
  resource: { type: 'note', id: 'remote/synthetic-note' },
  reason: 'Owner-requested cleanup',
  expiresAtMs: Date.now() + 60_000,
  proposedFields: { title: 'Synthetic note' },
  diff: [{ field: 'status', before: 'active', after: 'trash' }],
  localTruthWarning: 'Local data remains the authoritative truth.',
  destructiveWarning: 'This moves the note to reversible local trash. It never permanently deletes it.',
  approvalScope: 'single-command',
  approveAll: false,
  controllerApprovalVerified: true,
};

describe('Remote A desktop approval modal', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'copilot', {
      configurable: true,
      value: {
        remote: {
          onApprovalRequest: vi.fn(() => () => undefined),
          respondApproval: vi.fn(async () => ({ accepted: true })),
        },
      },
    });
  });

  it('shows controller, AI/user origin, exact action/resource, fields/diff, reason, expiry and local truth', () => {
    render(<RemoteApprovalModal initialRequest={request} />);
    expect(screen.getByRole('dialog', { name: /remote command approval/i })).toBeInTheDocument();
    expect(screen.getByText('controller-01')).toBeInTheDocument();
    expect(screen.getByText(/AI-originated/i)).toBeInTheDocument();
    expect(screen.getByText('note.move_to_trash')).toBeInTheDocument();
    expect(screen.getByText('remote/synthetic-note')).toBeInTheDocument();
    expect(screen.getByText(/Owner-requested cleanup/)).toBeInTheDocument();
    expect(screen.getByText(/Local data remains the authoritative truth/)).toBeInTheDocument();
    expect(screen.getByText(/reversible local trash/i)).toBeInTheDocument();
    expect(screen.getByText(/Synthetic note/)).toBeInTheDocument();
    expect(screen.getByText(/active/)).toBeInTheDocument();
    expect(screen.getAllByText(/trash/).length).toBeGreaterThan(0);
  });

  it('has only command-specific approve/reject actions and no approve-all', async () => {
    render(<RemoteApprovalModal initialRequest={request} />);
    expect(screen.queryByText(/approve all/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve this command/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /approve this command/i }));
    });
    expect(window.copilot?.remote.respondApproval).toHaveBeenCalledWith({
      approvalToken: request.approvalToken,
      commandDigest: request.commandDigest,
      deadlineMs: request.deadlineMs,
      commandId: request.commandId,
      decision: 'approve',
    });
  });
});
