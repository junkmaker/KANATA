import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetBackendUrl = vi.fn<() => Promise<string | null>>();
const mockOnBackendStatus = vi.fn();

beforeEach(() => {
  vi.resetModules();
  mockGetBackendUrl.mockReset();
  mockOnBackendStatus.mockReset();
  Object.defineProperty(globalThis, 'window', {
    value: {
      kanata: {
        getBackendUrl: mockGetBackendUrl,
        onBackendStatus: mockOnBackendStatus,
      },
    },
    writable: true,
    configurable: true,
  });
});

describe('getBackendUrl', () => {
  it('kanata が URL を返せばキャッシュして返す', async () => {
    mockGetBackendUrl.mockResolvedValue('http://127.0.0.1:12345');
    const { getBackendUrl } = await import('../lib/backendUrl.js');

    const url = await getBackendUrl();
    expect(url).toBe('http://127.0.0.1:12345');

    await getBackendUrl();
    expect(mockGetBackendUrl).toHaveBeenCalledTimes(1);
  });

  it('kanata が null を返し続けると FALLBACK_URL を返す', async () => {
    vi.useFakeTimers();
    mockGetBackendUrl.mockResolvedValue(null);

    const { getBackendUrl } = await import('../lib/backendUrl.js');
    const promise = getBackendUrl();

    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }

    const url = await promise;
    expect(url).toBe('http://127.0.0.1:8000');
    vi.useRealTimers();
  });
});

describe('resetBackendUrlCache', () => {
  it('リセット後は再解決が走る', async () => {
    mockGetBackendUrl
      .mockResolvedValueOnce('http://127.0.0.1:11111')
      .mockResolvedValueOnce('http://127.0.0.1:22222');

    const { getBackendUrl, resetBackendUrlCache } = await import('../lib/backendUrl.js');
    expect(await getBackendUrl()).toBe('http://127.0.0.1:11111');

    resetBackendUrlCache();
    expect(await getBackendUrl()).toBe('http://127.0.0.1:22222');
  });
});
