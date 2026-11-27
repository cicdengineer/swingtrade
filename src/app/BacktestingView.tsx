"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Play, RotateCcw } from "lucide-react";
import type { MomentumBacktestResult } from "@/lib/momentumBacktest";
import type { LeaderBreakoutResult } from "@/lib/leaderBreakout";
import styles from "./BacktestingView.module.css";

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const money = (value: number) => currency.format(Math.abs(value) < 0.005 ? 0 : value);
const shares = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format;
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(date));

function Profit({ value }: { value: number }) {
  return <span className={value >= 0.005 ? styles.gain : value <= -0.005 ? styles.loss : undefined}>
    {value >= 0.005 && "+"}{money(value)}
  </span>;
}

function Table({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className={styles.empty}>{empty}</p>;
  return <div className={styles.tableScroll}><table>
    <thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

export default function BacktestingView() {
  const [strategy, setStrategy] = useState<"breakout" | "momentum">("breakout");
  const [result, setResult] = useState<MomentumBacktestResult | LeaderBreakoutResult | null>(null);
  const [index, setIndex] = useState(0);
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const snapshots = result?.snapshots ?? [];
  const day = snapshots[index];
  const breakout = strategy === "breakout";
  const breakoutDay = result?.strategy === "breakout" ? result.snapshots[index] : undefined;
  const first = snapshots[0]?.date;
  const canJump = Boolean(first && date >= first && result && date <= result.availableEnd);
  const canStart = Boolean(date && (!result || (date >= result.availableStart && date <= result.availableEnd)));

  function goTo(next: number) {
    setIndex(next);
    setDate(snapshots[next].date);
    setError("");
  }

  async function run(start?: string) {
    setError("");
    setLoading(true);
    try {
      const query = new URLSearchParams({ strategy });
      if (start) query.set("start", start);
      const response = await fetch(`/api/backtesting?${query}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Backtest failed.");
      setResult(data);
      setIndex(0);
      setDate(data.snapshots[0].date);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backtest failed.");
    } finally {
      setLoading(false);
    }
  }

  return <div className={styles.workspace} aria-busy={loading}>
    <section className={styles.hero}>
      <div>
        <h2>{breakout ? "Market-leader breakout" : "Momentum basket"}</h2>
        <p>{breakout
          ? "Allocate up to ₹10,000 per session to one NSE stock breaking its prior 20-session high. Rank qualifying stocks by their 63-session outperformance versus the Nifty 500."
          : "Build a basket of up to 10 NSE stocks with a 30% gain over 65 calendar days. Buy ₹10,000 per stock, then add ₹10,000 each to the strongest 30% of the basket every session, rounded up."}</p>
      </div>
      <div className={styles.controls}>
        <select aria-label="Backtest strategy" value={strategy} disabled={loading} onChange={event => {
          setStrategy(event.target.value === "momentum" ? "momentum" : "breakout");
          setResult(null);
          setError("");
        }}>
          <option value="breakout">Market-leader breakout</option>
          <option value="momentum">Momentum basket</option>
        </select>
        <button className={styles.primary} type="button" onClick={() => void run()} disabled={loading}>
          <Play size={15} /> {loading ? "Loading replay…" : "Run full year"}
        </button>
      </div>
    </section>

    <section className={styles.replay} aria-label="Replay controls">
      <div className={styles.dateInfo}>
        <CalendarDays size={20} aria-hidden="true" />
        <div><h3>{day ? dateLabel(day.date) : "Choose a replay date"}</h3>
          <small>{day ? `Session ${index + 1} of ${snapshots.length} · Run started ${dateLabel(first)}` : "Load the full year or start a fresh run from a date."}</small></div>
      </div>
      <div className={styles.controls}>
        <input type="date" aria-label="Trading date" value={date} min={result?.availableStart} max={result?.availableEnd}
          onChange={event => setDate(event.target.value)} disabled={loading} />
        <button type="button" disabled={loading || !canJump} onClick={() => goTo(snapshots.findIndex(snapshot => snapshot.date >= date))}>Jump</button>
        <button type="button" disabled={loading || !canStart} onClick={() => void run(date)}><RotateCcw size={14} /> Start here</button>
      </div>
      {day && <div className={styles.timeline}>
        <button type="button" disabled={loading || index === 0} onClick={() => goTo(index - 1)}><ChevronLeft size={16} /> Previous</button>
        <input type="range" aria-label="Replay session" aria-valuetext={dateLabel(day.date)} min={0} max={snapshots.length - 1} value={index}
          onChange={event => goTo(Number(event.target.value))} disabled={loading || snapshots.length < 2} />
        <button className={styles.primary} type="button" disabled={loading || index === snapshots.length - 1} onClick={() => goTo(index + 1)}>Next <ChevronRight size={16} /></button>
      </div>}
      <small>Jump keeps the current run. Start here resets positions and P&L. Dates without a session use the next available close.</small>
    </section>
    {error && <p className={styles.loss} role="alert">{error}</p>}

    {day && <>
      <dl className={styles.metrics} aria-live="polite">
        <div><dt>Account MTM</dt><dd><Profit value={day.accountMtm} /></dd></div>
        <div><dt>Realized P&L</dt><dd><Profit value={day.realized} /></dd></div>
        <div><dt>Open basket MTM</dt><dd><Profit value={day.unrealized} /></dd></div>
        <div><dt>Deployed this session</dt><dd>{money(day.deployed)}</dd></div>
        <div><dt>Open positions at cost</dt><dd>{money(day.invested)}</dd></div>
      </dl>
      {breakoutDay && <p className={styles.replayStats}>
        <span>Max MTM drawdown <strong>{money(breakoutDay.maxDrawdown)}</strong></span>
        <span>Peak capital deployed <strong>{money(breakoutDay.peakCapital)}</strong></span>
        <span>Sessions with a buy <strong>{breakoutDay.buySessions} of {index + 1}</strong></span>
      </p>}
      {(day.signal || day.pendingExit) && <section className={styles.signal}>
        {day.signal && <h3>{day.signal}</h3>}
        {breakoutDay?.missedEntry && <p>{breakoutDay.missedEntry} had no valid opening price. The order expired.</p>}
        {day.pendingExit && <p>{breakoutDay ? `Exits queued for the next available open · ${breakoutDay.queuedExits.join(", ")}` : "Some exits are pending a fresh closing price."}</p>}
        {day.picks.length > 0 && <ul>{day.picks.map(pick => <li key={pick.id}><strong>{pick.symbol}</strong> {pick.returnPct.toFixed(2)}{breakout ? " pp vs Nifty 500" : "%"}</li>)}</ul>}
      </section>}
      <div className={styles.tables}>
        <section className={styles.ledger}>
          <div className={styles.tableTitle}><h3>{breakout ? "Trades at the open" : "Trades at the close"}</h3><small>{day.trades.length} fills</small></div>
          <Table headers={["Stock", "Action", "Fill price", "Shares", "Amount", "Realized P&L"]} empty="No trades this session."
            rows={day.trades.map(trade => [<strong>{trade.symbol}</strong>, <span className={trade.action === "Buy" ? styles.buy : styles.sell}>{trade.action}</span>, money(trade.price), shares(trade.quantity), money(trade.amount), trade.pnl === undefined ? "—" : <Profit value={trade.pnl} />])} />
        </section>
        <section className={styles.ledger}>
          <div className={styles.tableTitle}><h3>Open positions</h3><small>{day.holdings.length} stocks</small></div>
          <Table headers={["Stock", "Shares", "Invested", "Average cost", "Mark", "Market value", "Open P&L"]} empty="No open positions."
            rows={day.holdings.map(holding => [<strong>{holding.symbol}</strong>, shares(holding.quantity), money(holding.cost), money(holding.cost / holding.quantity), money(holding.close) + (holding.stale ? " (last close)" : ""), money(holding.close * holding.quantity), <Profit value={holding.pnl} />])} />
        </section>
      </div>
    </>}
    <details className={styles.assumptions}><summary>Trading rules and fill assumptions</summary>
      <p>{breakout
        ? "Signals require a close above the 50-session moving average and prior 20-session high, plus positive 63-session outperformance. Exit after a close below the 20-session average or 20 holding sessions. Fills use the next open, fractional shares, 0.10% fees and 0.10% slippage per side. The ₹10,000 buy budget includes fees. Unused budget stays in cash."
        : "Rank new baskets using the prior close and the last available market session at or before the 65-day cutoff. Exit at month end or at a basket MTM of −₹50,000 or +₹1,00,000. Fills use closing prices, fractional shares, zero fees, and no funding cap."}</p>
    </details>
  </div>;
}
