import "server-only";
import { readDatabase } from "./localDatabase";
import { positionSizingFromStop, swingLowBeforeLatest, type EntrySizingSettings } from "./entrySizing";
import { isLatestLowAbove10Ema } from "./dailyEmaLow";
import { calculateEma, calculateSma } from "./swingScreenerService";
import { analyzeStock, defaultThirtyInThirtyFilters } from "./thirtyInThirtyScreenerService";
import { analyzeStochRsiStock, defaultStochRsiScreenerFilters } from "./stochRsiScreenerService";
import { analyzeQStock, defaultQFilters } from "./qullamaggieLogic";
import { analyzeEmaNoTouchStock, defaultEmaNoTouchFilters } from "./emaNoTouchScreenerService";
import { findVolumeSellingSetup } from "./volumeSellingLogic";
import { findStochHigh } from "./stochHigh";
import { findSwingHigh } from "./swingHigh";
import type { DailyPriceRecord, UniverseName } from "./types";

export type BacktestConfig = EntrySizingSettings & {
  startDate: string; endDate: string; universe: "ALL" | UniverseName;
  openRiskPct: number; mtmTarget: number; volumeRatio: number; maxEntries: number;
  stopMode: "cost" | "ema"; riskSizing: "full" | "fit"; cashSizing: "full" | "fit";
};

type Position = {
  symbol: string; entryDate: string; entry: number; high: number; quantity: number;
  stop: number; close: number; phase: "Swing low" | "Protected" | "Fixed at cost";
};

type Event = { symbol: string; action: "Buy" | "Sell" | "Stop"; reason: string; price: number; quantity: number; pnl?: number };
type Candidate = { symbol: string; gain: number; volume: number; sources: string[]; decision: string };

function indiaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function parseBacktestConfig(input: Record<string, unknown>, settings: EntrySizingSettings): BacktestConfig {
  const today = indiaDate();
  const [year, month, day] = today.split("-").map(Number);
  const previousYear = new Date(Date.UTC(year - 1, month - 1, Math.min(day, new Date(Date.UTC(year - 1, month, 0)).getUTCDate())));
  function date(key: string, fallback: string) {
    const value = input[key] ?? fallback;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value || value > today) throw new Error("Select valid dates through today.");
    return value;
  }
  function number(key: string, fallback: number, minimum: number, maximum: number) {
    const value = input[key] ?? fallback;
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Invalid value for ${key}.`);
    return value;
  }
  const startDate = date("startDate", previousYear.toISOString().slice(0, 10));
  const endDate = date("endDate", today);
  if (startDate > endDate) throw new Error("Start date must be on or before the end date.");
  const universe = input.universe ?? "ALL";
  if (universe !== "ALL" && universe !== "CNX500" && universe !== "NIFTYSC500") throw new Error("Invalid universe.");
  const maxEntries = number("maxEntries", 0, 0, 1000);
  if (!Number.isInteger(maxEntries)) throw new Error("Daily entry limit must be a whole number.");
  return {
    startDate, endDate, universe, maxEntries,
    totalCapital: number("totalCapital", settings.totalCapital, 1, 1e12),
    riskPercent: number("riskPercent", settings.riskPercent, 0.001, 100),
    openRiskPct: number("openRiskPct", 1.5, 0.001, 100),
    mtmTarget: number("mtmTarget", 100000, 0, 1e12),
    volumeRatio: number("volumeRatio", 1.5, 0.01, 100),
    stopMode: input.stopMode === "ema" ? "ema" : "cost",
    riskSizing: input.riskSizing === "fit" ? "fit" : "full",
    cashSizing: input.cashSizing === "full" ? "full" : "fit",
  };
}

export async function runScreenerBacktest(config: BacktestConfig) {
  const db = await readDatabase();
  const members = new Map(db.universe_members.filter(member => member.is_current_constituent && member.security_id &&
    (config.universe === "ALL" || config.universe === member.universe_name)).map(member => [member.security_id, member]));
  const grouped = new Map<string, DailyPriceRecord[]>();
  for (const row of db.daily_prices) {
    if (!members.has(row.security_id) || row.is_provisional || row.trade_date > config.endDate || row.close <= 0 || row.low <= 0) continue;
    const rows = grouped.get(row.security_id) ?? [];
    rows.push(row);
    grouped.set(row.security_id, rows);
  }

  const observations = new Map<string, typeof db.seasonal_observations>();
  for (const observation of db.seasonal_observations) {
    if (observation.universe_name !== "CNX500" || !members.has(observation.security_id)) continue;
    const key = `${observation.security_id}:${observation.window_start_month}`;
    const rows = observations.get(key) ?? [];
    rows.push(observation);
    observations.set(key, rows);
  }
  function seasonal(id: string, date: string) {
    const month = Number(date.slice(5, 7)) - 1;
    const eligible = new Map<number, number>();
    for (const row of observations.get(`${id}:${month}`) ?? []) {
      const completed = new Date(Date.UTC(row.occurrence_year, month + 3, 1)).toISOString().slice(0, 10);
      if (completed <= date && row.exit_date < date) eligible.set(row.occurrence_year, row.return_pct);
    }
    return eligible.size > 0 && [...eligible.values()].reduce((sum, value) => sum + value, 0) / eligible.size > 30;
  }

  const byDate = new Map<string, { id: string; rows: DailyPriceRecord[]; index: number; ema: number; volume: number }[]>();
  for (const [id, rows] of grouped) {
    rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    const ema = calculateEma(rows.map(row => row.close), 10);
    const sma = calculateSma(rows.map(row => row.volume), 20);
    rows.forEach((row, index) => {
      if (row.trade_date < config.startDate) return;
      const session = byDate.get(row.trade_date) ?? [];
      session.push({ id, rows, index, ema: ema[index] ?? 0, volume: sma[index] ? row.volume / sma[index]! : 0 });
      byDate.set(row.trade_date, session);
    });
  }

  const limit = config.totalCapital * config.openRiskPct / 100;
  const positions = new Map<string, Position>();
  const risk = (position: Position) => Math.max(0, position.entry - position.stop) * position.quantity;
  const openRisk = () => [...positions.values()].reduce((sum, position) => sum + risk(position), 0);
  const mark = (position: Position) => (position.close - position.entry) * position.quantity;
  let cash = config.totalCapital;
  let realized = 0;
  let peak = cash;
  const snapshots = [...byDate.keys()].sort().map(date => {
    const session = byDate.get(date)!;
    const candles = new Map(session.map(point => [point.id, point]));
    const events: Event[] = [];
    const exited = new Set<string>();
    function sell(id: string, position: Position, reason: string) {
      const pnl = mark(position);
      cash += position.close * position.quantity;
      realized += pnl;
      events.push({ symbol: position.symbol, action: "Sell", reason, price: position.close, quantity: position.quantity, pnl });
      positions.delete(id);
      exited.add(id);
    }

    for (const [id, position] of positions) {
      const point = candles.get(id);
      if (!point) continue;
      position.close = point.rows[point.index].close;
      if (position.close <= position.stop) {
        sell(id, position, "Close reached stop");
        continue;
      }
      const previousStop = position.stop;
      const previousPhase = position.phase;
      if (position.phase === "Swing low" && position.close > position.high) {
        position.phase = "Protected";
        position.stop = position.entry;
      }
      if (position.phase === "Protected") {
        if (config.stopMode === "cost" && point.ema > position.entry) {
          position.phase = "Fixed at cost";
          position.stop = position.entry;
        } else {
          position.stop = Math.max(position.stop, point.ema);
        }
      }
      if (position.stop !== previousStop || position.phase !== previousPhase) {
        events.push({ symbol: position.symbol, action: "Stop", reason: position.phase, price: position.stop, quantity: position.quantity });
      }
    }

    const mtmBeforeProfitExit = [...positions.values()].reduce((sum, position) => sum + mark(position), 0);
    if (config.mtmTarget > 0 && mtmBeforeProfitExit > config.mtmTarget) {
      const winner = [...positions].filter(([id]) => candles.has(id)).sort(([, a], [, b]) => mark(b) - mark(a) || a.symbol.localeCompare(b.symbol))[0];
      if (winner && mark(winner[1]) > 0) sell(...winner, "Portfolio MTM target");
    }

    const ranked = session.flatMap(point => {
      const { id, rows, index, ema, volume } = point;
      const candle = rows[index];
      const previous = rows[index - 1];
      if (index < 69 || !previous || candle.close <= previous.close || volume < config.volumeRatio ||
        !isLatestLowAbove10Ema({ ema10: ema, recent: [candle] })) return [];
      const member = members.get(id)!;
      const history = rows.slice(0, index + 1);
      const input = { securityId: id, symbol: member.symbol, companyName: member.company_name, universeName: member.universe_name, prices: history };
      const base = analyzeStock({ ...input, filters: defaultThirtyInThirtyFilters });
      if (!base) return [];
      const sources: string[] = [];
      if (base.qualifies) sources.push("30 in 30");
      if (findStochHigh(base.recent)?.qualifies) sources.push("StochHigh");
      if (findSwingHigh(base.recent, candle.close)?.qualifies) sources.push("SwingHigh");
      if ((base.monthly_stoch_d ?? 0) > 79) sources.push("MStochRSI80");
      if (analyzeQStock({ ...input, filters: defaultQFilters, asOf: date }).qualifies) sources.push("Qullamaggie");
      if (analyzeEmaNoTouchStock({ ...input, filters: defaultEmaNoTouchFilters })) sources.push("10 EMA Catchup");
      if (analyzeStochRsiStock({ ...input, filters: defaultStochRsiScreenerFilters })?.qualifies) sources.push("StochRSI");
      if ((findVolumeSellingSetup(history)?.signal_age ?? Infinity) < 21) sources.push("SellingClimax");
      if (seasonal(id, date)) sources.push("Seasonal Stocks");
      if (!sources.length) return [];
      return [{ id, candle, stop: swingLowBeforeLatest(history.slice(-6))?.low, symbol: member.symbol, volume, sources, gain: (candle.close / previous.close - 1) * 100 }];
    }).sort((a, b) => b.gain - a.gain || a.symbol.localeCompare(b.symbol));

    let entries = 0;
    const candidates: Candidate[] = ranked.map(({ id, candle, stop, symbol, gain, volume, sources }) => {
      const candidate = { symbol, gain, volume, sources, decision: "" };
      if (positions.has(id)) return { ...candidate, decision: "Already held" };
      if (exited.has(id)) return { ...candidate, decision: "Exited this session" };
      if (config.maxEntries && entries >= config.maxEntries) return { ...candidate, decision: "Daily entry limit" };
      const sizing = positionSizingFromStop(candle.close, stop, config);
      if (!sizing.valid || stop === undefined) return { ...candidate, decision: "Swing-low sizing unavailable" };
      const cashShares = Math.floor(Math.max(0, cash) / candle.close);
      const riskShares = Math.floor((Math.max(0, limit - openRisk()) + 1e-8) / sizing.riskPerShare);
      if (riskShares < (config.riskSizing === "full" ? sizing.quantity : 1)) return { ...candidate, decision: "Open risk limit" };
      if (cashShares < (config.cashSizing === "full" ? sizing.quantity : 1)) return { ...candidate, decision: "Insufficient cash" };
      const quantity = Math.min(sizing.quantity, cashShares, riskShares);
      cash -= quantity * candle.close;
      positions.set(id, { symbol, entryDate: date, entry: candle.close, high: candle.high, quantity, stop, close: candle.close, phase: "Swing low" });
      events.push({ symbol, action: "Buy", reason: "Ranked screener entry", price: candle.close, quantity });
      entries += 1;
      return { ...candidate, decision: "Bought" };
    });
    const holdings = [...positions].map(([id, position]) => ({ ...position, stale: !candles.has(id), pnl: mark(position), risk: risk(position) }));
    const marketValue = holdings.reduce((sum, position) => sum + position.close * position.quantity, 0);
    const equity = cash + marketValue;
    peak = Math.max(peak, equity);
    return { date, events, candidates, holdings, cash, marketValue, equity, realized, mtmBeforeProfitExit,
      unrealized: holdings.reduce((sum, position) => sum + position.pnl, 0), openRisk: openRisk(), drawdown: (1 - equity / peak) * 100 };
  });

  if (!snapshots.length) throw new Error("No completed daily candles are stored for the selected dates and universe.");
  return { config, limit, snapshots, universeSize: members.size, coveredStocks: grouped.size, hasSeasonalData: observations.size > 0 };
}

export type BacktestResult = Awaited<ReturnType<typeof runScreenerBacktest>>;
