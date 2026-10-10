import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { calculateEma, calculateSma } from "./swingScreenerService";

export type EmaConsolidationFilters = {
  universe: UniverseName | "ALL";
  emaLength: number;
  lookbackDays: number;
  priorMoveLookbackDays: number;
  minPriorMovePct: number;
  consolidationDays: number;
  minConsolidationDays: number;
  maxRangePct: number;
  maxDistanceFromEmaPct: number;
  maxEmaToRangeMidPct: number;
  minAboveEmaDaysPct: number;
  minAverageDailyTradedValue: number;
  requireRisingEma: boolean;
  showAll: boolean;
};

export type EmaConsolidationRow = {
  status: "SETUP" | "WATCHLIST" | "NO_PRIOR_MOVE" | "BELOW_20EMA" | "TOO_WIDE" | "EMA_NOT_READY" | "ILLIQUID";
  qualifies: boolean;
  security_id: string;
  symbol: string;
  company_name: string;
  universe_name: UniverseName;
  current_date: string;
  current_close: number;
  ema20: number;
  ema50: number;
  distance_from_20ema_pct: number;
  ema20_slope_pct: number;
  prior_move_pct: number;
  prior_low_date?: string;
  prior_low_close?: number;
  consolidation_start_date: string;
  consolidation_end_date: string;
  consolidation_days: number;
  range_high: number;
  range_low: number;
  range_pct: number;
  breakout_distance_pct: number;
  ema_to_range_mid_pct: number;
  above_ema_days_pct: number;
  current_volume_ratio?: number;
  averageDailyTradedValue: number;
  setup_score: number;
  reason: string;
  recent: Array<DailyPriceRecord & { ema20?: number; ema50?: number; volume_ratio?: number }>;
};

export const defaultEmaConsolidationFilters: EmaConsolidationFilters = {
  universe: "ALL",
  emaLength: 20,
  lookbackDays: 126,
  priorMoveLookbackDays: 70,
  minPriorMovePct: 18,
  consolidationDays: 18,
  minConsolidationDays: 8,
  maxRangePct: 14,
  maxDistanceFromEmaPct: 8,
  maxEmaToRangeMidPct: 7,
  minAboveEmaDaysPct: 65,
  minAverageDailyTradedValue: 0,
  requireRisingEma: true,
  showAll: false,
};

type CacheValue = { key: string; expiresAt: number; value: Awaited<ReturnType<typeof calculateEmaConsolidationScreener>> };
const globalCache = globalThis as typeof globalThis & { __emaConsolidationCache?: CacheValue };

