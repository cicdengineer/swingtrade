"use client";

import { FormEvent, useState } from "react";
import { Database, RefreshCw } from "lucide-react";

type Candle = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };
type ProbeResult = {
  stage: string;
  verdict: "not_run" | "one_year_confirmed" | "partial_history" | "not_confirmed";
  message?: string;
  symbol?: string;
  request?: { symbol: string; securityId: string; exchangeSegment: string; fromDate: string; toDate: string };
  httpStatus?: number;
  dhanStatus?: string | null;
  errorType?: string | null;
  errorCode?: string | null;
  candleCount?: number;
  spanDays?: number;
  firstTimestamp?: number | null;
  lastTimestamp?: number | null;
  sample?: Candle[];
};

function dateTime(timestamp: number | null | undefined) {
  if (timestamp == null) return "—";
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? String(timestamp) : date.toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

export default function USADataView() {
  const [symbol, setSymbol] = useState("AAPL");
  const [securityId, setSecurityId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState("");

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/usa-data", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, securityId }), cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed with HTTP ${response.status}.`);
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The probe could not complete.");
    } finally { setLoading(false); }
  }

  return <section className="usa-data-page">
    <div className="panel usa-data-intro">
      <p className="eyebrow">USA / Data verification</p>
      <h2>Check one year of US daily OHLCV from Dhan</h2>
      <p>This runs one read-only request for a US stock. It looks up the Dhan Security ID in Dhan’s US instrument list, then requests daily candles with exchange segment <code>INX_EQ</code>. Nothing is saved to the screener database.</p>
    </div>
    <form className="panel usa-data-form" onSubmit={run}>
      <label>US symbol<input className="plain-input" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} required maxLength={15} placeholder="AAPL" /></label>
      <label>Dhan Security ID <small>optional override</small><input className="plain-input" value={securityId} onChange={(event) => setSecurityId(event.target.value)} inputMode="numeric" pattern="[0-9]*" placeholder="Resolved automatically" /></label>
      <button className="primary" type="submit" disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />{loading ? "Checking Dhan…" : "Fetch one year"}</button>
    </form>
    {error && <div className="error">{error}</div>}
    {result && <section className="panel usa-data-result" aria-live="polite">
      <div className="panel-head"><div><p className="eyebrow">Probe result</p><h2>{result.verdict === "one_year_confirmed" ? "One year confirmed" : result.verdict === "partial_history" ? "Historical data returned, less than one year" : result.verdict === "not_run" ? "Request not run" : "US historical OHLCV not confirmed"}</h2></div><span className="count">{result.candleCount ?? 0} candles</span></div>
      <div className="metric-list">
        <span>Stage <b>{result.stage}</b></span>
        <span>Symbol <b>{result.request?.symbol ?? result.symbol ?? symbol}</b></span>
        <span>Security ID <b>{result.request?.securityId ?? "—"}</b></span>
        <span>Exchange segment <b>{result.request?.exchangeSegment ?? "INX_EQ"}</b></span>
        <span>Requested dates <b>{result.request ? `${result.request.fromDate} to ${result.request.toDate} (exclusive)` : "—"}</b></span>
        <span>Dhan HTTP status <b>{result.httpStatus ?? "—"}</b></span>
        <span>Dhan status <b>{result.dhanStatus ?? "—"}</b></span>
        <span>Error code <b>{result.errorCode ?? "—"}</b></span>
        <span>First candle <b>{dateTime(result.firstTimestamp)}</b></span>
        <span>Last candle <b>{dateTime(result.lastTimestamp)}</b></span>
        <span>History span <b>{result.spanDays == null ? "—" : `${result.spanDays} days`}</b></span>
      </div>
      {result.message && <div className="job-notice"><b>{result.errorType || "Dhan response"}</b><span>{result.message}</span></div>}
      {result.sample?.length ? <><h3 className="usa-data-sample-title">Latest 10 candles returned</h3><div className="table-wrap"><table><thead><tr><th>Timestamp</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead><tbody>{result.sample.map((candle) => <tr key={candle.timestamp}><td>{dateTime(candle.timestamp)}</td><td>{candle.open}</td><td>{candle.high}</td><td>{candle.low}</td><td>{candle.close}</td><td>{candle.volume.toLocaleString("en-US")}</td></tr>)}</tbody></table></div></> : <p className="panel-empty"><Database size={16} /> No OHLCV candles returned.</p>}
    </section>}
  </section>;
}
