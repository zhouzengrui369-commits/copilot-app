import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const targets = [
  path.join(root, "apps/web/dist"),
  path.join(root, "apps/server/dist"),
];
const forbidden = [
  { pattern: /OPENCLAW_GATEWAY_TOKEN/i, allowEnvNameInServer: true },
  { pattern: /IMA_API_KEY/i, allowEnvNameInServer: true },
  { pattern: /IMA_OPENAPI_APIKEY/i, allowEnvNameInServer: true },
  { pattern: /\.openclaw\/credentials/i },
  { pattern: /gateway\.auth\.token/i },
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const hits = [];
for (const base of targets) {
  for (const file of walk(base)) {
    const text = fs.readFileSync(file, "utf8");
    for (const rule of forbidden) {
      rule.pattern.lastIndex = 0;
      if (!rule.pattern.test(text)) continue;
      if (rule.allowEnvNameInServer && isAllowedServerEnvNameReference(file, text, rule.pattern)) continue;
      hits.push(`${file}: ${rule.pattern}`);
    }
  }
}

if (hits.length) {
  console.error("Security scan failed:");
  for (const hit of hits) console.error(`- ${hit}`);
  process.exit(1);
}
console.log("Security scan passed.");

function isAllowedServerEnvNameReference(file, text, pattern) {
  const serverDist = `${path.sep}apps${path.sep}server${path.sep}dist${path.sep}`;
  if (!file.includes(serverDist)) return false;
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  return matches.every((match) => {
    const start = Math.max(0, (match.index || 0) - 60);
    const end = Math.min(text.length, (match.index || 0) + match[0].length + 60);
    const context = text.slice(start, end);
    return /process\.env\.[A-Z0-9_]+/.test(context)
      || /EnvironmentVariables\.[A-Z0-9_]+/.test(context)
      || /[,{]\s*[A-Z0-9_]+\s*:/.test(context);
  });
}
