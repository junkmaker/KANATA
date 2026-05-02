const FALLBACK_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const RETRY_COUNT = 10;
const RETRY_INTERVAL_MS = 200;

let cached: string | null = null;
let inflight: Promise<string> | null = null;

async function resolveFromPreload(): Promise<string> {
  const api = typeof window !== 'undefined' ? window.kanata : undefined;
  if (!api?.getBackendUrl) return FALLBACK_URL;
  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const url = await api.getBackendUrl();
      if (url) return url;
    } catch {
      /* retry */
    }
    await new Promise<void>((r) => setTimeout(r, RETRY_INTERVAL_MS));
  }
  return FALLBACK_URL;
}

export async function getBackendUrl(): Promise<string> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = resolveFromPreload().then((url) => {
    cached = url;
    inflight = null;
    return url;
  });
  return inflight;
}

export function resetBackendUrlCache(): void {
  cached = null;
  inflight = null;
}

export function subscribeBackendUrlChange(): () => void {
  const api = typeof window !== 'undefined' ? window.kanata : undefined;
  if (!api?.onBackendStatus) return () => {};
  return api.onBackendStatus((payload) => {
    if (payload.status === 'ready' && payload.url) {
      cached = payload.url;
    } else {
      resetBackendUrlCache();
    }
  });
}
