"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { BacktestConfig, BacktestResult } from "@/lib/screenerBacktest";
import type { EntrySizingSettings } from "@/lib/entrySizing";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format;
const pct = (n: number | null) => n === null ? "—" : `${n.toFixed(2)}%`;
const fixed = (n: number) => n.toFixed(2);
const indiaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const controls = [
  ["holdoutPct", "Holdout (%)", 30, 20, 50, 1],
  ["drawdownBudget", "Drawdown budget (%)", 8, 0.1, 100, 0.1],
  ["minTrades", "Minimum development exits", 15, 1, 500, 1],
  ["feeBps", "Fees per side (bps)", 15, 0, 250, 1],
  ["slippageBps", "Slippage per side (bps)", 10, 0, 250, 1],
  ["openRiskPct", "Portfolio entry-risk cap (%)", 1, 0.01, 10, 0.01],
  ["maxExposurePct", "Entry exposure cap (%)", 60, 1, 100, 1],
  ["maxPositionPct", "Position cap (%)", 12, 1, 100, 1],
  ["maxPositions", "Open positions", 6, 1, 30, 1],
  ["maxNew", "New entries per session", 2, 1, 30, 1],
  ["maxHold", "Maximum holding sessions", 40, 2, 252, 1],
  ["minTurnoverCr", "Minimum 20-day turnover (₹ crore)", 10, 0, 10000, 1],
  ["breadthPct", "Minimum breadth (%)", 55, 0, 100, 1],
  ["protectR", "Start trailing at (R)", 1.5, 0, 20, 0.1],
  ["maxGapPct", "Maximum next-close move (%)", 2, 0, 20, 0.1],
  ["minVolume", "Minimum breakout volume ratio", 1.5, 0.1, 20, 0.1],
  ["maxStopPct", "Maximum initial stop distance (%)", 5, 1, 25, 0.1],
] as const;

