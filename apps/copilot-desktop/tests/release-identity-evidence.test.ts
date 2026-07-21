// @vitest-environment node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPackage } from '@electron/asar';
// @ts-expect-error Plain Node ESM release helper.
import { assertCanonicalMacWorkDirectoriesAbsent, assertPrivateEvidenceAbsent, buildArtifactIdentityRecord, canonicalReleaseIdentity, cleanupCanonicalMacWorkDirectories, evaluateArtifactIdentityEvidence, inspectExtractedReleaseIdentity, inspectStableFinalArtifact, inspectWindowsArtifactReleaseIdentity, publishArtifactIdentityRecordCrashSafe, verifyFinalArtifactForIdentity } from '../scripts/release-identity-evidence.mjs';

const roots: string[] = [];
const repoRoot = existsSync(path.join(process.cwd(), 'apps/copilot-desktop'))
  ? process.cwd()
  : path.resolve(process.cwd(), '../..');
const candidate = 'v6.2-phase1-candidate-r13';
const sourceHead = 'a'.repeat(40);
const sourceSnapshotSha256 = 'b'.repeat(64);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function identity() {
  return { schemaVersion: 1, candidate, sourceHead, sourceSnapshotSha256 };
}

function artifact(platform: 'darwin' | 'win32', arch: 'arm64' | 'x64', kind: string) {
  const extension = platform === 'darwin' ? (kind === 'macOS DMG' ? 'dmg' : 'zip') : 'exe';
  const suffix = platform === 'darwin'
    ? `${arch}-${kind === 'macOS DMG' ? 'dmg' : 'zip'}`
    : `${arch}-${kind === 'Windows NSIS' ? 'setup' : 'portable'}`;
  const bytes = Buffer.from(`artifact-${suffix}`);
  const relativePath = platform === 'darwin'
    ? `artifacts/njx-copilot-v6-0.1.0-mac-${arch}.${extension}`
    : `artifacts/njx-copilot-v6-0.1.0-win-${arch}-${kind === 'Windows NSIS' ? 'setup' : 'portable'}.exe`;
  return {
    relativePath,
    platform,
    arch,
    kind,
    sha256: sha256(bytes),
    bytes: bytes.length,
    signing: 'verified',
    signature: platform === 'win32' ? {
      provenance: 'canonical-windows-cryptographic-verifier',
      certificateTrustPolicy: 'windows-attested',
      windowsTrustAttestation: {
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----\n',
        publicKeySha256: 'c'.repeat(64),
        runnerId: 'windows-release-runner-01',
      },
    } : {},
  };
}

function matrixArtifacts() {
  return [
    artifact('darwin', 'arm64', 'macOS ZIP'),
    artifact('darwin', 'arm64', 'macOS DMG'),
    artifact('darwin', 'x64', 'macOS ZIP'),
    artifact('darwin', 'x64', 'macOS DMG'),
    artifact('win32', 'x64', 'Windows NSIS'),
    artifact('win32', 'x64', 'Windows Portable'),
    artifact('win32', 'arm64', 'Windows NSIS'),
    artifact('win32', 'arm64', 'Windows Portable'),
  ];
}

async function createCandidate(mode: 'distribution' | 'macos-distribution' = 'distribution') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-evidence-'));
  roots.push(root);
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  await mkdir(path.join(root, 'evidence/artifact-identity'), { recursive: true });
  const canonical = canonicalReleaseIdentity(identity());
  await writeFile(path.join(root, 'RELEASE-IDENTITY.json'), canonical.bytes);
  const artifacts: any[] = mode === 'macos-distribution'
    ? matrixArtifacts().filter((item) => item.platform === 'darwin')
    : matrixArtifacts();
  for (const item of artifacts) {
    const absolute = path.join(root, item.relativePath);
    await writeFile(absolute, Buffer.from(`artifact-${item.relativePath.match(/copilot-(.*)\./)?.[1]}`));
    const actual = await readFile(absolute);
    item.bytes = actual.length;
    item.sha256 = sha256(actual);
    const record = buildArtifactIdentityRecord({
      candidate,
      sourceHead,
      sourceSnapshotSha256,
      artifact: item,
      canonicalIdentity: canonical,
      inspection: {
        asarRelativePath: item.platform === 'darwin'
          ? 'Contents/Resources/app.asar'
          : 'resources/app.asar',
        asarSha256: 'd'.repeat(64),
        asarBytes: 123,
        identityRelativePath: 'dist/main/release-identity.json',
        identitySha256: canonical.sha256,
        identityBytes: canonical.bytes.length,
        privacyScan: {
          status: 'PASS',
          scope: 'complete-extracted-root-and-app-asar',
          contentBased: true,
          symlinks: 'fail-closed',
        },
      },
    });
    const reportRelativePath = `evidence/artifact-identity/${path.basename(item.relativePath)}.json`;
    const published = await publishArtifactIdentityRecordCrashSafe({
      target: path.join(root, reportRelativePath),
      record,
    });
    Object.assign(item, {
      releaseIdentityVerification: {
        reportRelativePath,
        reportSha256: published.sha256,
      },
    });
  }
  const manifest = {
    schemaVersion: 2,
    releaseMode: mode,
    signingProfile: { mode },
    candidate,
    source: { head: sourceHead, snapshot: { sha256: sourceSnapshotSha256 } },
    releaseIdentity: {
      schemaVersion: 1,
      packagedRelativePath: 'dist/main/release-identity.json',
      evidenceRelativePath: 'RELEASE-IDENTITY.json',
      sha256: canonical.sha256,
      bytes: canonical.bytes.length,
    },
    artifacts,
    postPackageGates: {
      gates: [{
        id: 'signingNotarization',
        status: 'PASS',
        metrics: mode === 'macos-distribution'
          ? { macosNotarization: 'accepted', verifiedReports: 4, platforms: ['darwin'] }
          : { windowsSignature: 'verified', verifiedReports: 8, platforms: ['darwin', 'win32'] },
      }],
    },
  };
  return { root, manifest, canonical };
}

