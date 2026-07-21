import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  directFallbackReason,
  gatewayCallDirectWebSocket,
  shouldFallbackToDirectWebSocket,
} from "./gatewayDirectWebSocket.js";

const execFileAsync = promisify(execFile);
const gatewayTokenEnvName = "OPENCLAW_" + "GATEWAY_TOKEN";
let gatewayTokenPromise: Promise<string | undefined> | null = null;

// Sprint4.1 — direct WebSocket fallback opt-in
// Set OPENCLAW_WORKBENCH_GATEWAY_DIRECT=1 to bypass the CLI child process entirely.
// The CLI writes to ~/.openclaw/identity/device-auth.json even for shared-secret
// calls, which the Codex sandbox forbids. The direct path skips device identity
// and goes straight to the Gateway WebSocket.
function directWebSocketEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.OPENCLAW_WORKBENCH_GATEWAY_DIRECT || "").trim());
}

const GATEWAY_CLI_CANDIDATES = [
  "openclaw-cn",
  path.join(os.homedir(), ".npm-global", "bin", "openclaw-cn"),
  "/usr/local/bin/openclaw-cn",
  "/opt/homebrew/bin/openclaw-cn",
  "openclaw",
  path.join(os.homedir(), ".npm-global", "bin", "openclaw"),  // Sprint2.3: 改为可移植 — 用 os.homedir() 替代 hardcode
  "/usr/local/bin/openclaw",
  "/opt/homebrew/bin/openclaw",
];
let resolvedGatewayCli: string | null = null;
let resolvedGatewayCliPromise: Promise<string | null> | null = null;

function gatewayCliPathEnv(basePath = process.env.PATH || ""): string {
  const pathEntries = [
    path.dirname(process.execPath),
    path.join(os.homedir(), ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    ...String(basePath || "").split(":"),
  ].map((entry) => entry.trim()).filter(Boolean);
  return Array.from(new Set(pathEntries)).join(":");
}

function gatewayCliChildEnv(token?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: gatewayCliPathEnv(),
    NODE_NO_WARNINGS: "1",
    ...(token ? { [gatewayTokenEnvName]: token } : {}),
  };
}

function readConfiguredGatewayCli(): string | null {
  const fromEnv = String(process.env.OPENCLAW_GATEWAY_CLI || "").trim();
  if (fromEnv) return fromEnv;
  return null;
}

function findExecutableInPath(name: string): boolean {
  // Sprint2.2: 绝对路径直接 stat
  if (name.startsWith("/") || name.startsWith("./") || name.startsWith("../")) {
    try {
      const stat = fs.statSync(name);
      return stat.isFile() && (stat.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }
  const pathEnv = gatewayCliPathEnv();
  if (!pathEnv) return false;
  const separator = pathEnv.includes(";") ? ";" : ":";
  for (const dir of pathEnv.split(separator)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) return true;
    } catch {
      // Continue probing the PATH.
    }
  }
  return false;
}

async function probeGatewayCli(): Promise<string | null> {
  const configured = readConfiguredGatewayCli();
  if (configured) {
    try {
      const stat = fs.statSync(configured);
      if (stat.isFile()) return configured;
    } catch {
      // Not a path; treat it as a PATH-resolvable name.
    }
    if (findExecutableInPath(configured)) return configured;
    return configured;
  }
  for (const candidate of GATEWAY_CLI_CANDIDATES) {
    if (findExecutableInPath(candidate)) return candidate;
  }
  return null;
}

async function resolveGatewayCli(): Promise<string | null> {
  if (resolvedGatewayCli) return resolvedGatewayCli;
  if (!resolvedGatewayCliPromise) {
    resolvedGatewayCliPromise = probeGatewayCli().then((value) => {
      resolvedGatewayCli = value;
      return value;
    });
  }
  return resolvedGatewayCliPromise;
}

function gatewayCliLabel(): string {
  return resolvedGatewayCli || readConfiguredGatewayCli() || GATEWAY_CLI_CANDIDATES[0];
}

