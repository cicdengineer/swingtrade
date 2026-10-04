import fs from "node:fs";

const db = JSON.parse(fs.readFileSync(".data/seasonality-edge-db.json", "utf8"));
const startDate = "2025-01-01";
const endDate = "2025-12-31";
const initialCapital = 1_000_000;

const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const pct = (value, base) => (value / Math.max(0.01, base) - 1) * 100;
const round = (value, digits = 2) => Number(value.toFixed(digits));
const ema = (values, period) => {
  const multiplier = 2 / (period + 1);
  let previous;
  return values.map((value, index) => {
    if (index + 1 < period) return undefined;
    if (previous === undefined) previous = avg(values.slice(index - period + 1, index + 1));
    else previous = value * multiplier + previous * (1 - multiplier);
    return previous;
  });
};
const sma = (values, period) => values.map((_, index) => index + 1 < period ? undefined : avg(values.slice(index - period + 1, index + 1)));

const members = db.universe_members.filter((member) => member.is_current_constituent && member.security_id);
const memberById = new Map(members.map((member) => [member.security_id, member]));
const bySecurity = new Map();
for (const row of db.daily_prices) {
  if (!memberById.has(row.security_id)) continue;
  if (!bySecurity.has(row.security_id)) bySecurity.set(row.security_id, []);
  bySecurity.get(row.security_id).push(row);
}

const stocks = [];
const dateSet = new Set();
for (const [securityId, rows] of bySecurity) {
  rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  if (rows.length < 180) continue;
  rows.forEach((row) => dateSet.add(row.trade_date));
  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume);
  const member = memberById.get(securityId);
  stocks.push({
    id: securityId,
    symbol: member.symbol,
    name: member.company_name,
    rows,
    byDate: new Map(rows.map((row, index) => [row.trade_date, index])),
    ema10: ema(closes, 10),
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    vol20: sma(volumes, 20),
  });
}
const stockById = new Map(stocks.map((stock) => [stock.id, stock]));
const dates = Array.from(dateSet).sort().filter((date) => date >= startDate && date <= endDate);

function marketHealth(date) {
  let above20 = 0;
  let above50 = 0;
  let usable = 0;
  let up20 = 0;
  for (const stock of stocks) {
    const index = stock.byDate.get(date);
    if (index === undefined || stock.ema20[index] === undefined || stock.ema50[index] === undefined || index < 20) continue;
    usable += 1;
    if (stock.rows[index].close > stock.ema20[index]) above20 += 1;
    if (stock.rows[index].close > stock.ema50[index]) above50 += 1;
    if (stock.rows[index].close > stock.rows[index - 20].close) up20 += 1;
  }
  return {
    above20: usable ? above20 / usable * 100 : 0,
    above50: usable ? above50 / usable * 100 : 0,
    up20: usable ? up20 / usable * 100 : 0,
  };
}
const healthByDate = new Map(dates.map((date) => [date, marketHealth(date)]));

