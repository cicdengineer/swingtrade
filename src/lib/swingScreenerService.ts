import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";

export type SwingScreenerFilters = {
  universe: UniverseName | "ALL";
  breakoutLookbackDays: number;
  minBreakoutVolumeRatio: number;
  minPostBreakoutGainPct: number;
  minDistanceFromEmaPct: number;
  maxDistanceFromEmaPct: number;
  minDaysSinceBreakout: number;
  maxDaysSinceBreakout: number;
  requireRisingEma: boolean;
  maxCurrentVolumeRatio: number;
  showAll: boolean;
};

export type SwingScreenerRow = {
  status: "NEAR 50 EMA" | "PULLBACK" | "EXTENDED" | "BROKEN BELOW 50 EMA" | "NO SETUP";
  qualifies: boolean;
  security_id: string;
  symbol: string;
  company_name: string;
  universe_name: UniverseName;
  current_date: string;
  current_close: number;
  ema50: number;
  distance_from_ema_pct: number;
  breakout_date?: string;
  breakout_close?: number;
  breakout_volume_ratio?: number;
  days_since_breakout?: number;
  max_gain_after_breakout_pct?: number;
  pullback_from_high_pct?: number;
  current_volume_ratio?: number;
  ema50_slope_pct?: number;
  reason: string;
  recent: Array<{
    trade_date: string;
    close: number;
    ema50?: number;
    volume: number;
    volume_ratio?: number;
  }>;
};

export const defaultSwingFilters: SwingScreenerFilters = {
  universe: "ALL",
  breakoutLookbackDays: 120,
  minBreakoutVolumeRatio: 1.8,
  minPostBreakoutGainPct: 8,
  minDistanceFromEmaPct: -3,
  maxDistanceFromEmaPct: 5,
  minDaysSinceBreakout: 10,
  maxDaysSinceBreakout: 90,
  requireRisingEma: true,
  maxCurrentVolumeRatio: 1.5,
  showAll: false,
};

