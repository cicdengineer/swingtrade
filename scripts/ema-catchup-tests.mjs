import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/emaNoTouchLogic.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require: () => ({}) });
const { findEmaCatchup } = module.exports;

const criteria = { baseDays: 5, minPriorAdvancePct: 8, maxBaseRangePct: 7, maxDistanceFromEmaPct: 4, minCatchupPct: 0.5 };
const date = (index) => new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
const prices = Array.from({ length: 40 }, (_, index) => {
  const close = index < 15 ? 100 : index < 35 ? 100 + index - 14 : 120;
  return { trade_date: date(index), open: close - 1, high: close + 1, low: close - 2, close, volume: 1000 };
});
const setup = findEmaCatchup(prices, criteria);
assert.ok(setup, "an existing advance followed by a tight, flat base allows EMA catchup");
assert.equal(setup.swingLow.low, 118);
assert.equal(setup.swingLow.trade_date, date(35));
assert.ok(setup.emaSlopePct > 0 && setup.catchupPct > 0);
assert.equal(findEmaCatchup(prices.map((row) => ({ ...row, close: 100, high: 101, low: 98 })), criteria), null, "flat stocks fail the uptrend rule");
const wideBase = prices.map((row, index) => index === 37 ? { ...row, high: 140, low: 110 } : row);
assert.equal(findEmaCatchup(wideBase, criteria), null, "wide bases are not sideways");
assert.equal(findEmaCatchup(prices, { ...criteria, minCatchupPct: setup.catchupPct + 0.1 }), null, "the EMA gap must contract enough");
assert.equal(findEmaCatchup(prices, { ...criteria, maxDistanceFromEmaPct: setup.currentGapPct - 0.1 }), null, "price must be near the 10 EMA");
assert.equal(findEmaCatchup([...prices, { ...prices.at(-1), trade_date: date(40), close: 90, is_provisional: true }], criteria)?.current.trade_date, date(39), "today's provisional candle is excluded");
console.log("EMA catchup tests passed");