const pct = (value: number, base: number) => (value / Math.max(0.01, base) - 1) * 100;
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function analyzeStock(input: {
  securityId: string;
  symbol: string;
  companyName: string;
  universeName: UniverseName;
  prices: DailyPriceRecord[];
  filters: EmaConsolidationFilters;
}): EmaConsolidationRow | null {
  const rows = [...input.prices].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const minRows = Math.max(input.filters.emaLength + input.filters.lookbackDays, input.filters.priorMoveLookbackDays + input.filters.consolidationDays + 10);
  if (rows.length < Math.min(minRows, 80)) return null;

  const currentIndex = rows.length - 1;
  const current = rows[currentIndex];
  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume);
  const ema20 = calculateEma(closes, input.filters.emaLength);
  const ema50 = calculateEma(closes, 50);
  const volumeSma20 = calculateSma(volumes, 20);
  const currentEma20 = ema20[currentIndex];
  const currentEma50 = ema50[currentIndex];
  const currentVolumeAverage = volumeSma20[currentIndex];
  if (!currentEma20 || !currentEma50) return null;

  const consolidationDays = Math.max(input.filters.minConsolidationDays, input.filters.consolidationDays);
  const baseStartIndex = Math.max(input.filters.emaLength, currentIndex - consolidationDays + 1);
  const baseRows = rows.slice(baseStartIndex, currentIndex + 1);
  if (baseRows.length < input.filters.minConsolidationDays) return null;

  const rangeHigh = Math.max(...baseRows.map((row) => row.high));
  const rangeLow = Math.min(...baseRows.map((row) => row.low));
  const rangeMid = (rangeHigh + rangeLow) / 2;
  const rangePct = pct(rangeHigh, rangeLow);
  const breakoutDistance = pct(current.close, rangeHigh);
  const distanceFromEma = pct(current.close, currentEma20);
  const emaToRangeMidPct = Math.abs(pct(currentEma20, rangeMid));
  const aboveEmaDaysPct = baseRows.filter((_, offset) => {
    const ema = ema20[baseStartIndex + offset];
    return ema !== undefined && baseRows[offset].close >= ema;
  }).length / baseRows.length * 100;
  const slopeBaseIndex = Math.max(0, currentIndex - 8);
  const emaSlope = ema20[slopeBaseIndex] ? pct(currentEma20, ema20[slopeBaseIndex]!) : 0;

  const impulseStart = Math.max(input.filters.emaLength, baseStartIndex - input.filters.priorMoveLookbackDays);
  const impulseRows = rows.slice(impulseStart, baseStartIndex + 1);
  const priorLow = impulseRows.reduce<{ row: DailyPriceRecord; index: number } | undefined>((lowest, row, offset) => {
    const originalIndex = impulseStart + offset;
    if (!lowest || row.close < lowest.row.close) return { row, index: originalIndex };
    return lowest;
  }, undefined);
  const priorMovePct = priorLow ? pct(rangeHigh, priorLow.row.close) : 0;
  const averageDailyTradedValue = avg(rows.slice(-20).map((row) => row.close * row.volume));
  const currentVolumeRatio = currentVolumeAverage ? current.volume / currentVolumeAverage : undefined;

  const checks = {
    liquid: averageDailyTradedValue >= input.filters.minAverageDailyTradedValue,
    priorMove: priorMovePct >= input.filters.minPriorMovePct,
    aboveEma: current.close >= currentEma20 && aboveEmaDaysPct >= input.filters.minAboveEmaDaysPct,
    tight: rangePct <= input.filters.maxRangePct,
    emaReady: Math.abs(distanceFromEma) <= input.filters.maxDistanceFromEmaPct && emaToRangeMidPct <= input.filters.maxEmaToRangeMidPct,
    rising: !input.filters.requireRisingEma || emaSlope > 0,
  };

  let status: EmaConsolidationRow["status"] = "WATCHLIST";
  const reasons: string[] = [];
  if (!checks.liquid) {
    status = "ILLIQUID";
    reasons.push("Average traded value is below the selected threshold.");
  }
  if (!checks.priorMove) {
    status = "NO_PRIOR_MOVE";
    reasons.push(`Prior advance into the base is below ${input.filters.minPriorMovePct}%.`);
  }
  if (!checks.aboveEma) {
    status = "BELOW_20EMA";
    reasons.push("Price has not held above the 20 EMA for enough of the base.");
  }
  if (!checks.tight) {
    status = "TOO_WIDE";
    reasons.push(`Consolidation range is wider than ${input.filters.maxRangePct}%.`);
  }
  if (!checks.emaReady || !checks.rising) {
    status = "EMA_NOT_READY";
    if (!checks.emaReady) reasons.push("20 EMA has not caught up close enough to price/range.");
    if (!checks.rising) reasons.push("20 EMA is not rising.");
  }

  const qualifies = Object.values(checks).every(Boolean);
  if (qualifies) status = "SETUP";
  const setupScore = Math.round(
    Math.min(35, priorMovePct) +
    Math.max(0, 25 - rangePct) +
    Math.max(0, 20 - Math.abs(distanceFromEma) * 2) +
    Math.max(0, 15 - emaToRangeMidPct * 1.5) +
    Math.max(0, aboveEmaDaysPct - 60) * 0.2 +
    (emaSlope > 0 ? 8 : 0)
  );

  const recent = rows.slice(-126).map((row, index, recentRows) => {
    const originalIndex = rows.length - recentRows.length + index;
    const volumeAverage = volumeSma20[originalIndex];
    return {
      ...row,
      ema20: ema20[originalIndex],
      ema50: ema50[originalIndex],
      volume_ratio: volumeAverage ? row.volume / volumeAverage : undefined,
    };
  });

  return {
    status,
    qualifies,
    security_id: input.securityId,
    symbol: input.symbol,
    company_name: input.companyName,
    universe_name: input.universeName,
    current_date: current.trade_date,
    current_close: current.close,
    ema20: currentEma20,
    ema50: currentEma50,
    distance_from_20ema_pct: distanceFromEma,
    ema20_slope_pct: emaSlope,
    prior_move_pct: priorMovePct,
    prior_low_date: priorLow?.row.trade_date,
    prior_low_close: priorLow?.row.close,
    consolidation_start_date: baseRows[0].trade_date,
    consolidation_end_date: current.trade_date,
    consolidation_days: baseRows.length,
    range_high: rangeHigh,
    range_low: rangeLow,
    range_pct: rangePct,
    breakout_distance_pct: breakoutDistance,
    ema_to_range_mid_pct: emaToRangeMidPct,
    above_ema_days_pct: aboveEmaDaysPct,
    current_volume_ratio: currentVolumeRatio,
    averageDailyTradedValue,
    setup_score: setupScore,
    reason: qualifies
      ? `${baseRows.length}-session tight base above the 20 EMA after a ${priorMovePct.toFixed(1)}% advance; the 20 EMA is close to price.`
      : reasons.join(" "),
    recent,
  };
}

async function calculateEmaConsolidationScreener(filters: Partial<EmaConsolidationFilters> = {}) {
  const merged = { ...defaultEmaConsolidationFilters, ...filters };
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
    const row = analyzeStock({
      securityId: member.security_id,
      symbol: member.symbol,
      companyName: member.company_name,
      universeName: member.universe_name,
      prices: pricesBySecurity.get(member.security_id) ?? [],
      filters: merged,
    });
    return row ? [row] : [];
  });
  const results = rows.filter((row) => merged.showAll || row.qualifies).sort((a, b) => {
    if (a.qualifies !== b.qualifies) return Number(b.qualifies) - Number(a.qualifies);
    if (a.setup_score !== b.setup_score) return b.setup_score - a.setup_score;
    return Math.abs(a.breakout_distance_pct) - Math.abs(b.breakout_distance_pct);
  });
  const statusSummary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  return { filters: merged, evaluated: rows.length, qualified: rows.filter((row) => row.qualifies).length, statusSummary, results, generatedAt: new Date().toISOString() };
}

export async function runEmaConsolidationScreener(filters: Partial<EmaConsolidationFilters> = {}) {
  const merged = { ...defaultEmaConsolidationFilters, ...filters };
  const key = JSON.stringify(merged);
  const cached = globalCache.__emaConsolidationCache;
  if (cached?.key === key && cached.expiresAt > Date.now()) return cached.value;
  const value = await calculateEmaConsolidationScreener(merged);
  globalCache.__emaConsolidationCache = { key, value, expiresAt: Date.now() + 60_000 };
  return value;
}

export async function getEmaConsolidationScreenerDetail(securityId: string) {
  const response = await runEmaConsolidationScreener({ showAll: true });
  return response.results.find((row) => row.security_id === securityId) ?? null;
}
