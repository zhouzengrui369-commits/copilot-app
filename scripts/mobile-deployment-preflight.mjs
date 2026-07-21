#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function latestReleaseManifestRelPath() {
  const releaseDir = path.join(rootDir, "release");
  const candidates = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir)
      .filter((name) => /^openclaw-mate60-.+\.manifest\.json$/.test(name))
      .map((name) => path.join("release", name))
      .sort((a, b) => fs.statSync(path.join(rootDir, b)).mtimeMs - fs.statSync(path.join(rootDir, a)).mtimeMs)
    : [];
  return candidates[0] || "release/openclaw-mate60-1.0.7-build6-2e2420d1.manifest.json";
}

const manifestRelPath = process.argv[2] || latestReleaseManifestRelPath();
const manifestPath = path.resolve(rootDir, manifestRelPath);
const strict = process.env.OPENCLAW_DEPLOYMENT_PREFLIGHT_STRICT === "1";
const checkRelay = process.env.OPENCLAW_DEPLOYMENT_PREFLIGHT_NETWORK === "1";
const requireLocalAndroidBuild = process.env.OPENCLAW_DEPLOYMENT_PREFLIGHT_REQUIRE_LOCAL_ANDROID === "1";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    timeout: options.timeoutMs || 15_000,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error ? String(result.error.message || result.error) : "",
  };
}

function compactLines(text, limit = 40) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    count: lines.length,
    lines: lines.slice(0, limit),
    truncated: lines.length > limit,
  };
}

function walkFiles(startPath, files = []) {
  if (!fs.existsSync(startPath)) return files;
  const stat = fs.statSync(startPath);
  if (stat.isFile()) {
    files.push(startPath);
    return files;
  }
  if (!stat.isDirectory()) return files;
  for (const entry of fs.readdirSync(startPath)) {
    if (["node_modules", ".expo", "dist", "dist-web", "ios", "android"].includes(entry)) continue;
    walkFiles(path.join(startPath, entry), files);
  }
  return files;
}

function latestMtimeMs(paths) {
  return paths
    .flatMap((entry) => walkFiles(path.join(rootDir, entry)))
    .reduce((latest, filePath) => Math.max(latest, fs.statSync(filePath).mtimeMs), 0);
}

function appJson() {
  return readJson(path.join(rootDir, "apps/mobile/app.json")).expo;
}

