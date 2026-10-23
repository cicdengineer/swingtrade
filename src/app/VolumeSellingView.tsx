"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, RefreshCw, X } from "lucide-react";
import type { VolumeSellingRow } from "@/lib/volumeSellingScreenerService";

type Response = { evaluated: number; qualified: number; results: VolumeSellingRow[]; generatedAt: string };
type Tick = { securityId: string; ltp: number; dayHigh?: number; prevClose?: number; receivedAt: number };
type Mode = "near" | "entry" | "all";
type Sort = "distance" | "newest" | "redVolume" | "allVolume" | "price" | "symbol";
const istDate = (value: number | string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const money = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function SignalChart({ row, months = 6 }: { row: VolumeSellingRow; months?: 3 | 6 }) {
  const points = row.recent.slice(-(months === 6 ? 126 : 63));
  if (!points.length) return null;
  const width = 900, top = 20, priceHeight = 290, volumeTop = 337, volumeHeight = 84;
  const low = Math.min(...points.map(point => point.low), row.signal_high) * 0.98;
  const high = Math.max(...points.map(point => point.high), row.signal_high) * 1.02;
  const maxVolume = Math.max(1, ...points.map(point => point.volume));
  const step = width / points.length;
  const x = (index: number) => index * step + step / 2;
  const y = (value: number) => top + (high - value) / Math.max(0.01, high - low) * priceHeight;
  const signalIndex = points.findIndex(point => point.trade_date === row.signal_date);
  return <div className="volume-selling-chart" role="img" aria-label={`${row.symbol} daily candles, volume, and latest strong selling signal at ${money(row.signal_high)}`}>
    <svg viewBox="0 0 960 440" preserveAspectRatio="none">
      {[0, 1, 2, 3, 4].map(index => { const value = low + (high - low) * index / 4; return <g key={index}><line className="vs-grid" x1="0" x2="900" y1={y(value)} y2={y(value)}/><text className="vs-axis" x="908" y={y(value) + 4}>{value.toFixed(2)}</text></g>; })}
      {points.map((point, index) => { const up = point.close >= point.open; const color = up ? "#059669" : "#ed4654"; return <g key={point.trade_date}>
        <line x1={x(index)} x2={x(index)} y1={y(point.high)} y2={y(point.low)} stroke={color} strokeWidth="1.5"/>
        <rect x={x(index) - Math.max(1.4, step * .33)} y={y(Math.max(point.open, point.close))} width={Math.max(2.8, step * .66)} height={Math.max(1.5, Math.abs(y(point.open) - y(point.close)))} fill={color}/>
        <rect x={x(index) - Math.max(1.4, step * .33)} y={volumeTop + volumeHeight * (1 - point.volume / maxVolume)} width={Math.max(2.8, step * .66)} height={volumeHeight * point.volume / maxVolume} fill={point.trade_date === row.signal_date ? "#e03146" : color} opacity={point.trade_date === row.signal_date ? 1 : .7}/>
      </g>; })}
      <><line className="vs-signal-line" x1={signalIndex >= 0 ? x(signalIndex) : 0} x2="900" y1={y(row.signal_high)} y2={y(row.signal_high)}/>{signalIndex >= 0 && <circle cx={x(signalIndex)} cy={y(row.signal_high)} r="4" fill="#265ee8"/>}<text className="vs-signal-label" x="904" y={y(row.signal_high) - 6}>{row.signal_high.toFixed(2)}</text></>
      <line className="vs-grid" x1="0" x2="900" y1="329" y2="329"/>
      <text className="vs-axis" x="4" y="438">{points[0].trade_date}</text><text className="vs-axis" x="785" y="438">{points.at(-1)?.trade_date}</text>
    </svg>
  </div>;
}

function TileChart({ row }: { row: VolumeSellingRow }) {
  const points = row.recent.slice(-63);
  const low = Math.min(...points.map(point => point.low), row.signal_high) * .98;
  const high = Math.max(...points.map(point => point.high), row.signal_high) * 1.02;
  const y = (value: number) => 78 - (value - low) / Math.max(.01, high - low) * 72;
  const path = points.map((point, index) => `${index ? "L" : "M"}${(index * 220 / Math.max(1, points.length - 1)).toFixed(1)} ${y(point.close).toFixed(1)}`).join(" ");
  const index = points.findIndex(point => point.trade_date === row.signal_date);
  return <span className="thirty-in-thirty-chart"><svg viewBox="0 0 220 82" preserveAspectRatio="none" aria-hidden="true"><path className="spark-line up" d={path}/><line className="vs-signal-line" x1={index >= 0 ? index * 220 / Math.max(1, points.length - 1) : 0} x2="220" y1={y(row.signal_high)} y2={y(row.signal_high)}/></svg></span>;
}

export default function VolumeSellingView() {
  const [data, setData] = useState<Response | null>(null);
  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("near");
  const [sort, setSort] = useState<Sort>("distance");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [maxAge, setMaxAge] = useState(126);
  const [minPrice, setMinPrice] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<VolumeSellingRow | null>(null);
  const [months, setMonths] = useState<3 | 6>(6);
  const load = useCallback(async () => { setLoading(true); try { const response = await fetch("/api/volume-selling-screener", { cache: "no-store" }); const json = await response.json(); if (!response.ok) throw new Error(json.error ?? "Scan failed"); setData(json); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Scan failed"); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 120_000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { setSelected(current => current ? data?.results.find(row => row.security_id === current.security_id) ?? null : null); }, [data]);
  useEffect(() => {
    const ids = (data?.results ?? []).slice(0, 500).map(row => row.security_id);
    if (!ids.length) return;
    const source = new EventSource(`/api/volume-selling-screener/live?ids=${encodeURIComponent(ids.join(","))}`);
    source.addEventListener("snapshot", event => { try { const values = JSON.parse((event as MessageEvent).data) as Tick[]; setTicks(previous => ({ ...previous, ...Object.fromEntries(values.map(tick => [tick.securityId, tick])) })); } catch {} });
    source.addEventListener("tick", event => { try { const tick = JSON.parse((event as MessageEvent).data) as Tick; setTicks(previous => ({ ...previous, [tick.securityId]: tick })); } catch {} });
    return () => source.close();
  }, [data]);
  const today = istDate(Date.now());
  const price = (row: VolumeSellingRow) => ticks[row.security_id]?.ltp || row.current_close;
  const distance = (row: VolumeSellingRow) => (price(row) / row.signal_high - 1) * 100;
  const entryToday = (row: VolumeSellingRow) => {
    if (row.signal_date >= today) return false;
    const tick = ticks[row.security_id];
    const liveToday = tick && istDate(tick.receivedAt) === today;
    const dayHigh = liveToday ? tick.dayHigh : row.current_date === today ? row.current_high : undefined;
    const previousClose = row.current_date === today ? row.previous_close : row.current_close;
    return dayHigh !== undefined && dayHigh >= row.signal_high && previousClose < row.signal_high;
  };
  const rows = useMemo(() => (data?.results ?? []).filter(row => {
    const gap = distance(row);
    return row.signal_age <= maxAge && price(row) >= minPrice && `${row.symbol} ${row.company_name}`.toLowerCase().includes(search.toLowerCase()) &&
      (mode === "entry" ? entryToday(row) : price(row) < row.signal_high && (mode === "all" || gap >= -5));
  }).sort((a, b) => {
    const value = (row: VolumeSellingRow): number | string => sort === "distance" ? Math.abs(distance(row)) : sort === "newest" ? row.signal_age : sort === "redVolume" ? row.red_volume_ratio : sort === "allVolume" ? row.all_volume_ratio : sort === "price" ? price(row) : row.symbol;
    const av = value(a), bv = value(b);
    const comparison = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
    return (direction === "asc" ? comparison : -comparison) || a.symbol.localeCompare(b.symbol);
  }), [data, ticks, mode, maxAge, minPrice, search, sort, direction, today]);
  return <section className="research-page thirty-in-thirty-page thirty-in-thirty-screener-page volume-selling-page">
    <div className="thirty-hero"><div><p className="eyebrow">VolumeSelling Screener · Nifty 500</p><h2>Strong red volume, one clean entry level</h2><small>Latest red candle in 126 sessions with volume &gt;2.5× its prior 20 red candles and &gt;2× all prior 20 candles. No later close above its high or earlier-day test of that level.</small></div><div className="thirty-hero-actions"><button className="primary" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/>{loading ? "Scanning…" : "Run Screener"}</button><button className="secondary compact" onClick={() => { setMode("near"); setSort("distance"); setDirection("asc"); setMaxAge(126); setMinPrice(0); setSearch(""); setMonths(6); }}>Reset</button></div></div>
    <div className="momentum-filter-bar thirty-in-thirty-filters">
      <label>View<select value={mode} onChange={event => setMode(event.target.value as Mode)}><option value="near">Below entry within 5%</option><option value="entry">First entry today</option><option value="all">All clean signals below</option></select></label>
      <label>Signal age ≤ sessions<input className="plain-input" type="number" min="0" max="126" value={maxAge} onChange={event => setMaxAge(Math.max(0, Math.min(126, Number(event.target.value))))}/></label>
      <label>Minimum price<input className="plain-input" type="number" min="0" value={minPrice} onChange={event => setMinPrice(Math.max(0, Number(event.target.value)))}/></label>
      <label>Search<input className="plain-input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Symbol or company"/></label>
      <label>Chart<select value={months} onChange={event => setMonths(Number(event.target.value) === 3 ? 3 : 6)}><option value={6}>6 months</option><option value={3}>3 months</option></select></label>
      <div className="thirty-sort-control"><label htmlFor="vs-sort">Sort</label><div><select id="vs-sort" value={sort} onChange={event => { setSort(event.target.value as Sort); setDirection(event.target.value === "redVolume" || event.target.value === "allVolume" || event.target.value === "price" ? "desc" : "asc"); }}><option value="distance">Closest to entry</option><option value="newest">Newest signal</option><option value="redVolume">Strongest red volume</option><option value="allVolume">Strongest overall volume</option><option value="price">Price</option><option value="symbol">Symbol</option></select><button className="secondary compact" onClick={() => setDirection(value => value === "asc" ? "desc" : "asc")}>{direction === "asc" ? "Asc" : "Desc"}</button></div></div>
    </div>
    {error && <div className="error">{error}</div>}
    <div className="thirty-in-thirty-summary"><div><span>Evaluated</span><b>{data?.evaluated ?? 0}</b></div><div><span>Strong signals</span><b>{data?.qualified ?? 0}</b></div><div><span>Shown</span><b>{rows.length}</b></div><div><span>Data through</span><b>{data?.results.reduce((latest, row) => row.current_date > latest ? row.current_date : latest, "") || "—"}</b></div></div>
    <section className="screenshot-tile-grid">{rows.length ? rows.map(row => <button key={row.security_id} className="screenshot-tile thirty-result-tile" onClick={() => setSelected(row)}><span className="thirty-result-top"><b>{row.symbol}</b><span className="tile-badges">{entryToday(row) ? "ENTRY TODAY" : `${pct(distance(row))} to level`}</span></span><span className="thirty-result-sub"><small>{row.company_name}</small><small>{money(price(row))}</small></span><TileChart row={row}/><span className="vs-tile-footer">Signal {row.signal_date} · {row.red_volume_ratio.toFixed(1)}× red vol · High {money(row.signal_high)}</span></button>) : <p className="panel-empty">{loading ? "Scanning stocks…" : "No stocks match these filters."}</p>}</section>
    {selected && <div className="drawer" onClick={() => setSelected(null)}><div className="drawer-card chart-drawer" onClick={event => event.stopPropagation()}><button className="icon-button drawer-close" onClick={() => setSelected(null)} aria-label="Close chart"><X size={18}/></button><p className="eyebrow">VolumeSelling · {selected.signal_date}</p><h2>{selected.symbol} · {selected.company_name}</h2><p className="muted">Signal high {money(selected.signal_high)} · selling volume {selected.red_volume_ratio.toFixed(2)}× prior red average and {selected.all_volume_ratio.toFixed(2)}× overall average · {selected.signal_age} sessions ago</p><div className="chart-shell"><div className="chart-toolbar"><div><p className="eyebrow">Daily chart · {months} months</p><span>Latest qualifying signal only · volume below</span></div><a className="secondary compact tradingview-link" href={`https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(selected.symbol)}`} target="_blank" rel="noreferrer"><ArrowUpRight size={14}/>TradingView</a></div><SignalChart row={selected} months={months}/></div><div className="strategy-stat-grid"><div className="strategy-stat"><span>Current price</span><strong>{money(price(selected))}</strong></div><div className="strategy-stat"><span>Entry high</span><strong>{money(selected.signal_high)}</strong></div><div className="strategy-stat"><span>Distance</span><strong>{pct(distance(selected))}</strong></div><div className="strategy-stat"><span>Signal date</span><strong>{selected.signal_date}</strong></div><div className="strategy-stat"><span>Entry today</span><strong>{entryToday(selected) ? "Yes" : "No"}</strong></div></div></div></div>}
  </section>;
}
