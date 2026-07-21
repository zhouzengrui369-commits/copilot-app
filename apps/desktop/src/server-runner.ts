/**
 * Server runner: spawns the OpenClaw Workbench server (Fastify) as a child
 * process and waits until it accepts HTTP connections.
 *
 * Why a child process: the server's `src/index.ts` is a single-file Fastify
 * entry that auto-listen at the bottom of the module — there is no exported
 * `start()` function. Refactoring it to be importable is invasive (>19k LOC).
 * Spawning keeps the desktop shell decoupled from server internals.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

export type ServerMode = "dev" | "packaged";

export interface ServerRunnerOptions {
  mode: ServerMode;
  /** Absolute path to the server entry (e.g. dist/index.js). */
  entry: string;
  /** Absolute path to the web dist that the server should serve. */
  webDistDir: string;
  /** Absolute path to the server's data dir (sqlite, backups). */
  dataDir: string;
  /** Port to listen on. */
  port: number;
  /** Optional host override. */
  host?: string;
  /** Extra env vars to inject. */
  env?: Record<string, string>;
}

export interface ServerRunnerEvents {
  ready: [];
  exit: [code: number | null, signal: NodeJS.Signals | null];
  log: [line: string];
  error: [err: Error];
}

const here = path.dirname(__filename);
const DEFAULT_CLOUDBASE_BROKER_URL = "https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay";

function firstExistingFile(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Ignore unreadable candidates and keep probing deterministic defaults.
    }
  }
  return undefined;
}

function defaultMobileTranscriptionEnv(nodeBin: string, serverDir: string): Record<string, string> {
  if (
    process.env.OPENCLAW_MOBILE_TRANSCRIPTION_PROVIDER ||
    process.env.OPENCLAW_MOBILE_TRANSCRIPTION_COMMAND ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENCLAW_OPENAI_API_KEY
  ) {
    return {};
  }
  const whisperBin = firstExistingFile([
    process.env.OPENCLAW_WHISPER_BIN,
    "/opt/homebrew/bin/whisper",
    "/usr/local/bin/whisper",
  ]);
  const commandScript = firstExistingFile([
    path.join(serverDir, "mobileTranscribeWhisperCommand.js"),
    path.resolve(here, "..", "..", "server", "dist", "mobileTranscribeWhisperCommand.js"),
    path.resolve(here, "..", "..", "..", "server", "dist", "mobileTranscribeWhisperCommand.js"),
  ]);
  if (!whisperBin || !commandScript) return {};
  // R7 (2026-07-03): packaged-app default is `tiny` because `base` repeatedly
  // trips the 180s timeout on 30-60s mobile recordings on the Mate60 test
  // device. The whisper command helper still reads OPENCLAW_MOBILE_WHISPER_MODEL
  // first, so power users who explicitly export `OPENCLAW_MOBILE_WHISPER_MODEL`
  // in their shell rc still get the better model.
  return {
    OPENCLAW_MOBILE_TRANSCRIPTION_PROVIDER: "command",
    OPENCLAW_MOBILE_TRANSCRIPTION_COMMAND: nodeBin,
    OPENCLAW_MOBILE_TRANSCRIPTION_COMMAND_ARGS: JSON.stringify([commandScript]),
    OPENCLAW_MOBILE_TRANSCRIPTION_MODEL: process.env.OPENCLAW_MOBILE_WHISPER_MODEL || "tiny",
    OPENCLAW_MOBILE_TRANSCRIPTION_TIMEOUT_MS: "180000",
    OPENCLAW_WHISPER_BIN: whisperBin,
  };
}

