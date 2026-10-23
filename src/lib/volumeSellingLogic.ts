import type { DailyPriceRecord } from "./types";

type VolumePrice = Pick<DailyPriceRecord, "trade_date" | "open" | "high" | "low" | "close" | "volume"> & { is_provisional?: boolean };

export type VolumeSellingSignal = {
  signal_date: string;
  signal_high: number;
  signal_volume: number;
  red_volume_ratio: number;
  all_volume_ratio: number;
  signal_age: number;
};

export type VolumeSellingSetup = VolumeSellingSignal & {
  one_month_decline_pct: number;
  phase: "BELOW" | "CLOSED_ABOVE";
  first_close_above_date?: string;
  sessions_since_close_above?: number;
};

/** Latest completed red candle in the selected session window with exceptional selling volume. */
export function findVolumeSellingSignal(prices: VolumePrice[], minRedRatio = 2.5, lookbackSessions = 126): VolumeSellingSignal | null {
  const rows = [...prices].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const last = rows.length - 1;
  for (let i = last; i >= Math.max(0, last - lookbackSessions + 1); i--) {
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

/** A falling 21-session setup remains visible for five sessions after its first completed close above the signal high. */
export function findVolumeSellingSetup(prices: VolumePrice[], minRedRatio = 2.5): VolumeSellingSetup | null {
  const rows = [...prices].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const signal = findVolumeSellingSignal(prices, minRedRatio);
  if (!signal) return null;
  const signalIndex = rows.findIndex(row => row.trade_date === signal.signal_date);
  const firstCloseAboveIndex = rows.findIndex((row, index) => index > signalIndex && !row.is_provisional && row.close >= signal.signal_high);
  const referenceIndex = firstCloseAboveIndex >= 0
    ? rows.findLastIndex((row, index) => index < firstCloseAboveIndex && !row.is_provisional)
    : rows.findLastIndex(row => !row.is_provisional);
  const completed = rows.slice(0, referenceIndex + 1).filter(row => !row.is_provisional);
  if (completed.length < 22) return null;
  const currentClose = completed.at(-1)!.close;
  const monthAgoClose = completed.at(-22)!.close;
  if (monthAgoClose <= 0 || currentClose >= monthAgoClose) return null;
  const sessionsSinceCloseAbove = firstCloseAboveIndex >= 0
    ? new Set(rows.slice(firstCloseAboveIndex + 1).map(row => row.trade_date)).size : undefined;
  if (sessionsSinceCloseAbove !== undefined && sessionsSinceCloseAbove > 5) return null;
  return { ...signal, one_month_decline_pct: (currentClose / monthAgoClose - 1) * 100,
    phase: firstCloseAboveIndex >= 0 ? "CLOSED_ABOVE" : "BELOW",
    first_close_above_date: firstCloseAboveIndex >= 0 ? rows[firstCloseAboveIndex].trade_date : undefined,
    sessions_since_close_above: sessionsSinceCloseAbove };
}
