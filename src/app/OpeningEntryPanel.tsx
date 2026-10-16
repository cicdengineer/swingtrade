"use client";
import { useEffect, useState } from "react";
import { openingRangeSignal, positionSize, type QFilters, type QRow } from "@/lib/qullamaggieLogic";

type Minute = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Signal = ReturnType<typeof openingRangeSignal>;
type LiveTick = { securityId: string; ltp: number; receivedAt: number; lastTradeTime?: number };
const money = (value?: number) => value === undefined ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const indiaDate = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (key: string) => parts.find(part => part.type === key)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const indiaTime = (date: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
const indiaMinutes = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (key: string) => Number(parts.find(part => part.type === key)?.value ?? 0);
  return get("hour") * 60 + get("minute");
};

export default function OpeningEntryPanel({ row, filters, capital, riskPercent, onSignal }: { row: QRow; filters: QFilters; capital: number; riskPercent: number; onSignal: (signal: Signal | null) => void }) {
  const [signal, setSignal] = useState<Signal | null>(null);
  const [message, setMessage] = useState("Checking 1-minute candles…");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [revision, setRevision] = useState(0);
  const [liveTick, setLiveTick] = useState<LiveTick | null>(null);
  const [liveMessage, setLiveMessage] = useState("Waiting for live price…");
  const [manualEntry, setManualEntry] = useState<string | null>(null);

  useEffect(() => { setLiveTick(null); setManualEntry(null); }, [row.security_id]);

  useEffect(() => {
    if (!row.resistance) { setMessage("No confirmed consolidation resistance yet."); setSignal(null); onSignal(null); return; }
    setSignal(null); setCheckedAt(null); setMessage("Checking 1-minute candles…");
    onSignal(null);
    let active = true;
    let controller: AbortController | null = null;
    async function refresh() {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`/api/qullamaggie-screener/${encodeURIComponent(row.security_id)}/intraday?interval=1&days=2`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Dhan minute candles unavailable");
        const now = new Date();
        const today = indiaDate(now);
        const completed = ((data.candles ?? []) as Minute[]).filter(c => {
          const time = new Date(c.date);
          return Number.isFinite(time.getTime()) && indiaDate(time) === today && time.getTime() + 60_000 <= now.getTime();
        });
        if (!active) return;
        setCheckedAt(now);
        if (!completed.length) { setSignal(null); onSignal(null); setMessage("No completed 1-minute candles for today's session."); return; }
        const next = openingRangeSignal(completed, row.resistance!, filters.openingMinutes, row.adr20 ?? 0, filters.maxStopAdr);
        setSignal(next);
        onSignal(next);
        setMessage(next.status === "Intraday data required" ? `Waiting for the ${filters.openingMinutes}-minute opening range to complete.` : "");
      } catch (error) {
        if (!active || (error instanceof Error && error.name === "AbortError")) return;
        setSignal(null);
        onSignal(null);
        setMessage(`Intraday data required: ${error instanceof Error ? error.message : "Dhan unavailable"}`);
      }
    }
    void refresh();
    const timer = window.setInterval(() => {
      const current = new Date();
      setClock(current);
      const now = indiaMinutes(current);
      if (now >= 555 && now <= 930) void refresh();
    }, 30_000);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); };
  }, [row.security_id, row.resistance, row.adr20, filters.openingMinutes, filters.maxStopAdr, revision, onSignal]);

  const threshold = signal?.openingHigh && row.resistance ? Math.max(signal.openingHigh, row.resistance) : undefined;
  const crossed = signal?.status === "Fresh ORH cross" && signal.entry !== undefined && signal.stop !== undefined;
  const marketOpen = indiaMinutes(clock) >= 555 && indiaMinutes(clock) < 930;
  useEffect(() => {
    if (!marketOpen) { setLiveMessage("Market closed — enter a planned price to preview sizing."); return; }
    const source = new EventSource(`/api/qullamaggie-screener/live?id=${encodeURIComponent(row.security_id)}`);
    const receive = (event: Event) => {
      try {
        const value = JSON.parse((event as MessageEvent).data) as LiveTick | LiveTick[];
        const tick = Array.isArray(value) ? value.find(item => item.securityId === row.security_id) : value;
        if (tick && tick.securityId === row.security_id && Number.isFinite(tick.ltp) && tick.ltp > 0) { setLiveTick(tick); setLiveMessage(""); }
      } catch { setLiveMessage("Live price unavailable — enter a planned price."); }
    };
    const failed = () => setLiveMessage("Live price disconnected — enter a planned price.");
    source.addEventListener("snapshot", receive);
    source.addEventListener("tick", receive);
    source.addEventListener("error", failed);
    return () => source.close();
  }, [row.security_id, marketOpen]);
  const lastTradeMs = liveTick?.lastTradeTime ? liveTick.lastTradeTime * (liveTick.lastTradeTime > 1e12 ? 1 : 1000) : null;
  const freshLive = marketOpen && liveTick && clock.getTime() - liveTick.receivedAt < 90_000 && (!lastTradeMs || clock.getTime() - lastTradeMs < 90_000) ? liveTick : null;
  const sizing = crossed && capital > 0 && riskPercent > 0 ? positionSize(signal.entry!, signal.stop!, capital, riskPercent, filters.maxExposurePct) : null;
  const plannedPrice = manualEntry === null ? freshLive?.ltp : Number(manualEntry);
  const validPlannedPrice = plannedPrice !== undefined && Number.isFinite(plannedPrice) && plannedPrice > 0 ? plannedPrice : null;
  const currentSizing = crossed && validPlannedPrice !== null && signal.stop !== undefined && validPlannedPrice > signal.stop && capital > 0 && riskPercent > 0 ? positionSize(validPlannedPrice, signal.stop, capital, riskPercent, filters.maxExposurePct) : null;
  const lateStopPct = crossed && validPlannedPrice !== null && signal.stop !== undefined ? (validPlannedPrice - signal.stop) / validPlannedPrice * 100 : null;
  const exceedsStopLimit = lateStopPct !== null && lateStopPct > (row.adr20 ?? 0) * filters.maxStopAdr;
  return <section className="q-entry-panel" aria-live="polite">
    <div className="q-entry-head"><div><p className="eyebrow">Opening-range entry · {filters.openingMinutes} minutes</p><h3>{!marketOpen ? "Regular session closed — no new entry" : crossed ? "Cross observed — verify executable price" : signal?.status === "Stop too wide" ? "Entry blocked — stop too wide" : "No opening-range entry signal yet"}</h3></div><button className="secondary compact" onClick={() => setRevision(v => v + 1)}>Refresh now</button></div>
    <p className="muted">Regular NSE session opens at 9:15 IST. The opening range completes at {`9:${String(15 + filters.openingMinutes).padStart(2, "0")}`} IST. The trigger is the higher of the opening-range high and confirmed daily resistance. A completed 1-minute candle whose high crosses it produces the reference signal; a close above it is not required.</p>
    <div className="q-entry-values"><span>Daily resistance<b>{money(row.resistance)}</b></span><span>Opening high<b>{money(signal?.openingHigh)}</b></span><span>Reference trigger<b>{money(threshold)}</b></span><span>Opening low<b>{money(signal?.openingLow)}</b></span></div>
    {message && <p className="q-entry-message">{message}</p>}
    {signal?.status === "Waiting for fresh cross" && marketOpen && <p className="q-entry-message">Opening range is complete. Waiting for a cross above {money(threshold)}.</p>}
    {signal?.status === "Waiting for fresh cross" && !marketOpen && <p className="q-entry-message">No cross above {money(threshold)} was observed during the regular session.</p>}
    {!crossed && signal?.status !== "Stop too wide" && <p className="q-entry-time">The indicative stop, risk per share and quantity appear here after a valid cross. An opening low alone is not the confirmed stop.</p>}
    {signal?.status === "Stop too wide" && <p className="q-entry-message">Observed stop {money(signal.stop)} exceeds the configured {filters.maxStopAdr}× ADR risk limit. No entry signal.</p>}
    {crossed && sizing && <><div className="entry-sizing-grid q-signal-sizing"><div className="entry-sizing-tile good"><div><span>Quantity at original trigger</span><strong>{sizing.quantity.toLocaleString("en-IN")} qty</strong><small>{money(sizing.positionValue)} position · {money(sizing.riskAmount)} risk budget</small></div><div><span>Indicative SL</span><b>{money(signal.stop)}</b><small>{money(signal.entry! - signal.stop!)} risk per share</small></div></div><div className="entry-sizing-tile"><div><span>Original trigger</span><strong>{money(signal.entry)}</strong><small>{((signal.entry! - signal.stop!) / signal.entry! * 100).toFixed(2)}% stop distance</small></div><div><span>Planned loss</span><b>{money(sizing.quantity * (signal.entry! - signal.stop!))}</b><small>At original trigger only</small></div></div></div><p className="q-entry-message">The crossing minute does not prove a fill at the trigger. For an entry now, use the live or planned price below. {sizing.warning}</p></>}
    {crossed && <div className="q-late-entry"><div className="q-entry-head"><div><p className="eyebrow">Entry now / late-entry sizing</p><h3>Recalculate at your planned fill</h3></div><button type="button" className="secondary compact" onClick={() => setManualEntry(null)} disabled={!freshLive}>Use live LTP</button></div><div className="q-late-inputs"><label>Planned entry price<input className="plain-input" type="number" min="0" step="0.05" inputMode="decimal" value={manualEntry ?? (freshLive?.ltp ?? "")} onChange={event => setManualEntry(event.target.value)} placeholder="Enter expected fill" /></label><span>Indicative stop<b>{money(signal.stop)}</b></span><span>Price source<b>{manualEntry === null ? freshLive ? "Live Dhan LTP" : "No fresh LTP" : "Your planned price"}</b></span></div>{manualEntry === null && <small className="q-entry-time">{freshLive ? `LTP received ${indiaTime(new Date(freshLive.receivedAt))} IST` : liveMessage || "No fresh LTP — enter a planned price."}</small>}{currentSizing && validPlannedPrice !== null && signal.stop !== undefined ? <><div className="q-entry-values"><span>Risk per share<b>{money(validPlannedPrice - signal.stop)}</b></span><span>Current stop distance<b>{lateStopPct?.toFixed(2)}%</b></span><span>Recalculated quantity<b>{currentSizing.quantity.toLocaleString("en-IN")}</b></span><span>Position value<b>{money(currentSizing.positionValue)}</b></span><span>Planned loss<b>{money(currentSizing.quantity * (validPlannedPrice - signal.stop))}</b></span><span>Risk budget<b>{money(currentSizing.riskAmount)}</b></span></div>{validPlannedPrice <= signal.entry! && <p className="q-entry-message">Price is at or below the original trigger; review whether the breakout setup still applies.</p>}{exceedsStopLimit && <p className="q-entry-message">This late entry exceeds the configured {filters.maxStopAdr}× ADR stop-distance limit. The quantity is a calculation, not a fresh buy signal.</p>}{currentSizing.warning && <p className="q-entry-message">{currentSizing.warning}.</p>}</> : <p className="q-entry-message">Enter a price above the indicative stop to see current risk and quantity.</p>}<small className="q-entry-time">LTP is a quote, not a guaranteed fill. The stop is the original signal stop; review it before a late entry.</small></div>}
    <small className="q-entry-time">{checkedAt ? `Minute data checked ${indiaTime(checkedAt)} IST` : "Waiting for Dhan data"} · No order is placed · Existing holdings are not deducted from available capital</small>
  </section>;
}
