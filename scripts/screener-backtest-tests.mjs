import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const loaded = new Map();
const day = index => new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10);
const blank = { daily_prices: [], universe_members: [], instruments: [] };
let database = blank;

function load(name) {
  if (name === "localDatabase") return { readDatabase: async () => database };
  if (loaded.has(name)) return loaded.get(name);
  const module = { exports: {} };
  loaded.set(name, module.exports);
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = specifier => specifier === "server-only" ? {} :
    specifier.startsWith("./") ? load(specifier.slice(2)) : nativeRequire(specifier);
  new Function("require", "module", "exports", compiled)(require, module, module.exports);
  return module.exports;
}

const { parseBacktestConfig, prepareSessions, simulate, runScreenerBacktest } = load("screenerBacktest");
const settings = { totalCapital: 100000, riskPercent: 0.5 };
const config = parseBacktestConfig({ startDate: day(0), endDate: day(99), minTrades: 1, protectR: 20 }, settings);
assert.equal(config.riskPercent, 0.25);
assert.throws(() => parseBacktestConfig({ startDate: "2024-02-30" }, settings));

const variant = { id: "blend", label: "Blend", setup: "blend", trail: 20, breadth: 55, volume: 1.5, maxStop: 5 };
function session(index, close, overrides = {}) {
  const date = day(index);
  const point = {
    id: "A", candle: { symbol: "A", close, low: close - 1, volume: 100, trade_date: date },
    ema10: 97, ema20: 96, ema50: 95, gain: 2, momentum: 20, rvol: 2, turnover: 20,
    swing: 96, distance: 3, catchup: index === 0 ? 4 : null, breakout: false, upVolume: false,
    ...overrides,
  };
  return { date, points: new Map([["A", point]]), breadth: 60, benchmark: 100 - index };
}

const series = [session(0, 100), session(1, 101), session(2, 95), session(3, 93)];
const { metrics, snapshots } = simulate(series, config, variant, true);
assert.equal(snapshots[0].signals[0].symbol, "A");
assert.equal(snapshots[0].holdings.length, 0);
assert.equal(snapshots[1].events[0].action, "Buy");
assert.equal(snapshots[1].events[0].price, 101);
assert(snapshots[1].openRisk <= settings.totalCapital * config.openRiskPct / 100);
assert.equal(snapshots[2].events[0].action, "Exit queued");
assert.equal(snapshots[3].events[0].price, 93);
assert.equal(snapshots[3].events[0].action, "Sell");
assert.equal(metrics.trades, 1);
assert(metrics.costs > 0 && metrics.drawdown > 0 && metrics.expectancyR < -1);
assert(Math.abs(metrics.benchmarkDrawdown - 3) < 1e-9);
const positionCapped = { ...config, maxPositionPct: 1 };
assert(simulate(series, positionCapped, variant, false, 2).metrics.returnPct <
  simulate(series, positionCapped, variant).metrics.returnPct);

const weak = [{ ...series[0], breadth: null }, ...series.slice(1)];
assert.equal(simulate(weak, config, variant, true).snapshots[0].signals.length, 0);
const extended = [series[0], session(1, 104), ...series.slice(2)];
assert.equal(simulate(extended, config, variant, true).snapshots[1].events[0].reason, "Next close outside entry limits");
const missing = [series[0], series[1], series[2], { ...series[3], points: new Map() }, session(4, 91)];
const delayed = simulate(missing, config, variant, true).snapshots;
assert.equal(delayed[3].holdings[0].stale, true);
assert.equal(delayed[4].events[0].price, 91);

database = {
  instruments: [{ security_id: "INDEX", symbol: "NIFTY 500", exchange_segment: "IDX_I" }],
  universe_members: Array.from({ length: 10 }, (_, i) => ({
    security_id: String(i), is_current_constituent: true, universe_name: "CNX500",
  })),
  daily_prices: Array.from({ length: 200 }, (_, i) => {
    const date = day(i - 100);
    const close = 100 + i / 8;
    return [...Array.from({ length: 10 }, (_, j) => ({
      security_id: String(j), symbol: String(j), trade_date: date, close, open: close, low: close - 1, high: close + 1, volume: 100,
    })), { security_id: "INDEX", trade_date: date, close }];
  }).flat(),
};
const prepared = prepareSessions(database, config);
const prefix = prepareSessions(database, { ...config, endDate: day(69) });
assert.equal(prepared.sessions.length, 100);
assert.deepEqual(prepared.sessions.slice(0, 70), prefix.sessions);
const result = await runScreenerBacktest(config);
assert.equal(result.development.sessions, 70);
assert.equal(result.holdout.sessions, 30);
assert.equal(result.holdout.from, day(70));
assert.equal(result.validation.snapshots[0].equity, settings.totalCapital);
assert.equal(result.validation.snapshots[0].holdings.length, 0);
assert.equal(result.comparison.length, 5);
assert.equal(result.validated, false);
assert.notEqual(result.validation.metrics.benchmark, null);
console.log("Swing backtesting execution and holdout tests passed.");
