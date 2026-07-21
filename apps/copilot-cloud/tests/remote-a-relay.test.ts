import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/index.js';
import { buildTestConfig } from './helpers.js';

const REMOTE_PATH = '/v1/remote/ws';
const OWNER_ID = 'owner_0123456789abcdef';
const CONTROLLER_ID = 'controller_0123456789abcdef';
const TARGET_A = 'target_0123456789abcdef';
const TARGET_B = 'target_fedcba9876543210';
const SIGNATURE = Buffer.alloc(64, 7).toString('base64url');

const sockets = new Set<WebSocket>();
const apps = new Set<Awaited<ReturnType<typeof buildApp>>>();

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  sockets.clear();
  await Promise.all([...apps].map((app) => app.close().catch(() => undefined)));
  apps.clear();
});

function sha256Base64url(value: string): { ciphertext: string; sha256: string } {
  const bytes = Buffer.from(value, 'utf8');
  return {
    ciphertext: bytes.toString('base64url'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function envelope(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const payload = sha256Base64url('opaque-ciphertext-canary');
  return {
    schemaVersion: 1,
    messageType: 'command',
    requestId: randomUUID(),
    sessionId: overrides.sessionId ?? randomUUID(),
    commandId: randomUUID(),
    ownerId: OWNER_ID,
    controllerId: CONTROLLER_ID,
    targetId: TARGET_A,
    nonce: Buffer.from(randomUUID()).toString('base64url'),
    issuedAtMs: now,
    expiresAtMs: now + 60_000,
    payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM',
    payloadCiphertext: payload.ciphertext,
    payloadSha256: payload.sha256,
    controllerSignature: SIGNATURE,
    ...overrides,
  };
}

function headers(role: 'controller' | 'target', sessionId: string, principalId?: string) {
  return {
    authorization: `Bearer ${role}-token`,
    'x-remote-role': role,
    'x-owner-id': OWNER_ID,
    ...(role === 'controller'
      ? { 'x-controller-id': principalId ?? CONTROLLER_ID }
      : { 'x-target-id': principalId ?? TARGET_A }),
    'x-session-id': sessionId,
  };
}

async function startRelay(remoteOptions: Record<string, unknown> = {}) {
  const config = buildTestConfig({
    remote: { enabled: true, path: REMOTE_PATH },
  } as never);
  const app = await buildApp({
    config,
    logger: false,
    remoteRelay: {
      transportVerifier: () => true,
      authVerifier: ({ role, authorization }: { role: string; authorization: string }) =>
        authorization === `Bearer ${role}-token`,
      signatureVerifier: () => true,
      ...remoteOptions,
    },
  } as never);
  apps.add(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  return { app, baseUrl: `ws://127.0.0.1:${address.port}` };
}

function connect(url: string, requestHeaders: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: requestHeaders });
    sockets.add(socket);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function rejectedUpgrade(
  url: string,
  requestHeaders: Record<string, string>,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: requestHeaders });
    sockets.add(socket);
    socket.once('unexpected-response', (_request, response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += String(chunk); });
      response.on('end', () => resolve({
        statusCode: response.statusCode ?? 0,
        body: JSON.parse(body) as Record<string, unknown>,
      }));
    });
    socket.once('error', (error) => {
      if (!String(error).includes('Unexpected server response')) reject(error);
    });
  });
}

function nextJson(socket: WebSocket, timeoutMs = 1_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    socket.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)) as Record<string, unknown>);
    });
  });
}

function expectNoMessage(socket: WebSocket, timeoutMs = 80): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = () => {
      clearTimeout(timer);
      reject(new Error('unexpected queued message'));
    };
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, timeoutMs);
    socket.once('message', onMessage);
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function nextJsonBatch(
  socket: WebSocket,
  count: number,
  timeoutMs = 1_000,
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const messages: Array<Record<string, unknown>> = [];
    const onMessage = (data: WebSocket.RawData) => {
      messages.push(JSON.parse(String(data)) as Record<string, unknown>);
      if (messages.length === count) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(messages);
      }
    };
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`message batch timeout: received ${messages.length}/${count}`));
    }, timeoutMs);
    socket.on('message', onMessage);
  });
}

