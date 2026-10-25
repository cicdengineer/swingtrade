type LiveQuote = {
  ltp: number;
  dayHigh?: number;
  prevClose?: number;
  lastTradeTime?: number;
  receivedAt: number;
};

type EntryReference = {
  signal_date: string;
  signal_high: number;
  current_date: string;
  current_close: number;
  previous_close: number;
};

const sessionDate = (timestamp: number) => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(timestamp));

export function currentSessionQuote<T extends LiveQuote>(tick: T | undefined, tradingDate: string): T | undefined {
  if (!tick || !Number.isFinite(tick.ltp) || tick.ltp <= 0 || !tick.lastTradeTime) return undefined;
  return sessionDate(tick.receivedAt) === tradingDate && sessionDate(tick.lastTradeTime * 1000) === tradingDate ? tick : undefined;
}

export function liveEntryCrossed(row: EntryReference, tick: LiveQuote | undefined, tradingDate: string) {
  const quote = currentSessionQuote(tick, tradingDate);
  if (!quote || row.signal_date >= tradingDate) return false;
  const storedPreviousClose = row.current_date === tradingDate ? row.previous_close : row.current_close;
  const previousClose = quote.prevClose && quote.prevClose > 0 ? quote.prevClose : storedPreviousClose;
  const dayHigh = Math.max(quote.dayHigh ?? quote.ltp, quote.ltp);
  return previousClose < row.signal_high && dayHigh >= row.signal_high;
}
