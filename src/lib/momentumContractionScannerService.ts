import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { calculateEma, calculateSma } from "./swingScreenerService";

export type MomentumContractionSetupType = "MOMENTUM_CONTRACTION" | "TRENDING_TIGHT";

export type MomentumContractionFilters = {
  universe: UniverseName | "ALL";
  setupType: MomentumContractionSetupType | "ALL";
  emaLength: number;
  emaSlopeLookback: number;
  momentumLookback: number;
  minPriorMovePct: number;
  volumeAverageLength: number;
  expansionRelativeVolume: number;
  atrLength: number;
  tightRangeAtr: number;
  lowVolumeLookback: number;
  dryVolumeRatio: number;
  contractionLookback: number;
  minAverageDailyTradedValue: number;
  maxDistanceFromEmaPct: number;
  requireRisingEma: boolean;
  minSetupScore: number;
  showAll: boolean;
  debug: boolean;
};

export type MomentumContractionRow = {
  status: MomentumContractionSetupType | "BELOW_EMA" | "NO_MOMENTUM" | "NOT_TIGHT" | "VOLUME_NOT_DRY" | "ILLIQUID";
  qualifies: boolean;
  security_id: string;
  symbol: string;
  company_name: string;
  universe_name: UniverseName;
  setupType: MomentumContractionSetupType;
  setupScore: number;
  current_date: string;
  current_close: number;
  ema50: number;
  emaSlope: number;
  distance_from_ema_pct: number;
  priorMovePct: number;
  momentumRelativeVolume: number;
  atr14: number;
  rangeCompression: number;
  currentVolume: number;
  volumeSMA20: number;
  volumeSMA50: number;
  relativeVolume: number;
  volumePercentile: number;
  lowestVolume10: boolean;
  lowestVolume20: boolean;
  avgVolume5: number;
  avgVolume20: number;
  volumeContractionRatio: number;
  trendStructure: "HIGHER_HIGH_LOW" | "RISING" | "SIDEWAYS" | "WEAK";
  averageDailyTradedValue: number;
  reason: string;
  diagnostics: Array<{ pass: boolean; label: string }>;
  recent: Array<{
    trade_date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    ema50?: number;
    volume: number;
    volume_ratio?: number;
  }>;
};

export const defaultMomentumContractionFilters: MomentumContractionFilters = {
  universe: "ALL",
  setupType: "ALL",
  emaLength: 50,
  emaSlopeLookback: 5,
  momentumLookback: 60,
  minPriorMovePct: 15,
  volumeAverageLength: 20,
  expansionRelativeVolume: 1.5,
  atrLength: 14,
  tightRangeAtr: 0.6,
  lowVolumeLookback: 20,
  dryVolumeRatio: 0.6,
  contractionLookback: 10,
  minAverageDailyTradedValue: 1_00_00_000,
  maxDistanceFromEmaPct: 25,
  requireRisingEma: true,
  minSetupScore: 55,
  showAll: false,
  debug: false,
};

type CacheValue = { key: string; expiresAt: number; value: Awaited<ReturnType<typeof calculateMomentumContractionScreener>> };
const cache = (globalThis as typeof globalThis & { __momentumContractionCache?: CacheValue }).__momentumContractionCache;
const globalCache = globalThis as typeof globalThis & { __momentumContractionCache?: CacheValue };
if (!globalCache.__momentumContractionCache && cache) globalCache.__momentumContractionCache = cache;

const pct = (value: number, base: number) => (value / Math.max(0.01, base) - 1) * 100;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function calculateAtr(rows: DailyPriceRecord[], period: number) {
  const trueRanges = rows.map((row, index) => {
    if (index === 0) return row.high - row.low;
    const previousClose = rows[index - 1].close;
    return Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose));
  });
  return calculateSma(trueRanges, period);
}

function percentileRank(values: number[], value: number) {
  if (!values.length) return 100;
  return (values.filter((item) => item <= value).length / values.length) * 100;
}