function momentumPullbackCandidate(stock, index, p) {
  const rows = stock.rows;
  const current = rows[index];
  const fast = p.ema === 20 ? stock.ema20[index] : stock.ema10[index];
  if (!current || !fast || index < p.moveWindow + 50) return null;
  let best = null;
  const scanStart = Math.max(0, index - p.lookback - p.moveWindow);
  const scanEnd = Math.max(scanStart, index - p.minPullbackDays - p.moveWindow);
  for (let start = scanStart; start <= scanEnd; start += 1) {
    const end = start + p.moveWindow;
    if (end >= index) break;
    const returnPct = pct(rows[end].close, rows[start].close);
    if (returnPct < p.minMove) continue;
    const preVolume = avg(rows.slice(Math.max(0, start - 20), start).map((row) => row.volume));
    const impulseVolume = avg(rows.slice(start, end + 1).map((row) => row.volume));
    const volumeRatio = impulseVolume / Math.max(1, preVolume || impulseVolume);
    if (volumeRatio < p.minImpulseVol) continue;
    if (!best || returnPct > best.returnPct) best = { start, end, returnPct, volumeRatio };
  }
  if (!best) return null;
  const pullback = rows.slice(best.end + 1, index + 1);
  if (pullback.length < p.minPullbackDays || pullback.length > p.maxPullbackDays) return null;
  const impulseHigh = Math.max(...rows.slice(best.start, best.end + 1).map((row) => row.high));
  const pullbackPct = Math.max(0, pct(Math.min(...pullback.map((row) => row.low)), impulseHigh) * -1);
  if (pullbackPct < p.minPullback || pullbackPct > p.maxPullback) return null;
  const impulseVolume = avg(rows.slice(best.start, best.end + 1).map((row) => row.volume));
  const pullbackVolumeRatio = avg(pullback.map((row) => row.volume)) / Math.max(1, impulseVolume);
  if (pullbackVolumeRatio > p.maxPullbackVol) return null;
  const hadBelow = pullback.slice(0, -1).some((row) => {
    const rowIndex = stock.byDate.get(row.trade_date);
    const value = p.ema === 20 ? stock.ema20[rowIndex] : stock.ema10[rowIndex];
    return value !== undefined && row.close < value;
  });
  if (!hadBelow) return null;
  const prev = rows[index - 1];
  const prevFast = p.ema === 20 ? stock.ema20[index - 1] : stock.ema10[index - 1];
  const reclaim = Boolean(prev && prevFast && prev.close <= prevFast && current.close > fast);
  if (p.requireReclaim && !reclaim) return null;
  if (p.requireUpperHalf && current.close < (current.low + (current.high - current.low) * 0.55)) return null;
  const recentHigh = Math.max(...rows.slice(Math.max(0, index - 20), index + 1).map((row) => row.high));
  const nearHigh = pct(current.close, recentHigh);
  const rs60 = index >= 60 ? pct(current.close, rows[index - 60].close) : 0;
  const distance = pct(current.close, fast);
  const score = Math.min(best.returnPct, 70) * 0.55 + Math.max(0, 1 - pullbackVolumeRatio) * 35 + Math.max(0, 18 - pullbackPct) * 1.2 + Math.max(0, distance) * 2 + rs60 * 0.25 + nearHigh * 0.6;
  return { id: stock.id, symbol: stock.symbol, close: current.close, score, trigger: reclaim || !p.requireReclaim, rank: 0 };
}

function breakoutCandidate(stock, index, p) {
  const rows = stock.rows;
  const current = rows[index];
  if (!current || index < 90 || !stock.ema20[index] || !stock.ema50[index]) return null;
  if (current.close < stock.ema20[index] || stock.ema20[index] < stock.ema50[index]) return null;
  const rs60 = pct(current.close, rows[index - 60].close);
  if (rs60 < p.minRs60) return null;
  const high20Prior = Math.max(...rows.slice(index - 20, index).map((row) => row.high));
  const breakout = current.close > high20Prior;
  if (p.requireBreakout && !breakout) return null;
  const volRatio = stock.vol20[index] ? current.volume / stock.vol20[index] : 1;
  if (volRatio > p.maxVol) return null;
  const tight = avg(rows.slice(index - 5, index + 1).map((row) => (row.high - row.low) / row.close));
  const score = rs60 * 1.4 + pct(current.close, stock.ema20[index]) * 2 - tight * 240 + (breakout ? 20 : 0) - Math.max(0, volRatio - 1) * 8;
  return { id: stock.id, symbol: stock.symbol, close: current.close, score, trigger: true, rank: 0 };
}

