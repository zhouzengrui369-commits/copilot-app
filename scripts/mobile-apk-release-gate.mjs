import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function latestReleaseManifest() {
  const releaseDir = path.join(rootDir, "release");
  const candidates = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir)
      .filter((name) => /^openclaw-mate60-.+\.manifest\.json$/.test(name))
      .map((name) => path.join(releaseDir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  return candidates[0] || path.join(releaseDir, "openclaw-mate60-1.0.7-build6-2e2420d1.manifest.json");
}

const manifestPath = path.resolve(rootDir, process.argv[2] || latestReleaseManifest());

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function statSize(filePath) {
  return fs.statSync(filePath).size;
}

const manifest = readJson(manifestPath);
const manifestDir = path.dirname(manifestPath);
const artifactPath = path.resolve(manifestDir, manifest.artifact);
const rootAliasPath = path.resolve(manifestDir, manifest.rootAlias);
const appConfig = readJson(path.join(rootDir, "apps/mobile/app.json")).expo;
const mobileLock = readJson(path.join(rootDir, "apps/mobile/package-lock.json"));
const installDoc = readText("openclaw-mobile-mate60-install.md");

assert(fs.existsSync(artifactPath), "release_apk_missing", { artifactPath });
assert(fs.existsSync(rootAliasPath), "root_apk_alias_missing", { rootAliasPath });
assert(fs.existsSync(manifestPath), "release_manifest_missing", { manifestPath });
assert(fs.existsSync(path.join(rootDir, "apps/mobile/package-lock.json")), "mobile_lockfile_missing");

const artifactHash = sha256(artifactPath);
const rootAliasHash = sha256(rootAliasPath);
assert(artifactHash === manifest.sha256, "release_apk_sha256_mismatch", {
  expected: manifest.sha256,
  actual: artifactHash,
});
assert(rootAliasHash === manifest.sha256, "root_apk_alias_sha256_mismatch", {
  expected: manifest.sha256,
  actual: rootAliasHash,
});
assert(statSize(artifactPath) === manifest.sizeBytes, "release_apk_size_mismatch", {
  expected: manifest.sizeBytes,
  actual: statSize(artifactPath),
});
assert(statSize(rootAliasPath) === manifest.sizeBytes, "root_apk_alias_size_mismatch", {
  expected: manifest.sizeBytes,
  actual: statSize(rootAliasPath),
});

const unzip = spawnSync("unzip", ["-tq", rootAliasPath], { encoding: "utf8" });
assert(unzip.status === 0, "release_apk_zip_integrity_failed", {
  status: unzip.status,
  stderr: unzip.stderr,
  stdout: unzip.stdout,
});

assert(manifest.platform === "android", "release_manifest_platform_mismatch", manifest.platform);
assert(manifest.targetDevice === "Huawei Mate60", "release_manifest_target_device_mismatch", manifest.targetDevice);
assert(manifest.targetOsVersion === "4.2.0.210", "release_manifest_target_os_mismatch", manifest.targetOsVersion);
assert(manifest.packageName === appConfig.android?.package, "release_manifest_package_mismatch", {
  manifest: manifest.packageName,
  appJson: appConfig.android?.package,
});
assert(manifest.appVersion === appConfig.version, "release_manifest_version_mismatch", {
  manifest: manifest.appVersion,
  appJson: appConfig.version,
});
assert(manifest.versionCode === appConfig.android?.versionCode, "release_manifest_version_code_mismatch", {
  manifest: manifest.versionCode,
  appJson: appConfig.android?.versionCode,
});
assert(manifest.channel === "preview", "release_manifest_channel_mismatch", manifest.channel);
assert(manifest.buildProfile === "preview", "release_manifest_build_profile_mismatch", manifest.buildProfile);
assert(manifest.distribution === "INTERNAL", "release_manifest_distribution_mismatch", manifest.distribution);
assert(/^https:\/\/expo\.dev\/accounts\/nanjixiong\/projects\/openclaw-mobile\/builds\//.test(manifest.easBuildPage), "release_manifest_eas_page_invalid", manifest.easBuildPage);
assert(/^https:\/\/expo\.dev\/artifacts\/eas\/.+\.apk$/.test(manifest.easArtifactUrl), "release_manifest_eas_artifact_invalid", manifest.easArtifactUrl);
assert(mobileLock.name === "@openclaw-workbench/mobile", "mobile_lockfile_wrong_package", mobileLock.name);
assert(mobileLock.version === appConfig.version, "mobile_lockfile_version_mismatch", {
  lockfile: mobileLock.version,
  appJson: appConfig.version,
});

for (const required of [
  manifest.easBuildId,
  manifest.sha256,
  path.resolve(manifestDir, manifest.rootAlias),
  path.resolve(manifestDir, manifest.artifact),
  manifestPath,
]) {
  assert(installDoc.includes(required), "install_doc_missing_release_reference", required);
}

console.log(JSON.stringify({
  ok: true,
  artifact: path.relative(rootDir, artifactPath),
  rootAlias: path.relative(rootDir, rootAliasPath),
  sha256: manifest.sha256,
  sizeBytes: manifest.sizeBytes,
  packageName: manifest.packageName,
  appVersion: manifest.appVersion,
  versionCode: manifest.versionCode,
  easBuildId: manifest.easBuildId,
}, null, 2));
