import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/lib/swingHigh.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Number, Array });
const { findSwingHigh, isAboveSwingHighRed } = module.exports;
const point = (date, low, d, close = low + 10) => ({ trade_date: date, low, close, daily_stoch_d: d });

const prior = [point("1", 100, 18), point("2", 96, 12), point("3", 99, 21)];
assert.equal(findSwingHigh(prior)?.price, 96, "the lowest candle low defines the latest zone's red line");
assert.equal(findSwingHigh(prior)?.qualifies, false, "a second zone is required");
assert.equal(isAboveSwingHighRed(prior, 97), true, "AboveRed uses the latest zone line even before a second zone");
assert.equal(isAboveSwingHighRed(prior, 96), false, "AboveRed requires LTP strictly above the line");
const next = [...prior, point("4", 104, 19), point("5", 101, 14)];
assert.equal(findSwingHigh(next)?.price, 96, "the prior zone line remains fixed during the next zone");
assert.equal(findSwingHigh(next)?.zoneLow, 101, "the new zone tracks its lowest candle low");
assert.equal(findSwingHigh(next)?.qualifies, true, "a higher oversold zone qualifies");
assert.equal(findSwingHigh(next, 96)?.qualifies, false, "price must stay strictly above the line");
assert.equal(findSwingHigh([...next, point("6", 105, 50)])?.qualifies, true, "%D at 50 remains visible");
assert.equal(findSwingHigh([...next, point("6", 105, 31)])?.qualifies, true, "the setup stays visible above the old 30 cutoff");
assert.equal(findSwingHigh([...next, point("6", 105, 50.01)])?.qualifies, false, "%D above 50 ends the setup");
assert.equal(findSwingHigh([...next, point("6", 105, 51)])?.price, 101, "the most recent zone becomes the new red line");
assert.equal(findSwingHigh([...prior, point("4", 94, 19)])?.qualifies, false, "a lower next zone fails");
assert.equal(findSwingHigh([...next, point("6", 106, 32), point("7", 105, 18)])?.price, 101, "a third zone compares against the immediately preceding zone");

console.log("SwingHigh signal tests passed.");
