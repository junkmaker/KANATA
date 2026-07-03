// SVG 素材から Windows マルチサイズ ICO を生成する。
// 素材: assets/icons/icon-a-candles.svg（512x512、角丸矩形でキャンバスをフル充填）
// 出力: build/icon.ico（16/24/32/48/64/128/256px を内包）
//
// 実行:
//   node scripts/gen-icon.mjs
//
// 依存（devDependencies）: @resvg/resvg-js, png-to-ico
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_SVG = join(ROOT, 'assets/icons/icon-a-candles.svg');
const OUT_ICO = join(ROOT, 'build/icon.ico');

// Windows のアイコンキャッシュが参照する標準サイズ
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function renderPng(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  return resvg.render().asPng();
}

async function main() {
  const svg = readFileSync(SRC_SVG, 'utf8');
  const pngs = SIZES.map((size) => renderPng(svg, size));
  const ico = await pngToIco(pngs);
  writeFileSync(OUT_ICO, ico);
  console.log(`generated ${OUT_ICO} with sizes: ${SIZES.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