describe('canonical release identity bytes and final archive extraction', () => {
  it('rejects outer artifact replacement during same-handle double hashing and before record publication', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-outer-race-'));
    roots.push(root);
    const target = path.join(root, 'artifact.zip');
    await writeFile(target, 'original-artifact');
    await expect(inspectStableFinalArtifact(target, {
      hooks: {
        afterFirstHash: async () => {
          await rename(target, `${target}.old`);
          await writeFile(target, 'replacement-artifact');
        },
      },
    })).rejects.toMatchObject({ code: 'BLOCKED_ARTIFACT_IDENTITY' });

    await rm(target);
    await rename(`${target}.old`, target);
    let published = false;
    await expect(verifyFinalArtifactForIdentity({
      filePath: target,
      inspectExtracted: async () => ({ identity: 'checked' }),
      publishRecord: async () => { published = true; },
      hooks: {
        beforeRecord: async () => {
          await rename(target, `${target}.verified`);
          await writeFile(target, 'replacement-before-record');
        },
      },
    })).rejects.toMatchObject({ code: 'BLOCKED_ARTIFACT_IDENTITY' });
    expect(published).toBe(false);
  });

  it('unpacks only a private 0700/0400 snapshot copied from the stable outer handle and detects swap-inspect-restore', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-private-snapshot-'));
    roots.push(root);
    const target = path.join(root, 'artifact.zip');
    await writeFile(target, 'stable-final-artifact');
    let snapshotSeen = '';
    let published = false;
    await expect(verifyFinalArtifactForIdentity({
      filePath: target,
      hooks: {
        afterSnapshotCreated: async ({ root: privateRoot, snapshotPath }: any) => {
          expect((await stat(privateRoot)).mode & 0o777).toBe(0o700);
          expect((await stat(snapshotPath)).mode & 0o777).toBe(0o400);
          expect(await readFile(snapshotPath, 'utf8')).toBe('stable-final-artifact');
        },
      },
      inspectExtracted: async ({ snapshotPath }: any) => {
        snapshotSeen = snapshotPath;
        expect(snapshotPath).not.toBe(target);
        expect(await readFile(snapshotPath, 'utf8')).toBe('stable-final-artifact');
        await rename(target, `${target}.original`);
        await writeFile(target, 'swap-during-inspection');
        await rm(target);
        await rename(`${target}.original`, target);
        return { identity: 'snapshot-checked' };
      },
      publishRecord: async () => { published = true; },
    })).rejects.toMatchObject({ code: 'BLOCKED_ARTIFACT_IDENTITY' });
    expect(snapshotSeen).not.toBe('');
    expect(published).toBe(false);
  });

  it('detects private reportType in long-whitespace text and large app.asar entries, and blocks undecidable over-budget text', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-stream-scan-'));
    roots.push(root);
    await writeFile(
      path.join(root, 'renamed.log'),
      `prefix text \"reportType\"${' '.repeat(256 * 1024)}: ${' '.repeat(256 * 1024)}\"north-star-private-rag\" suffix`,
    );
    await expect(assertPrivateEvidenceAbsent(root)).rejects.toMatchObject({
      code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
    });

    const overBudget = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-stream-budget-'));
    roots.push(overBudget);
    await writeFile(path.join(overBudget, 'large.txt'), `safe text ${'x'.repeat(33 * 1024 * 1024)}`);
    await expect(assertPrivateEvidenceAbsent(overBudget)).rejects.toMatchObject({
      code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
    });

    const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-large-asar-'));
    roots.push(archiveRoot);
    const source = path.join(archiveRoot, 'source');
    const app = path.join(archiveRoot, 'NJX Copilot.app');
    const canonical = canonicalReleaseIdentity(identity());
    await mkdir(path.join(source, 'dist/main'), { recursive: true });
    await mkdir(path.join(app, 'Contents/Resources'), { recursive: true });
    await writeFile(path.join(source, 'dist/main/release-identity.json'), canonical.bytes);
    await writeFile(
      path.join(source, 'large.payload'),
      `${'safe '.repeat(500 * 1024)} \"reportType\": \"north-star-private-owner-acceptance\"`,
    );
    await createPackage(source, path.join(app, 'Contents/Resources/app.asar'));
    await expect(inspectExtractedReleaseIdentity({
      root: archiveRoot,
      platform: 'darwin',
      canonicalIdentity: canonical,
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });
  });

  it('classifies opaque binary separately while still blocking genuine private text', async () => {
    const safeRoot = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-binary-scan-'));
    roots.push(safeRoot);
    const binary = Buffer.alloc(3 * 1024 * 1024, 0);
    binary[0] = 0x01;
    binary[1] = 0xff;
    binary[2] = 0x80;
    await writeFile(path.join(safeRoot, 'opaque.data'), binary);
    await expect(assertPrivateEvidenceAbsent(safeRoot)).resolves.toBeUndefined();

    await writeFile(
      path.join(safeRoot, 'real-leak.data'),
      `${'ordinary prefix '.repeat(160_000)}{"reportType":"north-star-private-rag"}\n`,
    );
    await expect(assertPrivateEvidenceAbsent(safeRoot)).rejects.toMatchObject({
      code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
    });
  });

  it('incrementally decodes escaped JSON and JSONL reportType keys and values across chunks', async () => {
    const cases = [
      `{"${'padding'.repeat(10_000)}":"safe","report\\u0054ype":"north-star-private\\u002Drag"}\n`,
      `${'x'.repeat((64 * 1024) - 10)}{"report\\u0054ype":"north-star-private-\\u0072ag"}\n`,
      `${'{"safe":true}\n'.repeat(6_000)}{"report\\u0054ype":"north-star-private\\u002dRAG"}\n`,
    ];
    for (const [index, suffix] of cases.entries()) {
      const root = await mkdtemp(path.join(os.tmpdir(), `copilot-identity-escaped-${index}-`));
      roots.push(root);
      await writeFile(path.join(root, 'large.jsonl'), `${' '.repeat(2 * 1024 * 1024)}${suffix}`);
      await expect(assertPrivateEvidenceAbsent(root)).rejects.toMatchObject({
        code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
      });
    }
  });

  it('streams app.asar entries larger than 16 MiB by offset and blocks private schema content', async () => {
    const makeArchive = async (name: string, payload: string | Buffer) => {
      const root = await mkdtemp(path.join(os.tmpdir(), `copilot-identity-asar-stream-${name}-`));
      roots.push(root);
      const source = path.join(root, 'source');
      const app = path.join(root, 'NJX Copilot.app');
      const canonical = canonicalReleaseIdentity(identity());
      await mkdir(path.join(source, 'dist/main'), { recursive: true });
      await mkdir(path.join(app, 'Contents/Resources'), { recursive: true });
      await writeFile(path.join(source, 'dist/main/release-identity.json'), canonical.bytes);
      await writeFile(path.join(source, 'large.payload'), payload);
      await createPackage(source, path.join(app, 'Contents/Resources/app.asar'));
      return { root, canonical };
    };

    const safeText = await makeArchive('safe-text', `safe public text\n${'x'.repeat(17 * 1024 * 1024)}`);
    await expect(inspectExtractedReleaseIdentity({
      root: safeText.root,
      platform: 'darwin',
      canonicalIdentity: safeText.canonical,
    })).resolves.toMatchObject({
      identitySha256: safeText.canonical.sha256,
      privacyScan: { status: 'PASS' },
    });

    const safeBinary = Buffer.alloc(17 * 1024 * 1024, 0);
    safeBinary[0] = 0xff;
    const binaryArchive = await makeArchive('safe-binary', safeBinary);
    await expect(inspectExtractedReleaseIdentity({
      root: binaryArchive.root,
      platform: 'darwin',
      canonicalIdentity: binaryArchive.canonical,
    })).resolves.toMatchObject({
      identitySha256: binaryArchive.canonical.sha256,
      privacyScan: { status: 'PASS' },
    });

    const privateArchive = await makeArchive(
      'private',
      `${'safe prefix '.repeat(1_600_000)}{"report\\u0054ype":"north-star-private-\\u0072ag"}\n`,
    );
    await expect(inspectExtractedReleaseIdentity({
      root: privateArchive.root,
      platform: 'darwin',
      canonicalIdentity: privateArchive.canonical,
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });
  }, 15_000);

  it('allows only builder-created source-snapshot dependency symlinks and never artifact symlinks', async () => {
    const candidateRoot = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-dependency-link-'));
    roots.push(candidateRoot);
    const snapshotRoot = path.join(candidateRoot, 'work/source-snapshot');
    await mkdir(path.join(snapshotRoot, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve(repoRoot, 'node_modules/vitest'),
      path.join(snapshotRoot, 'node_modules/vitest'),
    );
    await expect(assertPrivateEvidenceAbsent(candidateRoot)).resolves.toBeUndefined();

    await mkdir(path.join(candidateRoot, 'artifacts'), { recursive: true });
    await symlink(
      path.join(snapshotRoot, 'node_modules/vitest'),
      path.join(candidateRoot, 'artifacts/hidden-dependency'),
    );
    await expect(assertPrivateEvidenceAbsent(candidateRoot)).rejects.toMatchObject({
      code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
    });
  });

  it('allows only canonical relative macOS framework bundle links in an extracted darwin app', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-mac-framework-'));
    roots.push(root);
    const framework = path.join(
      root,
      'NJX Copilot.app/Contents/Frameworks/Squirrel.framework',
    );
    const version = path.join(framework, 'Versions/A');
    await mkdir(path.join(version, 'Resources'), { recursive: true });
    await mkdir(path.join(version, 'Headers'), { recursive: true });
    await mkdir(path.join(version, 'Libraries'), { recursive: true });
    await mkdir(path.join(version, 'Helpers'), { recursive: true });
    await writeFile(path.join(version, 'Resources/Info.plist'), 'safe public plist');
    await writeFile(path.join(version, 'Headers/Squirrel.h'), 'safe public header');
    await writeFile(path.join(version, 'Libraries/libSquirrel.dylib'), 'safe public library');
    await writeFile(path.join(version, 'Helpers/NJX Helper'), 'safe public helper');
    await writeFile(path.join(version, 'Squirrel'), 'safe public executable');
    await symlink('A', path.join(framework, 'Versions/Current'));
    await symlink('Versions/Current/Resources', path.join(framework, 'Resources'));
    await symlink('Versions/Current/Headers', path.join(framework, 'Headers'));
    await symlink('Versions/Current/Libraries', path.join(framework, 'Libraries'));
    await symlink('Versions/Current/Helpers', path.join(framework, 'Helpers'));
    await symlink('Versions/Current/Squirrel', path.join(framework, 'Squirrel'));

    await expect(assertPrivateEvidenceAbsent(root, {
      mode: 'extracted',
      platform: 'darwin',
    })).resolves.toBeUndefined();
    await expect(assertPrivateEvidenceAbsent(root)).rejects.toMatchObject({
      code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
    });
    await expect(assertPrivateEvidenceAbsent(root, {
      mode: 'extracted',
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });
    await expect(assertPrivateEvidenceAbsent(root, {
      mode: 'extracted',
      platform: 'win32',
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });
  });

  it('blocks noncanonical, escaping, substituted and extra extracted framework links', async () => {
    const makeFramework = async (name: string) => {
      const root = await mkdtemp(path.join(os.tmpdir(), `copilot-identity-mac-framework-${name}-`));
      roots.push(root);
      const framework = path.join(
        root,
        'NJX Copilot.app/Contents/Frameworks/Squirrel.framework',
      );
      await mkdir(path.join(framework, 'Versions/A/Resources'), { recursive: true });
      await writeFile(path.join(framework, 'Versions/A/Resources/Info.plist'), 'safe public plist');
      return { root, framework };
    };

    const escaping = await makeFramework('escaping');
    await symlink('A', path.join(escaping.framework, 'Versions/Current'));
    await symlink('../../outside', path.join(escaping.framework, 'Resources'));
    await expect(assertPrivateEvidenceAbsent(escaping.root, {
      mode: 'extracted',
      platform: 'darwin',
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });

    const absolute = await makeFramework('absolute');
    await symlink('A', path.join(absolute.framework, 'Versions/Current'));
    await symlink(
      path.join(absolute.framework, 'Versions/A/Resources'),
      path.join(absolute.framework, 'Resources'),
    );
    await expect(assertPrivateEvidenceAbsent(absolute.root, {
      mode: 'extracted',
      platform: 'darwin',
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });

    const doubled = await makeFramework('double-slash');
    await symlink('A', path.join(doubled.framework, 'Versions/Current'));
    await symlink('Versions//Current/Resources', path.join(doubled.framework, 'Resources'));
    await expect(assertPrivateEvidenceAbsent(doubled.root, {
      mode: 'extracted',
      platform: 'darwin',
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });

    const extra = await makeFramework('extra');
    await symlink('A', path.join(extra.framework, 'Versions/Current'));
    await symlink('Versions/Current/Resources', path.join(extra.framework, 'Resources'));
    await symlink('Versions/Current/Resources', path.join(extra.framework, 'Extra'));
    await expect(assertPrivateEvidenceAbsent(extra.root, {
      mode: 'extracted',
      platform: 'darwin',
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });

    const outside = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-mac-framework-outside-target-'));
    roots.push(outside);
    await mkdir(path.join(outside, 'Resources'), { recursive: true });
    await writeFile(path.join(outside, 'Resources/Info.plist'), 'safe public plist');
    const substituted = await makeFramework('substituted');
    await rm(path.join(substituted.framework, 'Versions/A'), { recursive: true });
    await symlink(outside, path.join(substituted.framework, 'Versions/Current'));
    await symlink('Versions/Current/Resources', path.join(substituted.framework, 'Resources'));
    await expect(assertPrivateEvidenceAbsent(substituted.root, {
      mode: 'extracted',
      platform: 'darwin',
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });

    const cyclic = await makeFramework('cyclic');
    await symlink('Current', path.join(cyclic.framework, 'Versions/Current'));
    await expect(assertPrivateEvidenceAbsent(cyclic.root, {
      mode: 'extracted',
      platform: 'darwin',
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });

    const privateTarget = await makeFramework('private-target');
    await writeFile(
      path.join(privateTarget.framework, 'Versions/A/Resources/private.json'),
      '{"reportType":"north-star-private-rag"}\n',
    );
    await symlink('A', path.join(privateTarget.framework, 'Versions/Current'));
    await symlink('Versions/Current/Resources', path.join(privateTarget.framework, 'Resources'));
    await expect(assertPrivateEvidenceAbsent(privateTarget.root, {
      mode: 'extracted',
      platform: 'darwin',
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });

    const appOutside = await makeFramework('app-outside');
    await symlink('A', path.join(appOutside.framework, 'Versions/Current'));
    await symlink('Versions/Current/Resources', path.join(appOutside.framework, 'Resources'));
    await symlink(
      path.join(appOutside.framework, 'Versions/A/Resources'),
      path.join(appOutside.root, 'NJX Copilot.app/Contents/ResourcesAlias'),
    );
    await expect(assertPrivateEvidenceAbsent(appOutside.root, {
      mode: 'extracted',
      platform: 'darwin',
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });
  });

  it('removes only canonical mac work roots and fails closed if cleanup or final absence checks fail', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-mac-work-cleanup-'));
    roots.push(root);
    const work = path.join(root, 'work');
    await mkdir(path.join(work, 'mac-arm64/app'), { recursive: true });
    await mkdir(path.join(work, 'mac-x64/app'), { recursive: true });
    await mkdir(path.join(work, 'source-snapshot'), { recursive: true });
    await mkdir(path.join(work, 'performance-provenance'), { recursive: true });
    await mkdir(path.join(root, 'artifacts'), { recursive: true });
    await mkdir(path.join(root, 'logs'), { recursive: true });
    await mkdir(path.join(root, 'evidence/artifact-identity'), { recursive: true });
    await writeFile(path.join(work, 'source-snapshot/keep.txt'), 'snapshot');
    await writeFile(path.join(work, 'performance-provenance/keep.json'), '{}\n');
    await writeFile(path.join(root, 'artifacts/keep.zip'), 'artifact');
    await writeFile(path.join(root, 'logs/keep.log'), 'log');
    await writeFile(path.join(root, 'evidence/artifact-identity/keep.json'), '{}\n');

    await cleanupCanonicalMacWorkDirectories(work);
    await expect(assertCanonicalMacWorkDirectoriesAbsent(work)).resolves.toBeUndefined();
    expect(await readFile(path.join(work, 'source-snapshot/keep.txt'), 'utf8')).toBe('snapshot');
    expect(await readFile(path.join(work, 'performance-provenance/keep.json'), 'utf8')).toBe('{}\n');
    expect(await readFile(path.join(root, 'artifacts/keep.zip'), 'utf8')).toBe('artifact');
    expect(await readFile(path.join(root, 'logs/keep.log'), 'utf8')).toBe('log');
    expect(await readFile(path.join(root, 'evidence/artifact-identity/keep.json'), 'utf8')).toBe('{}\n');

    await mkdir(path.join(work, 'mac-x64'), { recursive: true });
    await expect(assertCanonicalMacWorkDirectoriesAbsent(work)).rejects.toMatchObject({
      code: 'BLOCKED_MAC_WORK_CLEANUP',
    });
    await expect(cleanupCanonicalMacWorkDirectories(work, {
      hooks: { remove: async () => { throw new Error('fixture cleanup denied'); } },
    })).rejects.toMatchObject({ code: 'BLOCKED_MAC_WORK_CLEANUP' });
  });

  it('uses one stable byte representation and extracts byte-identical identity from exactly one app.asar', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-asar-'));
    roots.push(root);
    const source = path.join(root, 'source');
    const extractedRoot = path.join(root, 'unpacked');
    const extracted = path.join(extractedRoot, 'NJX Copilot.app');
    await mkdir(path.join(source, 'dist/main'), { recursive: true });
    await mkdir(path.join(extracted, 'Contents/Resources'), { recursive: true });
    const canonical = canonicalReleaseIdentity(identity());
    await writeFile(path.join(source, 'dist/main/release-identity.json'), canonical.bytes);
    await createPackage(source, path.join(extracted, 'Contents/Resources/app.asar'));

    const inspected = await inspectExtractedReleaseIdentity({
      root: extractedRoot,
      platform: 'darwin',
      canonicalIdentity: canonical,
    });
    expect(inspected).toMatchObject({
      asarRelativePath: 'NJX Copilot.app/Contents/Resources/app.asar',
      identityRelativePath: 'dist/main/release-identity.json',
      identitySha256: canonical.sha256,
      identityBytes: canonical.bytes.length,
    });
    expect(inspected.asarSha256).toMatch(/^[a-f0-9]{64}$/);

    await mkdir(path.join(extractedRoot, 'Sibling/Resources'), { recursive: true });
    await writeFile(path.join(extractedRoot, 'Sibling/Resources/app.asar'), 'duplicate');
    await expect(inspectExtractedReleaseIdentity({
      root: extractedRoot,
      platform: 'darwin',
      canonicalIdentity: canonical,
    })).rejects.toMatchObject({ code: 'BLOCKED_ARTIFACT_IDENTITY' });
  });

  it('copies app.asar into a private stable snapshot and rejects swap-metadata-restore', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-asar-snapshot-race-'));
    roots.push(root);
    const source = path.join(root, 'source');
    const extractedRoot = path.join(root, 'unpacked');
    const asarPath = path.join(extractedRoot, 'NJX Copilot.app/Contents/Resources/app.asar');
    await mkdir(path.join(source, 'dist/main'), { recursive: true });
    await mkdir(path.dirname(asarPath), { recursive: true });
    const canonical = canonicalReleaseIdentity(identity());
    await writeFile(path.join(source, 'dist/main/release-identity.json'), canonical.bytes);
    await createPackage(source, asarPath);

    let privateRoot = '';
    let snapshotPath = '';
    const original = await stat(asarPath);
    await expect(inspectExtractedReleaseIdentity({
      root: extractedRoot,
      platform: 'darwin',
      canonicalIdentity: canonical,
      hooks: {
        afterAsarSnapshotCreated: async (snapshot: any) => {
          privateRoot = snapshot.root;
          snapshotPath = snapshot.snapshotPath;
          expect(snapshot.sourcePath).toBe(asarPath);
          expect((await stat(snapshot.root)).mode & 0o777).toBe(0o700);
          expect((await stat(snapshot.snapshotPath)).mode & 0o777).toBe(0o400);
          const backup = `${asarPath}.stable`;
          await rename(asarPath, backup);
          await copyFile(snapshot.snapshotPath, asarPath);
          await utimes(asarPath, original.atime, original.mtime);
          await rm(asarPath);
          await rename(backup, asarPath);
          await utimes(asarPath, original.atime, original.mtime);
        },
      },
    } as any)).rejects.toMatchObject({ code: 'BLOCKED_ARTIFACT_IDENTITY' });
    expect(privateRoot).not.toBe('');
    expect(snapshotPath).not.toBe(asarPath);
    expect(existsSync(privateRoot)).toBe(false);
  });

  it('unconditionally expands Windows nested payloads and rejects a direct+nested app.asar duplicate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-windows-'));
    roots.push(root);
    const source = path.join(root, 'source');
    const direct = path.join(root, 'resources/app.asar');
    const nestedTemplate = path.join(root, 'nested-template.asar');
    const payload = path.join(root, 'app-64.7z');
    const canonical = canonicalReleaseIdentity(identity());
    await mkdir(path.join(source, 'dist/main'), { recursive: true });
    await mkdir(path.dirname(direct), { recursive: true });
    await writeFile(path.join(source, 'dist/main/release-identity.json'), canonical.bytes);
    await createPackage(source, direct);
    await copyFile(direct, nestedTemplate);
    await writeFile(payload, 'fixture-payload');
    let expansionCalls = 0;

    await expect(inspectWindowsArtifactReleaseIdentity({
      root,
      canonicalIdentity: canonical,
      expandPayload: async ({ destination }: { destination: string }) => {
        expansionCalls += 1;
        await mkdir(path.join(destination, 'resources'), { recursive: true });
        await copyFile(nestedTemplate, path.join(destination, 'resources/app.asar'));
      },
    })).rejects.toMatchObject({ code: 'BLOCKED_ARTIFACT_IDENTITY' });
    expect(expansionCalls).toBe(1);
  });

  it('accepts one nested Windows app.asar and enforces the expanded-byte budget', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-windows-nested-'));
    roots.push(root);
    const source = path.join(root, 'source');
    const nestedTemplate = path.join(root, 'nested-template.asar');
    const payload = path.join(root, 'app-64.7z');
    const canonical = canonicalReleaseIdentity(identity());
    await mkdir(path.join(source, 'dist/main'), { recursive: true });
    await writeFile(path.join(source, 'dist/main/release-identity.json'), canonical.bytes);
    await createPackage(source, nestedTemplate);
    await writeFile(payload, 'fixture-payload');

    const inspected = await inspectWindowsArtifactReleaseIdentity({
      root,
      canonicalIdentity: canonical,
      expandPayload: async ({ destination }: { destination: string }) => {
        await mkdir(path.join(destination, 'resources'), { recursive: true });
        await copyFile(nestedTemplate, path.join(destination, 'resources/app.asar'));
      },
    });
    expect(inspected.asarRelativePath).toMatch(/resources\/app\.asar$/);

    const budgetRoot = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-windows-budget-'));
    roots.push(budgetRoot);
    await writeFile(path.join(budgetRoot, 'payload.7z'), 'fixture-payload');
    await expect(inspectWindowsArtifactReleaseIdentity({
      root: budgetRoot,
      canonicalIdentity: canonical,
      limits: { maxExpandedBytes: 1 },
      expandPayload: async ({ destination }: { destination: string }) => {
        await writeFile(path.join(destination, 'oversized.bin'), 'xx');
      },
    })).rejects.toMatchObject({ code: 'BLOCKED_ARTIFACT_IDENTITY' });
  });

  it('rejects malformed, non-canonical or stale identity values', () => {
    expect(() => canonicalReleaseIdentity({ ...identity(), candidate: '../escape' }))
      .toThrow(/candidate/i);
    expect(() => canonicalReleaseIdentity({ ...identity(), sourceHead: 'dirty' }))
      .toThrow(/sourceHead/i);
    expect(() => canonicalReleaseIdentity({ ...identity(), extra: true }))
      .toThrow(/unknown/i);
  });

  it('detects private evidence by parsed content, rejects candidate symlinks, and scans extracted roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-private-scan-'));
    roots.push(root);
    await writeFile(path.join(root, 'renamed.dat'), `${JSON.stringify({
      schemaVersion: 1,
      reportType: 'north-star-private-rag',
      rows: [],
    })}\n`);
    await expect(assertPrivateEvidenceAbsent(root)).rejects.toMatchObject({
      code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
    });

    const linkedRoot = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-private-link-'));
    roots.push(linkedRoot);
    await writeFile(path.join(linkedRoot, 'real.txt'), 'safe');
    await symlink(path.join(linkedRoot, 'real.txt'), path.join(linkedRoot, 'alias.txt'));
    await expect(assertPrivateEvidenceAbsent(linkedRoot)).rejects.toMatchObject({
      code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
    });

    const candidateRoot = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-snapshot-link-'));
    roots.push(candidateRoot);
    const snapshotRoot = path.join(candidateRoot, 'work/source-snapshot');
    await mkdir(path.join(snapshotRoot, 'real'), { recursive: true });
    await writeFile(path.join(snapshotRoot, 'real/safe.json'), '{"reportType":"public-fixture"}\n');
    await symlink(path.join(snapshotRoot, 'real'), path.join(snapshotRoot, 'safe-link'));
    await expect(assertPrivateEvidenceAbsent(candidateRoot)).rejects.toMatchObject({
      code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
    });

    const external = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-snapshot-external-'));
    roots.push(external);
    await writeFile(path.join(external, 'hidden.dat'), `${JSON.stringify({
      schemaVersion: 1,
      reportType: 'north-star-private-ns2',
    })}\n`);
    await symlink(external, path.join(snapshotRoot, 'escaping-private'));
    await expect(assertPrivateEvidenceAbsent(candidateRoot)).rejects.toMatchObject({
      code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
    });

    const cycleCandidate = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-snapshot-cycle-'));
    roots.push(cycleCandidate);
    const cycleSnapshot = path.join(cycleCandidate, 'work/source-snapshot');
    await mkdir(path.join(cycleSnapshot, 'nested'), { recursive: true });
    await symlink(cycleSnapshot, path.join(cycleSnapshot, 'nested/back'));
    await expect(assertPrivateEvidenceAbsent(cycleCandidate)).rejects.toMatchObject({
      code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
    });

    const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'copilot-identity-private-archive-'));
    roots.push(archiveRoot);
    const source = path.join(archiveRoot, 'source');
    const app = path.join(archiveRoot, 'NJX Copilot.app');
    const canonical = canonicalReleaseIdentity(identity());
    await mkdir(path.join(source, 'dist/main'), { recursive: true });
    await mkdir(path.join(app, 'Contents/Resources'), { recursive: true });
    await writeFile(path.join(source, 'dist/main/release-identity.json'), canonical.bytes);
    await writeFile(path.join(source, 'renamed.payload'), `${JSON.stringify({
      schemaVersion: 1,
      reportType: 'north-star-private-telemetry',
    })}\n${JSON.stringify({ schemaVersion: 2, kind: 'startup' })}\n`);
    await createPackage(source, path.join(app, 'Contents/Resources/app.asar'));
    await expect(inspectExtractedReleaseIdentity({
      root: archiveRoot,
      platform: 'darwin',
      canonicalIdentity: canonical,
    })).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });
  });
});

