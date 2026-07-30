import { describe, expect, it } from 'vitest';
import {
  PHASE1_RELEASE_EXCLUSIONS,
  PHASE1_RELEASE_EXCLUSION_RATIONALE,
  PHASE1_RELEASE_SOURCE_EXCLUSIONS,
  PHASE1_RELEASE_SOURCE_EXCLUSION_RATIONALE,
} from './phase1-release-scope.js';

function expectGovernedScope(
  exclusions: readonly string[],
  rationale: Readonly<Record<string, string>>,
  minimumReasonLength: number,
): void {
  expect(exclusions).toEqual([...exclusions].sort());
  expect(new Set(exclusions).size).toBe(exclusions.length);
  expect(Object.keys(rationale).sort()).toEqual([...exclusions]);
  for (const reason of Object.values(rationale)) {
    expect(reason.length).toBeGreaterThan(minimumReasonLength);
  }
}

describe('Phase 1 release scope', () => {
  it('uses sorted, duplicate-free, fully explained test and source exclusion sets', () => {
    expectGovernedScope(
      PHASE1_RELEASE_EXCLUSIONS,
      PHASE1_RELEASE_EXCLUSION_RATIONALE,
      30,
    );
    expectGovernedScope(
      PHASE1_RELEASE_SOURCE_EXCLUSIONS,
      PHASE1_RELEASE_SOURCE_EXCLUSION_RATIONALE,
      60,
    );
  });

  it('never excludes packaged Electron, current candidate runner, RAG or scope governance', () => {
    const serialized = JSON.stringify(PHASE1_RELEASE_EXCLUSIONS);
    expect(serialized).not.toMatch(/e2e|candidate-r30|rag|phase1-release-scope/u);
  });

  it('keeps every Phase 1 critical product source inside global coverage', () => {
    const serialized = JSON.stringify(PHASE1_RELEASE_SOURCE_EXCLUSIONS);
    expect(serialized).not.toMatch(
      /local-knowledge-service|domain-ipc|preload|media-permission|VoiceInput|AskWorkspace|KnowledgeWorkspace|ScheduleWorkspace|copilot-api/u,
    );
  });

  it('limits source exclusions to explicit owner-deferred, bootstrap or evidence infrastructure', () => {
    for (const source of PHASE1_RELEASE_SOURCE_EXCLUSIONS) {
      expect(source).toMatch(
        /backup|remote|prototype|main\.tsx|main\.ts|local-asr-worker|local-telemetry|direct-performance-probe/iu,
      );
    }
  });
});
