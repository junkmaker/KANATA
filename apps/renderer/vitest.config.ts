import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, '.'),
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@kanata/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
});
