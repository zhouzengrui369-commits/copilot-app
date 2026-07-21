import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RemoteApprovalLifecycleEvent,
  RemoteApprovalRequest,
} from '../../src/shared/remote-management';
import { RemoteApprovalModal } from '../../src/renderer/components/RemoteManagement/RemoteApprovalModal';

const base: RemoteApprovalRequest = {
  approvalToken: Buffer.alloc(32, 1).toString('base64url'),
  commandDigest: 'a'.repeat(64),
  deadlineMs: 20_000,
  commandId: '33333333-3333-4333-8333-333333333333',
  controllerId: 'controller-01',
  initiatedBy: 'user',
  action: 'note.read',
  resource: { type: 'note', id: 'remote/first' },
  reason: 'First request',
  expiresAtMs: 20_000,
  proposedFields: {},
  diff: [],
  localTruthWarning: 'Local truth remains authoritative.',
  destructiveWarning: null,
  approvalScope: 'single-command',
  approveAll: false,
  controllerApprovalVerified: true,
};

describe('Remote A r2 approval modal lifecycle', () => {
  let approvalListener: ((request: RemoteApprovalRequest) => void) | null;
  let lifecycleListener: ((event: RemoteApprovalLifecycleEvent) => void) | null;

  beforeEach(() => {
    approvalListener = null;
    lifecycleListener = null;
    Object.defineProperty(window, 'copilot', {
      configurable: true,
      value: {
        remote: {
          onApprovalRequest: vi.fn((listener) => {
            approvalListener = listener;
            return () => undefined;
          }),
          onApprovalLifecycle: vi.fn((listener) => {
            lifecycleListener = listener;
            return () => undefined;
          }),
          respondApproval: vi.fn(async () => ({ accepted: true })),
        },
      },
    });
  });

  afterEach(() => vi.useRealTimers());

  it('queues multiple pending prompts without overwriting and removes them on main lifecycle events', () => {
    render(<RemoteApprovalModal />);
    const second: RemoteApprovalRequest = {
      ...base,
      approvalToken: Buffer.alloc(32, 2).toString('base64url'),
      commandDigest: 'b'.repeat(64),
      commandId: '55555555-5555-4555-8555-555555555555',
      resource: { type: 'note', id: 'remote/second' },
      reason: 'Second request',
    };
    act(() => {
      approvalListener?.(base);
      approvalListener?.(second);
    });
    expect(screen.getByText('First request')).toBeInTheDocument();
    expect(screen.queryByText('Second request')).not.toBeInTheDocument();
    act(() => lifecycleListener?.({
      approvalToken: base.approvalToken,
      commandId: base.commandId,
      state: 'resolved',
    }));
    expect(screen.getByText('Second request')).toBeInTheDocument();
    act(() => lifecycleListener?.({
      approvalToken: second.approvalToken,
      commandId: second.commandId,
      state: 'cancelled',
    }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rerenders against the deadline and disables approval even before another UI event', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    render(<RemoteApprovalModal initialRequest={{ ...base, deadlineMs: 10_200, expiresAtMs: 10_200 }} />);
    expect(screen.getByRole('button', { name: /approve this command/i })).toBeEnabled();
    act(() => {
      vi.setSystemTime(10_250);
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByRole('button', { name: /approve this command/i })).toBeDisabled();
    expect(screen.getByText(/expired and cannot be approved/i)).toBeInTheDocument();
  });
});
