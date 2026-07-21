import fs from "node:fs";

const relayPath = "/Users/njx/openclaw/cloudbase/openclaw-relay/openclaw-relay/index.js";
const source = fs.readFileSync(relayPath, "utf8");
let next = source;

function replaceOnce(label, from, to) {
  if (!next.includes(from)) throw new Error(`patch_anchor_missing:${label}`);
  next = next.replace(from, to);
}

replaceOnce(
  "legacy_claim_missing_device",
  `async function handlePairClaim(event) {
  const { code, deviceId, platform, deviceName } = parseBody(event);
  if (!code || !deviceId) return bad('MISSING_CODE_OR_DEVICE');
  const { db } = await getApp();`,
  `async function handlePairClaim(event) {
  const body = parseBody(event);
  const { code, platform, deviceName } = body;
  const deviceId = body.deviceId || randId('ocm_legacy', 8);
  if (!code) return bad('MISSING_CODE');
  const { db } = await getApp();`,
);

replaceOnce(
  "device_upsert_doc_set",
  `  // 写/更新 device 记录
  await db.collection('broker_devices').where({ deviceId }).update({
    deviceId, macId, platform: platform || 'unknown', deviceName: deviceName || null,
    lastSeenAt: now(),
  }, { upsert: true });`,
  `  // 写/更新 device 记录。where().update() 不支持 upsert，旧 APK 又不会传 deviceId；
  // 用 deviceId 做 doc id，确保外网配对设备可追溯。
  await db.collection('broker_devices').doc(deviceId).set({
    deviceId, macId, platform: platform || 'unknown', deviceName: deviceName || null,
    lastSeenAt: now(),
    createdAt: now(),
  });`,
);

if (next === source) throw new Error("no_changes_applied");

const backupPath = `${relayPath}.backup-legacy-device-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.copyFileSync(relayPath, backupPath);
fs.writeFileSync(relayPath, next, "utf8");

console.log(JSON.stringify({
  ok: true,
  relayPath,
  backupPath,
  changed: [
    "pair claim accepts legacy APK without deviceId",
    "broker_devices uses doc(deviceId).set instead of unsupported where upsert",
  ],
}, null, 2));
