import assert from "node:assert/strict";
import { matchesStochHL } from "../src/lib/stochHL.ts";

const point = (daily_stoch_d, close) => ({ daily_stoch_d, close });
const setup = [point(82, 105), point(96, 100), point(85, 110), point(20, 90)];

assert.equal(matchesStochHL(setup), false, "20 is outside the trough zone");
assert.equal(matchesStochHL([point(80, 100), point(19, 100)]), false, "80 is outside the peak zone");
assert.equal(matchesStochHL([...setup, point(19, 97)]), false, "exactly 3% lower is excluded");
assert.equal(matchesStochHL([point(90, 0.1), point(19, 0.097)]), false, "the boundary also holds for decimal closes");

for (const close of [97.01, 100, 110]) {
  assert.equal(matchesStochHL([...setup, point(19, close)]), true);
}

const qualifying = [...setup, point(19, 98), point(7, 99), point(9, 92)];
assert.equal(matchesStochHL(qualifying), true, "a higher %D with a lower close cannot replace the trough");
assert.equal(matchesStochHL([...qualifying, point(5, 96)]), false, "a new %D trough updates the close comparison");
assert.equal(matchesStochHL([...qualifying, point(20, 90), point(80, 90)]), true, "qualification persists through 80");
assert.equal(matchesStochHL([...qualifying, point(81, 90)]), false, "crossing above 80 clears the signal");
assert.equal(matchesStochHL([...qualifying, point(81, 90), point(50, 90)]), false, "a new cycle requires its own trough");
assert.equal(matchesStochHL([...qualifying, point(81, 90), point(19, 90)]), true, "a new cycle uses its own peak close");

console.log("StocHL signal tests passed.");
