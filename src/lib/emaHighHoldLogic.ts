import type { DailyPriceRecord } from "./types";

export type EmaHighHoldPoint = Pick<DailyPriceRecord, "trade_date" | "open" | "high" | "low" | "close" | "volume"> & { ema10?: number };

export function emaSeries(closes: number[], period: number): Array<number | undefined> {
  const values: Array<number | undefined> = Array(closes.length).fill(undefined);
  if (closes.length < period) return values;
  const weight = 2 / (period + 1);
  values[period - 1] = closes.slice(0, period).reduce((sum, close) => sum + close, 0) / period;
  for (let index = period; index < closes.length; index += 1) values[index] = closes[index] * weight + values[index - 1]! * (1 - weight);
  return values;
}

// The latest four completed sessions define one setup: anchor + three holding candles.
export function findEmaHighHold(prices: DailyPriceRecord[]) {
  const rows = [...prices].filter((row) => !row.is_provisional).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  if (rows.length < 14) return null;
  const ema = emaSeries(rows.map((row) => row.close), 10);
  const anchorIndex = rows.length - 4;
  const anchor = rows[anchorIndex];
  const hold = rows.slice(-3);
  const aboveEma = anchor.close > ema[anchorIndex]! && hold.every((row, index) => row.close >= ema[anchorIndex + index + 1]!);
  const holdsHigh = hold.every((row) => row.close <= anchor.high);
  const madeHigh = anchor.high > rows[anchorIndex - 1].high;
  const recent = rows.slice(-126).map((row, index) => ({
    trade_date: row.trade_date, open: row.open, high: row.high, low: row.low,
    close: row.close, volume: row.volume, ema10: ema[rows.length - Math.min(126, rows.length) + index],
  }));
  return { anchor, hold, recent, ema10: ema.at(-1)!, qualifies: madeHigh && aboveEma && holdsHigh,
    madeHigh, aboveEma, holdsHigh };
}
