import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/lib/tradeManagement.ts", "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const sandbox = { exports: {}, require: () => ({}) };
vm.runInNewContext(outputText, sandbox, { filename: "tradeManagement.ts" });
const { calculatePositionSizing, calculateRMultiple, calculateOpenRisk } = sandbox.exports;

const first = calculatePositionSizing({ totalCapital: 5000000, riskPercent: 0.2, entryPrice: 600, stopLoss: 580 });
assert.equal(first.riskAmount, 10000);
assert.equal(first.riskPerShare, 20);
assert.equal(first.quantity, 500);
assert.equal(first.positionValue, 300000);
assert.ok(Math.abs(first.stopLossPercent - 3.3333333333333335) < 1e-10);

const second = calculatePositionSizing({ totalCapital: 10000000, riskPercent: 0.2, entryPrice: 403.71, stopLoss: 395 });
assert.equal(second.riskAmount, 20000);
assert.equal(second.riskPerShare, 8.71);
assert.equal(second.quantity, Math.floor(20000 / 8.71));

assert.equal(calculateRMultiple(500, 480, 560), 3);

assert.equal(calculateRMultiple(500, 480, 560), 3);
assert.equal(calculateOpenRisk(100, 560, 500), 6000);
assert.equal(calculateRMultiple(500, 480, 500), 0);

console.log("Trade-management calculation tests passed.");