function simulate(name, params, candidateFn) {
  let cash = initialCapital;
  let highWater = initialCapital;
  let prevEquity = initialCapital;
  const positions = new Map();
  const closedReturns = [];
  let buys = 0;
  let sells = 0;
  const equityCurve = [];
  const buySymbols = new Set();
  for (const date of dates) {
    const health = healthByDate.get(date);
    const canEnter = !params.breadthMin || (health.above20 >= params.breadthMin && health.up20 >= (params.up20Min ?? 0));
    const mustDeRisk = params.exitOnBreadthBelow && health.above20 < params.exitOnBreadthBelow;
    const candidates = stocks.flatMap((stock) => {
      const index = stock.byDate.get(date);
      if (index === undefined) return [];
      const candidate = candidateFn(stock, index, params);
      return candidate ? [candidate] : [];
    }).sort((a, b) => b.score - a.score).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    for (const [id, position] of Array.from(positions.entries())) {
      const stock = stockById.get(id);
      const index = stock?.byDate.get(date);
      const price = stock && index !== undefined ? stock.rows[index].close : position.entry;
      const rank = byId.get(id)?.rank ?? Infinity;
      const belowEma = params.exitBelowEma && stock && index !== undefined && stock.ema20[index] && price < stock.ema20[index];
      if (mustDeRisk || rank > params.exitRankBelow || belowEma) {
        cash += price * position.qty;
        closedReturns.push(pct(price, position.entry));
        positions.delete(id);
        sells += 1;
      }
    }
    if (canEnter) {
      const openSlots = Math.max(0, params.basketSize - positions.size);
      const buysToday = candidates.filter((candidate) => candidate.trigger && !positions.has(candidate.id)).slice(0, openSlots);
      for (const candidate of buysToday) {
        const allocation = cash / Math.max(1, params.basketSize - positions.size);
        if (allocation < 1000) continue;
        positions.set(candidate.id, { entry: candidate.close, qty: allocation / candidate.close });
        cash -= allocation;
        buys += 1;
        buySymbols.add(candidate.symbol);
      }
    }
    const invested = Array.from(positions.entries()).reduce((sum, [id, position]) => {
      const stock = stockById.get(id);
      const index = stock?.byDate.get(date);
      const price = stock && index !== undefined ? stock.rows[index].close : position.entry;
      return sum + price * position.qty;
    }, 0);
    const equity = cash + invested;
    highWater = Math.max(highWater, equity);
    equityCurve.push({ date, equity, dd: pct(equity, highWater), day: equity - prevEquity });
    prevEquity = equity;
  }
  const finalEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  const maxDd = Math.min(0, ...equityCurve.map((row) => row.dd));
  const wins = closedReturns.filter((value) => value > 0).length;
  return {
    name,
    ret: round(pct(finalEquity, initialCapital)),
    maxDd: round(maxDd),
    ratio: round(pct(finalEquity, initialCapital) / Math.max(1, Math.abs(maxDd)), 2),
    buys,
    sells,
    winRate: sells ? round(wins / sells * 100) : 0,
    avgTrade: closedReturns.length ? round(avg(closedReturns)) : 0,
    best: closedReturns.length ? round(Math.max(...closedReturns)) : 0,
    worst: closedReturns.length ? round(Math.min(...closedReturns)) : 0,
    open: positions.size,
    symbols: buySymbols.size,
  };
}

