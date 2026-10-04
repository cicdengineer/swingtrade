import "server-only";
import type {
  DailyPriceRecord,
  SeasonalExclusionRecord,
  SeasonalObservationRecord,
  SeasonalStatisticsRecord,
  SeasonalWindow,
  UniverseName,
} from "./types";
import { readDatabase, writeDatabase } from "./localDatabase";

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const seasonalWindows: SeasonalWindow[] = monthNames.map((name, startMonth) => {
  const endMonth = (startMonth + 2) % 12;
  return { key: `${name}-${monthNames[endMonth]}`, label: `${name} → ${monthNames[endMonth]}`, startMonth, endMonth };
});

export type ScannerFilters = {
  minAverage: { enabled: boolean; value: number };
  minMedian: { enabled: boolean; value: number };
  minWinRate: { enabled: boolean; value: number };
  minN: { enabled: boolean; value: number };
  maxAvgMedianGap: { enabled: boolean; value: number };
  minMaeP75: { enabled: boolean; value: number };
  minWorstReturn: { enabled: boolean; value: number };
};

export type CurrentSeasonPerformance = {
  status: "COMPLETED" | "IN_PROGRESS" | "NO_DATA";
  entry_date?: string;
  entry_price?: number;
  current_date?: string;
  current_price?: number;
  current_return_pct?: number;
  current_mae_pct?: number;
  current_mfe_pct?: number;
};

export type WalkForwardScannerRow = SeasonalStatisticsRecord & {
  evaluation: ReturnType<typeof evaluateScannerRow>;
  currentSeason: CurrentSeasonPerformance;
  current_vs_historical_median?: number;
  portfolio_contribution_pct?: number;
};

export const defaultScannerFilters: ScannerFilters = {
  minAverage: { enabled: true, value: 10 },
  minMedian: { enabled: true, value: 7 },
  minWinRate: { enabled: true, value: 60 },
  minN: { enabled: true, value: 5 },
  maxAvgMedianGap: { enabled: true, value: 5 },
  minMaeP75: { enabled: true, value: -10 },
  minWorstReturn: { enabled: true, value: -15 },
};

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

export function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

export function median(values: number[]) {
  return percentile(values, 0.5);
}

export function standardDeviation(values: number[]) {
  const avg = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length || 1));
}

function monthRange(year: number, startMonth: number, lengthMonths = 3) {
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + lengthMonths, 1));
  return { startDate: start.toISOString().slice(0, 10), endExclusive: end.toISOString().slice(0, 10) };
}

function rangeForWindow(year: number, startMonth: number) {
  return monthRange(year, startMonth, 3);
}

function addExclusion(securityId: string, symbol: string, windowKey: string, year: number, issue: string): SeasonalExclusionRecord {
  return { id: `${securityId}-${windowKey}-${year}-${issue.replace(/\W+/g, "-")}`, security_id: securityId, symbol, window_key: windowKey, occurrence_year: year, issue };
}

export function buildObservationsForStock(input: {
  securityId: string;
  symbol: string;
  companyName: string;
  sector: string;
  universeName: UniverseName;
  prices: DailyPriceRecord[];
}) {
  const prices = [...input.prices].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const years = [...new Set(prices.map((price) => Number(price.trade_date.slice(0, 4))))].sort((a, b) => a - b);
  const observations: SeasonalObservationRecord[] = [];
  const exclusions: SeasonalExclusionRecord[] = [];

  for (const window of seasonalWindows) {
    for (const year of years) {
      const range = monthRange(year, window.startMonth);
      const slice = prices.filter((price) => price.trade_date >= range.startDate && price.trade_date < range.endExclusive);
      if (slice.length < 2) {
        exclusions.push(addExclusion(input.securityId, input.symbol, window.key, year, "Insufficient daily data inside window"));
        continue;
      }
      const entry = slice[0];
      const exit = slice.at(-1)!;
      if (entry.trade_date > exit.trade_date) {
        exclusions.push(addExclusion(input.securityId, input.symbol, window.key, year, "Dates are not ordered"));
        continue;
      }
      if (![entry.close, exit.close, ...slice.flatMap((price) => [price.low, price.high])].every((value) => Number.isFinite(value) && value > 0)) {
        exclusions.push(addExclusion(input.securityId, input.symbol, window.key, year, "Missing or invalid positive prices"));
        continue;
      }
      const lowestLow = Math.min(...slice.map((price) => price.low));
      const highestHigh = Math.max(...slice.map((price) => price.high));
      observations.push({
        id: `${input.securityId}-${window.key}-${year}`,
        security_id: input.securityId,
        symbol: input.symbol,
        company_name: input.companyName,
        sector: input.sector,
        universe_name: input.universeName,
        window_key: window.key,
        window_start_month: window.startMonth,
        window_end_month: window.endMonth,
        occurrence_year: year,
        entry_date: entry.trade_date,
        entry_price: entry.close,
        exit_date: exit.trade_date,
        exit_price: exit.close,
        return_pct: (exit.close / entry.close - 1) * 100,
        mae_pct: (lowestLow / entry.close - 1) * 100,
        mfe_pct: (highestHigh / entry.close - 1) * 100,
      });
    }
  }

  return { observations, exclusions };
}

