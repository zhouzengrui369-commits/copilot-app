import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  artifactSet,
  findExecutable,
  screenshotManifest,
  walk,
} from './io.mjs';

async function temporaryRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test('macOS application bundles are atomic artifacts rather than recursive helper candidates', async () => {
  const root = await temporaryRoot('r30-app-bundle-');
  try {
    const app = path.join(root, 'Copilot.app');
    const executable = path.join(app, 'Contents/MacOS/Copilot');
    const helper = path.join(
      app,
      'Contents/Frameworks/Copilot Helper.app/Contents/MacOS/Copilot Helper',
    );
    await mkdir(path.dirname(executable), { recursive: true });
    await mkdir(path.dirname(helper), { recursive: true });
    await writeFile(executable, 'main executable');
    await writeFile(helper, 'nested helper executable');
    await writeFile(path.join(root, 'Copilot-arm64.zip'), 'zip');
    await writeFile(path.join(root, 'Copilot-arm64.dmg'), 'dmg');

    const entries = await walk(root);
    const apps = entries.filter(({ entry }) => entry.isDirectory() && entry.name.endsWith('.app'));
    assert.deepEqual(apps.map(({ absolute }) => absolute), [app]);

    const artifacts = await artifactSet(root);
    assert.equal(artifacts.appPath, app);
    assert.equal(artifacts.executablePath, executable);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('candidate tooling resolves an absolute executable from the reviewed PATH', async () => {
  const root = await temporaryRoot('r30-tool-');
  const originalPath = process.env.PATH;
  try {
    const executable = path.join(root, 'candidate-tool');
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o755);
    process.env.PATH = root;
    assert.equal(await findExecutable('candidate-tool'), executable);
  } finally {
    process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  }
});

test('screenshots are required and hashed as Gate 12 final-receipt evidence', async () => {
  const evidence = await temporaryRoot('r30-screenshots-');
  try {
    await assert.rejects(
      () => screenshotManifest(evidence),
      (error) => error?.code === 'BLOCKED_GATE_12_SCREENSHOTS_MISSING' && error?.gate === 12,
    );
    const screenshot = path.join(evidence, 'screenshots/full/final.png');
    await mkdir(path.dirname(screenshot), { recursive: true });
    await writeFile(screenshot, 'synthetic png evidence');
    const manifest = await screenshotManifest(evidence);
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].path, 'screenshots/full/final.png');
    assert.match(manifest[0].sha256, /^[0-9a-f]{64}$/u);
  } finally {
    await rm(evidence, { recursive: true, force: true });
  }
});
