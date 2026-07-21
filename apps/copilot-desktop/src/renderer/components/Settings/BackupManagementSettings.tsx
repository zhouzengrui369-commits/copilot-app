import { useEffect, useMemo, useState } from 'react';
import type {
  BackupCatalogEntry,
  BackupEnableDraft,
  BackupManagementState,
  BackupRestorePreview,
} from '../../../shared/backup-management';
import type { BackupScope } from '../../../main/backup/types';
import { BackupApprovalModal } from './BackupApprovalModal';

const EMPTY: BackupManagementState = {
  enabled: false, configured: false, region: 'not configured', platformProtection: 'Electron safeStorage',
  catalog: [], allowedScopes: [], activeOperation: null, schedulingAvailable: false, replaceCurrentAvailable: false, recoveryRequired: false,
};

export function BackupManagementSettings() {
  const backup = window.copilot?.backup;
  const [state, setState] = useState<BackupManagementState>(EMPTY);
  const [scopes, setScopes] = useState<BackupScope[]>([]);
  const [draft, setDraft] = useState<BackupEnableDraft | null>(null);
  const [acks, setAcks] = useState([false, false, false, false]);
  const [selected, setSelected] = useState('');
  const [deleteText, setDeleteText] = useState('');
  const [preview, setPreview] = useState<BackupRestorePreview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    if (!backup) return;
    const next = await backup.getState();
    setState(next);
    setSelected((value) => value || next.catalog[0]?.snapshotId || '');
  };
  useEffect(() => { void refresh().catch((e) => setError(String(e))); }, []);

  const toggleScope = (values: BackupScope[], checked: boolean) => {
    setDraft(null); setAcks([false, false, false, false]);
    setScopes((current) => checked ? [...new Set([...current, ...values])] : current.filter((value) => !values.includes(value)));
  };
  const run = async (action: () => Promise<unknown>, success: string) => {
    setError(''); setMessage('');
    try { await action(); setMessage(success); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const selectedCatalog = useMemo(() => state.catalog.find((item) => item.snapshotId === selected), [state.catalog, selected]);
  const preparePreview = async () => {
    if (!backup) return;
    setError(''); setMessage(''); setPreview(null);
    try {
      const next = await backup.restorePreview({ snapshotId: selected });
      setPreview(next);
      setMessage(`Verified preview prepared in memory: ${next.files} files, ${next.records} records, ${next.conflicts.length} conflicts. Local truth was not changed.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const applyPreview = async () => {
    if (!backup || !preview || preview.snapshotId !== selected || preview.conflicts.length > 0) return;
    setError(''); setMessage('');
    try {
      const result = await backup.restoreApply({
        snapshotId: preview.snapshotId,
        selectedScopes: preview.selectedScopes,
        previewDigest: preview.previewDigest,
        generation: preview.generation,
      });
      setPreview(null);
      setMessage(`Imported verified copy: ${result.importedNotes} notes and ${result.importedTodos} Todos under ${result.importNamespace}. Current data was not replaced.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
    <fieldset className="settings-panel__group" data-testid="backup-management">
      <legend>Encrypted cloud backup</legend>
      <p><strong>State: {state.enabled ? 'ON' : 'OFF'}</strong> · Region: {state.region} · {state.platformProtection}</p>
      <p>OFF is the default: no backup credential, snapshot file, presign, or cloud request is created.</p>
      {state.recoveryRequired ? <p role="alert">Backup cleanup is quarantined. Re-enable and new commands remain blocked until local recovery succeeds.</p> : null}
      {!state.configured ? <p role="status">A separate Backup endpoint/token and COS owner binding are not configured.</p> : null}

      {!state.enabled ? (
        <div data-testid="backup-owner-consent">
          <p><strong>Choose scope (nothing is preselected)</strong></p>
          <label><input type="checkbox" checked={scopes.includes('note-markdown')} onChange={(e) => toggleScope(['note-markdown', 'note-metadata'], e.target.checked)} /> Notes metadata + Markdown</label>{' '}
          <label><input type="checkbox" checked={scopes.includes('todos')} onChange={(e) => toggleScope(['todos'], e.target.checked)} /> Todos</label>{' '}
          <label><input type="checkbox" checked={scopes.includes('preferences')} onChange={(e) => toggleScope(['preferences'], e.target.checked)} /> Selected non-secret preferences</label>
          <p>KB logical/index and KG node/edge scopes remain unavailable until safe import-as-copy adapters exist.</p>
          <button type="button" disabled={!backup || !state.configured || scopes.length === 0} onClick={() => void run(async () => setDraft(await backup!.prepareEnable(scopes)), 'Consent details prepared locally.')}>Review owner consent</button>
          {draft ? (
            <div data-testid="backup-consent-details">
              <p>Region: <strong>{draft.region}</strong></p>
              <p>Destination: <strong>{draft.bucket}</strong></p>
              <p>Scope: {draft.selectedScopes.join(', ')}</p>
              <p>Estimated encrypted bytes: {draft.estimatedEncryptedBytes}</p>
              <p>Counts: {Object.entries(draft.counts).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}</p>
              {[draft.retentionAndDelete, draft.keyLoss, draft.cloudCannotDecrypt, `Exact first action: ${draft.exactFirstUpload}`].map((text, index) => (
                <label key={text} style={{ display: 'block' }}><input type="checkbox" checked={acks[index]} onChange={(e) => setAcks((current) => current.map((value, i) => i === index ? e.target.checked : value))} /> {text}</label>
              ))}
              <button type="button" disabled={!acks.every(Boolean)} onClick={() => void run(() => backup!.enable({ ...draft, retentionDeleteAcknowledged: true, keyLossAcknowledged: true, cloudCannotDecryptAcknowledged: true, firstUploadAcknowledged: true }), 'Backup enabled. No upload has run.')}>Enable after explicit consent</button>
            </div>
          ) : null}
        </div>
      ) : (
        <div data-testid="backup-manual-actions">
          <button type="button" onClick={() => void run(() => backup!.create({ selectedScopes: state.allowedScopes }), 'Encrypted local snapshot created.')}>Create snapshot</button>{' '}
          <button type="button" onClick={() => void run(() => backup!.disable(), 'Backup disabled; existing local/cloud objects were not deleted.')}>Disable</button>
          <p>No schedule, background upload, or silent retry exists.</p>
          {state.catalog.length ? (
            <>
              <label>Snapshot <select value={selected} onChange={(e) => { setSelected(e.target.value); setDeleteText(''); setPreview(null); }}>{state.catalog.map((entry: BackupCatalogEntry) => <option key={entry.snapshotId} value={entry.snapshotId}>{entry.snapshotId} · {entry.status}</option>)}</select></label>
              <p>{selectedCatalog?.bytes} encrypted bytes · SHA-256 {selectedCatalog?.sha256}</p>
              <button type="button" onClick={() => void run(() => backup!.upload({ snapshotId: selected }), 'Upload and remote HEAD/hash verification passed.')}>Upload</button>{' '}
              <button type="button" onClick={() => void run(() => backup!.downloadVerify({ snapshotId: selected }), 'Download/hash/container verification passed.')}>Download &amp; verify</button>{' '}
              <button type="button" onClick={() => void preparePreview()}>Restore preview</button>{' '}
              <button type="button" disabled={!preview || preview.snapshotId !== selected || preview.conflicts.length > 0} onClick={() => void applyPreview()}>Import verified copy</button>
              <p>Restore mode creates a separate deterministic local copy. It never overwrites current notes or Todos; replace-current remains unavailable by API and UI.</p>
              {preview ? (
                <div data-testid="backup-restore-preview">
                  <p>Preview digest: <code>{preview.previewDigest}</code></p>
                  <p>Scopes: {preview.selectedScopes.join(', ')} · Generation: {preview.generation}</p>
                  <p>{preview.conflicts.length ? `Blocked by ${preview.conflicts.length} preflight conflict(s).` : 'Preflight found no conflicts. Apply still requires a fresh one-shot approval and a new download/verification.'}</p>
                </div>
              ) : null}
              <label>Type exact snapshot ID to delete its cloud object <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} /></label>{' '}
              <button type="button" disabled={deleteText !== selected} onClick={() => void run(() => backup!.deleteRemote({ snapshotId: selected, confirmSnapshotId: deleteText }), 'Exact cloud object deleted and HEAD absence verified.')}>Delete exact cloud object</button>
            </>
          ) : null}
        </div>
      )}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
    <BackupApprovalModal />
    </>
  );
}