function apkState() {
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, error: "manifest_missing", manifestPath };
  }
  const manifest = readJson(manifestPath);
  const artifactPath = path.resolve(path.dirname(manifestPath), manifest.artifact || "");
  const rootAliasPath = path.resolve(path.dirname(manifestPath), manifest.rootAlias || "");
  const artifactExists = fs.existsSync(artifactPath);
  const rootAliasExists = fs.existsSync(rootAliasPath);
  const artifactHash = artifactExists ? sha256(artifactPath) : "";
  const rootAliasHash = rootAliasExists ? sha256(rootAliasPath) : "";
  const gitHead = run("git", ["rev-parse", "HEAD"]);
  const dirty = run("git", [
    "status",
    "--short",
    "--",
    "apps/mobile",
    "package.json",
    "scripts/mobile-ui-contract-smoke.mjs",
    "scripts/mobile-ios-preflight-smoke.mjs",
    "scripts/mobile-deployment-preflight.mjs",
    "scripts/openclaw-mobile-verify.sh",
    "openclaw-mobile-mate60-install.md",
  ]);
  const dirtySummary = compactLines(dirty.stdout, 60);
  const builtFromCurrentHead = Boolean(manifest.easGitCommitHash && gitHead.stdout && manifest.easGitCommitHash === gitHead.stdout);
  const apkHashOk = artifactExists && rootAliasExists && artifactHash === manifest.sha256 && rootAliasHash === manifest.sha256;
  const sourceDirty = dirtySummary.count > 0;
  const localSnapshotBuild = manifest.source?.mode === "local-workspace-snapshot";
  const buildCompletedAtMs = Date.parse(manifest.easBuildCompletedAt || manifest.createdAt || "");
  const latestMobileSourceMtimeMs = latestMtimeMs([
    "apps/mobile/.easignore",
    "apps/mobile/app.json",
    "apps/mobile/assets",
    "apps/mobile/index.js",
    "apps/mobile/metro.config.js",
    "apps/mobile/package.json",
    "apps/mobile/package-lock.json",
    "apps/mobile/plugins",
    "apps/mobile/scripts",
    "apps/mobile/src",
    "apps/mobile/tsconfig.json",
    ".easignore",
    "package.json",
    "package-lock.json",
  ]);
  const sourceChangedAfterSnapshot = Boolean(
    localSnapshotBuild &&
    Number.isFinite(buildCompletedAtMs) &&
    latestMobileSourceMtimeMs > buildCompletedAtMs + 1_000
  );
  const otaUpdatedAtMs = Date.parse(manifest.otaUpdate?.createdAt || manifest.otaUpdate?.publishedAt || "");
  const otaFreshForCurrentSource = Boolean(
    apkHashOk &&
    manifest.otaEnabled &&
    manifest.otaUpdate?.runtimeVersion === manifest.runtimeVersion &&
    Number.isFinite(otaUpdatedAtMs) &&
    latestMobileSourceMtimeMs <= otaUpdatedAtMs + 1_000
  );
  const snapshotFreshForCurrentSource = apkHashOk && localSnapshotBuild && !sourceChangedAfterSnapshot;
  const freshForCurrentSource = apkHashOk && (
    (builtFromCurrentHead && !sourceDirty) ||
    snapshotFreshForCurrentSource ||
    otaFreshForCurrentSource
  );
  return {
    ok: apkHashOk,
    manifestPath,
    artifactPath,
    rootAliasPath,
    packageName: manifest.packageName,
    appVersion: manifest.appVersion,
    versionCode: manifest.versionCode,
    channel: manifest.channel,
    easBuildId: manifest.easBuildId,
    easGitCommitHash: manifest.easGitCommitHash || "",
    currentGitHead: gitHead.stdout || "",
    builtFromCurrentHead,
    localSnapshotBuild,
    sourceDirty,
    dirtySummary,
    latestMobileSourceMtime: latestMobileSourceMtimeMs ? new Date(latestMobileSourceMtimeMs).toISOString() : "",
    sourceChangedAfterSnapshot,
    otaFreshForCurrentSource,
    otaUpdatedAt: Number.isFinite(otaUpdatedAtMs) ? new Date(otaUpdatedAtMs).toISOString() : "",
    sha256: manifest.sha256,
    artifactHash,
    rootAliasHash,
    freshForCurrentSource,
    mate60UpdateRequired: !freshForCurrentSource,
    reason: freshForCurrentSource
      ? (otaFreshForCurrentSource
        ? "apk_runtime_matches_manifest_and_preview_ota_covers_current_source"
        : (snapshotFreshForCurrentSource ? "apk_matches_manifest_and_local_snapshot" : "apk_matches_manifest_and_current_source"))
      : "apk_is_valid_but_does_not_prove_current_source_is_installed",
  };
}

function iosPhysicalDeviceState() {
  const result = run("xcrun", ["devicectl", "list", "devices"], { timeoutMs: 25_000 });
  const raw = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const noDevices = /No devices found/i.test(raw);
  const devices = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /iPhone|iPad|iPod/.test(line));
  return {
    command: "xcrun devicectl list devices",
    ok: result.ok && !noDevices && devices.length > 0,
    commandOk: result.ok,
    noDevices,
    devices,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    installReady: result.ok && !noDevices && devices.length > 0,
  };
}

function javaRuntimeState() {
  const result = run("java", ["-version"], { timeoutMs: 10_000 });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return {
    command: "java -version",
    ok: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    versionLine: output.split(/\r?\n/).find(Boolean) || "",
  };
}

function androidSdkState() {
  const homeSdk = path.join(process.env.HOME || "", "Library", "Android", "sdk");
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
  const candidates = [androidHome, homeSdk].filter(Boolean);
  const existing = candidates.filter((candidate) => fs.existsSync(candidate));
  return {
    ok: existing.length > 0,
    androidHome,
    androidSdkRoot: process.env.ANDROID_SDK_ROOT || "",
    homeSdk,
    existing,
  };
}

