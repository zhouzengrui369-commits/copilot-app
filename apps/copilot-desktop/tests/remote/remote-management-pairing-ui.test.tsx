import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteManagementSettings } from '../../src/renderer/components/RemoteManagement/RemoteManagementSettings';
import type { RemoteClientState } from '../../src/shared/remote-management';

const unpaired: RemoteClientState = {
  enabled: false,
  ownerConsentAtMs: null,
  connection: 'disabled',
  queuedCommands: 0,
  lastErrorCode: null,
  pairing: {
    configured: false,
    revoked: false,
    recoveryRequired: false,
    pendingRequest: false,
    keyEpoch: null,
    ownerFingerprint: null,
    controllerFingerprint: null,
    targetFingerprint: null,
    expiresAtMs: null,
  },
};

const paired: RemoteClientState = {
  ...unpaired,
  pairing: {
    configured: true,
    revoked: false,
    recoveryRequired: false,
    pendingRequest: false,
    keyEpoch: 2,
    ownerFingerprint: '111111111111',
    controllerFingerprint: '222222222222',
    targetFingerprint: '333333333333',
    expiresAtMs: 1_700_000_060_000,
  },
};

const pending: RemoteClientState = {
  ...unpaired,
  pairing: { ...unpaired.pairing!, pendingRequest: true },
};

describe('Remote management pairing Settings surface', () => {
  const getState = vi.fn(async () => unpaired);
  const createPairingRequest = vi.fn(async () => pending);
  const importPairing = vi.fn(async () => paired);
  const revokePairing = vi.fn(async () => ({ ...unpaired, pairing: { ...unpaired.pairing!, revoked: true } }));
  const enable = vi.fn(async () => ({ ...paired, enabled: true, connection: 'connecting' as const }));
  const disable = vi.fn(async () => paired);

  beforeEach(() => {
    getState.mockResolvedValue(unpaired);
    importPairing.mockResolvedValue(paired);
    Object.defineProperty(window, 'copilot', {
      configurable: true,
      value: {
        remote: {
          getState,
          createPairingRequest,
          importPairing,
          revokePairing,
          enable,
          disable,
          respondApproval: vi.fn(),
          onApprovalRequest: vi.fn(() => () => undefined),
          onApprovalLifecycle: vi.fn(() => () => undefined),
        },
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('creates a public request before encrypted response import, then enables and revokes separately', async () => {
    render(<RemoteManagementSettings />);
    expect(await screen.findByText(/Pairing:/)).toHaveTextContent('required');
    expect(screen.getByRole('button', { name: /enable with owner consent/i })).toBeDisabled();

    expect(screen.getByRole('button', { name: /import encrypted signed response/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /create public pairing request/i }));
    await waitFor(() => expect(createPairingRequest).toHaveBeenCalledOnce());
    expect(screen.getByTestId('remote-pairing-status')).toHaveTextContent('public request created');
    fireEvent.click(screen.getByRole('button', { name: /import encrypted signed response/i }));
    await waitFor(() => expect(importPairing).toHaveBeenCalledOnce());
    expect(screen.getByTestId('remote-pairing-status')).toHaveTextContent('verified · epoch 2');
    expect(screen.getByTestId('remote-pairing-status')).toHaveTextContent('111111111111');
    expect(screen.getByTestId('remote-pairing-status')).toHaveTextContent('222222222222');
    expect(screen.getByTestId('remote-pairing-status')).toHaveTextContent('333333333333');
    expect(document.body.textContent).not.toContain('owner-opaque');
    expect(screen.getByRole('button', { name: /enable with owner consent/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /enable with owner consent/i }));
    await waitFor(() => expect(enable).toHaveBeenCalledWith({ ownerConsent: true }));
    fireEvent.click(screen.getByRole('button', { name: /disable remote management/i }));
    await waitFor(() => expect(disable).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: /revoke pairing/i }));
    await waitFor(() => expect(revokePairing).toHaveBeenCalledOnce());
  });

  it('surfaces static import failure without displaying bundle bytes or paths', async () => {
    importPairing.mockRejectedValueOnce(new Error('/private/pairing.copilot-pairing TOKEN_CANARY'));
    render(<RemoteManagementSettings />);
    await screen.findByText(/Pairing:/);
    fireEvent.click(screen.getByRole('button', { name: /create public pairing request/i }));
    await waitFor(() => expect(createPairingRequest).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /import encrypted signed response/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pairing response was rejected');
    expect(screen.getByRole('alert')).not.toHaveTextContent('TOKEN_CANARY');
    expect(screen.getByRole('alert')).not.toHaveTextContent('/private/');
  });
});
