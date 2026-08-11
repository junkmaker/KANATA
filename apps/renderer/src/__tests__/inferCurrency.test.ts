import { describe, expect, it } from 'vitest';
import { inferCurrency } from '../lib/watchlistTickers';
import { fmtPrice } from '../lib/formatters';

describe('inferCurrency', () => {
  it('市場コードで既定の単位を決める', () => {
    expect(inferCurrency('7203', 'JP')).toBe('¥');
    expect(inferCurrency('AAPL', 'US')).toBe('$');
  });

  it('VIX 系は価格ではないので単位なし', () => {
    expect(inferCurrency('^VIX', 'US')).toBe('');
    expect(inferCurrency('^VXN', 'US')).toBe('');
  });

  // `^` を一律で単位なしにする実装への差し戻しを落とすためのテスト
  it('株価指数は市場どおりの通貨単位を保つ', () => {
    expect(inferCurrency('^N225', 'JP')).toBe('¥');
    expect(inferCurrency('^GSPC', 'US')).toBe('$');
  });

  it('NIY=F は US 市場だが円建て、NKD=F はドル建て', () => {
    expect(inferCurrency('NIY=F', 'US')).toBe('¥');
    expect(inferCurrency('NKD=F', 'US')).toBe('$');
  });

  it('米国債利回り指数は % なので単位なし', () => {
    expect(inferCurrency('^TNX', 'US')).toBe('');
    expect(inferCurrency('^IRX', 'US')).toBe('');
  });

  // 為替は 2 通貨の比なので片方の記号を前置しても正しくならない
  it('為替は短縮形も含めて単位なし', () => {
    expect(inferCurrency('USDJPY=X', 'US')).toBe('');
    expect(inferCurrency('EURUSD=X', 'US')).toBe('');
    expect(inferCurrency('JPY=X', 'US')).toBe('');
  });

  // 為替の正規表現が先物まで飲み込まないことを確認する
  it('=F の先物は為替扱いにしない', () => {
    expect(inferCurrency('NIY=F', 'US')).toBe('¥');
    expect(inferCurrency('ES=F', 'US')).toBe('$');
  });

  it('小文字入力でも同じ判定になる', () => {
    expect(inferCurrency('niy=f', 'US')).toBe('¥');
    expect(inferCurrency('^vix', 'US')).toBe('');
  });

  // 桁区切りはロケール依存なので接頭辞だけを検証する
  it('単位なしは fmtPrice で接頭辞が付かない', () => {
    expect(fmtPrice(18.42, inferCurrency('^VIX', 'US'))).toBe('18.42');
    expect(fmtPrice(38500, inferCurrency('NIY=F', 'US')).startsWith('¥')).toBe(true);
  });
});
