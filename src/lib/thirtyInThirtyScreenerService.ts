import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { calculateEma, calculateSma } from "./swingScreenerService";

export type ThirtyInThirtyFilters = {
  universe: UniverseName | "ALL";
  lookbackDays: number;
  windowDays: number;
  minReturnPct: number;
  minAverageDailyTradedValue: number;
  positive3MonthsOnly: boolean;
  positive6MonthsOnly: boolean;
  above50EmaOnly: boolean;
  nearPreviousDayHighOnly: boolean;
  upTodayOnly: boolean;
  nearSwingHighOnly: boolean;
  earlyVolumeOnly: boolean;
  highVolumeOnly: boolean;
  dryVolumeOnly: boolean;
  showAll: boolean;
};

export type ThirtyInThirtyRow = {
  status: "ELIGIBLE" | "NO_30D_MOVE" | "ILLIQUID" | "FILTERED";
  qualifies: boolean;
  security_id: string;
  symbol: string;
  company_name: string;
  universe_name: UniverseName;
  current_date: string;
  current_close: number;
  ema50: number;
  distance_from_ema_pct: number;
  best_return_pct: number;
  best_start_date?: string;
  best_start_close?: number;
  best_end_date?: string;
  best_end_close?: number;
  days_since_best_move: number;
  return_1m_pct: number;
  return_2m_pct: number;
  current_3m_return_pct: number;
  current_6m_return_pct: number;
  pullback_from_best_end_pct: number;
  pullback_from_3m_high_pct: number;
  pullback_from_6m_high_pct: number;
  breakout_level: number;
  breakout_distance_pct: number;
  within_3pct_breakout: boolean;
  tightness_5d_vs_20d: number;
  lowest_volume_5d_vs_20d: number;
  demand_supply_score: number;
  averageDailyTradedValue: number;
  reason: string;
  recent: Array<{
    trade_date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    ema50?: number;
    volume: number;
    volume_ratio?: number;
  }>;
};

export const defaultThirtyInThirtyFilters: ThirtyInThirtyFilters = {
  universe: "ALL",
  lookbackDays: 126,
  windowDays: 30,
  minReturnPct: 30,
  minAverageDailyTradedValue: 0,
  positive3MonthsOnly: false,
  positive6MonthsOnly: false,
  above50EmaOnly: false,
  nearPreviousDayHighOnly: false,
  upTodayOnly: false,
  nearSwingHighOnly: false,
  earlyVolumeOnly: false,
  highVolumeOnly: false,
  dryVolumeOnly: false,
  showAll: false,
};

type CacheValue = { key: string; expiresAt: number; value: Awaited<ReturnType<typeof calculateThirtyInThirtyScreener>> };
const globalCache = globalThis as typeof globalThis & { __thirtyInThirtyCache?: CacheValue };

