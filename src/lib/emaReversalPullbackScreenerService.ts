import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { calculateEma, calculateSma } from "./swingScreenerService";

export type EmaReversalStage = "FIRST_PULLBACK" | "TIGHT_CONSOLIDATION" | "REACCELERATION" | "INVALIDATED" | "NO_SETUP" | "INSUFFICIENT_DATA";

export type EmaReversalPullbackFilters = {
  universe: UniverseName | "ALL";
  emaPeriod: number;
  downtrendLookback: number;
  minBelowEmaPct: number;
  minHistoricalDeclinePct: number;
  emaSlopeLookback: number;
  breakoutVolumeMultiplier: number;
  minPostBreakoutAdvancePct: number;
  minPullbackPct: number;
  maxPullbackPct: number;
  minPullbackDays: number;
  maxPullbackDays: number;
  maxEmaDownsideTolerancePct: number;
  minBreakoutAge: number;
  maxBreakoutAge: number;
  requireVolumeContraction: boolean;
  firstPullbackOnly: boolean;
  allowSidewaysConsolidation: boolean;
  allowReacceleration: boolean;
  maxCompletedPullbacks: number;
  minSetupScore: number;
  showAll: boolean;
};

export type EmaReversalPullbackRow = {
  status: EmaReversalStage;
  qualifies: boolean;
  security_id: string;
  symbol: string;
  company_name: string;
  universe_name: UniverseName;
  current_date: string;
  current_close: number;
  ema50: number;
  distance_from_ema_pct: number;
  breakout_date?: string;
  breakout_close?: number;
  breakout_volume_ratio?: number;
  confirmation_date?: string;
  confirmation_volume_ratio?: number;
  post_breakout_high_date?: string;
  post_breakout_high?: number;
  advance_pct?: number;
  pullback_start_date?: string;
  pullback_pct?: number;
  pullback_volume_ratio?: number;
  days_in_pullback?: number;
  completed_pullback_count: number;
  setup_score: number;
  score_breakdown: Record<string, number>;
  downtrend_below_ema_pct?: number;
  historical_decline_pct?: number;
  ema50_slope_pct?: number;
  average_volume_5?: number;
  average_volume_20?: number;
  setup_type?: "Pullback" | "Sideways Consolidation" | "Reacceleration";
  reason: string;
  recent: Array<DailyPriceRecord & { ema50?: number; volume_ratio?: number }>;
};

export const defaultEmaReversalPullbackFilters: EmaReversalPullbackFilters = {
  universe: "ALL",
  emaPeriod: 50,
  downtrendLookback: 90,
  minBelowEmaPct: 70,
  minHistoricalDeclinePct: 20,
  emaSlopeLookback: 20,
  breakoutVolumeMultiplier: 1.5,
  minPostBreakoutAdvancePct: 10,
  minPullbackPct: 3,
  maxPullbackPct: 12,
  minPullbackDays: 3,
  maxPullbackDays: 25,
  maxEmaDownsideTolerancePct: 2,
  minBreakoutAge: 10,
  maxBreakoutAge: 100,
  requireVolumeContraction: false,
  firstPullbackOnly: true,
  allowSidewaysConsolidation: true,
  allowReacceleration: false,
  maxCompletedPullbacks: 0,
  minSetupScore: 0,
  showAll: false,
};

type CacheValue = { key: string; expiresAt: number; value: Awaited<ReturnType<typeof calculateEmaReversalPullbackScreener>> };
const globalCache = globalThis as typeof globalThis & { __emaReversalPullbackCache?: CacheValue };

const pct = (value: number, base: number) => (value / Math.max(0.01, base) - 1) * 100;
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const normalize = (value: number, min: number, max: number) => clamp((value - min) / Math.max(0.0001, max - min), 0, 1);

function chronologicalDeclinePct(rows: DailyPriceRecord[]) {
  let peak = rows[0]?.high ?? 0;
  let best = 0;
  for (const row of rows) {
    peak = Math.max(peak, row.high);
    best = Math.max(best, ((peak - row.low) / Math.max(0.01, peak)) * 100);
  }
  return best;
}

