import assert from "node:assert/strict";
import { fallingTrendScore, matchesCleanTrend } from "../src/lib/cleanTrend.ts";

const prices = (count, valueAt) => Array.from({ length: count }, (_, index) => ({ close: valueAt(index) }));
const rising = prices(126, (day) => 100 * Math.exp(day * 0.003));
const falling = prices(126, (day) => 150 * Math.exp(-day * 0.003));
const choppy = prices(126, (day) => 100 * Math.exp(day * 0.0015 + 0.22 * Math.sin(day / 5)));
const recentlyRising = prices(126, (day) => 100 * Math.exp(day < 63 ? -day * 0.003 : -63 * 0.003 + (day - 63) * 0.006));

assert.ok(fallingTrendScore(falling, 126) > 0);
assert.ok(fallingTrendScore(rising, 126) < 0);
assert.equal(matchesCleanTrend(rising, 126), true);
assert.equal(matchesCleanTrend(falling, 126), true);
assert.equal(matchesCleanTrend(choppy, 126), false);
assert.equal(matchesCleanTrend(recentlyRising, 63), true);
assert.equal(matchesCleanTrend(recentlyRising, 126), false);
assert.equal(matchesCleanTrend(rising.slice(-30), 63), false);

console.log("Clean trend tests passed");
