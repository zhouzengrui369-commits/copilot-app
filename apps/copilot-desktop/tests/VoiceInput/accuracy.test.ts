/**
 * Test-only local ASR scorer. Runtime provider code is deliberately absent.
 *
 * Sprint 1.2 / T-1.2.4 — PM discipline #6 (中文识别 ≥ 90%).
 */

import { describe, expect, it } from 'vitest';
import { characterAccuracy, evaluateAsrCorpus } from './local-asr-quality';
import samples from '../fixtures/asr-samples-zh.json';

interface Sample {
  id: string;
  expected: string;
  web: string;
  cloud: string;
}

const data = samples as { samples: Sample[] };

describe('local ASR transcript quality fixtures', () => {
  it('passes the ≥ 0.9 bar for every first transcript candidate', () => {
    for (const s of data.samples) {
      const a = characterAccuracy(s.expected, s.web);
      expect(a, `first transcript sample ${s.id}`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('passes the ≥ 0.9 bar for every second transcript candidate', () => {
    for (const s of data.samples) {
      const a = characterAccuracy(s.expected, s.cloud);
      expect(a, `second transcript sample ${s.id}`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('combined accuracy is ≥ 0.9', () => {
    let sum = 0;
    let n = 0;
    for (const s of data.samples) {
      sum += characterAccuracy(s.expected, s.web);
      sum += characterAccuracy(s.expected, s.cloud);
      n += 2;
    }
    expect(sum / n).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps NFC, punctuation removal and critical-token truth fail closed', () => {
    const result = evaluateAsrCorpus([
      {
        id: 'critical',
        reference: '下午三点提醒我开会',
        transcript: '下午四点提醒我开会',
        criticalTokens: ['三点'],
      },
    ], 0.8);
    expect(result.accuracy).toBeCloseTo(8 / 9);
    expect(result.criticalTokensPass).toBe(false);
    expect(result.pass).toBe(false);
  });
});
