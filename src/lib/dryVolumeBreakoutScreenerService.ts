import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import {
  defaultBasketBacktestFilters,
  runBasketRotationBacktest,
  type BasketBacktestFilters,
  type BasketCandidate,
} from "./basketRotationBacktestService";
import { calculateEma, calculateSma } from "./swingScreenerService";

export type DryVolumeBreakoutFilters = {
  universe: UniverseName | "ALL";
  minMovePct: number;
  moveWindowDays: number;
  impulseLookbackDays: number;
  minImpulseVolumeRatio: number;
  minPullbackDays: number;
  maxPullbackDays: number;
  minPullbackPct: number;
  maxPullbackPct: number;
  dryVolumeRatio: number;
  dryVolumeLookbackDays: number;
  breakoutWithinDays: number;
  stopBufferPct: number;
  maxDistanceToEntryPct: number;
  minAverageDailyTradedValue: number;
  showAll: boolean;
};

export type DryVolumeBreakoutRow = {
  status: "WAIT" | "ENTRY";
  qualifies: boolean;
  security_id: string;
  symbol: string;
  company_name: string;
  universe_name: UniverseName;
  current_date: string;
  current_close: number;
  entry_price?: number;
  stop_loss?: number;
  sl_pct?: number;
  ltp_to_entry_pct?: number;
  dry_candle_date?: string;
  dry_candle_high?: number;
  dry_candle_low?: number;
  dry_candle_volume_ratio?: number;
  days_since_dry_candle?: number;
  impulse_return_pct?: number;
  impulse_volume_ratio?: number;
  pullback_pct?: number;
  pullback_days?: number;
  pullback_volume_ratio?: number;
  ema10?: number;
  distance_from_10ema_pct?: number;
  score: number;
  rank: number;
  averageDailyTradedValue: number;
  reason: string;
  recent: Array<DailyPriceRecord & { ema10?: number; volume_ratio?: number }>;
};

export type DryVolumeBreakoutResponse = {
  filters: DryVolumeBreakoutFilters;
  evaluated: number;
  qualified: number;
  statusSummary: Record<string, number>;
  snapshotDate: string;
  results: DryVolumeBreakoutRow[];
  generatedAt: string;
};

export const defaultDryVolumeBreakoutFilters: DryVolumeBreakoutFilters = {
  universe: "ALL",
  minMovePct: 30,
  moveWindowDays: 30,
  impulseLookbackDays: 90,
  minImpulseVolumeRatio: 1.2,
  minPullbackDays: 3,
  maxPullbackDays: 35,
  minPullbackPct: 3,
  maxPullbackPct: 25,
  dryVolumeRatio: 0.4,
  dryVolumeLookbackDays: 5,
  breakoutWithinDays: 4,
  stopBufferPct: 0.5,
  maxDistanceToEntryPct: 4,
  minAverageDailyTradedValue: 0,
  showAll: false,
};

