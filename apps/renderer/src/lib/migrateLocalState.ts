import type { Watchlist } from '../types';
import { addWatchlistItem, createWatchlist } from './watchlistApi';

const MIGRATION_FLAG = 'kanata.migrated.v1';
const STATE_KEY = 'kanata.state';

interface LegacyState {
  selected?: string[];
}

function readLegacy(): string[] {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LegacyState;
    return Array.isArray(parsed.selected) ? parsed.selected : [];
  } catch {
    return [];
  }
}

function isMigrated(): boolean {
  try {
    return localStorage.getItem(MIGRATION_FLAG) === '1';
  } catch {
    return true;
  }
}

function markMigrated() {
  try {
    localStorage.setItem(MIGRATION_FLAG, '1');
  } catch {
    /* noop */
  }
}

function inferMarket(symbol: string): string {
  return /^\d{4}$/.test(symbol) ? 'JP' : 'US';
}

export async function migrateLegacyWatchlist(existing: Watchlist[]): Promise<Watchlist | null> {
  if (isMigrated()) return null;
  const legacy = readLegacy();
  if (legacy.length === 0) {
    markMigrated();
    return null;
  }
  if (existing.some((w) => w.name === 'Migrated from local')) {
    markMigrated();
    return null;
  }

  try {
    const created = await createWatchlist('Migrated from local');
    let latest = created;
    for (const symbol of legacy) {
      latest = await addWatchlistItem(created.id, {
        symbol,
        market: inferMarket(symbol),
      });
    }
    markMigrated();
    return latest;
  } catch {
    return null;
  }
}
