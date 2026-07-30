import { describe, expect, it } from 'vitest';
import {
  PHASE1_RELEASE_EXCLUSIONS,
  PHASE1_RELEASE_EXCLUSION_RATIONALE,
} from './phase1-release-scope.js';

describe('Phase 1 release test scope', () => {
  it('uses one sorted, duplicate-free, fully explained exclusion set', () => {
    expect(PHASE1_RELEASE_EXCLUSIONS).toEqual([...PHASE1_RELEASE_EXCLUSIONS].sort());
    expect(new Set(PHASE1_RELEASE_EXCLUSIONS).size).toBe(PHASE1_RELEASE_EXCLUSIONS.length);
    expect(Object.keys(PHASE1_RELEASE_EXCLUSION_RATIONALE).sort())
      .toEqual([...PHASE1_RELEASE_EXCLUSIONS]);
    for (const reason of Object.values(PHASE1_RELEASE_EXCLUSION_RATIONALE)) {
      expect(reason.length).toBeGreaterThan(30);
    }
  });

  it('never excludes packaged Electron, current candidate runner, RAG or source-scope contracts', () => {
    const serialized = JSON.stringify(PHASE1_RELEASE_EXCLUSIONS);
    expect(serialized).not.toMatch(/e2e|candidate-r30|rag|phase1-release-scope/u);
  });
});