export type GatewayControlAction = "status" | "install" | "start" | "stop" | "restart";

export type GatewayControlResult<T = unknown> = {
  ok: boolean;
  status: "connected" | "unavailable";
  action: GatewayControlAction;
  data?: T;
  stdout?: string;
  stderr?: string;
  durationMs: number;
  error?: string;
};

export type GatewayResult<T = unknown> = {
  ok: boolean;
  status: "connected" | "unavailable";
  data?: T;
  error?: string;
};

type GatewayCallOptions = {
  expectFinal?: boolean;
  skipToken?: boolean;
  serializeCli?: boolean;
  signal?: AbortSignal;
};

type GatewayCommandOptions = {
  timeoutMs?: number;
  serializeCli?: boolean;
  signal?: AbortSignal;
};

export async function gatewayCall<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000, options: GatewayCallOptions = {}): Promise<GatewayResult<T>> {
  // Sprint4.1 — opt-in direct WebSocket path. Bypasses the CLI child process to
  // skip the device-auth identity file write that the Codex sandbox forbids.
  if (directWebSocketEnabled() && !options.skipToken) {
    const direct = await gatewayCallDirectWebSocket<T>(method, params, timeoutMs, { expectFinal: options.expectFinal, signal: options.signal });
    if (direct.ok) return { ok: true, status: "connected", data: direct.data as T };
    return {
      ok: false,
      status: "unavailable",
      error: sanitizeDirectGatewayError(direct.errorCode, direct.error || ""),
    };
  }
  const args = ["gateway", "call", method, "--params", JSON.stringify(params), "--timeout", String(timeoutMs), "--json"];
  if (options.expectFinal) args.push("--expect-final");
  const token = options.skipToken ? undefined : await resolveGatewayToken();
  try {
    const { stdout } = await runGatewayCli(args, timeoutMs, token, options.skipToken, options.serializeCli ?? !options.expectFinal, options.signal);
    const parsed = parseGatewayJson(stdout);
    return { ok: true, status: "connected", data: parsed as T };
  } catch (err) {
    const message = gatewayErrorMessage(err, timeoutMs, Boolean(options.expectFinal));
    if (token && !process.env.OPENCLAW_GATEWAY_TOKEN && shouldRetryWithoutLaunchAgentToken(message)) {
      try {
        const { stdout } = await runGatewayCli(args, timeoutMs, undefined, true, options.serializeCli ?? !options.expectFinal, options.signal);
        const parsed = parseGatewayJson(stdout);
        return { ok: true, status: "connected", data: parsed as T };
      } catch (retryErr) {
        const retryMessage = gatewayErrorMessage(retryErr, timeoutMs, Boolean(options.expectFinal));
        // Sprint4.1 — fall back to direct WebSocket on device-auth / protocol-mismatch.
        return await fallbackOrError<T>(method, params, timeoutMs, options, retryMessage);
      }
    }
    // Sprint4.1 — fall back to direct WebSocket on device-auth / protocol-mismatch.
    return await fallbackOrError<T>(method, params, timeoutMs, options, message);
  }
}

async function fallbackOrError<T>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  options: GatewayCallOptions,
  cliMessage: string,
): Promise<GatewayResult<T>> {
  if (shouldFallbackToDirectWebSocket(cliMessage) && !options.skipToken) {
    const direct = await gatewayCallDirectWebSocket<T>(method, params, timeoutMs, { expectFinal: options.expectFinal, signal: options.signal });
    if (direct.ok) return { ok: true, status: "connected", data: direct.data as T };
    const reason = directFallbackReason(cliMessage);
    const error = sanitizeDirectGatewayError(direct.errorCode, direct.error || "", reason || undefined);
    return { ok: false, status: "unavailable", error };
  }
  return { ok: false, status: "unavailable", error: sanitizeGatewayError(cliMessage) };
}

