type EarningsChartBar = {
  trade_date: string;
  high: number;
  low: number;
  close: number;
  volume: number;
  is_provisional?: boolean;
};

export function earningsBreakout(rows: EarningsChartBar[], candle: Pick<EarningsChartBar, "trade_date" | "high">) {
  const earningsIndex = rows.findIndex(row => row.trade_date === candle.trade_date);
  const level = candle.high;
  const latest = rows.at(-1);
  if (earningsIndex < 0 || rows[earningsIndex].is_provisional || !latest || latest.close <= 0 || level <= 0) return;

  const completed = rows.filter(row => !row.is_provisional);
  const afterEarnings = completed.filter(row => row.trade_date > candle.trade_date);
  const base = afterEarnings.slice(-5);
  let breakoutIndex = -1;
  let failureIndex = -1;
  let retestHeld = false;
  for (const [index, row] of afterEarnings.entries()) {
    if (row.close > level) {
      if (breakoutIndex < 0) {
        breakoutIndex = index;
        retestHeld = false;
      } else if (row.low <= level) {
        retestHeld = true;
      }
    } else if (row.close < level && breakoutIndex >= 0) {
      breakoutIndex = -1;
      failureIndex = index;
    }
  }

  const distance = (latest.close / level - 1) * 100;
  const liveTest = Boolean(latest.is_provisional && latest.trade_date > candle.trade_date && latest.high >= level);
  const recentFailure = failureIndex >= 0 && afterEarnings.length - failureIndex <= 5;
  let status = "Below earnings high";
  if (breakoutIndex >= 0) status = retestHeld ? "Retest held" : "Closed above";
  else if (recentFailure) status = "Closed back below";
  else if ((afterEarnings.at(-1)?.high ?? 0) >= level || liveTest) status = "Testing the high";
  else if (distance >= -2) status = "Approaching the high";

  const setup = breakoutIndex >= 0 ? afterEarnings.slice(Math.max(0, breakoutIndex - 5), breakoutIndex) : base;
  const setupLow = setup.length ? Math.min(...setup.map(row => row.low)) : undefined;
  const setupRisk = setupLow !== undefined && setupLow > 0 && latest.close > setupLow
    ? (1 - setupLow / latest.close) * 100 : undefined;
  const priorVolume = completed.slice(-21, -1);
  const lastVolume = completed.at(-1)?.volume;
  const relativeVolume = lastVolume !== undefined && lastVolume > 0
    && priorVolume.length === 20 && priorVolume.every(row => row.volume > 0)
    ? lastVolume / (priorVolume.reduce((sum, row) => sum + row.volume, 0) / 20) : undefined;

  const last = afterEarnings.at(-1);
  const previous = afterEarnings.at(-2);
  const tightBase = setup.length >= 3 && setupLow !== undefined
    && (Math.max(...setup.map(row => row.high)) - setupLow) / level <= 0.03;
  const sharpMove = last && previous && last.close >= previous.close * 1.02 && last.high >= level;
  const label = (breakoutIndex > failureIndex && failureIndex >= 0) || recentFailure
    ? "Reclaim setup" : sharpMove && !tightBase ? "Sharp move" : tightBase ? "Tight base" : undefined;

  const resistanceFloor = Math.max(level, latest.close);
  const resistance = completed.slice(-63).reduce<number | undefined>((nearest, row, index, recent) => {
    const left = recent[index - 1];
    const right = recent[index + 1];
    if (!left || !right || row.high <= resistanceFloor || row.high <= left.high || row.high <= right.high) return nearest;
    return nearest === undefined ? row.high : Math.min(nearest, row.high);
  }, undefined);

  return {
    status, label, distance, live: Boolean(latest.is_provisional), liveTest,
    extended: distance > 2 && breakoutIndex >= 0, setupLow, setupRisk, relativeVolume,
    resistance, resistanceRoom: resistance === undefined ? undefined : (resistance / latest.close - 1) * 100,
  };
}