function findPivotHigh(rows: DailyPriceRecord[], startIndex: number, endIndex: number) {
  let best = startIndex;
  for (let index = Math.max(0, startIndex); index <= endIndex; index += 1) {
    const left = rows.slice(Math.max(startIndex, index - 2), index);
    const right = rows.slice(index + 1, Math.min(endIndex + 1, index + 3));
    const confirmed = left.every((row) => rows[index].high >= row.high) && right.every((row) => rows[index].high >= row.high);
    if (confirmed && rows[index].high >= rows[best].high) best = index;
  }
  return best;
}

function completedPullbackCycles(rows: DailyPriceRecord[], breakoutIndex: number, currentIndex: number, minPullbackPct: number) {
  let cycles = 0;
  let high = rows[breakoutIndex].high;
  let inPullback = false;
  for (let index = breakoutIndex + 1; index <= currentIndex; index += 1) {
    const drawdown = ((high - rows[index].low) / Math.max(0.01, high)) * 100;
    if (!inPullback && drawdown >= minPullbackPct) inPullback = true;
    if (inPullback && rows[index].close > high) {
      cycles += 1;
      inPullback = false;
    }
    high = Math.max(high, rows[index].high);
  }
  return cycles;
}

function scoreParts(input: {
  belowEmaPct: number;
  declinePct: number;
  breakoutVolumeRatio: number;
  advancePct: number;
  pullbackVolumeRatio: number;
  pullbackPct: number;
  emaDistancePct: number;
  emaSlopePct: number;
}) {
  return {
    downtrend: round((normalize(input.belowEmaPct, 60, 90) * 0.55 + normalize(input.declinePct, 10, 40) * 0.45) * 15, 1),
    breakoutVolume: round(normalize(input.breakoutVolumeRatio, 1, 3) * 20, 1),
    postBreakoutAdvance: round(normalize(input.advancePct, 5, 25) * 15, 1),
    pullbackVolume: round((1 - normalize(input.pullbackVolumeRatio, 0.45, 1.2)) * 20, 1),
    pullbackTightness: round((1 - normalize(Math.abs(input.pullbackPct - 7), 0, 10)) * 15, 1),
    emaPositioning: round((normalize(input.emaSlopePct, -1, 4) * 0.45 + (1 - normalize(Math.abs(input.emaDistancePct), 0, 8)) * 0.55) * 15, 1),
  };
}

