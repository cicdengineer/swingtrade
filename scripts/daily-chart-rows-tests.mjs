import assert from "node:assert/strict";
import { mergeLiveDailyCandle } from "../src/lib/dailyChartRows.ts";

const candle = (trade_date, close, is_provisional = false) => ({ trade_date, open: close, high: close, low: close, close, volume: 100, is_provisional });
const provisional = candle("2026-10-27", 10, true);
const official = candle("2026-10-27", 11);
const olderIntraday = candle("2026-10-27", 12);

assert.deepEqual(mergeLiveDailyCandle([provisional, official], olderIntraday, "2026-10-28"), [official], "official candle replaces a duplicate provisional row; yesterday's intraday data is ignored");
assert.deepEqual(mergeLiveDailyCandle([official, provisional], null, "2026-10-28"), [official], "official candle wins regardless of row order");
assert.deepEqual(mergeLiveDailyCandle([official], olderIntraday, "2026-10-27"), [official], "intraday data never replaces an official candle");
assert.deepEqual(mergeLiveDailyCandle([official], candle("2026-10-28", 13), "2026-10-28"), [official, candle("2026-10-28", 13)], "today's live candle is appended once");

console.log("daily chart row tests passed");