function appendStartupLog(line: string): void {
  try {
    const logPath = path.join(app.getPath("userData"), "startup.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Startup diagnostics must never become another startup blocker.
  }
}

/** In dev, walk up to the workbench repo root (apps/desktop/src -> repo root). */
export function resolveDevEntry(): string {
  // src/server-runner.ts -> apps/desktop/src -> apps/desktop -> apps -> repo root
  return path.resolve(here, "..", "..", "..", "server", "dist", "index.js");
}

export function resolveDevWebDist(): string {
  return path.resolve(here, "..", "..", "..", "web", "dist");
}

export function resolveDevDataDir(): string {
  return path.join(os.homedir(), "openclaw_data", "copilot", "data");
}

export class ServerRunner extends EventEmitter<ServerRunnerEvents> {
  private child: ChildProcess | null = null;
  private logBuffer: string[] = [];
  private ready = false;
  private stopping = false;

  constructor(private readonly options: ServerRunnerOptions) {
    super();
  }

  start(): void {
    if (this.child) return;

    // Pick the binary that will run the server script.
    //
    // In dev, process.execPath is the electron CLI shim — itself a node
    // script that supports `--experimental-sqlite` and forwards to the
    // real Electron binary as Node when given a script path. That's
    // what we want.
    //
    // In a packaged build, process.execPath is the raw Electron binary
    // (`Contents/MacOS/<productName>`). It does NOT understand Node
    // flags like `--experimental-sqlite`; even with
    // `ELECTRON_RUN_AS_NODE=1` it rejects unknown flags before acting
    // as Node, so the server never starts.
    //
    // We can't bundle a node binary (it would inflate the .app by
    // ~50 MB per arch and require version-locking against Electron's
    // Node ABI), so for the packaged build we delegate to a system
    // node. OpenClaw Workbench is a developer tool, and a recent
    // Node (>=22.5 for stable `node:sqlite`) is a hard prerequisite
    // for the workbench server anyway, so requiring it on PATH is
    // consistent with the rest of the workbench stack. If we ever
    // ship to non-technical users, the right move is to vendor a
    // specific node build into `resources/node/` and update
    // `nodeBinCandidates` below.
    const nodeBinCandidates = app.isPackaged
      ? [
          "/usr/local/bin/node",
          "/opt/homebrew/bin/node",
          path.join(process.resourcesPath, "resources", "node", "node"),
        ]
      : [process.execPath];

    const nodeBin = nodeBinCandidates.find((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });

    appendStartupLog(
      `[server-runner] start mode=${this.options.mode} port=${this.options.port} entry=${this.options.entry} web=${this.options.webDistDir} data=${this.options.dataDir}`,
    );
    appendStartupLog(`[server-runner] node candidates=${nodeBinCandidates.join(", ")} selected=${nodeBin ?? "none"}`);

    if (!nodeBin) {
      const err = new Error(
        `Could not find a Node.js binary to run the workbench server. Tried:\n` +
          nodeBinCandidates.map((p) => `  - ${p}`).join("\n") +
          `\nPlease install Node.js (>=22.5) — the workbench server uses built-in node:sqlite.`,
      );
      appendStartupLog(`[server-runner] error ${err.message}`);
      setImmediate(() => this.emit("error", err));
      return;
    }

    const mobileTranscriptionEnv = defaultMobileTranscriptionEnv(nodeBin, path.dirname(this.options.entry));
    if (mobileTranscriptionEnv.OPENCLAW_MOBILE_TRANSCRIPTION_PROVIDER) {
      appendStartupLog(
        `[server-runner] mobile transcription provider=command model=${mobileTranscriptionEnv.OPENCLAW_MOBILE_TRANSCRIPTION_MODEL} whisper=${mobileTranscriptionEnv.OPENCLAW_WHISPER_BIN}`,
      );
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENCLAW_WORKBENCH_PORT: String(this.options.port),
      OPENCLAW_WORKBENCH_HOST: this.options.host ?? "127.0.0.1",
      // The server's own config.ts computes DATA_DIR, SIDECAR_DIR, and
      // WEB_DIST_DIR from its in-tree location, which inside a packaged
      // .app bundle is `<.app>/Contents/` — paths that are read-only
      // after code signing and don't match the layout we ship. Redirect
      // all three to the desktop shell's resolved locations so the
      // server uses the right sqlite dir, sidecars, and web bundle.
      OPENCLAW_DATA_DIR: this.options.dataDir,
      OPENCLAW_SIDECAR_DIR: path.join(this.options.dataDir, "knowledge_sidecars"),
      OPENCLAW_WEB_DIST_DIR: this.options.webDistDir,
      OPENCLAW_CB_ENABLED: process.env.OPENCLAW_CB_ENABLED || "1",
      OPENCLAW_CB_BROKER_URL: process.env.OPENCLAW_CB_BROKER_URL || DEFAULT_CLOUDBASE_BROKER_URL,
      OPENCLAW_MOBILE_PUBLIC_URL: process.env.OPENCLAW_MOBILE_PUBLIC_URL || process.env.OPENCLAW_CB_BROKER_URL || DEFAULT_CLOUDBASE_BROKER_URL,
      OPENCLAW_FORWARDER_TOKEN: process.env.OPENCLAW_FORWARDER_TOKEN || randomBytes(32).toString("base64url"),
      ...mobileTranscriptionEnv,
      // When we fall back to the Electron binary (dev path uses the
      // electron CLI shim which sets this automatically), force it to act
      // as Node. No-op when nodeBin is already a real node binary.
      ELECTRON_RUN_AS_NODE: "1",
      ...(this.options.env ?? {}),
    };

    const args = ["--experimental-sqlite", this.options.entry];

    this.stopping = false;
    if (app.isPackaged) {
      terminateStalePackagedServer(this.options.port, this.options.entry);
    }
    appendStartupLog(`[server-runner] spawn ${nodeBin} ${args.join(" ")}`);
    this.child = spawn(nodeBin, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      // Detach the child from the parent's tty so the server doesn't keep
      // Electron's stdout open in the terminal.
      detached: false,
    });
    appendStartupLog(`[server-runner] spawned pid=${this.child.pid ?? "unknown"}`);

    this.child.stdout?.on("data", (chunk: Buffer) => this.consume(chunk.toString("utf8"), "out"));
    this.child.stderr?.on("data", (chunk: Buffer) => this.consume(chunk.toString("utf8"), "err"));

    this.child.on("error", (err) => {
      appendStartupLog(`[server-runner] spawn error ${err.stack || err.message}`);
      this.emit("error", err);
    });
    this.child.on("exit", (code, signal) => {
      this.ready = false;
      appendStartupLog(`[server-runner] exit code=${code ?? "null"} signal=${signal ?? "null"}`);
      this.emit("exit", code, signal);
      this.child = null;
      if (!this.stopping) {
        const tail = this.logBuffer.slice(-20).join("\n");
        this.emit(
          "error",
          new Error(
            `Workbench server exited before becoming ready (code=${code ?? "null"}, signal=${signal ?? "null"}).` +
              (tail ? `\nLast server output:\n${tail}` : ""),
          ),
        );
      }
    });

    // Workbench server cold-start can take 1-3+ minutes on this machine
    // (SQLite init, knowledge sidecar warm-up, cloudbase forwarder handshake,
    // goal scheduler restore). The previous 30s timeout fired while the server
    // was still mid-boot, leaving an orphan child on port 38888 and forcing a
    // fatal dialog in the .app shell. Match the same order of magnitude used
    // for OPENCLAW_MOBILE_TRANSCRIPTION_TIMEOUT_MS (180_000ms).
    this.waitForHttp(this.options.port, 180_000).then(
      () => {
        this.ready = true;
        this.emit("ready");
      },
      (err) => this.emit("error", err),
    );
  }

  async stop(timeoutMs = 5_000): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    this.stopping = true;
    appendStartupLog(`[server-runner] stop pid=${child.pid ?? "unknown"}`);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        finish();
      }, timeoutMs);
      child.once("exit", finish);
      try {
        child.kill("SIGTERM");
      } catch {
        finish();
      }
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Resolve once the server has either signalled `ready` (TCP port is
   * accepting connections) or thrown (port never came up). Used by
   * main.ts to gate BrowserWindow.loadURL so the renderer doesn't race
   * the server's listen() and crash with ERR_CONNECTION_REFUSED.
   */
  waitForReady(timeoutMs = 180_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onReady = () => {
        clearTimeout(timer);
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        clearTimeout(timer);
        cleanup();
        reject(err);
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error(`Server failed to become ready within ${timeoutMs}ms`));
      };
      const cleanup = () => {
        this.off("ready", onReady);
        this.off("error", onError);
      };
      this.once("ready", onReady);
      this.once("error", onError);
      const timer = setTimeout(onTimeout, timeoutMs);
    });
  }

  getBufferedLog(): string[] {
    return [...this.logBuffer];
  }

  private consume(text: string, _stream: "out" | "err"): void {
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      this.logBuffer.push(line);
      if (this.logBuffer.length > 500) this.logBuffer.shift();
      appendStartupLog(`[server:${_stream}] ${line}`);
      this.emit("log", line);
    }
  }

  private async waitForHttp(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    let lastErr: unknown = null;
    while (Date.now() - start < timeoutMs) {
      try {
        await probeHttp(port);
        return;
      } catch (err) {
        lastErr = err;
        await sleep(250);
      }
    }
    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`Server did not become ready on port ${port} within ${timeoutMs}ms: ${message}`);
  }
}

