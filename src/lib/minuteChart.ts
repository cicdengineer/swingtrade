export type MinuteCandle = { trade_date: string; open: number; high: number; low: number; close: number; volume: number };
type Tick = { ltp: number; lastTradeTime?: number; volume?: number; receivedAt: number };

export const indiaDate = (time: number) => new Date(time).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function todayMinuteRows<T extends MinuteCandle>(rows: T[], now = Date.now()): T[] {
  return rows.filter(row => Date.parse(row.trade_date) <= now && indiaDate(Date.parse(row.trade_date)) === indiaDate(now))
    .sort((a, b) => Date.parse(a.trade_date) - Date.parse(b.trade_date));
}

export function applyMinuteTick(rows: MinuteCandle[], tick: Tick, now = Date.now()): MinuteCandle[] {
  const current = todayMinuteRows(rows, now);
  const time = (tick.lastTradeTime ?? 0) * 1000;
  if (!time || time > Math.min(now, tick.receivedAt) + 60_000 || indiaDate(time) !== indiaDate(now) || !Number.isFinite(tick.ltp) || tick.ltp <= 0) return current;
  const minute = Math.floor(time / 60_000) * 60_000;
  const last = current.at(-1);
  if (last && minute < Date.parse(last.trade_date)) return current;
  const same = last && minute === Date.parse(last.trade_date);
  const completedVolume = current.slice(0, same ? -1 : undefined).reduce((sum, row) => sum + row.volume, 0);
  const volume = Math.max(same ? last.volume : 0, (tick.volume ?? completedVolume) - completedVolume);
  const candle = same
    ? { ...last, high: Math.max(last.high, tick.ltp), low: Math.min(last.low, tick.ltp), close: tick.ltp, volume }
    : { trade_date: new Date(minute).toISOString(), open: tick.ltp, high: tick.ltp, low: tick.ltp, close: tick.ltp, volume };
  return [...(same ? current.slice(0, -1) : current), candle];
}

// TradingView default source is HLC3; the anchor selects the first included bar.
export function anchoredVwap(rows: MinuteCandle[]): number[] {
  let weighted = 0;
  let volume = 0;
  return rows.map(row => {
    const weight = Math.max(0, row.volume);
    weighted += ((row.high + row.low + row.close) / 3) * weight;
    volume += weight;
    return volume > 0 ? weighted / volume : Number.NaN;
  });
}
