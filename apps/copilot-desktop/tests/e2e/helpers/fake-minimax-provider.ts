import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

const HOST = '127.0.0.1' as const;
const CHAT_COMPLETIONS_PATH = '/v1/chat/completions' as const;
const MAX_REQUEST_BYTES = 1_000_000;
const DEFAULT_RECEIPT_TIMEOUT_MS = 5_000;

export type FakeMiniMaxProfile =
  | 'success'
  | 'provider-failure'
  | 'deferred-success'
  | 'grounded-rag';
export type SanitizedMessageRole = 'system' | 'user' | 'assistant' | 'unknown';

export interface SanitizedRequestBodyMetadata {
  readonly byteLength: number;
  readonly validJsonObject: boolean;
  readonly modelType: 'missing' | 'string' | 'other';
  readonly stream: boolean | null;
  readonly messageCount: number | null;
  readonly messageRoles: readonly SanitizedMessageRole[];
  readonly messageContentLengths: readonly number[];
  readonly hasTemperature: boolean;
  readonly hasMaxTokens: boolean;
  readonly hasUser: boolean;
  readonly stopCount: number | null;
}

export interface FakeMiniMaxRequestReceipt {
  readonly sequence: number;
  readonly method: 'POST';
  readonly path: typeof CHAT_COMPLETIONS_PATH;
  readonly profile: FakeMiniMaxProfile;
  readonly body: SanitizedRequestBodyMetadata;
}

export interface FakeMiniMaxProvider {
  readonly host: typeof HOST;
  readonly port: number;
  readonly baseUrl: string;
  readonly profile: FakeMiniMaxProfile;
  reset(profile?: FakeMiniMaxProfile): void;
  releaseDeferredSuccess(): number;
  getDeferredRequestCount(): number;
  waitForRequest(timeoutMs?: number): Promise<FakeMiniMaxRequestReceipt>;
  getReceipts(): readonly FakeMiniMaxRequestReceipt[];
  close(): Promise<void>;
}

export interface StartFakeMiniMaxProviderOptions {
  readonly profile?: FakeMiniMaxProfile;
}

interface PendingReceipt {
  resolve(receipt: FakeMiniMaxRequestReceipt): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface DeferredSuccessResponse {
  readonly response: ServerResponse;
  readonly content: string;
}

type SuccessPromptKind =
  | 'entity-extraction'
  | 'relation-extraction'
  | 'topic-tags'
  | 'entity-summary'
  | 'note-wiki-summary';

const SUCCESS_CONTENT: Readonly<Record<SuccessPromptKind, string>> = Object.freeze({
  'entity-extraction': '[]',
  'relation-extraction': '[]',
  'topic-tags': '["e2e","local-first"]',
  'entity-summary': '{}',
  'note-wiki-summary':
    '{"summary":"E2E 本地优先知识摘要已由受控 MiniMax 测试提供方生成。"}',
});

const PROVIDER_FAILURE_RESPONSE = Object.freeze({
  error: {
    message: 'FAKE_MINIMAX_PROVIDER_FAILURE',
    type: 'provider_error',
    code: 'fake_provider_failure',
  },
});

export async function startFakeMiniMaxProvider(
  options: StartFakeMiniMaxProviderOptions = {},
): Promise<FakeMiniMaxProvider> {
  let activeProfile = options.profile ?? 'success';
  let sequence = 0;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let deferredReleased = false;
  const receipts: FakeMiniMaxRequestReceipt[] = [];
  const unclaimedReceipts: FakeMiniMaxRequestReceipt[] = [];
  const pendingReceipts: PendingReceipt[] = [];
  const deferredResponses: DeferredSuccessResponse[] = [];

  const recordReceipt = (body: SanitizedRequestBodyMetadata): void => {
    const receipt: FakeMiniMaxRequestReceipt = Object.freeze({
      sequence: ++sequence,
      method: 'POST',
      path: CHAT_COMPLETIONS_PATH,
      profile: activeProfile,
      body,
    });
    receipts.push(receipt);

    const pending = pendingReceipts.shift();
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(receipt);
      return;
    }
    unclaimedReceipts.push(receipt);
  };