export async function gatewayControl<T = unknown>(action: GatewayControlAction, options: GatewayCommandOptions = {}): Promise<GatewayControlResult<T>> {
  const cleanAction = action === "status" || action === "install" || action === "start" || action === "stop" || action === "restart" ? action : "status";
  const args = ["gateway", cleanAction];
  const timeoutMs = clampTimeout(options.timeoutMs, 30_000);
  const startedAt = Date.now();
  try {
    const command = await runGatewayCommandCli(args, timeoutMs, undefined, true, options.serializeCli ?? true, options.signal);
    const stdout = String(command.stdout || "").trim();
    const stderr = String(command.stderr || "").trim();
    const parsed = parseGatewayStatusOutput(stdout, stderr);
    const payload = { ...parsed, command: { action: cleanAction, durationMs: Date.now() - startedAt, timeoutMs } };
    return {
      ok: true,
      status: parsed.ok ? "connected" : "unavailable",
      action: cleanAction,
      data: payload as T,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const rawError = gatewayErrorMessage(err, timeoutMs, false);
    return {
      ok: false,
      status: "unavailable",
      action: cleanAction,
      durationMs: Date.now() - startedAt,
      error: sanitizeGatewayError(rawError),
      stdout: String((err as { stdout?: string }).stdout || ""),
      stderr: String((err as { stderr?: string }).stderr || ""),
    };
  }
}

async function runGatewayCli(args: string[], timeoutMs: number, token?: string, skipToken = false, serializeCli = true, signal?: AbortSignal) {
  const env = gatewayCliChildEnv(token);
  if (skipToken) delete env[gatewayTokenEnvName];
  throwIfAborted(signal);
  await resolveGatewayCli();
  const run = () => execGatewayCli(args, timeoutMs + 1500, env, signal);
  return serializeCli ? withGatewayCliLock(run, timeoutMs, signal) : run();
}

function execGatewayCli(args: string[], timeoutMs: number, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;
    let watchdog: NodeJS.Timeout | null = null;
    let childGoneTimer: NodeJS.Timeout | null = null;
    const cli = resolvedGatewayCli || "openclaw";
    const child = execFile(cli, args, {
      maxBuffer: 8 * 1024 * 1024,
      env,
    } as never, (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
      if (settled) return;
      settled = true;
      cleanup();
      const stdoutText = String(stdout || "");
      const stderrText = String(stderr || "");
      if (err) {
        reject(Object.assign(err, { stdout: stdoutText, stderr: stderrText }));
        return;
      }
      resolve({ stdout: stdoutText, stderr: stderrText });
    });

    const timeout = setTimeout(() => {
      const err = new Error(`OpenClaw Gateway CLI timed out after ${Math.max(0, timeoutMs - 1500)}ms`);
      Object.assign(err, { code: "ETIMEDOUT", killed: true });
      rejectAndKill(err);
    }, timeoutMs);

    const abort = () => {
      const err = new Error("Workbench request aborted while waiting for Gateway.");
      Object.assign(err, { code: "ABORT_ERR", killed: true });
      rejectAndKill(err);
    };
    signal?.addEventListener("abort", abort, { once: true });

    // 多重兜底：子进程被外部杀（LLM hang / 外部 kill）时，Node.js execFile callback 不一定触发。
    // exit/close/stdio close 可能早于 execFile callback，必须给 callback 一个短暂宽限期。
    const settleOnChildGone = (source: string, payload?: { code?: number | null; signal?: NodeJS.Signals | null }) => {
      if (settled) return;
      settled = true;
      cleanup();
      const code = payload?.code ?? null;
      const sig = payload?.signal ?? null;
      const err = new Error(`OpenClaw Gateway CLI child ${source} (code=${code} signal=${sig || "none"}) without final callback`);
      Object.assign(err, { code: "ECHILDEVENT", killed: true, signal: sig || undefined, childExitCode: code, eventSource: source });
      reject(err);
    };
    const scheduleSettleOnChildGone = (source: string, payload?: { code?: number | null; signal?: NodeJS.Signals | null }) => {
      if (settled || childGoneTimer) return;
      childGoneTimer = setTimeout(() => settleOnChildGone(source, payload), 1000);
    };
    child.once("exit", (code, exitSignal) => scheduleSettleOnChildGone("exit", { code, signal: exitSignal }));
    child.once("close", (code, closeSignal) => scheduleSettleOnChildGone("close", { code, signal: closeSignal }));
    child.once("error", (childErr) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(Object.assign(childErr, { code: "ECHILDERROR" }));
    });
    // stdio stream close 兜底
    child.stdout?.once("close", () => scheduleSettleOnChildGone("stdout-close"));
    child.stderr?.once("close", () => scheduleSettleOnChildGone("stderr-close"));
    // 看门狗：每 2s 检查 child 是否还活。3 个信号：
    //   1) Node.js child.exitCode !== null → 内部已标记 exit
    //   2) process.kill(pid, 0) ESRCH → OS 进程消失
    //   3) child.stdout.readableEnded && child.stderr.readableEnded → stdio EOF（child 死了但 Node.js 不知）
    //   4) 进程是 zombie（defunct）但未 reap → child.exitCode null + process.kill(pid, 0) 0 + stream 未 end
    //      用 'ps -p pid -o stat=' 兜底探测
    watchdog = setInterval(() => {
      if (settled) { if (watchdog) clearInterval(watchdog); return; }
      if (child.exitCode !== null || child.signalCode !== null) {
        scheduleSettleOnChildGone("watchdog-exit", { code: child.exitCode, signal: child.signalCode });
        return;
      }
      if (child.stdout?.readableEnded && child.stderr?.readableEnded) {
        scheduleSettleOnChildGone("watchdog-stdio-eof", { code: null, signal: "SIGKILL" });
        return;
      }
      // OS 进程检测
      try {
        process.kill(child.pid!, 0);
      } catch (e) {
        const errCode = (e as NodeJS.ErrnoException).code;
        if (errCode === "ESRCH") {
          scheduleSettleOnChildGone("watchdog-esrch", { code: null, signal: "SIGKILL" });
        }
        return;
      }
      // zombie 检测：OS 进程存在但可能是 defunct
      try {
        const { execSync } = require("node:child_process") as typeof import("node:child_process");
        const stat = execSync(`ps -p ${child.pid} -o stat= 2>/dev/null`, { encoding: "utf-8", timeout: 1000 }).trim();
        if (/^Z/.test(stat)) {
          // zombie detected — Node.js execFile won't reap, force settle
          scheduleSettleOnChildGone("watchdog-zombie", { code: null, signal: "SIGKILL" });
        }
      } catch {}
    }, 2000);

    function cleanup(clearKillTimer = true) {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (clearKillTimer && killTimer) clearTimeout(killTimer);
      if (childGoneTimer) { clearTimeout(childGoneTimer); childGoneTimer = null; }
      if (watchdog) { clearInterval(watchdog); watchdog = null; }
    }

    function rejectAndKill(err: Error) {
      if (settled) return;
      settled = true;
      killGatewayChild(child.pid, "SIGTERM");
      killTimer = setTimeout(() => killGatewayChild(child.pid, "SIGKILL"), 1200);
      cleanup(false);
      reject(err);
    }
  });
}

