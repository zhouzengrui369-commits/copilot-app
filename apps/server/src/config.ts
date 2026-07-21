import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

export const ROOT_DIR = path.resolve(new URL("../../..", import.meta.url).pathname);
export const HOME_DIR = os.homedir();
// Runtime data is shared across the web server and the packaged Electron app.
// Keep user data out of the product repo so app launches, dev launches, and
// packaged launches all see the same notes, reports, tasks, and sidecars.
const CANONICAL_WORKSPACE_DIR = path.join(HOME_DIR, "openclaw_data");
const CANONICAL_DATA_DIR = path.join(CANONICAL_WORKSPACE_DIR, "copilot", "data");
const LEGACY_DATA_DIR = path.join(CANONICAL_WORKSPACE_DIR, "openclaw_workbench", "data");
const CANONICAL_SIDECAR_DIR = path.join(CANONICAL_DATA_DIR, "knowledge_sidecars");
const LEGACY_SIDECAR_DIR = path.join(CANONICAL_WORKSPACE_DIR, "openclaw_workbench", "knowledge_sidecars");

function resolveWithLegacyFallback(primary: string, legacy: string) {
  if (existsSync(primary)) return primary;
  if (existsSync(legacy)) return legacy;
  return primary;
}

export const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE || (existsSync(CANONICAL_WORKSPACE_DIR) ? CANONICAL_WORKSPACE_DIR : ROOT_DIR);
export const DATA_DIR = process.env.OPENCLAW_DATA_DIR || resolveWithLegacyFallback(CANONICAL_DATA_DIR, LEGACY_DATA_DIR);
export const SIDECAR_DIR = process.env.OPENCLAW_SIDECAR_DIR || resolveWithLegacyFallback(CANONICAL_SIDECAR_DIR, LEGACY_SIDECAR_DIR);
// The packaged shell ships the web bundle at `<.app>/.../resources/web/`,
// not `<.app>/.../resources/apps/web/dist/`. Try the env override first,
// then the packaged layout, then the dev layout.
const PACKAGED_WEB_DIST = path.join(ROOT_DIR, "web");
export const WEB_DIST_DIR = process.env.OPENCLAW_WEB_DIST_DIR || (existsSync(PACKAGED_WEB_DIST) ? PACKAGED_WEB_DIST : path.join(ROOT_DIR, "apps/web/dist"));
export const HOST = process.env.OPENCLAW_WORKBENCH_HOST || "0.0.0.0";
export const PORT = Number(process.env.OPENCLAW_WORKBENCH_PORT || 38888);
export const SESSION_DAYS = Number(process.env.OPENCLAW_WORKBENCH_SESSION_DAYS || 14);
export const CLOUDBASE_BROKER_URL = (process.env.OPENCLAW_CB_BROKER_URL
  || "https://njx-copilot-d6gs7642f8fa17122.service.tcloudbase.com/openclaw-relay").replace(/\/+$/, "");
export const CLOUDBASE_ENABLED = process.env.OPENCLAW_CB_ENABLED === "1" || process.env.OPENCLAW_CB_ENABLED === "true";
export const FORWARDER_AUTH_TOKEN = process.env.OPENCLAW_FORWARDER_TOKEN || "";

// 2026-06-19 — Mate60 mobile knowledge base root. Defaults to /Volumes/南极熊
// (NJX's real NAS) so the phone can browse the same vault the rest of OpenClaw
// writes to. Falls back to the local ~/openclaw mirror if the NAS is unmounted,
// and to /Users/njx/openclaw for legacy dev layouts. Override with
// OPENCLAW_KB_VAULT_DIR if NJX has a different workspace layout.
const FALLBACK_KB_VAULTS = [
  "/Volumes/南极熊",
  path.join(HOME_DIR, "openclaw"),
  ROOT_DIR,
];
const DEFAULT_KB_VAULT = FALLBACK_KB_VAULTS.find((candidate) => existsSync(candidate)) || FALLBACK_KB_VAULTS[0];
export const KB_VAULT_DIR = process.env.OPENCLAW_KB_VAULT_DIR || DEFAULT_KB_VAULT;

export function nowIso() {
  return new Date().toISOString();
}

export function safeName(input: string) {
  return input
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}._\-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "untitled";
}
