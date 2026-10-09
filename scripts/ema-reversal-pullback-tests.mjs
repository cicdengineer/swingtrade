import assert from "node:assert/strict";

function ema(values, period) {
  const out = Array(values.length).fill(undefined);
  const k = 2 / (period + 1);
  for (let i = period - 1; i < values.length; i += 1) {
    if (i === period - 1) out[i] = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    else out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function classify(rows, options = {}) {
  const filters = {
    downtrendLookback: 90,
    minBelowEmaPct: 70,
    minHistoricalDeclinePct: 20,
    breakoutVolumeMultiplier: 1.5,
    minPostBreakoutAdvancePct: 10,
    minPullbackPct: 3,
    maxPullbackPct: 12,
    minPullbackDays: 3,
    maxPullbackDays: 25,
    maxEmaDownsideTolerancePct: 2,
    minBreakoutAge: 10,
    maxBreakoutAge: 100,
    ...options,
  };
  if (rows.length < 250) return "INSUFFICIENT_DATA";
  const closes = rows.map((row) => row.close);
  const ema50 = ema(closes, 50);
  const currentIndex = rows.length - 1;
  for (let breakoutIndex = Math.max(140, currentIndex - filters.maxBreakoutAge); breakoutIndex <= currentIndex - filters.minBreakoutAge; breakoutIndex += 1) {
    if (!(rows[breakoutIndex - 1].close <= ema50[breakoutIndex - 1] && rows[breakoutIndex].close > ema50[breakoutIndex])) continue;
    const preRows = rows.slice(breakoutIndex - filters.downtrendLookback, breakoutIndex);
    const belowPct = preRows.filter((row, offset) => row.close < ema50[breakoutIndex - filters.downtrendLookback + offset]).length / preRows.length * 100;
    const declinePct = ((Math.max(...preRows.map((row) => row.high)) - Math.min(...preRows.map((row) => row.low))) / Math.max(...preRows.map((row) => row.high))) * 100;
    const volumeBase = rows.slice(breakoutIndex - 50, breakoutIndex).reduce((sum, row) => sum + row.volume, 0) / 50;
    const volumeRatio = rows[breakoutIndex].volume / volumeBase;
    const postHigh = Math.max(...rows.slice(breakoutIndex, currentIndex + 1).map((row) => row.high));
    const advancePct = (postHigh / rows[breakoutIndex].close - 1) * 100;
    const pullbackPct = ((postHigh - rows[currentIndex].close) / postHigh) * 100;
    const highIndex = rows.findIndex((row, index) => index > breakoutIndex && row.high === postHigh);
    const pullbackDays = currentIndex - highIndex;
    const emaDistance = (rows[currentIndex].close / ema50[currentIndex] - 1) * 100;
    if (belowPct >= filters.minBelowEmaPct && declinePct >= filters.minHistoricalDeclinePct && volumeRatio >= filters.breakoutVolumeMultiplier && advancePct >= filters.minPostBreakoutAdvancePct && pullbackPct >= filters.minPullbackPct && pullbackPct <= filters.maxPullbackPct && pullbackDays >= filters.minPullbackDays && pullbackDays <= filters.maxPullbackDays && emaDistance >= -filters.maxEmaDownsideTolerancePct) return "MATCH";
  }
  return "NO_MATCH";
}

function makeRows({ breakout = true, volume = 2, advance = true, pullback = true, length = 250 } = {}) {
  const rows = [];
  let close = 220;
  for (let i = 0; i < 150; i += 1) {
    close *= 0.995;
    rows.push({ close, high: close * 1.01, low: close * 0.99, volume: 1000 });
  }
  if (breakout) {
    close *= 1.28;
    rows.push({ close, high: close * 1.02, low: close * 0.98, volume: 1000 * volume });
  } else {
    rows.push({ close: close * 0.98, high: close, low: close * 0.96, volume: 2000 });
  }
  if (advance) {
    for (let i = rows.length; i < length - 12; i += 1) {
      close *= 1.006;
      rows.push({ close, high: close * 1.015, low: close * 0.99, volume: 1200 });
    }
  }
  if (pullback) {
    const target = close * 0.93;
    for (let i = rows.length; i < length; i += 1) {
      close += (target - close) * 0.35;
      rows.push({ close, high: close * 1.01, low: close * 0.99, volume: 700 });
    }
  }
  while (rows.length < length) rows.push({ close, high: close * 1.01, low: close * 0.99, volume: 1000 });
  return rows;
}

assert.equal(classify(makeRows()), "MATCH", "downtrend, high-volume breakout, advance, first pullback should match");
assert.equal(classify(makeRows({ breakout: false })), "NO_MATCH", "without EMA reclaim there is no setup");
assert.equal(classify(makeRows({ volume: 1 })), "NO_MATCH", "strict breakout mode rejects weak breakout volume");
assert.equal(classify(makeRows({ advance: false })), "NO_MATCH", "breakout without follow-through is rejected");
assert.equal(classify(makeRows({ pullback: false })), "NO_MATCH", "extended stock without pullback is rejected");
assert.equal(classify(makeRows({ length: 120 })), "INSUFFICIENT_DATA", "short histories are reported separately");

console.log("50 EMA reversal pullback deterministic tests passed.");
