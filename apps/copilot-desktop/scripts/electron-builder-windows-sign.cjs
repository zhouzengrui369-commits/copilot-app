'use strict';

const {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function electronBuilderWindowsSign(configuration) {
  signWindowsFile(configuration);
}

function signWindowsFile(configuration, {
  env = process.env,
  spawn = spawnSync,
} = {}) {
  const target = configuration?.path;
  const requestedHash = String(configuration?.hash ?? 'sha256').toLowerCase();
  const pfx = env.WIN_CSC_LINK;
  const password = env.WIN_CSC_KEY_PASSWORD;
  const timestampUrl = env.COPILOT_WINDOWS_TIMESTAMP_URL;
  const osslSigncode = env.COPILOT_WINDOWS_OSSLSIGNCODE;
  if (requestedHash !== 'sha256'
      || !absoluteRegularFile(target)
      || !absoluteRegularFile(pfx)
      || typeof password !== 'string'
      || password.length === 0
      || !validHttps(timestampUrl)
      || typeof osslSigncode !== 'string'
      || !path.isAbsolute(osslSigncode)) {
    throw blocked('Windows custom signing inputs are invalid');
  }

  const stagingRoot = mkdtempSync(path.join(path.dirname(target), '.copilot-windows-sign-'));
  chmodSync(stagingRoot, 0o700);
  const passwordPath = path.join(stagingRoot, 'password.txt');
  const signedPath = path.join(stagingRoot, 'signed.exe');
  let passwordHandle;
  let signedHandle;
  let directoryHandle;
  try {
    passwordHandle = openSync(
      passwordPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    writeFileSync(passwordHandle, password, { encoding: 'utf8' });
    fsyncSync(passwordHandle);
    closeSync(passwordHandle);
    passwordHandle = undefined;

    const args = [
      'sign',
      '-pkcs12', pfx,
      '-readpass', passwordPath,
      '-h', 'sha256',
      '-ts', timestampUrl,
      '-in', target,
      '-out', signedPath,
    ];
    const childEnvironment = { ...env };
    for (const key of [
      'WIN_CSC_LINK',
      'WIN_CSC_KEY_PASSWORD',
      'COPILOT_WINDOWS_TIMESTAMP_URL',
      'COPILOT_WINDOWS_OSSLSIGNCODE',
    ]) delete childEnvironment[key];
    const result = spawn(osslSigncode, args, {
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
      env: childEnvironment,
    });
    if (result?.status !== 0 || !absoluteRegularFile(signedPath)) {
      throw blocked('osslsigncode RFC3161 signing failed');
    }
    signedHandle = openSync(signedPath, constants.O_RDONLY);
    fsyncSync(signedHandle);
    closeSync(signedHandle);
    signedHandle = undefined;
    renameSync(signedPath, target);
    directoryHandle = openSync(path.dirname(target), constants.O_RDONLY);
    fsyncSync(directoryHandle);
    closeSync(directoryHandle);
    directoryHandle = undefined;
  } catch (error) {
    if (error?.code === 'BLOCKED_WINDOWS_SIGNING_FAILED') throw error;
    throw blocked('Windows custom signing failed closed');
  } finally {
    for (const handle of [passwordHandle, signedHandle, directoryHandle]) {
      if (Number.isInteger(handle)) {
        try { closeSync(handle); } catch { /* best-effort descriptor cleanup */ }
      }
    }
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function absoluteRegularFile(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return false;
  try {
    return lstatSync(value).isFile();
  } catch {
    return false;
  }
}

function validHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function blocked(message) {
  return Object.assign(
    new Error(`BLOCKED_WINDOWS_SIGNING_FAILED: ${message}`),
    { code: 'BLOCKED_WINDOWS_SIGNING_FAILED' },
  );
}

module.exports = electronBuilderWindowsSign;
module.exports.signWindowsFile = signWindowsFile;
