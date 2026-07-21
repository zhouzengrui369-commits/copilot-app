/**
 * ThemeSelector — radio-style picker for the three theme variants.
 *
 * The selected value is committed to the persisted settings via
 * `useSettingsStore.setTheme`; the renderer applies `data-theme` on
 * <html> in App.tsx so the CSS variables in `styles/theme.css`
 * re-resolve and the entire UI re-skins in real time.
 *
 * Sprint 1.2 T-1.2.6 (settings panel + theme polish).
 */
import type { ChangeEvent } from 'react';
import { selectTheme, useSettingsStore } from '../../stores/settings';
import type { Theme } from '../../types/settings';
import styles from './styles.module.css';

const THEMES: ReadonlyArray<{ value: Theme; label: string; description: string }> = [
  { value: 'dark', label: 'Dark', description: 'Always use the dark color scheme.' },
  { value: 'light', label: 'Light', description: 'Always use the light color scheme.' },
  { value: 'auto', label: 'Auto', description: 'Follow the OS / window color scheme.' },
];

export interface ThemeSelectorProps {
  /** Override the bound store — useful in tests. */
  currentTheme?: Theme;
  /** Override the setter — useful in tests. */
  onChange?: (next: Theme) => void;
  /** Test hook for the wrapping fieldset. */
  'data-testid'?: string;
}

export function ThemeSelector(props: ThemeSelectorProps) {
  const storeTheme = useSettingsStore(selectTheme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const theme = props.currentTheme ?? storeTheme;
  const onChange = (next: Theme) => (props.onChange ?? ((v) => void setTheme(v)))(next);

  const handle = (evt: ChangeEvent<HTMLInputElement>) => {
    onChange(evt.target.value as Theme);
  };

  return (
    <fieldset
      className={styles.group}
      data-testid={props['data-testid'] ?? 'settings-theme-selector'}
      aria-label="Theme"
    >
      <legend className={styles.legend}>Theme</legend>
      <div className={styles.themeOptions}>
        {THEMES.map((t) => {
          const checked = theme === t.value;
          return (
            <label
              key={t.value}
              className={styles.themeOption}
              data-testid={`theme-option-${t.value}`}
              data-active={checked ? 'true' : 'false'}
            >
              <input
                type="radio"
                name="theme"
                value={t.value}
                checked={checked}
                onChange={handle}
                className={styles.themeRadio}
                data-testid={`theme-radio-${t.value}`}
              />
              <span className={styles.themeLabel}>
                <strong>{t.label}</strong>
                <small>{t.description}</small>
              </span>
            </label>
          );
        })}
      </div>
      <p className={styles.hint} data-testid="theme-current">
        Active theme: <code>{theme}</code>
      </p>
    </fieldset>
  );
}