export function analyzeEmaReversalPullbackStock(input: {
  securityId: string;
  symbol: string;
  companyName: string;
  universeName: UniverseName;
  prices: DailyPriceRecord[];
  filters: EmaReversalPullbackFilters;
}): EmaReversalPullbackRow | null {
  const filters = input.filters;
  const rows = [...input.prices].filter((row) => !row.is_provisional).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const minRows = Math.max(250, filters.emaPeriod + filters.downtrendLookback + filters.maxBreakoutAge + 10);
  if (rows.length < minRows) {
    const current = rows.at(-1);
    if (!current) return null;
    return {
      status: "INSUFFICIENT_DATA",
      qualifies: false,
      security_id: input.securityId,
      symbol: input.symbol,
      company_name: input.companyName,
      universe_name: input.universeName,
      current_date: current.trade_date,
      current_close: current.close,
      ema50: 0,
      distance_from_ema_pct: 0,
      completed_pullback_count: 0,
      setup_score: 0,
      score_breakdown: {},
      reason: `Only ${rows.length} completed daily candles are available; at least ${minRows} are required.`,
      recent: rows.slice(-120),
    };
  }

  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume);
  const ema = calculateEma(closes, filters.emaPeriod);
  const volumeSma20 = calculateSma(volumes, 20);
  const volumeSma50 = calculateSma(volumes, 50);
  const currentIndex = rows.length - 1;
  const current = rows[currentIndex];
  const currentEma = ema[currentIndex];
  if (!currentEma) return null;

  let bestSetup: EmaReversalPullbackRow | null = null;
  const firstBreakout = Math.max(filters.emaPeriod + filters.downtrendLookback + filters.emaSlopeLookback, currentIndex - filters.maxBreakoutAge);
  const lastBreakout = Math.max(firstBreakout, currentIndex - filters.minBreakoutAge);

  for (let breakoutIndex = firstBreakout; breakoutIndex <= lastBreakout; breakoutIndex += 1) {
    const previousEma = ema[breakoutIndex - 1];
    const breakoutEma = ema[breakoutIndex];
    if (!previousEma || !breakoutEma) continue;
    const previous = rows[breakoutIndex - 1];
    const breakout = rows[breakoutIndex];
    if (!(previous.close <= previousEma && breakout.close > breakoutEma)) continue;

    const preRows = rows.slice(breakoutIndex - filters.downtrendLookback, breakoutIndex);
    const belowEmaPct = preRows.filter((row, offset) => {
      const value = ema[breakoutIndex - filters.downtrendLookback + offset];
      return value !== undefined && row.close < value;
    }).length / Math.max(1, preRows.length) * 100;
    const slopeBase = ema[Math.max(0, breakoutIndex - filters.emaSlopeLookback)];
    const preBreakoutEmaSlope = slopeBase ? pct(breakoutEma, slopeBase) : 0;
    const declinePct = chronologicalDeclinePct(preRows);
    if (belowEmaPct < filters.minBelowEmaPct || preBreakoutEmaSlope >= 0 || declinePct < filters.minHistoricalDeclinePct) continue;

    const breakoutVolumeBase = avg(volumes.slice(Math.max(0, breakoutIndex - 50), breakoutIndex));
    const directBreakoutVolumeRatio = breakoutVolumeBase ? breakout.volume / breakoutVolumeBase : 0;
    const closesUpper = breakout.high > breakout.low ? (breakout.close - breakout.low) / (breakout.high - breakout.low) >= 0.6 : true;
    let confirmationIndex = breakoutIndex;
    let confirmationVolumeRatio = directBreakoutVolumeRatio;
    if (directBreakoutVolumeRatio < filters.breakoutVolumeMultiplier || !closesUpper) {
      confirmationIndex = -1;
      for (let index = breakoutIndex + 1; index <= Math.min(currentIndex, breakoutIndex + 5); index += 1) {
        const base = avg(volumes.slice(Math.max(0, index - 50), index));
        const ratio = base ? rows[index].volume / base : 0;
        const bullishExpansion = rows[index].close > rows[index].open && rows[index].close > rows[index - 1].close && rows[index].close > (ema[index] ?? Infinity);
        if (ratio >= filters.breakoutVolumeMultiplier && bullishExpansion) {
          confirmationIndex = index;
          confirmationVolumeRatio = ratio;
          break;
        }
      }
      if (confirmationIndex < 0) continue;
    }

    const postRows = rows.slice(breakoutIndex, currentIndex + 1);
    let highIndex = breakoutIndex;
    for (let index = breakoutIndex + 1; index <= currentIndex; index += 1) {
      if (rows[index].high > rows[highIndex].high) highIndex = index;
    }
    const advancePct = pct(rows[highIndex].high, breakout.close);
    if (advancePct < filters.minPostBreakoutAdvancePct || highIndex <= breakoutIndex) continue;

    const invalidCloses = rows.slice(-3).filter((row, offset, latest) => {
      const originalIndex = currentIndex - latest.length + 1 + offset;
      const value = ema[originalIndex];
      return value !== undefined && pct(row.close, value) < -5;
    }).length;
    if (invalidCloses >= 3) continue;

    const pivotIndex = findPivotHigh(rows, breakoutIndex + 1, currentIndex);
    const pivot = rows[pivotIndex];
    const pullbackPct = ((pivot.high - current.close) / Math.max(0.01, pivot.high)) * 100;
    const daysInPullback = currentIndex - pivotIndex;
    const emaDistancePct = pct(current.close, currentEma);
    const latest10Range = rows.slice(-10);
    const rangePct = latest10Range.length ? ((Math.max(...latest10Range.map((row) => row.high)) - Math.min(...latest10Range.map((row) => row.low))) / Math.max(0.01, Math.min(...latest10Range.map((row) => row.low)))) * 100 : Infinity;
    const avg5 = avg(volumes.slice(-5));
    const avg20 = avg(volumes.slice(-20));
    const advanceVolume = avg(volumes.slice(confirmationIndex, Math.max(confirmationIndex + 1, highIndex + 1)));
    const pullbackVolume = avg(volumes.slice(Math.max(pivotIndex + 1, currentIndex - daysInPullback + 1), currentIndex + 1));
    const pullbackVolumeRatio = advanceVolume ? pullbackVolume / advanceVolume : avg20 ? avg5 / avg20 : 1;
    const volumePass = !filters.requireVolumeContraction || (avg5 < avg20 && pullbackVolumeRatio <= 0.7);
    const currentCompletedCycles = completedPullbackCycles(rows, breakoutIndex, currentIndex, filters.minPullbackPct);
    const cyclesPass = !filters.firstPullbackOnly || currentCompletedCycles <= filters.maxCompletedPullbacks;
    const emaPass = emaDistancePct >= -filters.maxEmaDownsideTolerancePct;
    const pullbackPass = pullbackPct >= filters.minPullbackPct && pullbackPct <= filters.maxPullbackPct && daysInPullback >= filters.minPullbackDays && daysInPullback <= filters.maxPullbackDays;
    const sidewaysPass = filters.allowSidewaysConsolidation && daysInPullback >= 5 && daysInPullback <= 20 && rangePct <= 8 && emaPass;
    const recentHigh = Math.max(...rows.slice(Math.max(breakoutIndex, currentIndex - 10), currentIndex).map((row) => row.high));
    const reacceleration = filters.allowReacceleration && current.close > recentHigh && avg5 >= avg20;
    const qualifies = emaPass && volumePass && cyclesPass && (pullbackPass || sidewaysPass || reacceleration);
    if (!qualifies && !filters.showAll) continue;

    const emaSlopeBase = ema[Math.max(0, currentIndex - filters.emaSlopeLookback)];
    const emaSlopePct = emaSlopeBase ? pct(currentEma, emaSlopeBase) : 0;
    const parts = scoreParts({ belowEmaPct, declinePct, breakoutVolumeRatio: confirmationVolumeRatio, advancePct, pullbackVolumeRatio, pullbackPct, emaDistancePct, emaSlopePct });
    const setupScore = round(Object.values(parts).reduce((sum, value) => sum + value, 0));
    if (setupScore < filters.minSetupScore && !filters.showAll) continue;
    const status: EmaReversalStage = reacceleration ? "REACCELERATION" : pullbackPass ? "FIRST_PULLBACK" : sidewaysPass ? "TIGHT_CONSOLIDATION" : "NO_SETUP";

    const recent = rows.slice(-126).map((row, offset, recentRows) => {
      const originalIndex = rows.length - recentRows.length + offset;
      const volAvg = volumeSma20[originalIndex];
      return { ...row, ema50: ema[originalIndex], volume_ratio: volAvg ? row.volume / volAvg : undefined };
    });
    const row: EmaReversalPullbackRow = {
      status,
      qualifies,
      security_id: input.securityId,
      symbol: input.symbol,
      company_name: input.companyName,
      universe_name: input.universeName,
      current_date: current.trade_date,
      current_close: round(current.close),
      ema50: round(currentEma),
      distance_from_ema_pct: round(emaDistancePct),
      breakout_date: breakout.trade_date,
      breakout_close: round(breakout.close),
      breakout_volume_ratio: round(directBreakoutVolumeRatio),
      confirmation_date: rows[confirmationIndex]?.trade_date,
      confirmation_volume_ratio: round(confirmationVolumeRatio),
      post_breakout_high_date: rows[highIndex].trade_date,
      post_breakout_high: round(rows[highIndex].high),
      advance_pct: round(advancePct),
      pullback_start_date: pivot.trade_date,
      pullback_pct: round(pullbackPct),
      pullback_volume_ratio: round(pullbackVolumeRatio),
      days_in_pullback: daysInPullback,
      completed_pullback_count: currentCompletedCycles,
      setup_score: setupScore,
      score_breakdown: parts,
      downtrend_below_ema_pct: round(belowEmaPct),
      historical_decline_pct: round(declinePct),
      ema50_slope_pct: round(emaSlopePct),
      average_volume_5: round(avg5, 0),
      average_volume_20: round(avg20, 0),
      setup_type: reacceleration ? "Reacceleration" : pullbackPass ? "Pullback" : "Sideways Consolidation",
      reason: qualifies
        ? `${pullbackPass ? "First pullback" : sidewaysPass ? "Tight consolidation" : "Reacceleration"} after a ${round(advancePct)}% post-breakout advance from ${breakout.trade_date}.`
        : "Reversal structure found, but current pullback/consolidation filters are not satisfied.",
      recent,
    };
    if (!bestSetup || row.setup_score > bestSetup.setup_score || (row.breakout_date ?? "") > (bestSetup.breakout_date ?? "")) bestSetup = row;
  }

  return bestSetup;
}

