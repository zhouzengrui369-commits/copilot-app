import { useCallback, useState } from 'react';
import type { RendererTrashItem } from '../../../shared/domain-api.js';
import styles from './TrashManagementSettings.module.css';

function safeTrashError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes('restore destination already exists')) {
    return '无法恢复：同名内容已存在。请先处理当前内容后重试。';
  }
  if (message.includes('recovery')) {
    return '该项目正在等待本地恢复，请重启 App 后刷新。';
  }
  if (message.includes('changed')) {
    return '该项目已发生变化，请刷新回收站后重试。';
  }
  return message || '回收站操作失败。';
}

export function TrashManagementSettings() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RendererTrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const trash = window.copilot?.trash;
    setError(null);
    if (!trash) {
      setItems([]);
      setError('本地回收站桥接不可用。');
      return;
    }
    setLoading(true);
    try {
      const next = await trash.list();
      setItems([...next].sort((left, right) => right.movedAt - left.movedAt));
    } catch (cause) {
      setError(safeTrashError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const show = () => {
    setOpen(true);
    void load();
  };

  const restore = async (item: RendererTrashItem) => {
    const trash = window.copilot?.trash;
    if (!trash || item.state !== 'trashed') return;
    setBusyId(item.trashId);
    setError(null);
    try {
      await trash.restore({ trashId: item.trashId, revision: item.revision });
      await load();
    } catch (cause) {
      setError(safeTrashError(cause));
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (item: RendererTrashItem) => {
    const trash = window.copilot?.trash;
    if (!trash || item.state !== 'trashed') return;
    if (!window.confirm(`永久删除“${item.title}”？此操作不可撤销。`)) return;
    setBusyId(item.trashId);
    setError(null);
    try {
      await trash.purge({
        trashId: item.trashId,
        revision: item.revision,
        confirmed: true,
      });
      await load();
    } catch (cause) {
      setError(safeTrashError(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <fieldset className="settings-panel__group" data-testid="trash-management-settings">
      <legend>Data &amp; Privacy</legend>
      <p className="settings-panel__hint">删除的笔记与待办仅保存在本机回收站，可恢复或永久删除。</p>
      <button type="button" onClick={show}>管理回收站</button>

      {open ? (
        <div className={styles.overlay} data-testid="trash-modal-overlay">
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="trash-modal-title"
            data-testid="trash-management-modal"
          >
            <header className={styles.header}>
              <div>
                <h3 id="trash-modal-title">本地回收站</h3>
                <p>仅显示安全摘要，不显示文件路径或恢复日志。</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭回收站">×</button>
            </header>

            {error ? <p role="alert" className={styles.error}>{error}</p> : null}
            {loading ? <p role="status">正在读取本地回收站…</p> : null}
            {!loading && items.length === 0 ? <p>回收站为空。</p> : null}
            {!loading && items.length > 0 ? (
              <ul className={styles.list} aria-label="回收站项目">
                {items.map((item) => {
                  const eligible = item.state === 'trashed' && !item.recoveryRequired;
                  return (
                    <li key={item.trashId} className={styles.item}>
                      <div>
                        <strong>{item.title}</strong>
                        <small>{item.kind === 'todo' ? '待办' : '笔记'} · {eligible ? '可恢复' : '等待本地恢复'}</small>
                      </div>
                      <div className={styles.actions}>
                        <button type="button" disabled={!eligible || busyId === item.trashId} onClick={() => void restore(item)}>恢复</button>
                        <button type="button" disabled={!eligible || busyId === item.trashId} onClick={() => void purge(item)}>永久删除</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <footer className={styles.footer}>
              <button type="button" disabled={loading || busyId !== null} onClick={() => void load()}>刷新</button>
              <button type="button" onClick={() => setOpen(false)}>完成</button>
            </footer>
          </section>
        </div>
      ) : null}
    </fieldset>
  );
}
