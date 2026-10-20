export type SwingHighCandle = { trade_date: string; high: number; low: number; close: number };
export type SwingHighSignal = { zone_start_date: string; zone_end_date: string; high_date: string; level: number; breakout_date: string; breakout_low: number; breakout_d: number };
export type SwingHighLevel = { zone_start_date: string; zone_end_date: string; high_date: string; level: number };

// A zone is a consecutive run of daily %D values strictly above 80.
// Its highest candle high becomes resistance once %D leaves the zone.
export function findSwingHighSignals(rows: SwingHighCandle[], d: Array<number | undefined>, upper = 80) {
  const signals: SwingHighSignal[] = [];
  let zone: SwingHighLevel | null = null;
  let level: SwingHighLevel | null = null;
  let previousHigh: number | undefined;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const value = d[index];
    if (value !== undefined && value > upper) {
      if (!zone) zone = { zone_start_date: row.trade_date, zone_end_date: row.trade_date, high_date: row.trade_date, level: row.high };
      else {
        zone.zone_end_date = row.trade_date;
        if (row.high > zone.level) { zone.level = row.high; zone.high_date = row.trade_date; }
      }
      level = null;
    } else if (zone) {
      level = zone;
      zone = null;
    }
    if (level && value !== undefined && value < upper && previousHigh !== undefined && previousHigh <= level.level && row.high > level.level) {
      signals.push({ ...level, breakout_date: row.trade_date, breakout_low: row.low, breakout_d: value });
      // A level can produce one entry. A new overbought zone starts the next setup.
      level = null;
    }
    previousHigh = row.high;
  }
  return { signals, activeLevel: zone ?? level };
}
