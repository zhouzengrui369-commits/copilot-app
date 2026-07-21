import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('canonical finalizer north-star contract', () => {
  it('requires a stable candidate-external PM trust anchor before post-package signature verification', async () => {
    const source = await readFile(path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../scripts/finalize-canonical-release.mjs',
    ), 'utf8');
    const trustSource = await readFile(path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../scripts/private-replay-evidence.mjs',
    ), 'utf8');
    expect(source).toContain('northStar: { ...manifest.northStar, pmRunner: trustedPmRunner }');
    expect(source).toContain('BLOCKED_POST_PACKAGE_NORTH_STAR');
    expect(source).toContain('evaluatePostPackageEvidence');
    expect(source).toContain("'--north-star-pm-trust-anchor'");
    expect(source).toContain('resolvePmTrustAnchorForFinalization');
    expect(trustSource).toContain('PM_TRUST_ANCHOR_MISMATCH');
    expect(source.indexOf('resolvePmTrustAnchorForFinalization'))
      .toBeLessThan(source.indexOf('evaluatePostPackageEvidence({'));
  });

  it('fails closed on unknown modes and binds the macOS-only schema-v2 release contract', async () => {
    const source = await readFile(path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../scripts/finalize-canonical-release.mjs',
    ), 'utf8');
    expect(source).toContain("['unsigned', 'distribution', 'macos-distribution'].includes(releaseMode)");
    expect(source).toContain('CANONICAL_RELEASE_MODE_UNSUPPORTED');
    expect(source).toContain("(releaseMode === 'distribution' || releaseMode === 'macos-distribution') && manifest.schemaVersion !== 2");
    expect(source).toContain('CANONICAL_DISTRIBUTION_SCHEMA_REQUIRES_V2');
    expect(source).toContain("releaseMode === 'macos-distribution' && manifest.releaseMode !== 'macos-distribution'");
    expect(source).toContain('CANONICAL_MACOS_DISTRIBUTION_MODE_MISMATCH');
    expect(source).toContain('manifest.releaseMode !== undefined && manifest.releaseMode !== releaseMode');
    expect(source).toContain('CANONICAL_RELEASE_MODE_MISMATCH');
    expect(source).toContain("distribution: releaseMode === 'distribution' || releaseMode === 'macos-distribution'");
    expect(source).toContain('releaseMode,\n  northStar:');
    expect(source.indexOf('CANONICAL_RELEASE_MODE_UNSUPPORTED'))
      .toBeLessThan(source.indexOf('await verifyArtifacts(candidateRoot'));
    expect(source.indexOf('CANONICAL_MACOS_DISTRIBUTION_MODE_MISMATCH'))
      .toBeLessThan(source.indexOf('evaluatePostPackageEvidence({'));
  });
});
