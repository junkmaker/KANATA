import { describe, expect, it } from 'vitest';
import { buildExtraTicker, inferMarketForCode } from '../lib/extraTicker';

describe('inferMarketForCode', () => {
  it('4桁数字コードは JP と判定する', () => {
    // Arrange
    const code = '7203';

    // Act
    const market = inferMarketForCode(code);

    // Assert
    expect(market).toBe('JP');
  });

  it('数字3桁+英字1桁のコードも JP と判定する', () => {
    // Arrange
    const code = '130A';

    // Act
    const market = inferMarketForCode(code);

    // Assert
    expect(market).toBe('JP');
  });

  it('英字ティッカーは US と判定する', () => {
    // Arrange
    const code = 'AAPL';

    // Act
    const market = inferMarketForCode(code);

    // Assert
    expect(market).toBe('US');
  });
});

describe('buildExtraTicker', () => {
  it('name 指定時はチャート表示名に反映する', () => {
    // Arrange / Act
    const ticker = buildExtraTicker('7203', 'トヨタ自動車');

    // Assert
    expect(ticker.code).toBe('7203');
    expect(ticker.name).toBe('トヨタ自動車');
    expect(ticker.market).toBe('JP');
  });

  it('name が空文字のときは code を表示名として使う', () => {
    // Arrange / Act
    const ticker = buildExtraTicker('7203', '');

    // Assert
    expect(ticker.name).toBe('7203');
  });

  it('US 銘柄は market が US になる', () => {
    // Arrange / Act
    const ticker = buildExtraTicker('AAPL', 'Apple Inc.');

    // Assert
    expect(ticker.market).toBe('US');
    expect(ticker.name).toBe('Apple Inc.');
  });
});
