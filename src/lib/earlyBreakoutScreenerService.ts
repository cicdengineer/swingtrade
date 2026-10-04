import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { calculateEma, calculateSma } from "./swingScreenerService";

export type EarlyBreakoutFilters = {
  universe: UniverseName | "ALL";
  lookbackDays: number;
  minFirstMovePct: number;
  minImpulseVolumeRatio: number;
  minConsolidationDays: number;
  maxConsolidationDays: number;
  maxPullbackPct: number;
  maxBreakoutProximityPct: number;
  maxBreakoutOvershootPct: number;
  requireAboveEma: boolean;
  requireRisingEma: boolean;
  maxCurrentVolumeRatio: number;
  showAll: boolean;
};

export type EarlyBreakoutRow = {
  status: "SETUP" | "WATCHLIST" | "TOO FAR FROM BREAKOUT" | "PULLBACK TOO DEEP" | "NO STRONG MOVE" | "WEAK VOLUME" | "BELOW 50 EMA" | "NO CONSOLIDATION";
  qualifies: boolean;
  security_id: string;
  symbol: string;
  company_name: string;
  universe_name: UniverseName;
  current_date: string;
  current_close: number;
  ema50: number;
  distance_from_ema_pct: number;
  impulse_start_date?: string;
  impulse_start_close?: number;
  breakout_date?: string;
  breakout_close?: number;
  breakout_volume_ratio?: number;
  first_move_pct?: number;
  consolidation_days?: number;
  consolidation_low?: number;
  pullback_from_breakout_pct?: number;
  distance_to_breakout_pct?: number;
  current_volume_ratio?: number;
  ema50_slope_pct?: number;
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

export const defaultEarlyBreakoutFilters: EarlyBreakoutFilters = {
  universe: "ALL",
  lookbackDays: 65,
  minFirstMovePct: 30,
  minImpulseVolumeRatio: 1.8,
  minConsolidationDays: 5,
  maxConsolidationDays: 25,
  maxPullbackPct: 7,
  maxBreakoutProximityPct: 3,
  maxBreakoutOvershootPct: 1,
  requireAboveEma: true,
  requireRisingEma: true,
  maxCurrentVolumeRatio: 1.8,
  showAll: false,
};

const pct = (value: number, base: number) => (value / base - 1) * 100;

function analyzeEarlyBreakoutStock(input: {
  securityId: string;
  symbol: string;
  companyName: string;
  universeName: UniverseName;
  prices: DailyPriceRecord[];
  filters: EarlyBreakoutFilters;
}): EarlyBreakoutRow | null {
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

  const firstCandidate = Math.max(51, currentIndex - input.filters.lookbackDays + 1);
  let best:
    | {
        breakoutIndex: number;
        impulseStartIndex: number;
        firstMovePct: number;
        volumeRatio: number;
      }
    | undefined;

  for (let index = firstCandidate; index <= currentIndex - input.filters.minConsolidationDays; index += 1) {
    const dayEma = ema50[index];
    const previousEma = ema50[index - 1];
    const dayVolAvg = volumeSma20[index];
    if (!dayEma || !previousEma || !dayVolAvg) continue;

    const day = rows[index];
    const previous = rows[index - 1];
    const crossedAboveEma = previous.close <= previousEma && day.close > dayEma;
    const reclaimedAfterBase = rows.slice(Math.max(0, index - 12), index).some((row, offset) => {
      const originalIndex = Math.max(0, index - 12) + offset;
      const baseEma = ema50[originalIndex];
      return baseEma !== undefined && row.close < baseEma;
    });
    const constructiveCandle = day.close >= day.open;
    const volumeRatio = day.volume / dayVolAvg;
    if (!constructiveCandle || volumeRatio < input.filters.minImpulseVolumeRatio || (!crossedAboveEma && !reclaimedAfterBase)) continue;

    const impulseWindowStart = Math.max(0, index - 20);
    let impulseStartIndex = impulseWindowStart;
    for (let cursor = impulseWindowStart + 1; cursor <= index; cursor += 1) {
      if (rows[cursor].close < rows[impulseStartIndex].close) impulseStartIndex = cursor;
    }
    const firstMovePct = pct(day.close, rows[impulseStartIndex].close);
    if (!best || firstMovePct > best.firstMovePct) best = { breakoutIndex: index, impulseStartIndex, firstMovePct, volumeRatio };
  }

  const distance = pct(current.close, currentEma);
  const slopeBaseIndex = Math.max(0, currentIndex - 10);
  const slopeBase = ema50[slopeBaseIndex];
  const emaSlope = slopeBase ? pct(currentEma, slopeBase) : 0;
  const currentVolumeRatio = current.volume / currentVolAvg;
  const reasons: string[] = [];
  let status: EarlyBreakoutRow["status"] = "NO STRONG MOVE";
  let impulseStartDate: string | undefined;
  let impulseStartClose: number | undefined;
  let breakoutDate: string | undefined;
  let breakoutClose: number | undefined;
  let breakoutVolumeRatio: number | undefined;
  let firstMovePct: number | undefined;
  let consolidationDays: number | undefined;
  let consolidationLow: number | undefined;
  let pullbackFromBreakout: number | undefined;
  let distanceToBreakout: number | undefined;

  if (!best) {
    reasons.push("No high-volume reclaim above the daily 50 EMA was found inside the lookback.");
  } else {
    const impulseStart = rows[best.impulseStartIndex];
    const breakout = rows[best.breakoutIndex];
    const consolidationRows = rows.slice(best.breakoutIndex + 1, currentIndex + 1);
    impulseStartDate = impulseStart.trade_date;
    impulseStartClose = impulseStart.close;
    breakoutDate = breakout.trade_date;
    breakoutClose = breakout.close;
    breakoutVolumeRatio = best.volumeRatio;
    firstMovePct = best.firstMovePct;
    consolidationDays = consolidationRows.length;
    consolidationLow = consolidationRows.length ? Math.min(...consolidationRows.map((row) => row.low)) : current.low;
    pullbackFromBreakout = pct(consolidationLow, breakout.close);
    distanceToBreakout = pct(current.close, breakout.close);

    if (firstMovePct < input.filters.minFirstMovePct) {
      status = "NO STRONG MOVE";
      reasons.push(`First move is below ${input.filters.minFirstMovePct}%.`);
    }
    if (breakoutVolumeRatio < input.filters.minImpulseVolumeRatio) {
      status = "WEAK VOLUME";
      reasons.push(`Breakout volume is below ${input.filters.minImpulseVolumeRatio.toFixed(1)}x.`);
    }
    if (consolidationDays < input.filters.minConsolidationDays || consolidationDays > input.filters.maxConsolidationDays) {
      status = "NO CONSOLIDATION";
      reasons.push("Consolidation days are outside the selected range.");
    }
    if (pullbackFromBreakout < -input.filters.maxPullbackPct) {
      status = "PULLBACK TOO DEEP";
      reasons.push(`Consolidation pullback is deeper than -${input.filters.maxPullbackPct}%.`);
    }
    if (distanceToBreakout < -input.filters.maxBreakoutProximityPct) {
      status = "TOO FAR FROM BREAKOUT";
      reasons.push(`Current close is more than ${input.filters.maxBreakoutProximityPct}% below the breakout zone.`);
    }
    if (distanceToBreakout > input.filters.maxBreakoutOvershootPct) {
      status = "WATCHLIST";
      reasons.push(`Current close is already more than ${input.filters.maxBreakoutOvershootPct}% above the breakout zone.`);
    }
  }

  if (input.filters.requireAboveEma && distance < 0) {
    status = "BELOW 50 EMA";
    reasons.push("Current close is below the daily 50 EMA.");
  }
  if (input.filters.requireRisingEma && emaSlope <= 0) reasons.push("Daily 50 EMA is not rising.");
  if (currentVolumeRatio > input.filters.maxCurrentVolumeRatio) reasons.push("Current volume is above the quiet-consolidation threshold.");

  const qualifies = reasons.length === 0;
  if (qualifies) status = "SETUP";
  else if (status === "NO STRONG MOVE" && best) status = "WATCHLIST";

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
    impulse_start_date: impulseStartDate,
    impulse_start_close: impulseStartClose,
    breakout_date: breakoutDate,
    breakout_close: breakoutClose,
    breakout_volume_ratio: breakoutVolumeRatio,
    first_move_pct: firstMovePct,
    consolidation_days: consolidationDays,
    consolidation_low: consolidationLow,
    pullback_from_breakout_pct: pullbackFromBreakout,
    distance_to_breakout_pct: distanceToBreakout,
    current_volume_ratio: currentVolumeRatio,
    ema50_slope_pct: emaSlope,
    reason: qualifies ? "Strong first move above daily 50 EMA, tight consolidation, and price is near the breakout zone." : reasons.join(" "),
    recent,
  };
}

