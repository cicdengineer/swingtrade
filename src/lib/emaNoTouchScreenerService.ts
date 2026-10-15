import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { findEmaNoTouch } from "./emaNoTouchLogic";

export type EmaNoTouchFilters = { universe: UniverseName | "ALL"; minAverageDailyTradedValue: number; maxSignalAgeSessions: number };
export const defaultEmaNoTouchFilters: EmaNoTouchFilters = { universe: "ALL", minAverageDailyTradedValue: 0, maxSignalAgeSessions: 20 };

export function analyzeEmaNoTouchStock(input: { securityId: string; symbol: string; companyName: string; universeName: UniverseName; prices: DailyPriceRecord[]; filters: EmaNoTouchFilters }) {
  const setup = findEmaNoTouch(input.prices, input.filters.maxSignalAgeSessions);
  if (!setup) return null;
  const { anchor, anchorEma10, current, currentEma10, recent } = setup;
  const valueRows = recent.slice(-20);
  const averageDailyTradedValue = valueRows.reduce((sum, row) => sum + row.close * row.volume, 0) / valueRows.length;
  if (averageDailyTradedValue < input.filters.minAverageDailyTradedValue) return null;
  return {
    security_id: input.securityId, symbol: input.symbol, company_name: input.companyName,
    universe_name: input.universeName, current_date: current.trade_date, current_close: current.close,
    ema10: currentEma10, distance_from_10ema_pct: (current.close / currentEma10 - 1) * 100,
    signal_date: anchor.trade_date, entry_high: anchor.high, stop_loss: anchorEma10,
    risk_pct: (anchor.high / anchorEma10 - 1) * 100,
    distance_to_entry_pct: (current.close / anchor.high - 1) * 100,
    signal_age_sessions: setup.signalAgeSessions, triggered: setup.triggered,
    averageDailyTradedValue,
    reason: `${anchor.trade_date} low ${anchor.low.toFixed(2)} stayed above its 10 EMA ${anchorEma10.toFixed(2)}. Entry above ${anchor.high.toFixed(2)}; stop loss at that candle's 10 EMA. The level remains active until a completed candle closes below its 10 EMA.`,
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
  }).sort((a, b) => Number(b.triggered) - Number(a.triggered) || b.distance_to_entry_pct - a.distance_to_entry_pct);
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
