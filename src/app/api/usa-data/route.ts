import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const US_MASTER_URL = "https://api-global-stocks.dhan.co/api-data/us-stock-scrip-master.csv";
const HISTORICAL_URL = "https://api.dhan.co/v2/charts/historical";

function csvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function resolveSecurityId(csv: string, symbol: string): string | null {
  const rows = csvRows(csv);
  const headers = rows.shift()?.map((value) => value.replace(/^\uFEFF/, "").trim().toUpperCase()) ?? [];
  const idColumn = headers.indexOf("SCRIP_CODE");
  const symbolColumns = ["SYMBOL", "EXCH_SYMBOL", "TRADING_SYMBOL", "CUSTOM_SYMBOL"]
    .map((name) => headers.indexOf(name)).filter((index) => index >= 0);
  if (idColumn < 0 || !symbolColumns.length) return null;
  const match = rows.find((row) => symbolColumns.some((column) => row[column]?.trim().toUpperCase() === symbol));
  return match?.[idColumn]?.trim() || null;
}

function safeMessage(value: unknown, token: string): string {
  const message = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return (token ? message.replaceAll(token, "[redacted]") : message).slice(0, 500);
}

export async function POST(request: NextRequest) {
  const clientId = process.env.DHAN_CLIENT_ID;
  const token = process.env.DHAN_ACCESS_TOKEN;
  if (!clientId || !token) return NextResponse.json({ stage: "configuration", verdict: "not_run", message: "DHAN_CLIENT_ID and DHAN_ACCESS_TOKEN are not configured on the server." });

  let input: { symbol?: unknown; securityId?: unknown };
  try { input = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 }); }
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const symbol = typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "AAPL";
  const override = typeof input.securityId === "string" ? input.securityId.trim() : "";
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) || (override && !/^\d{1,12}$/.test(override))) {
    return NextResponse.json({ error: "Enter a valid US symbol and numeric Dhan Security ID." }, { status: 400 });
  }

  let securityId = override;
  if (!securityId) {
    try {
      const master = await fetch(US_MASTER_URL, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!master.ok) throw new Error(`Dhan instrument list returned HTTP ${master.status}.`);
      securityId = resolveSecurityId(await master.text(), symbol) ?? "";
      if (!securityId) throw new Error(`${symbol} was not found in Dhan's US instrument list.`);
      if (!/^\d{1,12}$/.test(securityId)) throw new Error(`Dhan's US instrument list returned an invalid Security ID for ${symbol}.`);
    } catch (error) {
      return NextResponse.json({ stage: "instrument_list", verdict: "not_run", symbol, message: safeMessage(error instanceof Error ? error.message : error, token) });
    }
  }

  const now = new Date();
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + 1);
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);
  const requestDetails = { symbol, securityId, exchangeSegment: "INX_EQ", instrument: "EQUITY", fromDate, toDate };

  try {
    const response = await fetch(HISTORICAL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json", "access-token": token, "client-id": clientId },
      body: JSON.stringify({ securityId, exchangeSegment: "INX_EQ", instrument: "EQUITY", expiryCode: 0, oi: false, fromDate, toDate }),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    const body: unknown = await response.json().catch(() => null);
    const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const nested = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;
    const fields = ["timestamp", "open", "high", "low", "close", "volume"] as const;
    const arrays = fields.map((field) => nested[field]);
    const lengths = arrays.map((value) => Array.isArray(value) ? value.length : -1);
    const validShape = lengths[0] > 0 && lengths.every((length) => length === lengths[0]);
    const candles = validShape ? (nested.timestamp as unknown[]).map((timestamp, index) => ({
      timestamp: Number(timestamp),
      open: Number((nested.open as unknown[])[index]),
      high: Number((nested.high as unknown[])[index]),
      low: Number((nested.low as unknown[])[index]),
      close: Number((nested.close as unknown[])[index]),
      volume: Number((nested.volume as unknown[])[index]),
    })) : [];
    const validCandles = candles.length > 0 && candles.every((candle) =>
      Number.isFinite(candle.timestamp) && Number.isFinite(candle.open) && Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) && Number.isFinite(candle.close) && Number.isFinite(candle.volume) &&
      candle.open > 0 && candle.high >= Math.max(candle.open, candle.close, candle.low) &&
      candle.low <= Math.min(candle.open, candle.close) && candle.volume >= 0);
    const sorted = validCandles ? candles.sort((a, b) => a.timestamp - b.timestamp) : [];
    const spanDays = sorted.length > 1 ? (sorted.at(-1)!.timestamp - sorted[0].timestamp) / 86400 : 0;
    const dhanSucceeded = payload.status === undefined || payload.status === "success";
    const verdict = response.ok && dhanSucceeded && validCandles
      ? sorted.length >= 200 && spanDays >= 330 ? "one_year_confirmed" : "partial_history"
      : "not_confirmed";
    return NextResponse.json({
      stage: "historical_request", verdict, request: requestDetails, httpStatus: response.status,
      dhanStatus: payload.status ?? null, errorType: payload.errorType ?? null,
      errorCode: payload.errorCode ?? null,
      message: safeMessage(payload.errorMessage ?? payload.remarks ?? payload.message ?? (validCandles ? "" : "No valid OHLCV candle arrays were returned."), token),
      candleCount: sorted.length,
      spanDays: Math.round(spanDays),
      firstTimestamp: sorted[0]?.timestamp ?? null,
      lastTimestamp: sorted.at(-1)?.timestamp ?? null,
      firstCandle: sorted[0] ?? null,
      lastCandle: sorted.at(-1) ?? null,
      sample: sorted.slice(-10),
    });
  } catch (error) {
    return NextResponse.json({ stage: "historical_request", verdict: "not_confirmed", request: requestDetails, message: safeMessage(error instanceof Error ? error.message : error, token) });
  }
}
