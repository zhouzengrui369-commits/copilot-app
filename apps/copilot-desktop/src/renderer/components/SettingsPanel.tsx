/**
 * SettingsPanel — public re-export of the Sprint 1.2 T-1.2.6 modular
 * settings panel. Kept as a thin file so legacy import paths
 * (`import { SettingsPanel } from '.../SettingsPanel'`) keep working.
 *
 * The actual implementation lives at
 * `apps/copilot-desktop/src/renderer/components/Settings/index.tsx`.
 */
export { SettingsPanel } from './Settings/index';
export { ThemeSelector, ModelApiConfig, ResetButton, useSettings, providerDefaults } from './Settings/index';