import { describe, expect, it, vi } from 'vitest';
import { LLMClient } from '../../../../packages/llm-client/src/client.js';
import { AuthError } from '../../../../packages/llm-client/src/util/errors.js';
import type { ChatRequest, ChatResponse, LLMProvider, StreamChunk } from '../../../../packages/llm-client/src/types.js';
import {
  createConfiguredLlmClient,
  DomainServiceError,
} from '../../src/main/local-knowledge-service.js';
import {
  ModelCredentialStore,
  credentialBinding,
  type CredentialPersistence,
  type CredentialRecord,
} from '../../src/main/model-credential-store.js';
import { DEFAULT_SETTINGS, type CopilotSettings, type SettingsStorage } from '../../src/main/settings-store.js';

type RuntimeLlmModule = Parameters<typeof createConfiguredLlmClient>[0]['llmModule'];
type RuntimeProviderConfig = Parameters<RuntimeLlmModule['createProvider']>[0];
type RuntimeClientOptions = ConstructorParameters<RuntimeLlmModule['LLMClient']>[0];

function testLlmModule(
  providerId: RuntimeProviderConfig['id'],
  createProvider: (config: RuntimeProviderConfig) => LLMProvider,
): RuntimeLlmModule {
  class RuntimeCompatibleLlmClient extends LLMClient {
    constructor(options: RuntimeClientOptions) {
      super({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        defaultModel: options.defaultModel,
        logger: options.logger,
        providerFactory: ({ apiKey, baseUrl }) => createProvider({
          id: providerId,
          apiKey,
          baseUrl,
          model: options.defaultModel,
        }),
      });
    }
  }

  return { LLMClient: RuntimeCompatibleLlmClient, createProvider };
}

const CREDENTIAL = '[REDACTED]';

class MemoryCredentials implements CredentialPersistence {
  readonly records = new Map<string, CredentialRecord>();
  read(id: string) { return this.records.get(id) ?? null; }
  write(id: string, record: CredentialRecord) { this.records.set(id, { ...record }); }
  remove(id: string) { this.records.delete(id); }
  clear() { this.records.clear(); }
}

function credentialStore() {
  return new ModelCredentialStore(new MemoryCredentials(), {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...value].reverse().join('')),
    decryptString: (value) => [...value.toString()].reverse().join(''),
  });
}

function settingsStore(modelApi: CopilotSettings['modelApi']): SettingsStorage {
  let state: CopilotSettings = { ...DEFAULT_SETTINGS, modelApi: { ...modelApi } };
  return {
    get: (key) => state[key],
    set: (key, value) => { state = { ...state, [key]: value }; },
    getAll: () => state,
    setAll: (value) => { state = value; },
    reset: () => { state = { ...DEFAULT_SETTINGS, modelApi: { ...DEFAULT_SETTINGS.modelApi } }; },
    readLegacyModelApiCredential: () => null,
    clearLegacyModelApiCredentialExact: () => undefined,
  };
}

function fakeProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    name: 'minimax',
    chat: vi.fn(async (): Promise<ChatResponse> => ({
      content: 'ok',
      model: 'MiniMax-M3',
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })),
    chatStream: vi.fn(async function* () { yield { delta: 'ok' } as StreamChunk; }),
    countTokens: () => 1,
    ...overrides,
  };
}

describe('Phase A production LLM composition', () => {
  it('binds persisted provider + normalized origin and uses canonical createProvider through LLMClient', async () => {
    const settings = settingsStore({
      provider: 'minimax',
      baseUrl: 'https://model.example/v1/',
      model: 'MiniMax-M3',
    });
    const credentials = credentialStore();
    credentials.write(credentialBinding('minimax', 'https://model.example/v1').binding, CREDENTIAL);
    const rawProvider = fakeProvider();
    const createProvider = vi.fn((_config: {
      id: string;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    }) => rawProvider);

    const runtime = createConfiguredLlmClient({
      settings,
      credentials,
      llmModule: testLlmModule('minimax', createProvider),
    });
    await runtime.middlewareProvider.chat({
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'hello' }],
    } as ChatRequest);
    const deltas: string[] = [];
    for await (const chunk of runtime.middlewareProvider.chatStream({
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    })) deltas.push(chunk.delta);

    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(createProvider.mock.calls[0]?.[0]).toMatchObject({
      id: 'minimax',
      baseUrl: 'https://model.example/v1',
      model: 'MiniMax-M3',
    });
    expect(rawProvider.chat).toHaveBeenCalledTimes(1);
    expect(rawProvider.chatStream).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(['ok']);
  });

  it('never reuses a credential after provider or normalized-origin change', () => {
    const credentials = credentialStore();
    credentials.write(credentialBinding('minimax', 'https://model.example/v1').binding, CREDENTIAL);
    const createProvider = vi.fn(() => fakeProvider());

    for (const modelApi of [
      { provider: 'openai' as const, baseUrl: 'https://model.example/v1', model: 'gpt-4o-mini' },
      { provider: 'minimax' as const, baseUrl: 'https://other.example/v1', model: 'MiniMax-M3' },
    ]) {
      expect(() => createConfiguredLlmClient({
        settings: settingsStore(modelApi),
        credentials,
        llmModule: testLlmModule(modelApi.provider, createProvider),
      })).toThrow('[MODEL_CREDENTIAL_REQUIRED]');
    }
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('maps provider failures to stable renderer-safe errors', async () => {
    const settings = settingsStore({
      provider: 'minimax',
      baseUrl: 'https://model.example/v1',
      model: 'MiniMax-M3',
    });
    const credentials = credentialStore();
    credentials.write(credentialBinding('minimax', 'https://model.example/v1').binding, CREDENTIAL);
    const runtime = createConfiguredLlmClient({
      settings,
      credentials,
      llmModule: testLlmModule('minimax', () => fakeProvider({
        chat: vi.fn(async () => { throw new AuthError('provider detail'); }),
      })),
    });

    try {
      await runtime.middlewareProvider.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hello' }] });
      expect.fail('expected safe failure');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainServiceError);
      expect(String((error as Error).message)).toContain('[MODEL_AUTH]');
      expect(String((error as Error).message)).not.toContain('provider detail');
      expect(String((error as Error).message)).not.toContain(CREDENTIAL);
    }
  });
});
