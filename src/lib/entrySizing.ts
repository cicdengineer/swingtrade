export type EntrySizingSettings = { totalCapital: number; riskPercent: number };

export function latestDailyStop<T extends { low: number }>(rows: T[]) {
  return rows.at(-1)?.low;
}

export function swingLowBeforeLatest<T extends { low: number }>(rows: T[]) {
  if (rows.length < 6) return undefined;
  return rows.slice(-6, -1).reduce((lowest, point) => point.low < lowest.low ? point : lowest);
}

export function positionSizingFromStop(entry: number, stop: number | undefined, settings?: EntrySizingSettings | null) {
  const riskUnit = settings ? settings.totalCapital * settings.riskPercent / 100 : 0;
  if (!settings || !stop || stop <= 0) return { quantity: 0, value: 0, riskPerShare: 0, riskUnit, valid: false };
  const riskPerShare = entry - stop;
  if (entry <= 0 || riskPerShare <= 0) return { quantity: 0, value: 0, riskPerShare, riskUnit, valid: false };
  const quantity = Math.floor(riskUnit / riskPerShare);
  return { quantity, value: quantity * entry, riskPerShare, riskUnit, valid: quantity > 0 };
}
