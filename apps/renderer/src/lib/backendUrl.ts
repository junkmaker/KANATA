const FALLBACK_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

let cached: string | null = null;
let inflight: Promise<string> | null = null;

async function resolveFromPreload(): Promise<string> {
  const api = typeof window !== 'undefined' ? window.kanata : undefined;
  if (!api?.getBackendUrl) return FALLBACK_URL;
  try {
    const url = await api.getBackendUrl();
    return url ?? FALLBACK_URL;
  } catch {
    return FALLBACK_URL;
  }
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
