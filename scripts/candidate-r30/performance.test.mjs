import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERFORMANCE_RAW_BASENAMES,
  validatePerformanceAggregateData,
  validatePerformanceRawData,
} from './performance.mjs';
import { CANONICAL_CANDIDATE_ALIAS } from './canonical-release.mjs';

const SHA = 'a'.repeat(64);

function raw(index) {
  const basename = PERFORMANCE_RAW_BASENAMES[index];
  return {
    schemaVersion: 4,
    capturedAt: `2026-07-30T10:00:0${index + 1}.000Z`,
    source: 'direct-spawn-same-electron-instance-plus-authoritative-emitted-knowledgegraph-artifacts-r31-v1',
    runtime: {},
    harness: {},
    evidence: {},
    candidateBinding: { candidate: CANONICAL_CANDIDATE_ALIAS },
    app: { directSpawnLaunchMs: 1_000 + index, residentSetMb: 300 },
    startup: {
      terminal: {
        nativeWindowVisible: true,
        rendererShellCommit: true,
        rendererAppRootVisible: true,
        completionSignal: true,
      },
    },
    runtimeProbe: {
      runBinding: {
        rawBasename: basename,
        ordinal: index + 1,
        challengeSha256: String(index + 1).repeat(64),
      },
    },
    knowledgeGraph100: { nodeCount: 100, fps: 60 },
    thresholds: {},
    processCleanup: { remainingPidCount: 0, pass: true },
    pass: true,
  };
}

function aggregate() {
  const documents = PERFORMANCE_RAW_BASENAMES.map((_, index) => raw(index));
  return {
    schemaVersion: 1,
    contractVersion: 'r31-v1',
    candidate: CANONICAL_CANDIDATE_ALIAS,
    method: 'direct-spawn-write-once-v1',
    runCount: 3,
    rawByteBindings: PERFORMANCE_RAW_BASENAMES.map((basename, index) => ({
      basename,
      ordinal: index + 1,
      bytes: 100 + index,
      sha256: String(index + 4).repeat(64),
    })),
    rawRuns: documents.map((document, index) => ({
      raw: PERFORMANCE_RAW_BASENAMES[index],
      capturedAt: document.capturedAt,
      runBinding: document.runtimeProbe.runBinding,
      directSpawnLaunchMs: document.app.directSpawnLaunchMs,
      residentSetMb: document.app.residentSetMb,
      knowledgeGraph100: document.knowledgeGraph100,
      processCleanup: document.processCleanup,
      pass: true,
    })),
    bindingMode: 'r31-v1-complete-candidate-harness-provenance',
    binding: { candidateBinding: { candidate: CANONICAL_CANDIDATE_ALIAS }, harness: {} },
    bindingsStable: true,
    medianDirectSpawnLaunchMs: 1_001,
    maxDirectSpawnLaunchMs: 1_002,
    thresholdExclusiveMs: 2_000,
    pass: true,
  };
}

test('accepts three distinct passing raw performance records', () => {
  PERFORMANCE_RAW_BASENAMES.forEach((basename, index) => {
    assert.equal(validatePerformanceRawData(raw(index), basename, index + 1).pass, true);
  });
});

test('accepts one stable exact three-run aggregate', () => {
  const value = validatePerformanceAggregateData(aggregate());
  assert.equal(value.runCount, 3);
  assert.equal(value.bindingsStable, true);
});

test('rejects reused challenges, threshold equality, wrong candidate and raw order', () => {
  const reused = aggregate();
  reused.rawRuns[1].runBinding.challengeSha256 = reused.rawRuns[0].runBinding.challengeSha256;
  assert.throws(() => validatePerformanceAggregateData(reused), /BLOCKED_GATE_11_PERFORMANCE_DISTINCT_RUNS/);

  const threshold = aggregate();
  threshold.maxDirectSpawnLaunchMs = 2_000;
  assert.throws(() => validatePerformanceAggregateData(threshold), /BLOCKED_GATE_11_PERFORMANCE_AGGREGATE/);

  const wrongCandidate = aggregate();
  wrongCandidate.candidate = 'v6.2-phase1-candidate-r30';
  assert.throws(() => validatePerformanceAggregateData(wrongCandidate), /BLOCKED_GATE_11_PERFORMANCE_AGGREGATE/);

  const wrongRaw = aggregate();
  wrongRaw.rawByteBindings[0].basename = PERFORMANCE_RAW_BASENAMES[1];
  assert.throws(() => validatePerformanceAggregateData(wrongRaw), /BLOCKED_GATE_11_PERFORMANCE_AGGREGATE_BINDING/);
});

test('rejects a raw that is not fully visible, cleanly terminated and under every threshold', () => {
  const value = raw(0);
  value.startup.terminal.rendererAppRootVisible = false;
  assert.throws(
    () => validatePerformanceRawData(value, PERFORMANCE_RAW_BASENAMES[0], 1),
    /BLOCKED_GATE_11_PERFORMANCE_RAW/,
  );
});
