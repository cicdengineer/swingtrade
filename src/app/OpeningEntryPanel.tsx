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

export default function OpeningEntryPanel({ row, filters }: { row: QRow; filters: QFilters }) {
  const [signal, setSignal] = useState<Signal | null>(null);
  const [message, setMessage] = useState("Checking 1-minute candles…");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!row.resistance) { setMessage("No confirmed consolidation resistance yet."); setSignal(null); return; }
    setSignal(null); setCheckedAt(null); setMessage("Checking 1-minute candles…");
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
        if (!completed.length) { setSignal(null); setMessage("No completed 1-minute candles for today's session."); return; }
        const next = openingRangeSignal(completed, row.resistance!, filters.openingMinutes, row.adr20 ?? 0, filters.maxStopAdr);
        setSignal(next);
        setMessage(next.status === "Intraday data required" ? `Waiting for the ${filters.openingMinutes}-minute opening range to complete.` : "");
      } catch (error) {
        if (!active || (error instanceof Error && error.name === "AbortError")) return;
        setSignal(null);
        setMessage(`Intraday data required: ${error instanceof Error ? error.message : "Dhan unavailable"}`);
      }
    }
    void refresh();
    const timer = window.setInterval(() => {
      const now = indiaMinutes(new Date());
      if (now >= 555 && now <= 930) void refresh();
    }, 30_000);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); };
  }, [row.security_id, row.resistance, row.adr20, filters.openingMinutes, filters.maxStopAdr, revision]);

  const threshold = signal?.openingHigh && row.resistance ? Math.max(signal.openingHigh, row.resistance) : undefined;
  const crossed = signal?.status === "Fresh ORH cross" && signal.entry !== undefined && signal.stop !== undefined;
  const marketOpen = checkedAt !== null && indiaMinutes(checkedAt) >= 555 && indiaMinutes(checkedAt) <= 930;
  const sizing = crossed ? positionSize(signal.entry!, signal.stop!, filters.capital, filters.riskPct, filters.maxExposurePct) : null;
  return <section className="q-entry-panel" aria-live="polite">
    <div className="q-entry-head"><div><p className="eyebrow">Opening-range entry · {filters.openingMinutes} minutes</p><h3>{crossed ? marketOpen ? "Cross observed — verify executable price" : "Session closed — earlier cross observed" : signal?.status === "Stop too wide" ? "Entry blocked — stop too wide" : "No opening-range entry signal yet"}</h3></div><button className="secondary compact" onClick={() => setRevision(v => v + 1)}>Refresh now</button></div>
    <p className="muted">Regular NSE session opens at 9:15 IST. The opening range completes at {`9:${String(15 + filters.openingMinutes).padStart(2, "0")}`} IST. The reference trigger must be above both the opening-range high and confirmed daily resistance.</p>
    <div className="q-entry-values"><span>Daily resistance<b>{money(row.resistance)}</b></span><span>Opening high<b>{money(signal?.openingHigh)}</b></span><span>Reference trigger<b>{money(threshold)}</b></span><span>Opening low<b>{money(signal?.openingLow)}</b></span></div>
    {message && <p className="q-entry-message">{message}</p>}
    {signal?.status === "Waiting for fresh cross" && <p className="q-entry-message">Opening range is complete. Waiting for a cross above {money(threshold)}.</p>}
    {signal?.status === "Stop too wide" && <p className="q-entry-message">Observed stop {money(signal.stop)} exceeds the configured {filters.maxStopAdr}× ADR risk limit. No entry signal.</p>}
    {crossed && sizing && <><div className="q-entry-values"><span>Indicative entry<b>{money(signal.entry)}</b></span><span>Indicative stop<b>{money(signal.stop)}</b></span><span>Risk per share<b>{money(signal.entry! - signal.stop!)}</b></span><span>Risk budget<b>{money(sizing.riskAmount)}</b></span><span>Maximum quantity<b>{sizing.quantity.toLocaleString("en-IN")}</b></span><span>Position value<b>{money(sizing.positionValue)}</b></span><span>Planned maximum loss<b>{money(sizing.quantity * (signal.entry! - signal.stop!))}</b></span><span>Stop distance<b>{((signal.entry! - signal.stop!) / signal.entry! * 100).toFixed(2)}%</b></span></div><p className="q-entry-message">A minute candle shows that the level was crossed, but it does not prove an executable fill at that price. Recalculate the stop and quantity at your actual entry. {sizing.warning}</p></>}
    <small className="q-entry-time">{checkedAt ? `Minute data checked ${indiaTime(checkedAt)} IST` : "Waiting for Dhan data"} · No order is placed · Existing holdings are not deducted from available capital</small>
  </section>;
}
