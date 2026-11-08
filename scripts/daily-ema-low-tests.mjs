import assert from "node:assert/strict";
import { isLatestLowAbove10Ema } from "../src/lib/dailyEmaLow.ts";

const date = "2026-11-04";
const row = (low, ema10 = 100, tradeDate = date) => ({
  ema10: 99,
  recent: [{ trade_date: tradeDate, low, ema10 }],
});

assert.equal(isLatestLowAbove10Ema(row(100.01)), true);
assert.equal(isLatestLowAbove10Ema(row(100)), false, "a touch does not qualify");
assert.equal(isLatestLowAbove10Ema(row(99.99)), false);
assert.equal(isLatestLowAbove10Ema(row(101, 100, "2026-11-06")), true, "the last trading session qualifies without a current-day candle");
assert.equal(isLatestLowAbove10Ema({ ema10: 100, recent: [] }), false);
assert.equal(isLatestLowAbove10Ema({ ema10: 100, recent: [{ trade_date: date, low: 101 }] }), true, "the current row EMA is used when the candle has none");

assert.equal(isLatestLowAbove10Ema({ ema10: 100, recent: [
  ...row(101, 100, "2026-11-06").recent,
  ...row(99, 100, "2026-11-09").recent,
] }), false, "a newer candle supersedes a qualifying Friday candle");

console.log("Latest session low above 10 EMA tests passed.");
