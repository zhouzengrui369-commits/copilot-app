import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const repoRoot = process.cwd();
const prodDataDir = process.env.OPENCLAW_PROD_DATA_DIR || "/Users/njx/openclaw_data/copilot/data";
const devDataDir = process.env.OPENCLAW_DEV_DATA_DIR || path.join(repoRoot, "data", "env", "dev", "data");
const prodDbPath = path.join(prodDataDir, "workbench.sqlite");
const devDbPath = path.join(devDataDir, "workbench.sqlite");
const tables = [
  { name: "projects", mode: "ignore" },
  { name: "knowledge_entries", mode: "ignore" },
  { name: "todos", mode: "replace" },
  { name: "calendar_notes", mode: "replace" },
  { name: "todo_sync_links", mode: "replace" },
  { name: "reports", mode: "replace" },
  { name: "plan_items", mode: "replace" },
];

function assertInsideDevDataDir(targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(devDataDir);
  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    throw new Error(`Refusing to write outside dev data dir: ${resolved}`);
  }
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name));
}

function quoteId(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function backupDevDatabase() {
  assertInsideDevDataDir(devDbPath);
  const backupDir = path.join(devDataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `workbench-dev-before-prod-seed-${stamp}.sqlite`);
  fs.copyFileSync(devDbPath, backupPath);
  return backupPath;
}

if (!fs.existsSync(prodDbPath)) throw new Error(`Production database not found: ${prodDbPath}`);
if (!fs.existsSync(devDbPath)) throw new Error(`Dev database not found: ${devDbPath}`);

const backupPath = backupDevDatabase();
const prod = new DatabaseSync(prodDbPath, { readOnly: true });
const dev = new DatabaseSync(devDbPath);
const summary = [];

try {
  dev.exec("BEGIN IMMEDIATE");
  for (const { name: table, mode } of [...tables].reverse()) {
    if (mode !== "replace") continue;
    if (tableExists(dev, table)) dev.prepare(`DELETE FROM ${quoteId(table)}`).run();
  }
  for (const { name: table, mode } of tables) {
    if (!tableExists(prod, table) || !tableExists(dev, table)) {
      summary.push({ table, skipped: true, reason: "missing_table" });
      continue;
    }
    const prodColumns = tableColumns(prod, table);
    const devColumns = tableColumns(dev, table);
    const columns = prodColumns.filter((column) => devColumns.includes(column));
    if (!columns.length) {
      summary.push({ table, skipped: true, reason: "no_common_columns" });
      continue;
    }
    const quoted = columns.map(quoteId).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const rows = prod.prepare(`SELECT ${quoted} FROM ${quoteId(table)}`).all();
    const insert = dev.prepare(`INSERT ${mode === "ignore" ? "OR IGNORE " : ""}INTO ${quoteId(table)} (${quoted}) VALUES (${placeholders})`);
    for (const [index, row] of rows.entries()) {
      try {
        insert.run(...columns.map((column) => row[column]));
      } catch (err) {
        throw new Error(`Failed to seed ${table} row ${index}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    summary.push({ table, mode, rows: rows.length, columns: columns.length });
  }
  dev.exec("COMMIT");
} catch (err) {
  try { dev.exec("ROLLBACK"); } catch {}
  throw err;
} finally {
  prod.close();
  dev.close();
}

console.log(JSON.stringify({ ok: true, prodDbPath, devDbPath, backupPath, summary }, null, 2));
