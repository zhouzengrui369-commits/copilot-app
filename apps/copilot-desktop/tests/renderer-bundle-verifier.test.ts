import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadVerifier(): Promise<{
  findBareRequireReferences(source: string, filePath?: string): Array<{
    filePath: string;
    line: number | null;
    column: number | null;
  }>;
}> {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const modulePath = path.resolve(testDirectory, '../scripts/verify-renderer-bundle.mjs');
  return import(pathToFileURL(modulePath).href);
}

describe('renderer bundle verifier', () => {
  it('rejects direct and aliased executable bare require references', async () => {
    const verifier = await loadVerifier();
    const findings = verifier.findBareRequireReferences(
      `const direct = require('events'); const alias = require; alias('events');`,
      'bad.js',
    );
    expect(findings).toEqual([
      { filePath: 'bad.js', line: 1, column: 15 },
      { filePath: 'bad.js', line: 1, column: 48 },
    ]);
  });

  it('does not reject require text, comments, regexes, or member properties', async () => {
    const verifier = await loadVerifier();
    const findings = verifier.findBareRequireReferences(`
      const text = "require('events')";
      const template = \`require('events')\`;
      const pattern = /require\\(['"]events/;
      // require('events')
      globalThis.require;
      const object = { require: 'data' };
    `, 'safe.js');
    expect(findings).toEqual([]);
  });

  it('fails closed on malformed JavaScript', async () => {
    const verifier = await loadVerifier();
    expect(() => verifier.findBareRequireReferences('const = ;', 'malformed.js'))
      .toThrow('BLOCKED_RENDERER_BUNDLE_PARSE_FAILED');
  });
});