const fixedBacktestFilters: BasketBacktestFilters = {
  ...defaultBasketBacktestFilters,
  strategyMode: "DRY_VOLUME_BREAKOUT",
  universe: "ALL",
  initialCapital: 1000000,
  basketSize: 3,
  exitRankBelow: 9,
  minMovePct: 30,
  moveWindowDays: 30,
  impulseLookbackDays: 90,
  minImpulseVolumeRatio: 1.2,
  minPullbackDays: 3,
  maxPullbackDays: 35,
  minPullbackPct: 3,
  maxPullbackPct: 25,
  dryVolumeRatio: 0.4,
  dryVolumeLookbackDays: 5,
  breakoutWithinDays: 4,
  stopBufferPct: 0.5,
  exitBelow10Ema: true,
  startDate: "2026-08-01",
  endDate: "2026-12-30",
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function candidateDryDate(candidate: BasketCandidate) {
  if (candidate.signal_date) return candidate.signal_date;
  return candidate.reason.match(/from (\d{4}-\d{2}-\d{2})/)?.[1];
}

function recentRows(rows: DailyPriceRecord[], currentDate: string) {
  const eligible = rows.filter((row) => row.trade_date <= currentDate);
  const ema10 = calculateEma(eligible.map((row) => row.close), 10);
  const volumeSma20 = calculateSma(eligible.map((row) => row.volume), 20);
  return eligible.slice(-120).map((row) => {
    const index = eligible.findIndex((item) => item.trade_date === row.trade_date);
    const volumeAverage = volumeSma20[index];
    return { ...row, ema10: ema10[index], volume_ratio: volumeAverage ? row.volume / volumeAverage : undefined };
  });
}

export async function runDryVolumeBreakoutScreener(): Promise<DryVolumeBreakoutResponse> {
  const [backtest, db] = await Promise.all([
    runBasketRotationBacktest(fixedBacktestFilters),
    readDatabase(),
  ]);
  const snapshot = backtest.snapshots.at(-1);
  const membersById = new Map(db.universe_members.map((member) => [member.security_id, member]));
  const pricesBySecurity = new Map<string, DailyPriceRecord[]>();
  for (const price of db.daily_prices) {
    const list = pricesBySecurity.get(price.security_id);
    if (list) list.push(price);
    else pricesBySecurity.set(price.security_id, [price]);
  }
  const rows = (snapshot?.candidates ?? []).map((candidate) => {
    const member = membersById.get(candidate.security_id);
    const prices = (pricesBySecurity.get(candidate.security_id) ?? []).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    const currentDate = snapshot?.date ?? prices.at(-1)?.trade_date ?? "";
    const recent = recentRows(prices, currentDate);
    const current = recent.at(-1);
    const dryDate = candidateDryDate(candidate);
    const dry = dryDate ? prices.find((row) => row.trade_date === dryDate) : undefined;
    const entry = candidate.entry_price;
    const stop = candidate.stop_loss;
    const slPct = entry && stop ? ((entry - stop) / Math.max(0.01, entry)) * 100 : undefined;
    const ltpToEntry = entry ? (entry / Math.max(0.01, candidate.close) - 1) * 100 : undefined;
    const averageDailyTradedValue = round(avg(recent.slice(-20).map((row) => row.close * row.volume)));
    const status: DryVolumeBreakoutRow["status"] = candidate.trigger ? "ENTRY" : "WAIT";
    const row: DryVolumeBreakoutRow = {
      status,
      qualifies: true,
      security_id: candidate.security_id,
      symbol: candidate.symbol,
      company_name: candidate.company_name,
      universe_name: member?.universe_name ?? "SMALLCAP",
      current_date: currentDate,
      current_close: candidate.close,
      entry_price: entry === undefined ? undefined : round(entry),
      stop_loss: stop === undefined ? undefined : round(stop),
      sl_pct: slPct === undefined ? undefined : round(slPct),
      ltp_to_entry_pct: ltpToEntry === undefined ? undefined : round(ltpToEntry),
      dry_candle_date: dryDate,
      dry_candle_high: dry?.high === undefined ? entry : round(dry.high),
      dry_candle_low: dry?.low === undefined ? undefined : round(dry.low),
      dry_candle_volume_ratio: candidate.pullback_volume_ratio,
      days_since_dry_candle: dryDate && currentDate ? recent.filter((item) => item.trade_date > dryDate && item.trade_date <= currentDate).length : undefined,
      impulse_return_pct: candidate.impulse_return_pct,
      impulse_volume_ratio: candidate.impulse_volume_ratio,
      pullback_pct: candidate.pullback_pct,
      pullback_days: candidate.pullback_days,
      pullback_volume_ratio: candidate.pullback_volume_ratio,
      ema10: current?.ema10 === undefined ? undefined : round(current.ema10),
      distance_from_10ema_pct: candidate.distance_from_10ema_pct,
      score: candidate.score,
      rank: candidate.rank,
      averageDailyTradedValue,
      reason: candidate.reason,
      recent,
    };
    return row;
  });
  const statusSummary = rows.reduce<Record<string, number>>((summary, row) => {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
    return summary;
  }, {});
  return {
    filters: defaultDryVolumeBreakoutFilters,
    evaluated: rows.length,
    qualified: rows.length,
    statusSummary,
    snapshotDate: snapshot?.date ?? "",
    results: rows,
    generatedAt: new Date().toISOString(),
  };
}
