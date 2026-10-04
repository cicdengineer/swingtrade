import assert from "node:assert/strict";

function ema(values, period) {
  const out = Array(values.length).fill(undefined);
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = current;
  for (let i = period; i < values.length; i += 1) {
    current = (values[i] - current) * multiplier + current;
    out[i] = current;
  }
  return out;
}

function sma(values, period) {
  return values.map((_, i) => i + 1 < period ? undefined : values.slice(i + 1 - period, i + 1).reduce((s, v) => s + v, 0) / period);
}

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);

const values = [1, 2, 3, 4, 5, 6];
close(ema(values, 3)[2], 2, "initial EMA is SMA");
close(ema(values, 3)[3], 3, "EMA update");
close(sma([10, 20, 30], 2)[2], 25, "SMA volume");

function classify({ distance, breakout, volumeRatio, postGain, days, slope, currentVolRatio }) {
  const reasons = [];
  let status = "NO SETUP";
  if (distance < -3) status = "BROKEN BELOW 50 EMA";
  else if (distance > 5) status = "EXTENDED";
  else status = Math.abs(distance) <= 2 ? "NEAR 50 EMA" : "PULLBACK";
  if (!breakout || volumeRatio < 1.8) reasons.push("No breakout");
  if (postGain < 8) reasons.push("Weak follow-through");
  if (days < 10 || days > 90) reasons.push("Days out of range");
  if (distance < -3 || distance > 5) reasons.push("Not near EMA");
  if (slope <= 0) reasons.push("EMA not rising");
  if (currentVolRatio > 1.5) reasons.push("Current volume too high");
  return { status, qualifies: reasons.length === 0 };
}

assert.deepEqual(classify({ distance: 1, breakout: true, volumeRatio: 2, postGain: 12, days: 20, slope: 3, currentVolRatio: 1 }), { status: "NEAR 50 EMA", qualifies: true });
assert.equal(classify({ distance: 8, breakout: true, volumeRatio: 2, postGain: 12, days: 20, slope: 3, currentVolRatio: 1 }).status, "EXTENDED");
assert.equal(classify({ distance: -5, breakout: true, volumeRatio: 2, postGain: 12, days: 20, slope: 3, currentVolRatio: 1 }).status, "BROKEN BELOW 50 EMA");
assert.equal(classify({ distance: 1, breakout: true, volumeRatio: 2, postGain: 12, days: 4, slope: 3, currentVolRatio: 1 }).qualifies, false);
assert.equal(classify({ distance: 1, breakout: true, volumeRatio: 1.2, postGain: 12, days: 20, slope: 3, currentVolRatio: 1 }).qualifies, false);

console.log("Swing screener deterministic tests passed.");