export function summariseSeasonalStatistics(observations: SeasonalObservationRecord[]): SeasonalStatisticsRecord | null {
  if (!observations.length) return null;
  const first = observations[0];
  const returns = observations.map((row) => row.return_pct);
  const maes = observations.map((row) => row.mae_pct);
  const mfes = observations.map((row) => row.mfe_pct);
  const avg = average(returns);
  const med = median(returns);
  const positiveReturns = returns.filter((value) => value > 0);
  const positiveSum = positiveReturns.reduce((sum, value) => sum + value, 0);
  return {
    id: `${first.security_id}-${first.window_key}`,
    security_id: first.security_id,
    symbol: first.symbol,
    company_name: first.company_name,
    sector: first.sector,
    universe_name: first.universe_name,
    window_key: first.window_key,
    window_start_month: first.window_start_month,
    window_end_month: first.window_end_month,
    avg_return: avg,
    median_return: med,
    historical_win_rate: positiveReturns.length / observations.length * 100,
    best_return: Math.max(...returns),
    worst_return: Math.min(...returns),
    std_dev: standardDeviation(returns),
    observation_count: observations.length,
    avg_median_gap: Math.max(avg - med, 0),
    positive_years: positiveReturns.length,
    negative_years: returns.filter((value) => value < 0).length,
    mae_p25: percentile(maes, 0.25),
    mae_p50: percentile(maes, 0.5),
    mae_p75: percentile(maes, 0.75),
    mae_p90: percentile(maes, 0.9),
    worst_mae: Math.min(...maes),
    mfe_p25: percentile(mfes, 0.25),
    mfe_p50: percentile(mfes, 0.5),
    mfe_p75: percentile(mfes, 0.75),
    mfe_p90: percentile(mfes, 0.9),
    best_mfe: Math.max(...mfes),
    positive_return_concentration: positiveSum > 0 ? Math.max(...positiveReturns) / positiveSum * 100 : 0,
    data_start_date: observations.map((row) => row.entry_date).sort().at(0)!,
    data_end_date: observations.map((row) => row.exit_date).sort().at(-1)!,
  };
}

export function calculateCurrentSeasonPerformance(prices: DailyPriceRecord[], window: SeasonalWindow, evaluationYear: number): CurrentSeasonPerformance {
  const sorted = [...prices].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const range = rangeForWindow(evaluationYear, window.startMonth);
  const slice = sorted.filter((price) => price.trade_date >= range.startDate && price.trade_date < range.endExclusive);
  if (slice.length < 1) return { status: "NO_DATA" };
  const entry = slice[0];
  const current = slice.at(-1)!;
  if (![entry.close, current.close, ...slice.flatMap((price) => [price.low, price.high])].every((value) => Number.isFinite(value) && value > 0)) return { status: "NO_DATA" };
  const allDates = sorted.map((price) => price.trade_date);
  const latestAvailableDate = allDates.at(-1) ?? current.trade_date;
  const lowestLow = Math.min(...slice.map((price) => price.low));
  const highestHigh = Math.max(...slice.map((price) => price.high));
  return {
    status: latestAvailableDate >= range.endExclusive ? "COMPLETED" : "IN_PROGRESS",
    entry_date: entry.trade_date,
    entry_price: entry.close,
    current_date: current.trade_date,
    current_price: current.close,
    current_return_pct: (current.close / entry.close - 1) * 100,
    current_mae_pct: (lowestLow / entry.close - 1) * 100,
    current_mfe_pct: (highestHigh / entry.close - 1) * 100,
  };
}

function latestBySymbolUniverse(stats: SeasonalStatisticsRecord[]) {
  const deduped = new Map<string, SeasonalStatisticsRecord>();
  for (const row of stats) deduped.set(`${row.security_id}:${row.window_key}`, row);
  return [...deduped.values()];
}

