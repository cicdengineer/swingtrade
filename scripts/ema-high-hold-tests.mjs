import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/emaHighHoldLogic.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require: () => ({}) });
const { findEmaHighHold } = module.exports;

const row = (index, close = 100, high = 101) => ({ trade_date: `2026-09-${String(index + 1).padStart(2, "0")}`, open: close - 1, high, low: close - 2, close, volume: 1000 });
const base = Array.from({ length: 10 }, (_, index) => row(index));
const qualifying = [...base, row(10, 105, 110), row(11, 106, 109), row(12, 107, 111), row(13, 108, 109)];
assert.equal(findEmaHighHold(qualifying)?.qualifies, true, "a wick above the high is allowed");
assert.equal(findEmaHighHold(qualifying)?.anchor.trade_date, "2026-09-11");
const breaksHigh = [...qualifying]; breaksHigh[13] = row(13, 111, 112);
assert.equal(findEmaHighHold(breaksHigh)?.qualifies, false, "a close above the high fails");
const breaksEma = [...qualifying]; breaksEma[13] = row(13, 90, 109);
assert.equal(findEmaHighHold(breaksEma)?.qualifies, false, "a close below its EMA fails");
const noNewHigh = [...qualifying]; noNewHigh[9] = row(9, 100, 112);
assert.equal(findEmaHighHold(noNewHigh)?.qualifies, false, "anchor must exceed the preceding candle high");
const provisional = [...qualifying, { ...row(14, 130, 131), is_provisional: true }];
assert.equal(findEmaHighHold(provisional)?.qualifies, true, "provisional candle is excluded");
assert.equal(findEmaHighHold(qualifying.slice(0, -1)), null, "three completed holding candles are required");
console.log("EMA high hold tests passed");
