/**
 * njx-copilot main process.
 *
 * Boots the OpenClaw Workbench server (Fastify, via ServerRunner) and opens
 * a BrowserWindow that loads the server's own static-rendered web build.
 * This keeps the desktop shell thin and reuses 100% of the web/server code.
 *
 * Identity contract:
 *   - app name (Dock / Cmd+Tab / Launchpad) = "njx-copilot"
 *   - product / window title                = "OpenClaw Workbench"
 *   - bundle id                             = "ai.njx.copilot"
 */
import { app, BrowserWindow, Menu, MenuItemConstructorOptions, shell, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { ServerMode } from "./server-runner.js";
import type { AuthEvent } from "./auth-manager.js";

type WorkbenchRuntimeEnv = "dev" | "staging" | "prod";

function normalizeRuntimeEnv(value: string | undefined): WorkbenchRuntimeEnv | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "dev" || normalized === "staging" || normalized === "prod") return normalized;
  return null;
}

function inferRuntimeEnv(): WorkbenchRuntimeEnv {
  const explicit = normalizeRuntimeEnv(process.env.OPENCLAW_WORKBENCH_ENV);
  if (explicit) return explicit;
  const launchMarker = [
    process.execPath,
    process.resourcesPath,
    process.argv.join(" "),
    process.env.NJX_COPILOT_APP_NAME,
    process.env.npm_package_productName,
  ].filter(Boolean).join(" ");
  if (/njx-copilot-dev|openclaw[-_\s]*workbench[-_\s]*dev/i.test(launchMarker)) return "dev";
  if (/njx-copilot-staging|openclaw[-_\s]*workbench[-_\s]*staging/i.test(launchMarker)) return "staging";
  return "prod";
}

const RUNTIME_ENV = inferRuntimeEnv();
const RUNTIME_ENV_LABEL = RUNTIME_ENV === "prod" ? "" : RUNTIME_ENV.toUpperCase();
const APP_NAME = process.env.NJX_COPILOT_APP_NAME || (RUNTIME_ENV === "prod" ? "njx-copilot" : `njx-copilot-${RUNTIME_ENV}`);
const PRODUCT_NAME = process.env.NJX_COPILOT_PRODUCT_NAME || (RUNTIME_ENV === "prod" ? "OpenClaw Workbench" : `OpenClaw Workbench ${RUNTIME_ENV_LABEL}`);
const APP_USER_MODEL_ID = RUNTIME_ENV === "prod" ? "ai.njx.copilot" : `ai.njx.copilot.${RUNTIME_ENV}`;
const DEFAULT_PORT = RUNTIME_ENV === "dev" ? 38889 : RUNTIME_ENV === "staging" ? 38890 : 38888;
const DEV_VITE_URL = process.env.NJX_COPILOT_VITE_URL ?? "http://127.0.0.1:38889";
const CANONICAL_WORKSPACE_DIR = path.join(os.homedir(), "openclaw_data");
const CANONICAL_DATA_DIR = path.join(CANONICAL_WORKSPACE_DIR, "copilot", "data");
const LEGACY_DATA_DIR = path.join(CANONICAL_WORKSPACE_DIR, "openclaw_workbench", "data");
const ENV_RUNTIME_ROOT = process.env.OPENCLAW_ENV_RUNTIME_ROOT || path.join(os.homedir(), "openclaw", "copilot", "data", "env");

if (RUNTIME_ENV !== "prod") {
  try {
    app.setPath("userData", path.join(os.homedir(), "Library", "Application Support", APP_NAME));
  } catch {
    // Keep startup resilient; the fallback logger below will still record errors.
  }
}

function isolatedRuntimePath(kind: "data" | "workspace"): string {
  return path.join(ENV_RUNTIME_ROOT, RUNTIME_ENV, kind);
}

function appendMainStartupLog(line: string): void {
  try {
    const fallbackLogPath = path.join(os.homedir(), "Library", "Application Support", APP_NAME, "startup.log");
    let logPath = fallbackLogPath;
    try {
      logPath = path.join(app.getPath("userData"), "startup.log");
    } catch {
      // app.getPath can be unavailable very early in Electron bootstrap.
    }
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Startup diagnostics must never become a startup blocker.
  }
}

