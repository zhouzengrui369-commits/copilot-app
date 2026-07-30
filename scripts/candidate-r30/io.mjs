import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, mkdir, open, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CandidateBlocked, block, offlineEnv, sandboxPlan } from './contract.mjs';

export const scriptPath = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(scriptPath), '../..');
export const desktopRoot = path.join(repoRoot, 'apps/copilot-desktop');

export async function privateFile(file, content, exclusive = true) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, content, { encoding: 'utf8', mode: 0o600, ...(exclusive ? { flag: 'wx' } : {}) });
}
export async function privateJson(file, value, exclusive = true) {
  await privateFile(file, `${JSON.stringify(value, null, 2)}\n`, exclusive);
}
function quote(value) {
  const text = String(value); return /^[A-Za-z0-9_./:=@+-]+$/u.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}
export function commandText(command, args) { return [command, ...args].map(quote).join(' '); }
export function direct(command, args, { cwd = repoRoot, env = process.env } = {}) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
}
export function git(args) {
  const result = direct('git', args);
  if ((result.status ?? 1) !== 0) block('BLOCKED_GIT_COMMAND_FAILED', 1, commandText('git', args), { stderr: result.stderr?.trim() });
  return result.stdout?.trimEnd() ?? '';
}
export async function findExecutable(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue; const candidate = path.join(directory, name);
    try { await access(candidate, fsConstants.X_OK); return candidate; } catch { /* continue */ }
  }
  block('BLOCKED_EXECUTABLE_NOT_FOUND', 0, name);
}
export async function recorded({ gate, name, command, args, evidenceDir, cwd = repoRoot, env = {}, allowFailure = false }) {
  const plan = sandboxPlan(command, args); const childEnv = offlineEnv({ ...process.env, ...env });
  const startedAt = new Date().toISOString(); const result = direct(plan.command, plan.args, { cwd, env: childEnv });
  const stem = `gate-${String(gate).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`;
  const receipt = { schemaVersion: 1, gate, name, authority: 'offline-only', command: commandText(plan.command, plan.args),
    cwd, startedAt, endedAt: new Date().toISOString(), exitCode: result.status ?? null, signal: result.signal ?? null };
  await privateFile(path.join(evidenceDir, 'logs', `${stem}.stdout.log`), result.stdout ?? '');
  await privateFile(path.join(evidenceDir, 'logs', `${stem}.stderr.log`), result.stderr ?? '');
  await privateJson(path.join(evidenceDir, 'commands', `${stem}.json`), receipt);
  if (!allowFailure && (result.status ?? 1) !== 0) block('BLOCKED_CANDIDATE_COMMAND_FAILED', gate, `${name} exit ${result.status ?? 'signal'}`, receipt);
  return { ...result, receipt };
}
export async function sha256File(file, { gate = 7, code = 'BLOCKED_IDENTITY_FILE_NOT_REGULAR' } = {}) {
  let handle;
  try {
    handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    block(code, gate, file, { code: error?.code ?? null });
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) block(code, gate, file);
    return createHash('sha256').update(await handle.readFile()).digest('hex');
  } finally {
    await handle.close();
  }
}
export async function sha256Path(target) {
  const stat = await lstat(target);
  if (stat.isFile()) return sha256File(target);
  if (stat.isSymbolicLink()) return createHash('sha256').update(`symlink\0${await readlink(target)}`).digest('hex');
  if (!stat.isDirectory()) block('BLOCKED_IDENTITY_PATH_INVALID', 7, target);
  const hash = createHash('sha256');
  async function visit(directory, relative = '') {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name); const child = path.posix.join(relative, entry.name); const childStat = await lstat(absolute);
      if (childStat.isDirectory()) { hash.update(`dir\0${child}\0`); await visit(absolute, child); }
      else if (childStat.isSymbolicLink()) hash.update(`symlink\0${child}\0${await readlink(absolute)}\0`);
      else if (childStat.isFile()) hash.update(`file\0${child}\0${childStat.size}\0${await sha256File(absolute)}\0`);
      else block('BLOCKED_IDENTITY_PATH_INVALID', 7, child);
    }
  }
  await visit(target); return hash.digest('hex');
}
export async function walk(root) {
  const result = [];
  async function visit(directory) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      result.push({ absolute, entry });
      // Treat macOS application bundles as atomic artifacts. Electron helper
      // applications live inside the main .app and must not be mistaken for
      // additional top-level candidates.
      if (entry.isDirectory() && !entry.name.endsWith('.app')) await visit(absolute);
    }
  }
  await visit(root); return result;
}
export async function artifactSet(output) {
  const entries = await walk(output);
  const one = (filter, label) => { const found = entries.filter(filter); if (found.length !== 1) block('BLOCKED_GATE_07_ARTIFACT_SET', 7, `${label}=${found.length}`); return found[0].absolute; };
  const zipPath = one(({ entry }) => entry.isFile() && entry.name.endsWith('-arm64.zip'), 'zip');
  const dmgPath = one(({ entry }) => entry.isFile() && entry.name.endsWith('-arm64.dmg'), 'dmg');
  const appPath = one(({ entry }) => entry.isDirectory() && entry.name.endsWith('.app'), 'app');
  const executables = (await readdir(path.join(appPath, 'Contents/MacOS'), { withFileTypes: true })).filter((entry) => entry.isFile() || entry.isSymbolicLink());
  if (executables.length !== 1) block('BLOCKED_GATE_07_EXECUTABLE_SET', 7, `count=${executables.length}`);
  return { zipPath, dmgPath, appPath, executablePath: path.join(appPath, 'Contents/MacOS', executables[0].name) };
}
export function e2eEnv({ candidateId, sourceSnapshotPath, artifacts, evidenceDir, profile }) {
  const root = path.join(evidenceDir, 'electron', profile);
  return { NODE_ENV: 'test', COPILOT_E2E: '1', COPILOT_E2E_MODE: 'release', COPILOT_E2E_SKIP_BUILD: '1',
    COPILOT_E2E_PROFILE: profile, COPILOT_E2E_MIN_TESTS: profile === 'full' ? '113' : '2',
    COPILOT_E2E_CANDIDATE_ID: candidateId, COPILOT_E2E_EXECUTABLE_PATH: artifacts.executablePath,
    COPILOT_E2E_ARTIFACT_PATH: artifacts.zipPath, COPILOT_E2E_SOURCE_SNAPSHOT_PATH: sourceSnapshotPath,
    COPILOT_E2E_PLAYWRIGHT_JSON_PATH: path.join(root, 'playwright-results.json'),
    COPILOT_E2E_EVIDENCE_PATH: path.join(root, 'electron-evidence.json'),
    COPILOT_E2E_PROCESS_EXIT_PATH: path.join(root, 'process-exit.json'),
    COPILOT_E2E_RUNTIME_IDENTITY_PATH: path.join(root, 'runtime-identity.json'),
    COPILOT_PROTOTYPE_SCREENSHOT_DIR: path.join(evidenceDir, 'screenshots', profile) };
}
export async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function screenshotManifest(evidenceDir) {
  const root = path.join(evidenceDir, 'screenshots'); let entries;
  try { entries = await walk(root); } catch (error) { if (error?.code === 'ENOENT') block('BLOCKED_GATE_12_SCREENSHOTS_MISSING', 12); throw error; }
  const result = [];
  for (const { absolute, entry } of entries) if (entry.isFile() && entry.name.endsWith('.png')) result.push({ path: path.relative(evidenceDir, absolute).split(path.sep).join('/'), sha256: await sha256File(absolute, { gate: 12 }) });
  if (!result.length) block('BLOCKED_GATE_12_SCREENSHOTS_MISSING', 12);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
export function asBlocked(error) {
  return error instanceof CandidateBlocked ? error : new CandidateBlocked('BLOCKED_R30_UNEXPECTED', 0, error instanceof Error ? error.message : String(error));
}
