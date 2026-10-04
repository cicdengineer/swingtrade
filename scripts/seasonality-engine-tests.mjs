import assert from "node:assert/strict";

const pct = (exit, entry) => (exit / entry - 1) * 100;
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};
const avg = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const std = (values) => {
  const mean = avg(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);

function observe(rows, start, end) {
  const slice = rows.filter((row) => row.date >= start && row.date < end).sort((a, b) => a.date.localeCompare(b.date));
  if (slice.length < 2) return null;
  const entry = slice[0];
  const exit = slice.at(-1);
  return {
    n: slice.length,
    entryDate: entry.date,
    exitDate: exit.date,
    returnPct: pct(exit.close, entry.close),
    maePct: pct(Math.min(...slice.map((row) => row.low)), entry.close),
    mfePct: pct(Math.max(...slice.map((row) => row.high)), entry.close),
  };
}

const rows = [
  { date: "2024-01-02", close: 100, low: 98, high: 103 },
  { date: "2024-02-01", close: 105, low: 95, high: 112 },
  { date: "2024-03-28", close: 115, low: 106, high: 125 },
  { date: "2024-11-01", close: 200, low: 190, high: 205 },
  { date: "2024-12-02", close: 210, low: 180, high: 240 },
  { date: "2025-01-31", close: 230, low: 215, high: 250 },
  { date: "2025-02-28", close: 260, low: 225, high: 270 },
];

const janMar = observe(rows, "2024-01-01", "2024-04-01");
assert.equal(janMar.entryDate, "2024-01-02");
assert.equal(janMar.exitDate, "2024-03-28");
close(janMar.returnPct, 15, "3-month return");
close(janMar.maePct, -5, "MAE");
close(janMar.mfePct, 25, "MFE");

const novJan = observe(rows, "2024-11-01", "2025-02-01");
assert.equal(novJan.entryDate, "2024-11-01");
assert.equal(novJan.exitDate, "2025-01-31");
close(novJan.returnPct, 15, "cross-year return");
close(novJan.maePct, -10, "cross-year MAE");
close(novJan.mfePct, 25, "cross-year MFE");

const missing = observe(rows, "2024-04-01", "2024-07-01");
assert.equal(missing, null, "missing windows are excluded");

const returns = [15, -5, 10, 20, 60];
close(avg(returns), 20, "average");
close(percentile(returns, 0.5), 15, "median");
close(returns.filter((r) => r > 0).length / returns.length * 100, 80, "win rate");
close(std(returns), Math.sqrt(470), "std dev");
close(percentile([-10, -8, -6, -4, -2], 0.75), -4, "MAE P75");
close(Math.max(avg(returns) - percentile(returns, 0.5), 0), 5, "avg-median gap");
assert.equal(returns.length, 5, "N");

const eligibility = (observations, evaluationYear, minAverage = 10) => avg(observations.filter((row) => row.year < evaluationYear).map((row) => row.returnPct)) >= minAverage;
const base = [
  { year: 2021, returnPct: 12 },
  { year: 2022, returnPct: 14 },
  { year: 2023, returnPct: 11 },
  { year: 2024, returnPct: 15 },
  { year: 2025, returnPct: 13 },
  { year: 2026, returnPct: 10 },
];
const shocked = base.map((row) => row.year === 2026 ? { ...row, returnPct: -80 } : row);
assert.equal(eligibility(base, 2026), true, "base 2026 eligibility");
assert.equal(eligibility(shocked, 2026), true, "2026 return cannot change 2026 eligibility");
assert.notEqual(base.at(-1).returnPct, shocked.at(-1).returnPct, "current season result can change independently");

const decFeb = observe(rows, "2024-12-01", "2025-03-01");
assert.equal(decFeb.entryDate, "2024-12-02");
assert.equal(decFeb.exitDate, "2025-02-28");
close(decFeb.returnPct, pct(260, 210), "Dec-Feb evaluation year starts in December");

console.log("Seasonality and walk-forward deterministic tests passed.");
