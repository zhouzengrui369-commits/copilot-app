import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const eventsBrowserEntry = nodeRequire.resolve('events/');
const browserPrototype = process.env.COPILOT_BROWSER_PROTOTYPE === '1';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^events$/, replacement: eventsBrowserEntry },
    ],
  },
  plugins: [
    react(),
    ...(
      browserPrototype
        ? []
        : [
            electron({
              main: {
                entry: {
                  main: path.resolve(__dirname, 'src/main/main.ts'),
                  'local-asr-worker': path.resolve(__dirname, 'src/main/local-asr-worker.ts'),
                },
                vite: {
                  build: {
                    outDir: 'dist/main',
                    rollupOptions: {
                      external: ['electron', 'electron-store'],
                    },
                  },
                },
              },
              preload: {
                input: path.resolve(__dirname, 'src/main/preload.ts'),
                vite: {
                  build: {
                    outDir: 'dist/main',
                    rollupOptions: {
                      external: ['electron'],
                    },
                  },
                },
              },
              renderer: {},
            }),
          ],
    ),
  ],
  build: {
    outDir: 'dist/renderer',
  },
});
