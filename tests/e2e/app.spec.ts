import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_JS = path.resolve(__dirname, '../../out/main/index.js');

test.describe('KANATA app', () => {
  test('起動してメインウィンドウが開く', async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    const title = await window.title();
    expect(title).toContain('KANATA');

    await app.close();
  });

  test('ウォッチリスト要素が表示される', async () => {
    const app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    const window = await app.firstWindow();
    await window.waitForSelector('[data-testid="watchlist"]', { timeout: 30_000 });

    await app.close();
  });
});
