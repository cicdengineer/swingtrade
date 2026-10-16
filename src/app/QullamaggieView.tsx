"use client";
import { useEffect, useMemo, useState } from "react";
import { defaultQFilters, openingRangeSignal, positionSize, type QFilters, type QPoint, type QRow, type QStage } from "@/lib/qullamaggieLogic";
import OpeningEntryPanel from "./OpeningEntryPanel";
import "./qullamaggie.css";

type Response = { filters: QFilters; evaluated: number; qualified: number; missingData: number; latestDataDate: string | null; results: QRow[]; generatedAt: string; priceAdjustmentStatus: string };
type Backtest = { configuration: { fillModel: string; universeBasis: string }; summary: { signals: number; winRate: number; averageWinR: number; averageLossR: number; averageR: number; expectancyR: number; maximumDrawdownR: number; profitFactor: number | null; averageHoldingSessions: number } };
type Sort = "tightness" | "return3m" | "volume" | "distance" | "breakout" | "stop" | "setup";
type SharedSettings = { totalCapital: number; riskPercent: number; partialPercent: number; partialStartDay: number; partialEndDay: number; partialMinR: number; defaultTrailMA: "10 EMA" | "20 EMA" | "Manual"; moveStopToBreakevenAfterPartial: boolean; exitConfirmationRule: string };
type EntrySignal = ReturnType<typeof openingRangeSignal>;
const stages: (QStage | "All qualifying stocks" | "Breakout Today")[] = ["All qualifying stocks", "Tight Consolidation", "Near Breakout", "Breakout Today", "Extended / Missed Entry"];
const fmt = (n?: number | null, digits = 1) => n == null || !Number.isFinite(n) ? "—" : n.toFixed(digits);
const currency = (n?: number) => n === undefined ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const numberKeys: { title: string; key: keyof QFilters; step?: string }[] = [
  { title: "1M return %", key: "min1m" }, { title: "3M return %", key: "min3m" }, { title: "6M return %", key: "min6m" },
  { title: "Base min days", key: "minBaseDays" }, { title: "Base max days", key: "maxBaseDays" }, { title: "Base max depth %", key: "maxDepth" }, { title: "Last 5D range %", key: "max5Range" },
  { title: "Volume max ratio", key: "maxVolumeRatio", step: "0.05" }, { title: "3M high distance %", key: "maxHighDistance" }, { title: "Near breakout %", key: "nearBreakout", step: "0.5" },
  { title: "Tightness min", key: "minTightness" }, { title: "Max stop × ADR", key: "maxStopAdr", step: "0.1" }, { title: "Max exposure %", key: "maxExposurePct" },
];
const switches: { title: string; key: keyof QFilters }[] = [
  { title: "1M momentum", key: "oneMonth" }, { title: "3M momentum", key: "threeMonth" }, { title: "6M momentum", key: "sixMonth" },
  { title: "Above 50 SMA", key: "above50" }, { title: "10 EMA > 20 EMA", key: "emaStack" }, { title: "Rising 20 EMA", key: "rising20" }, { title: "Above 10 EMA", key: "above10" },
  { title: "Shrinking volatility", key: "shrinkingVolatility" }, { title: "Volume contraction", key: "contractingVolume" }, { title: "Near 3M high", key: "nearHigh" },
];
function Spark({ row }: { row: QRow }) {
  const points = row.recent.slice(-63);
  if (points.length < 2) return <div className="q-empty-chart">No chart data</div>;
  const low = Math.min(...points.map(p => p.low), row.baseLow ?? Infinity), high = Math.max(...points.map(p => p.high), row.resistance ?? 0);
  const y = (value: number) => 76 - (value - low) / Math.max(0.01, high - low) * 68;
  const path = points.map((p, i) => `${i ? "L" : "M"}${i * 220 / (points.length - 1)},${y(p.close).toFixed(1)}`).join(" ");
  const emaPath = points.map((p, i) => p.ema10 ? `${i && points[i - 1].ema10 ? "L" : "M"}${i * 220 / (points.length - 1)},${y(p.ema10).toFixed(1)}` : "").join(" ");
  const start = points.findIndex(p => p.trade_date === row.baseStart);
  const entryIndex = row.breakoutDate ? points.findIndex(p => p.trade_date === row.breakoutDate) : -1;
  return <svg viewBox="0 0 220 80" preserveAspectRatio="none" role="img" aria-label={`${row.symbol} three month price chart`}>
    {start >= 0 && <rect x={start * 220 / (points.length - 1)} y="2" width={220 - start * 220 / (points.length - 1)} height="76" className="q-zone" />}
    {row.resistance && <line x1="0" x2="220" y1={y(row.resistance)} y2={y(row.resistance)} className="q-resistance" />}
    <path d={path} className="q-spark" />
    <path d={emaPath} className="q-ema10" />
    {entryIndex >= 0 && <polygon className="q-entry" points={`${entryIndex * 220 / (points.length - 1)},${Math.min(70, y(points[entryIndex].low) + 3)} ${entryIndex * 220 / (points.length - 1) - 3},${Math.min(78, y(points[entryIndex].low) + 9)} ${entryIndex * 220 / (points.length - 1) + 3},${Math.min(78, y(points[entryIndex].low) + 9)}`} />}
  </svg>;
}
function DetailChart({ row, timeframe, entrySignal }: { row: QRow; timeframe: "daily" | "hourly" | "intraday"; entrySignal: EntrySignal | null }) {
  const [candles, setCandles] = useState<(QPoint & { date: string })[]>([]), [status, setStatus] = useState("");
  useEffect(() => {
    if (timeframe === "daily") return;
    const controller = new AbortController();
    setStatus("Loading intraday candles…"); setCandles([]);
    const interval = timeframe === "hourly" ? 60 : 1;
    fetch(`/api/qullamaggie-screener/${encodeURIComponent(row.security_id)}/intraday?interval=${interval}&days=${timeframe === "hourly" ? 30 : 5}`, { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Intraday data unavailable"); return data; })
      .then(data => { const items = (data.candles ?? []).map((c: { trade_date?: string; date?: string; open: number; high: number; low: number; close: number; volume: number }) => ({ ...c, date: c.date ?? "", trade_date: c.trade_date ?? c.date ?? "" })); setCandles(items); setStatus(items.length ? "" : "Intraday data required"); })
      .catch(e => { if (e.name !== "AbortError") setStatus("Intraday data required: " + e.message); });
    return () => controller.abort();
  }, [row.security_id, timeframe]);
  const points = timeframe === "daily" ? row.recent.slice(-126) : candles.slice(timeframe === "intraday" ? -420 : -120);
  if (status && timeframe !== "daily") return <div className="q-empty-chart">{status}</div>;
  if (points.length < 2) return <div className="q-empty-chart">Insufficient chart data</div>;
  const low = Math.min(...points.map(p => p.low), row.resistance ?? Infinity), high = Math.max(...points.map(p => p.high), row.resistance ?? 0);
  const y = (v: number) => 248 - (v - low) / Math.max(0.01, high - low) * 220;
  const slot = 780 / points.length, maxVol = Math.max(1, ...points.map(p => p.volume));
  let runningEma: number | undefined;
  const emaValues = points.map((p, i) => {
    if (timeframe === "daily" && p.ema10) return p.ema10;
    if (i === 0) { runningEma = p.close; return undefined; }
    runningEma = p.close * (2 / 11) + runningEma! * (9 / 11);
    return i >= 9 ? runningEma : undefined;
  });
  const emaPath = emaValues.map((value, i) => value === undefined ? "" : `${i > 0 && emaValues[i - 1] !== undefined ? "L" : "M"}${(i + .5) * slot},${y(value)} `).join("");
  const dailyEntry = timeframe === "daily" && row.breakoutDate ? points.findIndex(p => p.trade_date === row.breakoutDate) : -1;
  const intradayEntry = timeframe === "intraday" && entrySignal?.status === "Fresh ORH cross" && entrySignal.signalTime ? points.findIndex(p => new Date(p.trade_date).getTime() === new Date(entrySignal.signalTime!).getTime()) : -1;
  const entryIndex = intradayEntry >= 0 ? intradayEntry : dailyEntry;
  const entryPrice = intradayEntry >= 0 ? entrySignal?.entry : row.signalPrice;
  return <div className="q-chart-wrap"><svg viewBox="0 0 780 260" role="img" aria-label={`${timeframe} candlestick chart with 10 EMA and entry marker`}>
    {row.resistance && <line className="q-resistance" x1="0" x2="780" y1={y(row.resistance)} y2={y(row.resistance)} />}
    {points.map((p, i) => <g key={`${p.trade_date}-${i}`} className={p.close >= p.open ? "q-up" : "q-down"}>
      <title>{`${p.trade_date} O ${fmt(p.open, 2)} H ${fmt(p.high, 2)} L ${fmt(p.low, 2)} C ${fmt(p.close, 2)}`}</title>
      <line x1={(i + .5) * slot} x2={(i + .5) * slot} y1={y(p.high)} y2={y(p.low)} />
      <rect x={(i + .5) * slot - Math.max(1, slot * .27)} y={Math.min(y(p.open), y(p.close))} width={Math.max(2, slot * .54)} height={Math.max(1, Math.abs(y(p.open) - y(p.close)))} />
    </g>)}
    <path className="q-ema10" d={emaPath} />
    {entryIndex >= 0 && entryPrice && <polygon className="q-entry" points={`${(entryIndex + .5) * slot},${Math.min(249, y(entryPrice) + 6)} ${(entryIndex + .5) * slot - 5},${Math.min(257, y(entryPrice) + 15)} ${(entryIndex + .5) * slot + 5},${Math.min(257, y(entryPrice) + 15)}`}><title>Entry signal {currency(entryPrice)}</title></polygon>}
  </svg><div className="q-volume-strip" aria-label="Volume"><svg viewBox="0 0 780 64" role="img" aria-label="Volume bars">{points.map((p, i) => <rect key={`${p.trade_date}-${i}`} x={i * slot + 1} y={62 - p.volume / maxVol * 57} width={Math.max(1, slot - 2)} height={p.volume / maxVol * 57} className={p.close >= p.open ? "q-vol-up" : "q-vol-down"} />)}</svg></div><div className="q-chart-legend">{timeframe} candles · <span className="q-legend-ema">10 EMA</span> · <span>Resistance</span> · ▲ entry signal · Volume below</div></div>;
}
export default function QullamaggieView({ settings, onOpenSettings }: { settings?: SharedSettings | null; onOpenSettings?: () => void }) {
  const [filters, setFilters] = useState<QFilters>(defaultQFilters), [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [sort, setSort] = useState<Sort>("tightness"), [stage, setStage] = useState<(typeof stages)[number]>("All qualifying stocks"), [search, setSearch] = useState("");
  const [selected, setSelected] = useState<QRow | null>(null), [timeframe, setTimeframe] = useState<"daily" | "hourly" | "intraday">("daily"), [settingsOpen, setSettingsOpen] = useState(false);
  const [entrySignal, setEntrySignal] = useState<EntrySignal | null>(null);
  const [from, setFrom] = useState("2025-01-01"), [to, setTo] = useState("2025-12-31"), [backtest, setBacktest] = useState<Backtest | null>(null), [backtestLoading, setBacktestLoading] = useState(false);
  useEffect(() => { try { const saved = localStorage.getItem("qullamaggie-filters"); if (saved) { const stored = JSON.parse(saved) as Record<string, unknown>; const current = Object.fromEntries(Object.entries(stored).filter(([key]) => key in defaultQFilters)) as Partial<QFilters>; setFilters({ ...defaultQFilters, ...current }); } } catch {} }, []);
  useEffect(() => { localStorage.setItem("qullamaggie-filters", JSON.stringify(filters)); }, [filters]);
  async function run() {
    setLoading(true); setError("");
    try { const response = await fetch("/api/qullamaggie-screener", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters, rescan: true }) }); const json: Response & { error?: string } = await response.json(); if (!response.ok) throw new Error(json.error); const seen: string[] = JSON.parse(localStorage.getItem("qullamaggie-seen-breakouts") ?? "[]"); const keys = new Set(seen); json.results = json.results.map(row => { if (row.stage !== "Breakout Triggered") return row; const key = `${row.security_id}:${row.breakoutDate}:${row.resistance}`; if (keys.has(key)) return { ...row, stage: "Extended / Missed Entry" as const }; keys.add(key); return row; }); localStorage.setItem("qullamaggie-seen-breakouts", JSON.stringify([...keys].slice(-500))); setData(json); }
    catch (e) { setError(e instanceof Error ? e.message : "Scan failed"); } finally { setLoading(false); }
  }
  async function validateHistory() {
    setBacktestLoading(true); setError("");
    try { const response = await fetch("/api/qullamaggie-screener", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters, historical: { from, to, holdDays: 10, slippageBps: 10, costBps: 10 } }) }); const json = await response.json(); if (!response.ok) throw new Error(json.error); setBacktest(json); }
    catch (e) { setError(e instanceof Error ? e.message : "Historical validation failed"); } finally { setBacktestLoading(false); }
  }
  const shown = useMemo(() => {
    const rows = (data?.results ?? []).filter(r => (stage === "All qualifying stocks" ? r.qualifies : stage === "Breakout Today" ? r.stage === "Breakout Triggered" && r.breakoutDate === data?.latestDataDate : r.stage === stage) && r.symbol.toLowerCase().includes(search.toLowerCase()));
    return rows.sort((a, b) => {
      const v = (r: QRow) => sort === "tightness" ? r.tightness : sort === "return3m" ? r.return3m ?? -Infinity : sort === "volume" ? -(r.volumeRatio ?? Infinity) : sort === "distance" ? -(Math.abs(r.distanceToBreakout ?? Infinity)) : sort === "breakout" ? r.breakoutDate ?? "" : sort === "stop" ? -(r.stopPct ?? Infinity) : r.setupScore;
      const av = v(a), bv = v(b); return typeof av === "number" && typeof bv === "number" ? bv - av : String(bv).localeCompare(String(av));
    });
  }, [data, sort, stage, search]);
  const setNum = (key: keyof QFilters, value: number) => setFilters(f => ({ ...f, [key]: value }));
  const capital = settings?.totalCapital ?? 0;
  const riskPercent = settings?.riskPercent ?? 0;
  const sizing = selected?.signalPrice && selected.stop && settings ? positionSize(selected.signalPrice, selected.stop, capital, riskPercent, filters.maxExposurePct) : null;
  return <section className="research-page q-page">
    <div className="thirty-hero"><div><p className="eyebrow">Momentum research / NSE</p><h2>Qullamaggie Breakout Screener</h2><small>Rule based momentum, consolidation and breakout research using stored completed daily candles.</small></div><div className="thirty-hero-actions"><button className="secondary compact" onClick={() => setSettingsOpen(v => !v)}>Filters & sizing</button><button className="primary" onClick={run} disabled={loading}>{loading ? "Scanning…" : "Run / rescan"}</button></div></div>
    {error && <div className="error">{error}</div>}
    <div className="q-toolbar"><label>Watchlist<select value={filters.universe} onChange={e => setFilters({ ...filters, universe: e.target.value as QFilters["universe"] })}><option value="ALL">All current constituents</option><option value="MIDCAP">Nifty Midcap</option><option value="SMALLCAP">Nifty Smallcap</option></select></label><label>Sort<select value={sort} onChange={e => setSort(e.target.value as Sort)}><option value="tightness">Highest tightness</option><option value="return3m">Highest 3M return</option><option value="volume">Lowest volume ratio</option><option value="distance">Nearest breakout</option><option value="breakout">Recent breakout</option><option value="stop">Lowest stop %</option><option value="setup">Overall setup score</option></select></label><label>Search<input className="plain-input" placeholder="Symbol" value={search} onChange={e => setSearch(e.target.value)} /></label><label>Quick filter<select value={stage} onChange={e => setStage(e.target.value as typeof stage)}>{stages.map(s => <option key={s}>{s}</option>)}</select></label></div>
    {settingsOpen && <div className="q-settings"><div className="q-settings-head"><h3>Scan settings</h3><button className="secondary compact" onClick={() => setFilters(defaultQFilters)}>Reset defaults</button></div><div className="q-setting-grid"><label>Momentum match<select value={filters.momentumMode} onChange={e => setFilters({ ...filters, momentumMode: e.target.value as QFilters["momentumMode"] })}><option value="ANY">Any enabled period</option><option value="ALL">All enabled periods</option></select></label><label>Entry mode<select value={filters.entryMode} onChange={e => setFilters({ ...filters, entryMode: e.target.value as QFilters["entryMode"] })}><option value="ORH">Intraday opening range</option><option value="EOD">Daily close breakout</option></select></label><label>Opening range<select value={filters.openingMinutes} onChange={e => setNum("openingMinutes", Number(e.target.value))}>{[1,5,10,15].map(n => <option key={n} value={n}>{n} minutes</option>)}</select></label>{numberKeys.map(item => <label key={item.key}>{item.title}<input className="plain-input" type="number" min="0" step={item.step ?? "1"} value={filters[item.key] as number} onChange={e => setNum(item.key, Number(e.target.value))} /></label>)}</div><div className="q-switches">{switches.map(item => <label key={item.key}><input type="checkbox" checked={Boolean(filters[item.key])} onChange={e => setFilters({ ...filters, [item.key]: e.target.checked })} />{item.title}</label>)}<label><input type="checkbox" checked={filters.showDiagnostics} onChange={e => setFilters({ ...filters, showDiagnostics: e.target.checked })} />Show diagnostics</label></div><p className="muted">Thresholds are configurable research rules inspired by momentum breakout trading. Capital, risk, partial exit and trailing rules come from Settings. {onOpenSettings && <button type="button" className="q-text-button" onClick={onOpenSettings}>Open Settings</button>}</p></div>}
    {data && <><div className="q-stats"><span><b>{data.evaluated}</b> evaluated</span><span><b>{data.qualified}</b> momentum leaders</span><span><b>{data.missingData}</b> missing history</span><span><b>{data.latestDataDate ?? "—"}</b> data through</span><span><b>{shown.length}</b> shown</span></div><p className="q-data-note">Stored OHLCV · {data.priceAdjustmentStatus}. Provisional candles excluded. Recheck adjustment status before trading.</p><div className="q-grid">{shown.map(row => <button type="button" className="q-tile" key={row.security_id} onClick={() => { setEntrySignal(null); setSelected(row); setTimeframe("daily"); }}><span className="q-tile-top"><strong>{row.symbol}</strong><em>{row.stage}</em></span><small>{row.company_name}</small><Spark row={row} /><div className="q-tile-metrics"><span>Close <b>{currency(row.close)}</b></span><span>3M <b>{fmt(row.return3m)}%</b></span><span>Base <b>{row.baseDays ?? "—"}d / {fmt(row.baseDepth)}%</b></span><span>Tight <b>{row.tightness}</b></span><span>Volume <b>{fmt(row.volumeRatio, 2)}×</b></span><span>Distance <b>{fmt(row.distanceToBreakout)}%</b></span><span>Resistance <b>{currency(row.resistance)}</b></span></div></button>)}</div>{shown.length === 0 && <div className="q-empty-chart">No stocks match these settings.</div>}</>}
    {!data && <div className="q-empty-chart">Select a watchlist and run the screener.</div>}
    <div className="q-settings"><div className="q-settings-head"><h3>Historical EOD validation</h3><button className="secondary compact" disabled={backtestLoading} onClick={validateHistory}>{backtestLoading ? "Running…" : "Run validation"}</button></div><div className="q-toolbar"><label>From<input className="plain-input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To<input className="plain-input" type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div><p className="muted">10-session hold · 10 bps entry and exit slippage · 10 bps transaction cost per side. Daily signals only.</p>{backtest && <><div className="q-stats"><span><b>{backtest.summary.signals}</b> signals</span><span><b>{fmt(backtest.summary.winRate)}%</b> win rate</span><span><b>{fmt(backtest.summary.averageWinR, 2)}R</b> average win</span><span><b>{fmt(backtest.summary.averageLossR, 2)}R</b> average loss</span><span><b>{fmt(backtest.summary.averageR, 2)}R</b> average / expectancy</span><span><b>{fmt(backtest.summary.maximumDrawdownR, 2)}R</b> max drawdown</span><span><b>{fmt(backtest.summary.profitFactor, 2)}</b> profit factor</span><span><b>{fmt(backtest.summary.averageHoldingSessions, 1)}</b> holding sessions</span></div><p className="muted">{backtest.configuration.fillModel}. {backtest.configuration.universeBasis}.</p></>}</div>
    {selected && <div className="drawer" onClick={() => setSelected(null)}><div className="drawer-card chart-drawer q-drawer" onClick={e => e.stopPropagation()}>
      <button className="icon-button drawer-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
      <p className="eyebrow">{selected.stage} · {selected.dataDate}</p><h2>{selected.symbol} · {selected.company_name}</h2>
      <div className="q-detail-metrics q-top-metrics"><span>Daily resistance<b>{currency(selected.resistance)}</b></span><span>10 EMA<b>{currency(selected.ema10)}</b></span><span>Base support<b>{currency(selected.baseLow)}</b></span><span>Setup score<b>{selected.setupScore}</b></span></div>
      {settings ? <p className="q-settings-source">Sizing from Settings: {currency(capital)} capital · {fmt(riskPercent, 2)}% per trade ({currency(capital * riskPercent / 100)} risk budget) · {fmt(filters.maxExposurePct, 0)}% maximum exposure. {onOpenSettings && <button type="button" className="q-text-button" onClick={onOpenSettings}>Edit Settings</button>}</p> : <p className="q-entry-message">Trading Settings are unavailable. Save capital and risk on the Settings page to see quantities. {onOpenSettings && <button type="button" className="q-text-button" onClick={onOpenSettings}>Open Settings</button>}</p>}
      {filters.entryMode === "ORH" ? <OpeningEntryPanel row={selected} filters={filters} capital={capital} riskPercent={riskPercent} onSignal={setEntrySignal} /> : <><p className="muted">{selected.breakoutDate ? `EOD signal on ${selected.breakoutDate} at ${currency(selected.signalPrice)}. The next-session fill and quantity must be recalculated.` : "No completed daily breakout cross. EOD entry remains untriggered."}</p>{sizing && <div className="entry-sizing-grid"><div className="entry-sizing-tile good"><div><span>EOD reference sizing</span><strong>{sizing.quantity.toLocaleString("en-IN")} qty</strong><small>{currency(sizing.positionValue)} position</small></div><div><span>Indicative SL</span><b>{currency(selected.stop)}</b><small>{currency(selected.signalPrice! - selected.stop!)} risk per share</small></div></div><div className="entry-sizing-tile"><div><span>Reference entry</span><strong>{currency(selected.signalPrice)}</strong><small>{currency(sizing.riskAmount)} risk budget</small></div><div><span>Planned loss</span><b>{currency(sizing.quantity * (selected.signalPrice! - selected.stop!))}</b><small>{sizing.warning || "At reference entry only"}</small></div></div></div>}<button className="secondary compact" onClick={() => setFilters({ ...filters, entryMode: "ORH" })}>Use opening-range entry</button></>}
      <div className="q-detail-tabs">{(["daily", "hourly", "intraday"] as const).map(t => <button key={t} className={timeframe === t ? "active" : ""} onClick={() => setTimeframe(t)}>{t}</button>)}</div>
      <DetailChart row={selected} timeframe={timeframe} entrySignal={entrySignal} />
      <div className="q-detail-metrics"><span>ATR / ADR<b>{currency(selected.atr20)} / {fmt(selected.adr20)}%</b></span><span>20D / 50D avg vol<b>{fmt(selected.averageVolume20, 0)} / {fmt(selected.averageVolume50, 0)}</b></span><span>Breakout distance<b>{fmt(selected.distanceToBreakout)}%</b></span></div>
      <h3>How to use this entry</h3><p className="muted">{filters.entryMode === "ORH" ? "The opening-range panel checks completed 1-minute candles every 30 seconds while this popup is open. After a cross it shows an indicative entry, stop and quantity. " : "An EOD signal uses a completed daily close above resistance and the breakout day's low as its indicative stop. "}Risk per share is entry minus stop; quantity is limited by both your Settings risk budget and the scan exposure cap. Verify the live price before placing an order. No order is placed here.</p>
      <h3>Trade management plan</h3><p className="muted">Settings plan: {settings ? `${settings.partialPercent}% partial on days ${settings.partialStartDay}–${settings.partialEndDay} after ${settings.partialMinR}R; ${settings.moveStopToBreakevenAfterPartial ? "move the remaining stop to breakeven; " : ""}trail with ${settings.defaultTrailMA} using ${settings.exitConfirmationRule.toLowerCase()} confirmation` : "save your partial and trailing preferences in Settings"}. Review the plan against your actual fill and stop.</p>
      <h3>Scan diagnostics</h3><div className="q-diagnostics">{selected.diagnostics.map((d, i) => <span key={i} className={d.pass ? "pass" : "fail"}>{d.pass ? "✓" : "×"} {d.label}</span>)}</div>
    </div></div>}
  </section>;
}
