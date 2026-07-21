/**
 * Preload script. Runs in an isolated context with access to a small Node +
 * Electron surface. We expose only the minimum IPC the renderer needs via
 * `contextBridge` so the renderer stays sandbox-friendly.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type AppInfo = {
  appName: string;
  productName: string;
  appVersion: string;
  environment?: "dev" | "staging" | "prod" | string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  locale: string;
  isPackaged: boolean;
};

type ServerStatus = {
  state: "starting" | "ready" | "exited" | "error";
  env?: "dev" | "staging" | "prod" | string;
  port: number;
  url: string;
  message?: string;
  exitCode?: number | null;
};

type AuthEvent =
  | { kind: "login_succeeded"; token: string }
  | { kind: "login_failed"; reason: string }
  | { kind: "no_password_stored" }
  | { kind: "skipped"; reason: string };

const api = {
  app: {
    getInfo: (): Promise<AppInfo> => ipcRenderer.invoke("app:getInfo"),
    quit: (): Promise<void> => ipcRenderer.invoke("app:quit"),
    revealLogDir: (): Promise<void> => ipcRenderer.invoke("app:revealLogDir"),
  },
  server: {
    getStatus: (): Promise<ServerStatus> => ipcRenderer.invoke("server:getStatus"),
    onStatusChange: (cb: (status: ServerStatus) => void) => {
      const handler = (_e: IpcRendererEvent, status: ServerStatus) => cb(status);
      ipcRenderer.on("server:status", handler);
      return () => ipcRenderer.removeListener("server:status", handler);
    },
    onLog: (cb: (line: string) => void) => {
      const handler = (_e: IpcRendererEvent, line: string) => cb(line);
      ipcRenderer.on("server:log", handler);
      return () => ipcRenderer.removeListener("server:log", handler);
    },
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  },
  window: {
    setTitle: (title: string): Promise<void> => ipcRenderer.invoke("window:setTitle", title),
  },
  auth: {
    hasStoredPassword: (): Promise<boolean> => ipcRenderer.invoke("auth:hasStoredPassword"),
    rememberPassword: (password: string): Promise<boolean> =>
      ipcRenderer.invoke("auth:rememberPassword", password),
    clearPassword: (): Promise<boolean> => ipcRenderer.invoke("auth:clearPassword"),
    reconcileSession: (): Promise<AuthEvent> => ipcRenderer.invoke("auth:reconcileSession"),
  },
};

contextBridge.exposeInMainWorld("njxCopilot", api);

export type NjxCopilotApi = typeof api;
