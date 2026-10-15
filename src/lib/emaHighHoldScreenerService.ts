import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { findEmaHighHold } from "./emaHighHoldLogic";

export type EmaHighHoldFilters = { universe: UniverseName | "ALL"; minAverageDailyTradedValue: number; showAll: boolean };
export const defaultEmaHighHoldFilters: EmaHighHoldFilters = { universe: "ALL", minAverageDailyTradedValue: 0, showAll: false };

export function analyzeEmaHighHoldStock(input: { securityId: string; symbol: string; companyName: string; universeName: UniverseName; prices: DailyPriceRecord[]; filters: EmaHighHoldFilters }) {
  const setup = findEmaHighHold(input.prices);
  if (!setup) return null;
  const { anchor, recent, ema10 } = setup;
  const current = recent.at(-1)!;
  const averageDailyTradedValue = recent.slice(-20).reduce((sum, row) => sum + row.close * row.volume, 0) / Math.min(20, recent.length);
  const liquid = averageDailyTradedValue >= input.filters.minAverageDailyTradedValue;
  const qualifies = setup.qualifies && liquid;
  const distanceToHighPct = (current.close / anchor.high - 1) * 100;
  return {
    status: qualifies ? "SETUP" as const : !liquid ? "ILLIQUID" as const : "NO_SETUP" as const,
    qualifies, security_id: input.securityId, symbol: input.symbol, company_name: input.companyName,
    universe_name: input.universeName, current_date: current.trade_date, current_close: current.close,
    ema10, distance_from_10ema_pct: (current.close / ema10 - 1) * 100,
    high_candle_date: anchor.trade_date, high_candle_high: anchor.high,
    distance_to_high_pct: distanceToHighPct, averageDailyTradedValue,
    reason: qualifies
      ? `The ${anchor.trade_date} candle made a higher high at ${anchor.high.toFixed(2)}. The next three completed candles closed at or below that high and at or above their 10 EMA.`
      : !liquid ? "Average daily traded value is below the selected threshold."
      : !setup.madeHigh ? "The anchor candle did not make a higher high than the preceding candle."
      : !setup.aboveEma ? "The anchor or a holding candle closed below its 10 EMA."
      : "A holding candle closed above the anchor candle high.",
    recent,
  };
}

async function calculate(filters: EmaHighHoldFilters) {
  const db = await readDatabase();
  const pricesBySecurity = new Map<string, DailyPriceRecord[]>();
  for (const price of db.daily_prices) {
    const list = pricesBySecurity.get(price.security_id);
    if (list) list.push(price); else pricesBySecurity.set(price.security_id, [price]);
  }
  const seen = new Set<string>();
  const rows = db.universe_members.flatMap((member) => {
    if (!member.is_current_constituent || !member.security_id || seen.has(member.security_id) || (filters.universe !== "ALL" && member.universe_name !== filters.universe)) return [];
    seen.add(member.security_id);
    const row = analyzeEmaHighHoldStock({ securityId: member.security_id, symbol: member.symbol, companyName: member.company_name,
      universeName: member.universe_name, prices: pricesBySecurity.get(member.security_id) ?? [], filters });
    return row ? [row] : [];
  });
  return { filters, evaluated: rows.length, qualified: rows.filter((row) => row.qualifies).length,
    results: rows.filter((row) => filters.showAll || row.qualifies).sort((a, b) => b.distance_to_high_pct - a.distance_to_high_pct),
    generatedAt: new Date().toISOString() };
}

type Response = Awaited<ReturnType<typeof calculate>>;
const globalCache = globalThis as typeof globalThis & { __emaHighHoldCache?: { key: string; expiresAt: number; value: Response } };
export async function runEmaHighHoldScreener(input: Partial<EmaHighHoldFilters> = {}) {
  const filters = { ...defaultEmaHighHoldFilters, ...input };
  const key = JSON.stringify(filters);
  const cached = globalCache.__emaHighHoldCache;
  if (cached?.key === key && cached.expiresAt > Date.now()) return cached.value;
  const value = await calculate(filters);
  globalCache.__emaHighHoldCache = { key, value, expiresAt: Date.now() + 60_000 };
  return value;
}
