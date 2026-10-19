import "server-only";
import { readDatabase } from "./localDatabase";
import { analyzeQStock, defaultQFilters, type QFilters } from "./qullamaggieLogic";
import type { DailyPriceRecord } from "./types";

const cache = new Map<string, { until: number; value: Awaited<ReturnType<typeof calculate>> }>();
function normalize(input: Partial<QFilters>): QFilters {
  const f = { ...defaultQFilters, ...input };
  for (const key of Object.keys(defaultQFilters) as (keyof QFilters)[]) {
    if (typeof defaultQFilters[key] === "number") {
      const value = Number(f[key]);
      if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${key}`);
    }
  }
  if (f.minBaseDays < 5 || f.maxBaseDays < f.minBaseDays || f.maxBaseDays > 60) throw new Error("Consolidation length must be 5–60 sessions");
  if (![1, 5, 10, 15].includes(f.openingMinutes)) throw new Error("Invalid opening range");
  if (!["ALL", "CNX500"].includes(f.universe)) throw new Error("Invalid watchlist");
  return f;
}
async function calculate(filters: QFilters, asOf?: string) {
  const db = await readDatabase();
  const members = [...new Map(db.universe_members.filter(m => m.is_current_constituent && m.security_id && (filters.universe === "ALL" || filters.universe === m.universe_name)).map(m => [m.security_id, m])).values()];
  const wanted = new Set(members.map(m => m.security_id));
  const prices = db.daily_prices.filter(row => wanted.has(row.security_id));
  const byId = new Map<string, DailyPriceRecord[]>();
  for (const row of prices) { const list = byId.get(row.security_id) ?? []; list.push(row); byId.set(row.security_id, list); }
  const all = members.map(m => analyzeQStock({ securityId: m.security_id, symbol: m.symbol, companyName: m.company_name, universeName: m.universe_name, prices: byId.get(m.security_id) ?? [], filters, asOf }));
  const results = all.filter(r => filters.showDiagnostics || r.qualifies).sort((a, b) => b.setupScore - a.setupScore);
  return { filters, evaluated: all.length, qualified: all.filter(r => r.qualifies).length, missingData: all.filter(r => r.stage === "Insufficient Data").length, latestDataDate: all.map(r => r.dataDate).sort().at(-1) ?? null, results, generatedAt: new Date().toISOString(), priceAdjustmentStatus: "Use stored OHLCV; adjustment varies by instrument" };
}
export async function runQullamaggieScreener(input: Partial<QFilters> = {}, options: { rescan?: boolean; asOf?: string } = {}) {
  const filters = normalize(input);
  const key = JSON.stringify({ filters, asOf: options.asOf });
  const found = cache.get(key);
  if (!options.rescan && found && found.until > Date.now()) return found.value;
  const value = await calculate(filters, options.asOf);
  cache.set(key, { until: Date.now() + 60_000, value });
  if (cache.size > 12) cache.delete(cache.keys().next().value!);
  return value;
}