export async function runEarlyBreakoutScreener(filters: Partial<EarlyBreakoutFilters> = {}) {
  const merged = { ...defaultEarlyBreakoutFilters, ...filters };
  const db = await readDatabase();
  const members = db.universe_members.filter((member) =>
    member.is_current_constituent &&
    member.security_id &&
    (merged.universe === "ALL" || member.universe_name === merged.universe)
  );
  const rows = members.flatMap((member) => {
    const prices = db.daily_prices.filter((price) => price.security_id === member.security_id);
    const row = analyzeEarlyBreakoutStock({
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
    if ((a.distance_to_breakout_pct ?? -Infinity) !== (b.distance_to_breakout_pct ?? -Infinity)) {
      return Math.abs(a.distance_to_breakout_pct ?? Infinity) - Math.abs(b.distance_to_breakout_pct ?? Infinity);
    }
    return (b.first_move_pct ?? -Infinity) - (a.first_move_pct ?? -Infinity);
  });
  const statusSummary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  return { filters: merged, evaluated: rows.length, qualified: rows.filter((row) => row.qualifies).length, statusSummary, results };
}

export async function getEarlyBreakoutScreenerDetail(securityId: string) {
  const response = await runEarlyBreakoutScreener({ showAll: true });
  return response.results.find((row) => row.security_id === securityId) ?? null;
}
