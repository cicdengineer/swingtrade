import assert from "node:assert/strict";
import { todayMinuteRows, applyMinuteTick, anchoredVwap } from "../src/lib/minuteChart.ts";

const now = Date.parse("2026-11-06T06:00:00Z");
const candle = (date, low = 100, volume = 100) => ({ trade_date: date, open: 101, high: 104, low, close: 102, volume });
const first = candle("2026-11-06T03:45:00.000Z");
const yesterday = candle("2026-11-05T09:59:00.000Z");
assert.deepEqual(todayMinuteRows([yesterday, first], now), [first]);
assert.equal(todayMinuteRows([candle("2026-11-05T20:00:00Z")], now).length, 1, "date boundary is IST, not UTC");
assert.equal(todayMinuteRows(Array.from({ length: 375 }, (_, i) => candle(new Date(Date.parse(first.trade_date) + i * 60000).toISOString())), Date.parse("2026-11-06T10:00:00Z")).length, 375, "retain the entire session");
const tick = { ltp: 106, volume: 130, receivedAt: now, lastTradeTime: Date.parse("2026-11-06T03:45:30Z") / 1000 };
const updated = applyMinuteTick([first], tick, now);
assert.equal(updated[0].high, 106);
assert.equal(updated[0].open, 101);
assert.equal(updated[0].volume, 130);
assert.deepEqual(applyMinuteTick(updated, tick, now), updated, "snapshot repeats do not double-count volume");
const next = applyMinuteTick(updated, { ...tick, ltp: 99, volume: 150, lastTradeTime: tick.lastTradeTime + 60 }, now);
assert.equal(next.length, 2);
assert.equal(next[1].volume, 20);
assert.equal(next[1].low, 99);
assert.deepEqual(applyMinuteTick(next, tick, now), next, "older minute ticks cannot rewind the chart");
assert.deepEqual(applyMinuteTick([first], { ...tick, lastTradeTime: tick.lastTradeTime - 86400 }, now), [first]);
assert.deepEqual(todayMinuteRows(next, now + 86400000), [], "new day clears prior session");
assert.deepEqual(anchoredVwap([first, { ...candle("2026-11-06T03:46:00Z", 110, 300), high: 116, close: 114 }]), [102, 110.5]);
assert.ok(Number.isNaN(anchoredVwap([candle(first.trade_date, 100, 0)])[0]), "no VWAP exists until volume is traded");
assert.deepEqual(anchoredVwap([candle(first.trade_date, 100, 0), first]), [NaN, 102]);
assert.equal(anchoredVwap(updated)[0], (106 + 100 + 106) / 3, "live high and close update HLC3");
assert.deepEqual(anchoredVwap([first, { ...first, volume: 0, high: 1000 }]), [102, 102], "zero-volume candles do not move VWAP");

assert.deepEqual(applyMinuteTick([first], { ...tick, lastTradeTime: now / 1000 + 19800 }, now), [first], "future-dated ticks cannot append a false late-session candle");
assert.deepEqual(todayMinuteRows([first, candle("2026-11-06T11:38:00Z")], now), [first]);

console.log("minute chart tests passed");
