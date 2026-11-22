import assert from "node:assert/strict";
import { earningsBreakout } from "../src/lib/earningsBreakout.ts";

const bar = (day, close, high = close + 0.2, low = close - 0.2, extra = {}) => ({
  trade_date: `2026-10-${String(day).padStart(2, "0")}`, close, high, low, volume: 100, ...extra,
});
const earnings = bar(21, 99, 100);
const history = Array.from({ length: 20 }, (_, index) => bar(index + 1, 95));
const base = [...history, earnings, bar(22, 99), bar(23, 99.5), bar(24, 99.8, 100)];
const live = earningsBreakout([...base, bar(25, 101, 102, 99, { is_provisional: true, volume: 900 })], earnings);
assert.equal(live.status, "Testing the high");
assert.equal(live.label, "Tight base");
assert.equal(live.liveTest, true);
assert.equal(live.relativeVolume, 1);

const breakout = [...base, bar(25, 101, 101.4, 99, { volume: 180 })];
const confirmed = earningsBreakout(breakout, earnings);
assert.equal(confirmed.status, "Closed above");
assert.equal(confirmed.relativeVolume, 1.8);
const retest = earningsBreakout([...breakout, bar(26, 100.5, 101, 99.9)], earnings);
assert.equal(retest.status, "Retest held");
assert.equal(retest.setupLow, confirmed.setupLow);

const failed = [...breakout, bar(26, 99.7, 101)];
assert.equal(earningsBreakout(failed, earnings).status, "Closed back below");
const reclaim = earningsBreakout([...failed, bar(27, 103)], earnings);
assert.equal(reclaim.status, "Closed above");
assert.equal(reclaim.label, "Reclaim setup");
assert.equal(reclaim.extended, true);
assert.equal(earningsBreakout([{ ...earnings, is_provisional: true }], earnings), undefined);

console.log("Earnings breakout checks passed");
