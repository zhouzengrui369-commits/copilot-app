import { useEffect, useState } from 'react';
import type {
  BackupApprovalRequest,
  BackupApprovalResponse,
} from '../../../shared/backup-management.js';

export function BackupApprovalModal() {
  const [queue, setQueue] = useState<BackupApprovalRequest[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const backup = window.copilot?.backup;
    if (!backup) return;
    return backup.onApprovalRequest((next) => {
      setError(null);
      setQueue((current) => current.some((item) => item.commandId === next.commandId)
        ? current
        : [...current, next]);
    });
  }, []);

  useEffect(() => {
    const backup = window.copilot?.backup;
    if (!backup) return;
    return backup.onApprovalLifecycle((event) => {
      setQueue((current) => current.filter((item) => item.commandId !== event.commandId));
      setSubmitting(false);
    });
  }, []);

  const request = queue[0] ?? null;
  useEffect(() => {
    if (!request) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [request?.commandId]);

  if (!request) return null;
  const expired = nowMs >= request.deadlineMs;

  const respond = async (decision: BackupApprovalResponse['decision']) => {
    const backup = window.copilot?.backup;
    if (!backup) return setError('Backup bridge unavailable. No command was approved.');
    setSubmitting(true);
    setError(null);
    try {
      await backup.respondApproval({
        commandId: request.commandId,
        commandDigest: request.commandDigest,
        deadlineMs: request.deadlineMs,
        decision,
      });
    } catch {
      setError('Approval response failed. No command was approved.');
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
        aria-label="Encrypted backup approval"
        data-testid="backup-approval-modal"
      >
        <header>
          <h2>Confirm encrypted backup command</h2>
          <p>Approval applies to this command once. Cancel is the default.</p>
        </header>
        <dl>
          <dt>Action</dt><dd><code>{request.action}</code></dd>
          <dt>Scope</dt><dd>{request.scopes.join(', ') || 'none'}</dd>
          <dt>Object</dt><dd>{request.objectId}</dd>
          <dt>Bytes</dt><dd>{request.bytes}</dd>
          <dt>SHA-256</dt><dd><code>{request.sha256}</code></dd>
          <dt>Expires</dt><dd>{new Date(request.deadlineMs).toISOString()}</dd>
        </dl>
        {request.destructiveWarning ? (
          <p className="remote-approval-modal__danger" role="alert"><strong>{request.destructiveWarning}</strong></p>
        ) : null}
        {expired ? <p role="alert">This command expired and cannot be approved.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          <button type="button" autoFocus onClick={() => void respond('reject')} disabled={submitting}>Cancel</button>
          <button type="button" onClick={() => void respond('approve')} disabled={submitting || expired}>Confirm once</button>
        </footer>
      </section>
    </div>
  );
}
