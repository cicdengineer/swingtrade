import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { calculateEma, calculateSma } from "./swingScreenerService";

export type ThirtyUpFilters = {
  universe: UniverseName | "ALL";
  lookbackDays: number;
  minMovePct: number;
  minImpulseVolumeRatio: number;
  minDistanceFromEmaPct: number;
  maxDistanceFromEmaPct: number;
  higherHighLookbackDays: number;
  minHigherHighCount: number;
  consolidationLookbackDays: number;
  minConsolidationDays: number;
  maxBasePullbackPct: number;
  maxBreakoutProximityPct: number;
  maxBreakoutOvershootPct: number;
  maxCurrentVolumeRatio: number;
  requireRisingEma: boolean;
  showAll: boolean;
};

export type ThirtyUpRow = {
  status: "SETUP" | "WATCHLIST" | "NO 30% MOVE" | "WEAK VOLUME" | "BELOW 50 EMA" | "FAR FROM BREAKOUT";
  qualifies: boolean;
  security_id: string;
  symbol: string;
  company_name: string;
  universe_name: UniverseName;
  current_date: string;
  current_close: number;
  ema50: number;
  distance_from_ema_pct: number;
  low_date?: string;
  low_close?: number;
  high_date?: string;
  high_close?: number;
  move_pct?: number;
  impulse_volume_ratio?: number;
  days_low_to_high?: number;
  days_since_high?: number;
  pullback_from_high_pct?: number;
  retracement_pct?: number;
  current_volume_ratio?: number;
  ema50_slope_pct?: number;
  higher_high_count?: number;
  consolidation_days?: number;
  base_low_date?: string;
  base_low_close?: number;
  base_depth_pct?: number;
  breakout_distance_pct?: number;
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

export const defaultThirtyUpFilters: ThirtyUpFilters = {
  universe: "ALL",
  lookbackDays: 63,
  minMovePct: 30,
  minImpulseVolumeRatio: 1.8,
  minDistanceFromEmaPct: 0,
  maxDistanceFromEmaPct: 25,
  higherHighLookbackDays: 35,
  minHigherHighCount: 0,
  consolidationLookbackDays: 25,
  minConsolidationDays: 0,
  maxBasePullbackPct: 100,
  maxBreakoutProximityPct: 3,
  maxBreakoutOvershootPct: 2,
  maxCurrentVolumeRatio: 2,
  requireRisingEma: true,
  showAll: false,
};

const pct = (value: number, base: number) => (value / base - 1) * 100;

function recordHighCount(rows: DailyPriceRecord[], startIndex: number, endIndex: number) {
  let count = 0;
  let priorHigh = -Infinity;
  for (let index = Math.max(0, startIndex); index <= endIndex; index += 1) {
    const lookbackStart = Math.max(0, index - 5);
    const localPriorHigh = Math.max(priorHigh, ...rows.slice(lookbackStart, index).map((row) => row.high));
    if (rows[index].high > localPriorHigh) {
      count += 1;
      priorHigh = rows[index].high;
    }
  }
  return count;
}

function analyzeThirtyUpStock(input: {
  securityId: string;
  symbol: string;
  companyName: string;
  universeName: UniverseName;
  prices: DailyPriceRecord[];
  filters: ThirtyUpFilters;
}): ThirtyUpRow | null {
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

  const start = Math.max(50, currentIndex - input.filters.lookbackDays + 1);
  let lowIndex = start;
  for (let index = start + 1; index <= currentIndex; index += 1) {
    if (rows[index].close < rows[lowIndex].close) lowIndex = index;
  }

  let highIndex = lowIndex;
  for (let index = lowIndex + 1; index <= currentIndex; index += 1) {
    if (rows[index].close > rows[highIndex].close) highIndex = index;
  }

  const movePct = pct(rows[highIndex].close, rows[lowIndex].close);
  const impulseVolumeRatio = Math.max(
    ...rows.slice(lowIndex, highIndex + 1).map((_, offset) => {
      const originalIndex = lowIndex + offset;
      const avg = volumeSma20[originalIndex];
      return avg ? rows[originalIndex].volume / avg : 0;
    }),
  );
  const distance = pct(current.close, currentEma);
  const slopeBaseIndex = Math.max(0, currentIndex - 10);
  const slopeBase = ema50[slopeBaseIndex];
  const emaSlope = slopeBase ? pct(currentEma, slopeBase) : 0;
  const currentVolumeRatio = current.volume / currentVolAvg;
  const higherHighStart = Math.max(start, currentIndex - input.filters.higherHighLookbackDays + 1);
  const higherHighCount = recordHighCount(rows, higherHighStart, currentIndex);
  const consolidationStart = Math.max(highIndex + 1, currentIndex - input.filters.consolidationLookbackDays + 1);
  const consolidationRows = rows.slice(consolidationStart, currentIndex + 1);
  const consolidationDays = consolidationRows.length;
  const baseLow = consolidationRows.reduce<{ row: DailyPriceRecord; index: number } | undefined>((lowest, row, offset) => {
    const originalIndex = consolidationStart + offset;
    if (!lowest || row.low < lowest.row.low) return { row, index: originalIndex };
    return lowest;
  }, undefined);
  const breakoutZone = Math.max(...rows.slice(Math.max(start, highIndex - 4), currentIndex + 1).map((row) => row.high));
  const baseDepth = baseLow ? pct(baseLow.row.low, breakoutZone) : undefined;
  const breakoutDistance = pct(current.close, breakoutZone);
  const pullbackFromHigh = pct(current.close, breakoutZone);
  const retracementPct = baseLow ? ((breakoutZone - current.close) / Math.max(0.01, breakoutZone - baseLow.row.low)) * 100 : undefined;

  const reasons: string[] = [];
  let status: ThirtyUpRow["status"] = "WATCHLIST";

  if (movePct < input.filters.minMovePct) {
    status = "NO 30% MOVE";
    reasons.push(`Best move in the last ${input.filters.lookbackDays} sessions is below ${input.filters.minMovePct}%.`);
  }
  if (impulseVolumeRatio < input.filters.minImpulseVolumeRatio) {
    status = "WEAK VOLUME";
    reasons.push(`Impulse volume is below ${input.filters.minImpulseVolumeRatio.toFixed(1)}x.`);
  }
  if (distance < input.filters.minDistanceFromEmaPct) {
    status = "BELOW 50 EMA";
    reasons.push("Current price is below the configured daily 50 EMA distance.");
  }
  if (distance > input.filters.maxDistanceFromEmaPct) reasons.push("Current price is extended from the daily 50 EMA.");
  if (input.filters.requireRisingEma && emaSlope <= 0) reasons.push("Daily 50 EMA is not rising.");
  if (breakoutDistance < -input.filters.maxBreakoutProximityPct || breakoutDistance > input.filters.maxBreakoutOvershootPct) {
    status = "FAR FROM BREAKOUT";
    reasons.push("Current price is not within the configured breakout zone.");
  }
  if (currentVolumeRatio > input.filters.maxCurrentVolumeRatio) reasons.push("Current volume is above the base-volume threshold.");

  const qualifies = reasons.length === 0;
  if (qualifies) status = "SETUP";

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
    low_date: rows[lowIndex].trade_date,
    low_close: rows[lowIndex].close,
    high_date: rows[highIndex].trade_date,
    high_close: breakoutZone,
    move_pct: movePct,
    impulse_volume_ratio: impulseVolumeRatio,
    days_low_to_high: highIndex - lowIndex,
    days_since_high: currentIndex - highIndex,
    pullback_from_high_pct: pullbackFromHigh,
    retracement_pct: retracementPct,
    current_volume_ratio: currentVolumeRatio,
    ema50_slope_pct: emaSlope,
    higher_high_count: higherHighCount,
    consolidation_days: consolidationDays,
    base_low_date: baseLow?.row.trade_date,
    base_low_close: baseLow?.row.low,
    base_depth_pct: baseDepth,
    breakout_distance_pct: breakoutDistance,
    reason: qualifies ? "30% strength with volume is intact inside the lookback, price is above the daily 50 EMA, and it is near the breakout zone." : reasons.join(" "),
    recent,
  };
}

export async function runThirtyUpScreener(filters: Partial<ThirtyUpFilters> = {}) {
  const merged = { ...defaultThirtyUpFilters, ...filters };
  const db = await readDatabase();
  const members = db.universe_members.filter((member) =>
    member.is_current_constituent &&
    member.security_id &&
    (merged.universe === "ALL" || member.universe_name === merged.universe)
  );
  const rows = members.flatMap((member) => {
    const prices = db.daily_prices.filter((price) => price.security_id === member.security_id);
    const row = analyzeThirtyUpStock({
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
    if ((a.breakout_distance_pct ?? -Infinity) !== (b.breakout_distance_pct ?? -Infinity)) {
      return Math.abs(a.breakout_distance_pct ?? Infinity) - Math.abs(b.breakout_distance_pct ?? Infinity);
    }
    return (b.move_pct ?? -Infinity) - (a.move_pct ?? -Infinity);
  });
  const statusSummary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  return { filters: merged, evaluated: rows.length, qualified: rows.filter((row) => row.qualifies).length, statusSummary, results };
}

export async function getThirtyUpScreenerDetail(securityId: string) {
  const response = await runThirtyUpScreener({ showAll: true });
  return response.results.find((row) => row.security_id === securityId) ?? null;
}
