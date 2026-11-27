import assert from "node:assert/strict";
import { findBullishPennant, flagDefaults, flagTargetMultiplier } from "../src/lib/flagScreenerLogic.ts";

function candle(index, close, high, low, volume) {
  return {
    trade_date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    open: close, close, high, low, volume,
  };
}

const pole = Array.from({ length: 10 }, (_, i) => candle(i, 100 + i * 2, 101 + i * 2, 99 + i * 2, 1000));
const pennant = [
  [118, 120, 117], [113, 116, 112], [116, 118, 114],
  [117, 118.5, 115], [115, 117, 114], [116, 117, 115],
].map(([close, high, low], i) => candle(i + 10, close, high, low, 600));
const forming = [...pole, ...pennant];
const scan = rows => findBullishPennant(rows, flagDefaults);
const setup = scan(forming);
assert.equal(setup?.status, "forming");
assert(setup.boundaries.upperEnd < setup.boundaries.upperStart);
assert(setup.boundaries.lowerEnd > setup.boundaries.lowerStart);
assert.equal(scan([...pole, ...pennant.map(row => ({ ...row, volume: 1500 }))]), null);
assert.equal(scan([...pole, ...pennant.map(row => ({ ...row, low: 111 }))]), null);
assert.notEqual(scan([...forming, candle(16, 116, 119, 115, 1700)])?.status, "breakout");
assert.notEqual(scan([...forming, candle(16, 119, 120, 116, 900)])?.status, "breakout");

const breakout = [...forming, candle(16, 119, 120, 116, 1700)];
assert.equal(scan(breakout)?.status, "breakout");
assert.equal(scan(breakout)?.breakout.close, 119);
const pullback = [...breakout, ...Array.from({ length: 65 }, (_, i) => candle(i + 17, 115, 123, 109, 1000))];
assert.equal(scan(pullback)?.status, "breakout");
const target = [...pullback, candle(82, 121, 119 * flagTargetMultiplier, 120, 1000)];
assert.equal(scan(target), null);
assert.equal(scan([...target, candle(83, 120, 122, 119, 1000)]), null);
console.log("Flag screener tests passed");
