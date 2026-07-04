import { describe, expect, it } from 'vitest';
import { MACRO_INFO, OVERALL_INFO } from '../components/Macro/macroInfo';

// MacroCard の TITLE/SUBTITLE と同一キー集合であることを担保する。
const EXPECTED_KEYS = [
  'hy_oas',
  'net_liquidity',
  'rsp_spy',
  'nikkei_sp',
  'nikkei_topix',
  'brent_wti',
];

describe('MACRO_INFO', () => {
  it('期待する6キー集合と過不足なく一致する', () => {
    expect(Object.keys(MACRO_INFO).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it('各エントリの what / read が非空である', () => {
    for (const [key, info] of Object.entries(MACRO_INFO)) {
      expect(info.what.length, `${key}.what`).toBeGreaterThan(0);
      expect(info.read.length, `${key}.read`).toBeGreaterThan(0);
    }
  });

  it('各エントリの criteria が green / yellow / red すべて非空である', () => {
    for (const [key, info] of Object.entries(MACRO_INFO)) {
      expect(info.criteria.green.length, `${key}.criteria.green`).toBeGreaterThan(0);
      expect(info.criteria.yellow.length, `${key}.criteria.yellow`).toBeGreaterThan(0);
      expect(info.criteria.red.length, `${key}.criteria.red`).toBeGreaterThan(0);
    }
  });

  it('表示専用3指標のみ displayOnly=true を持つ', () => {
    const displayOnly = Object.entries(MACRO_INFO)
      .filter(([, info]) => info.displayOnly)
      .map(([key]) => key)
      .sort();
    expect(displayOnly).toEqual(['brent_wti', 'nikkei_sp', 'nikkei_topix'].sort());
  });
});

describe('OVERALL_INFO', () => {
  it('全フィールドが非空である', () => {
    expect(OVERALL_INFO.what.length).toBeGreaterThan(0);
    expect(OVERALL_INFO.read.length).toBeGreaterThan(0);
    expect(OVERALL_INFO.criteria.green.length).toBeGreaterThan(0);
    expect(OVERALL_INFO.criteria.yellow.length).toBeGreaterThan(0);
    expect(OVERALL_INFO.criteria.red.length).toBeGreaterThan(0);
  });

  it('what に中核3指標のみで算出する旨を含む', () => {
    expect(OVERALL_INFO.what).toContain('中核3指標');
  });
});
