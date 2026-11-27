import type { DailyPriceRecord } from "./types";

const allocation = 10_000;
type Quote = Pick<DailyPriceRecord, "security_id" | "symbol" | "trade_date" | "close" | "is_provisional">;
type Candidate = { id: string; symbol: string; returnPct: number };
type Holding = { id: string; symbol: string; quantity: number; cost: number; close: number; stale: boolean };
type Trade = { symbol: string; action: "Buy" | "Sell"; price: number; quantity: number; amount: number; pnl?: number };
type ExitReason = "Month end" | "Loss limit" | "Profit target";

function shiftDays(date: string, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function yearEarlier(date: string) {
  const year = Number(date.slice(0, 4)) - 1;
  const candidate = `${year}${date.slice(4)}`;
  return new Date(candidate).toISOString().slice(0, 10) === candidate ? candidate : `${year}-02-28`;
}

function rank(current: Map<string, Quote>, base: Map<string, Quote>, eligible?: Set<string>) {
  const candidates: Candidate[] = [];
  for (const [id, quote] of current) {
    const previous = base.get(id);
    if (!previous || (eligible && !eligible.has(id))) continue;
    candidates.push({ id, symbol: quote.symbol, returnPct: (quote.close - previous.close) * 100 / previous.close });
  }
  return candidates.sort((a, b) => b.returnPct - a.returnPct || a.symbol.localeCompare(b.symbol) || a.id.localeCompare(b.id));
}

export function simulateMomentumBacktest(prices: Quote[]) {
  const validClose = (quote: Quote) => !quote.is_provisional && Number.isFinite(quote.close) && quote.close > 0;
  let latest = "";
  for (const quote of prices) {
    if (quote.trade_date > latest && validClose(quote)) latest = quote.trade_date;
  }
  if (!latest) throw new Error("No completed NSE equity sessions are available.");
  const start = yearEarlier(latest);
  const warmup = shiftDays(start, -70);
  const closes = new Map<string, Map<string, Quote>>();
  for (const quote of prices) {
    if (quote.trade_date < warmup || !validClose(quote)) continue;
    const session = closes.get(quote.trade_date) ?? new Map<string, Quote>();
    session.set(quote.security_id, quote);
    closes.set(quote.trade_date, session);
  }
  const dates = [...closes.keys()].sort();
  const beginning = dates.findIndex(date => date >= start);
  const flat = new Map<string, Quote>();
  const holdings = new Map<string, Holding>();
  let basket = new Set<string>();
  let realized = 0;
  let pendingExit: ExitReason | undefined;
  let restartAfterLimit = false;

  const snapshots = dates.slice(beginning).map((date, offset) => {
    const index = beginning + offset;
    const month = date.slice(0, 7);
    const previous = dates[index - 1];
    const next = dates[index + 1];
    const monthStart = previous?.slice(0, 7) !== month;
    const monthEnd = Boolean(next && next.slice(0, 7) !== month)
      || shiftDays(date, 1).slice(0, 7) !== month;
    const current = closes.get(date)!;
    const previousCloses = closes.get(previous) ?? flat;
    const trades: Trade[] = [];
    let picks: Candidate[] = [];
    let signal = "";
    for (const holding of holdings.values()) {
      const quote = current.get(holding.id);
      holding.stale = !quote;
      if (quote) holding.close = quote.close;
    }

    const openPnl = () => [...holdings.values()].reduce((sum, holding) => sum + holding.quantity * holding.close - holding.cost, 0);
    const beforeTrades = openPnl();
    const exit = pendingExit ?? (holdings.size && beforeTrades <= -50_000 ? "Loss limit"
      : holdings.size && beforeTrades >= 100_000 ? "Profit target"
      : monthEnd ? "Month end" : undefined);
    if (exit) {
      signal = exit;
      for (const holding of holdings.values()) {
        if (holding.stale) continue;
        const amount = holding.quantity * holding.close;
        const pnl = amount - holding.cost;
        realized += pnl;
        trades.push({ symbol: holding.symbol, action: "Sell", price: holding.close, quantity: holding.quantity, amount, pnl });
        holdings.delete(holding.id);
      }
      pendingExit = holdings.size ? exit : undefined;
      basket = new Set();
      if (exit !== "Month end") restartAfterLimit = true;
    } else {
      if (!basket.size && previous) {
        const calendarRanking = monthStart && !restartAfterLimit;
        const priorMonth = previous.slice(0, 7);
        const cutoff = calendarRanking ? `${priorMonth}-01` : shiftDays(previous, -30);
        let baseIndex = index - 1;
        while (baseIndex >= 0 && (calendarRanking ? dates[baseIndex] >= cutoff : dates[baseIndex] > cutoff)) baseIndex--;
        const base = closes.get(dates[baseIndex]) ?? flat;
        picks = rank(previousCloses, base).filter(candidate => candidate.returnPct >= 30 && current.has(candidate.id)).slice(0, 10);
        basket = new Set(picks.map(candidate => candidate.id));
        signal = calendarRanking ? "Prior calendar month ranking" : "Trailing 30 calendar days ranking";
        restartAfterLimit = false;
      } else if (basket.size) {
        picks = rank(current, previousCloses, basket).slice(0, 3);
        signal = "Daily basket ranking";
      }
      for (const pick of picks) {
        const quote = current.get(pick.id);
        if (!quote) continue;
        const quantity = allocation / quote.close;
        const holding = holdings.get(pick.id) ?? { id: pick.id, symbol: quote.symbol, quantity: 0, cost: 0, close: quote.close, stale: false };
        holding.quantity += quantity;
        holding.cost += allocation;
        holdings.set(pick.id, holding);
        trades.push({ symbol: holding.symbol, action: "Buy", price: quote.close, quantity, amount: allocation });
      }
      if (!holdings.size) basket = new Set();
    }
    const unrealized = openPnl();
    return {
      date, signal, picks, trades, realized, unrealized, accountMtm: realized + unrealized,
      deployed: trades.reduce((sum, trade) => sum + (trade.action === "Buy" ? trade.amount : 0), 0),
      invested: [...holdings.values()].reduce((sum, holding) => sum + holding.cost, 0),
      holdings: [...holdings.values()].map(holding => ({ ...holding, pnl: holding.quantity * holding.close - holding.cost })),
      pendingExit: Boolean(pendingExit),
    };
  });
  return { snapshots };
}

export type MomentumBacktestResult = ReturnType<typeof simulateMomentumBacktest>;
