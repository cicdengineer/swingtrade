import assert from "node:assert/strict";
import { simulateMomentumBacktest } from "../src/lib/momentumBacktest.ts";

const symbols = Array.from({ length: 12 }, (_, index) => `STOCK${String(index).padStart(2, "0")}`);
const session = (date, prices, provisional = false) => prices.flatMap((close, index) => close === null ? [] : [{
  security_id: symbols[index], symbol: symbols[index], trade_date: date, close, is_provisional: provisional,
}]);
const samePrice = (price, count = 12) => Array(count).fill(price);
const seed = [
  ...session("2025-12-31", samePrice(100)),
  ...session("2026-01-02", samePrice(100)),
  ...session("2026-01-30", [160, 159, 158, 157, 156, 155, 154, 153, 152, 151, 150, 129]),
  ...session("2026-02-02", samePrice(100)),
];
const run = (...rows) => new Map(simulateMomentumBacktest([...seed, ...rows]).snapshots.map(day => [day.date, day]));

const daily = run(
  ...session("2026-02-03", [100, 110, 109, 108, 100, 100, 100, 100, 100, 100, 500, 600]),
  ...session("2026-02-27", samePrice(100)),
  ...session("2026-03-02", samePrice(130)),
  ...session("2026-03-03", samePrice(999), true),
);
assert.equal(daily.get("2026-02-02").deployed, 100_000);
assert.deepEqual(daily.get("2026-02-03").trades.map(trade => trade.symbol), symbols.slice(1, 4));
assert.equal(daily.get("2026-02-03").deployed, 30_000);
assert.equal(daily.get("2026-02-03").accountMtm, 2700);
assert.equal(daily.get("2026-02-27").signal, "Month end");
assert.equal(daily.get("2026-02-27").trades.length, 10);
assert.equal(daily.get("2026-02-27").holdings.length, 0);
assert.equal(daily.get("2026-03-02").deployed, 0);
assert.equal(daily.has("2026-03-03"), false);

const profit = run(
  ...session("2026-02-04", samePrice(200, 10)),
  ...session("2026-02-05", samePrice(200)),
);
assert.equal(profit.get("2026-02-04").signal, "Profit target");
assert.equal(profit.get("2026-02-04").realized, 100_000);
assert.equal(profit.get("2026-02-05").signal, "Trailing 30 calendar days ranking");
assert.equal(profit.get("2026-02-05").deployed, 100_000);
assert.equal(profit.get("2026-02-05").accountMtm, 100_000);

const loss = run(
  ...session("2026-02-04", [null, ...samePrice(40, 9)]),
  ...session("2026-02-05", samePrice(40)),
  ...session("2026-02-06", samePrice(45)),
);
assert.equal(loss.get("2026-02-04").signal, "Loss limit");
assert.equal(loss.get("2026-02-04").pendingExit, true);
assert.equal(loss.get("2026-02-04").realized, -54_000);
assert.equal(loss.get("2026-02-05").pendingExit, false);
assert.equal(loss.get("2026-02-05").realized, -60_000);
assert.equal(loss.get("2026-02-06").deployed, 0);

const window = simulateMomentumBacktest([
  ...session("2024-12-31", [100]),
  ...session("2025-01-31", [130]),
  ...session("2025-02-03", [130]),
  ...session("2025-02-04", [130]),
  ...session("2026-02-02", [130]),
]).snapshots;
assert.equal(window[0].date, "2025-02-03");
assert.equal(window[0].deployed, 10_000);
console.log("Momentum backtest tests passed.");
