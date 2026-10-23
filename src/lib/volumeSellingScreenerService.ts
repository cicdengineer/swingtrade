import "server-only";
import { readDatabase } from "./localDatabase";
import { findVolumeSellingSignal } from "./volumeSellingLogic";
import type { DailyPriceRecord, UniverseName } from "./types";

export type VolumeSellingRow = NonNullable<ReturnType<typeof findVolumeSellingSignal>> & {
  security_id: string; symbol: string; company_name: string; universe_name: UniverseName;
  current_date: string; current_close: number; previous_close: number; current_high: number;
  distance_pct: number; recent: Pick<DailyPriceRecord, "trade_date" | "open" | "high" | "low" | "close" | "volume">[];
};

export async function runVolumeSellingScreener() {
  const db = await readDatabase();
  const bySecurity = new Map<string, DailyPriceRecord[]>();
  for (const price of db.daily_prices) {
    const list = bySecurity.get(price.security_id) ?? [];
    list.push(price);
    bySecurity.set(price.security_id, list);
  }
  const members = db.universe_members.filter(member => member.is_current_constituent && member.security_id);
  const seen = new Set<string>();
  const results: VolumeSellingRow[] = [];
  for (const member of members) {
    if (seen.has(member.security_id)) continue;
    seen.add(member.security_id);
    const prices = (bySecurity.get(member.security_id) ?? []).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    const current = prices.at(-1);
    if (!current) continue;
    const signal = findVolumeSellingSignal(prices);
    if (!signal || signal.signal_high <= 0) continue;
    const previous = prices.at(-2);
    results.push({ ...signal, security_id: member.security_id, symbol: member.symbol, company_name: member.company_name,
      universe_name: member.universe_name, current_date: current.trade_date, current_close: current.close,
      previous_close: previous?.close ?? current.close, current_high: current.high,
      distance_pct: (current.close / signal.signal_high - 1) * 100,
      recent: prices.slice(-150).map(({ trade_date, open, high, low, close, volume }) => ({ trade_date, open, high, low, close, volume })) });
  }
  results.sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct));
  return { evaluated: seen.size, qualified: results.length, results, generatedAt: new Date().toISOString() };
}