const pct = (value: number, base: number) => (value / Math.max(0.01, base) - 1) * 100;
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function analyzeStock(input: {
  securityId: string;
  symbol: string;
  companyName: string;
  universeName: UniverseName;
  prices: DailyPriceRecord[];
  filters: ThirtyInThirtyFilters;
}): ThirtyInThirtyRow | null {
  const rows = [...input.prices].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const neededRows = input.filters.lookbackDays + input.filters.windowDays + 5;
  if (rows.length < Math.min(neededRows, 70)) return null;

  const currentIndex = rows.length - 1;
  const current = rows[currentIndex];
  const closes = rows.map((row) => row.close);
  const ema50 = calculateEma(closes, 50);
  const currentEma = ema50[currentIndex];
  if (!currentEma) return null;
  const distanceFromEma = pct(current.close, currentEma);
  const lookbackStart = Math.max(0, currentIndex - input.filters.lookbackDays - input.filters.windowDays + 1);
  const scanStart = Math.max(lookbackStart, currentIndex - input.filters.lookbackDays - input.filters.windowDays + 1);
  const scanEnd = Math.max(scanStart, currentIndex - input.filters.windowDays);
  let best = {
    returnPct: -Infinity,
    startIndex: scanStart,
    endIndex: Math.min(currentIndex, scanStart + input.filters.windowDays),
  };

  for (let startIndex = scanStart; startIndex <= scanEnd; startIndex += 1) {
    const endIndex = startIndex + input.filters.windowDays;
    if (endIndex > currentIndex) break;
    const returnPct = pct(rows[endIndex].close, rows[startIndex].close);
    if (returnPct > best.returnPct) best = { returnPct, startIndex, endIndex };
  }

  const volumeSma20 = calculateSma(rows.map((row) => row.volume), 20);
  const averageDailyTradedValue = avg(rows.slice(-20).map((row) => row.close * row.volume));
  const liquidPass = averageDailyTradedValue >= input.filters.minAverageDailyTradedValue;
  const movePass = best.returnPct >= input.filters.minReturnPct;
  const first1m = rows.slice(-21).at(0);
  const first2m = rows.slice(-42).at(0);
  const first3m = rows.slice(-63).at(0);
  const first6m = rows.slice(-126).at(0);
  const return1m = first1m ? pct(current.close, first1m.close) : 0;
  const return2m = first2m ? pct(current.close, first2m.close) : 0;
  const current3mReturn = first3m ? pct(current.close, first3m.close) : 0;
  const current6mReturn = first6m ? pct(current.close, first6m.close) : 0;
  const rows3m = rows.slice(-63);
  const rows6m = rows.slice(-126);
  const breakoutLevel = Math.max(...rows3m.map((row) => row.high));
  const breakoutDistance = pct(current.close, breakoutLevel);
  const pullbackFrom3mHigh = breakoutDistance;
  const pullbackFrom6mHigh = pct(current.close, Math.max(...rows6m.map((row) => row.high)));
  const bestEndClose = rows[best.endIndex]?.close ?? current.close;
  const pullbackFromBestEnd = pct(current.close, bestEndClose);
  const recentRanges5 = rows.slice(-5).map((row) => (row.high - row.low) / Math.max(0.01, row.close));
  const recentRanges20 = rows.slice(-20).map((row) => (row.high - row.low) / Math.max(0.01, row.close));
  const tightness5dVs20d = avg(recentRanges5) / Math.max(0.0001, avg(recentRanges20));
  const volumeAvg20 = avg(rows.slice(-20).map((row) => row.volume));
  const lowestVolume5dVs20d = Math.min(...rows.slice(-5).map((row) => row.volume)) / Math.max(1, volumeAvg20);
  const demandSupplyScore = Math.round(
    Math.min(best.returnPct, 60) * 0.7 +
    Math.max(0, 1 - tightness5dVs20d) * 25 +
    Math.max(0, 1 - lowestVolume5dVs20d) * 25 +
    (breakoutDistance >= -3 && breakoutDistance <= 0 ? 12 : 0)
  );
  const positive3mPass = !input.filters.positive3MonthsOnly || current3mReturn > 0;
  const positive6mPass = !input.filters.positive6MonthsOnly || current6mReturn > 0;
  let status: ThirtyInThirtyRow["status"] = "ELIGIBLE";
  if (!liquidPass) status = "ILLIQUID";
  else if (!movePass) status = "NO_30D_MOVE";
  else if (!positive3mPass || !positive6mPass) status = "FILTERED";
  const qualifies = liquidPass && movePass && positive3mPass && positive6mPass;
  const recent = rows.slice(-126).map((row, index, recentRows) => {
    const originalIndex = rows.length - recentRows.length + index;
    const volAvg = volumeSma20[originalIndex];
    return {
      trade_date: row.trade_date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      ema50: ema50[originalIndex],
      volume: row.volume,
      volume_ratio: volAvg ? row.volume / volAvg : undefined,
    };
  });

  return {
    status,
    qualifies,
    security_id: input.securityId,
    symbol: input.symbol,
    company_name: input.companyName,
    universe_name: input.universeName,
    current_date: current.trade_date,
    current_close: current.close,
    ema50: currentEma,
    distance_from_ema_pct: distanceFromEma,
    best_return_pct: Number.isFinite(best.returnPct) ? best.returnPct : 0,
    best_start_date: rows[best.startIndex]?.trade_date,
    best_start_close: rows[best.startIndex]?.close,
    best_end_date: rows[best.endIndex]?.trade_date,
    best_end_close: rows[best.endIndex]?.close,
    days_since_best_move: currentIndex - best.endIndex,
    return_1m_pct: return1m,
    return_2m_pct: return2m,
    current_3m_return_pct: current3mReturn,
    current_6m_return_pct: current6mReturn,
    pullback_from_best_end_pct: pullbackFromBestEnd,
    pullback_from_3m_high_pct: pullbackFrom3mHigh,
    pullback_from_6m_high_pct: pullbackFrom6mHigh,
    breakout_level: breakoutLevel,
    breakout_distance_pct: breakoutDistance,
    within_3pct_breakout: breakoutDistance >= -3 && breakoutDistance <= 0,
    tightness_5d_vs_20d: tightness5dVs20d,
    lowest_volume_5d_vs_20d: lowestVolume5dVs20d,
    demand_supply_score: demandSupplyScore,
    averageDailyTradedValue,
    reason: qualifies
      ? `Best ${input.filters.windowDays}-session return was ${best.returnPct.toFixed(1)}% inside the last ${input.filters.lookbackDays} sessions.`
      : !liquidPass
        ? "Average daily traded value is below the selected threshold."
        : !movePass
          ? `No ${input.filters.minReturnPct}% move was found in any ${input.filters.windowDays}-session window.`
          : "Filtered out by positive 3M / 6M performance setting.",
    recent,
  };
}

