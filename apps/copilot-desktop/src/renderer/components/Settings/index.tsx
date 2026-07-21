/**
 * Settings/index — the modular settings panel (Sprint 1.2 T-1.2.6).
 *
 * Composes:
 *   - CloudBackupToggle (Sprint 1.1 baseline, INTACT — 钉子 #2 red line)
 *   - ThemeSelector     (深 / 浅 / 自动 + real-time CSS variable switch)
 *   - ModelApiConfig    (minimax / OpenAI / Claude / 自托管)
 *   - ShortcutsEditor   (Sprint 1.1 baseline)
 *   - ResetButton       (gated by window.confirm + 3s arm window)
 *
 * Reuses the existing global app.css classnames so the file stays
 * drop-in compatible with the Sprint 1.1 T-1.1.1 SettingsPanel tests.
 *
 * The legacy all-in-one `SettingsPanel.tsx` is a thin re-export of this
 * file (kept so old import paths still resolve).
 *
 * Sprint 1.2 T-1.2.6.
 */
import { useEffect, useState } from 'react';
import {
  selectError,
  selectHydrated,
  selectShortcuts,
  useSettingsStore,
} from '../../stores/settings';
import type { ShortcutBinding } from '../../types/settings';
import { ThemeSelector } from './ThemeSelector';
import { ModelApiConfig } from './ModelApiConfig';
import { ResetButton } from './ResetButton';
import { RemoteManagementSettings } from '../RemoteManagement/RemoteManagementSettings';
import { BackupManagementSettings } from './BackupManagementSettings';
import { TrashManagementSettings } from './TrashManagementSettings';

export interface SettingsPanelProps {
  /** Force the title shown in the panel header. */
  title?: string;
  /** Hide the reset button (e.g. in a read-only share preview). */
  hideReset?: boolean;
}

export function SettingsPanel({ title = 'Settings', hideReset = false }: SettingsPanelProps) {
  const shortcuts = useSettingsStore(selectShortcuts);
  const hydrated = useSettingsStore(selectHydrated);
  const error = useSettingsStore(selectError);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const setShortcuts = useSettingsStore((s) => s.setShortcuts);

  const [draftShortcuts, setDraftShortcuts] = useState<ShortcutBinding[]>([]);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    setDraftShortcuts(shortcuts);
  }, [shortcuts]);

  const onShortcutChange = (idx: number, accelerator: string) => {
    setDraftShortcuts((prev) => {
      const next = prev.slice();
      const current = next[idx];
      if (!current) return prev;
      next[idx] = { ...current, accelerator };
      return next;
    });
  };

  const onShortcutsSave = () => {
    void setShortcuts(draftShortcuts);
  };

  if (!hydrated) {
    return (
      <section className="settings-panel" data-testid="settings-panel-loading">
        <p>Loading settings…</p>
      </section>
    );
  }

  return (
    <section className="settings-panel" data-testid="settings-panel" aria-label={title}>
      <header className="settings-panel__header">
        <h2>{title}</h2>
        {!hideReset ? <ResetButton /> : null}
      </header>

      {error ? (
        <div className="settings-panel__error" role="alert" data-testid="settings-error">
          {error}
        </div>
      ) : null}

      <BackupManagementSettings />

      <TrashManagementSettings />

      <RemoteManagementSettings />

      <ThemeSelector />

      <ModelApiConfig />

      <fieldset className="settings-panel__group" data-testid="settings-shortcuts-group">
        <legend>Shortcuts</legend>
        <ul className="shortcut-list">
          {draftShortcuts.map((sc, idx) => (
            <li key={sc.id} className="shortcut-list__row">
              <span className="shortcut-list__label">{sc.label}</span>
              <input
                type="text"
                value={sc.accelerator}
                onChange={(e) => onShortcutChange(idx, e.target.value)}
                data-testid={`shortcut-${sc.id}`}
                aria-label={`Accelerator for ${sc.label}`}
              />
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onShortcutsSave}
          data-testid="shortcuts-save"
          disabled={JSON.stringify(draftShortcuts) === JSON.stringify(shortcuts)}
        >
          Save shortcuts
        </button>
      </fieldset>
    </section>
  );
}

export { ThemeSelector, ModelApiConfig, ResetButton };
export { useSettings, providerDefaults } from './useSettings';
