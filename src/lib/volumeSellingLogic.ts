import type { DailyPriceRecord } from "./types";

export type VolumeSellingSignal = {
  signal_date: string;
  signal_high: number;
  signal_volume: number;
  red_volume_ratio: number;
  all_volume_ratio: number;
  signal_age: number;
};

/** Latest completed red candle in the last 126 sessions with exceptional selling volume. */
export function findVolumeSellingSignal(prices: DailyPriceRecord[], minRedRatio = 2.5): VolumeSellingSignal | null {
  const rows = [...prices].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const last = rows.length - 1;
  for (let i = last; i >= Math.max(0, last - 125); i--) {
    const candle = rows[i];
    if (candle.is_provisional || candle.close >= candle.open || candle.volume <= 0) continue;
    const prior = rows.slice(Math.max(0, i - 60), i).filter(row => !row.is_provisional && row.volume > 0);
    const red = prior.filter(row => row.close < row.open).slice(-20);
    const all = prior.slice(-20);
    if (red.length < 5 || all.length < 20) continue;
    const redAverage = red.reduce((sum, row) => sum + row.volume, 0) / red.length;
    const allAverage = all.reduce((sum, row) => sum + row.volume, 0) / all.length;
    const redRatio = candle.volume / redAverage;
    const allRatio = candle.volume / allAverage;
    if (redRatio > minRedRatio && allRatio > 2) {
      return { signal_date: candle.trade_date, signal_high: candle.high, signal_volume: candle.volume,
        red_volume_ratio: redRatio, all_volume_ratio: allRatio, signal_age: last - i };
    }
  }
  return null;
}
