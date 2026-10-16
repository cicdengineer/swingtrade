import type { QRow } from "./qullamaggieLogic";

export const qullamaggieWatchlistKey = "qullamaggie-resistance-watchlist";

export type QWatchlist = {
  generatedAt: string;
  dataDate: string | null;
  stocks: { securityId: string; symbol: string; resistance: number }[];
};

export function resistanceWatchlist(rows: QRow[], generatedAt: string, dataDate: string | null): QWatchlist {
  return {
    generatedAt,
    dataDate,
    stocks: rows.filter(row => row.qualifies && row.resistance !== undefined && row.resistance > 0).map(row => ({ securityId: row.security_id, symbol: row.symbol, resistance: row.resistance! })),
  };
}

export function parseResistanceWatchlist(raw: string | null): QWatchlist | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as QWatchlist;
    if (!Array.isArray(value.stocks) || typeof value.generatedAt !== "string") return null;
    return { generatedAt: value.generatedAt, dataDate: typeof value.dataDate === "string" ? value.dataDate : null, stocks: value.stocks.filter(stock => typeof stock.securityId === "string" && typeof stock.symbol === "string" && Number.isFinite(stock.resistance) && stock.resistance > 0) };
  } catch { return null; }
}
