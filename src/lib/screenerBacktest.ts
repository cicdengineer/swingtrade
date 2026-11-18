import "server-only";
import { readDatabase, type SeasonalityDatabase } from "./localDatabase";
import { positionSizingFromStop, swingLowBeforeLatest, type EntrySizingSettings } from "./entrySizing";
import { calculateEma, calculateSma } from "./swingScreenerService";
import { findEmaCatchup } from "./emaNoTouchLogic";
import type { DailyPriceRecord, UniverseName } from "./types";

type Setup = "catchup" | "breakout" | "blend" | "gain";
export type BacktestConfig = EntrySizingSettings & {
  startDate: string; endDate: string; universe: UniverseName; holdoutPct: number;
  feeBps: number; slippageBps: number; openRiskPct: number; maxExposurePct: number; maxPositionPct: number;
  drawdownBudget: number; minTrades: number; minTurnoverCr: number; breadthPct: number;
  maxPositions: number; maxNew: number; maxHold: number; trailEma: 10 | 20;
  protectR: number; maxGapPct: number; minVolume: number; maxStopPct: number;
  mode: "compare" | Setup;
};

type Variant = { id: string; label: string; setup: Setup; trail: 10 | 20; breadth: number; volume: number; maxStop: number };
type Candle = DailyPriceRecord;
type Point = {
  id: string; candle: Candle; ema10: number; ema20: number; ema50: number;
  gain: number; momentum: number; rvol: number; turnover: number;
  swing: number; distance: number; catchup: number | null; breakout: boolean; upVolume: boolean;
};
type Session = { date: string; points: Map<string, Point>; breadth: number | null; benchmark?: number };
type Position = { id: string; symbol: string; entryDate: string; entry: number; quantity: number; debit: number; stop: number; initialRisk: number; plannedLoss: number; signalLow: number; close: number; age: number; exit?: string };
type Order = { point: Point; setup: string; score: number };
type Event = { symbol: string; action: string; reason: string; price: number; quantity: number; pnl?: number };
type Snapshot = {
  date: string; equity: number; cash: number; drawdown: number; openRisk: number; breadth: number | null;
  benchmark: number | null; signals: { symbol: string; setup: string; score: number }[];
  holdings: { symbol: string; entryDate: string; quantity: number; close: number; stop: number; pnl: number; pending: boolean; stale: boolean }[];
  events: Event[];
};
type Metrics = {
  returnPct: number; drawdown: number; trades: number; winRate: number; profitFactor: number | null;
  expectancyR: number; exposure: number; costs: number; benchmark: number | null; benchmarkDrawdown: number | null; annualizedReturn: number | null; open: number;
};

export function parseBacktestConfig(input: Record<string, unknown>, settings: EntrySizingSettings): BacktestConfig {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  function date(key: string, fallback: string) {
    const value = input[key] ?? fallback;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value || value > today) throw new Error("Select valid dates through today.");
    return value;
  }
  function number(key: string, fallback: number, min: number, max: number, integer = false) {
    const value = input[key] ?? fallback;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`Invalid value for ${key}.`);
    return value;
  }
  const startDate = date("startDate", `${Number(today.slice(0, 4)) - 3}${today.slice(4).replace("-02-29", "-02-28")}`);
  const endDate = date("endDate", today);
  if (startDate >= endDate) throw new Error("Select a start date before the end date.");
  if (Date.parse(endDate) - Date.parse(startDate) > 366 * 8 * 86400000) throw new Error("Select a range of eight years or less.");
  const universe = input.universe ?? "CNX500";
  if (universe !== "CNX500" && universe !== "NIFTYSC500") throw new Error("Select a supported universe.");
  const mode = input.mode ?? "compare";
  if (mode !== "compare" && mode !== "catchup" && mode !== "breakout" && mode !== "blend" && mode !== "gain") throw new Error("Invalid setup.");
  const trailEma = input.trailEma ?? 20;
  if (trailEma !== 10 && trailEma !== 20) throw new Error("Select a 10 or 20 EMA trail.");
  return {
    startDate, endDate, universe, mode, trailEma,
    totalCapital: number("totalCapital", settings.totalCapital, 1, 1e12),
    riskPercent: number("riskPercent", Math.min(settings.riskPercent, 0.25), 0.001, 5),
    holdoutPct: number("holdoutPct", 30, 20, 50),
    feeBps: number("feeBps", 15, 0, 250),
    slippageBps: number("slippageBps", 10, 0, 250),
    openRiskPct: number("openRiskPct", 1, 0.01, 10),
    maxExposurePct: number("maxExposurePct", 60, 1, 100),
    maxPositionPct: number("maxPositionPct", 12, 1, 100),
    drawdownBudget: number("drawdownBudget", 8, 0.1, 100),
    minTrades: number("minTrades", 15, 1, 500, true),
    minTurnoverCr: number("minTurnoverCr", 10, 0, 10000),
    breadthPct: number("breadthPct", 55, 0, 100),
    maxPositions: number("maxPositions", 6, 1, 30, true),
    maxNew: number("maxNew", 2, 1, 30, true),
    maxHold: number("maxHold", 40, 2, 252, true),
    protectR: number("protectR", 1.5, 0, 20),
    maxGapPct: number("maxGapPct", 2, 0, 20),
    minVolume: number("minVolume", 1.5, 0.1, 20),
    maxStopPct: number("maxStopPct", 5, 1, 25),
  };
}

