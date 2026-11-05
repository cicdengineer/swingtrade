"use client";

import { useEffect, useState } from "react";
import { earningsSession, type EarningsBySymbol, type EarningsEvent } from "@/lib/earnings";

export function useEarnings(enabled: boolean) {
  const [results, setResults] = useState<EarningsBySymbol>({});
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: number;
    async function refresh() {
      let delay = 15 * 60_000;
      try {
        const response = await fetch("/api/earnings", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted) { setResults(data); setUnavailable(false); }
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
        delay = 60_000;
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, delay);
      }
    }
    void refresh();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [enabled]);
  return { results, unavailable };
}

type Row = { trade_date: string };
export function EarningsMarkers({ events, history, visible, candles = false }: {
  events?: EarningsEvent[]; history: Row[]; visible: Row[]; candles?: boolean;
}) {
  const [opened, setOpened] = useState<string>();
  if (!events?.length) return null;
  const markers = earningsSession(events, history).flatMap(event => {
    const index = visible.findIndex(row => row.trade_date === event.session);
    if (index < 0) return [];
    const fraction = candles ? (index + 0.5) / visible.length : index / Math.max(1, visible.length - 1);
    return [{ ...event, percent: fraction * 100 }];
  });
  if (!markers.length) return null;
  return <span className="earnings-track" aria-label="Quarterly earnings">
    {markers.map(({ periodEnd, filedAt, percent }) => {
      const detail = `Quarter ended ${periodEnd} · NSE filing ${filedAt.slice(0, 16)} IST`;
      return <span key={periodEnd} className="earnings-position" style={{ left: `clamp(9px, ${percent}%, calc(100% - 9px))` }}>
        <button type="button" aria-label={detail} className="earnings-dot"
          onKeyDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); setOpened(periodEnd); }}
          onBlur={() => setOpened(undefined)}>E</button>
        <span role="tooltip" className={`earnings-tip ${percent > 50 ? "align-right" : ""} ${opened === periodEnd ? "open" : ""}`}>{detail}</span>
      </span>;
    })}
  </span>;
}
