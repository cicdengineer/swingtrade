import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/lib/stochHigh.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Number, Array });
const { findStochHigh } = module.exports;
const point = (date, high, close, daily_stoch_d) => ({ trade_date: date, high, close, daily_stoch_d });

const overbought = [point("1", 100, 98, 81), point("2", 105, 102, 92), point("3", 103, 101, 84)];
assert.equal(findStochHigh(overbought)?.qualifies, false, "line is tracked but cannot qualify while %D is over 80");
assert.equal(findStochHigh([...overbought, point("4", 103, 102, 79)])?.price, 105, "highest candle high in the latest overbought run is frozen");
assert.equal(findStochHigh([...overbought, point("4", 103, 102, 79)])?.qualifies, true, "near the line qualifies");
assert.equal(findStochHigh([...overbought, point("4", 101, 100, 79)])?.qualifies, true, "a price less than 5% below the line qualifies");
assert.equal(findStochHigh([...overbought, point("4", 103, 102, 80)])?.qualifies, false, "the current %D must be strictly below 80");
assert.equal(findStochHigh([...overbought, point("4", 110, 102, 79)])?.price, 105, "a later high with %D below 80 cannot raise the line");
assert.equal(findStochHigh([...overbought, point("4", 100, 90, 60)])?.qualifies, false, "distant prices do not qualify");
assert.equal(findStochHigh([...overbought, point("4", 110, 108, 70)])?.qualifies, true, "price above the line qualifies");
assert.equal(findStochHigh([...overbought, point("4", 104, 103, 75), point("5", 120, 116, 85), point("6", 119, 117, 60)])?.price, 120, "a new overbought run replaces the prior line");
assert.equal(findStochHigh([point("1", 100, 99, 50)]), null, "no overbought run means no line");

console.log("StochHigh signal tests passed.");