function terminateStalePackagedServer(port: number, currentEntry: string): void {
  const rows = findListeners(port);
  for (const row of rows) {
    if (row.pid === process.pid) continue;
    if (!isPackagedServerCommand(row.command, currentEntry)) continue;
    appendStartupLog(`[server-runner] stale server detected port=${port} pid=${row.pid} command=${row.command.slice(0, 240)}`);
    terminatePid(row.pid, "SIGTERM");
    if (!waitForProcessExit(row.pid, 2_500)) {
      terminatePid(row.pid, "SIGKILL");
      waitForProcessExit(row.pid, 1_500);
    }
  }
}

function findListeners(port: number): Array<{ pid: number; command: string }> {
  try {
    const raw = execFileSync("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "pc"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    });
    const rows: Array<{ pid: number; command: string }> = [];
    let currentPid = 0;
    let currentCommand = "";
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("p")) {
        if (currentPid && currentCommand) rows.push({ pid: currentPid, command: currentCommand });
        currentPid = Number(line.slice(1));
        currentCommand = "";
      } else if (line.startsWith("c")) {
        currentCommand = line.slice(1);
      }
    }
    if (currentPid && currentCommand) rows.push({ pid: currentPid, command: currentCommand });
    return rows.map((row) => ({ ...row, command: fullCommand(row.pid) || row.command }));
  } catch {
    return [];
  }
}

function fullCommand(pid: number): string {
  try {
    return execFileSync("/bin/ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
  } catch {
    return "";
  }
}

function isPackagedServerCommand(command: string, currentEntry: string): boolean {
  const normalized = command.replace(/\\/g, "/");
  const current = currentEntry.replace(/\\/g, "/");
  return normalized.includes("resources/server/index.js")
    && normalized.includes("njx-copilot.app")
    && (normalized.includes(current) || normalized.includes("/openclaw/copilot/") || normalized.includes("/Applications/"));
}

function terminatePid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
    appendStartupLog(`[server-runner] sent ${signal} to stale server pid=${pid}`);
  } catch (err) {
    appendStartupLog(`[server-runner] failed ${signal} stale server pid=${pid}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function waitForProcessExit(pid: number, timeoutMs: number): boolean {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function probeHttp(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/auth/me",
        method: "GET",
        timeout: 5000,
      },
      (res) => {
        res.resume();
        // Any HTTP response means the port is open and the server is up.
        if (res.statusCode && res.statusCode < 600) resolve();
        else reject(new Error(`HTTP ${res.statusCode}`));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("probe timeout"));
    });
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
