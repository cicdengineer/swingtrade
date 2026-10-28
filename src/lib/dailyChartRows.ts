type ChartCandle = {
  trade_date: string;
  volume: number;
  is_provisional?: boolean;
  ema10?: number;
  ema50?: number;
  volume_ratio?: number;
};

export function mergeLiveDailyCandle<T extends ChartCandle>(dailyRows: T[], liveDaily: T | null, today: string): T[] {
  const byDate = new Map<string, T>();
  for (const row of dailyRows) {
    const date = row.trade_date.slice(0, 10);
    const previous = byDate.get(date);
    if (!previous || (previous.is_provisional && !row.is_provisional)) byDate.set(date, row);
  }
  const rows = [...byDate.values()].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  if (!liveDaily || liveDaily.trade_date !== today) return rows;
  const existingIndex = rows.findIndex((row) => row.trade_date.slice(0, 10) === liveDaily.trade_date);
  if (existingIndex >= 0 && rows[existingIndex].is_provisional) {
    rows[existingIndex] = { ...rows[existingIndex], ...liveDaily, ema10: rows[existingIndex].ema10, ema50: rows[existingIndex].ema50, volume_ratio: rows[existingIndex].volume_ratio };
  } else if (existingIndex < 0 && liveDaily.volume > 0 && (!rows.length || liveDaily.trade_date > rows.at(-1)!.trade_date)) {
    rows.push(liveDaily);
  }
  return rows;
}
