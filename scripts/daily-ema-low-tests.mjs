import assert from "node:assert/strict";
import { isCurrentDayLowAbove10Ema } from "../src/lib/dailyEmaLow.ts";

const date = "2026-11-04";
const row = (low, ema10 = 100, tradeDate = date) => ({
  ema10: 99,
  recent: [{ trade_date: tradeDate, low, ema10 }],
});

assert.equal(isCurrentDayLowAbove10Ema(row(100.01), date), true);
assert.equal(isCurrentDayLowAbove10Ema(row(100), date), false, "a touch does not qualify");
assert.equal(isCurrentDayLowAbove10Ema(row(99.99), date), false);
assert.equal(isCurrentDayLowAbove10Ema(row(101, 100, "2026-11-03"), date), false, "prior-day candles do not qualify");
assert.equal(isCurrentDayLowAbove10Ema({ ema10: 100, recent: [] }, date), false);
assert.equal(isCurrentDayLowAbove10Ema({ ema10: 100, recent: [{ trade_date: date, low: 101 }] }, date), true, "the current row EMA is used when the candle has none");

console.log("Current-day low above 10 EMA tests passed.");
