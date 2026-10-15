import type { DailyPriceRecord } from "./types";

export function emaSeries(closes: number[], period: number): Array<number | undefined> {
  const values: Array<number | undefined> = Array(closes.length).fill(undefined);
  if (closes.length < period) return values;
  const weight = 2 / (period + 1);
  values[period - 1] = closes.slice(0, period).reduce((sum, close) => sum + close, 0) / period;
  for (let index = period; index < closes.length; index += 1) values[index] = closes[index] * weight + values[index - 1]! * (1 - weight);
  return values;
}

// The latest completed trading candle is the next session's entry setup.
export function findEmaNoTouch(prices: DailyPriceRecord[]) {
  const rows = [...prices].filter((row) => !row.is_provisional).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  if (rows.length < 10) return null;
  const ema = emaSeries(rows.map((row) => row.close), 10);
  const currentIndex = rows.length - 1;
  const anchor = rows[currentIndex];
  if (anchor.low <= ema[currentIndex]!) return null;
  const recent = rows.slice(-126).map((row, index) => ({
    trade_date: row.trade_date, open: row.open, high: row.high, low: row.low,
    close: row.close, volume: row.volume, ema10: ema[rows.length - Math.min(126, rows.length) + index],
  }));
  return { anchor, anchorEma10: ema[currentIndex]!, recent };
}
