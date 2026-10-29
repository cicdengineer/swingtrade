export type StochHighPoint = {
  trade_date: string;
  high: number;
  close: number;
  daily_stoch_d?: number;
};

export type StochHighLine = {
  date: string;
  price: number;
  dailyD: number;
  distancePct: number;
  qualifies: boolean;
};

/** The latest overbought run sets resistance; it stays fixed after %D drops below 80. */
export function findStochHigh(rows: StochHighPoint[], nearBelowPct = 5): StochHighLine | null {
  let runHigh: StochHighPoint | null = null;
  let frozenHigh: StochHighPoint | null = null;
  for (const row of rows) {
    const d = row.daily_stoch_d;
    if (d === undefined || !Number.isFinite(d)) continue;
    if (d > 80) {
      if (!runHigh || row.high >= runHigh.high) runHigh = row;
      frozenHigh = null;
    } else if (runHigh) {
      frozenHigh = runHigh;
      runHigh = null;
    }
  }
  const latest = rows.at(-1);
  const anchor = runHigh ?? frozenHigh;
  if (!latest || !anchor || !Number.isFinite(latest.daily_stoch_d) || anchor.high <= 0) return null;
  const distancePct = (latest.close / anchor.high - 1) * 100;
  return {
    date: anchor.trade_date,
    price: anchor.high,
    dailyD: latest.daily_stoch_d!,
    distancePct,
    qualifies: latest.daily_stoch_d! < 80 && distancePct >= -nearBelowPct,
  };
}
