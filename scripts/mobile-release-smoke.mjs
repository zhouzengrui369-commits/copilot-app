import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
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

const appConfig = readJson("apps/mobile/app.json").expo;
const easConfig = readJson("apps/mobile/eas.json");
const mobilePackage = readJson("apps/mobile/package.json");
const rootPackage = readJson("package.json");
const todayScreen = readText("apps/mobile/src/screens/TodayConsoleScreen.tsx");
const deviceScreen = readText("apps/mobile/src/screens/DeviceScreen.tsx");
const mobileApi = readText("apps/mobile/src/lib/api.ts");
const mobileStorage = readText("apps/mobile/src/lib/storage.ts");
const serverConfig = readText("apps/server/src/config.ts");
const serverIndex = readText("apps/server/src/index.ts");
const desktopRunner = readText("apps/desktop/src/server-runner.ts");

assert(appConfig.name?.includes("随身分身"), "mobile_chinese_app_name_missing", appConfig.name);
assert(appConfig.android?.package === "com.openclaw.mobile", "android_package_not_configured", appConfig.android);
assert(Number.isInteger(appConfig.android?.versionCode) && appConfig.android.versionCode >= 1, "android_version_code_invalid", appConfig.android);
assert(appConfig.ios?.bundleIdentifier === "com.openclaw.mobile", "ios_bundle_identifier_not_configured", appConfig.ios);
assert(/^[1-9]\d*$/.test(String(appConfig.ios?.buildNumber || "")), "ios_build_number_invalid", appConfig.ios);
assert(appConfig.ios?.infoPlist?.CFBundleDisplayName?.includes("随身分身"), "ios_chinese_display_name_missing", appConfig.ios?.infoPlist);
assert(appConfig.ios?.infoPlist?.CFBundleDevelopmentRegion === "zh_CN", "ios_default_region_must_be_chinese", appConfig.ios?.infoPlist);
assert(appConfig.ios?.infoPlist?.NSLocalNetworkUsageDescription, "ios_local_network_usage_missing", appConfig.ios?.infoPlist);
assert(appConfig.ios?.infoPlist?.NSMicrophoneUsageDescription, "ios_microphone_usage_missing", appConfig.ios?.infoPlist);
assert(appConfig.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === true, "ios_ats_lan_http_not_allowed", appConfig.ios?.infoPlist?.NSAppTransportSecurity);
assert(appConfig.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === false, "ios_export_compliance_missing", appConfig.ios?.infoPlist);
const openclawIntentFilter = appConfig.android?.intentFilters?.find((filter) =>
  filter.action === "VIEW" &&
  filter.category?.includes("BROWSABLE") &&
  filter.category?.includes("DEFAULT") &&
  filter.data?.some((entry) => entry.scheme === "openclaw" && entry.host === "pair")
);
assert(openclawIntentFilter, "android_openclaw_pair_intent_filter_missing", appConfig.android?.intentFilters);
assert(appConfig.plugins?.some((plugin) => Array.isArray(plugin) ? plugin[0] === "./plugins/with-openclaw-android.js" : plugin === "./plugins/with-openclaw-android.js"), "android_cleartext_manifest_plugin_missing", appConfig.plugins);
assert(appConfig.extra?.openclaw?.distribution === "ios-simulator-first", "ios_first_distribution_missing", appConfig.extra);
assert(appConfig.extra?.openclaw?.androidFirst === false, "android_first_should_not_be_primary_now", appConfig.extra);
assert(appConfig.extra?.openclaw?.iosFirst === true, "ios_first_extra_missing", appConfig.extra);
assert(appConfig.extra?.openclaw?.iosTestFlight === true, "ios_testflight_should_be_enabled", appConfig.extra);
assert(String(appConfig.extra?.openclaw?.targetDevice || "").includes("iPhone 11"), "iphone11_target_device_missing", appConfig.extra);
assert(String(appConfig.extra?.openclaw?.targetOsVersion || "").includes("HarmonyOS 4.2.0.210"), "mate60_followup_os_target_missing", appConfig.extra);
assert(appConfig.extra?.openclaw?.voiceRecordingNative === true, "voice_recording_native_extra_missing", appConfig.extra);
assert(/^https:\/\/.+\/openclaw-relay$/.test(appConfig.extra?.openclaw?.publicBrokerUrl || ""), "mobile_public_broker_url_missing", appConfig.extra?.openclaw);
assert(mobilePackage.dependencies?.["expo-audio"], "expo_audio_dependency_missing", mobilePackage.dependencies);
const expoAudioPlugin = appConfig.plugins?.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-audio");
assert(expoAudioPlugin?.[1]?.enableBackgroundRecording === true, "expo_audio_background_recording_must_be_enabled", expoAudioPlugin);
assert(todayScreen.includes("allowsBackgroundRecording: true"), "mobile_runtime_background_recording_mode_missing");

const mate60SafeMode = appConfig.extra?.openclaw?.mate60SafeMode === true;
const iosTestFlight = appConfig.extra?.openclaw?.iosTestFlight === true;
if (mate60SafeMode) {
  assert(appConfig.updates?.enabled === false, "mate60_safe_mode_requires_updates_disabled", appConfig.updates);
  assert(!mobilePackage.dependencies?.["expo-updates"], "mate60_safe_mode_must_not_include_expo_updates", mobilePackage.dependencies);
  assert(appConfig.newArchEnabled === false, "mate60_safe_mode_requires_new_arch_disabled", appConfig.newArchEnabled);
} else {
  assert(appConfig.runtimeVersion?.policy === "appVersion", "runtime_version_policy_invalid", appConfig.runtimeVersion);
  assert(appConfig.updates?.enabled === true, "eas_updates_not_enabled", appConfig.updates);
  assert(appConfig.updates?.url === `https://u.expo.dev/${appConfig.extra?.eas?.projectId}`, "eas_update_url_invalid", appConfig.updates);
  assert(mobilePackage.dependencies?.["expo-updates"], "expo_updates_dependency_missing", mobilePackage.dependencies);
}

