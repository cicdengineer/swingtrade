import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/lib/qullamaggieLogic.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Intl, Date, Math, Array, Number, Set, Map });
const { analyzeQStock, defaultQFilters, positionSize, openingRangeSignal } = module.exports;
const d = new Date("2025-01-01T00:00:00Z");
const prices = [];
for (let i = 0; i < 150; i++) {
  const day = new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10);
  const close = i < 138 ? 100 + i * .8 : 210 + (i % 2) * .1;
  const spread = i < 138 ? 2 : i < 143 ? 2 : .5;
  prices.push({ id: String(i), security_id: "1", symbol: "TEST", isin: "", trade_date: day, open: close - .1, high: close + spread, low: close - spread, close, volume: i < 143 ? 1000 : 300, exchange_segment: "NSE_EQ", instrument: "EQUITY", data_source: "DHAN_DAILY", created_at: "", updated_at: "" });
}
const f = { ...defaultQFilters, oneMonth: false, threeMonth: false, sixMonth: false, above50: false, emaStack: false, rising20: false, minTightness: 0, maxVolumeRatio: 1, shrinkingVolatility: false };
const input = { securityId: "1", symbol: "TEST", companyName: "Test", universeName: "MIDCAP", prices, filters: f };
const before = analyzeQStock({ ...input, asOf: prices[148].trade_date });
assert.equal(before.stage, "Near Breakout");
assert.ok(before.tightness >= 65);
assert.equal(before.baseDays, 11);
const fivePrices = prices.map((r, i) => {
  const close = i < 138 ? 100 + i : 240 + i % 2 * .1;
  const spread = i < 143 ? 2 : .5;
  return { ...r, open: close - .1, high: close + spread, low: close - spread, close };
});
const fiveDayBase = analyzeQStock({ ...input, prices: fivePrices, asOf: prices[148].trade_date, filters: { ...f, minBaseDays: 5, maxBaseDays: 5 } });
assert.equal(fiveDayBase.baseDays, 5);
assert.equal(before.dataDate, prices[148].trade_date);
assert.ok(before.adr20 > 0);
assert.equal(before.recent.at(-1).trade_date, prices[148].trade_date);
const breakoutPrices = prices.map(r => ({ ...r }));
breakoutPrices[149] = { ...breakoutPrices[149], open: 211, high: 215, low: 210, close: 214 };
const breakout = analyzeQStock({ ...input, prices: breakoutPrices, filters: { ...f, maxStopAdr: 10 } });
assert.equal(breakout.stage, "Breakout Triggered");
assert.equal(breakout.breakoutDate, prices[149].trade_date);
assert.equal(positionSize(100, 95, 100000, 1, 10).quantity, 100);
assert.equal(positionSize(100, 100, 100000, 1, 10).quantity, 0);
const minutes = Array.from({ length: 7 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 2, 3, 45 + i)).toISOString(), open: 100, high: i === 6 ? 106 : 102, low: 99, close: i === 6 ? 105 : 101 }));
assert.equal(openingRangeSignal(minutes, 103, 5, 10, 1).status, "Fresh ORH cross");
assert.equal(openingRangeSignal(minutes, 103, 5, 10, 1).signalTime, minutes[6].date);
assert.equal(openingRangeSignal(minutes.map((c, i) => i === 6 ? { ...c, low: 80 } : c), 103, 5, 10, 1).stop, 99);
assert.equal(openingRangeSignal(minutes.slice(0, 4), 103, 5, 10, 1).status, "Intraday data required");
console.log("Qullamaggie logic tests passed");