appendMainStartupLog(`[main] module-imported pid=${process.pid} exec=${process.execPath}`);

const APP_VERSION_LABEL = (() => {
  try {
    return app.getVersion();
  } catch {
    return "0.1.0";
  }
})();

const SPLASH_HTML = `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8" />
<style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;padding:0;height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  body{background:linear-gradient(135deg,#0F766E 0%,#0D5C56 100%);color:#fff;display:flex;align-items:center;justify-content:center}
  .wrap{display:flex;flex-direction:column;align-items:center;gap:28px;animation:splash-in 380ms cubic-bezier(0.16,1,0.3,1) both}
  .mark{width:88px;height:88px;border-radius:22px;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.22);display:flex;align-items:center;justify-content:center;font-size:46px;font-weight:900;letter-spacing:-1px;backdrop-filter:blur(20px);box-shadow:0 16px 48px rgba(0,0,0,0.24),inset 0 1px 0 rgba(255,255,255,0.18)}
  .name{font-size:22px;font-weight:800;letter-spacing:-0.3px;opacity:0.96}
  .name small{display:block;font-size:12px;font-weight:500;opacity:0.72;letter-spacing:1.6px;text-transform:uppercase;margin-top:6px}
  .dots{display:flex;gap:8px}
  .dots span{width:7px;height:7px;border-radius:99px;background:rgba(255,255,255,0.85);animation:dot 1.4s ease-in-out infinite}
  .dots span:nth-child(2){animation-delay:0.2s}
  .dots span:nth-child(3){animation-delay:0.4s}
  .status{font-size:12px;opacity:0.74;letter-spacing:0.4px;font-weight:500;min-width:160px;text-align:center}
  @keyframes splash-in{from{opacity:0;transform:translateY(8px) scale(0.98)}to{opacity:1;transform:none}}
  @keyframes dot{0%,80%,100%{opacity:0.25;transform:scale(0.7)}40%{opacity:1;transform:scale(1)}}
</style>
</head>
<body>
  <div class="wrap">
    <div class="mark">爪</div>
    <div class="name">OpenClaw Workbench<small>${APP_NAME} · v${APP_VERSION_LABEL}</small></div>
    <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="status" id="status">正在准备本地服务…</div>
  </div>
</body>
</html>`;

const here = path.dirname(__filename);

let splashWindow: BrowserWindow | null = null;

appendMainStartupLog(
  `[main] module-loaded pid=${process.pid} exec=${process.execPath} packaged=${app.isPackaged} version=${app.getVersion()}`,
);

process.on("uncaughtException", (err) => {
  appendMainStartupLog(`[main] uncaughtException ${err.stack || err.message}`);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  appendMainStartupLog(`[main] unhandledRejection ${message}`);
});

function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 460,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    center: true,
    backgroundColor: "#0F766E",
    show: false,
    skipTaskbar: true,
    titleBarStyle: "hidden",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(SPLASH_HTML));
  win.once("ready-to-show", () => win.show());
  return win;
}

function setSplashStatus(text: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents.executeJavaScript(
    `(()=>{const el=document.getElementById('status');if(el)el.textContent=${JSON.stringify(text)};})();true;`,
  ).catch(() => {});
}

