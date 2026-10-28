import assert from "node:assert/strict";
import { summarizeRecentVolume } from "../src/lib/recentVolume.ts";

const currentDate = "2026-10-16";
const dates = Array.from({ length: 40 }, (_, index) => ({
  trade_date: new Date(Date.UTC(2026, 8, index + 1)).toISOString().slice(0, 10),
  volume: 100,
  high: 100 + index,
}));
const withSpikes = (...indices) => dates.map((point, index) => ({ ...point, volume: indices.includes(index) ? 300 : 100 }));

const ordinary = summarizeRecentVolume(dates, currentDate);
assert.equal(ordinary.evaluatedDays, 10);
assert.equal(ordinary.spikeCount, 0);
assert.equal(ordinary.peakRatio, 1);

const single = summarizeRecentVolume(withSpikes(34), currentDate);
assert.equal(single.spikeCount, 1);
assert.equal(single.peakRatio, 3);
assert.equal(single.sessionsSinceLastSpike, 5);
assert.equal(single.latestRatio < 1, true);
assert.deepEqual(single.latestSpike, { trade_date: dates[34].trade_date, high: 134, ratio: 3 });

const multiple = summarizeRecentVolume(withSpikes(32, 36, 39), currentDate);
assert.equal(multiple.spikeCount, 3);
assert.equal(multiple.sessionsSinceLastSpike, 0);
assert.equal(multiple.latestRatio >= 2, true);
assert.deepEqual(multiple.latestSpike, { trade_date: dates[39].trade_date, high: 139, ratio: 300 / 120 });

assert.equal(summarizeRecentVolume(withSpikes(29), currentDate).spikeCount, 0);
assert.equal(summarizeRecentVolume([...dates, { trade_date: currentDate, volume: 1000, high: 200 }], currentDate).spikeCount, 0);
assert.equal(summarizeRecentVolume([...dates.slice(0, -1), { ...dates.at(-1), volume: 1000, is_provisional: true }], currentDate).spikeCount, 0);
const redSpike = withSpikes(39).map((point, index) => index === 39 ? { ...point, open: 145, close: 125 } : point);
assert.equal(summarizeRecentVolume(redSpike, currentDate).latestSpike?.high, 139);

const boundary = withSpikes(30);
boundary[30].volume = 200;
assert.equal(summarizeRecentVolume(boundary, currentDate).spikeCount, 1);
assert.equal(summarizeRecentVolume(dates.slice(-20), currentDate).evaluatedDays, 0);

console.log("Recent volume tests passed");
