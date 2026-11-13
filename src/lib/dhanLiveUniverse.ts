import "server-only";
import { dhanLiveFeed } from "./dhanLiveFeed";
import { readDatabase } from "./localDatabase";

const state = globalThis as typeof globalThis & {
  __dhanUniverseRefresh?: Promise<void>;
  __dhanUniverseUpdatedAt?: number;
};

export function ensureDhanLiveUniverse(): Promise<void> {
  if (state.__dhanUniverseRefresh) return state.__dhanUniverseRefresh;
  if (Date.now() - (state.__dhanUniverseUpdatedAt ?? 0) < 60_000) return Promise.resolve();
  state.__dhanUniverseRefresh = (async () => {
    const db = await readDatabase();
    const ids = [...new Set(db.daily_prices.map(row => row.security_id).filter(Boolean))];
    if (ids.length) dhanLiveFeed.subscribe(ids);
    state.__dhanUniverseUpdatedAt = Date.now();
  })().finally(() => { state.__dhanUniverseRefresh = undefined; });
  return state.__dhanUniverseRefresh;
}
