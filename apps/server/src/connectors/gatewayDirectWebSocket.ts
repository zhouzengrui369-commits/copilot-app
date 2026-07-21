/**
 * OpenClaw Gateway Direct WebSocket Fallback
 *
 * Sprint4.1 — Codex sandbox cannot write `~/.openclaw/identity/device-auth.json`,
 * so the CLI path `openclaw-cn gateway call ...` returns a false "Gateway unavailable"
 * even when the Gateway RPC is healthy.
 *
 * This module implements a minimal WebSocket client that:
 *  1. Opens a WebSocket to `ws://127.0.0.1:18789` (configurable).
 *  2. Sends a `connect` frame with shared-secret auth + read-only device
 *     identity signature.
 *  3. Waits for the `hello-ok` response.
 *  4. Sends the request frame and waits for the matching response.
 *  5. For `expectFinal` calls (e.g. `agent`), it keeps consuming intermediate
 *     frames and only resolves when the response frame arrives (the spec
 *     explicitly says to ignore `payload.status === "accepted"`).
 *
 * Implementation notes:
 *  - Uses Node 24's global `WebSocket`; no new dependencies.
 *  - Reuses the token reader from the existing CLI path
 *    (com.clawdbot.gateway.plist → OPENCLAW_GATEWAY_TOKEN).
 *  - Reads `~/.openclaw/identity/device.json` for signing, but never writes
 *    `device-auth.json`.
 *  - All log output strips tokens. The `error.code` field carries the
 *    category so callers can distinguish failure modes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as cryptoSign,
} from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GatewayDirectErrorCode =
  | "ws_unavailable"           // Node global WebSocket missing
  | "ws_connection_refused"    // ECONNREFUSED
  | "ws_timeout"               // connect or response timeout
  | "ws_unauthorized"          // 401 / 4401 / token rejected
  | "ws_protocol_mismatch"     // server protocol out of range
  | "ws_hello_failed"          // server returned non-ok hello
  | "ws_request_failed"        // server returned error response
  | "ws_invalid_response"      // response shape not understood
  | "ws_aborted";

export type GatewayDirectResult<T = unknown> = {
  ok: boolean;
  status: "connected" | "unavailable";
  data?: T;
  error?: string;
  errorCode?: GatewayDirectErrorCode;
  durationMs: number;
};

type GatewayDirectOptions = {
  expectFinal?: boolean;
  signal?: AbortSignal;
};

const MIN_PROTOCOL = 3;
const MAX_PROTOCOL = 3;
const WORKBENCH_INSTANCE_ID = randomUUID();
const WS_URL_DEFAULT = "ws://127.0.0.1:18789";
const CLIENT_ID = "gateway-client";
const CLIENT_MODE = "backend";
const CLIENT_ROLE = "operator";
const CLIENT_SCOPES = ["operator.read", "operator.write", "operator.admin", "operator.approvals", "operator.pairing"];
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const WS_OPEN_TIMEOUT_MS = 5_000;
// Reading a hello-ok from a healthy local daemon is well under 3s; give 5s.
const WS_HELLO_TIMEOUT_MS = 5_000;

type IncomingFrame = {
  type?: string;
  id?: string;
  method?: string;
  ok?: boolean;
  payload?: Record<string, unknown> | null;
  error?: { code?: string | number; message?: string } | null;
};

type OutgoingFrame = {
  type: string;
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

type DeviceIdentity = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
};

export function resolveGatewayWebSocketUrl(): string {
  const fromEnv = String(process.env.OPENCLAW_WORKBENCH_GATEWAY_WS_URL || "").trim();
  if (fromEnv) return fromEnv;
  const fromConfig = readWebSocketUrlFromOpenclawConfig();
  if (fromConfig) return fromConfig;
  return WS_URL_DEFAULT;
}

function readWebSocketUrlFromOpenclawConfig(): string | null {
  const candidates = [
    path.join(os.homedir(), ".openclaw/openclaw.json"),
    path.join(process.cwd(), "openclaw.json"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const text = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(text) as { gateway?: { wsUrl?: string; url?: string; websocketUrl?: string; port?: number } };
      const url = parsed.gateway?.wsUrl || parsed.gateway?.websocketUrl || parsed.gateway?.url;
      if (url) return String(url);
      if (parsed.gateway?.port) return `ws://127.0.0.1:${parsed.gateway.port}`;
    } catch {
      // ignore parse errors and fall through
    }
  }
  return null;
}

async function readGatewayTokenFromLaunchAgent(): Promise<string | undefined> {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    const token = String(process.env.OPENCLAW_GATEWAY_TOKEN || "").trim();
    return token.length >= 20 ? token : undefined;
  }
  const plist = path.join(os.homedir(), "Library/LaunchAgents/com.clawdbot.gateway.plist");
  if (!fs.existsSync(plist)) return undefined;
  try {
    const { stdout } = await execFileAsync(
      "plutil",
      ["-extract", "EnvironmentVariables.OPENCLAW_GATEWAY_TOKEN", "raw", plist],
      { timeout: 1500, maxBuffer: 4096 },
    );
    const token = stdout.trim();
    return token.length >= 20 ? token : undefined;
  } catch {
    return undefined;
  }
}

type WebSocketLike = new (url: string) => {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: string, listener: (event: { data?: unknown; code?: number; reason?: string; message?: string; error?: { message?: string } }) => void) => void;
};

function requireGlobalWebSocket(): WebSocketLike {
  const ctor = (globalThis as { WebSocket?: WebSocketLike }).WebSocket;
  if (typeof ctor !== "function") {
    throw makeDirectError("ws_unavailable", "Node global WebSocket is unavailable on this runtime.");
  }
  return ctor;
}

function makeDirectError(code: GatewayDirectErrorCode, message: string): Error & { code: GatewayDirectErrorCode } {
  const err = new Error(message) as Error & { code: GatewayDirectErrorCode };
  err.code = code;
  return err;
}

function classifyHelloError(payload: unknown): { code: GatewayDirectErrorCode; message: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const code = String(record.code || "").toLowerCase();
  const message = String(record.message || record.reason || "");
  if (code === "unauthorized" || code === "auth_required" || code === "invalid_token" || /token|auth|unauthor|forbid/i.test(message)) {
    return { code: "ws_unauthorized", message: message || "Gateway rejected the auth token." };
  }
  if (code === "protocol_mismatch" || /protocol version/i.test(message)) {
    return { code: "ws_protocol_mismatch", message: message || "Gateway protocol version out of range." };
  }
  return null;
}

function redactToken(text: string): string {
  return text
    .replace(/[a-f0-9]{32,}/gi, "[redacted]")
    .replace(/token=\S+/gi, "token=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem: string): string {
  return createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex");
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function loadDeviceIdentityReadonly(): DeviceIdentity | null {
  const file = path.join(os.homedir(), ".openclaw", "identity", "device.json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<DeviceIdentity> & { version?: number };
    if (
      parsed.version === 1 &&
      typeof parsed.publicKeyPem === "string" &&
      typeof parsed.privateKeyPem === "string"
    ) {
      return {
        deviceId: fingerprintPublicKey(parsed.publicKeyPem),
        publicKeyPem: parsed.publicKeyPem,
        privateKeyPem: parsed.privateKeyPem,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce?: string;
  version?: "v1" | "v2";
}): string {
  const version = params.version ?? (params.nonce ? "v2" : "v1");
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
  ];
  if (version === "v2") base.push(params.nonce ?? "");
  return base.join("|");
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = createPrivateKey(privateKeyPem);
  const signature = cryptoSign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(signature);
}

/**
 * Open a WebSocket and run a single request against the Gateway.
 * Used when the CLI path is unavailable (Codex sandbox device-auth write block,
 * protocol mismatch, or `OPENCLAW_WORKBENCH_GATEWAY_DIRECT=1`).
 */
