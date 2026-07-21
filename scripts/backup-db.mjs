import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const db = path.join(root, "data/workbench.sqlite");
const backupDir = process.env.OPENCLAW_WORKBENCH_BACKUP_DIR || path.join(root, "data/backups");

if (!fs.existsSync(db)) {
  console.error(`Database not found: ${db}`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(backupDir, `workbench-${stamp}.sqlite`);
fs.copyFileSync(db, out);
const sha256 = createHash("sha256").update(fs.readFileSync(out)).digest("hex");
fs.writeFileSync(`${out}.sha256`, `${sha256}  ${path.basename(out)}\n`, "utf8");
console.log(`Backup written: ${out}`);
console.log(`SHA256: ${sha256}`);