function closeSplash(graceful = true): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  const win = splashWindow;
  splashWindow = null;
  if (!graceful) { win.destroy(); return; }
  // Fade out then close
  win.webContents
    .executeJavaScript(`document.body.style.transition='opacity 240ms ease-out';document.body.style.opacity='0';true;`)
    .catch(() => {})
    .finally(() => setTimeout(() => { try { win.close(); } catch {} }, 280));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRendererHttp(rawUrl: string, timeoutMs = 30_000): Promise<void> {
  const target = new URL(rawUrl);
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            host: target.hostname,
            port: Number(target.port || 80),
            path: `${target.pathname || "/"}${target.search || ""}`,
            method: "GET",
            timeout: 5_000,
          },
          (res) => {
            res.resume();
            if (res.statusCode && res.statusCode < 600) resolve();
            else reject(new Error(`HTTP ${res.statusCode}`));
          },
        );
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("renderer probe timeout")));
        req.end();
      });
      return;
    } catch (err) {
      lastError = err;
      await sleep(250);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Renderer did not become reachable within ${timeoutMs}ms: ${message}`);
}

async function loadRendererWithRetry(win: BrowserWindow, rawUrl: string): Promise<void> {
  await waitForRendererHttp(rawUrl, 30_000);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      setSplashStatus(attempt === 1 ? "正在加载界面…" : `正在重试加载界面… ${attempt}/8`);
      await win.loadURL(rawUrl);
      return;
    } catch (err) {
      lastError = err;
      if (win.isDestroyed()) throw err;
      await sleep(Math.min(1200, 240 * attempt));
    }
  }
  const message = lastError instanceof Error ? lastError.stack || lastError.message : String(lastError);
  throw new Error(`Renderer failed to load after retries: ${message}`);
}

// `app.getName()` in dev returns "Electron" by default — force our name early.
app.setName(APP_NAME);
app.setAppUserModelId(APP_USER_MODEL_ID);

let mainWindow: BrowserWindow | null = null;
let serverRunner: import("./server-runner.js").ServerRunner | null = null;
let isQuitting = false;

let serverRuntime: typeof import("./server-runner.js") | null = null;
let authRuntime: typeof import("./auth-manager.js") | null = null;

async function loadRuntimeModules(): Promise<void> {
  if (serverRuntime && authRuntime) return;
  appendMainStartupLog("[main] loading-runtime-modules");
  const [serverModule, authModule] = await Promise.all([
    import("./server-runner.js"),
    import("./auth-manager.js"),
  ]);
  serverRuntime = serverModule;
  authRuntime = authModule;
  appendMainStartupLog("[main] runtime-modules-loaded");
}

function requireServerRuntime(): typeof import("./server-runner.js") {
  if (!serverRuntime) throw new Error("server runtime not loaded");
  return serverRuntime;
}

function requireAuthRuntime(): typeof import("./auth-manager.js") {
  if (!authRuntime) throw new Error("auth runtime not loaded");
  return authRuntime;
}

interface BootContext {
  mode: ServerMode;
  port: number;
  /** Where the renderer should load from. */
  rendererUrl: string;
  /** Local file path that mirrors rendererUrl in packaged mode (for fallbacks). */
  rendererFile: string | null;
  webDistDir: string;
  dataDir: string;
  serverEntry: string;
}

function resolveContext(): BootContext {
  if (app.isPackaged) {
    const userDataDataDir = path.join(app.getPath("userData"), "workbench-data");
    const unifiedDataDir = process.env.OPENCLAW_DATA_DIR
      || (fs.existsSync(CANONICAL_DATA_DIR) ? CANONICAL_DATA_DIR : fs.existsSync(LEGACY_DATA_DIR) ? LEGACY_DATA_DIR : CANONICAL_DATA_DIR);
    const packagedDataDir = RUNTIME_ENV === "prod"
      ? migratePackagedDataDir(userDataDataDir, unifiedDataDir)
      : process.env.OPENCLAW_DATA_DIR || isolatedRuntimePath("data");
    return {
      mode: "packaged",
      port: Number(process.env.OPENCLAW_WORKBENCH_PORT ?? DEFAULT_PORT),
      rendererUrl: `http://127.0.0.1:${Number(process.env.OPENCLAW_WORKBENCH_PORT ?? DEFAULT_PORT)}`,
      rendererFile: null,
      webDistDir: path.join(process.resourcesPath, "resources", "web"),
      dataDir: packagedDataDir,
      serverEntry: path.join(process.resourcesPath, "resources", "server", "index.js"),
    };
  }
  const devDataDir = process.env.OPENCLAW_DATA_DIR || (RUNTIME_ENV === "prod" ? requireServerRuntime().resolveDevDataDir() : isolatedRuntimePath("data"));
  return {
    mode: "dev",
    port: Number(process.env.OPENCLAW_WORKBENCH_PORT ?? DEFAULT_PORT),
    rendererUrl: process.env.NJX_COPILOT_LOAD_VITE === "1" ? DEV_VITE_URL : `http://127.0.0.1:${Number(process.env.OPENCLAW_WORKBENCH_PORT ?? DEFAULT_PORT)}`,
    rendererFile: null,
    webDistDir: requireServerRuntime().resolveDevWebDist(),
    dataDir: devDataDir,
    serverEntry: requireServerRuntime().resolveDevEntry(),
  };
}

