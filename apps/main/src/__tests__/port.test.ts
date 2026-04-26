import { describe, it, expect } from 'vitest';
import { reservePort } from '../lib/port.js';

describe('reservePort', () => {
  it('正のポート番号を返す', async () => {
    const port = await reservePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it('連続呼び出しで両方が有効な範囲内のポートを返す', async () => {
    const [a, b] = await Promise.all([reservePort(), reservePort()]);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(65535);
    expect(b).toBeLessThanOrEqual(65535);
  });
});
