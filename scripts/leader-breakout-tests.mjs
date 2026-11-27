import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: key => dependencies[key] });
  return module.exports;
}

const { simulateLeaderBreakout } = load("leaderBreakout", { "./momentumBacktest": load("momentumBacktest") });
const date = index => new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
const series = (symbol, price) => Array.from({ length: 87 }, (_, index) => ({
  security_id: symbol, symbol, trade_date: date(index), close: price(index),
  high: price(index) + 1, open: price(index),
}));
const benchmark = series("INDEX", () => 100);
const leader = series("LEADER", index => index < 63 ? 100 : index < 66 ? 130 : 90);
leader[64].open = 140;
leader[67].open = 85;
const runnerUp = series("RUNNER", index => index < 63 ? 100 : 120);
const simulate = (rows, start = 63) => simulateLeaderBreakout(rows, benchmark, date(start)).snapshots;

const days = simulate([...leader, ...runnerUp]);
assert.equal(days[0].picks[0].symbol, "LEADER");
assert.equal(days[0].trades.length, 0);
assert.equal(days[1].deployed, 10_000);
assert.equal(days[1].trades[0].symbol, "LEADER");
assert.ok(Math.abs(days[1].trades[0].price - 140.14) < 1e-8);
assert.equal(days[3].queuedExits[0], "LEADER");
assert.equal(days[4].trades[0].action, "Sell");
assert.ok(Math.abs(days[4].trades[0].price - 84.915) < 1e-8);
assert.equal(days[4].accountMtm, days[4].realized);
assert.ok(days[4].maxDrawdown > 0);
assert.equal(days[4].peakCapital, 10_000);
assert.equal(days[4].buySessions, 1);
assert.equal(simulate(leader.filter(row => row.trade_date !== date(64)).concat(runnerUp))[1].missedEntry, "LEADER");
assert.equal(simulate(leader, 64)[0].deployed, 0);

const steady = series("STEADY", index => index < 63 ? 100 : 130);
const timed = simulate(steady);
assert.equal(timed[20].queuedExits[0], "STEADY");
assert.equal(timed[21].trades[0].action, "Sell");
console.log("Leader breakout ranking, fill timing, costs, exits, and fresh replay tests passed.");