const basePullback = {
  basketSize: 3,
  minMove: 30,
  moveWindow: 30,
  lookback: 95,
  minImpulseVol: 1.2,
  minPullbackDays: 3,
  maxPullbackDays: 35,
  minPullback: 3,
  maxPullback: 18,
  maxPullbackVol: 0.85,
  requireReclaim: true,
  requireUpperHalf: false,
};
const qualityPullback = {
  ...basePullback,
  minPullbackDays: 5,
  maxPullbackDays: 28,
  minPullback: 4,
  maxPullback: 14,
  maxPullbackVol: 0.7,
  requireUpperHalf: true,
};
let tests = [
  { name: "original 10ema rank5", fn: momentumPullbackCandidate, params: { ...basePullback, ema: 10, exitRankBelow: 5, breadthMin: 0, exitOnBreadthBelow: 0 } },
  { name: "original 10ema rank8", fn: momentumPullbackCandidate, params: { ...basePullback, ema: 10, exitRankBelow: 8, breadthMin: 0, exitOnBreadthBelow: 0 } },
  { name: "breadth original 10ema rank5", fn: momentumPullbackCandidate, params: { ...basePullback, ema: 10, exitRankBelow: 5, breadthMin: 45, exitOnBreadthBelow: 35 } },
  { name: "strong breadth original 10ema rank5", fn: momentumPullbackCandidate, params: { ...basePullback, ema: 10, exitRankBelow: 5, breadthMin: 55, exitOnBreadthBelow: 45 } },
  { name: "quality 10ema breadth45 rank5", fn: momentumPullbackCandidate, params: { ...qualityPullback, ema: 10, exitRankBelow: 5, breadthMin: 45, exitOnBreadthBelow: 35 } },
  { name: "quality 10ema breadth55 rank5", fn: momentumPullbackCandidate, params: { ...qualityPullback, ema: 10, exitRankBelow: 5, breadthMin: 55, exitOnBreadthBelow: 45 } },
  { name: "quality 20ema breadth45 rank5", fn: momentumPullbackCandidate, params: { ...qualityPullback, ema: 20, exitRankBelow: 5, breadthMin: 45, exitOnBreadthBelow: 35 } },
  { name: "quality 20ema breadth55 rank5", fn: momentumPullbackCandidate, params: { ...qualityPullback, ema: 20, exitRankBelow: 5, breadthMin: 55, exitOnBreadthBelow: 45 } },
  { name: "rs breakout breadth45 rank5", fn: breakoutCandidate, params: { basketSize: 3, exitRankBelow: 5, breadthMin: 45, exitOnBreadthBelow: 35, minRs60: 18, maxVol: 2.2, requireBreakout: true, exitBelowEma: true } },
  { name: "rs breakout breadth55 rank5", fn: breakoutCandidate, params: { basketSize: 3, exitRankBelow: 5, breadthMin: 55, exitOnBreadthBelow: 45, minRs60: 18, maxVol: 2.2, requireBreakout: true, exitBelowEma: true } },
  { name: "rs tight breadth45 rank5", fn: breakoutCandidate, params: { basketSize: 3, exitRankBelow: 5, breadthMin: 45, exitOnBreadthBelow: 35, minRs60: 12, maxVol: 1.5, requireBreakout: false, exitBelowEma: true } },
  { name: "rs tight breadth55 rank5", fn: breakoutCandidate, params: { basketSize: 3, exitRankBelow: 5, breadthMin: 55, exitOnBreadthBelow: 45, minRs60: 12, maxVol: 1.5, requireBreakout: false, exitBelowEma: true } },
];

for (const basketSize of [1, 2, 3]) {
  for (const breadthMin of [55, 65, 70]) {
    for (const exitOnBreadthBelow of [45, 55]) {
      for (const exitRankBelow of [2, 5]) {
        for (const minRs60 of [12, 18, 24]) {
          for (const maxVol of [1.2, 1.8]) {
            tests.push({
              name: `rs-tight b${basketSize} br${breadthMin} exB${exitOnBreadthBelow} rank${exitRankBelow} rs${minRs60} vol${maxVol}`,
              fn: breakoutCandidate,
              params: { basketSize, exitRankBelow, breadthMin, exitOnBreadthBelow, minRs60, maxVol, requireBreakout: false, exitBelowEma: true },
            });
          }
        }
      }
    }
  }
}

const results = tests.map((test) => simulate(test.name, test.params, test.fn));
const positive = results.filter((row) => row.ret > 0 && row.buys >= 5).sort((a, b) => b.ret - a.ret);
const balanced = results.filter((row) => row.ret > 0 && row.buys >= 5).sort((a, b) => b.ratio - a.ratio);
console.log(JSON.stringify({
  universeStocks: stocks.length,
  dates: { start: dates[0], end: dates.at(-1), count: dates.length },
  tested: results.length,
  topReturn: positive.slice(0, 15),
  topReturnDrawdownAdjusted: balanced.slice(0, 15),
  worst: results.sort((a, b) => a.ret - b.ret).slice(0, 5),
}, null, 2));
