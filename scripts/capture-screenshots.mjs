/**
 * docs/user-guide.html 用のスクリーンショットを Electron アプリから撮影する。
 *   npm run build && node scripts/capture-screenshots.mjs
 * 出力先: docs/images/*.png
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs/images');

// ドキュメント用に主銘柄として選びたいコード（ウォッチリストに無ければ先頭行にフォールバック）
const PRIMARY_CODE = '6758';

const WIDTH = 1440;
const HEIGHT = 900;
const SCALE = 2; // 出力解像度の倍率

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ドキュメント用のサンプル銘柄 */
const SEED_SYMBOLS = [
  { symbol: '7203', market: 'JP', display_name: 'トヨタ自動車' },
  { symbol: '6758', market: 'JP', display_name: 'ソニーグループ' },
  { symbol: '9984', market: 'JP', display_name: 'ソフトバンクグループ' },
  { symbol: '8306', market: 'JP', display_name: '三菱UFJフィナンシャル・グループ' },
  { symbol: '6501', market: 'JP', display_name: '日立製作所' },
  { symbol: 'AAPL', market: 'US', display_name: 'Apple Inc.' },
  { symbol: 'MSFT', market: 'US', display_name: 'Microsoft Corp.' },
  { symbol: 'NVDA', market: 'US', display_name: 'NVIDIA Corp.' },
];

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // VSCode 等が付与する ELECTRON_RUN_AS_NODE を除去する（scripts/dev.cjs と同じ理由）
  const env = { ...process.env, NODE_ENV: 'test' };
  delete env.ELECTRON_RUN_AS_NODE;

  // backend / python の場所を明示的に上書きする（開発ツリーからの起動なので）。
  env.KANATA_BACKEND_DIR = env.KANATA_BACKEND_DIR || path.join(ROOT, 'backend');
  if (!env.KANATA_PYTHON) {
    const candidates = [
      process.env.PYTHON,
      'C:/Users/' +
        (process.env.USERNAME || '') +
        '/AppData/Local/Python/pythoncore-3.14-64/python.exe',
    ].filter(Boolean);
    for (const c of candidates) {
      try {
        await fs.access(c);
        env.KANATA_PYTHON = c;
        break;
      } catch {}
    }
  }
  console.log('python:', env.KANATA_PYTHON ?? '(PATH)');

  // out/main/index.js を直接渡すと app.getAppPath() が out/main を指し、
  // package.json が見つからず app.getVersion() が Electron 自身のバージョンを返してしまう。
  // プロジェクトルートを渡してルートの package.json（main フィールド）経由で起動する。
  const app = await electron.launch({ args: [ROOT], env });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.setViewportSize({ width: WIDTH, height: HEIGHT });

  // CSS レイアウトは 1440x900 のまま、出力だけ SCALE 倍の解像度にする（縮小表示でも文字が潰れないように）。
  // Playwright の screenshot() は撮影前に自前で metrics override を上書きしてしまうため、
  // CDP の Page.captureScreenshot を直接使う。
  const cdp = await app.context().newCDPSession(win);
  const applyDpr = () =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: false,
    });
  await applyDpr();
  console.log(`deviceScaleFactor: ${SCALE}`);

  /** CSS ピクセル指定の矩形を SCALE 倍解像度で PNG 保存する */
  const captureClip = async (name, rect) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        scale: 1,
      },
    });
    await fs.writeFile(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  };

  /**
   * スクロールで隠れている部分も含め、要素の全高を撮影する。
   * 一時的に height/overflow を上書きして畳まれた領域を展開し、撮影後に元へ戻す。
   */
  const shotFullElement = async (name, selector) => {
    await win.locator(selector).first().waitFor({ state: 'visible', timeout: 20_000 });
    const rect = await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.dataset.shotPrevStyle = el.getAttribute('style') ?? '';
      el.style.height = `${el.scrollHeight}px`;
      el.style.overflow = 'visible';
      // 展開した分がステータスバーの下に潜り込まないよう、一時的に最前面へ出す
      el.style.position = 'relative';
      el.style.zIndex = '9999';
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, width: b.width, height: el.scrollHeight };
    }, selector);
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        scale: 1,
      },
    });
    await fs.writeFile(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
    await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.setAttribute('style', el.dataset.shotPrevStyle ?? '');
      delete el.dataset.shotPrevStyle;
    }, selector);
    console.log(`captured: ${name}.png (full height)`);
  };

  const rectOf = (selector) =>
    win.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, width: b.width, height: b.height };
    }, selector);

  // 前回実行の localStorage に残った表示モードをチャートに戻す（kanata.view が永続化されるため）
  await win.waitForSelector('.view-switch', { timeout: 60_000 });
  await win.locator('.view-tab', { hasText: 'チャート' }).first().click();
  await win.waitForSelector('[data-testid="watchlist"]', { timeout: 60_000 });

  const shot = async (name, selector) => {
    let rect = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
    if (selector) {
      await win.locator(selector).first().waitFor({ state: 'visible', timeout: 20_000 });
      rect = (await rectOf(selector)) ?? rect;
    }
    await captureClip(name, rect);
    console.log(`captured: ${name}.png`);
  };

  /**
   * 指定セレクタ群の外接矩形にクリップして撮影する。
   * ビュー下部の余白（1fr グリッドの空き領域）を切り落とすために使う。
   */
  const shotCropped = async (name, selectors, pad = 16) => {
    const rect = await win.evaluate(
      ({ sels, pad }) => {
        const els = sels.flatMap((s) => [...document.querySelectorAll(s)]);
        if (els.length === 0) return null;
        const boxes = els.map((e) => e.getBoundingClientRect());
        const x = Math.min(...boxes.map((b) => b.left));
        const y = Math.min(...boxes.map((b) => b.top));
        const right = Math.max(...boxes.map((b) => b.right));
        const bottom = Math.max(...boxes.map((b) => b.bottom));
        return {
          x: Math.max(0, x - pad),
          y: Math.max(0, y - pad),
          width: right - x + pad * 2,
          height: bottom - y + pad * 2,
        };
      },
      { sels: selectors, pad },
    );
    if (!rect) {
      console.warn(`crop targets not found for ${name} - falling back to full view`);
      return shot(name, null);
    }
    await captureClip(name, rect);
    console.log(`captured: ${name}.png (cropped)`);
  };

  const clickTab = async (label) => {
    await win.locator('.view-tab', { hasText: label }).first().click();
    await sleep(2500);
  };

  // --- ドキュメント用に代表銘柄を仕込む ---
  // 初回起動プロファイルのウォッチリストは空なので、バックエンド API 経由で seed する。
  const backendUrl = await win.evaluate(() => window.kanata?.getBackendUrl?.() ?? null);
  if (!backendUrl) throw new Error('バックエンドに接続できませんでした（サイドカー起動失敗）');
  console.log('backend:', backendUrl);

  await win.evaluate(
    async ({ url, seeds }) => {
      const res = await fetch(`${url}/api/watchlists`);
      const lists = (await res.json()).data ?? [];
      const target = lists.find((l) => l.is_default) ?? lists[0];
      if (!target) throw new Error('ウォッチリストがありません');
      const existing = new Set((target.items ?? []).map((i) => i.symbol));
      for (const s of seeds) {
        if (existing.has(s.symbol)) continue;
        await fetch(`${url}/api/watchlists/${target.id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(s),
        });
      }
    },
    {
      url: backendUrl,
      seeds: SEED_SYMBOLS,
    },
  );

  // スクリーニングのスキャンは時間がかかるので、他の撮影と並行して先に走らせる。
  // 前回実行の結果が残っていれば再スキャンしない（撮影の再実行を速くするため）。
  const scanStarted = await win
    .evaluate(async (url) => {
      const cached = await fetch(`${url}/api/screening/n-pattern`).then((r) => r.json());
      if ((cached?.results?.length ?? 0) > 0) return 'cached';
      const res = await fetch(`${url}/api/screening/n-pattern/scan`, { method: 'POST' });
      return res.status;
    }, backendUrl)
    .catch((e) => String(e));
  console.log('scan kickoff:', scanStarted);

  await win.reload();
  await applyDpr();
  await win.waitForSelector('.ticker-row', { timeout: 60_000 });
  await sleep(8000);

  // 主銘柄を決め打ちする。指数（^N225）や先物（HG=F）はファンダメンタルズが空になり
  // ドキュメントの説明と噛み合わないため、通常株を1銘柄だけ選択した状態にする。
  for (const row of await win.locator('.ticker-row.selected').all()) {
    await row.click();
    await sleep(300);
  }
  const preferred = win.locator('.ticker-row', { hasText: PRIMARY_CODE }).first();
  const target = (await preferred.count()) > 0 ? preferred : win.locator('.ticker-row').first();
  await target.click();
  await sleep(5000);

  // --- 1. 全体レイアウト（チャートビュー） ---
  await shot('overview', null);

  // --- 2. 上部バー ---
  await shot('topbar', 'header.topbar');

  // --- 3. 左パネル ---
  // 左パネルはビューポートより縦に長いので、スクロール分も含めて全体を撮る
  await shotFullElement('left-panel', 'aside.panel-left');

  // --- 4. メインチャート（指標をいくつか点灯させる） ---
  for (const label of ['単純移動平均線 25期間', '単純移動平均線 75期間', 'ボリンジャーバンド']) {
    const row = win.locator('.toggle-row', { hasText: label }).first();
    if ((await row.count()) > 0 && !(await row.getAttribute('class'))?.includes('on')) {
      await row.click();
    }
  }
  await sleep(1500);
  await shot('chart-area', '.chart-area');

  // --- 5. 右パネル ---
  await shot('right-panel', 'aside.panel-right');

  // --- 6. 下部ステータスバー ---
  await shot('statusbar', 'footer.statusbar');

  // --- 7. 設定パネル（TWEAKS） ---
  await win
    .locator('button[title="設定"]')
    .first()
    .click()
    .catch(() => {});
  await sleep(1200);
  if ((await win.locator('.tweaks-panel').count()) > 0) {
    await shot('tweaks', '.tweaks-panel');
    await win
      .locator('.tweaks-head .link-btn')
      .first()
      .click()
      .catch(() => {});
    await sleep(600);
  } else {
    console.warn('tweaks panel not found - skipped');
  }

  // --- 8. パターン分析（描画を入れる前に撮る） ---
  await clickTab('パターン');
  await shot('pattern', '.main-grid.pattern-grid');

  // --- 9. マクロダッシュボード（下部の余白を切り落とす） ---
  await clickTab('マクロ');
  await sleep(5000);
  await shotCropped('macro', ['.macro-overall', '.macro-cards', '.macro-periods']);

  // --- 10. スクリーニング（スキャン完了を待って結果を出す） ---
  await clickTab('スクリーニング');
  const scanDeadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < scanDeadline) {
    const st = await win.evaluate(
      (url) => fetch(`${url}/api/screening/n-pattern/status`).then((r) => r.json()),
      backendUrl,
    );
    if (st.status !== 'running') {
      console.log('scan finished:', JSON.stringify(st).slice(0, 200));
      break;
    }
    console.log(`scanning... ${st.done}/${st.total}`);
    await sleep(15000);
  }
  await win.reload();
  await win.waitForSelector('[data-testid="watchlist"], .screening-view-grid', { timeout: 60_000 });
  await clickTab('スクリーニング');
  await sleep(4000);
  await shotCropped('screening', ['.screening-toolbar', '.screening-table-wrap']);

  // --- 11. 描画ツール（最後に。トレンドラインを1本引いた状態） ---
  await clickTab('チャート');
  await sleep(3000);
  await win
    .locator('.tool-btn[title="トレンドライン"]')
    .first()
    .click()
    .catch(() => {});
  await sleep(500);
  const box = await win.locator('.chart-area').boundingBox();
  if (box) {
    // 描画はドラッグを開始したペイン内に収まるため、Y はローソク足ペイン
    // （サブペインを4つ表示した状態では上から約 45% まで）の内側に収める。
    await win.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.38);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.16, { steps: 12 });
    await win.mouse.up();
    await sleep(1500);
  }
  await shot('drawing', '.chart-area');

  // 撮影用に引いた描画を片付ける
  await win
    .locator('.link-btn[title="描画を全て消す"]')
    .first()
    .click()
    .catch(() => {});
  await sleep(500);

  await app.close();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