describe('Remote A config and real WebSocket upgrade boundary', () => {
  it('defaults the relay OFF', () => {
    expect(loadConfig({}).remote).toMatchObject({
      enabled: false,
      path: REMOTE_PATH,
      authority: {
        providerState: 'missing', issuerKeyPath: '', maxSessions: 1_000,
        maxUsedRequests: 1_000, sessionTtlMs: 900_000,
      },
    });
  });

  it('rejects query-token authentication even when a valid header is present', async () => {
    const { baseUrl } = await startRelay();
    const sessionId = randomUUID();
    const response = await rejectedUpgrade(
      `${baseUrl}${REMOTE_PATH}?token=query-secret-canary`,
      headers('controller', sessionId),
    );
    expect(response.statusCode).toBe(401);
    expect(response.body).toMatchObject({ code: 'AUTH_INVALID' });
    expect(JSON.stringify(response.body)).not.toContain('query-secret-canary');
  });

  it('requires Authorization header and defaults production verification closed', async () => {
    const sessionId = randomUUID();
    const { baseUrl } = await startRelay({ authVerifier: undefined });
    const missing = headers('controller', sessionId);
    delete (missing as Partial<typeof missing>).authorization;

    await expect(rejectedUpgrade(`${baseUrl}${REMOTE_PATH}`, missing)).resolves.toMatchObject({
      statusCode: 401,
      body: { code: 'AUTH_REQUIRED' },
    });
    await expect(
      rejectedUpgrade(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId)),
    ).resolves.toMatchObject({ statusCode: 401, body: { code: 'AUTH_INVALID' } });
  });

  it('bounds a hanging upgrade auth verifier with a stable retryable timeout', async () => {
    const authGate = deferred<boolean>();
    const { baseUrl } = await startRelay({
      authVerifyTimeoutMs: 40,
      authVerifier: () => authGate.promise,
    });
    const sessionId = randomUUID();
    const fallback = setTimeout(() => authGate.resolve(false), 150);
    await expect(
      rejectedUpgrade(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId)),
    ).resolves.toMatchObject({
      statusCode: 503,
      body: { code: 'VERIFY_TIMEOUT', retryable: true },
    });
    clearTimeout(fallback);
    authGate.resolve(false);
  });

  it('rejects a plaintext WebSocket upgrade when no test transport verifier is injected', async () => {
    const sessionId = randomUUID();
    const { baseUrl } = await startRelay({ transportVerifier: undefined });
    await expect(
      rejectedUpgrade(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId)),
    ).resolves.toMatchObject({
      statusCode: 426,
      body: { code: 'SERVICE_UNAVAILABLE' },
    });
  });
});