async function calculateEmaReversalPullbackScreener(filters: Partial<EmaReversalPullbackFilters> = {}) {
  const merged = { ...defaultEmaReversalPullbackFilters, ...filters };
  const db = await readDatabase();
  const members = db.universe_members.filter((member) =>
    member.is_current_constituent &&
    member.security_id &&
    (merged.universe === "ALL" || member.universe_name === merged.universe)
  );
  const pricesBySecurity = new Map<string, DailyPriceRecord[]>();
  for (const price of db.daily_prices) {
    const list = pricesBySecurity.get(price.security_id);
    if (list) list.push(price);
    else pricesBySecurity.set(price.security_id, [price]);
  }
  const rows = members.flatMap((member) => {
    const row = analyzeEmaReversalPullbackStock({
      securityId: member.security_id,
      symbol: member.symbol,
      companyName: member.company_name,
      universeName: member.universe_name,
      prices: pricesBySecurity.get(member.security_id) ?? [],
      filters: merged,
    });
    return row ? [row] : [];
  });
  const results = rows
    .filter((row) => merged.showAll || row.qualifies)
    .sort((a, b) => b.setup_score - a.setup_score || (b.breakout_date ?? "").localeCompare(a.breakout_date ?? ""));
  const statusSummary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    filters: merged,
    evaluated: rows.filter((row) => row.status !== "INSUFFICIENT_DATA").length,
    insufficient: rows.filter((row) => row.status === "INSUFFICIENT_DATA").length,
    qualified: rows.filter((row) => row.qualifies).length,
    statusSummary,
    snapshotDate: rows.map((row) => row.current_date).sort().at(-1) ?? null,
    results,
    generatedAt: new Date().toISOString(),
  };
}

export async function runEmaReversalPullbackScreener(filters: Partial<EmaReversalPullbackFilters> = {}) {
  const merged = { ...defaultEmaReversalPullbackFilters, ...filters };
  const key = JSON.stringify(merged);
  const cached = globalCache.__emaReversalPullbackCache;
  if (cached?.key === key && cached.expiresAt > Date.now()) return cached.value;
  const value = await calculateEmaReversalPullbackScreener(merged);
  globalCache.__emaReversalPullbackCache = { key, value, expiresAt: Date.now() + 60_000 };
  return value;
}

export async function getEmaReversalPullbackDetail(securityId: string) {
  const response = await runEmaReversalPullbackScreener({ showAll: true });
  return response.results.find((row) => row.security_id === securityId) ?? null;
}
