import fs from "node:fs";
import path from "node:path";

import { KB_VAULT_DIR } from "../config.js";

export const DEFAULT_NAS_ROOT = "/Volumes/南极熊";

export type NasRootResolution = {
  root: string;
  status: "connected" | "unavailable";
  reason?: string;
  graphPath?: string;
};

export function nasRootCandidates() {
  const roots = [
    process.env.OPENCLAW_NAS_ROOT,
    DEFAULT_NAS_ROOT,
    "/Volumes/南极熊-1",
    KB_VAULT_DIR,
    ...listMountedNanjixiongRoots(),
  ].filter(Boolean) as string[];
  return Array.from(new Set(roots.map((root) => path.resolve(root))));
}

export function resolveNasRoot(): NasRootResolution {
  const candidates = nasRootCandidates();
  const reasons: string[] = [];
  for (const root of candidates) {
    const reason = nasRootUnavailableReason(root);
    if (reason) {
      reasons.push(`${root}: ${reason}`);
      continue;
    }
    return {
      root,
      status: "connected",
      graphPath: findNasGraph(root),
    };
  }
  return {
    root: candidates[0] || DEFAULT_NAS_ROOT,
    status: "unavailable",
    reason: reasons[0] || "nas_root_not_mounted",
  };
}

export function readableNasRoots() {
  return nasRootCandidates().filter((root) => !nasRootUnavailableReason(root));
}

export function findNasGraph(root: string) {
  const direct = [path.join(root, "_knowledge_graph.md"), path.join(root, "_knowledge_graph(1).md")];
  for (const file of direct) {
    if (safeFileExists(file)) return file;
  }
  if (process.env.OPENCLAW_WORKBENCH_NAS_ROOT_SCAN !== "1") return undefined;
  try {
    const graph = fs.readdirSync(root)
      .filter((name) => /^_knowledge_graph(?:\(\d+\))?\.md$/i.test(name))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
      .map((name) => path.join(root, name))
      .find((file) => safeFileExists(file));
    return graph || undefined;
  } catch {
    return undefined;
  }
}

export function nasPreferredEntries(root: string, graphPath?: string) {
  return Array.from(new Set([
    graphPath ? path.basename(graphPath) : "_knowledge_graph.md",
    "04我的笔记",
    "07知识库",
    "03知行合一",
    "09_Wiki",
    "08任务产出",
  ])).filter((name) => safePathExists(path.join(root, name)));
}

function listMountedNanjixiongRoots() {
  if (process.env.OPENCLAW_WORKBENCH_NAS_MOUNT_SCAN !== "1") return [];
  try {
    return fs.readdirSync("/Volumes")
      .filter((name) => name.startsWith("南极熊"))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
      .map((name) => path.join("/Volumes", name));
  } catch {
    return [];
  }
}

function nasRootUnavailableReason(root: string) {
  try {
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) return "nas_root_not_directory";
    fs.accessSync(root, fs.constants.R_OK | fs.constants.X_OK);
    return "";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "nas_root_not_mounted";
    if ((err as NodeJS.ErrnoException).code === "EACCES" || (err as NodeJS.ErrnoException).code === "EPERM") return "nas_root_permission_denied";
    return (err as Error).message || "nas_root_unavailable";
  }
}

function safePathExists(target: string) {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function safeFileExists(target: string) {
  try {
    return fs.existsSync(target) && fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

export type MobileVaultInfo = {
  // 2026-06-24 P0-A — explicit field names required by the handoff contract.
  vaultRoot: string;
  vaultLabel: string;
  vaultAvailable: boolean;
  vaultFallbackReason: string | null;
  // legacy fields kept for the previous batch — will be removed after one release cycle.
  root?: string;
  status?: "connected" | "unavailable";
  reason?: string | null;
  writable?: boolean;
  writeReason?: string | null;
  graphPath?: string | null;
  displayName?: string;
  preferredEntries?: string[];
  kbVaultDir?: string;
};

/**
 * Mobile-friendly vault summary. Exposed by /api/mobile/bootstrap so the
 * Mate60 home screen can show "南极熊: connected / unavailable: <reason>"
 * instead of a fake path.
 */
export function mobileVaultInfo(): MobileVaultInfo {
  const resolved = resolveNasRoot();
  const writeReason = resolved.status === "connected"
    ? nasRootWriteUnavailableReason(resolved.root)
    : resolved.reason || "nas_root_unavailable";
  const displayName = path.basename(resolved.root) || resolved.root;
  const fallbackReason = resolved.reason ?? (resolved.status === "connected" ? writeReason : null);
  return {
    // Required P0-A contract fields
    vaultRoot: resolved.root,
    vaultLabel: displayName,
    vaultAvailable: resolved.status === "connected" && !writeReason,
    vaultFallbackReason: fallbackReason || null,
    // legacy aliases
    root: resolved.root,
    status: resolved.status,
    reason: resolved.reason ?? null,
    writable: resolved.status === "connected" && !writeReason,
    writeReason: writeReason || null,
    graphPath: resolved.graphPath ?? null,
    displayName,
    preferredEntries: nasPreferredEntries(resolved.root, resolved.graphPath),
    kbVaultDir: KB_VAULT_DIR,
  };
}

function nasRootWriteUnavailableReason(root: string) {
  try {
    fs.accessSync(root, fs.constants.W_OK);
    return "";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "nas_root_not_mounted";
    if ((err as NodeJS.ErrnoException).code === "EACCES" || (err as NodeJS.ErrnoException).code === "EPERM") return "nas_root_read_only";
    return (err as Error).message || "nas_root_not_writable";
  }
}
