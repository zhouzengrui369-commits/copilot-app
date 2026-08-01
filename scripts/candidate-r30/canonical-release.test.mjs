import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_CANDIDATE_ALIAS,
  validateCanonicalManifestData,
} from './canonical-release.mjs';

const SOURCE = 'a'.repeat(40);
const SHA = 'b'.repeat(64);

function artifact(kind, relativePath) {
  return {
    relativePath,
    kind,
    platform: 'darwin',
    arch: 'arm64',
    bytes: 100,
    sha256: SHA,
    signing: 'unsigned',
  };
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 2,
    releaseMode: 'unsigned',
    candidate: CANONICAL_CANDIDATE_ALIAS,
    status: 'PARTIAL_BLOCKED',
    source: {
      head: SOURCE,
      dirty: false,
      snapshot: {
        fileCount: 2,
        sha256: SHA,
        relativeRoot: 'work/source-snapshot',
        immutableInputs: true,
        authoritativeInputs: {
          relativePath: 'work/source-snapshot-inputs.json',
          bytes: 200,
          sha256: SHA,
          fileCount: 2,
          aggregateSha256: SHA,
        },
      },
    },
    releaseIdentity: {
      evidenceRelativePath: 'RELEASE-IDENTITY.json',
      bytes: 200,
      sha256: SHA,
    },
    artifacts: [
      artifact('macOS ZIP', 'artifacts/app-arm64.zip'),
      artifact('macOS DMG', 'artifacts/app-arm64.dmg'),
    ],
    blockers: [
      { code: 'BLOCKED_UNSIGNED', platform: 'darwin', arch: 'arm64' },
      { code: 'BLOCKED_POST_PACKAGE_E2E' },
      { code: 'BLOCKED_WINDOWS_NATIVE_MODULE', arch: 'x64' },
    ],
    ...overrides,
  };
}

test('accepts only the bounded unsigned canonical source/artifact contract', () => {
  const selected = validateCanonicalManifestData(manifest(), SOURCE);
  assert.equal(selected.zip.kind, 'macOS ZIP');
  assert.equal(selected.dmg.kind, 'macOS DMG');
  assert.equal(selected.snapshot.sha256, SHA);
});

test('rejects source drift, unexpected blockers and missing arm64 DMG truth', () => {
  assert.throws(
    () => validateCanonicalManifestData(manifest({ source: { ...manifest().source, head: 'c'.repeat(40) } }), SOURCE),
    /BLOCKED_CANONICAL_MANIFEST/,
  );
  assert.throws(
    () => validateCanonicalManifestData(manifest({ blockers: [{ code: 'RELEASE_PIPELINE_FAILED' }] }), SOURCE),
    /BLOCKED_CANONICAL_UNEXPECTED_BLOCKER/,
  );
  assert.throws(
    () => validateCanonicalManifestData(manifest({ blockers: [{ code: 'BLOCKED_MAC_DMG_DEVICE', arch: 'arm64' }] }), SOURCE),
    /BLOCKED_CANONICAL_ARM64_DMG/,
  );
  assert.throws(
    () => validateCanonicalManifestData(manifest({ artifacts: [artifact('macOS ZIP', 'artifacts/app.zip')] }), SOURCE),
    /BLOCKED_CANONICAL_ARTIFACT_SET/,
  );
});

test('rejects path escape and noncanonical snapshot bindings', () => {
  const escaped = manifest();
  escaped.source.snapshot.relativeRoot = '../outside';
  assert.throws(() => validateCanonicalManifestData(escaped, SOURCE), /BLOCKED_CANONICAL_SNAPSHOT_PATH/);

  const mismatched = manifest();
  mismatched.source.snapshot.authoritativeInputs.aggregateSha256 = 'c'.repeat(64);
  assert.throws(() => validateCanonicalManifestData(mismatched, SOURCE), /BLOCKED_CANONICAL_SNAPSHOT_BINDING/);
});
