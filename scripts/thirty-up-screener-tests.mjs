import assert from "node:assert/strict";

function classify({
  distance,
  hasBelowEmaBase,
  movePct,
  impulseVolumeRatio,
  daysSinceHigh,
  retracementPct,
  currentVolumeRatio,
}) {
  const reasons = [];
  let status = "NO BELOW EMA BASE";
  if (!hasBelowEmaBase) reasons.push("No base");
  if (hasBelowEmaBase && movePct < 30) {
    status = "NO 30% MOVE";
    reasons.push("Weak move");
  }
  if (hasBelowEmaBase && impulseVolumeRatio < 1.8) {
    status = "WEAK VOLUME";
    reasons.push("Weak volume");
  }
  if (hasBelowEmaBase && daysSinceHigh < 10) reasons.push("Too fresh");
  if (hasBelowEmaBase && retracementPct > 65) {
    status = "TOO DEEP";
    reasons.push("Deep retracement");
  }
  if (distance < -3) {
    status = "TOO DEEP";
    reasons.push("Below EMA zone");
  } else if (distance > 5) {
    status = "TOO EXTENDED";
    reasons.push("Extended");
  }
  if (currentVolumeRatio > 1.5) reasons.push("Pullback volume too high");
  return { status: reasons.length === 0 ? "SETUP" : status, qualifies: reasons.length === 0 };
}

assert.deepEqual(
  classify({ distance: 1, hasBelowEmaBase: true, movePct: 35, impulseVolumeRatio: 2.2, daysSinceHigh: 15, retracementPct: 45, currentVolumeRatio: 1.1 }),
  { status: "SETUP", qualifies: true },
);
assert.equal(classify({ distance: 1, hasBelowEmaBase: true, movePct: 25, impulseVolumeRatio: 2.2, daysSinceHigh: 15, retracementPct: 45, currentVolumeRatio: 1.1 }).status, "NO 30% MOVE");
assert.equal(classify({ distance: 1, hasBelowEmaBase: true, movePct: 35, impulseVolumeRatio: 1.1, daysSinceHigh: 15, retracementPct: 45, currentVolumeRatio: 1.1 }).status, "WEAK VOLUME");
assert.equal(classify({ distance: 7, hasBelowEmaBase: true, movePct: 35, impulseVolumeRatio: 2.2, daysSinceHigh: 15, retracementPct: 20, currentVolumeRatio: 1.1 }).status, "TOO EXTENDED");
assert.equal(classify({ distance: -5, hasBelowEmaBase: true, movePct: 35, impulseVolumeRatio: 2.2, daysSinceHigh: 15, retracementPct: 80, currentVolumeRatio: 1.1 }).status, "TOO DEEP");
assert.equal(classify({ distance: 1, hasBelowEmaBase: false, movePct: 0, impulseVolumeRatio: 0, daysSinceHigh: 0, retracementPct: 0, currentVolumeRatio: 1.1 }).status, "NO BELOW EMA BASE");

console.log("30%Up screener deterministic tests passed.");