function findPriorMove(rows: DailyPriceRecord[], volumeSma: Array<number | undefined>, currentIndex: number, filters: MomentumContractionFilters) {
  const start = Math.max(filters.emaLength, currentIndex - filters.momentumLookback);
  let best = { movePct: 0, relativeVolume: 0, lowIndex: start, highIndex: start };
  for (let lowIndex = start; lowIndex <= currentIndex - 5; lowIndex += 1) {
    for (let highIndex = lowIndex + 1; highIndex <= currentIndex; highIndex += 1) {
      const movePct = pct(rows[highIndex].high, rows[lowIndex].low);
      if (movePct <= best.movePct) continue;
      const relativeVolume = Math.max(...rows.slice(lowIndex, highIndex + 1).map((row, offset) => {
        const index = lowIndex + offset;
        const volumeAvg = volumeSma[index];
        return volumeAvg ? row.volume / volumeAvg : 0;
      }));
      best = { movePct, relativeVolume, lowIndex, highIndex };
    }
  }
  return best;
}

function trendStructure(rows: DailyPriceRecord[], currentIndex: number) {
  const lookback = rows.slice(Math.max(0, currentIndex - 40), currentIndex + 1);
  if (lookback.length < 20) return "WEAK" as const;
  const half = Math.floor(lookback.length / 2);
  const early = lookback.slice(0, half);
  const late = lookback.slice(half);
  const higherHigh = Math.max(...late.map((row) => row.high)) > Math.max(...early.map((row) => row.high));
  const higherLow = Math.min(...late.map((row) => row.low)) > Math.min(...early.map((row) => row.low));
  const closeGain = pct(lookback.at(-1)!.close, lookback[0].close);
  if (higherHigh && higherLow) return "HIGHER_HIGH_LOW" as const;
  if (closeGain > 5) return "RISING" as const;
  if (Math.abs(closeGain) <= 6) return "SIDEWAYS" as const;
  return "WEAK" as const;
}

function scoreParts(input: {
  priorMovePct: number;
  momentumRelativeVolume: number;
  closeAboveEma: boolean;
  emaSlope: number;
  contractionScore: number;
  volumeDryScore: number;
  tightScore: number;
}) {
  const priorMomentum = clamp((input.priorMovePct / 25) * 20, 0, 20);
  const momentumVolume = clamp(((input.momentumRelativeVolume - 1) / 1.2) * 15, 0, 15);
  const trend = (input.closeAboveEma ? 8 : 0) + clamp((input.emaSlope / 2) * 7, 0, 7);
  return {
    priorMomentum,
    momentumVolume,
    trend,
    priceContraction: clamp(input.contractionScore, 0, 15),
    volumeContraction: clamp(input.volumeDryScore, 0, 20),
    tightCandle: clamp(input.tightScore, 0, 15),
  };
}

