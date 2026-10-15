import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { findEmaCatchup, type EmaCatchupCriteria } from "./emaNoTouchLogic";

export type EmaNoTouchFilters = EmaCatchupCriteria & { universe: UniverseName | "ALL"; minAverageDailyTradedValue: number };
export const defaultEmaNoTouchFilters: EmaNoTouchFilters = { universe: "ALL", minAverageDailyTradedValue: 0,
  baseDays: 5, minPriorAdvancePct: 8, maxBaseRangePct: 7, maxDistanceFromEmaPct: 4, minCatchupPct: 0.5 };

export function analyzeEmaNoTouchStock(input: { securityId: string; symbol: string; companyName: string; universeName: UniverseName; prices: DailyPriceRecord[]; filters: EmaNoTouchFilters }) {
  const setup = findEmaCatchup(input.prices, input.filters);
  if (!setup) return null;
  const { current, currentEma, recent, swingLow } = setup;
  const valueRows = recent.slice(-20);
  const averageDailyTradedValue = valueRows.reduce((sum, row) => sum + row.close * row.volume, 0) / valueRows.length;
  if (averageDailyTradedValue < input.filters.minAverageDailyTradedValue) return null;
  return {
    security_id: input.securityId, symbol: input.symbol, company_name: input.companyName,
    universe_name: input.universeName, current_date: current.trade_date, current_close: current.close,
    ema10: currentEma, distance_from_10ema_pct: setup.currentGapPct,
    swing_low_date: swingLow.trade_date, stop_loss: swingLow.low,
    risk_pct: (current.close / swingLow.low - 1) * 100,
    prior_advance_pct: setup.priorAdvancePct, ema_slope_pct: setup.emaSlopePct,
    catchup_pct: setup.catchupPct, base_range_pct: setup.baseRangePct,
    averageDailyTradedValue,
    reason: `Prior 20-session advance ${setup.priorAdvancePct.toFixed(1)}%; latest ${input.filters.baseDays} sessions stayed within ${setup.baseRangePct.toFixed(1)}%. The rising 10 EMA caught up by ${setup.catchupPct.toFixed(1)} percentage points. Swing-low stop is ${swingLow.low.toFixed(2)} (${swingLow.trade_date}).`,
    recent,
  };
}

async function calculate(filters: EmaNoTouchFilters) {
  const db = await readDatabase();
  const pricesBySecurity = new Map<string, DailyPriceRecord[]>();
  for (const price of db.daily_prices) {
    const list = pricesBySecurity.get(price.security_id);
    if (list) list.push(price); else pricesBySecurity.set(price.security_id, [price]);
  }
  const seen = new Set<string>();
  const members = db.universe_members.filter((member) => member.is_current_constituent && member.security_id && (filters.universe === "ALL" || member.universe_name === filters.universe));
  const results = members.flatMap((member) => {
    if (seen.has(member.security_id)) return [];
    seen.add(member.security_id);
    const row = analyzeEmaNoTouchStock({ securityId: member.security_id, symbol: member.symbol, companyName: member.company_name,
      universeName: member.universe_name, prices: pricesBySecurity.get(member.security_id) ?? [], filters });
    return row ? [row] : [];
  }).sort((a, b) => a.distance_from_10ema_pct - b.distance_from_10ema_pct);
  return { filters, evaluated: seen.size, qualified: results.length, results, generatedAt: new Date().toISOString() };
}

type Response = Awaited<ReturnType<typeof calculate>>;
const globalCache = globalThis as typeof globalThis & { __emaNoTouchCache?: { key: string; expiresAt: number; value: Response } };
export async function runEmaNoTouchScreener(input: Partial<EmaNoTouchFilters> = {}) {
  const filters = { ...defaultEmaNoTouchFilters, ...input };
  const key = JSON.stringify(filters);
  const cached = globalCache.__emaNoTouchCache;
  if (cached?.key === key && cached.expiresAt > Date.now()) return cached.value;
  const value = await calculate(filters);
  globalCache.__emaNoTouchCache = { key, value, expiresAt: Date.now() + 60_000 };
  return value;
}
