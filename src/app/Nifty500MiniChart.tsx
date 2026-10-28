"use client";

import { useEffect, useState } from "react";

type Candle = { date: string; open: number; high: number; low: number; close: number };
type Snapshot = { candles: Candle[]; changePct: number | null; live: boolean; dataThrough: string | null };

export default function Nifty500MiniChart() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/index/cnx500", { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json() as Snapshot;
        if (active) setSnapshot(next);
      } catch { /* Keep the latest available snapshot during a connection issue. */ }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const candles = snapshot?.candles ?? [];
  const values = candles.flatMap((candle) => [candle.high, candle.low]);
  const min = values.length ? Math.min(...values) : 0;
  const span = values.length ? Math.max(...values) - min || 1 : 1;
  const y = (price: number) => 46 - ((price - min) / span) * 40;
  const change = snapshot?.changePct;
  const tone = change === null || change === undefined ? "" : change >= 0 ? "positive" : "negative";
  return <div className="nifty500-mini" aria-label="Nifty 500 five-day candlestick chart">
    <div className="nifty500-mini-copy"><b>NIFTY 500</b><strong className={tone}>{change === null || change === undefined ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</strong><small>{snapshot?.live ? "Live today" : snapshot?.dataThrough ? `Through ${snapshot.dataThrough}` : "Refresh All Data to load"}</small></div>
    <svg viewBox="0 0 120 52" role="img" aria-label="Last five trading sessions">
      {candles.map((candle, index) => {
        const x = 12 + index * 24;
        const top = y(Math.max(candle.open, candle.close));
        const bottom = y(Math.min(candle.open, candle.close));
        const color = candle.close >= candle.open ? "#49b989" : "#e16e68";
        return <g key={candle.date}><title>{`${candle.date}: O ${candle.open.toFixed(2)}, H ${candle.high.toFixed(2)}, L ${candle.low.toFixed(2)}, C ${candle.close.toFixed(2)}`}</title><line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth="1.5"/><rect x={x - 5} y={top} width="10" height={Math.max(1.5, bottom - top)} fill={color} rx="1"/></g>;
      })}
    </svg>
  </div>;
}
