"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { IpoDataset } from "@/lib/ipoDataset";

export default function IpoDataView({ isAdmin }: { isAdmin: boolean }) {
  const [dataset, setDataset] = useState<IpoDataset | null>(null);
  const [symbol, setSymbol] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

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

  async function importListings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setImporting(true);
    setError("");
    try {
      const response = await fetch("/api/data/ipo", { method: "POST", body: await file.text() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not import IPO data.");
      setDataset(body.dataset);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not import IPO data.");
    } finally {
      setImporting(false);
    }
  }

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
      {rows > 0 && <a className="secondary" href="/api/data/ipo?format=csv">Export OHLCV CSV</a>}
    </div>
    {isAdmin && <form className="panel" onSubmit={importListings}>
      <div className="panel-head">
        <label>Full NSE IPO listings CSV <input type="file" accept=".csv,text/csv" required disabled={importing} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <button className="primary" disabled={loading || importing || !file}>{importing ? "Fetching Dhan candles…" : "Import and refresh"}</button>
      </div>
      <p className="panel-empty">Include all listings for the rolling year. Required columns are Symbol and Listing Date (or Listed On). Company Name is optional.</p>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
    {loading && <p role="status">Loading saved IPO data…</p>}
    {!loading && !dataset && <p className="panel-empty">No IPO dataset has been imported yet.</p>}
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
