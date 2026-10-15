import type { DailyPriceRecord } from "./types";

export function emaSeries(closes: number[], period: number): Array<number | undefined> {
  const values: Array<number | undefined> = Array(closes.length).fill(undefined);
  if (closes.length < period) return values;
  const weight = 2 / (period + 1);
  values[period - 1] = closes.slice(0, period).reduce((sum, close) => sum + close, 0) / period;
  for (let index = period; index < closes.length; index += 1) values[index] = closes[index] * weight + values[index - 1]! * (1 - weight);
  return values;
}

// Completed daily candles only. The latest new-high candle fully above its 10 EMA
// remains valid until a later completed daily candle closes below its own 10 EMA.
export function findEmaNoTouch(prices: DailyPriceRecord[], maxSignalAgeSessions = 20) {
  const rows = [...prices].filter((row) => !row.is_provisional).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  if (rows.length < 11) return null;
  const ema = emaSeries(rows.map((row) => row.close), 10);
  const currentIndex = rows.length - 1;
  const searchStart = Math.max(10, currentIndex - Math.max(1, maxSignalAgeSessions));
  let anchorIndex = -1;
  for (let index = currentIndex; index >= searchStart; index -= 1) {
    if (rows[index].close < ema[index]!) break;
    if (rows[index].low > ema[index]! && rows[index].high > rows[index - 1].high) {
      anchorIndex = index;
      break;
    }
  }
  if (anchorIndex < 0) return null;
  const anchor = rows[anchorIndex];
  const later = rows.slice(anchorIndex + 1);
  const triggered = later.some((row) => row.high > anchor.high);
  const recent = rows.slice(-126).map((row, index) => ({
    trade_date: row.trade_date, open: row.open, high: row.high, low: row.low,
    close: row.close, volume: row.volume, ema10: ema[rows.length - Math.min(126, rows.length) + index],
  }));
  return { anchor, anchorEma10: ema[anchorIndex]!, current: rows[currentIndex], currentEma10: ema[currentIndex]!,
    signalAgeSessions: currentIndex - anchorIndex, triggered, recent };
}
