import fs from "node:fs";

const relayPath = "/Users/njx/openclaw/cloudbase/openclaw-relay/openclaw-relay/index.js";
const source = fs.readFileSync(relayPath, "utf8");
let next = source;

function replaceOnce(label, from, to) {
  if (!next.includes(from)) throw new Error(`patch_anchor_missing:${label}`);
  next = next.replace(from, to);
}

replaceOnce(
  "strip_content_type_without_body",
  `  if (hasJsonBody) {
    // CloudBase HTTP triggers may strip Content-Type or rewrite it to text/plain.
    // Mac Fastify rejects JSON bodies unless the final forwarded header is JSON.
    for (const key of Object.keys(reqHeaders)) {
      if (key.toLowerCase() === 'content-type') delete reqHeaders[key];
    }
    reqHeaders['Content-Type'] = 'application/json';
  }`,
  `  for (const key of Object.keys(reqHeaders)) {
    if (key.toLowerCase() === 'content-type') delete reqHeaders[key];
  }
  if (hasJsonBody) {
    // CloudBase HTTP triggers may strip Content-Type or rewrite it to text/plain.
    // Mac Fastify rejects JSON bodies unless the final forwarded header is JSON.
    reqHeaders['Content-Type'] = 'application/json';
  }`,
);

if (next === source) throw new Error("no_changes_applied");

const backupPath = `${relayPath}.backup-strip-empty-content-type-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.copyFileSync(relayPath, backupPath);
fs.writeFileSync(relayPath, next, "utf8");

console.log(JSON.stringify({
  ok: true,
  relayPath,
  backupPath,
  changed: [
    "proxy strips content-type when request body is empty",
  ],
}, null, 2));