async function runGatewayCommandCli(args: string[], timeoutMs: number, token?: string, skipToken = false, serializeCli = true, signal?: AbortSignal) {
  const env = gatewayCliChildEnv(token);
  if (skipToken) delete env[gatewayTokenEnvName];
  throwIfAborted(signal);
  await resolveGatewayCli();
  const run = () => execGatewayCli(args, timeoutMs + 1500, env, signal);
  return serializeCli ? withGatewayCliLock(run, timeoutMs, signal) : run();
}

function killGatewayChild(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // Fall back to the direct child when the process group is already gone.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Best effort.
  }
}

async function withGatewayCliLock<T>(task: () => Promise<T>, timeoutMs: number, signal?: AbortSignal) {
  const lockPath = path.join(os.tmpdir(), "openclaw-workbench-gateway-cli.lock");
  // v3.4 修复：锁 stale 阈值改成固定值，不跟 timeoutMs 联动。
  // 旧逻辑 `staleMs = max(timeoutMs + 15_000, 180_000)` 在 timeoutMs=540s 时变 555s，stale 几乎不触发，残留锁要等 9+ 分钟才清。
  // 固定 90 秒 stale 阈值：m3 m27 path 实际 6-12 分钟，stale 90s < 一次完整跑，但远小于"server 崩溃后下次启动间隔"。
  const configuredStaleMs = Number(process.env.OPENCLAW_WORKBENCH_GATEWAY_LOCK_STALE_MS || 90_000);
  const staleMs = Number.isFinite(configuredStaleMs) && configuredStaleMs > 0 ? configuredStaleMs : 90_000;
  const deadline = Date.now() + Math.max(timeoutMs + 5_000, 10_000);
  let fd: number | null = null;
  let staleUnlinkAttempts = 0;
  const MAX_STALE_UNLINK_ATTEMPTS = 1; // 只主动 unlink 一次，避免多 server 启动时互清
  while (Date.now() <= deadline) {
    throwIfAborted(signal);
    try {
      fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (staleUnlinkAttempts < MAX_STALE_UNLINK_ATTEMPTS) {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > staleMs) {
            fs.unlinkSync(lockPath);
            staleUnlinkAttempts += 1;
            continue; // 立即重试拿锁
          }
        } catch {
          // Another process may have released the lock between stat and unlink.
        }
      }
      await sleep(250, signal);
    }
  }
  if (fd === null) throw new Error(`Gateway CLI queue timeout after ${timeoutMs}ms`);
  try {
    return await task();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // Best effort.
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Best effort.
    }
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw new Error("Workbench request aborted while waiting for Gateway.");
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Workbench request aborted while waiting for Gateway."));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Workbench request aborted while waiting for Gateway."));
    }, { once: true });
  });
}