  const deferSuccess = (response: ServerResponse, content: string): void => {
    deferredResponses.push({ response, content });
  };

  const rejectDeferred = (message: string): void => {
    for (const pending of deferredResponses.splice(0)) {
      sendJson(pending.response, 503, {
        error: {
          message,
          type: 'provider_error',
          code: 'fake_deferred_request_cancelled',
        },
      });
    }
  };

  const server = createServer((request, response) => {
    void handleRequest(
      request,
      response,
      () => activeProfile,
      () => deferredReleased,
      deferSuccess,
      recordReceipt,
    );
  });

  await listenOnLoopback(server);
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Fake MiniMax provider did not bind to a TCP port');
  }

  const rejectPending = (reason: string): void => {
    for (const pending of pendingReceipts.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
  };

  return {
    host: HOST,
    port: address.port,
    baseUrl: `http://${HOST}:${address.port}/v1`,
    get profile() {
      return activeProfile;
    },
    reset(profile: FakeMiniMaxProfile = 'success'): void {
      if (closed) {
        throw new Error('Cannot reset a closed fake MiniMax provider');
      }
      activeProfile = profile;
      deferredReleased = false;
      sequence = 0;
      receipts.length = 0;
      unclaimedReceipts.length = 0;
      rejectDeferred('FAKE_MINIMAX_DEFERRED_RESET');
      rejectPending('Fake MiniMax provider reset before request receipt');
    },
    releaseDeferredSuccess(): number {
      if (closed) {
        throw new Error('Cannot release a closed fake MiniMax provider');
      }
      if (activeProfile !== 'deferred-success') {
        throw new Error('Deferred success can only be released for the deferred-success profile');
      }
      deferredReleased = true;
      const pending = deferredResponses.splice(0);
      for (const item of pending) {
        sendJson(item.response, 200, buildSuccessResponse(item.content));
      }
      return pending.length;
    },
    getDeferredRequestCount(): number {
      return deferredResponses.length;
    },
    waitForRequest(
      timeoutMs: number = DEFAULT_RECEIPT_TIMEOUT_MS,
    ): Promise<FakeMiniMaxRequestReceipt> {
      const available = unclaimedReceipts.shift();
      if (available) {
        return Promise.resolve(available);
      }
      if (closed) {
        return Promise.reject(new Error('Fake MiniMax provider is closed'));
      }
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return Promise.reject(new Error('Receipt timeout must be a positive finite number'));
      }

      return new Promise<FakeMiniMaxRequestReceipt>((resolve, reject) => {
        const pending: PendingReceipt = {
          resolve,
          reject,
          timer: setTimeout(() => {
            const index = pendingReceipts.indexOf(pending);
            if (index >= 0) {
              pendingReceipts.splice(index, 1);
            }
            reject(new Error(`Timed out waiting ${timeoutMs}ms for fake MiniMax request`));
          }, timeoutMs),
        };
        pendingReceipts.push(pending);
      });
    },
    getReceipts(): readonly FakeMiniMaxRequestReceipt[] {
      return [...receipts];
    },
    close(): Promise<void> {
      if (closePromise) {
        return closePromise;
      }
      closed = true;
      rejectDeferred('FAKE_MINIMAX_DEFERRED_CLOSED');
      rejectPending('Fake MiniMax provider closed before request receipt');
      closePromise = closeServer(server);
      return closePromise;
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  getProfile: () => FakeMiniMaxProfile,
  isDeferredReleased: () => boolean,
  deferSuccess: (response: ServerResponse, content: string) => void,
  recordReceipt: (body: SanitizedRequestBodyMetadata) => void,
): Promise<void> {
  if (request.url !== CHAT_COMPLETIONS_PATH) {
    sendJson(response, 404, {
      error: {
        message: 'FAKE_MINIMAX_ROUTE_NOT_FOUND',
        type: 'invalid_request_error',
        code: 'route_not_found',
      },
    });
    return;
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, {
      error: {
        message: 'FAKE_MINIMAX_METHOD_NOT_ALLOWED',
        type: 'invalid_request_error',
        code: 'method_not_allowed',
      },
    });
    return;
  }

  try {
    const body = await readBoundedBody(request);
    const metadata = sanitizeBodyMetadata(body);
    recordReceipt(metadata);

    if (!metadata.validJsonObject) {
      sendJson(response, 400, {
        error: {
          message: 'FAKE_MINIMAX_INVALID_JSON_BODY',
          type: 'invalid_request_error',
          code: 'invalid_json_body',
        },
      });
      return;
    }

    const profile = getProfile();
    if (profile === 'provider-failure') {
      sendJson(response, 503, PROVIDER_FAILURE_RESPONSE);
      return;
    }

    if (profile === 'grounded-rag' && metadata.stream === true) {
      const groundedContent = selectGroundedRagContent(body);
      if (groundedContent === null) {
        sendJson(response, 422, {
          error: {
            message: 'FAKE_MINIMAX_GROUNDED_SOURCE_MISSING',
            type: 'invalid_request_error',
            code: 'grounded_source_missing',
          },
        });
        return;
      }
      sendGroundedRagStream(response, groundedContent);
      return;
    }

    const successContent = selectSuccessContent(body);
    if (successContent === null) {
      sendJson(response, 422, {
        error: {
          message: 'FAKE_MINIMAX_UNKNOWN_PROMPT',
          type: 'invalid_request_error',
          code: 'unknown_prompt',
        },
      });
      return;
    }

    if (profile === 'deferred-success' && !isDeferredReleased()) {
      deferSuccess(response, successContent);
      return;
    }

    sendJson(response, 200, buildSuccessResponse(successContent));
  } catch (error) {
    const requestTooLarge = error instanceof RequestTooLargeError;
    sendJson(response, requestTooLarge ? 413 : 400, {
      error: {
        message: requestTooLarge
          ? 'FAKE_MINIMAX_REQUEST_TOO_LARGE'
          : 'FAKE_MINIMAX_REQUEST_READ_FAILED',
        type: 'invalid_request_error',
        code: requestTooLarge ? 'request_too_large' : 'request_read_failed',
      },
    });
  }
}