describe('Remote A online-only routing through the real WebSocket adapter', () => {
  it('routes only command/ack/status messages between independently authenticated peers', async () => {
    const { baseUrl } = await startRelay();
    const sessionId = randomUUID();
    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));

    for (const messageType of ['command', 'status_query'] as const) {
      const message = envelope({ messageType, sessionId });
      const received = nextJson(target);
      controller.send(JSON.stringify(message));
      await expect(received).resolves.toEqual(message);
    }
    for (const messageType of ['ack', 'status_reply'] as const) {
      const message = envelope({ messageType, sessionId });
      const received = nextJson(controller);
      target.send(JSON.stringify(message));
      await expect(received).resolves.toEqual(message);
    }
  });

  it('returns TARGET_OFFLINE immediately and never queues for a later target', async () => {
    const { baseUrl } = await startRelay();
    const sessionId = randomUUID();
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const message = envelope({ sessionId });
    const offline = nextJson(controller);
    controller.send(JSON.stringify(message));
    await expect(offline).resolves.toMatchObject({ code: 'TARGET_OFFLINE' });

    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    await expect(expectNoMessage(target)).resolves.toBeUndefined();
  });

  it('captures offline-at-arrival before signature verification and never delivers to a later target', async () => {
    const verifierGate = deferred<boolean>();
    const verifierEntered = deferred<void>();
    let verifierCalls = 0;
    const { baseUrl } = await startRelay({
      signatureVerifier: () => {
        verifierCalls += 1;
        verifierEntered.resolve();
        return verifierGate.promise;
      },
    });
    const sessionId = randomUUID();
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const response = nextJson(controller, 500).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    controller.send(JSON.stringify(envelope({ sessionId })));
    const firstOutcome = await Promise.race([
      response.then((result) => ({ kind: 'response' as const, result })),
      verifierEntered.promise.then(() => ({ kind: 'verifier' as const })),
    ]);

    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const targetSilence = expectNoMessage(target, 150).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    verifierGate.resolve(true);

    expect(firstOutcome).toMatchObject({
      kind: 'response',
      result: { ok: true, value: { code: 'TARGET_OFFLINE' } },
    });
    expect(await response).toMatchObject({ ok: true, value: { code: 'TARGET_OFFLINE' } });
    expect(await targetSilence).toMatchObject({ ok: true });
    expect(verifierCalls).toBe(0);
  });

  it('never switches delivery from captured target connection A to replacement B', async () => {
    const verifierGate = deferred<boolean>();
    const verifierEntered = deferred<void>();
    const { baseUrl } = await startRelay({
      signatureVerifier: () => {
        verifierEntered.resolve();
        return verifierGate.promise;
      },
    });
    const sessionId = randomUUID();
    const targetA = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const response = nextJson(controller, 500).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    controller.send(JSON.stringify(envelope({ sessionId })));
    await verifierEntered.promise;
    const targetAClosed = new Promise<void>((resolve) => targetA.once('close', () => resolve()));
    targetA.close();
    await targetAClosed;
    const targetB = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const targetBSilence = expectNoMessage(targetB, 150).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    verifierGate.resolve(true);

    expect(await response).toMatchObject({ ok: true, value: { code: 'TARGET_OFFLINE' } });
    expect(await targetBSilence).toMatchObject({ ok: true });
  });

  it('drops an in-flight command when its exact sender connection is replaced', async () => {
    const verifierGate = deferred<boolean>();
    const verifierEntered = deferred<void>();
    const { baseUrl } = await startRelay({
      signatureVerifier: () => {
        verifierEntered.resolve();
        return verifierGate.promise;
      },
    });
    const sessionId = randomUUID();
    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controllerA = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    controllerA.send(JSON.stringify(envelope({ sessionId })));
    await verifierEntered.promise;

    const controllerAClosed = new Promise<void>((resolve) => {
      controllerA.once('close', () => resolve());
    });
    const controllerB = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    await controllerAClosed;
    const targetSilence = expectNoMessage(target, 150);
    const controllerBSilence = expectNoMessage(controllerB, 150);
    verifierGate.resolve(true);

    await expect(targetSilence).resolves.toBeUndefined();
    await expect(controllerBSilence).resolves.toBeUndefined();
  });

  it('cleans up a disconnected target without retry or delayed delivery', async () => {
    const { baseUrl } = await startRelay();
    const sessionId = randomUUID();
    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const closed = new Promise<void>((resolve) => target.once('close', () => resolve()));
    target.close();
    await closed;

    const offline = nextJson(controller);
    controller.send(JSON.stringify(envelope({ sessionId })));
    await expect(offline).resolves.toMatchObject({ code: 'TARGET_OFFLINE' });
  });

  it('expires idle sessions after 15 minutes', async () => {
    let now = Date.now();
    const { baseUrl } = await startRelay({ clock: () => now, sweepIntervalMs: 5 });
    const sessionId = randomUUID();
    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const targetExpired = nextJson(target);
    const controllerExpired = nextJson(controller);
    now += 15 * 60_000 + 1;
    await expect(targetExpired).resolves.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(controllerExpired).resolves.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('expires a continuously refreshed session at the eight-hour hard limit', async () => {
    const connectedAt = Date.now();
    let now = connectedAt;
    const { baseUrl } = await startRelay({ clock: () => now, sweepIntervalMs: 5 });
    const sessionId = randomUUID();
    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));

    now = connectedAt + 8 * 60 * 60_000 - 60_000;
    const refresh = envelope({
      sessionId,
      issuedAtMs: now,
      expiresAtMs: now + 60_000,
    });
    const refreshed = nextJson(target);
    controller.send(JSON.stringify(refresh));
    await refreshed;

    const targetExpired = nextJson(target, 3_000);
    const controllerExpired = nextJson(controller, 3_000);
    now += 60_001;
    await expect(targetExpired).resolves.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(controllerExpired).resolves.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});