const preview = easConfig.build?.preview;
assert(preview?.distribution === "internal", "preview_distribution_must_be_internal", preview);
assert(preview?.channel === "preview", "preview_channel_must_be_preview", preview);
assert(preview?.android?.buildType === "apk", "preview_android_build_type_must_be_apk", preview);
const testflight = easConfig.build?.testflight;
assert(testflight?.distribution === "store", "testflight_distribution_must_be_store", testflight);
assert(testflight?.channel === "preview", "testflight_channel_must_be_preview", testflight);
assert(testflight?.ios?.simulator === false, "testflight_must_target_real_ios_devices", testflight);
assert(easConfig.submit?.testflight?.ios, "testflight_submit_profile_missing", easConfig.submit);

assert(mobilePackage.scripts?.["android:preview"]?.includes("eas-cli"), "mobile_android_preview_script_missing", mobilePackage.scripts);
assert(mobilePackage.scripts?.["ios:testflight"]?.includes("eas-cli"), "mobile_ios_testflight_script_missing", mobilePackage.scripts);
assert(mobilePackage.scripts?.["ios:submit:testflight"]?.includes("eas-cli"), "mobile_ios_submit_script_missing", mobilePackage.scripts);
assert(rootPackage.scripts?.["mobile:android:preview"], "root_android_preview_script_missing", rootPackage.scripts);
assert(rootPackage.scripts?.["mobile:ios:testflight"], "root_ios_testflight_script_missing", rootPackage.scripts);
assert(rootPackage.scripts?.["mobile:ios:submit:testflight"], "root_ios_submit_script_missing", rootPackage.scripts);
assert(rootPackage.scripts?.["test:mobile-release"], "root_mobile_release_test_missing", rootPackage.scripts);
assert(todayScreen.includes("连接 Mac，马上记今天"), "mobile_cn_pairing_hero_missing");
assert(todayScreen.includes("扫码打不开"), "mobile_cn_pairing_recovery_missing");
const todayPriorityLabels = ["待办优先", "知识录入", "知识查询"];
for (const label of todayPriorityLabels) {
  assert(todayScreen.includes(label), "mobile_cn_today_priority_missing", { label });
}
const todoPriorityIndex = todayScreen.indexOf("待办优先");
const knowledgeInputIndex = todayScreen.indexOf("知识录入");
const knowledgeQueryIndex = todayScreen.indexOf("知识查询");
assert(
  todoPriorityIndex >= 0 &&
    knowledgeInputIndex > todoPriorityIndex &&
    knowledgeQueryIndex > knowledgeInputIndex,
  "mobile_cn_today_priority_order_invalid",
  { todoPriorityIndex, knowledgeInputIndex, knowledgeQueryIndex }
);
assert(todayScreen.includes("Mac 是唯一数据真相源"), "mobile_cn_sync_boundary_missing");
assert(todayScreen.includes("语音转文字后发送"), "mobile_voice_chat_heading_missing");
assert(todayScreen.includes("转写到输入框"), "mobile_voice_chat_transcribe_action_missing");
assert(deviceScreen.includes("中文交互验收"), "mobile_cn_device_acceptance_missing");
assert(!todayScreen.includes("OpenClaw Mobile has stopped"), "mobile_crash_copy_should_not_leak_to_ui");
assert(mobileStorage.includes("loadOrCreateMobileDeviceId"), "mobile_stable_device_id_storage_missing");
assert(mobileApi.includes("deviceId: await loadOrCreateMobileDeviceId()"), "mobile_pairing_claim_device_id_missing");
assert(mobileApi.includes("isLocalWorkbenchHost") && mobileApi.includes("parsed.protocol === \"https:\""), "mobile_lan_https_normalization_missing");
assert(todayScreen.includes("publicBrokerUrl") && todayScreen.includes("CloudBase 公网中转"), "mobile_pairing_public_broker_ui_missing");
assert(serverConfig.includes("CLOUDBASE_BROKER_URL") && serverConfig.includes("CLOUDBASE_ENABLED"), "server_cloudbase_config_missing");
assert(serverIndex.includes("CloudbaseForwarder") && serverIndex.includes("publishPairCodeToBroker"), "server_cloudbase_forwarder_missing");
assert(desktopRunner.includes("OPENCLAW_CB_ENABLED") && desktopRunner.includes("OPENCLAW_MOBILE_PUBLIC_URL"), "desktop_cloudbase_env_missing");

console.log(JSON.stringify({
  ok: true,
  androidPackage: appConfig.android.package,
  version: appConfig.version,
  versionCode: appConfig.android.versionCode,
  androidDistribution: preview.distribution,
  androidBuildType: preview.android.buildType,
  iosDistribution: testflight.distribution,
  updateChannel: testflight.channel,
  syncModel: appConfig.extra.openclaw.syncModel,
  androidFirst: appConfig.extra.openclaw.androidFirst,
  iosFirst: appConfig.extra.openclaw.iosFirst,
  mate60SafeMode,
  iosTestFlight,
  iosBundleIdentifier: appConfig.ios.bundleIdentifier,
  iosBuildNumber: appConfig.ios.buildNumber,
  voiceRecordingNative: appConfig.extra.openclaw.voiceRecordingNative,
}, null, 2));
