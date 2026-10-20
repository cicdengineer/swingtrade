import "server-only";
import { readDatabase } from "./localDatabase";
import { calculateStochRsiD } from "./stochRsiScreenerService";
import { findSwingHighSignals } from "./swingHighLogic";
import type { UniverseName, DailyPriceRecord } from "./types";

export async function runSwingHighScreener(universe: UniverseName | "ALL" = "ALL") {
  const db = await readDatabase();
  const prices = new Map<string, DailyPriceRecord[]>();
  for (const row of db.daily_prices) {
    const list = prices.get(row.security_id);
    if (list) list.push(row);
    else prices.set(row.security_id, [row]);
  }
  const results = db.universe_members.filter(member => member.is_current_constituent && member.security_id && (universe === "ALL" || member.universe_name === universe)).flatMap(member => {
    const rows = (prices.get(member.security_id) ?? []).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    if (rows.length < 70) return [];
    const d = calculateStochRsiD(rows.map(row => row.close));
    const { signals, activeLevel } = findSwingHighSignals(rows, d);
    const recentSignals = signals.filter(signal => rows.findIndex(row => row.trade_date === signal.breakout_date) >= rows.length - 30);
    if (!recentSignals.length) return [];
    return [{ security_id: member.security_id, latest_signal: recentSignals.at(-1)!, signals: recentSignals, active_level: activeLevel, current_date: rows.at(-1)!.trade_date }];
  });
  return { results, generatedAt: new Date().toISOString() };
}