function sanitizeBodyMetadata(rawBody: string): SanitizedRequestBodyMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return Object.freeze({
      byteLength: Buffer.byteLength(rawBody),
      validJsonObject: false,
      modelType: 'missing',
      stream: null,
      messageCount: null,
      messageRoles: Object.freeze([]),
      messageContentLengths: Object.freeze([]),
      hasTemperature: false,
      hasMaxTokens: false,
      hasUser: false,
      stopCount: null,
    });
  }

  if (!isRecord(parsed)) {
    return Object.freeze({
      byteLength: Buffer.byteLength(rawBody),
      validJsonObject: false,
      modelType: 'missing',
      stream: null,
      messageCount: null,
      messageRoles: Object.freeze([]),
      messageContentLengths: Object.freeze([]),
      hasTemperature: false,
      hasMaxTokens: false,
      hasUser: false,
      stopCount: null,
    });
  }

  const messages = Array.isArray(parsed.messages) ? parsed.messages : null;
  const messageRoles = messages ? messages.map(sanitizeMessageRole) : [];
  const messageContentLengths = messages
    ? messages.map((message) =>
        isRecord(message) && typeof message.content === 'string' ? message.content.length : 0,
      )
    : [];

  return Object.freeze({
    byteLength: Buffer.byteLength(rawBody),
    validJsonObject: true,
    modelType:
      parsed.model === undefined
        ? 'missing'
        : typeof parsed.model === 'string'
          ? 'string'
          : 'other',
    stream: typeof parsed.stream === 'boolean' ? parsed.stream : null,
    messageCount: messages?.length ?? null,
    messageRoles: Object.freeze(messageRoles),
    messageContentLengths: Object.freeze(messageContentLengths),
    hasTemperature: parsed.temperature !== undefined,
    hasMaxTokens: parsed.max_tokens !== undefined,
    hasUser: parsed.user !== undefined,
    stopCount: Array.isArray(parsed.stop) ? parsed.stop.length : null,
  });
}

