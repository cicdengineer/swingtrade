import assert from "node:assert/strict";
import { findSwingHighSignals } from "../src/lib/swingHighLogic.ts";

const candles = (highs) => highs.map((high, index) => ({ trade_date: `2026-01-${String(index + 1).padStart(2, "0")}`, high, low: high - 8, close: high - 2 }));

const valid = findSwingHighSignals(candles([95, 100, 105, 103, 104, 106]), [40, 81, 91, 83, 65, 72]);
assert.equal(valid.signals.length, 1);
assert.equal(valid.signals[0].level, 105);
assert.equal(valid.signals[0].high_date, "2026-01-03");
assert.equal(valid.signals[0].breakout_date, "2026-01-06");
assert.equal(valid.signals[0].breakout_d, 72);

const inZone = findSwingHighSignals(candles([95, 100, 106, 108]), [40, 81, 90, 85]);
assert.equal(inZone.signals.length, 0);
assert.equal(inZone.activeLevel?.level, 108);

const rejected = findSwingHighSignals(candles([95, 100, 105, 104, 107, 103, 108]), [40, 81, 85, 65, 82, 70, 72]);
assert.equal(rejected.signals.length, 1);
assert.equal(rejected.signals[0].level, 107);
assert.equal(rejected.signals[0].breakout_date, "2026-01-07");

const equal80 = findSwingHighSignals(candles([95, 100, 105, 104, 106]), [40, 81, 85, 70, 80]);
assert.equal(equal80.signals.length, 0);

console.log("SwingHigh tests passed");
