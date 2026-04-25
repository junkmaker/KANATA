import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'apps/main/src/index.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@kanata/shared-types': resolve(__dirname, 'packages/shared-types/src/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'apps/main/src/preload.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
    resolve: {
      alias: {
        '@kanata/shared-types': resolve(__dirname, 'packages/shared-types/src/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'apps/renderer'),
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'apps/renderer/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@kanata/shared-types': resolve(__dirname, 'packages/shared-types/src/index.ts'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  },
});
