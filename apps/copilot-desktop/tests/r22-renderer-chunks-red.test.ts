// @vitest-environment node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import reactPlugin from '@vitejs/plugin-react';
import { describe, expect, it } from 'vitest';
import { build } from 'vite';
import type { RollupOutput, OutputChunk } from 'rollup';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('r22 RED-3 real renderer chunk boundary', () => {
  it('uses Vite write:false and keeps heavy feature owners out of the entry chunk', async () => {
    const buildResult = await build({
      configFile: false,
      root: desktopRoot,
      logLevel: 'silent',
      plugins: [reactPlugin()],
      resolve: {
        alias: {
          events: path.resolve(desktopRoot, '../../node_modules/events/events.js'),
        },
      },
      build: {
        write: false,
        minify: false,
        cssCodeSplit: true,
        rollupOptions: {
          input: path.join(desktopRoot, 'src/renderer/main.tsx'),
        },
      },
    });
    const outputs = Array.isArray(buildResult)
      ? buildResult
      : [buildResult as RollupOutput];
    const chunks = outputs.flatMap((output) => output.output)
      .filter((output): output is OutputChunk => output.type === 'chunk');
    const entry = chunks.find((chunk) => chunk.isEntry);
    expect(entry).toBeDefined();
    const entryModules = Object.keys(entry!.modules).map((moduleId) => moduleId.replaceAll('\\', '/'));
    const forbiddenEntryOwner = /(?:node_modules\/(?:sigma|graphology|react-markdown)|src\/renderer\/(?:components\/(?:KnowledgeGraph|SettingsPanel)|workspaces\/(?:Knowledge|Ask|Voice|Schedule)Workspace))/;
    expect(entryModules.filter((moduleId) => forbiddenEntryOwner.test(moduleId))).toEqual([]);
    expect(entry!.code).not.toMatch(/Sigma|graphology|react-markdown|VoiceWorkspace|KnowledgeWorkspace/);

    const dynamicModules = chunks.filter((chunk) => !chunk.isEntry)
      .flatMap((chunk) => Object.keys(chunk.modules).map((moduleId) => moduleId.replaceAll('\\', '/')));
    for (const owner of [
      '/components/SettingsPanel.tsx',
      '/workspaces/KnowledgeWorkspace.tsx',
      '/workspaces/AskWorkspace.tsx',
      '/workspaces/VoiceWorkspace.tsx',
      '/workspaces/ScheduleWorkspace.tsx',
    ]) {
      expect(dynamicModules.some((moduleId) => moduleId.endsWith(owner)), owner).toBe(true);
    }
  }, 60_000);
});
