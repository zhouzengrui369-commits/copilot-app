import { useEffect, useState } from 'react';
import type {
  RemoteApprovalRequest,
  RemoteApprovalResponse,
} from '../../../shared/remote-management.js';

export function RemoteApprovalModal({
  initialRequest = null,
}: {
  initialRequest?: RemoteApprovalRequest | null;
}) {
  const [queue, setQueue] = useState<RemoteApprovalRequest[]>(initialRequest ? [initialRequest] : []);
  const [nowMs, setNowMs] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const remote = window.copilot?.remote;
    if (!remote) return;
    return remote.onApprovalRequest((next) => {
      setError(null);
      setQueue((current) => current.some((item) => item.approvalToken === next.approvalToken)
        ? current
        : [...current, next]);
    });
  }, []);

  useEffect(() => {
    const remote = window.copilot?.remote;
    if (!remote?.onApprovalLifecycle) return;
    return remote.onApprovalLifecycle((event) => {
      setQueue((current) => current.filter((item) => item.approvalToken !== event.approvalToken));
      setSubmitting(false);
    });
  }, []);

  const request = queue[0] ?? null;
  useEffect(() => {
    if (!request) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [request?.approvalToken]);

  if (!request) return null;
  const expired = nowMs >= request.deadlineMs;

  const respond = async (decision: RemoteApprovalResponse['decision']) => {
    const remote = window.copilot?.remote;
    if (!remote) {
      setError('Remote bridge unavailable. No command was executed.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await remote.respondApproval({
        approvalToken: request.approvalToken,
        commandDigest: request.commandDigest,
        deadlineMs: request.deadlineMs,
        commandId: request.commandId,
        decision,
      });
      setQueue((current) => current.filter((item) => item.approvalToken !== request.approvalToken));
    } catch {
      setError('Approval response failed. No approval was granted.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="remote-approval-backdrop" role="presentation">
      <section
        className="remote-approval-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Remote command approval"
        data-testid="remote-approval-modal"
      >
        <header>
          <h2>Remote command approval</h2>
          <p>
            {request.initiatedBy === 'ai'
              ? 'AI-originated command: controller approval was verified; desktop owner approval is still required.'
              : 'User-originated command: desktop owner approval is required.'}
          </p>
        </header>

        <dl>
          <dt>Controller</dt><dd>{request.controllerId}</dd>
          <dt>Action</dt><dd><code>{request.action}</code></dd>
          <dt>Resource</dt><dd>{request.resource.id ?? `${request.resource.type} (new/list scope)`}</dd>
          <dt>Reason</dt><dd>{request.reason}</dd>
          <dt>Expires</dt><dd>{new Date(request.deadlineMs).toISOString()}</dd>
          <dt>Approval scope</dt><dd>Single command only</dd>
        </dl>

        <p className="remote-approval-modal__truth"><strong>{request.localTruthWarning}</strong></p>
        {request.destructiveWarning ? (
          <p className="remote-approval-modal__danger" role="alert">
            <strong>{request.destructiveWarning}</strong>
          </p>
        ) : null}

        <section aria-label="Proposed fields">
          <h3>Proposed fields</h3>
          <pre>{safeDisplay(request.proposedFields)}</pre>
        </section>
        <section aria-label="Local diff">
          <h3>Local diff</h3>
          <pre>{safeDisplay(request.diff)}</pre>
        </section>

        {expired ? <p role="alert">This command expired and cannot be approved.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          <button
            type="button"
            onClick={() => void respond('reject')}
            disabled={submitting}
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => void respond('approve')}
            disabled={submitting || expired}
          >
            Approve this command
          </button>
        </footer>
      </section>
    </div>
  );
}

function safeDisplay(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unavailable]';
  }
}
