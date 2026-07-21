import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const home = os.homedir();
const maxFilesPerRoot = 200000;
const maxResults = 200;
const audioExts = new Set([".aac", ".m4a", ".mp3", ".wav", ".caf", ".opus", ".amr", ".flac", ".m4b"]);
const relatedName = /(yuanbao|元宝|tencent|hunyuan|hyllm|voice|audio|record|recording|speech|transcript|asr|录音|语音)/i;

function shanghaiDay(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const today = shanghaiDay(new Date());

const roots = [
  path.join(home, "Library", "Containers"),
  path.join(home, "Library", "Group Containers"),
  path.join(home, "Library", "Application Support"),
  path.join(home, "Library", "Caches"),
  path.join(home, "Library", "WebKit"),
  path.join(home, "Downloads"),
  path.join(home, "Documents"),
  path.join(home, "Desktop"),
  path.join(home, "Movies"),
  path.join(home, "Music"),
  path.join(home, "openclaw_data"),
].filter((item, index, arr) => item && arr.indexOf(item) === index);

const skipDirs = new Set([
  "node_modules",
  ".git",
  ".Trash",
  "DerivedData",
  "Caches/com.apple",
]);

function isTodayStat(stat) {
  return shanghaiDay(stat.mtime) === today || shanghaiDay(stat.birthtime) === today || shanghaiDay(stat.ctime) === today;
}

function shouldSkipDir(fullPath, name) {
  if (skipDirs.has(name)) return true;
  if (name.endsWith(".app")) return true;
  if (fullPath.includes("/node_modules/")) return true;
  if (fullPath.includes("/.git/")) return true;
  return false;
}

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function walk(root, onFile, onDir) {
  let seen = 0;
  const stack = [root];
  while (stack.length && seen < maxFilesPerRoot) {
    const dir = stack.pop();
    if (!dir || !fs.existsSync(dir)) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (shouldSkipDir(full, ent.name)) continue;
        onDir?.(full, ent.name);
        stack.push(full);
      } else if (ent.isFile()) {
        seen += 1;
        onFile(full, ent.name);
      }
      if (seen >= maxFilesPerRoot) break;
    }
  }
  return seen;
}

const audioToday = [];
const relatedDirs = [];
const relatedFilesToday = [];
const rootsSeen = [];

for (const root of roots) {
  const exists = fs.existsSync(root);
  const rootRecord = { root, exists, scannedFiles: 0 };
  rootsSeen.push(rootRecord);
  if (!exists) continue;
  rootRecord.scannedFiles = walk(
    root,
    (file, name) => {
      const stat = safeStat(file);
      if (!stat || !isTodayStat(stat)) return;
      const ext = path.extname(name).toLowerCase();
      if (audioExts.has(ext)) {
        audioToday.push({
          path: file,
          ext,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          birthtime: stat.birthtime.toISOString(),
          ctime: stat.ctime.toISOString(),
          relatedScore: relatedName.test(file) ? 1 : 0,
        });
      } else if (relatedName.test(file)) {
        relatedFilesToday.push({
          path: file,
          ext,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          birthtime: stat.birthtime.toISOString(),
          ctime: stat.ctime.toISOString(),
        });
      }
    },
    (dir, name) => {
      if (relatedDirs.length >= maxResults) return;
      if (relatedName.test(dir)) {
        const stat = safeStat(dir);
        relatedDirs.push({
          path: dir,
          mtime: stat?.mtime?.toISOString?.() || "",
        });
      }
    },
  );
}

audioToday.sort((a, b) => {
  if (b.relatedScore !== a.relatedScore) return b.relatedScore - a.relatedScore;
  return String(b.mtime).localeCompare(String(a.mtime));
});
relatedFilesToday.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));

console.log(JSON.stringify({
  ok: true,
  today,
  rootsSeen,
  audioTodayCount: audioToday.length,
  audioToday: audioToday.slice(0, maxResults),
  relatedDirsCount: relatedDirs.length,
  relatedDirs: relatedDirs.slice(0, maxResults),
  relatedFilesTodayCount: relatedFilesToday.length,
  relatedFilesToday: relatedFilesToday.slice(0, maxResults),
}, null, 2));
