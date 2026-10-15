import type { DailyPriceRecord } from "./types";

export type EmaCatchupCriteria = {
  baseDays: number;
  minPriorAdvancePct: number;
  maxBaseRangePct: number;
  maxDistanceFromEmaPct: number;
  minCatchupPct: number;
};

export function emaSeries(closes: number[], period: number): Array<number | undefined> {
  const values: Array<number | undefined> = Array(closes.length).fill(undefined);
  if (closes.length < period) return values;
  const weight = 2 / (period + 1);
  values[period - 1] = closes.slice(0, period).reduce((sum, close) => sum + close, 0) / period;
  for (let index = period; index < closes.length; index += 1) values[index] = closes[index] * weight + values[index - 1]! * (1 - weight);
  return values;
}

export function findEmaCatchup(prices: DailyPriceRecord[], criteria: EmaCatchupCriteria) {
  const rows = [...prices].filter((row) => !row.is_provisional).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const baseDays = Math.max(3, Math.min(15, Math.trunc(criteria.baseDays)));
  const currentIndex = rows.length - 1;
  const baseStart = currentIndex - baseDays + 1;
  const trendStart = baseStart - 20;
  if (trendStart < 10) return null;
  const ema = emaSeries(rows.map((row) => row.close), 10);
  const current = rows[currentIndex];
  const currentEma = ema[currentIndex]!;
  const base = rows.slice(baseStart);
  const priorAdvancePct = (rows[baseStart - 1].close / rows[trendStart].close - 1) * 100;
  const emaSlopePct = (currentEma / ema[baseStart - 1]! - 1) * 100;
  const startGapPct = (rows[baseStart - 1].close / ema[baseStart - 1]! - 1) * 100;
  const currentGapPct = (current.close / currentEma - 1) * 100;
  const catchupPct = startGapPct - currentGapPct;
  const baseRangePct = (Math.max(...base.map((row) => row.high)) / Math.min(...base.map((row) => row.low)) - 1) * 100;
  const swingLow = base.reduce((lowest, row) => row.low < lowest.low ? row : lowest);
  if (priorAdvancePct < criteria.minPriorAdvancePct || current.close <= currentEma || emaSlopePct <= 0 ||
      currentGapPct > criteria.maxDistanceFromEmaPct || catchupPct < criteria.minCatchupPct ||
      baseRangePct > criteria.maxBaseRangePct || swingLow.low >= current.close) return null;
  const recent = rows.slice(-126).map((row, index) => ({
    trade_date: row.trade_date, open: row.open, high: row.high, low: row.low,
    close: row.close, volume: row.volume, ema10: ema[rows.length - Math.min(126, rows.length) + index],
  }));
  return { current, currentEma, priorAdvancePct, emaSlopePct, startGapPct, currentGapPct,
    catchupPct, baseRangePct, swingLow, recent };
}
