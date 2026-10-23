import assert from "node:assert/strict";
import { findVolumeSellingSetup, findVolumeSellingSignal } from "../src/lib/volumeSellingLogic.ts";

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
assert.equal(findVolumeSellingSignal(rows, 2.5, 21)?.signal_date, rows[140].trade_date, "Screener uses the latest signal within 21 sessions");
assert.equal(findVolumeSellingSignal(rows, 3.5)?.signal_date, rows[40].trade_date, "higher threshold skips weaker recent signal");
rows[145].volume = 1000;
rows[145].is_provisional = true;
rows[145].open = 101; rows[145].close = 100;
assert.equal(findVolumeSellingSignal(rows)?.signal_date, rows[140].trade_date, "ignore provisional candles");
rows[140].close = 102;
assert.equal(findVolumeSellingSignal(rows)?.signal_date, rows[40].trade_date, "green candle cannot replace selling signal");
assert.equal(findVolumeSellingSignal(rows, 2.5, 21), null, "Screener does not show an older red entry line");
assert.equal(findVolumeSellingSignal([...rows, ...Array.from({ length: 126 }, (_, i) => ({ ...rows[149], trade_date: new Date(Date.UTC(2026, 5, i + 1)).toISOString().slice(0, 10) }))]), null, "signals expire after 126 sessions");

const falling = Array.from({ length: 60 }, (_, index) => ({
  trade_date: new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10),
  open: 161 - index, close: 160 - index, high: 162 - index, low: 159 - index,
  volume: index === 40 ? 350 : 100, is_provisional: false,
}));
assert.equal(findVolumeSellingSetup(falling)?.phase, "BELOW", "a falling month and strong red bar qualify");
assert.ok(findVolumeSellingSetup(falling).one_month_decline_pct < 0);
const flat = falling.map(row => ({ ...row }));
flat[38].close = 100;
assert.equal(findVolumeSellingSetup(flat), null, "a stock without a falling latest month is excluded");
const intradayTest = falling.map(row => ({ ...row }));
intradayTest[43].high = falling[40].high + 1;
assert.equal(findVolumeSellingSetup(intradayTest)?.phase, "BELOW", "an intraday test without a close above stays on the watchlist");
const provisionalTest = falling.map(row => ({ ...row }));
provisionalTest[59].is_provisional = true;
provisionalTest[59].high = falling[40].high + 1;
provisionalTest[59].close = falling[40].high + 1;
assert.equal(findVolumeSellingSetup(provisionalTest)?.phase, "BELOW", "a provisional intraday move does not start the five-session countdown");
const breakout = falling.map(row => ({ ...row }));
breakout[54].close = falling[40].high;
breakout[54].high = falling[40].high + 1;
assert.equal(findVolumeSellingSetup(breakout)?.phase, "CLOSED_ABOVE");
assert.equal(findVolumeSellingSetup(breakout)?.sessions_since_close_above, 5, "five following sessions remain eligible");
assert.equal(findVolumeSellingSetup(breakout.slice(0, 55))?.sessions_since_close_above, 0, "breakout close is day zero");
const expired = breakout.map(row => ({ ...row }));
expired[53].close = falling[40].high;
assert.equal(findVolumeSellingSetup(expired), null, "remove after the fifth following session");
console.log("VolumeSelling tests passed");