export async function gatewayCallDirectWebSocket<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs: number,
  options: GatewayDirectOptions = {},
): Promise<GatewayDirectResult<T>> {
  const startedAt = Date.now();
  const ctor = requireGlobalWebSocket();
  const url = resolveGatewayWebSocketUrl();
  const token = await readGatewayTokenFromLaunchAgent();
  if (!token) {
    return {
      ok: false,
      status: "unavailable",
      errorCode: "ws_unauthorized",
      error: "OpenClaw Gateway token not found in env or com.clawdbot.gateway.plist.",
      durationMs: Date.now() - startedAt,
    };
  }

  const ws = new ctor(url);
  const requestId = randomUUID();
  const helloId = randomUUID();

  // expectFinal may legitimately take minutes (agent calls). Use a separate
  // connect/hello window so we don't blow the budget before sending the request.
  const helloBudgetMs = WS_HELLO_TIMEOUT_MS;
  const responseBudgetMs = Math.max(timeoutMs, 1_000);

  return new Promise<GatewayDirectResult<T>>((resolve) => {
    let settled = false;
    let helloOk = false;
    let requestSent = false;
    const collected: IncomingFrame[] = [];
    let timer: NodeJS.Timeout | null = null;

    const finish = (result: GatewayDirectResult<T>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { ws.close(); } catch { /* best effort */ }
      resolve(result);
    };

    const sendRequest = () => {
      const frame: OutgoingFrame = {
        type: "req",
        id: requestId,
        method,
        params,
      };
      try {
        ws.send(JSON.stringify(frame));
        requestSent = true;
        timer = setTimeout(() => {
          finish({
            ok: false,
            status: "unavailable",
            errorCode: "ws_timeout",
            error: `OpenClaw Gateway direct WebSocket response timeout after ${responseBudgetMs}ms for ${method}.`,
            durationMs: Date.now() - startedAt,
          });
        }, responseBudgetMs);
      } catch (err) {
        finish({
          ok: false,
          status: "unavailable",
          errorCode: "ws_request_failed",
          error: redactToken(err instanceof Error ? err.message : String(err)),
          durationMs: Date.now() - startedAt,
        });
      }
    };

    const sendHello = () => {
      const deviceIdentity = loadDeviceIdentityReadonly();
      if (!deviceIdentity) {
        finish({
          ok: false,
          status: "unavailable",
          errorCode: "ws_unauthorized",
          error: "OpenClaw Gateway device identity is not readable from Workbench.",
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      const signedAtMs = Date.now();
      const devicePayload = buildDeviceAuthPayload({
        deviceId: deviceIdentity.deviceId,
        clientId: CLIENT_ID,
        clientMode: CLIENT_MODE,
        role: CLIENT_ROLE,
        scopes: CLIENT_SCOPES,
        signedAtMs,
        token,
        version: "v1",
      });
      const hello: OutgoingFrame = {
        type: "req",
        id: helloId,
        method: "connect",
        params: {
          minProtocol: MIN_PROTOCOL,
          maxProtocol: MAX_PROTOCOL,
          client: {
            id: CLIENT_ID,
            displayName: "OpenClaw Workbench",
            version: "dev",
            platform: process.platform,
            mode: CLIENT_MODE,
            instanceId: WORKBENCH_INSTANCE_ID,
          },
          caps: [],
          role: CLIENT_ROLE,
          scopes: CLIENT_SCOPES,
          auth: { token },
          device: {
            id: deviceIdentity.deviceId,
            publicKey: publicKeyRawBase64UrlFromPem(deviceIdentity.publicKeyPem),
            signature: signDevicePayload(deviceIdentity.privateKeyPem, devicePayload),
            signedAt: signedAtMs,
          },
        },
      };
      try {
        ws.send(JSON.stringify(hello));
        timer = setTimeout(() => {
          finish({
            ok: false,
            status: "unavailable",
            errorCode: "ws_timeout",
            error: `OpenClaw Gateway direct WebSocket hello timeout after ${helloBudgetMs}ms.`,
            durationMs: Date.now() - startedAt,
          });
        }, helloBudgetMs);
      } catch (err) {
        finish({
          ok: false,
          status: "unavailable",
          errorCode: "ws_request_failed",
          error: redactToken(err instanceof Error ? err.message : String(err)),
          durationMs: Date.now() - startedAt,
        });
      }
    };

    const handleFrame = (raw: string) => {
      let frame: IncomingFrame;
      try {
        frame = JSON.parse(raw) as IncomingFrame;
      } catch {
        return;
      }
      // hello response (matches our hello id)
      if (frame.id === helloId) {
        const helloClass = classifyHelloError(frame.payload) || classifyHelloError(frame.error);
        if (frame.ok && frame.type === "res") {
          helloOk = true;
          if (timer) { clearTimeout(timer); timer = null; }
          sendRequest();
          return;
        }
        finish({
          ok: false,
          status: "unavailable",
          errorCode: helloClass?.code || "ws_hello_failed",
          error: redactToken(helloClass?.message || frame.error?.message || "Gateway hello failed."),
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      // server-initiated push or intermediate — buffer and continue waiting.
      if (frame.type === "event" || frame.id !== requestId) {
        collected.push(frame);
        return;
      }
      // Final response for our request.
      if (frame.ok) {
        const payload = (frame.payload || {}) as Record<string, unknown>;
        // For expectFinal, ignore `accepted` and keep waiting.
        if (options.expectFinal && String(payload.status || "").toLowerCase() === "accepted") {
          collected.push(frame);
          return;
        }
        finish({
          ok: true,
          status: "connected",
          data: payload as T,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      // error response
      const errMsg = String(frame.error?.message || frame.error?.code || "Gateway request failed");
      const errorCode = classifyHelloError(frame.error)?.code || "ws_request_failed";
      finish({
        ok: false,
        status: "unavailable",
        errorCode,
        error: redactToken(errMsg),
        durationMs: Date.now() - startedAt,
      });
    };

    const onOpen = () => {
      sendHello();
    };
    const onMessage = (event: { data?: unknown }) => {
      const data = typeof event.data === "string" ? event.data : String(event.data ?? "");
      if (!data) return;
      handleFrame(data);
    };
    const onError = (event: { message?: string; error?: { message?: string } }) => {
      if (settled) return;
      const rawMessage = String(event.message || event.error?.message || "WebSocket connection error");
      // The WHATWG WebSocket spec doesn't carry close codes in `error` events,
      // so we approximate the category from common Node-side error messages.
      const lower = rawMessage.toLowerCase();
      let errorCode: GatewayDirectErrorCode = "ws_hello_failed";
      if (lower.includes("econnrefused") || lower.includes("refused") || lower.includes("unreachable")) {
        errorCode = "ws_connection_refused";
      } else if (lower.includes("timeout") || lower.includes("timed out")) {
        errorCode = "ws_timeout";
      } else if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("invalid token") || lower.includes("auth")) {
        errorCode = "ws_unauthorized";
      } else if (lower.includes("protocol")) {
        errorCode = "ws_protocol_mismatch";
      }
      finish({
        ok: false,
        status: "unavailable",
        errorCode,
        error: redactToken(rawMessage),
        durationMs: Date.now() - startedAt,
      });
    };
    const onClose = (event: { code?: number; reason?: string; wasClean?: boolean }) => {
      if (settled) return;
      if (!helloOk) {
        const code = Number(event.code || 0);
        const reason = String(event.reason || "").trim();
        let errorCode: GatewayDirectErrorCode = "ws_connection_refused";
        let errorMsg = `WebSocket closed before hello-ok (code=${code || "n/a"} reason=${reason || "n/a"}).`;
        if (code === 1006 || code === 1011) {
          errorCode = "ws_connection_refused";
        } else if (code === 4401 || /unauthor|forbid|token|auth/i.test(reason)) {
          errorCode = "ws_unauthorized";
          errorMsg = `WebSocket closed with auth error: ${reason || "unauthorized"}`;
        } else if (code === 4400 || /protocol/i.test(reason)) {
          errorCode = "ws_protocol_mismatch";
          errorMsg = `WebSocket closed with protocol error: ${reason || "protocol mismatch"}`;
        }
        finish({
          ok: false,
          status: "unavailable",
          errorCode,
          error: redactToken(errorMsg),
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      if (!requestSent) {
        finish({
          ok: false,
          status: "unavailable",
          errorCode: "ws_hello_failed",
          error: "WebSocket closed before the request could be sent.",
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      // If we never received a final response, treat as timeout/closed.
      finish({
        ok: false,
        status: "unavailable",
        errorCode: "ws_timeout",
        error: `WebSocket closed without final response (code=${event.code || "n/a"} reason=${event.reason || "n/a"}).`,
        durationMs: Date.now() - startedAt,
      });
    };

    const onAbort = () => {
      finish({
        ok: false,
        status: "unavailable",
        errorCode: "ws_aborted",
        error: "Workbench request aborted while waiting for direct Gateway WebSocket response.",
        durationMs: Date.now() - startedAt,
      });
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    // Connect/open watchdog: cap the time we'll wait for the socket to open.
    const openTimer = setTimeout(() => {
      if (settled) return;
      if (!helloOk) {
        finish({
          ok: false,
          status: "unavailable",
          errorCode: "ws_timeout",
          error: `OpenClaw Gateway direct WebSocket connect timeout after ${WS_OPEN_TIMEOUT_MS}ms (url=${url}).`,
          durationMs: Date.now() - startedAt,
        });
      }
    }, WS_OPEN_TIMEOUT_MS);

    ws.addEventListener("open", () => {
      clearTimeout(openTimer);
      onOpen();
    });
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

/**
 * Decide whether the CLI error message indicates we should fall back to the
 * direct WebSocket path. The CLI uses the shared identity file at
 * `~/.openclaw/identity/device-auth.json` even for shared-secret calls;
 * inside the Codex sandbox that file is not writable, which surfaces as an
 * EPERM. Older CLIs may also throw a "protocol mismatch" parsing error.
 */
export function shouldFallbackToDirectWebSocket(message: string): boolean {
  if (!message) return false;
  return /device-auth(?:\.json|-store)|EPERM:[\s\S]*\.openclaw[\s\S]*device-auth/i.test(message)
    || /protocol\s+(mismatch|version)|unsupported protocol|unknown protocol|invalid protocol/i.test(message)
    || /OpenClaw Gateway CLI timed out after \d+ms while waiting for RPC response/i.test(message)
    || /gateway timeout after \d+ms/i.test(message)
    || /invalid\s+json\s+response[\s\S]*protocol|JSON.parse[\s\S]*protocol/i.test(message);
}

export function directFallbackReason(message: string): "device_auth_unwritable" | "protocol_mismatch" | null {
  if (/device-auth(?:\.json|-store)|EPERM:[\s\S]*\.openclaw[\s\S]*device-auth/i.test(message)) {
    return "device_auth_unwritable";
  }
  if (/protocol\s+(mismatch|version)|unsupported protocol|unknown protocol|invalid protocol/i.test(message)) {
    return "protocol_mismatch";
  }
  return null;
}
