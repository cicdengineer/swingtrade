import "server-only";
import { readDatabase } from "./localDatabase";
import { analyzeQStock, defaultQFilters, type QFilters } from "./qullamaggieLogic";
import type { DailyPriceRecord } from "./types";

export async function runQullamaggieBacktest(input: { filters: Partial<QFilters>; from: string; to: string; holdDays?: number; slippageBps?: number; costBps?: number }) {
  const filters = { ...defaultQFilters, ...input.filters, entryMode: "EOD" as const };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.from > input.to) throw new Error("Provide a valid historical date range");
  const holdDays = Math.min(30, Math.max(1, Math.floor(input.holdDays ?? 10)));
  const slippageBps = Math.min(100, Math.max(0, Number(input.slippageBps ?? 10)));
  const costBps = Math.min(100, Math.max(0, Number(input.costBps ?? 10)));
  const db = await readDatabase();
  const members = [...new Map(db.universe_members.filter(m => m.is_current_constituent && m.security_id && (filters.universe === "ALL" || m.universe_name === filters.universe)).map(m => [m.security_id, m])).values()];
  const wanted = new Set(members.map(m => m.security_id));
  const byId = new Map<string, DailyPriceRecord[]>();
  for (const row of db.daily_prices) if (wanted.has(row.security_id) && !row.is_provisional) { const list = byId.get(row.security_id) ?? []; list.push(row); byId.set(row.security_id, list); }
  const trades: { symbol: string; signalDate: string; fillDate: string; exitDate: string; entry: number; exit: number; stop: number; r: number; holdingDays: number }[] = [];
  for (const member of members) {
    const rows = (byId.get(member.security_id) ?? []).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    for (let i = 130; i < rows.length - 1; i++) {
      if (rows[i].trade_date < input.from || rows[i].trade_date > input.to) continue;
      if (rows[i].close <= Math.max(...rows.slice(i - filters.minBaseDays, i).map(r => r.high))) continue;
      const scan = analyzeQStock({ securityId: member.security_id, symbol: member.symbol, companyName: member.company_name, universeName: member.universe_name, prices: rows.slice(0, i + 1), filters });
      if (scan.stage !== "Breakout Triggered" || !scan.stop || !(scan.stop < scan.close)) continue;
      const next = rows[i + 1];
      const entry = next.open * (1 + slippageBps / 10000);
      if (entry <= scan.stop) continue;
      const risk = entry - scan.stop;
      if (risk / entry * 100 > (scan.adr20 ?? 0) * filters.maxStopAdr) continue;
      const last = Math.min(rows.length - 1, i + holdDays);
      let exitIndex = last, exit = rows[last].close * (1 - slippageBps / 10000);
      for (let j = i + 1; j <= last; j++) if (rows[j].low <= scan.stop) { exitIndex = j; exit = Math.min(rows[j].open, scan.stop) * (1 - slippageBps / 10000); break; }
      const r = ((exit - entry) - (entry + exit) * costBps / 10000) / risk;
      trades.push({ symbol: member.symbol, signalDate: rows[i].trade_date, fillDate: next.trade_date, exitDate: rows[exitIndex].trade_date, entry, exit, stop: scan.stop, r, holdingDays: exitIndex - i });
      i = exitIndex;
    }
  }
  trades.sort((a, b) => a.exitDate.localeCompare(b.exitDate));
  const wins = trades.filter(t => t.r > 0), losses = trades.filter(t => t.r < 0);
  const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  let equity = 0, peak = 0, maxDrawdownR = 0;
  for (const t of trades) { equity += t.r; peak = Math.max(peak, equity); maxDrawdownR = Math.max(maxDrawdownR, peak - equity); }
  return { configuration: { filters, from: input.from, to: input.to, holdDays, slippageBps, costBps, fillModel: "Next completed session open plus slippage; stop tested from fill session through hold day; gap through stop fills at open; time exit at close minus slippage", universeBasis: "Current constituents only; historical membership unavailable, so survivorship bias remains possible" }, summary: { signals: trades.length, winRate: trades.length ? wins.length / trades.length * 100 : 0, averageWinR: avg(wins.map(t => t.r)), averageLossR: avg(losses.map(t => t.r)), averageR: avg(trades.map(t => t.r)), expectancyR: avg(trades.map(t => t.r)), maximumDrawdownR: maxDrawdownR, profitFactor: losses.length ? wins.reduce((s, t) => s + t.r, 0) / -losses.reduce((s, t) => s + t.r, 0) : null, averageHoldingSessions: avg(trades.map(t => t.holdingDays)) }, trades };
}
