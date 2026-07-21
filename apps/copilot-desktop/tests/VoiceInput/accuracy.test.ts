/**
 * Legacy scorer compatibility only. The Phase-1 release gate uses
 * evaluateAsrCorpus (NFC + Unicode punctuation/space removal + Levenshtein).
 *
 * Sprint 1.2 / T-1.2.4 — PM discipline #6 (中文识别 ≥ 90%).
 */

import { describe, expect, it } from 'vitest';
import { characterAccuracy } from '../../src/renderer/components/VoiceInput/CloudAsrProvider';
import samples from '../fixtures/asr-samples-zh.json';

interface Sample {
  id: string;
  expected: string;
  web: string;
  cloud: string;
}

const data = samples as { samples: Sample[] };

describe('legacy characterAccuracy compatibility (not the release gate)', () => {
  it('passes the ≥ 0.9 bar for every web-speech sample', () => {
    for (const s of data.samples) {
      const a = characterAccuracy(s.expected, s.web);
      expect(a, `web-speech sample ${s.id}`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('passes the ≥ 0.9 bar for every cloud sample', () => {
    for (const s of data.samples) {
      const a = characterAccuracy(s.expected, s.cloud);
      expect(a, `cloud sample ${s.id}`).toBeGreaterThanOrEqual(0.9);
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
});
