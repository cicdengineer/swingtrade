"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { BacktestConfig, BacktestResult } from "@/lib/screenerBacktest";
import type { EntrySizingSettings } from "@/lib/entrySizing";

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const money = (value: number) => rupees.format(value);
const price = (value: number) => value.toFixed(2);
const pct = (value: number) => `${value.toFixed(2)}%`;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function defaultDates() {
  const endDate = today();
  const [year, month, day] = endDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return { startDate: new Date(Date.UTC(year - 1, month - 1, Math.min(day, lastDay))).toISOString().slice(0, 10), endDate };
}

function Curve({ values, index, label, format }: { values: number[]; index: number; label: string; format: (value: number) => string }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => 8 + i * 584 / Math.max(1, values.length - 1);
  const y = (value: number) => max === min ? 55 : 100 - (value - min) * 90 / (max - min);
  return <section className="panel dashboard-panel">
    <h3>{label} · {format(values[index])}</h3>
    <svg viewBox="0 0 600 110" width="100%" role="img" aria-label={label}>
      <polyline points={values.slice(0, index + 1).map((value, i) => `${x(i)},${y(value)}`).join(" ")} fill="none" stroke="#3a8ff0" strokeWidth="2.5" />
      <circle cx={x(index)} cy={y(values[index])} r="4" fill="#3a8ff0" />
    </svg>
    <small>Range {format(min)} to {format(max)}</small>
  </section>;
}

