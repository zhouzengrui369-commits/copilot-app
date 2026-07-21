import fs from "node:fs";
import path from "node:path";

const relayPath = "/Users/njx/openclaw/cloudbase/openclaw-relay/openclaw-relay/index.js";
const source = fs.readFileSync(relayPath, "utf8");
let next = source;

function replaceOnce(label, from, to) {
  if (!next.includes(from)) {
    throw new Error(`patch_anchor_missing:${label}`);
  }
  next = next.replace(from, to);
}

replaceOnce(
  "pair_start_accepts_mac_id",
  `  'POST /pair/start': async (event) => {
    const { macHint } = parseBody(event);
    const code = genPairCode();
    const expiresAt = now() + 15 * 60 * 1000;
    const { db } = await getApp();
    const res = await db.collection('broker_pair_codes').add({
      code,
      expiresAt,
      used: false,
      macHint: macHint || null,
      createdAt: now(),
    });
    return json({ ok: true, code, expiresAt, _id: res.id });
  },`,
  `  'POST /pair/start': async (event) => {
    const { macId, macHint } = parseBody(event);
    const code = genPairCode();
    const expiresAt = now() + 15 * 60 * 1000;
    const { db } = await getApp();
    const res = await db.collection('broker_pair_codes').add({
      code,
      expiresAt,
      used: false,
      macId: macId || null,
      macHint: macHint || null,
      createdAt: now(),
    });
    return json({ ok: true, code, expiresAt, _id: res.id });
  },`,
);

replaceOnce(
  "claim_response_mobile_contract",
  `  return json({
    ok: true,
    accessToken,
    refreshToken,
    macId,
    deviceId,
    brokerUrl: process.env.BROKER_PUBLIC_URL || null,
  });`,
  `  const responseNow = now();
  return json({
    ok: true,
    accessToken,
    accessExpiresAt: new Date(responseNow + 12 * 60 * 60 * 1000).toISOString(),
    refreshToken,
    refreshExpiresAt: new Date(responseNow + 90 * 24 * 60 * 60 * 1000).toISOString(),
    macId,
    deviceId,
    device: {
      id: deviceId,
      name: deviceName || 'OpenClaw 设备',
      platform: platform || 'unknown',
      appVersion: '',
      status: 'active',
      createdAt: new Date(responseNow).toISOString(),
      lastSeenAt: new Date(responseNow).toISOString(),
      revokedAt: null,
    },
    brokerUrl: process.env.BROKER_PUBLIC_URL || null,
  });`,
);

replaceOnce(
  "proxy_preserves_request_body",
  `  const { body: reqBody } = parseBody(event);`,
  `  const reqBody = parseBody(event);`,
);

if (next === source) {
  throw new Error("no_changes_applied");
}

const backupPath = `${relayPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.copyFileSync(relayPath, backupPath);
fs.writeFileSync(relayPath, next, "utf8");

console.log(JSON.stringify({
  ok: true,
  relayPath,
  backupPath,
  changed: [
    "pair/start stores macId",
    "pair/claim returns mobile-compatible session fields",
    "proxy forwards original POST body",
  ],
}, null, 2));