async function relayState(config) {
  const publicBrokerUrl = String(config.extra?.openclaw?.publicBrokerUrl || "").replace(/\/+$/, "");
  if (!publicBrokerUrl) return { checked: false, ok: false, error: "public_broker_url_missing" };
  if (!checkRelay) {
    return {
      checked: false,
      ok: null,
      publicBrokerUrl,
      reason: "set OPENCLAW_DEPLOYMENT_PREFLIGHT_NETWORK=1 to check CloudBase relay health",
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${publicBrokerUrl}/health`, { signal: controller.signal });
    const text = await res.text();
    return {
      checked: true,
      ok: res.ok,
      status: res.status,
      publicBrokerUrl,
      bodyPreview: text.slice(0, 600),
    };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      publicBrokerUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

const config = appJson();
const apk = apkState();
const iosDevice = iosPhysicalDeviceState();
const androidNativeProjectExists = fs.existsSync(path.join(rootDir, "apps/mobile/android"));
const javaRuntime = javaRuntimeState();
const androidSdk = androidSdkState();
const relay = await relayState(config);
const blockers = [];

if (!apk.ok) blockers.push("APK 文件或 manifest 校验失败，不能交给 Mate60 安装。");
if (apk.mate60UpdateRequired) blockers.push("Mate60 当前 APK 不证明包含本轮源码，需要发布 preview OTA 或重建 APK。");
if (!iosDevice.installReady) blockers.push("iPhone 11 未被 Xcode CoreDevice 识别，不能执行本机安装/调试。");
if (requireLocalAndroidBuild && !androidNativeProjectExists) blockers.push("仓库当前没有 apps/mobile/android 原生工程，不能直接 Gradle 本地重包。");
if (requireLocalAndroidBuild && !javaRuntime.ok) blockers.push("本机没有可用 Java Runtime/JDK，不能执行 Android Gradle 本地重包。");
if (requireLocalAndroidBuild && !androidSdk.ok) blockers.push("本机没有可用 Android SDK 路径，不能执行 Android Gradle 本地重包。");
if (relay.checked && relay.ok === false) blockers.push("CloudBase public relay 健康检查未通过，外网 Mate60 不能用它作为稳定通道。");

const report = {
  ok: blockers.length === 0,
  readyForMate60: apk.ok && !apk.mate60UpdateRequired && (relay.checked ? relay.ok === true : true),
  readyForIphone11Install: iosDevice.installReady,
  app: {
    name: config.name,
    version: config.version,
    androidPackage: config.android?.package,
    androidVersionCode: config.android?.versionCode,
    iosBundleIdentifier: config.ios?.bundleIdentifier,
    iosBuildNumber: config.ios?.buildNumber,
    updateChannel: config.extra?.openclaw?.updateChannel,
  },
  apk,
  iosDevice,
  androidNativeProjectExists,
  javaRuntime,
  androidSdk,
  relay,
  blockers,
  warnings: [
    ...(!androidNativeProjectExists ? ["仓库当前没有 apps/mobile/android 原生工程，不能直接 Gradle 本地重包；本轮使用 EAS 远端 APK。"] : []),
    ...(!javaRuntime.ok ? ["本机没有可用 Java Runtime/JDK，不能执行 Android Gradle 本地重包；本轮使用 EAS 远端 APK。"] : []),
    ...(!androidSdk.ok ? ["本机没有可用 Android SDK 路径，不能执行 Android Gradle 本地重包；本轮使用 EAS 远端 APK。"] : []),
  ],
  nextActions: [
    "Mate60 安装本轮 APK：使用 /Users/njx/openclaw/copilot/openclaw-mate60.apk。",
    "如需完全本机重包：先安装 JDK 和 Android SDK，再生成 apps/mobile/android 原生工程。",
    "如需 iPhone 11 真机安装：USB 连接、信任这台 Mac、打开开发者模式，并确认 xcrun devicectl list devices 能看到 iPhone。",
    "如需 Mate60 外网同步：先恢复 CloudBase relay，或改用可用公网 relay。",
  ],
};

console.log(JSON.stringify(report, null, 2));

if (strict && !report.ok) {
  process.exit(1);
}