function selectSuccessContent(rawBody: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
    return null;
  }

  const systemPrompts = parsed.messages.flatMap((message): string[] => {
    if (
      !isRecord(message) ||
      message.role !== 'system' ||
      typeof message.content !== 'string'
    ) {
      return [];
    }
    return [message.content];
  });

  const matches: SuccessPromptKind[] = [];
  if (
    systemPrompts.some((prompt) =>
      prompt.includes('You extract structured entities from notes.'),
    )
  ) {
    matches.push('entity-extraction');
  }
  if (
    systemPrompts.some((prompt) =>
      prompt.includes('Extract only directed relations explicitly supported by the note.'),
    )
  ) {
    matches.push('relation-extraction');
  }
  if (
    systemPrompts.some((prompt) =>
      prompt.includes('specific topic tags. Return ONLY a JSON array of strings'),
    )
  ) {
    matches.push('topic-tags');
  }
  if (
    systemPrompts.some((prompt) =>
      prompt.includes('Summarize each supplied entity using only facts in the note.'),
    )
  ) {
    matches.push('entity-summary');
  }
  if (
    systemPrompts.some((prompt) => prompt.includes('COPILOT_NOTE_WIKI_SUMMARY_V1'))
  ) {
    matches.push('note-wiki-summary');
  }

  return matches.length === 1 ? SUCCESS_CONTENT[matches[0]!] : null;
}

function selectGroundedRagContent(rawBody: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
    return null;
  }
  const userPrompt = parsed.messages.find((message) =>
    isRecord(message)
    && message.role === 'user'
    && typeof message.content === 'string',
  );
  if (!isRecord(userPrompt) || typeof userPrompt.content !== 'string') {
    return null;
  }
  const notePaths: string[] = [];
  const seen = new Set<string>();
  for (const match of userPrompt.content.matchAll(/\(\d+\) \[([^\]\r\n]+)\]/gu)) {
    const notePath = match[1]?.trim() ?? '';
    if (
      !notePath
      || notePath.length > 300
      || /[\u0000-\u001f\u007f]/u.test(notePath)
      || seen.has(notePath)
    ) {
      continue;
    }
    seen.add(notePath);
    notePaths.push(notePath);
  }
  if (notePaths.length === 0) return null;
  return '该回答仅依据已完成索引的本地笔记。'
    + notePaths.map((notePath) => `(来源: ${notePath})`).join(' ');
}

function buildSuccessResponse(content: string): object {
  return {
    id: 'fake-minimax-success',
    object: 'chat.completion',
    created: 0,
    model: 'MiniMax-M3',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 8,
      completion_tokens: 3,
      total_tokens: 11,
    },
  };
}

function sendGroundedRagStream(response: ServerResponse, content: string): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.write(`data: ${JSON.stringify({
    id: 'fake-minimax-grounded-rag',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'MiniMax-M3',
    choices: [{
      index: 0,
      delta: { content },
      finish_reason: 'stop',
    }],
  })}\n\n`);
  response.end('data: [DONE]\n\n');
}

function readBoundedBody(request: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    let byteLength = 0;
    let tooLarge = false;

    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      if (tooLarge) {
        return;
      }
      byteLength += Buffer.byteLength(chunk);
      if (byteLength > MAX_REQUEST_BYTES) {
        tooLarge = true;
        body = '';
        return;
      }
      body += chunk;
    });
    request.once('end', () => {
      if (tooLarge) {
        reject(new RequestTooLargeError());
        return;
      }
      resolve(body);
    });
    request.once('aborted', () => reject(new Error('Request aborted')));
    request.once('error', reject);
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

function listenOnLoopback(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, HOST);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeMessageRole(message: unknown): SanitizedMessageRole {
  if (!isRecord(message)) {
    return 'unknown';
  }
  switch (message.role) {
    case 'system':
    case 'user':
    case 'assistant':
      return message.role;
    default:
      return 'unknown';
  }
}

class RequestTooLargeError extends Error {
  constructor() {
    super('Fake MiniMax request exceeded the body limit');
    this.name = 'RequestTooLargeError';
  }
}
