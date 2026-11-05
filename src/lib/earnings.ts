export type EarningsEvent = { periodEnd: string; filedAt: string };
export type EarningsBySymbol = Record<string, EarningsEvent[]>;

type Filing = {
  symbol: string;
  type_Sub: string;
  qe_Date: string;
  broadcast_Date: string;
};

const months = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");

function exchangeDate(value: string) {
  const match = /^(\d{2})-([a-z]{3})-(\d{4})( \d{2}:\d{2}:\d{2})?$/i.exec(value);
  if (!match) return;
  const month = months.indexOf(match[2].toUpperCase()) + 1;
  if (month) return `${match[3]}-${String(month).padStart(2, "0")}-${match[1]}${match[4] ?? ""}`;
}

export function collectOriginalResults(filings: Filing[], results: EarningsBySymbol) {
  for (const filing of filings) {
    if (filing.type_Sub !== "Original" || !filing.symbol) continue;
    const periodEnd = exchangeDate(filing.qe_Date);
    const filedAt = exchangeDate(filing.broadcast_Date);
    if (!periodEnd || filedAt?.length !== 19) continue;
    const events = results[filing.symbol] ??= [];
    const existing = events.find(event => event.periodEnd === periodEnd);
    if (!existing) events.push({ periodEnd, filedAt });
    else if (filedAt < existing.filedAt) existing.filedAt = filedAt;
  }
}

// Exchange timestamps are local IST. Align to the first available daily candle
// that could reflect the filing, before clipping to the visible chart.
export function earningsSession(events: EarningsEvent[], rows: { trade_date: string }[]) {
  return events.flatMap(event => {
    const day = event.filedAt.slice(0, 10);
    if (!rows.length || day < rows[0].trade_date.slice(0, 10)) return [];
    const afterClose = event.filedAt.slice(11) >= "15:30:00";
    const session = rows.find(row => {
      const date = row.trade_date.slice(0, 10);
      return date > day || (date === day && !afterClose);
    });
    return session ? [{ ...event, session: session.trade_date }] : [];
  });
}
