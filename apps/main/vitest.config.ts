import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(__dirname, '.'),
  test: {
    environment: 'node',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      electron: resolve(__dirname, 'src/__tests__/__mocks__/electron.ts'),
      '@kanata/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
});