export async function rebuildSeasonalityStatistics() {
  const started = new Date().toISOString();
  try {
    const db = await readDatabase();
    const activeMembers = db.universe_members.filter((member) => member.is_current_constituent && member.security_id);
    const observations: SeasonalObservationRecord[] = [];
    const exclusions: SeasonalExclusionRecord[] = [];
    const stats: SeasonalStatisticsRecord[] = [];

    for (const member of activeMembers) {
      const prices = db.daily_prices.filter((price) => price.security_id === member.security_id);
      const instrument = db.instruments.find((row) => row.security_id === member.security_id);
      const sector = "Unknown";
      const built = buildObservationsForStock({
        securityId: member.security_id,
        symbol: member.symbol,
        companyName: member.company_name || instrument?.company_name || member.symbol,
        sector,
        universeName: member.universe_name,
        prices,
      });
      observations.push(...built.observations);
      exclusions.push(...built.exclusions);
      const grouped = new Map<string, SeasonalObservationRecord[]>();
      for (const observation of built.observations) grouped.set(observation.window_key, [...(grouped.get(observation.window_key) ?? []), observation]);
      for (const rows of grouped.values()) {
        const summary = summariseSeasonalStatistics(rows);
        if (summary) stats.push(summary);
      }
    }

    db.seasonal_observations = observations;
    db.seasonal_statistics = latestBySymbolUniverse(stats);
    db.seasonal_exclusions = exclusions;
    const build = {
      id: `seasonality-${Date.now()}`,
      status: "completed" as const,
      started_at: started,
      finished_at: new Date().toISOString(),
      stocks_analyzed: activeMembers.length,
      observations_generated: observations.length,
      statistics_generated: db.seasonal_statistics.length,
      stocks_missing_sector: activeMembers.length,
      excluded_observations: exclusions.length,
    };
    db.seasonality_builds.unshift(build);
    await writeDatabase(db);
    return build;
  } catch (error) {
    const db = await readDatabase();
    const build = {
      id: `seasonality-${Date.now()}`,
      status: "failed" as const,
      started_at: started,
      finished_at: new Date().toISOString(),
      stocks_analyzed: 0,
      observations_generated: 0,
      statistics_generated: 0,
      stocks_missing_sector: 0,
      excluded_observations: 0,
      error: error instanceof Error ? error.message : "Unknown rebuild failure",
    };
    db.seasonality_builds.unshift(build);
    await writeDatabase(db);
    return build;
  }
}

export async function getSeasonalityDataset() {
  const db = await readDatabase();
  return {
    windows: seasonalWindows,
    statistics: db.seasonal_statistics,
    observations: db.seasonal_observations,
    exclusions: db.seasonal_exclusions,
    latestBuild: db.seasonality_builds[0] ?? null,
    sectors: [...new Set(db.seasonal_statistics.map((row) => row.sector || "Unknown"))].sort(),
    missingSectorCount: new Set(db.seasonal_statistics.filter((row) => row.sector === "Unknown").map((row) => row.security_id)).size,
  };
}

export function evaluateScannerRow(row: SeasonalStatisticsRecord, filters: ScannerFilters) {
  const checks = [
    { key: "Average", actual: row.avg_return, pass: !filters.minAverage.enabled || row.avg_return >= filters.minAverage.value, rule: `>= ${filters.minAverage.value}%` },
    { key: "Median", actual: row.median_return, pass: !filters.minMedian.enabled || row.median_return >= filters.minMedian.value, rule: `>= ${filters.minMedian.value}%` },
    { key: "Historical Win Rate", actual: row.historical_win_rate, pass: !filters.minWinRate.enabled || row.historical_win_rate >= filters.minWinRate.value, rule: `>= ${filters.minWinRate.value}%` },
    { key: "N", actual: row.observation_count, pass: !filters.minN.enabled || row.observation_count >= filters.minN.value, rule: `>= ${filters.minN.value}` },
    { key: "Avg-Median Gap", actual: row.avg_median_gap, pass: !filters.maxAvgMedianGap.enabled || row.avg_median_gap <= filters.maxAvgMedianGap.value, rule: `<= ${filters.maxAvgMedianGap.value} pts` },
    { key: "MAE P75", actual: row.mae_p75, pass: !filters.minMaeP75.enabled || row.mae_p75 >= filters.minMaeP75.value, rule: `>= ${filters.minMaeP75.value}%` },
    { key: "Worst Return", actual: row.worst_return, pass: !filters.minWorstReturn.enabled || row.worst_return >= filters.minWorstReturn.value, rule: `>= ${filters.minWorstReturn.value}%` },
  ];
  return { eligible: checks.every((check) => check.pass), checks };
}