describe('artifact identity evidence matrix', () => {
  it('publishes one mode-0600 immutable record per final artifact and validates all eight artifacts', async () => {
    const { root, manifest } = await createCandidate();
    const result = await evaluateArtifactIdentityEvidence({ candidateRoot: root, manifest });
    expect(result).toMatchObject({ status: 'PASS', verifiedArtifacts: 8, requiredArtifacts: 8 });
    const reference = manifest.artifacts[0].releaseIdentityVerification;
    const report = path.join(root, reference.reportRelativePath);
    expect((await stat(report)).mode & 0o777).toBe(0o600);
    await expect(publishArtifactIdentityRecordCrashSafe({
      target: report,
      record: JSON.parse(await readFile(report, 'utf8')),
    })).rejects.toThrow(/exists|overwrite/i);
  });

  it('accepts the exact four-artifact macOS distribution matrix without Windows trust evidence', async () => {
    const { root, manifest } = await createCandidate('macos-distribution');
    const result = await evaluateArtifactIdentityEvidence({ candidateRoot: root, manifest });
    expect(result).toMatchObject({ status: 'PASS', verifiedArtifacts: 4, requiredArtifacts: 4 });
    expect(result.blockers).not.toContainEqual(expect.objectContaining({
      code: 'BLOCKED_WINDOWS_AUTHENTICATED_TRUST',
    }));
  });

  it.each([
    ['missing artifact', async (_root: string, manifest: any) => {
      manifest.artifacts.pop();
    }, 'BLOCKED_ARTIFACT_MATRIX'],
    ['extra artifact', async (_root: string, manifest: any) => {
      manifest.artifacts.push({ ...manifest.artifacts[0] });
    }, 'BLOCKED_ARTIFACT_MATRIX'],
    ['mixed platform', async (_root: string, manifest: any) => {
      manifest.artifacts[0].platform = 'win32';
    }, 'BLOCKED_ARTIFACT_MATRIX'],
    ['duplicate matrix entry', async (_root: string, manifest: any) => {
      manifest.artifacts[1] = { ...manifest.artifacts[0] };
    }, 'BLOCKED_ARTIFACT_MATRIX'],
    ['wrong arch-kind-path tuple', async (_root: string, manifest: any) => {
      manifest.artifacts[0].relativePath = manifest.artifacts[0].relativePath.replace('arm64', 'universal');
    }, 'BLOCKED_ARTIFACT_MATRIX'],
    ['unknown release mode', async (_root: string, manifest: any) => {
      manifest.signingProfile.mode = 'macos';
    }, 'BLOCKED_ARTIFACT_MATRIX'],
    ['blocked signing and notarization gate', async (_root: string, manifest: any) => {
      manifest.postPackageGates.gates[0].status = 'BLOCKED';
    }, 'BLOCKED_ARTIFACT_IDENTITY'],
  ])('blocks macOS distribution %s', async (_label, mutate, code) => {
    const { root, manifest } = await createCandidate('macos-distribution');
    await mutate(root, manifest);
    const result = await evaluateArtifactIdentityEvidence({ candidateRoot: root, manifest });
    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toContainEqual(expect.objectContaining({ code }));
  });

  it.each([
    ['missing DMG', async (root: string, manifest: any) => {
      const removed = manifest.artifacts.find((item: any) => item.kind === 'macOS DMG');
      manifest.artifacts = manifest.artifacts.filter((item: any) => item !== removed);
      await rm(path.join(root, removed.releaseIdentityVerification.reportRelativePath));
    }, 'BLOCKED_ARTIFACT_MATRIX'],
    ['missing record', async (root: string, manifest: any) => {
      const ref = manifest.artifacts[0].releaseIdentityVerification;
      delete manifest.artifacts[0].releaseIdentityVerification;
      await rm(path.join(root, ref.reportRelativePath));
    }, 'BLOCKED_ARTIFACT_IDENTITY'],
    ['duplicate record', async (_root: string, manifest: any) => {
      manifest.artifacts[1].releaseIdentityVerification = {
        ...manifest.artifacts[0].releaseIdentityVerification,
      };
    }, 'BLOCKED_ARTIFACT_IDENTITY'],
    ['stale candidate', async (root: string, manifest: any) => {
      const ref = manifest.artifacts[0].releaseIdentityVerification;
      const file = path.join(root, ref.reportRelativePath);
      const record = JSON.parse(await readFile(file, 'utf8'));
      record.candidate = 'stale-candidate';
      await rm(file);
      await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
      ref.reportSha256 = sha256(await readFile(file));
    }, 'BLOCKED_ARTIFACT_IDENTITY'],
    ['wrong arch', async (_root: string, manifest: any) => {
      manifest.artifacts[0].arch = 'x64';
    }, 'BLOCKED_ARTIFACT_MATRIX'],
    ['inner identity mismatch', async (root: string, manifest: any) => {
      const ref = manifest.artifacts[0].releaseIdentityVerification;
      const file = path.join(root, ref.reportRelativePath);
      const record = JSON.parse(await readFile(file, 'utf8'));
      record.identity.sha256 = 'f'.repeat(64);
      await rm(file);
      await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
      ref.reportSha256 = sha256(await readFile(file));
    }, 'BLOCKED_ARTIFACT_IDENTITY'],
    ['missing extracted-root privacy scan binding', async (root: string, manifest: any) => {
      const ref = manifest.artifacts[0].releaseIdentityVerification;
      const file = path.join(root, ref.reportRelativePath);
      const record = JSON.parse(await readFile(file, 'utf8'));
      delete record.privacyScan;
      await rm(file);
      await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
      ref.reportSha256 = sha256(await readFile(file));
    }, 'BLOCKED_ARTIFACT_IDENTITY'],
    ['missing authenticated Windows trust', async (_root: string, manifest: any) => {
      manifest.postPackageGates.gates[0].status = 'BLOCKED';
    }, 'BLOCKED_WINDOWS_AUTHENTICATED_TRUST'],
  ])('blocks %s', async (_label, mutate, code) => {
    const { root, manifest } = await createCandidate();
    await mutate(root, manifest);
    const result = await evaluateArtifactIdentityEvidence({ candidateRoot: root, manifest });
    expect(result.status).toBe('BLOCKED');
    expect(result.blockers).toContainEqual(expect.objectContaining({ code }));
  });
});

