import type { DailyPriceRecord } from "./types";
import { yearEarlier, type MomentumBacktestResult } from "./momentumBacktest";

type Quote = Pick<DailyPriceRecord, "security_id" | "symbol" | "trade_date" | "open" | "high" | "close" | "is_provisional">;
type Snapshot = MomentumBacktestResult["snapshots"][number];
type PickedStock = Snapshot["picks"][number];
type Position = Snapshot["holdings"][number] & { entrySession: number };
const budget = 10_000;
const fee = 0.001;
const slippage = 0.001;
const hasPrice = (price: number) => Number.isFinite(price) && price > 0;
const completed = (quote: Quote) => !quote.is_provisional && hasPrice(quote.close);

export function simulateLeaderBreakout(equities: Quote[], benchmark: Quote[], startDate?: string) {
  const closes = new Map<string, Map<string, Quote>>();
  for (const quote of equities) {
    if (!completed(quote)) continue;
    const session = closes.get(quote.trade_date) ?? new Map<string, Quote>();
    session.set(quote.security_id, quote);
    closes.set(quote.trade_date, session);
  }
  const dates = [...closes.keys()].sort();
  const availableEnd = dates.at(-1);
  if (!availableEnd) throw new Error("No completed NSE equity sessions are available.");
  const availableStart = dates.find(date => date >= yearEarlier(availableEnd))!;
  if (startDate && (startDate < availableStart || startDate > availableEnd)) {
    throw new RangeError("Choose a date within the available replay.");
  }
  const indexCloses = new Map(benchmark.filter(completed).map(quote => [quote.trade_date, quote.close]));
  const beginning = dates.findIndex(date => date >= (startDate ?? availableStart));
  if (!dates.some((date, index) => index >= beginning && indexCloses.has(date) && indexCloses.has(dates[index - 63]))) {
    throw new Error("Nifty 500 daily history is required for the 63-session relative-strength ranking.");
  }

  const book = new Map<string, Position>();
  const exits = new Set<string>();
  let entry: PickedStock | undefined;
  let realized = 0;
  let peakMtm = 0;
  let maxDrawdown = 0;
  let peakCapital = 0;
  let buySessions = 0;

  const snapshots = dates.slice(beginning).map((date, offset) => {
    const index = beginning + offset;
    const session = closes.get(date)!;
    const trades: Snapshot["trades"] = [];
    for (const id of exits) {
      const position = book.get(id)!;
      const quote = session.get(id);
      if (!quote || !hasPrice(quote.open)) continue;
      const price = quote.open * (1 - slippage);
      const amount = price * position.quantity * (1 - fee);
      const pnl = amount - position.cost;
      realized += pnl;
      trades.push({ symbol: position.symbol, action: "Sell", price, quantity: position.quantity, amount, pnl });
      book.delete(id);
      exits.delete(id);
    }

    const order = entry;
    const openingQuote = order && session.get(order.id);
    if (order && openingQuote && hasPrice(openingQuote.open)) {
      const price = openingQuote.open * (1 + slippage);
      const quantity = budget / (price * (1 + fee));
      book.set(order.id, { id: order.id, symbol: order.symbol, quantity, cost: budget, close: openingQuote.close, stale: false, entrySession: index, pnl: 0 });
      trades.push({ symbol: order.symbol, action: "Buy", price, quantity, amount: budget });
      buySessions++;
    }

    const average = (id: string, periods: number) => {
      let total = 0;
      for (let prior = index - periods + 1; prior <= index; prior++) {
        const quote = closes.get(dates[prior])?.get(id);
        if (!quote) return undefined;
        total += quote.close;
      }
      return total / periods;
    };

    for (const position of book.values()) {
      const quote = session.get(position.id);
      position.stale = !quote;
      if (quote) position.close = quote.close;
      const movingAverage = average(position.id, 20);
      if (index - position.entrySession + 1 >= 20 ||
          (quote && movingAverage !== undefined && quote.close < movingAverage)) exits.add(position.id);
    }

    entry = undefined;
    const benchmarkStart = indexCloses.get(dates[index - 63]);
    const benchmarkEnd = indexCloses.get(date);
    if (benchmarkStart && benchmarkEnd) {
      const benchmarkReturn = benchmarkEnd / benchmarkStart - 1;
      for (const [id, quote] of session) {
        if (book.has(id)) continue;
        const anchor = closes.get(dates[index - 63])?.get(id);
        if (!anchor) continue;
        const returnPct = (quote.close / anchor.close - 1 - benchmarkReturn) * 100;
        if (returnPct <= 0 || (entry && (returnPct < entry.returnPct ||
            (returnPct === entry.returnPct && quote.symbol.localeCompare(entry.symbol) >= 0)))) continue;
        const trend = average(id, 50);
        if (trend === undefined || quote.close <= trend) continue;
        let priorHigh = 0;
        for (let prior = index - 20; prior < index; prior++) {
          const high = closes.get(dates[prior])?.get(id)?.high ?? 0;
          if (!hasPrice(high)) {
            priorHigh = Infinity;
            break;
          }
          priorHigh = Math.max(priorHigh, high);
        }
        if (quote.close > priorHigh) entry = { id, symbol: quote.symbol, returnPct };
      }
    }

    const holdings = [...book.values()].map(({ entrySession: _entrySession, ...position }) => ({
      ...position, pnl: position.quantity * position.close - position.cost,
    }));
    const unrealized = holdings.reduce((total, position) => total + position.pnl, 0);
    const invested = holdings.reduce((total, position) => total + position.cost, 0);
    const accountMtm = realized + unrealized;
    peakCapital = Math.max(peakCapital, invested);
    peakMtm = Math.max(peakMtm, accountMtm);
    maxDrawdown = Math.max(maxDrawdown, peakMtm - accountMtm);
    return {
      date, signal: entry ? "Buy queued for next open" : "No qualifying buy signal", picks: entry ? [entry] : [],
      trades, realized, unrealized, accountMtm, deployed: trades.some(trade => trade.action === "Buy") ? budget : 0,
      invested, holdings, pendingExit: exits.size > 0, queuedExits: [...exits].map(id => book.get(id)!.symbol),
      missedEntry: order && (!openingQuote || !hasPrice(openingQuote.open)) ? order.symbol : undefined,
      maxDrawdown, peakCapital, buySessions,
    };
  });
  return { strategy: "breakout" as const, snapshots, availableStart, availableEnd };
}

export type LeaderBreakoutResult = ReturnType<typeof simulateLeaderBreakout>;
