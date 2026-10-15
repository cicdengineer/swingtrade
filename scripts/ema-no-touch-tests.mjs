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
const history = Array.from({ length: 10 }, (_, index) => row(index));
const yesterday = row(10, { close: 106, high: 110, low: 104 });
const valid = [...history, yesterday];
assert.equal(findEmaNoTouch(valid)?.anchor.trade_date, yesterday.trade_date, "latest completed candle is the signal");
assert.equal(findEmaNoTouch(valid)?.anchorEma10, emaSeries(valid.map((item) => item.close), 10)[10]);
assert.equal(findEmaNoTouch([...history.slice(0, -1), row(9, { high: 115 }), yesterday])?.anchor.high, 110, "a higher high is not required");
const emaOnLatest = emaSeries(valid.map((item) => item.close), 10).at(-1);
assert.equal(findEmaNoTouch([...history, { ...yesterday, low: emaOnLatest }]), null, "touching the EMA fails the strict low-above rule");
assert.equal(findEmaNoTouch([...valid, row(11, { close: 101, high: 108, low: 99 })]), null, "an older qualifying candle cannot substitute for yesterday");
assert.equal(findEmaNoTouch([...valid, row(11, { close: 125, high: 130, low: 120, provisional: true })])?.anchor.trade_date, yesterday.trade_date, "today's provisional candle is excluded");
assert.equal(findEmaNoTouch(history.slice(0, 9)), null, "EMA needs ten completed closes");
console.log("EMA no-touch tests passed");