/**
 * Packaged-mode data directory resolution.
 *
 * Use the same canonical OpenClaw data directory as the server and dev tools:
 * `~/openclaw_data/copilot/data`, with the old
 * `~/openclaw_data/openclaw_workbench/data` only as a compatibility fallback.
 * The packaged-only Electron userData location is honored as a one-time
 * migration source: if it has a `workbench.sqlite` and the canonical location
 * does not, copy the legacy db into place. After that, the canonical location
 * is authoritative and the userData directory is left in place but ignored.
 *
 * Override: set `OPENCLAW_DATA_DIR=/some/path` to force a custom location
 * (used by integration tests and advanced users).
 */
function migratePackagedDataDir(legacyDir: string, unifiedDir: string): string {
  // Hard override always wins.
  if (process.env.OPENCLAW_DATA_DIR) return unifiedDir;

  try {
    fs.mkdirSync(unifiedDir, { recursive: true });
  } catch (err) {
    console.error("[njx-copilot] failed to create unified data dir:", err);
    return legacyDir; // fall back to legacy
  }

  const unifiedDb = path.join(unifiedDir, "workbench.sqlite");
  const legacyDb = path.join(legacyDir, "workbench.sqlite");
  if (fs.existsSync(legacyDb) && !fs.existsSync(unifiedDb)) {
    try {
      // Copy db + WAL/SHM to preserve in-flight state from the legacy dir.
      for (const suffix of ["", "-wal", "-shm"]) {
        const src = legacyDb + suffix;
        const dst = unifiedDb + suffix;
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
          console.log(`[njx-copilot] migrated ${src} -> ${dst}`);
        }
      }
    } catch (err) {
      console.error("[njx-copilot] failed to migrate legacy db, falling back:", err);
      return legacyDir;
    }
  }

  return unifiedDir;
}

function resolveServerWorkspace(ctx: BootContext): string {
  if (process.env.OPENCLAW_WORKSPACE) return process.env.OPENCLAW_WORKSPACE;
  if (RUNTIME_ENV !== "prod") return isolatedRuntimePath("workspace");
  if (ctx.mode === "dev") {
    const normalizedDataDir = path.resolve(ctx.dataDir);
    if (normalizedDataDir === path.resolve(CANONICAL_DATA_DIR)) return CANONICAL_WORKSPACE_DIR;
    return path.dirname(ctx.dataDir);
  }

  const candidates = [
    CANONICAL_WORKSPACE_DIR,
    path.dirname(path.dirname(ctx.dataDir)),
    path.join(os.homedir(), "openclaw", "copilot"),
  ];
  for (const candidate of candidates) {
    try {
      if (
        fs.existsSync(path.join(candidate, "memory"))
        || fs.existsSync(path.join(candidate, "tasks"))
        || (fs.existsSync(path.join(candidate, "package.json")) && fs.existsSync(path.join(candidate, ".git")))
      ) {
        return candidate;
      }
    } catch {
      // Keep trying the next candidate.
    }
  }
  return candidates[candidates.length - 1];
}

function resolveServerListenHost(): string {
  // The desktop renderer should keep loading localhost, but the mobile app
  // pairs through the Mac LAN address. Binding only 127.0.0.1 makes Mate60
  // pairing impossible even when the packaged app is healthy locally.
  return process.env.NJX_COPILOT_SERVER_HOST
    || process.env.OPENCLAW_WORKBENCH_HOST
    || "0.0.0.0";
}