const change = (from: number, to: number) => (to / from - 1) * 100;
const catchupCriteria = { baseDays: 5, minPriorAdvancePct: 8, maxBaseRangePct: 7, maxDistanceFromEmaPct: 4, minCatchupPct: 0.5 };

export function prepareSessions(db: SeasonalityDatabase, config: BacktestConfig) {
  const members = new Set(db.universe_members.filter(row => row.is_current_constituent && row.universe_name === config.universe && row.security_id).map(row => row.security_id));
  const indexName = config.universe === "CNX500" ? "NIFTY500" : "NIFTYSMALLCAP500";
  const indexId = db.instruments.find(row => row.exchange_segment === "IDX_I" && row.symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase() === indexName)?.security_id;
  const index = new Map<string, number>();
  const groups = new Map<string, Candle[]>();
  for (const row of db.daily_prices) {
    if (row.is_provisional || row.trade_date > config.endDate || !Number.isFinite(row.close) || row.close <= 0) continue;
    if (indexId && row.security_id === indexId) index.set(row.trade_date, row.close);
    if (!members.has(row.security_id) || ![row.low, row.high, row.volume].every(Number.isFinite) || row.low <= 0 || row.low > row.close || row.high < row.close || row.volume < 0) continue;
    const rows = groups.get(row.security_id) ?? [];
    rows.push(row);
    groups.set(row.security_id, rows);
  }
  const dates = new Map<string, Map<string, Point>>();
  for (const [id, rows] of groups) {
    rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    const closes = rows.map(row => row.close);
    const ema10 = calculateEma(closes, 10);
    const ema20 = calculateEma(closes, 20);
    const ema50 = calculateEma(closes, 50);
    const vol = calculateSma(rows.map(row => row.volume), 20);
    const turnover = calculateSma(rows.map(row => row.close * row.volume), 20);
    for (const [i, candle] of rows.entries()) {
      if (candle.trade_date < config.startDate) continue;
      const { close } = candle;
      const slow = ema50[i] ?? 0;
      const fast = ema10[i] ?? 0;
      const gain = i ? change(closes[i - 1], close) : 0;
      const rvol = vol[i - 1] ? candle.volume / vol[i - 1]! : 0;
      const traded = (turnover[i - 1] ?? 0) / 1e7;
      const distance = fast ? change(fast, close) : Infinity;
      const trend = i >= 69 && close > slow && slow >= (ema50[i - 5] ?? Infinity);
      let catchup: number | null = null;
      let breakout = false;
      if (trend && traded >= config.minTurnoverCr && gain > 0 && distance > 0 && distance <= 8) {
        if (distance <= 4 && close > rows[i - 1].high) {
          const setup = findEmaCatchup(rows.slice(Math.max(0, i - 125), i + 1), catchupCriteria);
          if (setup) catchup = setup.baseRangePct;
        }
        if (rvol >= config.minVolume && close > Math.max(...rows.slice(i - 20, i).map(row => row.high))) {
          for (let start = Math.max(0, i - 155); start <= i - 30; start += 1) {
            if (change(closes[start], closes[start + 30]) >= 30) { breakout = true; break; }
          }
        }
      }
      const points = dates.get(candle.trade_date) ?? new Map<string, Point>();
      points.set(id, {
        id, candle, ema10: fast, ema20: ema20[i] ?? 0, ema50: slow, gain,
        momentum: i >= 63 ? change(closes[i - 63], close) : 0, rvol, turnover: traded,
        swing: swingLowBeforeLatest(rows.slice(Math.max(0, i - 5), i + 1))?.low ?? 0,
        distance, catchup, breakout,
        upVolume: gain > 0 && candle.low > fast && Boolean(vol[i]) && candle.volume / vol[i]! >= config.minVolume,
      });
      dates.set(candle.trade_date, points);
    }
  }
  const covered = new Set<string>();
  const sessions = [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, points]): Session => {
    for (const id of points.keys()) covered.add(id);
    const usable = [...points.values()].filter(point => point.ema50 > 0);
    const breadth = usable.length >= Math.max(10, Math.ceil(members.size * 0.5))
      ? usable.filter(point => point.candle.close > point.ema50).length / usable.length * 100 : null;
    return { date, points, breadth, benchmark: index.get(date) };
  });
  const verified = new Set(db.instruments.filter(row => ["ADJUSTED", "VERIFIED"].includes(row.price_adjustment_status)).map(row => row.security_id));
  return { sessions, universeSize: members.size, coveredStocks: covered.size, verifiedStocks: [...covered].filter(id => verified.has(id)).length };
}

