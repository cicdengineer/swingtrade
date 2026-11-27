"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { IpoDataset } from "@/lib/ipoDataset";

export default function IpoDataView({ isAdmin, refreshRequest }: { isAdmin: boolean; refreshRequest: number }) {
  const [dataset, setDataset] = useState<IpoDataset | null>(null);
  const [symbol, setSymbol] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const lastRequest = useRef(refreshRequest);
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

  useEffect(() => {
    if (loading || refreshRequest === lastRequest.current) return;
    lastRequest.current = refreshRequest;
    if (isAdmin) void refresh();
  }, [isAdmin, loading, refresh, refreshRequest]);

  const listings = dataset?.listings ?? [];
  const selected = listings.find((listing) => listing.symbol === symbol) ?? listings[0];
  const rows = listings.reduce((total, listing) => total + listing.candles.length, 0);
  const issues = listings.filter((listing) => listing.issue).length;

  return <section className="data-dashboard">
    <div className="data-toolbar">
      <div>
        <h2>NSE IPO daily OHLCV</h2>
        <small>{dataset ? `Listings since ${dataset.from} · Requested through ${dataset.through} · ${listings.length} IPOs · ${rows.toLocaleString()} candles · ${issues} coverage issues` : "Daily candles from listing for IPOs in the last year."}</small>
      </div>
      <div className="toolbar-actions">
        {rows > 0 && <a className="secondary compact" href="/api/data/ipo?format=csv">Export OHLCV CSV</a>}
        {isAdmin && <button type="button" className="secondary compact" onClick={() => void refresh()} disabled={loading || refreshing}>
          <RefreshCw size={14} className={refreshing ? "spin" : ""} />
          {refreshing ? "Downloading IPO data…" : "Refresh"}
        </button>}
      </div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {loading && <p role="status">Loading saved IPO data…</p>}
    {!loading && !refreshing && !dataset && <p className="panel-empty">No IPO data has been downloaded yet.</p>}
    {dataset && <section className="panel">
      <div className="panel-head"><h2>IPO listings</h2></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Symbol</th><th>Company</th><th>Listed on</th><th>Candles</th><th>Latest candle</th><th>Coverage issue</th></tr></thead>
        <tbody>{listings.map((listing) => <tr key={listing.symbol}>
          <td><button className="secondary compact" type="button" aria-pressed={selected?.symbol === listing.symbol} onClick={() => setSymbol(listing.symbol)}>{listing.symbol}</button></td>
          <td>{listing.company || "—"}</td><td>{listing.listingDate}</td><td>{listing.candles.length}</td>
          <td>{listing.candles.at(-1)?.date ?? "—"}</td><td>{listing.issue ?? "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
    {selected && <section className="panel">
      <div className="panel-head"><h2>{selected.symbol} daily candles</h2></div>
      {selected.candles.length ? <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead>
        <tbody>{[...selected.candles].reverse().map((candle) => <tr key={candle.date}>
          <td>{candle.date}</td><td>{candle.open}</td><td>{candle.high}</td><td>{candle.low}</td><td>{candle.close}</td><td>{candle.volume.toLocaleString()}</td>
        </tr>)}</tbody>
      </table></div> : <p className="panel-empty">{selected.issue ?? "No candles available."}</p>}
    </section>}
  </section>;
}
