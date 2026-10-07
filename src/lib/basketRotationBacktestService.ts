import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { calculateEma, calculateSma } from "./swingScreenerService";

export type BasketBacktestFilters = {
  strategyMode: "PULLBACK_RECLAIM" | "RS_TIGHT_2025" | "DRY_VOLUME_BREAKOUT" | "DRY_VOLUME_BREAKOUT_QULLAMAGGIE" | "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RANDOM" | "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RISK_RANDOM";
  universe: UniverseName | "ALL";
  initialCapital: number;
  compoundEquity: boolean;
  basketSize: number;
  maxRiskPerTradePct: number;
  maxOpenRiskPct: number;
  exitRankBelow: number;
  breadthMin: number;
  exitBreadthBelow: number;
  minRs60: number;
  maxEntryVolumeRatio: number;
  exitBelow20Ema: boolean;
  minMovePct: number;
  moveWindowDays: number;
  impulseLookbackDays: number;
  minImpulseVolumeRatio: number;
  minPullbackDays: number;
  maxPullbackDays: number;
  minPullbackPct: number;
  maxPullbackPct: number;
  maxPullbackVolumeRatio: number;
  dryVolumeRatio: number;
  dryVolumeLookbackDays: number;
  breakoutWithinDays: number;
  maxDistanceToEntryPct: number;
  stopBufferPct: number;
  partialExitDay: number;
  target1R: number;
  target1ExitPct: number;
  target2R: number;
  target2ExitPct: number;
  exitBelow10Ema: boolean;
  startDate: string;
  endDate: string;
};

export type BasketCandidate = {
  rank: number;
  security_id: string;
  symbol: string;
  company_name: string;
  close: number;
  entry_price?: number;
  stop_loss?: number;
  signal_date?: string;
  score: number;
  trigger: boolean;
  entry_triggered?: boolean;
  impulse_return_pct: number;
  impulse_volume_ratio: number;
  pullback_pct: number;
  pullback_days: number;
  pullback_volume_ratio: number;
  distance_from_10ema_pct: number;
  reason: string;
  blocked_reason?: string;
};

export type BasketHolding = {
  security_id: string;
  symbol: string;
  company_name: string;
  entry_date: string;
  entry_price: number;
  quantity: number;
  current_price: number;
  stop_loss?: number;
  market_value: number;
  pnl: number;
  pnl_pct: number;
  open_risk?: number;
  open_risk_pct?: number;
  rank?: number;
  score?: number;
};

export type BasketEvent = {
  date: string;
  type: "BUY" | "SELL";
  symbol: string;
  reason: string;
  price: number;
  quantity: number;
  amount: number;
  pnl?: number;
};

export type BasketSnapshot = {
  date: string;
  equity: number;
  cash: number;
  invested: number;
  drawdown_pct: number;
  day_pnl: number;
  candidates: BasketCandidate[];
  holdings: BasketHolding[];
  events: BasketEvent[];
};

export type BasketBacktestResult = {
  filters: BasketBacktestFilters;
  summary: {
    startDate: string;
    endDate: string;
    initialCapital: number;
    finalEquity: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    trades: number;
    closedTrades: number;
    winRate: number;
    bestTradePct: number;
    worstTradePct: number;
    averageTradePct: number;
  };
  snapshots: BasketSnapshot[];
  finalHoldings: BasketHolding[];
  trades: BasketEvent[];
  generatedAt: string;
};

type PreparedStock = {
  security_id: string;
  symbol: string;
  company_name: string;
  prices: DailyPriceRecord[];
  ema10: Array<number | undefined>;
  ema20: Array<number | undefined>;
  ema50: Array<number | undefined>;
  volumeSma20: Array<number | undefined>;
  byDate: Map<string, number>;
};

