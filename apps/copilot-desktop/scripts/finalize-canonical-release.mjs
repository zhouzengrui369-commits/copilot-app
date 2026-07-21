#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePostPackageEvidence } from './post-package-evidence.mjs';
import { resolvePmTrustAnchorForFinalization } from './private-replay-evidence.mjs';
import {
  assertPrivateEvidenceAbsent,
  evaluateArtifactIdentityEvidence,
  inspectStableFinalArtifact,
} from './release-identity-evidence.mjs';
import { verifyCanonicalCompletionIntegrity } from './release-macos-signing.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const NORTH_STAR_BLOCKER = 'BLOCKED_POST_PACKAGE_NORTH_STAR';
const ARTIFACT_IDENTITY_BLOCKERS = new Set([
  'BLOCKED_ARTIFACT_MATRIX',
  'BLOCKED_ARTIFACT_IDENTITY',
  'BLOCKED_WINDOWS_AUTHENTICATED_TRUST',
]);
const desktopRoot = path.resolve(path.dirname(scriptPath), '..');
const releaseRoot = path.join(desktopRoot, 'release');
const options = parseArgs(process.argv.slice(2));
const candidateRoot = path.resolve(options.candidate);
if (!isInside(releaseRoot, candidateRoot)) {
  throw new Error(`CANDIDATE_OUTSIDE_RELEASE_ROOT: ${candidateRoot}`);
}
if (!existsSync(path.join(candidateRoot, '.canonical-release.complete'))) {
  throw new Error(`CANDIDATE_NOT_COMPLETE: ${candidateRoot}`);
}

const manifestPath = path.join(candidateRoot, 'CANONICAL-MANIFEST.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const releaseMode = manifest.signingProfile?.mode;
if (!['unsigned', 'distribution', 'macos-distribution'].includes(releaseMode)) {
  throw new Error(`CANONICAL_RELEASE_MODE_UNSUPPORTED: ${String(releaseMode)}`);
}
if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) {
  throw new Error(`CANONICAL_SCHEMA_UNSUPPORTED: ${String(manifest.schemaVersion)}`);
}
if ((releaseMode === 'distribution' || releaseMode === 'macos-distribution') && manifest.schemaVersion !== 2) {
  throw new Error('CANONICAL_DISTRIBUTION_SCHEMA_REQUIRES_V2');
}
if (releaseMode === 'macos-distribution' && manifest.releaseMode !== 'macos-distribution') {
  throw new Error('CANONICAL_MACOS_DISTRIBUTION_MODE_MISMATCH');
}
if (manifest.releaseMode !== undefined && manifest.releaseMode !== releaseMode) {
  throw new Error('CANONICAL_RELEASE_MODE_MISMATCH');
}
if (manifest.candidate !== path.basename(candidateRoot)) {
  throw new Error(`CANDIDATE_NAME_MISMATCH: manifest=${manifest.candidate}`);
}
const trustedPmRunner = await resolvePmTrustAnchorForFinalization({
  trustAnchorPath: options.northStarPmTrustAnchor,
  candidateRoot,
  manifestAnchor: manifest.northStar?.pmRunner,
  distribution: releaseMode === 'distribution' || releaseMode === 'macos-distribution',
});
await verifyArtifacts(candidateRoot, manifest.artifacts ?? []);
manifest.completionIntegrity = {
  status: 'PASS',
  ...await verifyCanonicalCompletionIntegrity({
    artifacts: manifest.artifacts ?? [],
    inspectPath: async (relativePath) => {
      const file = path.join(candidateRoot, relativePath);
      return inspectStableFinalArtifact(file);
    },
  }),
};

const postPackage = await evaluatePostPackageEvidence({
  evidencePath: options.externalEvidence,
  candidate: manifest.candidate,
  source: manifest.source,
  artifacts: manifest.artifacts ?? [],
  releaseMode,
  northStar: { ...manifest.northStar, pmRunner: trustedPmRunner },
});
if (
  postPackage.gates.find((gate) => gate.id === 'northStar')?.status !== 'PASS'
  && !postPackage.blockers.some((blocker) => blocker.code === NORTH_STAR_BLOCKER)
) {
  throw new Error('NORTH_STAR_FAIL_CLOSED_INVARIANT');
}
manifest.postPackageGates = {
  ...postPackage,
  finalizedAt: new Date().toISOString(),
  evidenceFile: postPackage.evidenceFile ? {
    ...postPackage.evidenceFile,
    path: path.relative(candidateRoot, postPackage.evidenceFile.path),
  } : null,
};
manifest.blockers = (manifest.blockers ?? [])
  .filter((blocker) => (
    !String(blocker?.code ?? '').startsWith('BLOCKED_POST_PACKAGE_')
    && !ARTIFACT_IDENTITY_BLOCKERS.has(blocker?.code)
    && blocker?.code !== 'BLOCKED_PRIVATE_REPLAY_LEAK'
  ));