async function bootServer(ctx: BootContext): Promise<import("./server-runner.js").ServerRunner> {
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  fs.mkdirSync(resolveServerWorkspace(ctx), { recursive: true });
  const runner = new (requireServerRuntime().ServerRunner)({
    mode: ctx.mode,
    entry: ctx.serverEntry,
    webDistDir: ctx.webDistDir,
    dataDir: ctx.dataDir,
    port: ctx.port,
    host: resolveServerListenHost(),
    env: {
      // WORKSPACE_DIR is the root that holds the user's `memory/` tree —
      // it must be the *grandparent* of ctx.dataDir, not dataDir itself,
      // because calendar notes etc. live at <workspace>/memory/knowledge/notes
      // (not <workspace>/data/memory/knowledge/notes). The server's
      OPENCLAW_WORKSPACE: resolveServerWorkspace(ctx),
      OPENCLAW_WORKBENCH_ENV: RUNTIME_ENV,
      OPENCLAW_WORKBENCH_PORT: String(ctx.port),
      OPENCLAW_WORKBENCH_PASSWORD: process.env.OPENCLAW_WORKBENCH_PASSWORD
        || (RUNTIME_ENV === "dev" || RUNTIME_ENV === "staging" ? "openclaw2026" : ""),
      OPENCLAW_WORKBENCH_RESET_PASSWORD: process.env.OPENCLAW_WORKBENCH_RESET_PASSWORD
        || (RUNTIME_ENV === "prod" ? "0" : "1"),
      // Server reads DATA_DIR / SIDECAR_DIR from env overrides (config.ts).
      // We inject them so packaged mode can point at the same location dev
      // uses.
      OPENCLAW_DATA_DIR: ctx.dataDir,
      OPENCLAW_SIDECAR_DIR: path.join(ctx.dataDir, "knowledge_sidecars"),
      OPENCLAW_WORKBENCH_REMINDER_SYNC: process.env.OPENCLAW_WORKBENCH_REMINDER_SYNC || (RUNTIME_ENV === "prod" ? "1" : "0"),
      OPENCLAW_WORKBENCH_DISABLE_WIKI_SCHEDULER: process.env.OPENCLAW_WORKBENCH_DISABLE_WIKI_SCHEDULER || (RUNTIME_ENV === "prod" ? "0" : "1"),
      OPENCLAW_WORKBENCH_NAS_ROOT_SCAN: process.env.OPENCLAW_WORKBENCH_NAS_ROOT_SCAN || (RUNTIME_ENV === "prod" ? "1" : "0"),
      OPENCLAW_WORKBENCH_NAS_MOUNT_SCAN: process.env.OPENCLAW_WORKBENCH_NAS_MOUNT_SCAN || (RUNTIME_ENV === "prod" ? "1" : "0"),
      // The server's config.ts reads WEB_DIST_DIR from its own ROOT_DIR. We
      // don't currently override it; in dev that resolves to apps/web/dist
      // (correct). In packaged mode the resources copy is the source of
      // truth and the server picks it up via its own ROOT_DIR resolution.
    },
  });

  runner.on("ready", () => {
    setSplashStatus("本地服务就绪 · 加载界面…");
    broadcastStatus({ state: "ready" });
  });
  runner.on("error", (err) => {
    console.error("[njx-copilot] server error:", err);
    setSplashStatus(`服务异常：${err.message}`);
    broadcastStatus({ state: "error", message: err.message });
  });
  runner.on("exit", (code) => {
    if (!isQuitting) {
      broadcastStatus({ state: "exited", exitCode: code });
    }
  });
  runner.on("log", (line) => {
    // Forward to renderer (last 200 lines) for the in-app diagnostics panel.
    mainWindow?.webContents.send("server:log", line);
  });

  setSplashStatus("正在启动本地服务…");
  broadcastStatus({ state: "starting" });
  runner.start();
  // Wait for the server to actually accept HTTP traffic before we let
  // main() return. Without this, createMainWindow's loadURL races the
  // server's listen() and the renderer crashes with ERR_CONNECTION_REFUSED.
  await runner.waitForReady();
  return runner;
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const, label: `Quit ${APP_NAME}` },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: `${PRODUCT_NAME} · ${APP_NAME}`,
          enabled: false,
        },
        {
          label: "Open Logs Folder",
          click: () => {
            const dir = app.getPath("logs");
            shell.openPath(dir);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createMainWindow(ctx: BootContext): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: PRODUCT_NAME,
    backgroundColor: "#101820",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
    // 主窗口可见后 fade 出 splash（如果还在）
    setTimeout(() => closeSplash(), 120);
  });

  // External links open in the user's browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // In-app navigations: stay on the same origin (server URL).
  win.webContents.on("will-navigate", (event, navUrl) => {
    const target = new URL(navUrl);
    const base = new URL(ctx.rendererUrl);
    if (target.origin !== base.origin) {
      event.preventDefault();
      if (/^https?:\/\//i.test(navUrl)) shell.openExternal(navUrl);
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  try {
    await win.webContents.session.clearCache();
  } catch (err) {
    console.warn("[njx-copilot] failed to clear renderer cache:", err);
  }

  await loadRendererWithRetry(win, ctx.rendererUrl);
  return win;
}

function broadcastStatus(payload: { state: "starting" | "ready" | "exited" | "error"; message?: string; exitCode?: number | null }): void {
  if (!mainWindow) return;
  const status = {
    state: payload.state,
    env: RUNTIME_ENV,
    port: Number(process.env.OPENCLAW_WORKBENCH_PORT ?? DEFAULT_PORT),
    url: `http://127.0.0.1:${Number(process.env.OPENCLAW_WORKBENCH_PORT ?? DEFAULT_PORT)}`,
    message: payload.message,
    exitCode: payload.exitCode,
  };
  mainWindow.webContents.send("server:status", status);
}

function registerIpc(): void {
  ipcMain.handle("app:getInfo", () => ({
    appName: APP_NAME,
    productName: PRODUCT_NAME,
    appVersion: app.getVersion(),
    environment: RUNTIME_ENV,
    electronVersion: process.versions.electron ?? "unknown",
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    locale: app.getLocale(),
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle("app:quit", async () => {
    isQuitting = true;
    await serverRunner?.stop();
    app.quit();
  });

  ipcMain.handle("app:revealLogDir", async () => {
    const dir = app.getPath("logs");
    await shell.openPath(dir);
  });

  ipcMain.handle("server:getStatus", () => ({
    state: serverRunner?.isReady() ? "ready" : "starting",
    env: RUNTIME_ENV,
    port: Number(process.env.OPENCLAW_WORKBENCH_PORT ?? DEFAULT_PORT),
    url: `http://127.0.0.1:${Number(process.env.OPENCLAW_WORKBENCH_PORT ?? DEFAULT_PORT)}`,
  }));

  ipcMain.handle("shell:openExternal", async (_e: IpcMainInvokeEvent, url: string) => {
    if (typeof url !== "string") return;
    if (!/^https?:\/\//i.test(url)) return;
    await shell.openExternal(url);
  });

  ipcMain.handle("window:setTitle", async (_e, title: string) => {
    if (typeof title !== "string") return;
    if (title.length > 200) return;
    mainWindow?.setTitle(title);
  });

  // Auth surface — lets the renderer persist the workbench password
  // (encrypted via electron.safeStorage / macOS keychain) so we can
  // re-login automatically on next launch if cookie/session drift.
  ipcMain.handle("auth:hasStoredPassword", () => requireAuthRuntime().hasStoredPassword());
  ipcMain.handle("auth:rememberPassword", (_e, password: unknown) => {
    if (typeof password !== "string") return false;
    if (password.length < 6) return false;
    return requireAuthRuntime().rememberPassword(password);
  });
  ipcMain.handle("auth:clearPassword", () => {
    requireAuthRuntime().clearPassword();
    return true;
  });
  ipcMain.handle("auth:reconcileSession", async (): Promise<AuthEvent> => {
    if (!mainWindow || !serverRunner) {
      return { kind: "skipped", reason: "not_ready" };
    }
    const baseUrl = `http://127.0.0.1:${ctxPort()}`;
    const result = await requireAuthRuntime().reconcileSession(mainWindow, baseUrl);
    if (result.event?.kind === "login_succeeded" && mainWindow) {
      // Reload the renderer so its first /api/auth/me lands on the new cookie.
      mainWindow.webContents.reload();
    }
    return result.event ?? { kind: "skipped", reason: "no_event" };
  });
}

function ctxPort(): number {
  return Number(process.env.OPENCLAW_WORKBENCH_PORT ?? DEFAULT_PORT);
}

async function main(): Promise<void> {
  appendMainStartupLog("[main] start");
  await loadRuntimeModules();
  // Single-instance lock — clicking the Dock icon focuses the running window
  // instead of spawning a second server (which would fail to bind the port).
  const gotLock = app.requestSingleInstanceLock();
  appendMainStartupLog(`[main] single-instance-lock=${gotLock ? "acquired" : "denied"}`);
  if (!gotLock) {
    appendMainStartupLog("[main] quit single-instance-denied");
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  const ctx = resolveContext();
  appendMainStartupLog(
    `[main] context mode=${ctx.mode} port=${ctx.port} renderer=${ctx.rendererUrl} server=${ctx.serverEntry} web=${ctx.webDistDir} data=${ctx.dataDir}`,
  );

  if (ctx.mode === "dev" && !fs.existsSync(ctx.serverEntry)) {
    // dev:desktop.mjs already ensures the build before launching Electron.
    // If we still get here, the developer is running `electron .` directly.
    const choice = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Quit", "Run build now", "Continue anyway"],
      defaultId: 1,
      cancelId: 0,
      message: "Server build not found",
      detail: `Expected: ${ctx.serverEntry}\n\nChoose "Run build now" to build it automatically, "Continue anyway" to attempt anyway, or "Quit" to exit.`,
    });
    if (choice.response === 0) {
      app.quit();
      return;
    }
    if (choice.response === 1) {
      // Run a build attempt before continuing
      try {
        const { spawnSync } = await import("node:child_process");
        const r = spawnSync("npm", ["--prefix", path.resolve(here, "..", "..", ".."), "run", "build", "--workspace", "@openclaw-workbench/server"], { stdio: "inherit" });
        if (r.status !== 0) {
          app.quit();
          return;
        }
      } catch (e) {
        app.quit();
        return;
      }
    }
  }

  buildMenu();
  registerIpc();

  // 先开 splash，再启 server + main window；main window ready 后关闭 splash
  splashWindow = createSplashWindow();
  appendMainStartupLog("[main] splash-created");
  // 记录 splash 显示起点，强制最少显示 1200ms（避免 server 快启动时一闪而过）
  const splashStartedAt = Date.now();
  const SPLASH_MIN_MS = 1200;

  serverRunner = await bootServer(ctx);
  mainWindow = await createMainWindow(ctx);

  // 主窗口 ready-to-show 会触发 splash 关闭；此处再加一道时间护栏
  if (splashWindow && !splashWindow.isDestroyed()) {
    const elapsed = Date.now() - splashStartedAt;
    const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
    setTimeout(() => closeSplash(), wait);
  }

  // Drift detection: if the chromium cookie is no longer valid server-side
  // (e.g. another client overwrote the session row), auto-re-login using
  // the password encrypted in the OS keychain. This keeps the cookie and
  // the server session in sync without forcing the user to type the
  // password on every launch.
  if (mainWindow) {
    mainWindow.webContents.once("did-finish-load", () => {
      requireAuthRuntime().reconcileSession(mainWindow!, `http://127.0.0.1:${ctxPort()}`)
        .then((result) => {
          if (!result.event) return;
          if (result.event.kind === "login_succeeded" && mainWindow) {
            console.log("[njx-copilot] session reconciled; reloading renderer");
            mainWindow.webContents.reload();
          } else if (result.event.kind === "login_failed") {
            console.warn(`[njx-copilot] auto-login failed: ${result.event.reason}`);
          } else if (result.event.kind === "no_password_stored") {
            // No-op: the renderer will show the AuthScreen for first-time setup.
          } else if (result.event.kind === "skipped" && result.event.reason !== "session_valid") {
            console.log(`[njx-copilot] session reconcile skipped: ${result.event.reason}`);
          }
        })
        .catch((err) => console.error("[njx-copilot] reconcile failed:", err));
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(ctx).then((w) => (mainWindow = w));
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (isQuitting) return;
  if (!serverRunner) return;
  event.preventDefault();
  isQuitting = true;
  try {
    await serverRunner.stop();
  } catch (err) {
    console.error("[njx-copilot] failed to stop server:", err);
  }
  app.exit(0);
});

app.whenReady()
  .then(() => {
    appendMainStartupLog("[main] app-ready");
    return main();
  })
  .catch((err) => {
    appendMainStartupLog(`[main] fatal ${err?.stack ?? err}`);
    console.error("[njx-copilot] fatal:", err);
    if (app.isReady()) {
      dialog.showErrorBox(`${APP_NAME} failed to start`, String(err?.stack ?? err));
    }
    app.exit(1);
  });
