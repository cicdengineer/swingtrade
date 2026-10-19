import "server-only";
import { readDailyPricesForWatchlist, readSeasonalWatchlistBuildInputs, readSeasonalWatchlistSnapshot, writeSeasonalWatchlistSnapshots } from "./localDatabase";
import { seasonalWindows, summariseSeasonalStatistics } from "./seasonalityEngine";
import { analyzeStock, defaultThirtyInThirtyFilters, type ThirtyInThirtyFilters, type ThirtyInThirtyRow } from "./thirtyInThirtyScreenerService";

export type SeasonalStockRow = ThirtyInThirtyRow & {
  seasonal_avg_return: number;
  seasonal_observations: number;
  seasonal_window: string;
};

export type SeasonalWatchlistSnapshot = {
  universe: "CNX500";
  month: number;
  window: (typeof seasonalWindows)[number];
  evaluated: number;
  qualified: number;
  results: SeasonalStockRow[];
  generatedAt: string;
};

const globalBuild = globalThis as typeof globalThis & { __seasonalWatchlistBuild?: Promise<SeasonalWatchlistSnapshot[]> };

function indiaToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function getSeasonalStocks(month: number) {
  const selectedMonth = Number.isInteger(month) && month >= 0 && month < 12 ? month : new Date().getMonth();
  const stored = await readSeasonalWatchlistSnapshot<SeasonalWatchlistSnapshot>(selectedMonth);
  return stored?.universe === "CNX500" ? stored : {
    month: selectedMonth,
    window: seasonalWindows[selectedMonth],
    evaluated: 0,
    qualified: 0,
    results: [],
    generatedAt: "",
    needsBuild: true,
  };
}

async function calculateAndStoreWatchlists() {
  const { members, observations } = await readSeasonalWatchlistBuildInputs();
  if (!observations.length) throw new Error("Seasonality statistics are empty. Rebuild Seasonality Statistics first, then build the watchlists.");
  const completedThrough = indiaToday();
  const analysisFilters: ThirtyInThirtyFilters = { ...defaultThirtyInThirtyFilters, minReturnPct: -Infinity };
  const results = seasonalWindows.map(() => [] as SeasonalStockRow[]);
  const activeMembers = new Map(members.filter((member) => member.is_current_constituent && member.security_id).map((member) => [member.security_id, member]));
  const groupedBySecurity = new Map<string, typeof observations>();
  const seenObservations = new Set<string>();
  for (const observation of observations) {
    if (!activeMembers.has(observation.security_id)) continue;
    const window = seasonalWindows[observation.window_start_month];
    if (!window || observation.window_key !== window.key) continue;
    const endExclusive = new Date(Date.UTC(observation.occurrence_year, window.startMonth + 3, 1)).toISOString().slice(0, 10);
    if (endExclusive > completedThrough) continue;
    if (Number(observation.entry_date.slice(5, 7)) !== window.startMonth + 1 || Number(observation.exit_date.slice(5, 7)) !== window.endMonth + 1) continue;
    const observationKey = `${observation.security_id}:${observation.window_key}:${observation.occurrence_year}`;
    if (seenObservations.has(observationKey)) continue;
    seenObservations.add(observationKey);
    const group = groupedBySecurity.get(observation.security_id) ?? [];
    group.push(observation);
    groupedBySecurity.set(observation.security_id, group);
  }
  const candidates = new Map<string, NonNullable<ReturnType<typeof summariseSeasonalStatistics>>[]>();
  for (const [securityId, stockObservations] of groupedBySecurity) {
    const byWindow = new Map<string, typeof stockObservations>();
    for (const observation of stockObservations) {
      const group = byWindow.get(observation.window_key) ?? [];
      group.push(observation);
      byWindow.set(observation.window_key, group);
    }
    const qualified = [...byWindow.values()]
      .map((group) => summariseSeasonalStatistics(group))
      .filter((stats): stats is NonNullable<typeof stats> => stats !== null && stats.avg_return > 30);
    if (!qualified.length) continue;
    candidates.set(securityId, qualified);
  }
  const candidateIds = [...candidates.keys()];
  for (let offset = 0; offset < candidateIds.length; offset += 25) {
    const batch = candidateIds.slice(offset, offset + 25);
    const prices = await readDailyPricesForWatchlist(batch);
    const pricesBySecurity = new Map<string, typeof prices>();
    for (const price of prices) {
      const stockPrices = pricesBySecurity.get(price.security_id) ?? [];
      stockPrices.push(price);
      pricesBySecurity.set(price.security_id, stockPrices);
    }
    for (const securityId of batch) {
      const member = activeMembers.get(securityId)!;
      const technical = analyzeStock({
        securityId,
        symbol: member.symbol,
        companyName: member.company_name,
        universeName: member.universe_name,
        prices: pricesBySecurity.get(securityId) ?? [],
        filters: analysisFilters,
      });
      if (!technical) continue;
      for (const stats of candidates.get(securityId) ?? []) {
        const window = seasonalWindows[stats.window_start_month];
        results[window.startMonth].push({
          ...technical,
          status: "ELIGIBLE",
          qualifies: true,
          reason: `${window.label}: ${stats.avg_return.toFixed(1)}% average return across ${stats.observation_count} completed historical windows.`,
          seasonal_avg_return: stats.avg_return,
          seasonal_observations: stats.observation_count,
          seasonal_window: window.label,
        });
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const snapshots: SeasonalWatchlistSnapshot[] = seasonalWindows.map((window, month) => {
    const rows = results[month].sort((a, b) => b.seasonal_avg_return - a.seasonal_avg_return);
    return { universe: "CNX500", month, window, evaluated: activeMembers.size, qualified: rows.length, results: rows, generatedAt };
  });
  await writeSeasonalWatchlistSnapshots(snapshots.map((value) => ({ month: value.month, value })));
  return snapshots;
}

export function rebuildSeasonalStocks() {
  if (!globalBuild.__seasonalWatchlistBuild) {
    const build = calculateAndStoreWatchlists();
    globalBuild.__seasonalWatchlistBuild = build;
    void build.finally(() => { if (globalBuild.__seasonalWatchlistBuild === build) globalBuild.__seasonalWatchlistBuild = undefined; }).catch(() => {});
  }
  return globalBuild.__seasonalWatchlistBuild;
}
