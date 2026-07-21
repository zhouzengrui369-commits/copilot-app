import fs from "node:fs";

const relayPath = "/Users/njx/openclaw/cloudbase/openclaw-relay/openclaw-relay/index.js";
const source = fs.readFileSync(relayPath, "utf8");
let next = source;

function replaceOnce(label, from, to) {
  if (!next.includes(from)) throw new Error(`patch_anchor_missing:${label}`);
  next = next.replace(from, to);
}

replaceOnce(
  "force_json_content_type",
  `  if (hasJsonBody && !Object.keys(reqHeaders).some(k => k.toLowerCase() === 'content-type')) {
    // CloudBase HTTP triggers do not always preserve Content-Type on proxied POSTs.
    // Mac Fastify rejects JSON bodies without this header as 415 Unsupported Media Type.
    reqHeaders['Content-Type'] = 'application/json';
  }`,
  `  if (hasJsonBody) {
    // CloudBase HTTP triggers may strip Content-Type or rewrite it to text/plain.
    // Mac Fastify rejects JSON bodies unless the final forwarded header is JSON.
    for (const key of Object.keys(reqHeaders)) {
      if (key.toLowerCase() === 'content-type') delete reqHeaders[key];
    }
    reqHeaders['Content-Type'] = 'application/json';
  }`,
);

if (next === source) throw new Error("no_changes_applied");

const backupPath = `${relayPath}.backup-force-json-content-type-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.copyFileSync(relayPath, backupPath);
fs.writeFileSync(relayPath, next, "utf8");

console.log(JSON.stringify({
  ok: true,
  relayPath,
  backupPath,
  changed: [
    "proxy overwrites any incoming content-type with application/json for JSON body requests",
  ],
}, null, 2));