type OpenPosition = {
  security_id: string;
  symbol: string;
  company_name: string;
  entry_date: string;
  entry_price: number;
  quantity: number;
  stop_loss?: number;
  initial_risk?: number;
  target1_exit_taken?: boolean;
  target2_exit_taken?: boolean;
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const pct = (value: number, base: number) => (value / Math.max(0.01, base) - 1) * 100;
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const isDryVolumeMode = (mode: BasketBacktestFilters["strategyMode"]) => mode === "DRY_VOLUME_BREAKOUT" || mode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE" || mode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RANDOM" || mode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RISK_RANDOM";
const isQullamaggieMode = (mode: BasketBacktestFilters["strategyMode"]) => mode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE" || mode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RANDOM" || mode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RISK_RANDOM";
const isRandomEntryMode = (mode: BasketBacktestFilters["strategyMode"]) => mode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RANDOM" || mode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RISK_RANDOM";
const isRiskBasedEntryMode = (mode: BasketBacktestFilters["strategyMode"]) => mode === "DRY_VOLUME_BREAKOUT_QULLAMAGGIE_RISK_RANDOM";

function shuffleCandidates<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function signalKey(candidate: BasketCandidate, date: string) {
  const signalDate = candidate.signal_date ?? date;
  const entry = candidate.entry_price === undefined ? candidate.close : candidate.entry_price;
  return `${candidate.security_id}:${signalDate}:${entry.toFixed(4)}`;
}

function openRisk(position: OpenPosition) {
  if (position.stop_loss === undefined) return 0;
  return Math.max(0, position.entry_price - position.stop_loss) * position.quantity;
}

function totalOpenRisk(positions: Map<string, OpenPosition>) {
  return Array.from(positions.values()).reduce((sum, position) => sum + openRisk(position), 0);
}

export const defaultBasketBacktestFilters: BasketBacktestFilters = {
  strategyMode: "PULLBACK_RECLAIM",
  universe: "ALL",
  initialCapital: 1000000,
  compoundEquity: true,
  basketSize: 3,
  maxRiskPerTradePct: 0.3,
  maxOpenRiskPct: 2,
  exitRankBelow: 5,
  breadthMin: 0,
  exitBreadthBelow: 0,
  minRs60: 24,
  maxEntryVolumeRatio: 1.8,
  exitBelow20Ema: true,
  minMovePct: 30,
  moveWindowDays: 30,
  impulseLookbackDays: 95,
  minImpulseVolumeRatio: 1.2,
  minPullbackDays: 3,
  maxPullbackDays: 35,
  minPullbackPct: 3,
  maxPullbackPct: 18,
  maxPullbackVolumeRatio: 0.85,
  dryVolumeRatio: 0.6,
  dryVolumeLookbackDays: 20,
  breakoutWithinDays: 5,
  maxDistanceToEntryPct: 3,
  stopBufferPct: 0.2,
  partialExitDay: 3,
  target1R: 3,
  target1ExitPct: 30,
  target2R: 9,
  target2ExitPct: 30,
  exitBelow10Ema: true,
  startDate: "",
  endDate: "",
};

function findBestImpulse(rows: DailyPriceRecord[], currentIndex: number, filters: BasketBacktestFilters) {
  const scanStart = Math.max(0, currentIndex - filters.impulseLookbackDays - filters.moveWindowDays);
  const scanEnd = Math.max(scanStart, currentIndex - filters.minPullbackDays - filters.moveWindowDays);
  let best: { start: number; end: number; returnPct: number; volumeRatio: number } | null = null;
  for (let start = scanStart; start <= scanEnd; start += 1) {
    const end = start + filters.moveWindowDays;
    if (end >= currentIndex) break;
    const returnPct = pct(rows[end].close, rows[start].close);
    if (returnPct < filters.minMovePct) continue;
    const preVolume = avg(rows.slice(Math.max(0, start - 20), start).map((row) => row.volume));
    const impulseVolume = avg(rows.slice(start, end + 1).map((row) => row.volume));
    const volumeRatio = impulseVolume / Math.max(1, preVolume || impulseVolume);
    if (volumeRatio < filters.minImpulseVolumeRatio) continue;
    if (!best || returnPct > best.returnPct) best = { start, end, returnPct, volumeRatio };
  }
  return best;
}

function findSetup(stock: PreparedStock, index: number, filters: BasketBacktestFilters): Omit<BasketCandidate, "rank"> | null {
  const rows = stock.prices;
  const current = rows[index];
  const ema10 = stock.ema10[index];
  if (!current || !ema10 || index < filters.moveWindowDays + 25) return null;

  const best = findBestImpulse(rows, index, filters);

  if (!best) return null;
  const pullbackRows = rows.slice(best.end + 1, index + 1);
  const pullbackDays = pullbackRows.length;
  if (pullbackDays < filters.minPullbackDays || pullbackDays > filters.maxPullbackDays) return null;

  const impulseHigh = Math.max(...rows.slice(best.start, best.end + 1).map((row) => row.high));
  const lowestPullback = Math.min(...pullbackRows.map((row) => row.low));
  const pullbackPct = Math.max(0, pct(lowestPullback, impulseHigh) * -1);
  if (pullbackPct < filters.minPullbackPct || pullbackPct > filters.maxPullbackPct) return null;

  const impulseVolume = avg(rows.slice(best.start, best.end + 1).map((row) => row.volume));
  const pullbackVolume = avg(pullbackRows.map((row) => row.volume));
  const pullbackVolumeRatio = pullbackVolume / Math.max(1, impulseVolume);
  if (pullbackVolumeRatio > filters.maxPullbackVolumeRatio) return null;

  const hadCloseBelow10Ema = pullbackRows.slice(0, -1).some((row) => {
    const rowIndex = stock.byDate.get(row.trade_date);
    const rowEma = rowIndex === undefined ? undefined : stock.ema10[rowIndex];
    return rowEma !== undefined && row.close < rowEma;
  });
  if (!hadCloseBelow10Ema) return null;

  const previous = rows[index - 1];
  const previousEma = stock.ema10[index - 1];
  const trigger = Boolean(previous && previousEma && previous.close <= previousEma && current.close > ema10);
  const distanceFromEma = pct(current.close, ema10);
  const depthScore = Math.max(0, 1 - Math.abs(pullbackPct - 8) / 14) * 30;
  const dryVolumeScore = Math.max(0, 1 - pullbackVolumeRatio) * 35;
  const impulseScore = Math.min(best.returnPct, 70) * 0.65;
  const reclaimScore = current.close > ema10 ? Math.min(distanceFromEma, 8) * 2 : -12;
  const score = impulseScore + depthScore + dryVolumeScore + reclaimScore + Math.min(best.volumeRatio, 3) * 6;

  return {
    security_id: stock.security_id,
    symbol: stock.symbol,
    company_name: stock.company_name,
    close: current.close,
    score: round(score),
    trigger,
    impulse_return_pct: round(best.returnPct),
    impulse_volume_ratio: round(best.volumeRatio, 2),
    pullback_pct: round(pullbackPct),
    pullback_days: pullbackDays,
    pullback_volume_ratio: round(pullbackVolumeRatio, 2),
    distance_from_10ema_pct: round(distanceFromEma),
    reason: trigger
      ? `Reclaimed 10 EMA after ${pullbackDays}-day lower-volume pullback.`
      : `Setup active after ${best.returnPct.toFixed(1)}% impulse and ${pullbackPct.toFixed(1)}% pullback.`,
  };
}

function findDryVolumeBreakoutCandidate(stock: PreparedStock, index: number, filters: BasketBacktestFilters): Omit<BasketCandidate, "rank"> | null {
  const rows = stock.prices;
  const current = rows[index];
  const ema10 = stock.ema10[index];
  if (!current || !ema10 || index < filters.moveWindowDays + 30) return null;
  const best = findBestImpulse(rows, index, filters);
  if (!best) return null;

  const pullbackRows = rows.slice(best.end + 1, index);
  const pullbackDays = pullbackRows.length + 1;
  if (pullbackRows.length < filters.minPullbackDays || pullbackDays > filters.maxPullbackDays) return null;
  const impulseHigh = Math.max(...rows.slice(best.start, best.end + 1).map((row) => row.high));
  const lowestPullback = Math.min(...pullbackRows.map((row) => row.low));
  const pullbackPct = Math.max(0, pct(lowestPullback, impulseHigh) * -1);
  if (pullbackPct < filters.minPullbackPct || pullbackPct > filters.maxPullbackPct) return null;

  const lookbackStart = Math.max(0, pullbackRows.length - filters.dryVolumeLookbackDays);
  const dryCandidates = pullbackRows.slice(lookbackStart).map((row) => {
    const rowIndex = stock.byDate.get(row.trade_date) ?? 0;
    const volAvg = stock.volumeSma20[rowIndex];
    return { row, rowIndex, volumeRatio: volAvg ? row.volume / volAvg : 1 };
  });
  if (!dryCandidates.length) return null;
  const dry = dryCandidates.reduce((lowest, item) => item.row.volume < lowest.row.volume ? item : lowest, dryCandidates[0]);
  if (dry.volumeRatio > filters.dryVolumeRatio) return null;
  if (index - dry.rowIndex > filters.breakoutWithinDays) return null;

  const entryPrice = dry.row.high;
  const stopLoss = dry.row.low * (1 - filters.stopBufferPct / 100);
  const trigger = current.high >= entryPrice;
  const distanceToEntryPct = Math.abs(pct(current.close, entryPrice));
  if (distanceToEntryPct > filters.maxDistanceToEntryPct) return null;
  const distanceFromEma = pct(current.close, ema10);
  const pullbackVolumeRatio = avg(pullbackRows.map((row) => row.volume)) / Math.max(1, avg(rows.slice(best.start, best.end + 1).map((row) => row.volume)));
  const score = Math.min(best.returnPct, 70) * 0.55 + Math.max(0, 1 - dry.volumeRatio) * 40 + Math.max(0, 18 - pullbackPct) * 1.1 + Math.max(0, distanceFromEma) * 2 - Math.max(0, (entryPrice - current.close) / entryPrice * 100) * 2;

  return {
    security_id: stock.security_id,
    symbol: stock.symbol,
    company_name: stock.company_name,
    close: current.close,
    entry_price: entryPrice,
    stop_loss: stopLoss,
    signal_date: dry.row.trade_date,
    score: round(score),
    trigger,
    impulse_return_pct: round(best.returnPct),
    impulse_volume_ratio: round(best.volumeRatio, 2),
    pullback_pct: round(pullbackPct),
    pullback_days: pullbackDays,
    pullback_volume_ratio: round(pullbackVolumeRatio, 2),
    distance_from_10ema_pct: round(distanceFromEma),
    reason: trigger
      ? `Dry-volume candle ${dry.row.trade_date} triggered stop-entry above ${entryPrice.toFixed(2)} with SL ${stopLoss.toFixed(2)}.`
      : `Waiting for breakout above dry-volume candle high ${entryPrice.toFixed(2)} from ${dry.row.trade_date}.`,
  };
}

function findRsTightCandidate(stock: PreparedStock, index: number, filters: BasketBacktestFilters): Omit<BasketCandidate, "rank"> | null {
  const rows = stock.prices;
  const current = rows[index];
  const ema20 = stock.ema20[index];
  const ema50 = stock.ema50[index];
  if (!current || !ema20 || !ema50 || index < 90) return null;
  if (current.close < ema20 || ema20 < ema50) return null;
  const rs60 = pct(current.close, rows[index - 60].close);
  if (rs60 < filters.minRs60) return null;
  const volumeRatio = stock.volumeSma20[index] ? current.volume / stock.volumeSma20[index]! : 1;
  if (volumeRatio > filters.maxEntryVolumeRatio) return null;
  const ranges = rows.slice(index - 5, index + 1).map((row) => (row.high - row.low) / Math.max(0.01, row.close));
  const tightness = avg(ranges);
  const high20Prior = Math.max(...rows.slice(index - 20, index).map((row) => row.high));
  const breakout = current.close > high20Prior;
  const score = rs60 * 1.4 + pct(current.close, ema20) * 2 - tightness * 240 + (breakout ? 20 : 0) - Math.max(0, volumeRatio - 1) * 8;
  return {
    security_id: stock.security_id,
    symbol: stock.symbol,
    company_name: stock.company_name,
    close: current.close,
    score: round(score),
    trigger: true,
    impulse_return_pct: round(rs60),
    impulse_volume_ratio: round(volumeRatio, 2),
    pullback_pct: round(Math.max(0, -pct(current.close, Math.max(high20Prior, current.high)))),
    pullback_days: 0,
    pullback_volume_ratio: round(volumeRatio, 2),
    distance_from_10ema_pct: round(pct(current.close, ema20)),
    reason: `RS tight: 60D ${rs60.toFixed(1)}%, above 20/50 EMA, volume ${volumeRatio.toFixed(2)}x.`,
  };
}

function marketHealth(stocks: PreparedStock[], date: string) {
  let above20 = 0;
  let up20 = 0;
  let usable = 0;
  for (const stock of stocks) {
    const index = stock.byDate.get(date);
    if (index === undefined || index < 20 || stock.ema20[index] === undefined) continue;
    usable += 1;
    if (stock.prices[index].close > stock.ema20[index]!) above20 += 1;
    if (stock.prices[index].close > stock.prices[index - 20].close) up20 += 1;
  }
  return { above20: usable ? (above20 / usable) * 100 : 0, up20: usable ? (up20 / usable) * 100 : 0 };
}

function holdingView(position: OpenPosition, stock: PreparedStock | undefined, index: number | undefined, accountCapital: number, candidate?: BasketCandidate): BasketHolding {
  const price = stock && index !== undefined ? stock.prices[index]?.close ?? position.entry_price : position.entry_price;
  const value = price * position.quantity;
  const cost = position.entry_price * position.quantity;
  const risk = openRisk(position);
  return {
    ...position,
    current_price: round(price),
    stop_loss: position.stop_loss === undefined ? undefined : round(position.stop_loss),
    market_value: round(value),
    pnl: round(value - cost),
    pnl_pct: round(pct(price, position.entry_price)),
    open_risk: round(risk),
    open_risk_pct: round((risk / Math.max(1, accountCapital)) * 100),
    rank: candidate?.rank,
    score: candidate?.score,
  };
}

export async function runBasketRotationBacktest(input: Partial<BasketBacktestFilters> = {}): Promise<BasketBacktestResult> {
  const filters = { ...defaultBasketBacktestFilters, ...input };
  const db = await readDatabase();
  const members = db.universe_members.filter((member) =>
    member.is_current_constituent &&
    member.security_id &&
    (filters.universe === "ALL" || member.universe_name === filters.universe)
  );
  const memberById = new Map(members.map((member) => [member.security_id, member]));
  const pricesBySecurity = new Map<string, DailyPriceRecord[]>();
  for (const price of db.daily_prices) {
    if (!memberById.has(price.security_id)) continue;
    const list = pricesBySecurity.get(price.security_id);
    if (list) list.push(price);
    else pricesBySecurity.set(price.security_id, [price]);
  }

  const stocks: PreparedStock[] = [];
  const allDates = new Set<string>();
  for (const [securityId, prices] of pricesBySecurity) {
    const member = memberById.get(securityId);
    if (!member) continue;
    const rows = prices.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    if (rows.length < 130) continue;
    rows.forEach((row) => allDates.add(row.trade_date));
    stocks.push({
      security_id: securityId,
      symbol: member.symbol,
      company_name: member.company_name,
      prices: rows,
      ema10: calculateEma(rows.map((row) => row.close), 10),
      ema20: calculateEma(rows.map((row) => row.close), 20),
      ema50: calculateEma(rows.map((row) => row.close), 50),
      volumeSma20: calculateSma(rows.map((row) => row.volume), 20),
      byDate: new Map(rows.map((row, index) => [row.trade_date, index])),
    });
  }

  const dates = Array.from(allDates).sort();
  const startDate = filters.startDate || dates[Math.min(180, dates.length - 1)] || "";
  const endDate = filters.endDate || dates.at(-1) || "";
  const simulationDates = dates.filter((date) => date >= startDate && date <= endDate);
  const healthByDate = new Map(simulationDates.map((date) => [date, marketHealth(stocks, date)]));
  let cash = filters.initialCapital;
  let highWater = filters.initialCapital;
  let previousEquity = filters.initialCapital;
  const positions = new Map<string, OpenPosition>();
  const snapshots: BasketSnapshot[] = [];
  const tradeEvents: BasketEvent[] = [];
  const closedReturns: number[] = [];
  const ignoredSignals = new Set<string>();

  for (const date of simulationDates) {
    // Entries must be based on opening holdings/risk, before any same-day exits free capacity.
    const startOfDayHoldingIds = new Set(positions.keys());
    const startOfDayOpenSlots = Math.max(0, filters.basketSize - positions.size);
    const riskCapitalBase = filters.compoundEquity ? Math.max(0, previousEquity) : filters.initialCapital;
    const maxOpenRiskAmount = riskCapitalBase * Math.max(0, filters.maxOpenRiskPct) / 100;
    const maxTradeRiskAmount = riskCapitalBase * Math.max(0, filters.maxRiskPerTradePct) / 100;
    const startOfDayRiskCapacity = Math.max(0, maxOpenRiskAmount - totalOpenRisk(positions));
    const health = healthByDate.get(date) ?? { above20: 0, up20: 0 };
    const canEnter = filters.strategyMode !== "RS_TIGHT_2025" || health.above20 >= filters.breadthMin;
    const mustExitBreadth = filters.strategyMode === "RS_TIGHT_2025" && filters.exitBreadthBelow > 0 && health.above20 < filters.exitBreadthBelow;
    const candidateRows = stocks.flatMap((stock) => {
      const index = stock.byDate.get(date);
      if (index === undefined) return [];
      const setup = filters.strategyMode === "RS_TIGHT_2025"
        ? findRsTightCandidate(stock, index, filters)
        : isDryVolumeMode(filters.strategyMode)
          ? findDryVolumeBreakoutCandidate(stock, index, filters)
          : findSetup(stock, index, filters);
      return setup ? [setup] : [];
    }).sort((a, b) => b.score - a.score);
    const rawCandidates = candidateRows.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
    const candidateById = new Map(rawCandidates.map((candidate) => [candidate.security_id, candidate]));
    const actionableEntryDay = canEnter && (isRiskBasedEntryMode(filters.strategyMode) ? startOfDayRiskCapacity > 0 && maxTradeRiskAmount > 0 : startOfDayOpenSlots > 0);
    const events: BasketEvent[] = [];
    const boughtToday = new Set<string>();

    for (const [securityId, position] of Array.from(positions.entries())) {
      const stock = stocks.find((item) => item.security_id === securityId);
      const index = stock?.byDate.get(date);
      const row = stock && index !== undefined ? stock.prices[index] : undefined;
      const price = row?.close ?? position.entry_price;
      const rank = candidateById.get(securityId)?.rank ?? Infinity;
      const lost20Ema = filters.strategyMode === "RS_TIGHT_2025" && filters.exitBelow20Ema && stock && index !== undefined && stock.ema20[index] !== undefined && price < stock.ema20[index]!;
      const hitStop = isDryVolumeMode(filters.strategyMode) && position.stop_loss !== undefined && row !== undefined && row.low <= position.stop_loss;
      const lost10Ema = isDryVolumeMode(filters.strategyMode) && filters.exitBelow10Ema && stock && index !== undefined && stock.ema10[index] !== undefined && price < stock.ema10[index]!;
      if (hitStop || lost10Ema || mustExitBreadth || lost20Ema || (!isDryVolumeMode(filters.strategyMode) && rank > filters.exitRankBelow)) {
        const exitPrice = hitStop ? position.stop_loss! : price;
        const amount = exitPrice * position.quantity;
        const pnl = amount - position.entry_price * position.quantity;
        cash += amount;
        positions.delete(securityId);
        const reason = hitStop ? "Stop loss hit" : lost10Ema ? "Closed below 10 EMA" : mustExitBreadth ? `Breadth fell below ${filters.exitBreadthBelow}%` : lost20Ema ? "Closed below 20 EMA" : `Rank fell below ${filters.exitRankBelow}`;
        const event: BasketEvent = { date, type: "SELL", symbol: position.symbol, reason, price: round(exitPrice), quantity: round(position.quantity, 4), amount: round(amount), pnl: round(pnl) };
        events.push(event);
        tradeEvents.push(event);
        closedReturns.push(pct(exitPrice, position.entry_price));
      }
    }

    if (isQullamaggieMode(filters.strategyMode)) {
      for (const [securityId, position] of Array.from(positions.entries())) {
        if (position.quantity <= 0) continue;
        const stock = stocks.find((item) => item.security_id === securityId);
        const index = stock?.byDate.get(date);
        const entryIndex = stock?.byDate.get(position.entry_date);
        const row = stock && index !== undefined ? stock.prices[index] : undefined;
        if (!row || index === undefined || entryIndex === undefined) continue;
        const riskPerShare = position.stop_loss === undefined ? 0 : Math.max(0, position.entry_price - position.stop_loss);
        const partialExitDay = Math.max(1, Math.floor(filters.partialExitDay || 3));
        const isConfiguredTradingDayClose = index - entryIndex >= partialExitDay - 1;
        const target1R = Math.max(0.1, filters.target1R ?? 3);
        const target2R = Math.max(0.1, filters.target2R ?? 9);
        const target1ExitPct = Math.min(100, Math.max(0, filters.target1ExitPct ?? 30));
        const target2ExitPct = Math.min(100, Math.max(0, filters.target2ExitPct ?? 30));
        const target1Price = riskPerShare > 0 ? position.entry_price + riskPerShare * target1R : Infinity;
        const target2Price = riskPerShare > 0 ? position.entry_price + riskPerShare * target2R : Infinity;
        const targetEvents = [
          {
            key: "target1" as const,
            hit: row.high >= target1Price,
            dayExit: isConfiguredTradingDayClose,
            price: row.high >= target1Price ? target1Price : row.close,
            exitPct: target1ExitPct,
            reason: row.high >= target1Price
              ? `Qullamaggie target 1: sold ${target1ExitPct}% at ${target1R}R`
              : `Qullamaggie target 1: sold ${target1ExitPct}% at day ${partialExitDay} close`,
          },
          {
            key: "target2" as const,
            hit: row.high >= target2Price,
            dayExit: false,
            price: target2Price,
            exitPct: target2ExitPct,
            reason: `Qullamaggie target 2: sold ${target2ExitPct}% at ${target2R}R`,
          },
        ];
        for (const target of targetEvents) {
          if (position.quantity <= 0) break;
          if (target.key === "target1" && position.target1_exit_taken) continue;
          if (target.key === "target2" && position.target2_exit_taken) continue;
          if (!target.hit && !target.dayExit) continue;
          if (target.exitPct <= 0) continue;
          const exitQuantity = position.quantity * (target.exitPct / 100);
          const amount = target.price * exitQuantity;
          const pnl = amount - position.entry_price * exitQuantity;
          cash += amount;
          position.quantity -= exitQuantity;
          if (target.key === "target1") position.target1_exit_taken = true;
          if (target.key === "target2") position.target2_exit_taken = true;
          if (position.quantity <= 0.000001) positions.delete(securityId);
          const event: BasketEvent = { date, type: "SELL", symbol: position.symbol, reason: target.reason, price: round(target.price), quantity: round(exitQuantity, 4), amount: round(amount), pnl: round(pnl) };
          events.push(event);
          tradeEvents.push(event);
          closedReturns.push(pct(target.price, position.entry_price));
        }
      }
    }

    if (actionableEntryDay) {
      const eligibleBuyCandidates = rawCandidates
        .filter((candidate) => candidate.trigger && !startOfDayHoldingIds.has(candidate.security_id) && !positions.has(candidate.security_id) && !ignoredSignals.has(signalKey(candidate, date)));
      const orderedBuyCandidates = isRandomEntryMode(filters.strategyMode)
        ? shuffleCandidates(eligibleBuyCandidates)
        : eligibleBuyCandidates;
      const buyCandidates = isRiskBasedEntryMode(filters.strategyMode) ? orderedBuyCandidates : orderedBuyCandidates.slice(0, startOfDayOpenSlots);
      let remainingStartRiskCapacity = startOfDayRiskCapacity;
      for (const candidate of buyCandidates) {
        const entryPrice = candidate.entry_price ?? candidate.close;
        let allocation: number;
        let quantity: number;
        let initialRisk: number | undefined;
        if (isRiskBasedEntryMode(filters.strategyMode)) {
          const riskPerShare = candidate.stop_loss === undefined ? 0 : Math.max(0, entryPrice - candidate.stop_loss);
          if (riskPerShare <= 0 || remainingStartRiskCapacity <= 0) break;
          const targetRisk = Math.min(maxTradeRiskAmount, remainingStartRiskCapacity);
          quantity = targetRisk / riskPerShare;
          allocation = quantity * entryPrice;
          const deployedCost = Array.from(positions.values()).reduce((sum, position) => sum + position.entry_price * position.quantity, 0);
          const availableBuyingPower = filters.compoundEquity ? cash : Math.min(cash, Math.max(0, filters.initialCapital - deployedCost));
          if (allocation > availableBuyingPower) {
            quantity = availableBuyingPower / entryPrice;
            allocation = quantity * entryPrice;
          }
          initialRisk = riskPerShare * quantity;
          if (initialRisk <= 0 || initialRisk > remainingStartRiskCapacity + 0.01) continue;
        } else {
          const remainingSlots = Math.max(1, filters.basketSize - positions.size);
          const baseAllocation = filters.initialCapital / Math.max(1, filters.basketSize);
          const deployedCost = Array.from(positions.values()).reduce((sum, position) => sum + position.entry_price * position.quantity, 0);
          const availableBuyingPower = filters.compoundEquity ? cash : Math.min(cash, Math.max(0, filters.initialCapital - deployedCost));
          allocation = filters.compoundEquity ? availableBuyingPower / remainingSlots : Math.min(baseAllocation, availableBuyingPower);
          quantity = allocation / entryPrice;
        }
        if (allocation < 1000) continue;
        cash -= allocation;
        const member = memberById.get(candidate.security_id);
        positions.set(candidate.security_id, {
          security_id: candidate.security_id,
          symbol: candidate.symbol,
          company_name: member?.company_name ?? candidate.company_name,
          entry_date: date,
          entry_price: entryPrice,
          quantity,
          stop_loss: candidate.stop_loss,
          initial_risk: initialRisk,
        });
        if (initialRisk !== undefined) remainingStartRiskCapacity -= initialRisk;
        boughtToday.add(candidate.security_id);
        const selectionPrefix = isRiskBasedEntryMode(filters.strategyMode)
          ? `Risk random pick from ${eligibleBuyCandidates.length} eligible entries. Risk ${round(initialRisk ?? 0)} (${round(((initialRisk ?? 0) / Math.max(1, filters.initialCapital)) * 100)}% account). `
          : isRandomEntryMode(filters.strategyMode) ? `Random pick from ${eligibleBuyCandidates.length} eligible entries. ` : "";
        const event: BasketEvent = { date, type: "BUY", symbol: candidate.symbol, reason: `${selectionPrefix}Rank ${candidate.rank}: ${candidate.reason}`, price: round(entryPrice), quantity: round(quantity, 4), amount: round(allocation) };
        events.push(event);
        tradeEvents.push(event);

        const stock = stocks.find((item) => item.security_id === candidate.security_id);
        const rowIndex = stock?.byDate.get(date);
        const row = stock && rowIndex !== undefined ? stock.prices[rowIndex] : undefined;
        if (isDryVolumeMode(filters.strategyMode) && candidate.stop_loss !== undefined && row !== undefined && row.low <= candidate.stop_loss) {
          const position = positions.get(candidate.security_id);
          if (position) {
            const exitPrice = candidate.stop_loss;
            const exitAmount = exitPrice * position.quantity;
            const pnl = exitAmount - position.entry_price * position.quantity;
            cash += exitAmount;
            positions.delete(candidate.security_id);
            ignoredSignals.add(signalKey(candidate, date));
            const stopEvent: BasketEvent = {
              date,
              type: "SELL",
              symbol: position.symbol,
              reason: "Same-day stop loss hit after stop-entry fill",
              price: round(exitPrice),
              quantity: round(position.quantity, 4),
              amount: round(exitAmount),
              pnl: round(pnl),
            };
            events.push(stopEvent);
            tradeEvents.push(stopEvent);
            closedReturns.push(pct(exitPrice, position.entry_price));
          }
        }
      }
    }

    for (const candidate of rawCandidates) {
      if (!candidate.trigger || positions.has(candidate.security_id)) continue;
      if (startOfDayHoldingIds.has(candidate.security_id)) continue;
      if (boughtToday.has(candidate.security_id)) continue;
      ignoredSignals.add(signalKey(candidate, date));
    }

    const candidates = rawCandidates.map((candidate) => {
      if (!candidate.trigger) return { ...candidate, entry_triggered: false };
      if (boughtToday.has(candidate.security_id)) return { ...candidate, entry_triggered: true };
      const blockedReason = startOfDayHoldingIds.has(candidate.security_id)
        ? "Already held at the start of the day; same-day re-entry is blocked until the next session."
        : !actionableEntryDay
        ? isRiskBasedEntryMode(filters.strategyMode)
          ? "Open risk limit was full at the start of the day; entry signal ignored for trading."
          : "Basket was full at the start of the day; entry signal ignored for trading."
        : ignoredSignals.has(signalKey(candidate, date))
          ? "Signal was not bought when it triggered; waiting for a fresh setup."
          : isRiskBasedEntryMode(filters.strategyMode)
            ? "Entry was not selected within the available risk budget."
            : "Entry was not selected for the available basket slots.";
      return { ...candidate, trigger: false, entry_triggered: true, blocked_reason: blockedReason };
    });

    const holdings = Array.from(positions.values()).map((position) => {
      const stock = stocks.find((item) => item.security_id === position.security_id);
      const index = stock?.byDate.get(date);
      return holdingView(position, stock, index, filters.initialCapital, candidateById.get(position.security_id));
    });
    const invested = holdings.reduce((sum, holding) => sum + holding.market_value, 0);
    const equity = cash + invested;
    highWater = Math.max(highWater, equity);
    const snapshot: BasketSnapshot = {
      date,
      equity: round(equity),
      cash: round(cash),
      invested: round(invested),
      drawdown_pct: round(pct(equity, highWater)),
      day_pnl: round(equity - previousEquity),
      candidates: candidates.slice(0, 12),
      holdings,
      events,
    };
    previousEquity = equity;
    snapshots.push(snapshot);
  }

  const finalSnapshot = snapshots.at(-1);
  const finalEquity = finalSnapshot?.equity ?? filters.initialCapital;
  const sellEvents = tradeEvents.filter((event) => event.type === "SELL");
  const wins = closedReturns.filter((value) => value > 0).length;
  return {
    filters: { ...filters, startDate, endDate },
    summary: {
      startDate,
      endDate,
      initialCapital: filters.initialCapital,
      finalEquity,
      totalReturnPct: round(pct(finalEquity, filters.initialCapital)),
      maxDrawdownPct: round(Math.min(0, ...snapshots.map((snapshot) => snapshot.drawdown_pct))),
      trades: tradeEvents.filter((event) => event.type === "BUY").length,
      closedTrades: sellEvents.length,
      winRate: sellEvents.length ? round((wins / sellEvents.length) * 100) : 0,
      bestTradePct: closedReturns.length ? round(Math.max(...closedReturns)) : 0,
      worstTradePct: closedReturns.length ? round(Math.min(...closedReturns)) : 0,
      averageTradePct: closedReturns.length ? round(avg(closedReturns)) : 0,
    },
    snapshots,
    finalHoldings: finalSnapshot?.holdings ?? [],
    trades: tradeEvents,
    generatedAt: new Date().toISOString(),
  };
}
