export type SwingHighPoint = {
  trade_date: string;
  low: number;
  close: number;
  daily_stoch_d?: number;
};

export type SwingHighSignal = {
  date: string;
  price: number;
  zoneLow: number;
  dailyD: number;
  qualifies: boolean;
};

/** Compare the newest oversold zone with the one immediately before it. */
export function findSwingHigh(rows: SwingHighPoint[], ltp?: number): SwingHighSignal | null {
  const zones: Array<{ date: string; low: number }> = [];
  let inZone = false;
  for (const row of rows) {
    const d = row.daily_stoch_d;
    if (d === undefined || !Number.isFinite(d)) {
      inZone = false;
      continue;
    }
    if (d < 20 && Number.isFinite(row.low) && row.low > 0) {
      if (!inZone) zones.push({ date: row.trade_date, low: row.low });
      else if (row.low < zones[zones.length - 1].low) zones[zones.length - 1] = { date: row.trade_date, low: row.low };
      inZone = true;
    } else inZone = false;
  }
  const latest = rows.at(-1);
  const zone = zones.at(-1);
  if (!latest || !zone || !Number.isFinite(latest.daily_stoch_d)) return null;
  const previous = zones.at(-2);
  const activeComparison = Boolean(previous && latest.daily_stoch_d! <= 80 && zones.length > 1);
  const reference = activeComparison ? previous! : zone;
  const price = ltp ?? latest.close;
  return {
    date: reference.date,
    price: reference.low,
    zoneLow: zone.low,
    dailyD: latest.daily_stoch_d!,
    qualifies: activeComparison && zone.low > reference.low && Number.isFinite(price) && price > reference.low,
  };
}

export function isAboveSwingHighRed(rows: SwingHighPoint[], ltp: number): boolean {
  const line = findSwingHigh(rows, ltp);
  return Boolean(line && Number.isFinite(ltp) && ltp > line.price);
}
