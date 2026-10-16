import assert from "node:assert/strict";
import { summarizeRecentVolume } from "../src/lib/recentVolume.ts";

const currentDate = "2026-10-16";
const dates = Array.from({ length: 40 }, (_, index) => ({
  trade_date: new Date(Date.UTC(2026, 8, index + 1)).toISOString().slice(0, 10),
  volume: 100,
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

const multiple = summarizeRecentVolume(withSpikes(32, 36, 39), currentDate);
assert.equal(multiple.spikeCount, 3);
assert.equal(multiple.sessionsSinceLastSpike, 0);
assert.equal(multiple.latestRatio >= 2, true);

assert.equal(summarizeRecentVolume(withSpikes(29), currentDate).spikeCount, 0);
assert.equal(summarizeRecentVolume([...dates, { trade_date: currentDate, volume: 1000 }], currentDate).spikeCount, 0);

const boundary = withSpikes(30);
boundary[30].volume = 200;
assert.equal(summarizeRecentVolume(boundary, currentDate).spikeCount, 1);
assert.equal(summarizeRecentVolume(dates.slice(-20), currentDate).evaluatedDays, 0);

console.log("Recent volume tests passed");