async function calculateThirtyInThirtyScreener(filters: Partial<ThirtyInThirtyFilters> = {}) {
  const merged = { ...defaultThirtyInThirtyFilters, ...filters };
  const db = await readDatabase();
  const members = db.universe_members.filter((member) =>
    member.is_current_constituent &&
    member.security_id &&
    (merged.universe === "ALL" || member.universe_name === merged.universe)
  );
  const pricesBySecurity = new Map<string, DailyPriceRecord[]>();
  for (const price of db.daily_prices) {
    const list = pricesBySecurity.get(price.security_id);
    if (list) list.push(price);
    else pricesBySecurity.set(price.security_id, [price]);
  }
  const rows = members.flatMap((member) => {
    const row = analyzeStock({
      securityId: member.security_id,
      symbol: member.symbol,
      companyName: member.company_name,
      universeName: member.universe_name,
      prices: pricesBySecurity.get(member.security_id) ?? [],
      filters: merged,
    });
    return row ? [row] : [];
  });
  const results = rows.filter((row) => merged.showAll || row.qualifies).sort((a, b) => b.best_return_pct - a.best_return_pct);
  const statusSummary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  return { filters: merged, evaluated: rows.length, qualified: rows.filter((row) => row.qualifies).length, statusSummary, results, generatedAt: new Date().toISOString() };
}

export async function runThirtyInThirtyScreener(filters: Partial<ThirtyInThirtyFilters> = {}) {
  const merged = { ...defaultThirtyInThirtyFilters, ...filters };
  const key = JSON.stringify(merged);
  const cached = globalCache.__thirtyInThirtyCache;
  if (cached?.key === key && cached.expiresAt > Date.now()) return cached.value;
  const value = await calculateThirtyInThirtyScreener(merged);
  globalCache.__thirtyInThirtyCache = { key, value, expiresAt: Date.now() + 60_000 };
  return value;
}

export async function getThirtyInThirtyScreenerDetail(securityId: string) {
  const response = await runThirtyInThirtyScreener({ showAll: true });
  return response.results.find((row) => row.security_id === securityId) ?? null;
}