function signals(session: Session, config: BacktestConfig, variant: Variant): Order[] {
  if (variant.breadth > 0 && (session.breadth === null || session.breadth < variant.breadth)) return [];
  const picks: Order[] = [];
  for (const point of session.points.values()) {
    const { candle, swing, gain, rvol, catchup, breakout, distance, momentum } = point;
    if (point.ema50 <= 0 || swing <= 0 || swing >= candle.close || point.turnover < config.minTurnoverCr ||
      change(candle.close, swing) < -variant.maxStop) continue;
    if (variant.setup === "gain") {
      if (point.upVolume) picks.push({ point, setup: "Up + High Volume + Low > 10 EMA", score: gain });
      continue;
    }
    const pullback = variant.setup !== "breakout" && catchup !== null && rvol >= 0.8;
    const expansion = variant.setup !== "catchup" && breakout && rvol >= variant.volume;
    if (!pullback && !expansion) continue;
    const score = Math.min(40, Math.max(-10, momentum)) / 4 + (pullback ? 7 - catchup : 4)
      - distance - Math.abs(change(candle.close, swing));
    picks.push({ point, setup: pullback ? "10 EMA Catchup" : "30 in 30 breakout", score });
  }
  return picks.sort((a, b) => b.score - a.score || a.point.id.localeCompare(b.point.id));
}

