import assert from "node:assert/strict";
import { findCleanVolumeSellingSignal, findVolumeSellingSignal } from "../src/lib/volumeSellingLogic.ts";

const rows = Array.from({ length: 150 }, (_, i) => ({
  trade_date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
  open: i % 2 ? 101 : 100, close: i % 2 ? 100 : 101, high: 102 + i / 100,
  low: 99, volume: 100, is_provisional: false,
}));
rows[40].volume = 400;
rows[40].open = 101; rows[40].close = 100;
rows[140].volume = 300;
rows[140].open = 101; rows[140].close = 100;
const latest = findVolumeSellingSignal(rows);
assert.equal(latest?.signal_date, rows[140].trade_date, "select the latest strong red candle");
assert.equal(latest?.signal_high, rows[140].high);
assert.equal(latest?.signal_age, 9);
assert.equal(findVolumeSellingSignal(rows, 3.5)?.signal_date, rows[40].trade_date, "higher threshold skips weaker recent signal");
rows[145].volume = 1000;
rows[145].is_provisional = true;
rows[145].open = 101; rows[145].close = 100;
assert.equal(findVolumeSellingSignal(rows)?.signal_date, rows[140].trade_date, "ignore provisional candles");
rows[140].close = 102;
assert.equal(findVolumeSellingSignal(rows)?.signal_date, rows[40].trade_date, "green candle cannot replace selling signal");
assert.equal(findVolumeSellingSignal([...rows, ...Array.from({ length: 126 }, (_, i) => ({ ...rows[149], trade_date: new Date(Date.UTC(2026, 5, i + 1)).toISOString().slice(0, 10) }))]), null, "signals expire after 126 sessions");

const clean = rows.map((row, index) => ({ ...row, high: index === 140 ? 105 : index === 40 ? 104 : 103 }));
clean[140].close = 100;
assert.equal(findCleanVolumeSellingSignal(clean, "2026-10-23")?.signal_date, clean[140].trade_date);
const priorWick = clean.map(row => ({ ...row }));
priorWick[143].high = 105;
assert.equal(findCleanVolumeSellingSignal(priorWick, "2026-10-23"), null, "an earlier test of the line invalidates the latest signal");
const priorClose = clean.map(row => ({ ...row }));
priorClose[143].high = 106;
priorClose[143].close = 105;
assert.equal(findCleanVolumeSellingSignal(priorClose, "2026-10-23"), null, "an earlier close on the line invalidates the signal");
const firstTestToday = clean.map(row => ({ ...row }));
firstTestToday[149].trade_date = "2026-10-23";
firstTestToday[149].high = 105;
firstTestToday[149].is_provisional = true;
assert.equal(findCleanVolumeSellingSignal(firstTestToday, "2026-10-23")?.signal_date, clean[140].trade_date, "today's first intraday test remains eligible");
firstTestToday[149].is_provisional = false;
firstTestToday[149].close = 105;
assert.equal(findCleanVolumeSellingSignal(firstTestToday, "2026-10-23"), null, "a completed close on the line removes the stock");
console.log("VolumeSelling tests passed");
