#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileDir = path.join(rootDir, "apps", "mobile");
const requireFromMobile = createRequire(path.join(mobileDir, "package.json"));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assert(condition, message, details = {}) {
  if (!condition) {
    console.error(JSON.stringify({ ok: false, error: message, ...details }, null, 2));
    process.exit(1);
  }
}

function exists(relPath) {
  return fs.existsSync(path.join(rootDir, relPath));
}

function canResolve(pkgName) {
  try {
    requireFromMobile.resolve(`${pkgName}/package.json`);
    return true;
  } catch {
    return false;
  }
}

const appJson = readJson(path.join(mobileDir, "app.json")).expo;
const pkg = readJson(path.join(mobileDir, "package.json"));
const rootPkg = readJson(path.join(rootDir, "package.json"));
const metroConfig = readText(path.join(mobileDir, "metro.config.js"));
const workspace = readText(path.join(mobileDir, "ios", "OpenClaw.xcworkspace", "contents.xcworkspacedata"));
const xcodeEnv = readText(path.join(mobileDir, "ios", ".xcode.env"));
const infoPlist = readText(path.join(mobileDir, "ios", "OpenClaw", "Info.plist"));
const podfile = readText(path.join(mobileDir, "ios", "Podfile"));

const checks = [];
function check(name, condition, details) {
  assert(condition, `mobile_ios_preflight_failed:${name}`, details);
  checks.push(name);
}

check("expo app identity", appJson.name === "OpenClaw 随身分身" && appJson.slug === "openclaw-mobile", {
  name: appJson.name,
  slug: appJson.slug,
});
check("ios bundle identity", appJson.ios?.bundleIdentifier === "com.openclaw.mobile" && String(appJson.ios?.buildNumber || ""), {
  ios: appJson.ios,
});
check("ios first delivery contract", appJson.extra?.openclaw?.iosFirst === true && appJson.extra?.openclaw?.androidFirst === false, {
  openclaw: appJson.extra?.openclaw,
});
check("public broker declared", /^https:\/\/.+tcloudbase\.com\/openclaw-relay$/.test(String(appJson.extra?.openclaw?.publicBrokerUrl || "")), {
  publicBrokerUrl: appJson.extra?.openclaw?.publicBrokerUrl,
});
check("ios privacy permissions", Boolean(appJson.ios?.infoPlist?.NSLocalNetworkUsageDescription) && Boolean(appJson.ios?.infoPlist?.NSMicrophoneUsageDescription), {
  infoPlist: appJson.ios?.infoPlist,
});
check("ios native plist permissions", infoPlist.includes("NSLocalNetworkUsageDescription") && infoPlist.includes("NSMicrophoneUsageDescription"), {});
check("ios url scheme", infoPlist.includes("<string>openclaw</string>") && infoPlist.includes("<string>com.openclaw.mobile</string>"), {});
check("ios hermes compiler pinned to repo", xcodeEnv.includes("OPENCLAW_HERMES_CLI_PATH") && exists("node_modules/hermes-compiler/hermesc/osx-bin/hermesc"), {});
check("xcode workspace includes pods", workspace.includes("OpenClaw.xcodeproj") && workspace.includes("Pods/Pods.xcodeproj"), {});
check("ios native files", [
  "apps/mobile/ios/OpenClaw.xcodeproj/project.pbxproj",
  "apps/mobile/ios/OpenClaw.xcworkspace/contents.xcworkspacedata",
  "apps/mobile/ios/Podfile.lock",
  "apps/mobile/ios/Pods/Manifest.lock",
].every(exists), {});
check("podfile expo react native", podfile.includes("use_expo_modules!") && podfile.includes("use_react_native!"), {});
check("metro monorepo entry", metroConfig.includes("expo/metro-config") && metroConfig.includes("getDefaultConfig(__dirname)") && metroConfig.includes("watchFolders"), {
  metroConfig,
});
check("ios scripts present", Boolean(pkg.scripts?.ios && pkg.scripts?.["ios:expo-go"] && pkg.scripts?.["ios:testflight"]), {
  scripts: pkg.scripts,
});
check("workspace scripts present", Boolean(rootPkg.scripts?.["mobile:ios"] && rootPkg.scripts?.["mobile:ios:expo-go"] && rootPkg.scripts?.["mobile:ios:testflight"]), {
  scripts: rootPkg.scripts,
});
check("required native packages resolve", ["expo", "react-native", "react-native-safe-area-context", "expo-audio"].every(canResolve), {});
check("mobile lockfile present", exists("apps/mobile/package-lock.json"), {});

console.log(JSON.stringify({
  ok: true,
  platform: "ios",
  bundleIdentifier: appJson.ios.bundleIdentifier,
  buildNumber: appJson.ios.buildNumber,
  version: appJson.version,
  updateChannel: appJson.extra?.openclaw?.updateChannel,
  publicBrokerUrl: appJson.extra?.openclaw?.publicBrokerUrl,
  checks,
}, null, 2));
