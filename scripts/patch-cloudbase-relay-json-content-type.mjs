import fs from "node:fs";

const relayPath = "/Users/njx/openclaw/cloudbase/openclaw-relay/openclaw-relay/index.js";
const source = fs.readFileSync(relayPath, "utf8");
let next = source;

function replaceOnce(label, from, to) {
  if (!next.includes(from)) throw new Error(`patch_anchor_missing:${label}`);
  next = next.replace(from, to);
}

replaceOnce(
  "proxy_json_content_type",
  `  // enqueue
  const requestId = randId('req', 12);
  const reqBody = parseBody(event);
  const { db } = await getApp();
  await db.collection('broker_requests').add({
    requestId, macId: auth.macId,
    method: getMethod(event),
    path: originalPath,
    body: reqBody && Object.keys(reqBody).length > 0 ? reqBody : null,
    headers: reqHeaders,
    status: 'pending',
    createdAt: now(),
    expiresAt: now() + 5 * 60 * 1000,
  });`,
  `  // enqueue
  const requestId = randId('req', 12);
  const reqBody = parseBody(event);
  const hasJsonBody = reqBody && Object.keys(reqBody).length > 0;
  if (hasJsonBody && !Object.keys(reqHeaders).some(k => k.toLowerCase() === 'content-type')) {
    // CloudBase HTTP triggers do not always preserve Content-Type on proxied POSTs.
    // Mac Fastify rejects JSON bodies without this header as 415 Unsupported Media Type.
    reqHeaders['Content-Type'] = 'application/json';
  }
  const { db } = await getApp();
  await db.collection('broker_requests').add({
    requestId, macId: auth.macId,
    method: getMethod(event),
    path: originalPath,
    body: hasJsonBody ? reqBody : null,
    headers: reqHeaders,
    status: 'pending',
    createdAt: now(),
    expiresAt: now() + 5 * 60 * 1000,
  });`,
);

if (next === source) throw new Error("no_changes_applied");

const backupPath = `${relayPath}.backup-json-content-type-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.copyFileSync(relayPath, backupPath);
fs.writeFileSync(relayPath, next, "utf8");

console.log(JSON.stringify({
  ok: true,
  relayPath,
  backupPath,
  changed: [
    "proxy adds Content-Type: application/json for JSON body requests",
  ],
}, null, 2));
