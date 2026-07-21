import os from 'node:os';
import path from 'node:path';

export interface PlaywrightJsonStats {
  expected: number;
  skipped: number;
  unexpected: number;
  flaky: number;
  startTime?: string;
  duration?: number;
}

export interface ElectronE2eCounts {
  expected: number;
  passed: number;
  skipped: number;
  unexpected: number;
  flaky: number;
}

/** `--list` instantiates reporters, so discovery must never replace run evidence. */
export function electronE2eJsonReportPath(
  appRoot: string,
  argv: readonly string[] = process.argv,
  tempRoot = os.tmpdir(),
  configuredPath = process.env.COPILOT_E2E_PLAYWRIGHT_JSON_PATH,
): string {
  if (argv.includes('--list')) {
    return path.join(
      tempRoot,
      'njx-copilot-e2e-list',
      `electron-e2e-list-${process.pid}-${Date.now()}.json`,
    );
  }
  if (configuredPath) {
    if (!path.isAbsolute(configuredPath)) {
      throw new Error('COPILOT_E2E_PLAYWRIGHT_JSON_PATH must be absolute');
    }
    return configuredPath;
  }
  return path.join(appRoot, 'test-results/electron-e2e-results.json');
}

export function summarizePlaywrightStats(stats: PlaywrightJsonStats): ElectronE2eCounts {
  const fields: Array<keyof Pick<PlaywrightJsonStats, 'expected' | 'skipped' | 'unexpected' | 'flaky'>> = [
    'expected',
    'skipped',
    'unexpected',
    'flaky',
  ];
  for (const field of fields) {
    if (!Number.isInteger(stats[field]) || stats[field] < 0) {
      throw new Error(`invalid Playwright stats.${field}`);
    }
  }
  return {
    expected: stats.expected + stats.skipped + stats.unexpected + stats.flaky,
    passed: stats.expected,
    skipped: stats.skipped,
    unexpected: stats.unexpected,
    flaky: stats.flaky,
  };
}
