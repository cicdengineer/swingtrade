"use client";

import { useState } from "react";
import type { MomentumBacktestResult } from "@/lib/momentumBacktest";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format;
const shares = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format;

function Table({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty: string }) {
  if (!rows.length) return <p className="panel-empty">{empty}</p>;
  return <div style={{ overflowX: "auto" }}><table>
    <thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

export default function BacktestingView() {
  const [result, setResult] = useState<MomentumBacktestResult | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const snapshots = result?.snapshots;
  const day = snapshots?.[index];

  async function run() {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/backtesting", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Backtest failed.");
      setResult(data);
      setIndex(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backtest failed.");
    } finally {
      setLoading(false);
    }
  }

  return <div className="dashboard-grid">
    <section className="panel dashboard-panel">
      <div className="panel-head"><h3>Monthly momentum backtest</h3></div>
      <p>Replay the latest year of available NSE equity closes. Start with up to 10 stocks that gained at least 30%, then add ₹10,000 to each of the basket’s three strongest daily performers.</p>
      <p>Exit at month end or when basket MTM reaches −₹50,000 or +₹1,00,000. After a limit exit, use the trailing 30 calendar days to rank the next basket.</p>
      <small>Simulated fills use closing prices and fractional shares, with zero fees and no funding cap.</small>
      <p><button type="button" onClick={run} disabled={loading}>{loading ? "Loading sessions…" : "Run backtest"}</button></p>
      {error && <p role="alert">{error}</p>}
    </section>
    {day && snapshots && <>
      <section className="panel dashboard-panel">
        <div className="panel-head"><h3>{day.date}</h3><small>Session {index + 1} of {snapshots.length}</small></div>
        <p><button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0}>Previous</button>{" "}
          <button type="button" onClick={() => setIndex(index + 1)} disabled={index === snapshots.length - 1}>Next</button></p>
        <small>Available replay · {snapshots[0].date} to {snapshots[snapshots.length - 1].date}</small>
        <dl>
          <dt>Account MTM</dt><dd><strong>{money(day.accountMtm)}</strong></dd>
          <dt>Realized P&L</dt><dd>{money(day.realized)}</dd>
          <dt>Open basket MTM</dt><dd>{money(day.unrealized)}</dd>
          <dt>Deployed this session</dt><dd>{money(day.deployed)}</dd>
          <dt>Open positions at cost</dt><dd>{money(day.invested)}</dd>
        </dl>
        {day.signal && <p>{day.signal}</p>}
        {day.pendingExit && <p>Some exits are pending a fresh closing price.</p>}
        {day.picks.length > 0 && <p>Ranked stocks · {day.picks.map(pick => `${pick.symbol} (${pick.returnPct.toFixed(2)}%)`).join(", ")}</p>}
      </section>
      <section className="panel dashboard-panel">
        <div className="panel-head"><h3>Trades at the close</h3></div>
        <Table headers={["Stock", "Action", "Close", "Shares", "Amount", "Realized P&L"]} empty="No trades this session."
          rows={day.trades.map(trade => [trade.symbol, trade.action, money(trade.price), shares(trade.quantity), money(trade.amount), trade.pnl === undefined ? "—" : money(trade.pnl)])} />
      </section>
      <section className="panel dashboard-panel">
        <div className="panel-head"><h3>Open positions</h3></div>
        <Table headers={["Stock", "Shares", "Invested", "Average cost", "Mark", "Market value", "Open P&L"]} empty="No open positions."
          rows={day.holdings.map(holding => [holding.symbol, shares(holding.quantity), money(holding.cost), money(holding.cost / holding.quantity), money(holding.close) + (holding.stale ? " (last close)" : ""), money(holding.close * holding.quantity), money(holding.pnl)])} />
      </section>
    </>}
  </div>;
}
