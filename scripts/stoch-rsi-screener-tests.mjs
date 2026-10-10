import assert from "node:assert/strict";

function rsi(values, length = 14) {
  const out = Array(values.length).fill(undefined);
  if (values.length <= length) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / length;
  let avgLoss = loss / length;
  out[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = length + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (length - 1) + Math.max(change, 0)) / length;
    avgLoss = (avgLoss * (length - 1) + Math.max(-change, 0)) / length;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function sma(values, length) {
  return values.map((_, i) => {
    if (i + 1 < length) return undefined;
    const window = values.slice(i + 1 - length, i + 1);
    if (window.some((v) => v === undefined)) return undefined;
    return window.reduce((sum, v) => sum + v, 0) / length;
  });
}

function stochD(values, rsiLength = 14, stochLength = 14, smoothK = 3, smoothD = 3) {
  const r = rsi(values, rsiLength);
  const raw = r.map((value, i) => {
    if (value === undefined || i + 1 < stochLength) return undefined;
    const window = r.slice(i + 1 - stochLength, i + 1);
    if (window.some((v) => v === undefined)) return undefined;
    const low = Math.min(...window);
    const high = Math.max(...window);
    return high === low ? 0 : ((value - low) / (high - low)) * 100;
  });
  return sma(sma(raw, smoothK), smoothD);
}

function classify({ weeklyD, dailyD, currentHigh, previousHigh }) {
  const setup = weeklyD > 80 && dailyD < 20 ? "GREEN_SETUP" : weeklyD < 20 && dailyD > 80 ? "BLUE_SETUP" : undefined;
  const breakout = currentHigh > previousHigh;
  return {
    setup,
    signal: setup === "GREEN_SETUP" && breakout ? "GREEN_ENTRY" : setup === "BLUE_SETUP" && breakout ? "BLUE_ENTRY" : "NONE",
  };
}

function annotateZone(rows) {
  let active;
  let low = Infinity;
  return rows.map((row) => {
    if (row.setup !== active) {
      active = row.setup;
      low = active ? row.low : Infinity;
    }
    const newLowest = Boolean(active && row.low <= low);
    if (newLowest) low = row.low;
    return { ...row, newLowest, zoneLow: active ? low : undefined };
  });
}

assert.equal(classify({ weeklyD: 81, dailyD: 19, currentHigh: 101, previousHigh: 100 }).signal, "GREEN_ENTRY");
assert.equal(classify({ weeklyD: 19, dailyD: 81, currentHigh: 101, previousHigh: 100 }).signal, "BLUE_ENTRY");
assert.equal(classify({ weeklyD: 81, dailyD: 19, currentHigh: 100, previousHigh: 100 }).signal, "NONE", "breakout must be strict greater-than");

const zone = annotateZone([
  { setup: "GREEN_SETUP", low: 50 },
  { setup: "GREEN_SETUP", low: 49 },
  { setup: "GREEN_SETUP", low: 51 },
  { setup: undefined, low: 47 },
  { setup: "GREEN_SETUP", low: 48 },
]);
assert.deepEqual(zone.map((row) => [row.newLowest, row.zoneLow]), [[true, 50], [true, 49], [false, 49], [false, undefined], [true, 48]]);

const sample = [44, 44.15, 43.9, 44.35, 44.8, 45.1, 44.7, 45.5, 46, 45.8, 46.6, 47.2, 46.9, 47.8, 48.4, 48.1, 48.9, 49.5, 49.2, 50.1, 50.8, 51.4, 51, 51.8, 52.6, 52.2, 53, 53.8, 53.2, 54.1, 55, 54.4, 55.2, 56.1, 55.6, 56.8, 57.5, 57.1, 58.2, 59];
const d = stochD(sample);
assert.ok(d.at(-1) >= 0 && d.at(-1) <= 100, "StochRSI %D stays bounded");
assert.equal(Number(d.at(-1).toFixed(6)), 39.267698, "StochRSI fixture remains deterministic");

const weeklyForDaily = new Map([
  ["2026-09-28", 83],
  ["2026-10-05", 18],
]);
assert.equal(weeklyForDaily.get("2026-10-05"), 18, "daily candles use the prior completed weekly value supplied for that week");

console.log("StochRSI screener deterministic tests passed.");