describe('canonical pipeline integration', () => {
  it('records identity only from final extracted macOS and Windows archives and finalizer runs the fail-closed gate', async () => {
    const appRoot = existsSync(path.join(process.cwd(), 'apps/copilot-desktop'))
      ? path.join(process.cwd(), 'apps/copilot-desktop') : process.cwd();
    const build = await readFile(path.join(appRoot, 'scripts/build-canonical-release.mjs'), 'utf8');
    const finalizer = await readFile(path.join(appRoot, 'scripts/finalize-canonical-release.mjs'), 'utf8');
    expect(build).toContain('inspectExtractedReleaseIdentity');
    expect(build).toContain('inspectWindowsArtifactReleaseIdentity');
    expect(build).toContain('inventoryRoot = appPath');
    expect(build).toContain('await writeArtifactIdentityRecord(');
    expect(build.indexOf('await writeArtifactIdentityRecord(')).toBeGreaterThan(build.indexOf('await addArtifact('));
    expect(build).toContain('releaseIdentityVerification');
    expect(finalizer).toContain('evaluateArtifactIdentityEvidence');
    expect(finalizer).toContain('BLOCKED_ARTIFACT_MATRIX');
    expect(finalizer).toContain('BLOCKED_WINDOWS_AUTHENTICATED_TRUST');
    expect(build).toContain('verifyFinalArtifactForIdentity');
    expect(build.indexOf('await rename(zipWork, zipPath)')).toBeLessThan(
      build.indexOf('filePath: zipPath'),
    );
    expect(build).toContain('verifyMacZip(\n      snapshotPath');
    expect(build.indexOf('await rename(source, destination)')).toBeLessThan(
      build.indexOf('filePath: destination'),
    );
    expect(build).toContain('inspectNativeInsideWindowsArtifact(\n          snapshotPath');
    expect(finalizer).toContain('assertPrivateEvidenceAbsent');
    const macLoop = build.indexOf("for (const arch of ['arm64', 'x64'])");
    const workAppVerification = build.indexOf('await verifyMacWorkAppIdentity(buildOutput);');
    const finalZipVerification = build.indexOf('await verifyFinalArtifactForIdentity({', workAppVerification);
    const cleanup = build.indexOf('await cleanupCanonicalMacWorkDirectories(workDir);');
    expect(macLoop).toBeGreaterThan(-1);
    expect(workAppVerification).toBeGreaterThan(-1);
    expect(workAppVerification).toBeLessThan(finalZipVerification);
    expect(cleanup).toBeGreaterThan(macLoop);
    expect(build).toContain('await assertCanonicalMacWorkDirectoriesAbsent(workDir);');
    expect(cleanup).toBeLessThan(
      build.indexOf('await runArtifactIdentityGate();'),
    );
    expect(build.lastIndexOf('await assertCanonicalMacWorkDirectoriesAbsent(workDir);')).toBeLessThan(
      build.lastIndexOf("await atomicJson(path.join(outputRoot, 'CANONICAL-MANIFEST.json'), manifest);"),
    );
  });
});