function gatewayErrorMessage(err: unknown, timeoutMs: number, expectFinal: boolean) {
  const maybe = err as { code?: string; killed?: boolean; message?: string; name?: string; signal?: string; stderr?: string; stdout?: string };
  if (maybe.name === "AbortError" || maybe.code === "ABORT_ERR" || /aborted/i.test(String(maybe.message || ""))) {
    return "Workbench request aborted while waiting for Gateway.";
  }
  if (maybe.code === "ETIMEDOUT" || maybe.killed || maybe.signal === "SIGTERM") {
    return expectFinal
      ? `OpenClaw Gateway CLI timed out after ${timeoutMs}ms while waiting for final agent output.`
      : `OpenClaw Gateway CLI timed out after ${timeoutMs}ms while waiting for RPC response.`;
  }
  return maybe.stderr || maybe.stdout || maybe.message || String(err);
}

function shouldRetryWithoutLaunchAgentToken(message: string) {
  return /gateway closed \(1006 abnormal closure|gateway closed \(1012\): service restart/i.test(message)
    || /unauthorized|forbidden|invalid token/i.test(message)
    || /device-auth(?:\.json|-store)|EPERM:[\s\S]*\.openclaw[\s\S]*device-auth/i.test(message);
}

function sanitizeGatewayError(input: string) {
  const withoutWarnings = stripNodeWarnings(input);
  const cliTimeout = withoutWarnings.match(/OpenClaw Gateway CLI timed out after \d+ms[^\n]*/i);
  if (cliTimeout) return cliTimeout[0];
  const timeout = withoutWarnings.match(/gateway timeout after \d+ms/i);
  if (timeout) return timeout[0];

  if (/Service not installed|Could not find service|not loaded|LaunchAgent.*not loaded/i.test(withoutWarnings)) {
    return `Gateway service not installed or not loaded. Run: ${gatewayCliLabel()} gateway install, then ${gatewayCliLabel()} gateway start.`;
  }

  if (/device-auth(?:\.json|-store)|EPERM:[\s\S]*\.openclaw[\s\S]*device-auth/i.test(withoutWarnings)) {
    return "OpenClaw Gateway token auth store is not writable from Workbench.";
  }

  if (/Could not find service "com\.clawdbot\.gateway"|launchctl bootout|launchctl bootstrap/i.test(withoutWarnings)) {
    return `Gateway LaunchAgent state abnormal. Check \`${gatewayCliLabel()} gateway status\` and rerun install/start in your terminal with user permissions.`;
  }

  if (/listen EPERM|operation not permitted.*18789/i.test(withoutWarnings)) {
    return "Gateway failed to bind its socket (port permission/environment). This is usually a local environment/network permission issue.";
  }

  const gatewayFailure = withoutWarnings.match(/Gateway call failed:[\s\S]*?(?:\n|$)/i);
  if (gatewayFailure) return gatewayFailure[0].trim().slice(0, 500);
  const cliName = gatewayCliLabel().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const compact = withoutWarnings
    .replace(/[a-f0-9]{32,}/gi, "[redacted]")
    .replace(/token=\S+/gi, "token=[redacted]")
    .replace(/--params\s+\{[\s\S]*?\}\s+--timeout/gi, "--params [redacted] --timeout")
    .replace(new RegExp(`Command failed:\\s*${cliName} gateway call[^\\n]*`, "gi"), "OpenClaw Gateway RPC failed")
    .replace(new RegExp(`Command failed:\\s*${cliName}\\s+gateway\\s+call[\\s\\S]*`, "gi"), "OpenClaw Gateway RPC failed")
    .replace(new RegExp(`${cliName}\\s+gateway\\s+call\\s+[^\\n\\r]*`, "gi"), "OpenClaw Gateway RPC failed")
    .replace(/Command failed:\s*openclaw-cn gateway call[^\n]*/gi, "OpenClaw Gateway RPC failed")
    .replace(/Command failed:\s*openclaw-cn\s+gateway\s+call[\s\S]*/gi, "OpenClaw Gateway RPC failed")
    .replace(/openclaw-cn\s+gateway\s+call\s+[^\n\r]*/gi, "OpenClaw Gateway RPC failed")
    .trim();
  if (!compact) return "OpenClaw Gateway RPC failed";
  const validation = compact.match(/invalid [^:]+ params:[\s\S]*/i);
  if (validation) return validation[0].slice(0, 500);
  return compact.slice(0, 500);
}

function sanitizeDirectGatewayError(code: string | undefined, fallback: string, reasonHint?: "device_auth_unwritable" | "protocol_mismatch"): string {
  // Keep the public error short and category-specific. Never include the token
  // or any secret. The `code` and `reason` is for log correlation only.
  switch (code) {
    case "ws_unavailable":
      return "OpenClaw Gateway direct WebSocket fallback unavailable (runtime missing global WebSocket).";
    case "ws_connection_refused":
      return "OpenClaw Gateway WebSocket port unreachable. Verify the Gateway service is running on the expected port.";
    case "ws_timeout":
      return fallback && /hello/i.test(fallback)
        ? "OpenClaw Gateway direct WebSocket hello timed out. Service may be loading."
        : "OpenClaw Gateway direct WebSocket response timed out. Try raising the timeout or use the CLI path.";
    case "ws_unauthorized":
      return "OpenClaw Gateway token mismatch. Re-run install/start in your terminal so com.clawdbot.gateway.plist carries a fresh token.";
    case "ws_protocol_mismatch":
      return "OpenClaw Gateway protocol version out of range. Upgrade openclaw-cn / workbench to a matching version.";
    case "ws_hello_failed":
      return fallback ? `OpenClaw Gateway direct WebSocket hello failed: ${fallback}` : "OpenClaw Gateway direct WebSocket hello failed.";
    case "ws_request_failed":
      return fallback ? `OpenClaw Gateway direct WebSocket request failed: ${fallback}` : "OpenClaw Gateway direct WebSocket request failed.";
    case "ws_aborted":
      return "Workbench request aborted while waiting for direct Gateway WebSocket response.";
    default:
      if (reasonHint === "device_auth_unwritable") {
        return "OpenClaw Gateway token auth store is not writable from Workbench. Direct WebSocket fallback also unavailable.";
      }
      if (reasonHint === "protocol_mismatch") {
        return "OpenClaw Gateway CLI reported a protocol mismatch and the direct WebSocket fallback also failed.";
      }
      return fallback ? `OpenClaw Gateway RPC failed (direct): ${fallback}` : "OpenClaw Gateway RPC failed (direct).";
  }
}

function parseGatewayStatusOutput(stdout: string, stderr: string) {
  const text = `${stdout || ""}\n${stderr || ""}`.toLowerCase();
  const okPatterns = [/connected/, /running/, /service is running/, /service status.*running/, /active:/, /all good/, /ok/];
  const failPatterns = [/not installed/, /not loaded/, /could not find service/, /unknown/, /failed/, /error:/, /service not/];

  if (failPatterns.some((pattern) => pattern.test(text))) {
    return {
      ok: false,
      raw: { stdout, stderr },
      reasons: failPatterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source),
    };
  }
  return {
    ok: okPatterns.some((pattern) => pattern.test(text)),
    raw: { stdout, stderr },
    reasons: okPatterns.some((pattern) => pattern.test(text)) ? ["status_detected"] : ["status_unknown"],
  };
}

