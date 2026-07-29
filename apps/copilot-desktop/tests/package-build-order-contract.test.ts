import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));

function readScripts(): Record<string, string> {
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return packageJson.scripts ?? {};
}

describe('macOS distribution workspace build order contract', () => {
  it('defines one exact dependency build chain in dependency order', () => {
    const scripts = readScripts();

    expect(scripts['build:workspace-deps']).toBe(
      'npm run build --workspace @copilot/llm-client && ' +
        'npm run build --workspace @copilot/kb && ' +
        'npm run build --workspace @copilot/kg && ' +
        'npm run build --workspace @copilot/rag',
    );
  });

  it.each(['dist:mac', 'dist:mac:arm64', 'dist:mac:x64', 'dist:mac:dir'])(
    '%s builds workspace dependencies before desktop output',
    (scriptName) => {
      const script = readScripts()[scriptName];

      expect(script).toMatch(
        /^npm run build:workspace-deps && npm run build && electron-builder --mac(?: |$)/,
      );
      expect(script.match(/npm run build:workspace-deps/g)).toHaveLength(1);
    },
  );

  it('does not alter the desktop build or Windows distribution contracts', () => {
    const scripts = readScripts();

    expect(scripts.build).toBe('npm run build:main && npm run build:renderer');
    expect(scripts['dist:win']).toBe(
      'npm run build && electron-builder --win --config electron-builder.yml',
    );
    expect(scripts['dist:win:x64']).toBe(
      'npm run build && electron-builder --win --x64 --config electron-builder.yml',
    );
    expect(scripts['dist:win:arm64']).toBe(
      'npm run build && electron-builder --win --arm64 --config electron-builder.yml',
    );
  });
});
