import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const eventsBrowserEntry = nodeRequire.resolve('events/');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^events$/, replacement: eventsBrowserEntry },
    ],
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: path.resolve(__dirname, 'src/main/main.ts'),
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
  build: {
    outDir: 'dist/renderer',
  },
});