describe('Remote A strict envelope, binding, replay and lifecycle contract', () => {
  it('fails unknown fields and an outer envelope above 64 KiB', async () => {
    const { baseUrl } = await startRelay();
    const sessionId = randomUUID();
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));

    const invalid = nextJson(controller);
    controller.send(JSON.stringify(envelope({ sessionId, unexpected: true })));
    await expect(invalid).resolves.toMatchObject({ code: 'INVALID_SCHEMA' });

    const oversized = nextJson(controller);
    controller.send('x'.repeat(65_537));
    await expect(oversized).resolves.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it.each([
    ['ttl above 120 seconds', (value: Record<string, unknown>) => ({ ...value, expiresAtMs: Number(value.issuedAtMs) + 120_001 }), 'TTL_INVALID'],
    ['future clock skew above 30 seconds', (value: Record<string, unknown>) => {
      const issuedAtMs = Date.now() + 60_000;
      return { ...value, issuedAtMs, expiresAtMs: issuedAtMs + 10_000 };
    }, 'TTL_INVALID'],
    ['expired command', (value: Record<string, unknown>) => ({ ...value, issuedAtMs: Date.now() - 10_000, expiresAtMs: Date.now() - 1_000 }), 'COMMAND_EXPIRED'],
    ['wrong algorithm', (value: Record<string, unknown>) => ({ ...value, payloadAlgorithm: 'A256GCM' }), 'INVALID_SCHEMA'],
    ['ciphertext digest mismatch', (value: Record<string, unknown>) => ({ ...value, payloadSha256: '0'.repeat(64) }), 'INVALID_SCHEMA'],
    ['short nonce', (value: Record<string, unknown>) => ({ ...value, nonce: Buffer.from('short').toString('base64url') }), 'INVALID_SCHEMA'],
    ['non-v4 command id', (value: Record<string, unknown>) => ({ ...value, commandId: 'not-a-uuid' }), 'INVALID_SCHEMA'],
  ])('rejects %s with %s', async (_name, mutate, code) => {
    const { baseUrl } = await startRelay();
    const sessionId = randomUUID();
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const response = nextJson(controller);
    controller.send(JSON.stringify(mutate(envelope({ sessionId }))));
    await expect(response).resolves.toMatchObject({ code });
  });

  it('enforces owner/controller/target/session binding before forwarding', async () => {
    const { baseUrl } = await startRelay();
    const sessionId = randomUUID();
    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const response = nextJson(controller);
    controller.send(JSON.stringify(envelope({ sessionId, controllerId: 'controller_other_123456' })));
    await expect(response).resolves.toMatchObject({ code: 'TARGET_MISMATCH' });
    await expect(expectNoMessage(target)).resolves.toBeUndefined();
  });

  it('fails closed when the signature verifier rejects', async () => {
    const { baseUrl } = await startRelay({ signatureVerifier: () => false });
    const sessionId = randomUUID();
    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const response = nextJson(controller);
    controller.send(JSON.stringify(envelope({ sessionId })));
    await expect(response).resolves.toMatchObject({ code: 'SIGNATURE_INVALID' });
    await expect(expectNoMessage(target)).resolves.toBeUndefined();
  });

  it('times out a hanging signature verifier and releases the pending replay reservation', async () => {
    let verifierCalls = 0;
    const { baseUrl } = await startRelay({
      signatureVerifyTimeoutMs: 40,
      signatureVerifier: () => {
        verifierCalls += 1;
        return verifierCalls === 1 ? new Promise<boolean>(() => undefined) : true;
      },
    });
    const sessionId = randomUUID();
    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const nonce = Buffer.from('timeout-replay-key-at-least-16').toString('base64url');
    const first = envelope({ sessionId, nonce });
    const timedOut = nextJson(controller, 750);
    const targetSilence = expectNoMessage(target, 150);
    controller.send(JSON.stringify(first));

    await expect(timedOut).resolves.toMatchObject({
      code: 'SIGNATURE_TIMEOUT',
      requestId: first.requestId,
      retryable: true,
    });
    await expect(targetSilence).resolves.toBeUndefined();

    const retry = {
      ...first,
      requestId: randomUUID(),
      commandId: randomUUID(),
    };
    const delivered = nextJson(target);
    controller.send(JSON.stringify(retry));
    await expect(delivered).resolves.toEqual(retry);
    expect(verifierCalls).toBe(2);
  });

  it('bounds concurrent hanging verifiers and closes without retained pending relay work', async () => {
    const { app, baseUrl } = await startRelay({
      signatureVerifyTimeoutMs: 40,
      signatureVerifier: () => new Promise<boolean>(() => undefined),
    });
    const sessionId = randomUUID();
    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const count = 12;
    const responses = nextJsonBatch(controller, count, 1_500);
    const targetSilence = expectNoMessage(target, 200);

    for (let index = 0; index < count; index += 1) {
      controller.send(JSON.stringify(envelope({ sessionId })));
    }

    const received = await responses;
    expect(received).toHaveLength(count);
    expect(received.every((item) => item.code === 'SIGNATURE_TIMEOUT')).toBe(true);
    expect(new Set(received.map((item) => item.requestId)).size).toBe(count);
    await expect(targetSilence).resolves.toBeUndefined();

    await expect(Promise.race([
      app.close().then(() => 'closed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 500)),
    ])).resolves.toBe('closed');
    apps.delete(app);
  });

  it('shuts down during an in-flight hanging verifier without waiting for it', async () => {
    const verifierEntered = deferred<void>();
    const { app, baseUrl } = await startRelay({
      signatureVerifyTimeoutMs: 5_000,
      signatureVerifier: () => {
        verifierEntered.resolve();
        return new Promise<boolean>(() => undefined);
      },
    });
    const sessionId = randomUUID();
    await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    controller.send(JSON.stringify(envelope({ sessionId })));
    await verifierEntered.promise;

    await expect(Promise.race([
      app.close().then(() => 'closed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 500)),
    ])).resolves.toBe('closed');
    apps.delete(app);
  });

  it('keys replay by owner/controller/target/nonce and expires no earlier than command expiry', async () => {
    const { baseUrl } = await startRelay();
    const sessionId = randomUUID();
    const targetA = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId, TARGET_A));
    const targetB = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId, TARGET_B));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const nonce = Buffer.from('same-replay-key-at-least-16').toString('base64url');

    const first = envelope({ sessionId, targetId: TARGET_A, nonce });
    const firstReceived = nextJson(targetA);
    controller.send(JSON.stringify(first));
    await firstReceived;

    const replay = nextJson(controller);
    controller.send(JSON.stringify({ ...first, requestId: randomUUID(), commandId: randomUUID() }));
    await expect(replay).resolves.toMatchObject({ code: 'NONCE_REPLAYED' });

    const otherTarget = envelope({ sessionId, targetId: TARGET_B, nonce });
    const otherReceived = nextJson(targetB);
    controller.send(JSON.stringify(otherTarget));
    await expect(otherReceived).resolves.toEqual(otherTarget);
  });

  it('retains a replay key through command expiry plus 30 seconds, then releases it', async () => {
    let now = Date.now();
    const { baseUrl } = await startRelay({ clock: () => now });
    const sessionId = randomUUID();
    const target = await connect(`${baseUrl}${REMOTE_PATH}`, headers('target', sessionId));
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const nonce = Buffer.from('expiry-replay-key-at-least-16').toString('base64url');
    const originalExpiry = now + 1_000;
    const first = envelope({
      sessionId,
      nonce,
      issuedAtMs: now,
      expiresAtMs: originalExpiry,
    });
    const firstReceived = nextJson(target);
    controller.send(JSON.stringify(first));
    await firstReceived;

    now = originalExpiry + 29_999;
    const beforeRetentionEnd = envelope({
      sessionId,
      nonce,
      issuedAtMs: now,
      expiresAtMs: now + 60_000,
    });
    const replay = nextJson(controller);
    controller.send(JSON.stringify(beforeRetentionEnd));
    await expect(replay).resolves.toMatchObject({ code: 'NONCE_REPLAYED' });

    now = originalExpiry + 30_001;
    const afterRetention = envelope({
      sessionId,
      nonce,
      issuedAtMs: now,
      expiresAtMs: now + 60_000,
    });
    const forwarded = nextJson(target);
    controller.send(JSON.stringify(afterRetention));
    await expect(forwarded).resolves.toEqual(afterRetention);
  });

  it('uses process-memory replay state only, so a relay restart stores and replays nothing', async () => {
    const sessionOne = randomUUID();
    const nonce = Buffer.from('restart-replay-key-at-least-16').toString('base64url');
    const firstRelay = await startRelay();
    const targetOne = await connect(`${firstRelay.baseUrl}${REMOTE_PATH}`, headers('target', sessionOne));
    const controllerOne = await connect(`${firstRelay.baseUrl}${REMOTE_PATH}`, headers('controller', sessionOne));
    const first = envelope({ sessionId: sessionOne, nonce });
    const receivedOne = nextJson(targetOne);
    controllerOne.send(JSON.stringify(first));
    await receivedOne;
    await firstRelay.app.close();
    apps.delete(firstRelay.app);

    const sessionTwo = randomUUID();
    const secondRelay = await startRelay();
    const targetTwo = await connect(`${secondRelay.baseUrl}${REMOTE_PATH}`, headers('target', sessionTwo));
    const controllerTwo = await connect(`${secondRelay.baseUrl}${REMOTE_PATH}`, headers('controller', sessionTwo));
    const second = envelope({ sessionId: sessionTwo, nonce });
    const receivedTwo = nextJson(targetTwo);
    controllerTwo.send(JSON.stringify(second));
    await expect(receivedTwo).resolves.toEqual(second);
  });

  it('rate-limits in process memory without logging or echoing ciphertext', async () => {
    const { baseUrl } = await startRelay({ messageRateLimit: 1 });
    const sessionId = randomUUID();
    const controller = await connect(`${baseUrl}${REMOTE_PATH}`, headers('controller', sessionId));
    const first = nextJson(controller);
    controller.send(JSON.stringify(envelope({ sessionId, unexpected: 'ciphertext-log-canary' })));
    await expect(first).resolves.toMatchObject({ code: 'INVALID_SCHEMA' });

    const limited = nextJson(controller);
    controller.send(JSON.stringify(envelope({ sessionId, unexpected: 'ciphertext-log-canary' })));
    const body = await limited;
    expect(body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(JSON.stringify(body)).not.toContain('ciphertext-log-canary');
  });
});