function clampTimeout(input: number | undefined, fallbackMs: number) {
  if (!Number.isFinite(input || NaN)) return fallbackMs;
  const value = Number(input);
  return Math.max(1000, Math.min(180_000, value));
}

function parseGatewayJson(stdout: string) {
  const clean = stripNodeWarnings(stdout).trim();
  if (!clean) return {};
  try {
    return JSON.parse(clean);
  } catch {
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(clean.slice(first, last + 1));
    throw new Error("OpenClaw Gateway returned non-JSON output");
  }
}

function stripNodeWarnings(input: string) {
  return String(input || "")
    .split(/\r?\n/)
    .filter((line) => !/^\(node:\d+\)\s+(?:\[[^\]]+\]\s+)?(?:DeprecationWarning|ExperimentalWarning|Warning):/i.test(line.trim()))
    .filter((line) => !/^Use `node --trace-[^`]+` to show where the warning was created\)?\.?$/i.test(line.trim()))
    .join("\n");
}

async function resolveGatewayToken() {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) return process.env.OPENCLAW_GATEWAY_TOKEN;
  gatewayTokenPromise ??= readGatewayTokenFromLaunchAgent();
  return gatewayTokenPromise;
}

async function readGatewayTokenFromLaunchAgent() {
  const plist = path.join(os.homedir(), "Library/LaunchAgents/com.clawdbot.gateway.plist");
  if (!fs.existsSync(plist)) return undefined;
  try {
    const { stdout } = await execFileAsync("plutil", ["-extract", "EnvironmentVariables.OPENCLAW_GATEWAY_TOKEN", "raw", plist], {
      timeout: 1500,
      maxBuffer: 4096,
    });
    const token = stdout.trim();
    return token.length >= 20 ? token : undefined;
  } catch {
    return undefined;
  }
}

export async function gatewaySummary(timeoutMs = 3500) {
  const readOnly = { serializeCli: false };
  const [health, agents, sessions, cron] = await Promise.all([
    gatewayCall("health", {}, timeoutMs, readOnly),
    gatewayCall("agents.list", {}, timeoutMs, readOnly),
    gatewayCall("sessions.list", { limit: 30 }, timeoutMs, readOnly),
    gatewayCall("cron.list", { includeDisabled: true }, timeoutMs, readOnly),
  ]);
  return { health, agents, sessions, cron };
}