function analyzeStock(input: {
  securityId: string;
  symbol: string;
  companyName: string;
  universeName: UniverseName;
  prices: DailyPriceRecord[];
  filters: MomentumContractionFilters;
}): MomentumContractionRow | null {
  const rows = [...input.prices].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  if (rows.length < Math.max(90, input.filters.emaLength + input.filters.momentumLookback)) return null;
  const closes = rows.map((row) => row.close);
  const volumes = rows.map((row) => row.volume);
  const ema = calculateEma(closes, input.filters.emaLength);
  const volumeSma20 = calculateSma(volumes, 20);
  const volumeSma50 = calculateSma(volumes, 50);
  const configuredVolumeSma = calculateSma(volumes, input.filters.volumeAverageLength);
  const atr = calculateAtr(rows, input.filters.atrLength);
  const currentIndex = rows.length - 1;
  const current = rows[currentIndex];
  const currentEma = ema[currentIndex];
  const currentVolumeSma20 = volumeSma20[currentIndex];
  const currentVolumeSma50 = volumeSma50[currentIndex];
  const currentAtr = atr[currentIndex];
  if (!currentEma || !currentVolumeSma20 || !currentVolumeSma50 || !currentAtr) return null;

  const slopeBase = ema[Math.max(0, currentIndex - input.filters.emaSlopeLookback)];
  const emaSlope = slopeBase ? pct(currentEma, slopeBase) : 0;
  const distance = pct(current.close, currentEma);
  const priorMove = findPriorMove(rows, configuredVolumeSma, currentIndex, input.filters);
  const currentRange = current.high - current.low;
  const rangeCompression = currentRange / Math.max(0.01, currentAtr);
  const recentRanges = rows.slice(Math.max(0, currentIndex - input.filters.contractionLookback + 1), currentIndex + 1).map((row) => row.high - row.low);
  const previousRanges = rows.slice(Math.max(0, currentIndex - input.filters.contractionLookback - 20 + 1), currentIndex - input.filters.contractionLookback + 1).map((row) => row.high - row.low);
  const rangeContractionRatio = avg(recentRanges) / Math.max(0.01, avg(previousRanges));
  const recentVolumeWindow = volumes.slice(Math.max(0, currentIndex - input.filters.lowVolumeLookback), currentIndex);
  const volumePercentile = percentileRank(recentVolumeWindow, current.volume);
  const lowestVolume10 = current.volume <= Math.min(...volumes.slice(Math.max(0, currentIndex - 9), currentIndex + 1));
  const lowestVolume20 = current.volume <= Math.min(...volumes.slice(Math.max(0, currentIndex - 19), currentIndex + 1));
  const avgVolume5 = avg(volumes.slice(Math.max(0, currentIndex - 4), currentIndex + 1));
  const avgVolume20 = avg(volumes.slice(Math.max(0, currentIndex - 19), currentIndex + 1));
  const volumeContractionRatio = avgVolume5 / Math.max(1, avgVolume20);
  const relativeVolume = current.volume / currentVolumeSma20;
  const averageDailyTradedValue = avg(rows.slice(-20).map((row) => row.close * row.volume));
  const structure = trendStructure(rows, currentIndex);
  const bodyPctOfRange = Math.abs(current.close - current.open) / Math.max(0.01, currentRange);

  const closeAboveEma = current.close > currentEma;
  const priorMomentumPass = priorMove.movePct >= input.filters.minPriorMovePct;
  const momentumVolumePass = priorMove.relativeVolume >= input.filters.expansionRelativeVolume;
  const tightPass = rangeCompression <= input.filters.tightRangeAtr || currentRange <= avg(previousRanges) * input.filters.tightRangeAtr;
  const dryPass = relativeVolume <= input.filters.dryVolumeRatio || volumePercentile <= 20 || lowestVolume10;
  const liquidPass = averageDailyTradedValue >= input.filters.minAverageDailyTradedValue;
  const distancePass = distance <= input.filters.maxDistanceFromEmaPct;
  const risingPass = !input.filters.requireRisingEma || emaSlope > 0;
  const trending = structure === "HIGHER_HIGH_LOW" || structure === "RISING";
  const setupType: MomentumContractionSetupType = trending && rangeContractionRatio <= 0.9 ? "TRENDING_TIGHT" : "MOMENTUM_CONTRACTION";
  const contractionScore = (rangeContractionRatio <= 0.75 ? 8 : rangeContractionRatio <= 0.95 ? 5 : 2) + (distance >= -2 ? 3 : 0) + (structure !== "WEAK" ? 4 : 0);
  const volumeDryScore = (relativeVolume <= input.filters.dryVolumeRatio ? 8 : relativeVolume <= 0.8 ? 5 : 1) + (volumePercentile <= 10 ? 5 : volumePercentile <= 20 ? 3 : 0) + (lowestVolume20 ? 4 : lowestVolume10 ? 3 : 0) + (volumeContractionRatio < 0.7 ? 3 : 0);
  const tightScore = (rangeCompression <= input.filters.tightRangeAtr ? 8 : rangeCompression <= 0.8 ? 5 : 1) + (bodyPctOfRange <= 0.35 ? 4 : bodyPctOfRange <= 0.55 ? 2 : 0) + (currentRange <= avg(previousRanges) * input.filters.tightRangeAtr ? 3 : 0);
  const parts = scoreParts({ priorMovePct: priorMove.movePct, momentumRelativeVolume: priorMove.relativeVolume, closeAboveEma, emaSlope, contractionScore, volumeDryScore, tightScore });
  const setupScore = Math.round(Object.values(parts).reduce((sum, value) => sum + value, 0));

  const diagnostics = [
    { pass: liquidPass, label: `Average daily traded value ${Math.round(averageDailyTradedValue).toLocaleString("en-IN")}` },
    { pass: closeAboveEma, label: `Close ${closeAboveEma ? "above" : "below"} ${input.filters.emaLength} EMA` },
    { pass: risingPass, label: `EMA slope ${emaSlope.toFixed(2)}%` },
    { pass: priorMomentumPass, label: `Prior move ${priorMove.movePct.toFixed(1)}%` },
    { pass: momentumVolumePass, label: `Momentum RVOL ${priorMove.relativeVolume.toFixed(1)}x` },
    { pass: distancePass, label: `Distance from EMA ${distance.toFixed(1)}%` },
    { pass: tightPass, label: `Range/ATR ${rangeCompression.toFixed(2)}` },
    { pass: dryPass, label: `Volume percentile ${volumePercentile.toFixed(0)} / RVOL ${relativeVolume.toFixed(2)}x` },
    { pass: volumeContractionRatio < 0.7, label: `AvgVol5 / AvgVol20 ${volumeContractionRatio.toFixed(2)}` },
    { pass: structure !== "WEAK", label: `Trend structure ${structure}` },
  ];

  const corePass = liquidPass && closeAboveEma && risingPass && priorMomentumPass && momentumVolumePass && tightPass && dryPass && distancePass;
  let status: MomentumContractionRow["status"] = setupType;
  if (!liquidPass) status = "ILLIQUID";
  else if (!closeAboveEma || !risingPass) status = "BELOW_EMA";
  else if (!priorMomentumPass || !momentumVolumePass) status = "NO_MOMENTUM";
  else if (!tightPass) status = "NOT_TIGHT";
  else if (!dryPass) status = "VOLUME_NOT_DRY";

  const qualifies = corePass && setupScore >= input.filters.minSetupScore && (input.filters.setupType === "ALL" || input.filters.setupType === setupType);
  const recent = rows.slice(-120).map((row, index, recentRows) => {
    const originalIndex = rows.length - recentRows.length + index;
    const volAvg = volumeSma20[originalIndex];
    return {
      trade_date: row.trade_date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      ema50: ema[originalIndex],
      volume: row.volume,
      volume_ratio: volAvg ? row.volume / volAvg : undefined,
    };
  });

  return {
    status,
    qualifies,
    security_id: input.securityId,
    symbol: input.symbol,
    company_name: input.companyName,
    universe_name: input.universeName,
    setupType,
    setupScore,
    current_date: current.trade_date,
    current_close: current.close,
    ema50: currentEma,
    emaSlope,
    distance_from_ema_pct: distance,
    priorMovePct: priorMove.movePct,
    momentumRelativeVolume: priorMove.relativeVolume,
    atr14: currentAtr,
    rangeCompression,
    currentVolume: current.volume,
    volumeSMA20: currentVolumeSma20,
    volumeSMA50: currentVolumeSma50,
    relativeVolume,
    volumePercentile,
    lowestVolume10,
    lowestVolume20,
    avgVolume5,
    avgVolume20,
    volumeContractionRatio,
    trendStructure: structure,
    averageDailyTradedValue,
    reason: qualifies ? "Prior demand is confirmed, price remains above a rising 50 EMA, and recent range plus volume have contracted." : diagnostics.filter((item) => !item.pass).map((item) => item.label).join(" | "),
    diagnostics,
    recent,
  };
}

async function calculateMomentumContractionScreener(filters: Partial<MomentumContractionFilters> = {}) {
  const merged = { ...defaultMomentumContractionFilters, ...filters };
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
    return b.setupScore - a.setupScore;
  });
  const statusSummary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  return { filters: merged, evaluated: rows.length, qualified: rows.filter((row) => row.qualifies).length, statusSummary, results, generatedAt: new Date().toISOString() };
}

export async function runMomentumContractionScreener(filters: Partial<MomentumContractionFilters> = {}) {
  const merged = { ...defaultMomentumContractionFilters, ...filters };
  const key = JSON.stringify(merged);
  const cached = globalCache.__momentumContractionCache;
  if (cached?.key === key && cached.expiresAt > Date.now()) return cached.value;
  const value = await calculateMomentumContractionScreener(merged);
  globalCache.__momentumContractionCache = { key, value, expiresAt: Date.now() + 60_000 };
  return value;
}

export async function getMomentumContractionScreenerDetail(securityId: string) {
  const response = await runMomentumContractionScreener({ showAll: true, minSetupScore: 0 });
  return response.results.find((row) => row.security_id === securityId) ?? null;
}
