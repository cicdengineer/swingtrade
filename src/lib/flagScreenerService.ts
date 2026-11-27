import "server-only";
import { readDatabase } from "./localDatabase";
import { emaSeries } from "./emaNoTouchLogic";
import { findBullishPennant, flagDefaults, type FlagCandle, type FlagFilters, type FlagResponse, type FlagRow } from "./flagScreenerLogic";

export async function runFlagScreener(input: Partial<FlagFilters> = {}): Promise<FlagResponse> {
  const clamp = (key: Exclude<keyof FlagFilters, "universe">, min: number, max: number) => {
    const value = input[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : flagDefaults[key];
  };
  const minBaseDays = Math.trunc(clamp("minBaseDays", 5, 30));
  const filters: FlagFilters = {
    universe: input.universe === "ALL" || input.universe === "NIFTYSC500" ? input.universe : flagDefaults.universe,
    poleDays: Math.trunc(clamp("poleDays", 3, 30)),
    minPriorAdvancePct: clamp("minPriorAdvancePct", 1, 100),
    minBaseDays,
    maxBaseDays: Math.max(minBaseDays, Math.trunc(clamp("maxBaseDays", 5, 40))),
    maxRetracementPct: clamp("maxRetracementPct", 5, 90),
    minContractionPct: clamp("minContractionPct", 5, 90),
    maxBaseVolumeRatio: clamp("maxBaseVolumeRatio", 0.1, 5),
    minBreakoutVolumeRatio: clamp("minBreakoutVolumeRatio", 0, 10),
    minAverageDailyTradedValue: clamp("minAverageDailyTradedValue", 0, Number.MAX_SAFE_INTEGER),
  };
  const db = await readDatabase();
  const members = new Map(db.universe_members.filter(member =>
    member.is_current_constituent && member.security_id &&
    (filters.universe === "ALL" || member.universe_name === filters.universe)
  ).map(member => [member.security_id, member]));
  const histories = new Map<string, FlagCandle[]>();
  for (const { security_id, is_provisional, trade_date, open, high, low, close, volume } of db.daily_prices) {
    if (is_provisional || !members.has(security_id) || low <= 0 || close <= 0) continue;
    const row = { trade_date, open, high, low, close, volume };
    const history = histories.get(security_id);
    if (history) history.push(row);
    else histories.set(security_id, [row]);
  }
  const results: FlagRow[] = [];
  for (const [security_id, member] of members) {
    const history = histories.get(security_id);
    if (!history?.length) continue;
    history.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    const liquidityRows = history.slice(-20);
    const tradedValue = liquidityRows.reduce((total, row) => total + row.close * row.volume, 0) / liquidityRows.length;
    if (tradedValue < filters.minAverageDailyTradedValue) continue;
    const setup = findBullishPennant(history, filters);
    if (!setup) continue;
    const ema = emaSeries(history.map(row => row.close), 10);
    const chartRows = history.map((row, index) => ({ ...row, ema10: ema[index] }));
    const recent = chartRows.slice(-126);
    const patternIndex = chartRows.findIndex(row => row.trade_date === setup.boundaries.startDate);
    const patternHistory = patternIndex < chartRows.length - 62
      ? chartRows.slice(Math.max(0, patternIndex - 10), patternIndex + setup.baseDays + 3)
      : undefined;
    results.push({ ...setup, security_id, symbol: member.symbol, company_name: member.company_name, recent, patternHistory });
  }
  return { filters, evaluated: members.size, results, generatedAt: new Date().toISOString() };
}
