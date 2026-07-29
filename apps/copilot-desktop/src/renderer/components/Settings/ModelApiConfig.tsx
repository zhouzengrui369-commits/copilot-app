/**
 * ModelApiConfig — pick an LLM provider and edit its baseUrl/model/apiKey.
 *
 * The form is "Save on change" — every blur or selection flip calls
 * `updateModelApi` which round-trips through the IPC bridge. The
 * minimax provider is the default; switching to openai/claude/custom
 * pre-fills sensible defaults via `providerDefaults`.
 *
 * LLM client reinit: a config change here does NOT immediately rebuild
 * the in-process LLMClient instance. The main process reads the saved
 * config on next boot. We surface that constraint as a small status hint.
 *
 * Sprint 1.2 T-1.2.6 (settings panel + multi-provider).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listProviders, PROVIDER_IDS } from '@copilot/llm-client';
import type { ChangeEvent } from 'react';
import { useSettings, providerDefaults } from './useSettings';
import type { ModelApiConfig, ModelProviderId } from '../../types/settings';
import styles from './styles.module.css';

export interface ModelApiConfigProps {
  /** Override the bound hook — useful in tests. */
  modelApi?: ModelApiConfig;
  onChange?: (next: ModelApiConfig & { apiKey?: string; clearApiKey?: boolean }) => void | Promise<void>;
  /** Browser-only fixture mode: edit in memory without touching the runtime bridge. */
  prototypeMode?: boolean;
}

const PROVIDER_OPTIONS = listProviders();

export function ModelApiConfig(props: ModelApiConfigProps) {
  const ctx = useSettings();
  const config = props.modelApi ?? ctx.modelApi;
  const prototypeMode = props.prototypeMode === true;
  const [prototypeConfig, setPrototypeConfig] = useState(config);
  const [credentialDraft, setCredentialDraft] = useState('');
  const displayedConfig = prototypeMode ? prototypeConfig : config;

  useEffect(() => {
    if (prototypeMode) setPrototypeConfig(config);
  }, [config, prototypeMode]);

  useEffect(() => {
    setCredentialDraft('');
  }, [prototypeMode]);

  const onChange = async (next: ModelApiConfig & { apiKey?: string; clearApiKey?: boolean }) => {
    if (props.onChange) await props.onChange(next);
    else await ctx.updateModelApi(next);
  };

  const currentMeta = useMemo(
    () => PROVIDER_OPTIONS.find((p) => p.id === displayedConfig.id) ?? PROVIDER_OPTIONS[0]!,
    [displayedConfig.id],
  );

  const handleProvider = useCallback(
    async (evt: ChangeEvent<HTMLSelectElement>) => {
      const next = evt.target.value as ModelProviderId;
      if (!PROVIDER_IDS.includes(next)) return;
      // A provider/origin switch never carries credential material forward.
      const defaults = providerDefaults(next);
      setCredentialDraft('');
      if (prototypeMode) {
        setPrototypeConfig({
          id: next,
          baseUrl: defaults.baseUrl,
          model: defaults.model,
          apiKey: '',
          apiKeyConfigured: false,
          credentialStatus: 'not-configured',
        });
        return;
      }
      await onChange({
        id: next,
        baseUrl: defaults.baseUrl,
        model: defaults.model,
        apiKey: '',
        apiKeyConfigured: false,
        credentialStatus: 'not-configured',
      });
    },
    [onChange, prototypeMode],
  );

  const handleField =
    (field: keyof ModelApiConfig) =>
    (evt: ChangeEvent<HTMLInputElement>) => {
      const value = evt.target.value;
      if (prototypeMode) {
        setPrototypeConfig((current) => ({ ...current, [field]: value, apiKey: '' }));
        return;
      }
      void onChange({ ...config, [field]: value, apiKey: '' });
    };

  const apiKeyRequired = currentMeta.requiresApiKey;

  return (
    <fieldset
      className={styles.group}
      data-testid="settings-model-api"
      aria-label="Model API configuration"
      data-assistant-avoid="critical"
    >
      <legend className={styles.legend}>Model API</legend>

      <label className={styles.select}>
        <span>Provider</span>
        <select
          value={displayedConfig.id}
          onChange={handleProvider}
          data-testid="model-provider-select"
          aria-label="LLM provider"
        >
          {PROVIDER_OPTIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <p className={styles.hint} data-testid="model-provider-description">
        {currentMeta.description}
      </p>

      <label className={styles.field}>
        <span>Base URL</span>
        <input
          type="text"
          value={displayedConfig.baseUrl}
          onChange={handleField('baseUrl')}
          placeholder={currentMeta.defaultBaseUrl}
          data-testid="model-base-url"
          aria-label="Provider base URL"
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <label className={styles.field}>
        <span>Model</span>
        <input
          type="text"
          value={displayedConfig.model}
          onChange={handleField('model')}
          placeholder={currentMeta.defaultModel}
          data-testid="model-name"
          aria-label="Provider model id"
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      {prototypeMode ? (
        <section
          className={styles.browserCredentialBoundary}
          data-testid="model-credential-browser-boundary"
          aria-label="API 凭据浏览器边界"
        >
          <div>
            <strong>API 凭据</strong>
            <span className={styles.neutralBadge}>
              仅桌面 App 可配置 · NOT_RUNTIME_PROOF
            </span>
          </div>
          <p>API 凭据仅在 Electron 桌面 App 安全配置。浏览器原型不会接收、保存或发送 API key。</p>
        </section>
      ) : (
        <>
          <label className={styles.field}>
            <span>API key{apiKeyRequired ? '' : ' (optional)'}</span>
            <input
              type="password"
              value={credentialDraft}
              onChange={(event) => setCredentialDraft(event.target.value)}
              placeholder={apiKeyRequired ? 'sk-...' : '(no key required for self-hosted)'}
              data-testid="model-api-key"
              aria-label="Provider API key"
              autoComplete="off"
            />
          </label>

          <div>
            <button
              type="button"
              data-testid="model-credential-save"
              disabled={credentialDraft.length === 0}
              onClick={async () => {
                await onChange({ ...config, apiKey: credentialDraft });
                setCredentialDraft('');
              }}
            >
              安全保存
            </button>
            <button
              type="button"
              data-testid="model-credential-clear"
              disabled={!config.apiKeyConfigured}
              onClick={async () => {
                await onChange({ ...config, apiKey: '', clearApiKey: true });
                setCredentialDraft('');
              }}
            >
              移除凭据
            </button>
          </div>

          <p className={styles.hint} data-testid="model-credential-status">
            凭据状态：{config.credentialStatus ?? 'not-configured'}
          </p>
        </>
      )}

      <p
        className={styles.hint}
        data-testid="model-restart-hint"
        data-state="dynamic"
      >
        {prototypeMode
          ? 'Provider、endpoint 与模型仅用于当前页面内存预览；关闭或刷新页面后不会保留。'
          : 'Valid provider, endpoint, model, and credential changes apply to the next operation. No app restart is required.'}
      </p>
    </fieldset>
  );
}