export function simulate(sessions: Session[], config: BacktestConfig, variant: Variant, capture = false, costMultiplier = 1) {
  const holdings = new Map<string, Position>();
  const snapshots: Snapshot[] = [];
  const capital = config.totalCapital;
  const friction = (config.feeBps + config.slippageBps) / 10000 * costMultiplier;
  const risk = (pos: Position) => Math.max(0, pos.entry - pos.stop) * pos.quantity;
  const sumBy = (read: (p: Position) => number) => [...holdings.values()].reduce((sum, pos) => sum + read(pos), 0);
  let cash = capital, equity = capital, peak = capital, drawdown = 0, exposure = 0, costs = 0;
  let wins = 0, trades = 0, profit = 0, loss = 0, netR = 0;
  let pending: Order[] = [];
  const first = sessions[0];
  const last = sessions.at(-1)!;
  const benchmark = first.benchmark && last.benchmark ? change(first.benchmark, last.benchmark) : null;
  let indexPeak = first.benchmark ?? 0;
  let indexDrawdown = 0;
  for (const session of sessions) {
    if (session.benchmark && indexPeak > 0) {
      indexPeak = Math.max(indexPeak, session.benchmark);
      indexDrawdown = Math.max(indexDrawdown, (1 - session.benchmark / indexPeak) * 100);
    }
    const events: Event[] = [];
    const exited = new Set<string>();
    for (const [id, pos] of holdings) {
      const point = session.points.get(id);
      pos.age += 1;
      if (!point) continue;
      pos.close = point.candle.close;
      if (!pos.exit || point.candle.volume <= 0) continue;
      const gross = pos.close * pos.quantity;
      const pnl = gross * (1 - friction) - pos.debit;
      cash += gross * (1 - friction);
      costs += gross * friction;
      trades += 1;
      netR += pnl / pos.plannedLoss;
      if (pnl > 0) { wins += 1; profit += pnl; }
      else loss -= pnl;
      holdings.delete(id);
      exited.add(id);
      if (capture) events.push({ symbol: pos.symbol, action: "Sell", reason: pos.exit, price: pos.close, quantity: pos.quantity, pnl });
    }
    const marked = () => sumBy(pos => pos.close * pos.quantity);
    const sizingEquity = Math.max(0, cash + marked());
    let added = 0;
    for (const order of pending) {
      if (added >= config.maxNew || holdings.size >= config.maxPositions) break;
      const { id, candle, swing } = order.point;
      const fill = session.points.get(id)?.candle;
      if (holdings.has(id) || exited.has(id)) continue;
      const skip = (reason: string) => { if (capture) events.push({ symbol: candle.symbol, action: "Skip", reason, price: fill?.close ?? 0, quantity: 0 }); };
      if (!fill || fill.volume <= 0) { skip("No tradable next-session candle"); continue; }
      if (fill.close <= swing || Math.abs(change(candle.close, fill.close)) > config.maxGapPct || change(fill.close, swing) < -variant.maxStop) {
        skip("Next close outside entry limits"); continue;
      }
      const entry = fill.close;
      const cost = entry * (1 + friction);
      const stopCost = swing * (1 - friction);
      const size = positionSizingFromStop(cost, stopCost, { totalCapital: sizingEquity, riskPercent: config.riskPercent });
      const availableRisk = sizingEquity * config.openRiskPct / 100 - sumBy(risk);
      const availableExposure = sizingEquity * config.maxExposurePct / 100 - marked();
      const quantity = Math.min(size.quantity, Math.floor(cash / cost), Math.floor(availableExposure / entry),
        Math.floor(sizingEquity * config.maxPositionPct / 100 / entry), Math.floor(availableRisk / size.riskPerShare));
      if (!Number.isFinite(quantity) || quantity < 1) { skip("Cash, exposure or risk cap"); continue; }
      cash -= cost * quantity;
      costs += entry * friction * quantity;
      holdings.set(id, { id, symbol: candle.symbol, entryDate: session.date, entry, quantity, debit: cost * quantity,
        stop: swing, initialRisk: entry - swing, plannedLoss: size.riskPerShare * quantity, signalLow: candle.low, close: entry, age: 0 });
      added += 1;
      if (capture) events.push({ symbol: candle.symbol, action: "Buy", reason: order.setup, price: entry, quantity });
    }

    for (const [id, pos] of holdings) {
      const point = session.points.get(id);
      if (!point || pos.exit || pos.age === 0) continue;
      if (pos.close <= pos.stop) pos.exit = "Close at or below stop";
      else if (pos.age >= config.maxHold) pos.exit = "Maximum holding period";
      else if (pos.age >= 5 && pos.close < pos.signalLow) pos.exit = "Setup failed after five sessions";
      if (pos.exit) {
        if (capture) events.push({ symbol: pos.symbol, action: "Exit queued", reason: pos.exit, price: pos.close, quantity: pos.quantity });
        continue;
      }
      const protection = config.protectR === 0 ? pos.entry : pos.entry + config.protectR * pos.initialRisk;
      if (pos.close >= protection || pos.stop >= pos.entry) {
        const ema = variant.trail === 10 ? point.ema10 : point.ema20;
        const costStop = pos.entry * (1 + friction) / (1 - friction);
        const stop = Math.max(pos.stop, costStop, ema);
        if (stop > pos.stop && stop < pos.close) {
          pos.stop = stop;
          if (capture) events.push({ symbol: pos.symbol, action: "Stop raised", reason: `Cost floor / ${variant.trail} EMA`, price: stop, quantity: pos.quantity });
        }
      }
    }

    pending = signals(session, config, variant).filter(order => !holdings.has(order.point.id) && !exited.has(order.point.id));
    const marketValue = marked();
    equity = cash + marketValue * (1 - friction);
    peak = Math.max(peak, equity);
    const dd = (1 - equity / peak) * 100;
    drawdown = Math.max(drawdown, dd);
    exposure += equity > 0 ? marketValue / equity * 100 : 0;
    if (capture) snapshots.push({
      date: session.date, equity, cash, drawdown: dd, openRisk: sumBy(risk), breadth: session.breadth,
      benchmark: first.benchmark && session.benchmark ? capital * session.benchmark / first.benchmark : null,
      events, signals: pending.map(({ point, setup, score }) => ({ symbol: point.candle.symbol, setup, score })),
      holdings: [...holdings.values()].map(pos => ({ symbol: pos.symbol, entryDate: pos.entryDate, quantity: pos.quantity,
        close: pos.close, stop: pos.stop, pnl: pos.close * (1 - friction) * pos.quantity - pos.debit, pending: Boolean(pos.exit), stale: !session.points.has(pos.id) })),
    });
  }
  const days = (Date.parse(last.date) - Date.parse(first.date)) / 86400000;
  const metrics: Metrics = {
    returnPct: change(capital, equity), drawdown, trades, winRate: trades ? wins / trades * 100 : 0,
    profitFactor: loss > 0 ? profit / loss : null, expectancyR: trades ? netR / trades : 0,
    exposure: exposure / sessions.length, costs, benchmark, benchmarkDrawdown: benchmark === null ? null : indexDrawdown,
    annualizedReturn: days >= 365 ? ((equity / capital) ** (365.25 / days) - 1) * 100 : null,
    open: holdings.size,
  };
  return { metrics, snapshots };
}

