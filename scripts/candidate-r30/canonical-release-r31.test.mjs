import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_CANDIDATE_ALIAS,
  validateArm64CanonicalManifestData,
} from './canonical-release-r31.mjs';

const SOURCE = 'a'.repeat(40);
const SHA = 'b'.repeat(64);

function artifact(kind, extension) {
  const relativePath = `artifacts/njx-copilot-v6-0.1.0-mac-arm64.${extension}`;
  return {
    relativePath,
    kind,
    platform: 'darwin',
    arch: 'arm64',
    bytes: 100,
    sha256: SHA,
    signing: 'unsigned',
    releaseIdentityVerification: {
      reportRelativePath: `evidence/artifact-identity/${relativePath.split('/').at(-1)}.json`,
      reportSha256: SHA,
    },
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
      schemaVersion: 1,
      packagedRelativePath: 'dist/main/release-identity.json',
      evidenceRelativePath: 'RELEASE-IDENTITY.json',
      bytes: 200,
      sha256: SHA,
    },
    artifacts: [
      artifact('macOS ZIP', 'zip'),
      artifact('macOS DMG', 'dmg'),
    ],
    artifactIdentityGate: {
      status: 'BLOCKED',
      requiredArtifacts: 8,
      verifiedArtifacts: 0,
      blockers: [
        { code: 'BLOCKED_ARTIFACT_MATRIX' },
        { code: 'BLOCKED_WINDOWS_AUTHENTICATED_TRUST' },
      ],
    },
    blockers: [
      { code: 'BLOCKED_UNSIGNED', platform: 'darwin', arch: 'arm64' },
      { code: 'BLOCKED_MAC_BUILD', arch: 'x64' },
      { code: 'BLOCKED_WINDOWS_NATIVE_MODULE', arch: 'x64' },
      { code: 'BLOCKED_ARTIFACT_MATRIX' },
      { code: 'BLOCKED_WINDOWS_AUTHENTICATED_TRUST' },
      { code: 'BLOCKED_POST_PACKAGE_E2E' },
    ],
    ...overrides,
  };
}

test('accepts exact arm64 ZIP/DMG authority while quarantining legacy x64 and Windows blockers', () => {
  const selected = validateArm64CanonicalManifestData(manifest(), SOURCE);
  assert.equal(selected.zip.kind, 'macOS ZIP');
  assert.equal(selected.dmg.kind, 'macOS DMG');
  assert.equal(selected.snapshot.sha256, SHA);
});

test('accepts a legacy artifact identity PASS when selected arm64 artifacts remain exact', () => {
  const value = manifest({
    artifactIdentityGate: {
      status: 'PASS',
      requiredArtifacts: 8,
      verifiedArtifacts: 8,
      blockers: [],
    },
    blockers: [
      { code: 'BLOCKED_UNSIGNED', platform: 'darwin', arch: 'arm64' },
      { code: 'BLOCKED_POST_PACKAGE_SIGNING_NOTARIZATION' },
    ],
  });
  assert.equal(validateArm64CanonicalManifestData(value, SOURCE).zip.arch, 'arm64');
});

test('rejects any blocker that affects authoritative arm64 packaging', () => {
  const value = manifest();
  value.blockers.push({ code: 'BLOCKED_MAC_DMG_DEVICE', arch: 'arm64' });
  assert.throws(
    () => validateArm64CanonicalManifestData(value, SOURCE),
    /BLOCKED_CANONICAL_AUTHORITATIVE_MAC_BLOCKER/u,
  );
});

test('rejects unknown blockers and non-matrix artifact identity failures', () => {
  const unknown = manifest();
  unknown.blockers.push({ code: 'BLOCKED_PRIVATE_REPLAY_LEAK' });
  assert.throws(
    () => validateArm64CanonicalManifestData(unknown, SOURCE),
    /BLOCKED_CANONICAL_UNEXPECTED_BLOCKER/u,
  );

  const identity = manifest();
  identity.artifactIdentityGate.blockers.push({ code: 'BLOCKED_ARTIFACT_IDENTITY' });
  assert.throws(
    () => validateArm64CanonicalManifestData(identity, SOURCE),
    /BLOCKED_CANONICAL_ARTIFACT_GATE/u,
  );
});

test('rejects missing, signed, or weakly bound authoritative artifacts', () => {
  const missing = manifest();
  missing.artifacts.pop();
  assert.throws(
    () => validateArm64CanonicalManifestData(missing, SOURCE),
    /BLOCKED_CANONICAL_ARTIFACT_SET/u,
  );

  const signed = manifest();
  signed.artifacts[0].signing = 'verified';
  assert.throws(
    () => validateArm64CanonicalManifestData(signed, SOURCE),
    /BLOCKED_CANONICAL_ARTIFACT_IDENTITY/u,
  );

  const escaped = manifest();
  escaped.artifacts[0].releaseIdentityVerification.reportRelativePath = '../outside.json';
  assert.throws(
    () => validateArm64CanonicalManifestData(escaped, SOURCE),
    /BLOCKED_CANONICAL_IDENTITY_REPORT_PATH/u,
  );
});
