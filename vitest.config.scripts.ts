import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(__dirname, '.'),
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/__tests__/**/*.test.mjs'],
  },
});
