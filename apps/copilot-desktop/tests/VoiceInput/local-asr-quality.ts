export interface AsrCorpusSample {
  id: string;
  reference: string;
  transcript: string;
  criticalTokens?: string[];
}

export interface AsrCorpusSampleResult {
  id: string;
  accuracy: number;
  criticalTokensPass: boolean;
}

export interface AsrCorpusResult {
  accuracy: number;
  criticalTokensPass: boolean;
  pass: boolean;
  samples: AsrCorpusSampleResult[];
}

export function normalizeAsrGateText(text: string): string {
  return text.normalize('NFC').replace(/[\p{P}\p{Z}\s]/gu, '');
}

export function levenshteinDistance(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

export function characterAccuracy(reference: string, transcript: string): number {
  const expected = normalizeAsrGateText(reference);
  const actual = normalizeAsrGateText(transcript);
  if (!expected) return actual ? 0 : 1;
  return Math.max(0, 1 - levenshteinDistance(expected, actual) / expected.length);
}

export function evaluateAsrCorpus(
  samples: AsrCorpusSample[],
  threshold = 0.9,
): AsrCorpusResult {
  const results = samples.map((sample) => {
    const normalizedTranscript = normalizeAsrGateText(sample.transcript);
    const criticalTokensPass = (sample.criticalTokens ?? []).every((token) =>
      normalizedTranscript.includes(normalizeAsrGateText(token)),
    );
    return {
      id: sample.id,
      accuracy: characterAccuracy(sample.reference, sample.transcript),
      criticalTokensPass,
    };
  });
  const accuracy = results.length
    ? results.reduce((sum, result) => sum + result.accuracy, 0) / results.length
    : 0;
  const criticalTokensPass = results.every((result) => result.criticalTokensPass);
  return {
    accuracy,
    criticalTokensPass,
    pass: accuracy >= threshold && criticalTokensPass,
    samples: results,
  };
}
