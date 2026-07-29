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
import { TrashManagementSettings } from './TrashManagementSettings';
import styles from './styles.module.css';

export interface SettingsPanelProps {
  /** Force the title shown in the panel header. */
  title?: string;
  /** Hide the reset button (e.g. in a read-only share preview). */
  hideReset?: boolean;
}

export function SettingsPanel({ title = '设置', hideReset = false }: SettingsPanelProps) {
  const shortcuts = useSettingsStore(selectShortcuts);
  const hydrated = useSettingsStore(selectHydrated);
  const error = useSettingsStore(selectError);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const setShortcuts = useSettingsStore((s) => s.setShortcuts);

  const [draftShortcuts, setDraftShortcuts] = useState<ShortcutBinding[]>([]);
  const prototypeMode =
    typeof window !== 'undefined' &&
    (Boolean(window.__COPILOT_BROWSER_PROTOTYPE__) ||
      new URLSearchParams(window.location.search).has('prototype'));

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
      <section
        className={`workspace settings-panel ${styles.shell} ${styles.loading}`}
        data-testid="settings-panel-loading"
      >
        <p>正在读取本地设置…</p>
      </section>
    );
  }

  return (
    <section
      className={`workspace settings-panel ${styles.shell}`}
      data-testid="settings-panel"
      data-demo-source="copilot-phase1-mvp-demo-v3-calendar-moc#settings"
      aria-label={title}
    >
      <header className={`workspace__header ${styles.shellHeader}`}>
        <div className={styles.headerCopy}>
          <h2>{title}</h2>
          <p>模型可替换，数据边界不变；语音录入与后台记录属于本地笔记能力。</p>
        </div>
        <div className={styles.headerActions}>
          <span className="truth-chip truth-chip--unknown">
            {prototypeMode ? '浏览器预览 · NOT_RUNTIME_PROOF' : '本地配置'}
          </span>
          {!hideReset ? <ResetButton /> : null}
        </div>
      </header>

      {error && !prototypeMode ? (
        <div
          className={`settings-panel__error ${styles.errorBanner}`}
          role="alert"
          data-testid="settings-error"
        >
          {error}
        </div>
      ) : null}
      {prototypeMode ? (
        <div
          className={styles.browserEnvironment}
          data-testid="settings-browser-environment"
          role="status"
        >
          <strong>浏览器原型 · 未连接桌面凭据服务</strong>
          <span>仅验收信息架构与页面内存交互，不代表桌面运行时。</span>
        </div>
      ) : null}

      <div className={styles.layout} data-testid="settings-demo-layout">
        <nav className={styles.menu} aria-label="设置分类">
          <a className={styles.menuActive} href="#settings-model">模型与 AI</a>
          <a href="#settings-voice">本地语音与后台记录</a>
          <a href="#settings-privacy">数据与隐私</a>
          <a href="#settings-shortcuts">快捷键</a>
          <a href="#settings-theme">外观</a>
        </nav>

        <main className={styles.content}>
          <section
            id="settings-model"
            className={styles.prototypePanel}
            data-testid="settings-model-section"
            data-assistant-avoid="critical"
          >
            <header className={styles.panelHeader}>
              <div>
                <span className={styles.eyebrow}>LOCAL MODEL CONFIG</span>
                <h3>模型与 AI</h3>
              </div>
              <span className="truth-chip truth-chip--unknown">
                {prototypeMode ? '仅桌面 App 可配置' : '凭据状态以字段为准'}
              </span>
            </header>
            <p className={styles.panelIntro}>
              {prototypeMode
                ? '当前 MVP 默认 MiniMax，并保留 OpenAI、Claude 与自托管扩展点。浏览器中的 Provider、endpoint 与模型仅保存在页面内存。'
                : '当前 MVP 默认 MiniMax，并保留 OpenAI、Claude 与自托管扩展点。Provider、endpoint、模型和凭据继续通过本地设置持久化。'}
            </p>
            <ModelApiConfig prototypeMode={prototypeMode} />
            <div className={styles.settingRow}>
              <div>
                <h4>AI 助手</h4>
                <p>App 内保持一个共享入口；详细追问进入独立对话页。</p>
              </div>
              <span className="truth-chip truth-chip--unknown">运行状态 · NOT_PROBED</span>
            </div>
          </section>

          <section
            id="settings-voice"
            className={styles.prototypePanel}
            data-testid="settings-voice-section"
          >
            <header className={styles.panelHeader}>
              <div>
                <span className={styles.eyebrow}>STRICT LOCAL INPUT</span>
                <h3>本地语音与后台记录</h3>
              </div>
              <span className="truth-chip truth-chip--unknown">LOCAL ASR · NOT_READY</span>
            </header>
            <div className={styles.settingRow}>
              <div>
                <h4>App 内嵌 ASR 模型</h4>
                <p>目标为包内模型离线 decode，不使用 WebSpeech 或云 ASR fallback。</p>
              </div>
              <span className="truth-chip truth-chip--unknown">候选证据未完成</span>
            </div>
            <div className={styles.settingRow}>
              <div>
                <h4>后台持续记录</h4>
                <p>切换页面或应用时的持续录音仍须通过权限、生命周期与真机门禁。</p>
              </div>
              <span className="truth-chip truth-chip--unknown">NOT_READY</span>
            </div>
            <div className={`${styles.settingRow} ${styles.settingRowLast}`}>
              <div>
                <h4>转写完成后的行为</h4>
                <p>先形成可编辑草稿；用户确认后才保存为本地笔记并更新知识索引。</p>
              </div>
              <span className={styles.neutralBadge}>用户确认后写入</span>
            </div>
          </section>

          <section
            id="settings-privacy"
            className={styles.prototypePanel}
            data-testid="settings-privacy-section"
          >
            <header className={styles.panelHeader}>
              <div>
                <span className={styles.eyebrow}>LOCAL-FIRST BOUNDARY</span>
                <h3>数据与隐私</h3>
              </div>
              <span
                className="truth-chip truth-chip--unknown"
                data-testid="settings-post-mvp-boundary"
              >
                Remote / Backup · OFF · POST-MVP
              </span>
            </header>
            <div className={styles.boundaryCards} data-testid="settings-local-first-boundaries">
              <div className={styles.boundaryCard}>
                <strong>笔记 / MOC / KG</strong>
                <span>本机构建、持久化和渲染</span>
              </div>
              <div className={styles.boundaryCard}>
                <strong>日历 / 待办 / 对话</strong>
                <span>本地真值，模型不可覆盖</span>
              </div>
              <div className={styles.boundaryCard}>
                <strong>Remote / 备份</strong>
                <span>Post-MVP，默认关闭</span>
              </div>
            </div>
            <TrashManagementSettings />
          </section>

          <section
            id="settings-shortcuts"
            className={styles.prototypePanel}
            data-testid="settings-shortcuts-group"
          >
            <header className={styles.panelHeader}>
              <div>
                <span className={styles.eyebrow}>LOCAL PREFERENCES</span>
                <h3>快捷键</h3>
              </div>
              <span className={styles.neutralBadge}>本地持久化</span>
            </header>
            <ul className={`shortcut-list ${styles.shortcutList}`}>
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
              保存快捷键
            </button>
          </section>

          <section
            id="settings-theme"
            className={styles.prototypePanel}
            data-testid="settings-theme-section"
          >
            <header className={styles.panelHeader}>
              <div>
                <span className={styles.eyebrow}>APPEARANCE</span>
                <h3>外观</h3>
              </div>
            </header>
            <ThemeSelector />
          </section>

          <section
            className={`${styles.prototypePanel} ${styles.releasePanel}`}
            data-testid="settings-release-boundary"
          >
            <header className={styles.panelHeader}>
              <div>
                <span className={styles.eyebrow}>RELEASE GATES</span>
                <h3>MVP 边界</h3>
              </div>
            </header>
            <div className={styles.releaseBadges}>
              <span className="truth-chip truth-chip--unknown">macOS final candidate · 未验证</span>
              <span className="truth-chip truth-chip--unknown">Windows · Phase 1.1</span>
              <span className="truth-chip truth-chip--unknown">MVP_NOT_COMPLETE</span>
            </div>
          </section>
        </main>
      </div>
    </section>
  );
}

export { ThemeSelector, ModelApiConfig, ResetButton };
export { useSettings, providerDefaults } from './useSettings';
