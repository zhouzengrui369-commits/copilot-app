import { useEffect, useState } from 'react';
import type { RemoteClientState } from '../../../shared/remote-management.js';

const UNPAIRED = {
  configured: false,
  revoked: false,
  recoveryRequired: false,
  pendingRequest: false,
  keyEpoch: null,
  ownerFingerprint: null,
  controllerFingerprint: null,
  targetFingerprint: null,
  expiresAtMs: null,
};

const OFF: RemoteClientState = {
  enabled: false,
  ownerConsentAtMs: null,
  connection: 'disabled',
  queuedCommands: 0,
  lastErrorCode: null,
};

export function RemoteManagementSettings() {
  const [state, setState] = useState<RemoteClientState>(OFF);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const remote = window.copilot?.remote;
    if (!remote) {
      setError('Remote management is unavailable and remains OFF.');
      return;
    }
    void remote.getState().then(setState).catch(() => {
      setError('Remote management is unavailable and remains OFF.');
    });
  }, []);

  const toggle = async () => {
    const remote = window.copilot?.remote;
    if (!remote) {
      setError('Remote management is unavailable and remains OFF.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (state.enabled) {
        setState(await remote.disable());
      } else {
        const consent = window.confirm(
          'Enable online-only remote management? Every command still requires a separate desktop approval. Offline commands are not queued. Local data remains truth.',
        );
        if (!consent) return;
        setState(await remote.enable({ ownerConsent: true }));
      }
    } catch {
      setError('Remote management was not enabled. Pairing, secure credentials, and WSS configuration are required.');
      setState(await remote.getState().catch(() => OFF));
    } finally {
      setBusy(false);
    }
  };

  const importPairing = async () => {
    const remote = window.copilot?.remote;
    if (!remote) return setError('Remote management is unavailable and remains OFF.');
    setBusy(true);
    setError(null);
    try {
      setState(await remote.importPairing());
    } catch {
      setError('Pairing response was rejected. Its request binding, encryption, signature, expiry, or OS credential state is invalid.');
      setState(await remote.getState().catch(() => OFF));
    } finally {
      setBusy(false);
    }
  };

  const createPairingRequest = async () => {
    const remote = window.copilot?.remote;
    if (!remote) return setError('Remote management is unavailable and remains OFF.');
    setBusy(true);
    setError(null);
    try {
      setState(await remote.createPairingRequest());
    } catch {
      setError('Public pairing request creation failed. Remote remains OFF and no private key was exported.');
      setState(await remote.getState().catch(() => OFF));
    } finally {
      setBusy(false);
    }
  };

  const revokePairing = async () => {
    const remote = window.copilot?.remote;
    if (!remote) return setError('Remote management is unavailable and remains OFF.');
    if (!window.confirm('Revoke this desktop pairing and remove its OS-protected credentials?')) return;
    setBusy(true);
    setError(null);
    try {
      setState(await remote.revokePairing());
    } catch {
      setError('Pairing revocation was incomplete. Remote remains OFF; retry after unlocking the OS credential store.');
      setState(await remote.getState().catch(() => OFF));
    } finally {
      setBusy(false);
    }
  };

  const pairing = state.pairing ?? UNPAIRED;

  return (
    <fieldset className="settings-panel__group" data-testid="settings-remote-management-group">
      <legend>Remote management</legend>
      <p>
        Online-only, no queue or replay. Every note/todo command requires a
        command-specific desktop approval; AI-originated commands require both
        controller and desktop owner approval.
      </p>
      <p data-testid="remote-management-state">
        State: <code>{state.enabled ? `ON · ${state.connection}` : 'OFF'}</code>
        {' · '}Queued commands: <code>{state.queuedCommands}</code>
      </p>
      <p data-testid="remote-pairing-status">
        Pairing: <code>{pairing.recoveryRequired ? 'recovery required · OFF' : pairing.configured ? `verified · epoch ${pairing.keyEpoch}` : pairing.pendingRequest ? 'public request created' : pairing.revoked ? 'revoked' : 'required'}</code>
        {pairing.configured ? (
          <>
            {' · '}Owner <code>{pairing.ownerFingerprint}</code>
            {' · '}Controller <code>{pairing.controllerFingerprint}</code>
            {' · '}Target <code>{pairing.targetFingerprint}</code>
          </>
        ) : null}
      </p>
      <button type="button" onClick={() => void createPairingRequest()} disabled={busy || state.enabled || pairing.recoveryRequired}>
        Create public pairing request
      </button>{' '}
      <button type="button" onClick={() => void importPairing()} disabled={busy || state.enabled || !pairing.pendingRequest || pairing.recoveryRequired}>
        Import encrypted signed response
      </button>{' '}
      <button type="button" onClick={() => void revokePairing()} disabled={busy || !pairing.configured}>
        Revoke pairing
      </button>{' '}
      <button type="button" onClick={() => void toggle()} disabled={busy || pairing.recoveryRequired || (!state.enabled && !pairing.configured)}>
        {state.enabled ? 'Disable remote management' : 'Enable with owner consent'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      <small>
        Disabling closes the socket and clears session material. It never changes
        local notes or todos and preserves only the redacted local audit.
      </small>
    </fieldset>
  );
}
