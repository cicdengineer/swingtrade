import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { calculateEma, calculateSma } from "./swingScreenerService";

export type HourlyBreakoutFilters = {
  universe: UniverseName | "ALL";
  lookbackDays: number;
  minConsolidationDays: number;
  maxPullbackPct: number;
  maxBreakoutProximityPct: number;
  maxBreakoutOvershootPct: number;
  minTrendGainPct: number;
  maxCurrentVolumeRatio: number;
  showAll: boolean;
};

export type HourlyBreakoutRow = {
  status: "SETUP" | "BELOW 50 EMA" | "NOT GREEN" | "NO CONSOLIDATION" | "PULLBACK TOO DEEP" | "FAR FROM BREAKOUT";
  qualifies: boolean;
  security_id: string;
  symbol: string;
  company_name: string;
  universe_name: UniverseName;
  current_date: string;
  current_close: number;
  ema50: number;
  distance_from_ema_pct: number;
  trend_gain_pct: number;
  consolidation_days: number;
  breakout_zone: number;
  breakout_distance_pct: number;
  pullback_from_zone_pct: number;
  current_volume_ratio?: number;
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

export const defaultHourlyBreakoutFilters: HourlyBreakoutFilters = {
  universe: "ALL",
  lookbackDays: 25,
  minConsolidationDays: 5,
  maxPullbackPct: 8,
  maxBreakoutProximityPct: 3,
  maxBreakoutOvershootPct: 1,
  minTrendGainPct: 0,
  maxCurrentVolumeRatio: 2,
  showAll: false,
};

const pct = (value: number, base: number) => (value / base - 1) * 100;

function analyzeHourlyBreakoutStock(input: {
  securityId: string;
  symbol: string;
  companyName: string;
  universeName: UniverseName;
  prices: DailyPriceRecord[];
  filters: HourlyBreakoutFilters;
}): HourlyBreakoutRow | null {
  const rows = [...input.prices].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  if (rows.length < 80) return null;

  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume);
  const ema50 = calculateEma(closes, 50);
  const volumeSma20 = calculateSma(volumes, 20);
  const currentIndex = rows.length - 1;
  const current = rows[currentIndex];
  const currentEma = ema50[currentIndex];
  const currentVolAvg = volumeSma20[currentIndex];
  if (!currentEma || !currentVolAvg) return null;

  const consolidationDays = Math.max(1, input.filters.minConsolidationDays);
  const consolidationStart = Math.max(50, currentIndex - Math.max(input.filters.lookbackDays, consolidationDays) + 1);
  const consolidationRows = rows.slice(Math.max(consolidationStart, currentIndex - consolidationDays + 1), currentIndex + 1);
  if (consolidationRows.length < consolidationDays) return null;

  const trendBaseIndex = Math.max(50, currentIndex - input.filters.lookbackDays + 1);
  const trendGain = pct(current.close, rows[trendBaseIndex].close);
  const distance = pct(current.close, currentEma);
  const breakoutZone = Math.max(...consolidationRows.map((row) => row.high));
  const consolidationLow = Math.min(...consolidationRows.map((row) => row.low));
  const pullbackFromZone = pct(consolidationLow, breakoutZone);
  const breakoutDistance = pct(current.close, breakoutZone);
  const currentVolumeRatio = current.volume / currentVolAvg;

  const reasons: string[] = [];
  let status: HourlyBreakoutRow["status"] = "SETUP";

  if (distance < 0) {
    status = "BELOW 50 EMA";
    reasons.push("Current close is below daily 50 EMA.");
  }
  if (trendGain < input.filters.minTrendGainPct) {
    status = "NOT GREEN";
    reasons.push("Overall lookback return is not green enough.");
  }
  if (consolidationRows.length < input.filters.minConsolidationDays) {
    status = "NO CONSOLIDATION";
    reasons.push("Minimum consolidation days are not available.");
  }
  if (pullbackFromZone < -input.filters.maxPullbackPct) {
    status = "PULLBACK TOO DEEP";
    reasons.push(`Consolidation pullback is deeper than -${input.filters.maxPullbackPct}%.`);
  }
  if (breakoutDistance < -input.filters.maxBreakoutProximityPct || breakoutDistance > input.filters.maxBreakoutOvershootPct) {
    status = "FAR FROM BREAKOUT";
    reasons.push("Current close is not near the breakout zone.");
  }
  const qualifies = reasons.length === 0;
  const recent = rows.slice(-120).map((row, index, recentRows) => {
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
    distance_from_ema_pct: distance,
    trend_gain_pct: trendGain,
    consolidation_days: consolidationRows.length,
    breakout_zone: breakoutZone,
    breakout_distance_pct: breakoutDistance,
    pullback_from_zone_pct: pullbackFromZone,
    current_volume_ratio: currentVolumeRatio,
    reason: qualifies ? "Above daily 50 EMA, overall green, consolidating, and close to breakout zone." : reasons.join(" "),
    recent,
  };
}

export async function runHourlyBreakoutScreener(filters: Partial<HourlyBreakoutFilters> = {}) {
  const merged = { ...defaultHourlyBreakoutFilters, ...filters };
  const db = await readDatabase();
  const members = db.universe_members.filter((member) =>
    member.is_current_constituent &&
    member.security_id &&
    (merged.universe === "ALL" || member.universe_name === merged.universe)
  );
  const rows = members.flatMap((member) => {
    const prices = db.daily_prices.filter((price) => price.security_id === member.security_id);
    const row = analyzeHourlyBreakoutStock({
      securityId: member.security_id,
      symbol: member.symbol,
      companyName: member.company_name,
      universeName: member.universe_name,
      prices,
      filters: merged,
    });
    return row ? [row] : [];
  });
  const results = rows.filter((row) => merged.showAll || row.qualifies).sort((a, b) => {
    if (a.qualifies !== b.qualifies) return Number(b.qualifies) - Number(a.qualifies);
    return Math.abs(a.breakout_distance_pct) - Math.abs(b.breakout_distance_pct);
  });
  const statusSummary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  return { filters: merged, evaluated: rows.length, qualified: rows.filter((row) => row.qualifies).length, statusSummary, results };
}
