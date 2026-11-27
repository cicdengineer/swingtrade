"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { IpoDataset } from "@/lib/ipoDataset";

export function useIpoData() {
  const [dataset, setDataset] = useState<IpoDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const refreshInFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/data/ipo", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load IPO data.");
        setDataset(body.dataset);
      })
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch("/api/data/ipo", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not refresh IPO data.");
      setDataset(body.dataset);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not refresh IPO data.");
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  return { dataset, loading, refreshing, error, refresh };
}

export function IpoDataCard({ data, isAdmin, disabled }: { data: ReturnType<typeof useIpoData>; isAdmin: boolean; disabled: boolean }) {
  const { dataset, error, loading, refreshing, refresh } = data;
  const listings = dataset?.listings ?? [];
  const rows = listings.reduce((total, listing) => total + listing.candles.length, 0);
  const issues = listings.filter((listing) => listing.issue).length;
  let earliest = "";
  let latest = "";
  for (const listing of listings) {
    const first = listing.candles[0]?.date;
    const last = listing.candles.at(-1)?.date;
    if (first && (!earliest || first < earliest)) earliest = first;
    if (last && last > latest) latest = last;
  }

  return <section className="panel">
    <div className="panel-head">
      <div><p className="eyebrow">IPO</p><h2>NSE IPOs</h2></div>
      {isAdmin && <button type="button" className="secondary compact" onClick={() => void refresh()} disabled={disabled || loading || refreshing}>
        <RefreshCw size={14} className={refreshing ? "spin" : ""} />Refresh
      </button>}
    </div>
    <div className="metric-list">
      <span>Total listings <b>{listings.length}</b></span>
      <span>Mapped to Dhan <b>{listings.filter((listing) => listing.securityId).length}</b></span>
      <span>Stocks downloaded <b>{listings.filter((listing) => listing.candles.length).length}</b></span>
      <span>Coverage issues <b>{issues}</b></span>
      <span>Earliest date <b>{earliest || "—"}</b></span>
      <span>Latest date <b>{latest || "—"}</b></span>
      <span>Listings since <b>{dataset?.from ?? "—"}</b></span>
      <span>Requested through <b>{dataset?.through ?? "—"}</b></span>
      <span>Last refresh <b>{dataset?.refreshedAt.slice(0, 10) ?? "—"}</b></span>
      <span>Total OHLCV rows <b>{rows}</b></span>
    </div>
    {error && <p className="job-errors" role="alert">{error}</p>}
    {loading && <p className="panel-empty" role="status">Loading saved IPO data…</p>}
    {refreshing && <p className="panel-empty" role="status">Downloading IPO data…</p>}
    {!loading && !refreshing && !dataset && <p className="panel-empty">No IPO data has been downloaded yet.</p>}
  </section>;
}

export default function IpoDataView({ dataset }: { dataset: IpoDataset | null }) {
  const [symbol, setSymbol] = useState("");
  if (!dataset) return null;
  const listings = dataset.listings;
  const selected = listings.find((listing) => listing.symbol === symbol) ?? listings[0];

  return <>
    <section className="panel">
      <div className="panel-head">
        <h2>IPO listings</h2>
        {listings.some((listing) => listing.candles.length) && <a className="secondary compact" href="/api/data/ipo?format=csv">Export OHLCV CSV</a>}
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Symbol</th><th>Company</th><th>Listed on</th><th>Candles</th><th>Latest candle</th><th>Coverage issue</th></tr></thead>
        <tbody>{listings.map((listing) => <tr key={listing.symbol}>
          <td><button className="secondary compact" type="button" aria-pressed={selected?.symbol === listing.symbol} onClick={() => setSymbol(listing.symbol)}>{listing.symbol}</button></td>
          <td>{listing.company || "—"}</td><td>{listing.listingDate}</td><td>{listing.candles.length}</td>
          <td>{listing.candles.at(-1)?.date ?? "—"}</td><td>{listing.issue ?? "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
    {selected && <section className="panel">
      <div className="panel-head"><h2>{selected.symbol} daily candles</h2></div>
      {selected.candles.length ? <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead>
        <tbody>{[...selected.candles].reverse().map((candle) => <tr key={candle.date}>
          <td>{candle.date}</td><td>{candle.open}</td><td>{candle.high}</td><td>{candle.low}</td><td>{candle.close}</td><td>{candle.volume.toLocaleString()}</td>
        </tr>)}</tbody>
      </table></div> : <p className="panel-empty">{selected.issue ?? "No candles available."}</p>}
    </section>}
  </>;
}