manifest.blockers.push(...postPackage.blockers);
try {
  await assertPrivateEvidenceAbsent(candidateRoot);
} catch (error) {
  if (!error || typeof error !== 'object' || error.code !== 'BLOCKED_PRIVATE_REPLAY_LEAK') throw error;
  manifest.blockers.push({
    code: 'BLOCKED_PRIVATE_REPLAY_LEAK',
    message: 'Private replay evidence must remain outside candidate artifacts and delivery packages.',
  });
}
manifest.artifactIdentityGate = await evaluateArtifactIdentityEvidence({
  candidateRoot,
  manifest,
});
manifest.blockers.push(...manifest.artifactIdentityGate.blockers);
manifest.status = manifest.blockers.some((blocker) => blocker.code === 'RELEASE_PIPELINE_FAILED')
  ? 'FAIL'
  : manifest.blockers.length === 0 ? 'PASS' : 'PARTIAL_BLOCKED';
manifest.finalizedAt = new Date().toISOString();

await atomicJson(manifestPath, manifest);
await refreshInstallStatus(candidateRoot, manifest);
process.stdout.write(`${JSON.stringify({
  status: manifest.status,
  candidate: candidateRoot,
  postPackageStatus: postPackage.status,
  blockers: manifest.blockers,
}, null, 2)}\n`);
if (manifest.status !== 'PASS') process.exitCode = 2;

async function verifyArtifacts(root, artifacts) {
  const artifactsRoot = path.join(root, 'artifacts');
  const actual = (await listFiles(artifactsRoot)).map((file) => path.relative(root, file)).sort();
  const expected = artifacts.map((artifact) => artifact.relativePath).sort();
  if (new Set(expected).size !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('ARTIFACT_INVENTORY_MISMATCH');
  }
  for (const artifact of artifacts) {
    const file = path.join(root, artifact.relativePath);
    const current = await inspectStableFinalArtifact(file);
    if (current.bytes !== artifact.bytes) throw new Error(`ARTIFACT_SIZE_MISMATCH: ${artifact.relativePath}`);
    if (current.sha256 !== artifact.sha256) throw new Error(`ARTIFACT_SHA_MISMATCH: ${artifact.relativePath}`);
  }
}

async function refreshInstallStatus(root, manifest) {
  const installPath = path.join(root, 'INSTALL.md');
  let text = await readFile(installPath, 'utf8');
  const overall = manifest.status === 'PASS'
    ? 'All canonical artifacts and post-package acceptance gates passed.'
    : `Candidate is not complete: ${manifest.blockers.map((blocker) => blocker.code).join(', ')}.`;
  text = text.replace(
    /(# NJX Copilot v6\.2 Phase 1 candidate\n\n)[\s\S]*?(\n\n## Install)/,
    `$1${overall}$2`,
  );
  text = text.replace(/Status: \*\*[^*]+\*\*\./, `Status: **${manifest.postPackageGates.status}**.`);
  await atomicText(installPath, text);
}

async function listFiles(root) {
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(target));
    else output.push(target);
  }
  return output;
}

async function atomicJson(target, value) {
  await atomicText(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function atomicText(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, value, 'utf8');
  await rename(temporary, target);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--candidate') parsed.candidate = required(args, ++index, '--candidate');
    else if (args[index] === '--external-evidence') {
      parsed.externalEvidence = required(args, ++index, '--external-evidence');
    } else if (args[index] === '--north-star-pm-trust-anchor') {
      parsed.northStarPmTrustAnchor = path.resolve(required(args, ++index, '--north-star-pm-trust-anchor'));
    } else throw new Error(`UNKNOWN_ARGUMENT: ${args[index]}`);
  }
  if (!parsed.candidate) throw new Error('MISSING_ARGUMENT_VALUE: --candidate');
  if (!parsed.externalEvidence) throw new Error('MISSING_ARGUMENT_VALUE: --external-evidence');
  return parsed;
}

function required(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`MISSING_ARGUMENT_VALUE: ${flag}`);
  return value;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
