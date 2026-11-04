export function isCurrentDayLowAbove10Ema(
  row: { ema10: number; recent: Array<{ trade_date: string; low: number; ema10?: number }> },
  sessionDate: string,
) {
  const candle = row.recent.at(-1);
  const ema10 = candle?.ema10 ?? row.ema10;
  return candle?.trade_date === sessionDate && Number.isFinite(candle.low) && Number.isFinite(ema10) && ema10 > 0 && candle.low > ema10;
}
