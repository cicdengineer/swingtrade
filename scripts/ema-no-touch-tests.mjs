import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/emaNoTouchLogic.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require: () => ({}) });
const { findEmaNoTouch, emaSeries } = module.exports;

const row = (index, { close = 100, high = 101, low = 99, provisional = false } = {}) => ({
  trade_date: `2026-09-${String(index + 1).padStart(2, "0")}`, open: close - 1, high, low, close, volume: 1000, is_provisional: provisional,
});
const base = Array.from({ length: 10 }, (_, index) => row(index));
const anchor = row(10, { close: 106, high: 110, low: 104 });
const holding = row(11, { close: 105, high: 109, low: 95 });
const valid = [...base, anchor, holding];
assert.equal(findEmaNoTouch(valid)?.anchor.trade_date, anchor.trade_date);
assert.equal(findEmaNoTouch(valid)?.triggered, false);
assert.equal(findEmaNoTouch(valid)?.anchorEma10, emaSeries(valid.map((item) => item.close), 10)[10]);
assert.equal(findEmaNoTouch([...valid, row(12, { close: 105, high: 111, low: 95 })])?.triggered, true, "a later intraday high triggers entry");
assert.equal(findEmaNoTouch([...valid, row(12, { close: 90, high: 111, low: 89 })]), null, "completed close below EMA ends the line");
assert.equal(findEmaNoTouch([...valid, row(12, { close: 105, high: 111, low: 95, provisional: true })])?.triggered, false, "provisional candle cannot replace or end the setup");
const touched = [...base, row(10, { close: 106, high: 110, low: 100 }), holding];
assert.equal(findEmaNoTouch(touched), null, "signal low must stay strictly above EMA");
assert.equal(findEmaNoTouch(valid, 1)?.anchor.trade_date, anchor.trade_date);
assert.equal(findEmaNoTouch([...valid, row(12), row(13)], 1), null, "signal age limit is enforced");
console.log("EMA no-touch tests passed");
