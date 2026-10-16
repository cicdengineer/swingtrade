"use client";
import { useEffect, useState } from "react";
import { openingRangeSignal, positionSize, type QFilters, type QRow } from "@/lib/qullamaggieLogic";

type Minute = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Signal = ReturnType<typeof openingRangeSignal>;
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
  const sizing = crossed && capital > 0 && riskPercent > 0 ? positionSize(signal.entry!, signal.stop!, capital, riskPercent, filters.maxExposurePct) : null;
  return <section className="q-entry-panel" aria-live="polite">
    <div className="q-entry-head"><div><p className="eyebrow">Opening-range entry · {filters.openingMinutes} minutes</p><h3>{!marketOpen ? "Regular session closed — no new entry" : crossed ? "Cross observed — verify executable price" : signal?.status === "Stop too wide" ? "Entry blocked — stop too wide" : "No opening-range entry signal yet"}</h3></div><button className="secondary compact" onClick={() => setRevision(v => v + 1)}>Refresh now</button></div>
    <p className="muted">Regular NSE session opens at 9:15 IST. The opening range completes at {`9:${String(15 + filters.openingMinutes).padStart(2, "0")}`} IST. The trigger is the higher of the opening-range high and confirmed daily resistance. A completed 1-minute candle whose high crosses it produces the reference signal; a close above it is not required.</p>
    <div className="q-entry-values"><span>Daily resistance<b>{money(row.resistance)}</b></span><span>Opening high<b>{money(signal?.openingHigh)}</b></span><span>Reference trigger<b>{money(threshold)}</b></span><span>Opening low<b>{money(signal?.openingLow)}</b></span></div>
    {message && <p className="q-entry-message">{message}</p>}
    {signal?.status === "Waiting for fresh cross" && marketOpen && <p className="q-entry-message">Opening range is complete. Waiting for a cross above {money(threshold)}.</p>}
    {signal?.status === "Waiting for fresh cross" && !marketOpen && <p className="q-entry-message">No cross above {money(threshold)} was observed during the regular session.</p>}
    {!crossed && signal?.status !== "Stop too wide" && <p className="q-entry-time">The indicative stop, risk per share and quantity appear here after a valid cross. An opening low alone is not the confirmed stop.</p>}
    {signal?.status === "Stop too wide" && <p className="q-entry-message">Observed stop {money(signal.stop)} exceeds the configured {filters.maxStopAdr}× ADR risk limit. No entry signal.</p>}
    {crossed && sizing && <><div className="entry-sizing-grid q-signal-sizing"><div className="entry-sizing-tile good"><div><span>Opening-range entry</span><strong>{sizing.quantity.toLocaleString("en-IN")} qty</strong><small>{money(sizing.positionValue)} position · {money(sizing.riskAmount)} risk budget</small></div><div><span>Indicative SL</span><b>{money(signal.stop)}</b><small>{money(signal.entry! - signal.stop!)} risk per share</small></div></div><div className="entry-sizing-tile"><div><span>Reference entry</span><strong>{money(signal.entry)}</strong><small>{((signal.entry! - signal.stop!) / signal.entry! * 100).toFixed(2)}% stop distance</small></div><div><span>Planned loss</span><b>{money(sizing.quantity * (signal.entry! - signal.stop!))}</b><small>At reference entry only</small></div></div></div><p className="q-entry-message">A minute candle shows that the level was crossed, but it does not prove an executable fill at that price. Recalculate the stop and quantity at your actual entry. {sizing.warning}</p></>}
    <small className="q-entry-time">{checkedAt ? `Minute data checked ${indiaTime(checkedAt)} IST` : "Waiting for Dhan data"} · No order is placed · Existing holdings are not deducted from available capital</small>
  </section>;
}
