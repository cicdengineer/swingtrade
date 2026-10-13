import "server-only";
import type { DailyPriceRecord } from "./types";
import { readDatabase } from "./localDatabase";
import { buildObservationsForStock, seasonalWindows, summariseSeasonalStatistics } from "./seasonalityEngine";
import { analyzeStock, defaultThirtyInThirtyFilters, type ThirtyInThirtyFilters, type ThirtyInThirtyRow } from "./thirtyInThirtyScreenerService";

export type SeasonalStockRow = ThirtyInThirtyRow & {
  seasonal_avg_return: number;
  seasonal_observations: number;
  seasonal_window: string;
};

// The selected month is the first month of its three-month historical window.
// A window enters the watchlist only when its mean completed-year return exceeds 30%.
export async function runSeasonalStocks(month: number) {
  const selectedMonth = Number.isInteger(month) && month >= 0 && month < 12 ? month : new Date().getMonth();
  const window = seasonalWindows[selectedMonth];
  const indiaTodayParts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const completedThrough = `${indiaTodayParts.year}-${indiaTodayParts.month}-${indiaTodayParts.day}`;
  const db = await readDatabase();
  const pricesBySecurity = new Map<string, DailyPriceRecord[]>();
  for (const price of db.daily_prices) {
    const prices = pricesBySecurity.get(price.security_id) ?? [];
    prices.push(price);
    pricesBySecurity.set(price.security_id, prices);
  }
  const analysisFilters: ThirtyInThirtyFilters = { ...defaultThirtyInThirtyFilters, minReturnPct: -Infinity };
  const rows: SeasonalStockRow[] = [];
  const seen = new Set<string>();
  for (const member of db.universe_members) {
    if (!member.is_current_constituent || !member.security_id || seen.has(member.security_id)) continue;
    seen.add(member.security_id);
    const prices = pricesBySecurity.get(member.security_id) ?? [];
    if (!prices.length) continue;
    const observations = buildObservationsForStock({
      securityId: member.security_id,
      symbol: member.symbol,
      companyName: member.company_name,
      sector: "Unknown",
      universeName: member.universe_name,
      prices,
      windowKey: window.key,
      completedThrough,
    }).observations.filter((observation) =>
      Number(observation.entry_date.slice(5, 7)) === window.startMonth + 1 &&
      Number(observation.exit_date.slice(5, 7)) === window.endMonth + 1
    );
    const stats = summariseSeasonalStatistics(observations);
    if (!stats || stats.avg_return <= 30) continue;
    const technical = analyzeStock({
      securityId: member.security_id,
      symbol: member.symbol,
      companyName: member.company_name,
      universeName: member.universe_name,
      prices,
      filters: analysisFilters,
    });
    if (!technical) continue;
    rows.push({
      ...technical,
      status: "ELIGIBLE",
      qualifies: true,
      reason: `${window.label}: ${stats.avg_return.toFixed(1)}% average return across ${stats.observation_count} completed historical windows.`,
      seasonal_avg_return: stats.avg_return,
      seasonal_observations: stats.observation_count,
      seasonal_window: window.label,
    });
  }
  rows.sort((a, b) => b.seasonal_avg_return - a.seasonal_avg_return);
  return {
    month: selectedMonth,
    window,
    evaluated: seen.size,
    qualified: rows.length,
    results: rows,
    generatedAt: new Date().toISOString(),
  };
}