function Table({ headers, rows, empty = "No records for this session." }: { headers: string[]; rows: (string | number)[][]; empty?: string }) {
  if (!rows.length) return <p className="panel-empty">{empty}</p>;
  return <div style={{ overflowX: "auto" }}><table><thead><tr>{headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function EquityChart({ snapshots, index, capital }: { snapshots: BacktestResult["validation"]["snapshots"]; index: number; capital: number }) {
  const visible = snapshots.slice(0, index + 1);
  const values = [capital, ...visible.flatMap(day => day.benchmark === null ? [day.equity] : [day.equity, day.benchmark])];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const x = (i: number) => 14 + 692 * i / Math.max(1, snapshots.length - 1);
  const y = (n: number) => high === low ? 80 : 145 - 130 * (n - low) / (high - low);
  const points = (select: (day: typeof visible[number]) => number | null) => visible.map((day, i) => {
    const value = select(day);
    return value === null ? null : `${x(i)},${y(value)}`;
  }).filter(Boolean).join(" ");
  return <section className="panel dashboard-panel">
    <div className="panel-head"><h3>Holdout equity</h3><small>Strategy · blue | Price index · gold</small></div>
    <svg width="100%" viewBox="0 0 720 160" role="img" aria-label="Strategy and benchmark equity curves through the selected session">
      <line x1="14" x2="706" y1={y(capital)} y2={y(capital)} stroke="currentColor" opacity=".2" />
      <polyline points={points(day => day.benchmark)} stroke="#bf8b29" strokeWidth="2" fill="none" />
      <polyline points={points(day => day.equity)} stroke="#3a8ff0" strokeWidth="3" fill="none" />
      <circle cx={x(index)} cy={y(snapshots[index].equity)} r="4" fill="#3a8ff0" />
    </svg>
    <small>{money(low)} to {money(high)}</small>
  </section>;
}

function DrawdownChart({ snapshots, index, budget }: { snapshots: BacktestResult["validation"]["snapshots"]; index: number; budget: number }) {
  const visible = snapshots.slice(0, index + 1);
  const depth = Math.max(budget, ...visible.map(day => day.drawdown));
  const path = visible.map((day, i) => `${14 + 692 * i / Math.max(1, snapshots.length - 1)},${15 + 130 * day.drawdown / depth}`).join(" ");
  const budgetY = 15 + 130 * budget / depth;
  return <section className="panel dashboard-panel">
    <div className="panel-head"><h3>Holdout drawdown · {pct(snapshots[index].drawdown)}</h3><small>Dashed line · {pct(budget)} budget</small></div>
    <svg width="100%" viewBox="0 0 720 160" role="img" aria-label="Drawdown history and budget through the selected session">
      <line x1="14" x2="706" y1={budgetY} y2={budgetY} stroke="currentColor" opacity=".5" strokeDasharray="6 4" />
      <polyline points={path} stroke="#e46b58" strokeWidth="3" fill="none" />
    </svg>
  </section>;
}

const metricRow = (label: string, m: BacktestResult["validation"]["metrics"]) => [
  label, pct(m.returnPct), pct(m.annualizedReturn), pct(m.drawdown), m.trades, pct(m.winRate),
  m.profitFactor === null ? "—" : fixed(m.profitFactor), fixed(m.expectancyR), pct(m.exposure), money(m.costs),
];
const metricHeaders = ["Strategy", "Net return", "CAGR", "Max drawdown", "Exits", "Win rate", "Profit factor", "Net R / trade", "Avg exposure", "Paid costs"];

export default function BacktestingView({ settings }: { settings: EntrySizingSettings | null }) {
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const endDate = indiaToday();
    return { startDate: `${Number(endDate.slice(0, 4)) - 3}${endDate.slice(4).replace("-02-29", "-02-28")}`, endDate,
      universe: "CNX500", mode: "compare", totalCapital: "", riskPercent: "", trailEma: "20",
      ...Object.fromEntries(controls.map(([key, , initial]) => [key, String(initial)])) };
  });
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const last = (result?.validation.snapshots.length ?? 1) - 1;
  const set = (key: string, value: string) => setFields(before => ({ ...before, [key]: value }));
  const jump = (next: number) => { setPlaying(false); setIndex(next); };

  useEffect(() => {
    if (!playing || index >= last) return;
    const timer = window.setTimeout(() => {
      setIndex(index + 1);
      if (index + 1 === last) setPlaying(false);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [playing, index, last]);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setPlaying(false);
    setResult(null);
    setError("");
    const config = {
      startDate: fields.startDate, endDate: fields.endDate, universe: fields.universe, mode: fields.mode,
      totalCapital: fields.totalCapital ? Number(fields.totalCapital) : undefined,
      riskPercent: fields.riskPercent ? Number(fields.riskPercent) : undefined,
      trailEma: Number(fields.trailEma),
      ...Object.fromEntries(controls.map(([key]) => [key, Number(fields[key])])),
    } satisfies Partial<Record<keyof BacktestConfig, string | number | undefined>>;
    try {
      const response = await fetch("/api/backtesting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data);
      setIndex(data.validation.snapshots.length - 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backtest failed.");
    } finally {
      setLoading(false);
    }
  }

  const session = result?.validation.snapshots[index];
  const metrics = result?.validation.metrics;
  return <section className="portfolio-page backtest-page">
    <form className="panel dashboard-panel" onSubmit={run}>
      <div className="data-toolbar"><div><h2>Swing strategy research</h2><small>Compare setup quality, portfolio drawdown and net returns on chronological data.</small></div>
        <button className="primary" disabled={loading}>{loading ? "Running research…" : "Run comparison"}</button>
      </div>
      <div className="settings-grid">
        <label>Start date<input required className="plain-input" type="date" max={fields.endDate} value={fields.startDate} onChange={e => set("startDate", e.target.value)} /></label>
        <label>End date<input required className="plain-input" type="date" min={fields.startDate} max={indiaToday()} value={fields.endDate} onChange={e => set("endDate", e.target.value)} /></label>
        <label>Universe<select value={fields.universe} onChange={e => set("universe", e.target.value)}><option value="CNX500">Nifty 500</option><option value="NIFTYSC500">Nifty Smallcap 500</option></select></label>
        <label>Setup<select value={fields.mode} onChange={e => set("mode", e.target.value)}><option value="compare">Compare four presets</option><option value="catchup">10 EMA Catchup</option><option value="breakout">30 in 30 breakout</option><option value="blend">Catchup + breakout</option><option value="gain">Highest session gain</option></select></label>
        <label>Capital (₹)<input className="plain-input" type="number" min="1" step="any" value={fields.totalCapital} placeholder={settings ? String(settings.totalCapital) : "Trading Settings"} onChange={e => set("totalCapital", e.target.value)} /></label>
        <label>Risk per trade (%)<input className="plain-input" type="number" min=".001" max="5" step="any" value={fields.riskPercent} placeholder={settings ? String(Math.min(settings.riskPercent, 0.25)) : "Trading Settings · capped at 0.25%"} onChange={e => set("riskPercent", e.target.value)} /></label>
      </div>
      <details><summary>Execution, risk and validation settings</summary>
        <div className="settings-grid">{controls.map(([key, label, , min, max, step]) => <label key={key}>{label}<input required className="plain-input" type="number" min={min} max={max} step={step} value={fields[key]} onChange={e => set(key, e.target.value)} /></label>)}
          <label>Trailing EMA<select value={fields.trailEma} onChange={e => set("trailEma", e.target.value)}><option value="20">20 EMA</option><option value="10">10 EMA</option></select></label>
        </div>
      </details>
      <details><summary>How the research works</summary>
        <p>Catchup requires a rising 50 EMA, the screener’s 10 EMA Catchup pattern and a close above the previous high. Breakouts require a 30% move within 30 sessions during the scan window, a close above the prior 20-session high and volume expansion. Ranking favors 63-session momentum, tight bases, modest extension and short stop distance. Breadth measures the share of covered constituents above their 50 EMA.</p>
        <p>Orders queue after a completed close for the next session. The model sizes and checks entry limits at that next close. A stop breach queues an exit for the following tradable close, so losses can exceed planned risk. Fees and slippage are estimated on both sides. Trailing stops only tighten. Open holdings are marked net of estimated exit costs.</p>
        <p>The highest-gain baseline uses the three original candle filters across the selected universe, with the same execution and portfolio limits and no breadth gate. The holdout starts from cash. Repeated parameter changes after inspecting a holdout make it part of strategy development. Current constituents can introduce survivorship bias. The available comparison index is price-only and excludes dividends.</p>
      </details>
    </form>
    {error && <p role="alert" className="error">{error}</p>}
    {result && session && metrics && <>
      <section className="panel dashboard-panel">
        <div className="panel-head"><div><h2>{result.validated ? "Passed this holdout" : "No setup passed every validation check"}</h2><p>Development selection · {result.selected.variant.label}</p></div></div>
        <ul>{result.validationChecks.map(check => <li key={check.label}><strong>{check.passed ? "Pass" : "Fail"}</strong> · {check.label}</li>)}</ul><p><small>Drawdown budget {pct(result.config.drawdownBudget)}</small></p>
        <p><small>{result.coveredStocks}/{result.universeSize} constituents covered · {result.verifiedStocks} marked adjusted or verified · {metrics.open} open at period end{!result.sufficientBreadth && " · Insufficient breadth coverage"}{metrics.benchmark === null && " · No index closes on one or both holdout endpoints"}</small></p>
        <p><small>Selected settings · {result.selected.variant.breadth}% breadth · {result.selected.variant.maxStop}% max stop · {result.selected.variant.volume}× breakout volume · {result.selected.variant.trail} EMA trail · {result.config.riskPercent}% equity risk per trade</small></p>
      </section>
      <section className="panel dashboard-panel"><h3>Development · {result.development.from} to {result.development.through}</h3>
        <Table headers={[...metricHeaders, "Return / drawdown", "Eligible"]} rows={result.comparison.map(row => [...metricRow(row.variant.label, row.metrics), fixed(row.score), row.eligible ? "Yes" : "No"])} />
      </section>
      <section className="panel dashboard-panel"><h3>Holdout · {result.holdout.from} to {result.holdout.through}</h3>
        <Table headers={metricHeaders} rows={[
          metricRow(result.selected.variant.label, metrics),
          metricRow("Highest-gain baseline", result.benchmarkBaseline),
          metricRow("Selected setup · double costs", result.stressed),
          ["Buy and hold price index", pct(metrics.benchmark), "—", pct(metrics.benchmarkDrawdown), "—", "—", "—", "—", "—", "—"],
        ]} />
      </section>
      <div className="dashboard-grid">
        <EquityChart snapshots={result.validation.snapshots} index={index} capital={result.config.totalCapital} />
        <DrawdownChart snapshots={result.validation.snapshots} index={index} budget={result.config.drawdownBudget} />
      </div>
      <section className="panel dashboard-panel">
        <div className="data-toolbar"><div><h3>{session.date} · Session {index + 1} of {last + 1}</h3>
          <small>Equity {money(session.equity)} · Cash {money(session.cash)} · Drawdown {pct(session.drawdown)} · Open risk {money(session.openRisk)} · Breadth {pct(session.breadth)}</small></div>
          <div className="toolbar-actions">
            <button className="secondary compact" onClick={() => jump(0)}>First</button>
            <button className="secondary compact" disabled={index === 0} onClick={() => jump(index - 1)}>Previous</button>
            <button className="primary compact" onClick={() => { if (!playing && index === last) setIndex(0); setPlaying(!playing); }}>{playing ? "Pause" : "Play"}</button>
            <button className="secondary compact" disabled={index === last} onClick={() => jump(index + 1)}>Next</button>
            <button className="secondary compact" onClick={() => jump(last)}>Last</button>
          </div>
        </div>
        <label>Replay session <input type="range" style={{ width: "100%" }} min={0} max={last} value={index} onChange={e => jump(Number(e.target.value))} /></label>
      </section>
      <section className="panel dashboard-panel"><h3>Session events</h3><Table headers={["Stock", "Event", "Reason", "Price", "Shares", "Net P&L"]} rows={session.events.map(event => [event.symbol, event.action, event.reason, event.price > 0 ? fixed(event.price) : "—", event.quantity, event.pnl === undefined ? "—" : money(event.pnl)])} /></section>
      <section className="panel dashboard-panel"><h3>Orders queued for the next session</h3><Table headers={["Stock", "Setup", "Ranking score"]} rows={session.signals.map(signal => [signal.symbol, signal.setup, fixed(signal.score)])} /></section>
      <section className="panel dashboard-panel"><h3>Holdings at the close</h3><Table headers={["Stock", "Entry date", "Shares", "Close", "Stop", "Net MTM", "Status"]} rows={session.holdings.map(pos => [pos.symbol, pos.entryDate, pos.quantity, fixed(pos.close), fixed(pos.stop), money(pos.pnl), [pos.pending && "Exit queued", pos.stale && "Stale close"].filter(Boolean).join(" · ") || "Open"])} /></section>
    </>}
  </section>;
}
