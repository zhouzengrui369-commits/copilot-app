import fs from "node:fs";

const relayPath = "/Users/njx/openclaw/cloudbase/openclaw-relay/openclaw-relay/index.js";
const source = fs.readFileSync(relayPath, "utf8");
let next = source;

function replaceOnce(label, from, to) {
  if (!next.includes(from)) throw new Error(`patch_anchor_missing:${label}`);
  next = next.replace(from, to);
}

replaceOnce(
  "add_query_helpers",
  `function getMethod(event) {
  return (event.method || event.httpMethod || 'GET').toUpperCase();
}

// —— 业务路由 ——`,
  `function getMethod(event) {
  return (event.method || event.httpMethod || 'GET').toUpperCase();
}
function getQueryString(event) {
  const raw = event.rawQueryString || event.queryString || event.query_string || '';
  if (typeof raw === 'string' && raw.trim()) return raw.replace(/^\\?/, '');
  const params = event.queryStringParameters || event.query || {};
  if (!params || typeof params !== 'object') return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.set(key, String(value));
    }
  }
  return search.toString();
}
function withQuery(path, event) {
  const query = getQueryString(event);
  return query ? path + '?' + query : path;
}

// —— 业务路由 ——`,
);

replaceOnce(
  "proxy_uses_path_with_query",
  `      return await proxyToMac(event, path);`,
  `      return await proxyToMac(event, withQuery(path, event));`,
);

if (next === source) throw new Error("no_changes_applied");

const backupPath = `${relayPath}.backup-preserve-query-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.copyFileSync(relayPath, backupPath);
fs.writeFileSync(relayPath, next, "utf8");

console.log(JSON.stringify({
  ok: true,
  relayPath,
  backupPath,
  changed: [
    "proxy preserves raw query string / queryStringParameters when forwarding to Mac",
  ],
}, null, 2));