function DataTable({ headers, rows, empty }: { headers: string[]; rows: (string | number)[][]; empty: string }) {
  if (!rows.length) return <p className="panel-empty">{empty}</p>;
  return <div style={{ overflowX: "auto" }}><table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

export default function BacktestingView({ settings }: { settings: EntrySizingSettings | null }) {
  const [fields, setFields] = useState(() => ({
    ...defaultDates(), universe: "ALL", totalCapital: "", riskPercent: "", openRiskPct: "1.5", mtmTarget: "100000",
    volumeRatio: "1.5", maxEntries: "0", stopMode: "cost", riskSizing: "full", cashSizing: "fit",
  }));
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(400);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lastIndex = (result?.snapshots.length ?? 1) - 1;
  const set = (key: keyof typeof fields, value: string) => setFields(current => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!playing || index >= lastIndex) return;
    const timer = window.setTimeout(() => {
      const next = index + 1;
      setIndex(next);
      if (next >= lastIndex) setPlaying(false);
    }, speed);
    return () => window.clearTimeout(timer);
  }, [playing, index, lastIndex, speed]);

  async function run(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setPlaying(false);
    setError("");
    setResult(null);
    const config: Partial<BacktestConfig> = {
      startDate: fields.startDate, endDate: fields.endDate, universe: fields.universe as BacktestConfig["universe"],
      stopMode: fields.stopMode as BacktestConfig["stopMode"],
      riskSizing: fields.riskSizing as BacktestConfig["riskSizing"],
      cashSizing: fields.cashSizing as BacktestConfig["cashSizing"],
      totalCapital: fields.totalCapital === "" ? undefined : Number(fields.totalCapital),
      riskPercent: fields.riskPercent === "" ? undefined : Number(fields.riskPercent),
      openRiskPct: Number(fields.openRiskPct), mtmTarget: Number(fields.mtmTarget),
      volumeRatio: Number(fields.volumeRatio), maxEntries: Number(fields.maxEntries),
    };
    try {
      const response = await fetch("/api/backtesting", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data);
      setIndex(data.snapshots.length - 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backtesting failed.");
    } finally {
      setLoading(false);
    }
  }

  const numbers = [
    ["totalCapital", "Capital (₹)", settings?.totalCapital, 1],
    ["riskPercent", "Risk per trade (%)", settings?.riskPercent, 0.001],
    ["openRiskPct", "Maximum open risk (%)", undefined, 0.001],
    ["mtmTarget", "Portfolio MTM trigger (₹, 0 disables)", undefined, 0],
    ["volumeRatio", "Minimum volume / 20-day average", undefined, 0.01],
    ["maxEntries", "Max new positions per day (0 unlimited)", undefined, 0],
  ] as const;
  const day = result?.snapshots[index];
  const visible = result?.snapshots.slice(0, index + 1) ?? [];
  const closed = visible.flatMap(item => item.events.filter(event => event.action === "Sell"));
  const wins = closed.filter(event => (event.pnl ?? 0) > 0);
  const stats = day && result ? [
    ["Equity", money(day.equity)],
    ["Return", pct((day.equity / result.config.totalCapital - 1) * 100)],
    ["Maximum drawdown", pct(Math.max(...visible.map(item => item.drawdown)))],
    ["Cash", money(day.cash)],
    ["Market value", money(day.marketValue)],
    ["Realized P&L", money(day.realized)],
    ["Open MTM", money(day.unrealized)],
    ["Open risk / limit", `${money(day.openRisk)} / ${money(result.limit)}`],
    ["Closed positions", String(closed.length)],
    ["Win rate", closed.length ? pct(wins.length / closed.length * 100) : "—"],
  ] : [];

  return <section className="portfolio-page backtest-page">
    <form className="panel dashboard-panel" onSubmit={run}>
      <div className="data-toolbar"><div><h2>End-of-day screener simulation</h2><small>Capital and risk per trade default to Trading Settings. Overrides apply only to this run.</small></div>
        <button className="primary" disabled={loading}>{loading ? "Running…" : "Run backtest"}</button>
      </div>
      <div className="settings-grid">
        <label>Start date<input required className="plain-input" type="date" max={fields.endDate} value={fields.startDate} onChange={e => set("startDate", e.target.value)} /></label>
        <label>End date<input required className="plain-input" type="date" min={fields.startDate} max={today()} value={fields.endDate} onChange={e => set("endDate", e.target.value)} /></label>
        <label>Universe<select value={fields.universe} onChange={e => set("universe", e.target.value)}><option value="ALL">All tracked stocks</option><option value="CNX500">Nifty 500</option><option value="NIFTYSC500">Nifty Smallcap 500</option></select></label>
        {numbers.map(([key, label, placeholder, min]) => <label key={key}>{label}<input className="plain-input" type="number" min={min} step={key === "maxEntries" ? 1 : "any"} required={key !== "totalCapital" && key !== "riskPercent"} value={fields[key]} placeholder={placeholder === undefined ? "Use Trading Settings" : String(placeholder)} onChange={e => set(key, e.target.value)} /></label>)}
        <label>After EMA rises above entry<select value={fields.stopMode} onChange={e => set("stopMode", e.target.value)}><option value="cost">Hold stop at entry cost</option><option value="ema">Keep trailing EMA with a cost floor</option></select></label>
        <label>When open risk is limited<select value={fields.riskSizing} onChange={e => set("riskSizing", e.target.value)}><option value="full">Require full risk-sized order</option><option value="fit">Reduce quantity to fit</option></select></label>
        <label>When cash is limited<select value={fields.cashSizing} onChange={e => set("cashSizing", e.target.value)}><option value="fit">Reduce quantity to fit</option><option value="full">Require full order</option></select></label>
      </div>
      <details><summary>Simulation rules</summary><p>Uses the combined screener’s standard watchlist settings and current universe membership. Candidates must close up, meet the volume threshold, and have a low above 10 EMA. Highest session gains go first. Entries and exits fill at the session close, before fees and slippage.</p><p>Checks the previous stop first, then updates surviving stops. A close above the entry candle high protects at cost and enables the EMA rule. After stops, one top rupee winner is sold if open MTM crosses the configured threshold. Entries use the remaining cash and risk budget, measured against starting capital.</p></details>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {result && day && <>
      <section className="panel dashboard-panel">
        <div className="data-toolbar"><div><h2>{day.date}</h2><small>Session {index + 1} of {result.snapshots.length} · {result.snapshots[0].date} to {result.snapshots[lastIndex].date} · {result.coveredStocks}/{result.universeSize} stocks with data</small></div>
          <div className="toolbar-actions">
            <button className="secondary compact" onClick={() => { setPlaying(false); setIndex(0); }}>First day</button>
            <button className="secondary compact" disabled={index === 0} onClick={() => { setPlaying(false); setIndex(index - 1); }}>Previous</button>
            <button className="primary compact" disabled={lastIndex === 0} onClick={() => { if (!playing && index === lastIndex) setIndex(0); setPlaying(!playing); }}>{playing ? "Pause" : "Play"}</button>
            <button className="secondary compact" disabled={index === lastIndex} onClick={() => { setPlaying(false); setIndex(index + 1); }}>Next day</button>
            <button className="secondary compact" onClick={() => { setPlaying(false); setIndex(lastIndex); }}>Last day</button>
            <label>Speed <select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1000}>1 second</option><option value={400}>0.4 seconds</option><option value={100}>0.1 seconds</option></select></label>
          </div>
        </div>
        <label>Replay session <input style={{ width: "100%" }} type="range" min={0} max={lastIndex} value={index} onChange={e => { setPlaying(false); setIndex(Number(e.target.value)); }} /></label>
        <p><small>MTM before profit exit {money(day.mtmBeforeProfitExit)}{!result.hasSeasonalData && " · No saved seasonal observations for this universe"}</small></p>
      </section>
      <div className="stats-grid">{stats.map(([label, value]) => <section className="panel dashboard-panel" key={label}><small>{label}</small><h3>{value}</h3></section>)}</div>
      <div className="dashboard-grid">
        <Curve label="Equity" values={result.snapshots.map(item => item.equity)} index={index} format={money} />
        <Curve label="Drawdown" values={result.snapshots.map(item => -item.drawdown)} index={index} format={pct} />
        <Curve label="Open risk" values={result.snapshots.map(item => item.openRisk)} index={index} format={money} />
      </div>
      <section className="panel dashboard-panel"><h3>Session events</h3><DataTable headers={["Stock", "Action", "Reason", "Price (₹)", "Shares", "Realized P&L"]} rows={day.events.map(item => [item.symbol, item.action, item.reason, price(item.price), item.quantity, item.pnl === undefined ? "—" : money(item.pnl)])} empty="No entries, exits, or stop changes this session." /></section>
      <section className="panel dashboard-panel"><h3>Ranked candidates</h3><DataTable headers={["Rank", "Stock", "Session gain", "Volume ratio", "Watchlists", "Decision"]} rows={day.candidates.map((item, rank) => [rank + 1, item.symbol, pct(item.gain), `${item.volume.toFixed(2)}×`, item.sources.join(", "), item.decision])} empty="No screener candidates this session." /></section>
      <section className="panel dashboard-panel"><h3>End-of-day holdings</h3><DataTable headers={["Stock", "Entry date", "Shares", "Entry (₹)", "Close (₹)", "Stop (₹)", "Stop phase", "MTM", "Open risk"]} rows={day.holdings.map(item => [item.symbol, item.entryDate, item.quantity, price(item.entry), price(item.close) + (item.stale ? " (last available)" : ""), price(item.stop), item.phase, money(item.pnl), money(item.risk)])} empty="No open positions." /></section>
      <details className="panel dashboard-panel"><summary>Trade history through {day.date}</summary><DataTable headers={["Date", "Stock", "Action", "Reason", "Price (₹)", "Shares", "Realized P&L"]} rows={visible.flatMap(item => item.events.filter(event => event.action !== "Stop").map(event => [item.date, event.symbol, event.action, event.reason, price(event.price), event.quantity, event.pnl === undefined ? "—" : money(event.pnl)]))} empty="No trades yet." /></details>
    </>}
  </section>;
}
