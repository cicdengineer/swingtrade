type StochHLPoint = {
  close: number;
  daily_stoch_d?: number;
};

export function matchesStochHL(rows: readonly StochHLPoint[]): boolean {
  let peak: { d: number; close: number } | undefined;
  let trough: { d: number; close: number } | undefined;
  let inOverboughtZone = false;

  for (const { close, daily_stoch_d: d } of rows) {
    if (d === undefined || !Number.isFinite(d)) continue;

    if (d > 80) {
      if (!inOverboughtZone || !peak || d > peak.d) peak = { d, close };
      trough = undefined;
    } else if (peak && d < 20 && (!trough || d < trough.d)) {
      trough = { d, close };
    }

    inOverboughtZone = d > 80;
  }

  if (!peak || !trough || !Number.isFinite(rows.at(-1)?.daily_stoch_d)) return false;
  if (!Number.isFinite(peak.close) || !Number.isFinite(trough.close) || peak.close <= 0) return false;

  // Round the percentage to keep floating-point noise out of the strict 3% comparison.
  const changePct = ((trough.close - peak.close) / peak.close) * 100;
  return Number(changePct.toFixed(10)) > -3;
}