export async function runWalkForwardScanner(input: {
  windowKey: string;
  universe?: UniverseName | "ALL";
  sector?: string;
  evaluationYear: number;
  allocationPerStock: number;
  filters: ScannerFilters;
}) {
  const db = await readDatabase();
  const window = seasonalWindows.find((item) => item.key === input.windowKey) ?? seasonalWindows[0];
  const members = db.universe_members.filter((member) => member.is_current_constituent && member.security_id);
  const evaluated: WalkForwardScannerRow[] = [];

  for (const member of members) {
    if (input.universe && input.universe !== "ALL" && member.universe_name !== input.universe) continue;
    const observations = db.seasonal_observations.filter((row) =>
      row.security_id === member.security_id &&
      row.window_key === window.key &&
      row.occurrence_year < input.evaluationYear
    );
    const stats = summariseSeasonalStatistics(observations);
    if (!stats) continue;
    if (input.sector && input.sector !== "ALL" && stats.sector !== input.sector) continue;
    const evaluation = evaluateScannerRow(stats, input.filters);
    const currentSeason = calculateCurrentSeasonPerformance(
      db.daily_prices.filter((price) => price.security_id === member.security_id),
      window,
      input.evaluationYear,
    );
    evaluated.push({
      ...stats,
      evaluation,
      currentSeason,
      current_vs_historical_median: currentSeason.current_return_pct === undefined ? undefined : currentSeason.current_return_pct - stats.median_return,
    });
  }

  const results = evaluated.filter((row) => row.evaluation.eligible).sort((a, b) => b.avg_return - a.avg_return);
  const valid = results.filter((row) => row.currentSeason.current_return_pct !== undefined);
  const validReturns = valid.map((row) => row.currentSeason.current_return_pct!);
  const winners = validReturns.filter((value) => value > 0).length;
  const losers = validReturns.filter((value) => value < 0).length;
  const flats = validReturns.filter((value) => value === 0).length;
  const equalWeightReturn = average(validReturns);
  const weightedResults = results.map((row) => ({
    ...row,
    portfolio_contribution_pct: row.currentSeason.current_return_pct === undefined || !valid.length ? undefined : row.currentSeason.current_return_pct / valid.length,
  }));
  const contributions = weightedResults
    .map((row) => row.portfolio_contribution_pct ?? 0)
    .filter((value) => value > 0)
    .sort((a, b) => b - a);
  const initialInvestment = valid.length * input.allocationPerStock;
  const currentValue = initialInvestment * (1 + equalWeightReturn / 100);
  const distribution = {
    gt20: validReturns.filter((value) => value > 20).length,
    plus10To20: validReturns.filter((value) => value > 10 && value <= 20).length,
    zeroTo10: validReturns.filter((value) => value >= 0 && value <= 10).length,
    minus10To0: validReturns.filter((value) => value >= -10 && value < 0).length,
    ltMinus10: validReturns.filter((value) => value < -10).length,
  };
  const sectorSummary = weightedResults.reduce<Record<string, number>>((acc, row) => {
    acc[row.sector] = (acc[row.sector] ?? 0) + 1;
    return acc;
  }, {});

  return {
    windows: seasonalWindows,
    filters: input.filters,
    results: weightedResults,
    evaluated,
    sectorSummary,
    missingSectorCount: new Set(evaluated.filter((row) => row.sector === "Unknown").map((row) => row.security_id)).size,
    evaluationYear: input.evaluationYear,
    allocationPerStock: input.allocationPerStock,
    summary: {
      qualifiedStocks: results.length,
      evaluatedStocks: evaluated.length,
      maxHistoricalObservationCount: evaluated.length ? Math.max(...evaluated.map((row) => row.observation_count)) : 0,
      minHistoricalObservationRequired: input.filters.minN.enabled ? input.filters.minN.value : 0,
      validCurrentSeasonData: valid.length,
      missingCurrentSeasonData: results.length - valid.length,
      winners,
      losers,
      flats,
      currentWinRate: valid.length ? winners / valid.length * 100 : 0,
      equalWeightReturn,
      averageStockReturn: average(validReturns),
      medianStockReturn: percentile(validReturns, 0.5),
      bestCurrentReturn: validReturns.length ? Math.max(...validReturns) : 0,
      worstCurrentReturn: validReturns.length ? Math.min(...validReturns) : 0,
      initialInvestment,
      currentPortfolioValue: currentValue,
      currentPnl: currentValue - initialInvestment,
      historicalAverage: average(results.map((row) => row.avg_return)),
      historicalMedian: average(results.map((row) => row.median_return)),
      top1Contribution: contributions[0] ?? 0,
      top3Contribution: contributions.slice(0, 3).reduce((sum, value) => sum + value, 0),
      distribution,
    },
  };
}