export function calculateSma(values: number[], period: number) {
  return values.map((_, index) => {
    if (index + 1 < period) return undefined;
    const slice = values.slice(index + 1 - period, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / period;
  });
}

export function calculateEma(values: number[], period: number) {
  const out: Array<number | undefined> = Array(values.length).fill(undefined);
  if (values.length < period) return out;
  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = ema;
  for (let index = period; index < values.length; index += 1) {
    ema = (values[index] - ema) * multiplier + ema;
    out[index] = ema;
  }
  return out;
}

const pct = (value: number, base: number) => (value / base - 1) * 100;

function analyzeStock(input: {
  securityId: string;
  symbol: string;
  companyName: string;
  universeName: UniverseName;
  prices: DailyPriceRecord[];
  filters: SwingScreenerFilters;
}): SwingScreenerRow | null {
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

  const start = Math.max(51, currentIndex - input.filters.breakoutLookbackDays);
  let breakoutIndex = -1;
  for (let index = start; index <= currentIndex - input.filters.minDaysSinceBreakout; index += 1) {
    const previousEma = ema50[index - 1];
    const dayEma = ema50[index];
    const dayVolumeAvg = volumeSma20[index];
    if (!previousEma || !dayEma || !dayVolumeAvg) continue;
    const row = rows[index];
    const previous = rows[index - 1];
    const volumeRatio = row.volume / dayVolumeAvg;
    const crossedAbove = previous.close <= previousEma && row.close > dayEma;
    const constructiveCandle = row.close >= row.open;
    if (crossedAbove && constructiveCandle && volumeRatio >= input.filters.minBreakoutVolumeRatio) breakoutIndex = index;
  }

  const distance = pct(current.close, currentEma);
  const slopeBaseIndex = Math.max(0, currentIndex - 10);
  const slopeBase = ema50[slopeBaseIndex];
  const emaSlope = slopeBase ? pct(currentEma, slopeBase) : 0;
  const currentVolumeRatio = current.volume / currentVolAvg;
  let status: SwingScreenerRow["status"] = "NO SETUP";
  const reasons: string[] = [];

  if (distance < input.filters.minDistanceFromEmaPct) status = "BROKEN BELOW 50 EMA";
  else if (distance > input.filters.maxDistanceFromEmaPct) status = "EXTENDED";
  else status = Math.abs(distance) <= 2 ? "NEAR 50 EMA" : "PULLBACK";

  let maxGainAfterBreakout: number | undefined;
  let pullbackFromHigh: number | undefined;
  let daysSinceBreakout: number | undefined;
  let breakoutVolumeRatio: number | undefined;
  let breakoutClose: number | undefined;
  let breakoutDate: string | undefined;

  if (breakoutIndex < 0) reasons.push("No recent high-volume close above 50 EMA was found.");
  else {
    const breakout = rows[breakoutIndex];
    const postBreakout = rows.slice(breakoutIndex, currentIndex + 1);
    breakoutDate = breakout.trade_date;
    breakoutClose = breakout.close;
    breakoutVolumeRatio = breakout.volume / (volumeSma20[breakoutIndex] || breakout.volume);
    daysSinceBreakout = currentIndex - breakoutIndex;
    const highClose = Math.max(...postBreakout.map((row) => row.close));
    maxGainAfterBreakout = pct(highClose, breakout.close);
    pullbackFromHigh = pct(current.close, highClose);
    if (maxGainAfterBreakout < input.filters.minPostBreakoutGainPct) reasons.push(`Post-breakout gain is below ${input.filters.minPostBreakoutGainPct}%.`);
    if (daysSinceBreakout < input.filters.minDaysSinceBreakout || daysSinceBreakout > input.filters.maxDaysSinceBreakout) reasons.push("Days since breakout is outside the selected range.");
    if (current.close <= breakout.close) reasons.push("Current close is not above breakout close.");
  }
  if (distance < input.filters.minDistanceFromEmaPct || distance > input.filters.maxDistanceFromEmaPct) reasons.push("Current price is not near the 50 EMA range.");
  if (input.filters.requireRisingEma && emaSlope <= 0) reasons.push("50 EMA is not rising.");
  if (currentVolumeRatio > input.filters.maxCurrentVolumeRatio) reasons.push("Current volume is above the pullback volume threshold.");

  const qualifies = reasons.length === 0;
  const recent = rows.slice(-120).map((row, index, recentRows) => {
    const originalIndex = rows.length - recentRows.length + index;
    const volAvg = volumeSma20[originalIndex];
    return {
      trade_date: row.trade_date,
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
    breakout_date: breakoutDate,
    breakout_close: breakoutClose,
    breakout_volume_ratio: breakoutVolumeRatio,
    days_since_breakout: daysSinceBreakout,
    max_gain_after_breakout_pct: maxGainAfterBreakout,
    pullback_from_high_pct: pullbackFromHigh,
    current_volume_ratio: currentVolumeRatio,
    ema50_slope_pct: emaSlope,
    reason: qualifies ? "High-volume 50 EMA breakout confirmed, then pulled back near a rising 50 EMA." : reasons.join(" "),
    recent,
  };
}

export async function runSwingScreener(filters: Partial<SwingScreenerFilters> = {}) {
  const merged = { ...defaultSwingFilters, ...filters };
  const db = await readDatabase();
  const members = db.universe_members.filter((member) =>
    member.is_current_constituent &&
    member.security_id &&
    (merged.universe === "ALL" || member.universe_name === merged.universe)
  );
  const rows = members.flatMap((member) => {
    const prices = db.daily_prices.filter((price) => price.security_id === member.security_id);
    const row = analyzeStock({
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
    return Math.abs(a.distance_from_ema_pct) - Math.abs(b.distance_from_ema_pct);
  });
  const statusSummary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  return { filters: merged, evaluated: rows.length, qualified: rows.filter((row) => row.qualifies).length, statusSummary, results };
}

export async function getSwingScreenerDetail(securityId: string) {
  const response = await runSwingScreener({ showAll: true });
  return response.results.find((row) => row.security_id === securityId) ?? null;
}