export async function runScreenerBacktest(config: BacktestConfig) {
  const { sessions, ...coverage } = prepareSessions(await readDatabase(), config);
  const split = sessions.length - Math.ceil(sessions.length * config.holdoutPct / 100);
  if (split < 60 || sessions.length - split < 30) throw new Error("The stored data needs at least 60 development sessions and 30 holdout sessions. Extend the dates or load more historical candles.");
  const development = sessions.slice(0, split);
  const holdout = sessions.slice(split);
  const common = { trail: config.trailEma, breadth: config.breadthPct, volume: config.minVolume, maxStop: config.maxStopPct };
  const baseline: Variant = { ...common, id: "gain", label: "Highest session gain", setup: "gain", breadth: 0 };
  const variants: Variant[] = config.mode === "compare" ? [
    { ...common, id: "catchup", label: "10 EMA Catchup", setup: "catchup" },
    { ...common, id: "breakout", label: "30 in 30 breakout", setup: "breakout" },
    { ...common, id: "blend", label: "Catchup + breakout", setup: "blend" },
    { ...common, id: "strict", label: "Catchup + breakout · stricter", setup: "blend", breadth: Math.max(60, common.breadth), volume: Math.max(1.8, common.volume), maxStop: Math.min(4, common.maxStop) },
  ] : [{ ...common, id: config.mode, label: ({ catchup: "10 EMA Catchup", breakout: "30 in 30 breakout", blend: "Catchup + breakout", gain: baseline.label })[config.mode], setup: config.mode }];
  if (config.mode !== "gain") variants.push(baseline);
  const comparison = variants.map(variant => {
    const { metrics } = simulate(development, config, variant);
    const eligible = metrics.returnPct > 0 && metrics.drawdown <= config.drawdownBudget && metrics.trades >= config.minTrades;
    return { variant, metrics, eligible, score: metrics.returnPct / Math.max(1, metrics.drawdown) };
  });
  const pool = comparison.filter(row => config.mode !== "compare" || row.variant.id !== baseline.id)
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.metrics.drawdown - b.metrics.drawdown || b.metrics.trades - a.metrics.trades);
  const selected = pool[0];
  const validation = simulate(holdout, config, selected.variant, true);
  const stressed = simulate(holdout, config, selected.variant, false, 2).metrics;
  const benchmarkBaseline = simulate(holdout, config, baseline).metrics;
  const holdoutMin = Math.max(5, Math.ceil(config.minTrades * holdout.length / development.length));
  const beatsReference = validation.metrics.benchmark !== null && validation.metrics.returnPct > validation.metrics.benchmark &&
    validation.metrics.returnPct >= benchmarkBaseline.returnPct;
  const sufficientBreadth = selected.variant.breadth === 0 || holdout.filter(session => session.breadth !== null).length >= holdout.length * 0.9;
  const validationChecks = [
    { label: "Development met the return, drawdown and sample requirements", passed: selected.eligible },
    { label: "Enough sessions with usable market breadth", passed: sufficientBreadth },
    { label: `At least ${holdoutMin} closed positions on holdout`, passed: validation.metrics.trades >= holdoutMin },
    { label: "Positive holdout return within drawdown budget", passed: validation.metrics.returnPct > 0 && validation.metrics.drawdown <= config.drawdownBudget },
    { label: "Beats the price index and at least matches the highest-gain baseline", passed: beatsReference },
    { label: "Positive return within drawdown budget at double costs", passed: stressed.returnPct > 0 && stressed.drawdown <= config.drawdownBudget },
  ];
  const validated = validationChecks.every(check => check.passed);
  return {
    config, ...coverage, selected, comparison, validation, stressed, benchmarkBaseline, holdoutMin, validated, sufficientBreadth, validationChecks,
    development: { from: development[0].date, through: development.at(-1)!.date, sessions: development.length },
    holdout: { from: holdout[0].date, through: holdout.at(-1)!.date, sessions: holdout.length },
  };
}

export type BacktestResult = Awaited<ReturnType<typeof runScreenerBacktest>>;
