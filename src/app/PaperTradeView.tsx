"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { paperPnl, type PaperTrade } from "@/lib/paperTrade";

const money = (value: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format(value);
const marketTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
});

async function requestLedger(method = "GET", body?: object) {
  const response = await fetch("/api/paper-trade", {
    method, cache: "no-store",
    ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Paper Trade is unavailable.");
  return result as { trades: PaperTrade[] };
}

export function PaperTradeButton({ securityId, symbol, entry, stop, quantity }: {
  securityId: string; symbol: string; entry: number; stop?: number; quantity: number;
}) {
  const isAdmin = useSession().data?.isAdmin;
  const attempt = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  if (!isAdmin) return null;
  const valid = Boolean(stop) && Number.isSafeInteger(quantity) && quantity > 0;

  async function open() {
    setSaving(true);
    setError("");
    try {
      attempt.current ??= crypto.randomUUID();
      await requestLedger("POST", { id: attempt.current, securityId, symbol, entry, stop, quantity });
      setSaved(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return <div>
    <button type="button" className="secondary compact" disabled={!valid || saving || saved}
      title={valid ? "Add the daily-low position to Paper Trade" : "Requires a valid daily-low position size"}
      onClick={() => void open()}>{saving ? "Saving…" : saved ? "Paper trade added" : "Paper"}</button>
    {error && <small role="alert" className="negative">{error}</small>}
  </div>;
}

type Quote = { securityId: string; ltp: number; lastTradeTime?: number; receivedAt: number };
const quoteTime = (quote: Quote) => quote.lastTradeTime ? quote.lastTradeTime * 1000 : quote.receivedAt;

export default function PaperTradeView({ chart }: {
  chart: (points: { date: string; cumulative: number }[]) => ReactNode;
}) {
  const [trades, setTrades] = useState<PaperTrade[] | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [status, setStatus] = useState("Connecting to Dhan");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [exitPrice, setExitPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let current = true;
    void requestLedger().then(result => { if (current) setTrades(result.trades); })
      .catch(error => { if (current) setError(error.message); });
    return () => { current = false; };
  }, []);

  const open = trades?.filter(trade => trade.closedAt === null) ?? [];
  const closed = trades?.filter(trade => trade.closedAt !== null)
    .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!)) ?? [];
  const ids = [...new Set(open.map(trade => trade.securityId))].sort().join(",");
  useEffect(() => {
    if (!ids) return;
    const source = new EventSource(`/api/portfolio/live?ids=${encodeURIComponent(ids)}`);
    const update = (ticks: Quote[]) => setQuotes(previous => {
      const next = { ...previous };
      for (const tick of ticks) {
        const old = next[tick.securityId];
        if (!old || quoteTime(tick) >= quoteTime(old)) next[tick.securityId] = tick;
      }
      return next;
    });
    source.addEventListener("snapshot", event => update(JSON.parse(event.data)));
    source.addEventListener("tick", event => update([JSON.parse(event.data)]));
    source.addEventListener("status", event => setStatus(JSON.parse(event.data).message));
    source.onerror = () => setStatus("Dhan feed reconnecting");
    return () => source.close();
  }, [ids]);

  function mark(trade: PaperTrade) {
    const quote = quotes[trade.securityId];
    return quote && quoteTime(quote) >= Date.parse(trade.openedAt) ? quote : undefined;
  }

  async function close(id: string) {
    setSaving(true);
    setError("");
    try {
      const result = await requestLedger("PATCH", { id, exitPrice: Number(exitPrice) });
      setTrades(result.trades);
      setEditing(null);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const chartDays = new Map<string, number>();
  const marketDate = new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeZone: "Asia/Kolkata" });
  let realized = 0;
  let wins = 0;
  let losses = 0;
  for (const trade of [...closed].reverse()) {
    const pnl = paperPnl(trade, trade.exitPrice!);
    realized += pnl;
    wins += Number(pnl > 0);
    losses += Number(pnl < 0);
    chartDays.set(marketDate.format(new Date(trade.closedAt!)), realized);
  }
  const points = [...chartDays].map(([date, cumulative]) => ({ date, cumulative }));
  if (points.length) points.unshift({ date: points[0].date, cumulative: 0 });
  const unquoted = open.filter(trade => !mark(trade)).length;
  const unrealized = open.reduce((total, trade) => total + paperPnl(trade, mark(trade)?.ltp ?? trade.entry), 0);
  const kpis = [
    ["Overall P&L", money(realized + unrealized), unquoted ? `${unquoted} awaiting quotes` : ""],
    ["Open P&L", money(unrealized), `${open.length} position(s)`],
    ["Realized P&L", money(realized), `${closed.length} closed`],
    ["Win rate", closed.length ? `${(100 * wins / closed.length).toFixed(1)}%` : "—", `${wins} wins · ${losses} losses`],
  ];

  return <section className="portfolio-page">
    <div className="data-toolbar"><div><h2>Simulation portfolio</h2>
      <small>Manual exits · Gross P&amp;L before fees · Quote times in IST</small>
    </div>{ids && <small role="status">{status}</small>}</div>
    {error && <div className="error" role="alert">{error}</div>}
    {!trades && !error && <p role="status">Loading paper trades…</p>}
    {trades && <>
      <div className="dashboard-kpi-grid">{kpis.map(([label, value, detail]) =>
        <div className="dashboard-kpi" key={label}><span>{label}</span><b>{value}</b>{detail && <small>{detail}</small>}</div>
      )}</div>
      <section className="panel dashboard-panel"><div className="panel-head"><h2>Cumulative realized P&amp;L</h2></div>
        {points.length ? chart(points) : <p className="panel-empty">The chart starts when you close your first paper trade.</p>}
      </section>
      <section className="panel"><div className="panel-head"><h2>Open positions</h2></div>
        {open.length ? <div className="table-wrap"><table>
          <thead><tr><th>Stock</th><th>Qty</th><th>Entry</th><th>Daily-low SL</th><th>Invested</th><th>Initial risk</th><th>Last quote</th><th>Open P&amp;L</th><th>Exit</th></tr></thead>
          <tbody>{open.map(trade => {
            const quote = mark(trade);
            const pnl = quote ? paperPnl(trade, quote.ltp) : undefined;
            return <tr key={trade.id}>
              <td><b>{trade.symbol}</b><small className="sample-warning">{marketTime.format(new Date(trade.openedAt))}</small></td>
              <td>{trade.quantity.toLocaleString("en-IN")}</td><td>{money(trade.entry)}</td><td>{money(trade.stop)}</td>
              <td>{money(trade.entry * trade.quantity)}</td><td>{money((trade.entry - trade.stop) * trade.quantity)}</td>
              <td>{quote ? <>{money(quote.ltp)}<small className="sample-warning">{marketTime.format(quoteTime(quote))}</small></> : "Awaiting quote"}
                {quote && quote.ltp <= trade.stop && <small className="sample-warning negative">At or below stop</small>}</td>
              <td className={pnl === undefined ? undefined : pnl >= 0 ? "positive" : "negative"}>{pnl === undefined ? "—" : money(pnl)}</td>
              <td>{editing === trade.id ? <form className="toolbar-actions" onSubmit={event => { event.preventDefault(); void close(trade.id); }}>
                <input className="plain-input" aria-label={`Exit price for ${trade.symbol}`} type="number" min="0.01" max="1000000000" step="any" required value={exitPrice} onChange={event => setExitPrice(event.target.value)} disabled={saving}/>
                <button className="primary compact" type="submit" disabled={saving}>Confirm exit</button>
                <button className="secondary compact" type="button" disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
              </form> : <button className="secondary compact" type="button" disabled={saving} onClick={() => {
                setEditing(trade.id);
                setExitPrice(quote ? quote.ltp.toFixed(2) : "");
              }}>Close</button>}</td>
            </tr>;
          })}</tbody>
        </table></div> : <p className="panel-empty">Open a position with the Paper button in a Screener chart.</p>}
      </section>
      <section className="panel"><div className="panel-head"><h2>{showHistory ? "Closed positions" : "Recently closed positions"}</h2>
        {closed.length > 5 && <button className="secondary compact" onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Show recent" : `Show all ${closed.length}`}</button>}</div>
        {closed.length ? <div className="table-wrap"><table>
          <thead><tr><th>Stock</th><th>Opened</th><th>Closed</th><th>Qty</th><th>Entry</th><th>Daily-low SL</th><th>Exit</th><th>Realized P&amp;L</th></tr></thead>
          <tbody>{(showHistory ? closed : closed.slice(0, 5)).map(trade => {
            const pnl = paperPnl(trade, trade.exitPrice!);
            return <tr key={trade.id}><td><b>{trade.symbol}</b></td><td>{marketTime.format(new Date(trade.openedAt))}</td><td>{marketTime.format(new Date(trade.closedAt!))}</td>
              <td>{trade.quantity.toLocaleString("en-IN")}</td><td>{money(trade.entry)}</td><td>{money(trade.stop)}</td>
              <td>{money(trade.exitPrice!)}</td><td className={pnl >= 0 ? "positive" : "negative"}>{money(pnl)}</td></tr>;
          })}</tbody>
        </table></div> : <p className="panel-empty">No closed positions yet.</p>}
      </section>
    </>}
  </section>;
}
