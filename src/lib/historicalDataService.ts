import "server-only";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import type {
  Candle,
  DailyPriceRecord,
  DataDownloadJobRecord,
  DataQualityIssueRecord,
  InstrumentRecord,
  Security,
  UniverseMemberRecord,
  UniverseName,
} from "./types";
import { hasDhanCredentials } from "./dhan";
import {
  getDatabaseSizeBytes,
  latestPriceDate,
  markFailureResolved,
  readDatabase,
  replaceQualityIssues,
  upsertDailyPrices,
  upsertFailure,
  upsertInstrument,
  upsertUniverseMember,
  writeDatabase,
} from "./localDatabase";
import type { SeasonalityDatabase } from "./localDatabase";

const scripMasterUrl = "https://images.dhan.co/api-data/api-scrip-master-detailed.csv";
const universeSources: Record<UniverseName, { label: string; url: string }> = {
  MIDCAP: {
    label: "Nifty Midcap 150 current constituents",
    url: "https://www.niftyindices.com/IndexConstituent/ind_niftymidcap150list.csv",
  },
  SMALLCAP: {
    label: "Nifty Smallcap 250 current constituents",
    url: "https://www.niftyindices.com/IndexConstituent/ind_niftysmallcap250list.csv",
  },
};
const cacheRoot = path.join(process.cwd(), ".data", "market-data-cache");
function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const dhanDate = (date: Date) => dateInTimeZone(date, "Asia/Kolkata");
const dhanDailyTimestampDate = (timestampSeconds: number) => dateInTimeZone(new Date(timestampSeconds * 1000), "Asia/Kolkata");
const pad = (value: number) => String(value).padStart(2, "0");
const dhanDateTime = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
const today = () => dhanDate(new Date());
const indiaTimeZone = "Asia/Kolkata";
const marketOpenMinutes = 9 * 60 + 15;
const marketCloseMinutes = 15 * 60 + 30;
const provisionalDataSource = "DHAN_INTRADAY_AGGREGATED" as const;
const officialDataSource = "DHAN_DAILY" as const;
const fixedNseHolidayMonthDays = new Set(["01-26", "08-15", "10-02", "12-25"]);
const dhanReason = (body: any, fallback: string) => {
  const reason = body?.errorMessage ?? body?.remarks ?? body?.message ?? body?.error ?? body?.status ?? fallback;
  const text = typeof reason === "string" ? reason : JSON.stringify(reason);
  return text || fallback;
};
let dataMutationQueue: Promise<void> = Promise.resolve();

async function mutateDataStore<T>(task: () => Promise<T>) {
  const run = dataMutationQueue.then(task, task);
  dataMutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

function dataRefreshConcurrency() {
  const configured = Number(process.env.DATA_REFRESH_CONCURRENCY ?? 3);
  return Math.min(Math.max(Number.isFinite(configured) ? Math.floor(configured) : 6, 1), 12);
}

export function getIndiaNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: indiaTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    second: Number(value("second")),
  };
}

export function getIndiaTradingDate(now = new Date()) {
  return getIndiaNow(now).date;
}

export function isIndianMarketClosed(now = new Date()) {
  const india = getIndiaNow(now);
  return india.hour * 60 + india.minute >= marketCloseMinutes;
}

function indiaSessionDateTime(tradingDate: string, minutes: number) {
  return `${tradingDate} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
}

function indiaTimestampParts(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: indiaTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

const staleRefreshJobMs = 2 * 60 * 1000;

function jobActivityTime(job: DataDownloadJobRecord) {
  return Date.parse(job.last_successful_update ?? job.started_at);
}

function isStaleRefreshJob(job: DataDownloadJobRecord) {
  const activityTime = jobActivityTime(job);
  return Number.isFinite(activityTime) && Date.now() - activityTime > staleRefreshJobMs;
}

function splitCsvLine(line: string) {
  return line.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)?.map((value) => value.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, "\"").trim()) ?? [];
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift() ?? "").map((header) => header.trim());
  return lines.map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

async function cachedText(name: string, url: string, force = false) {
  const file = path.join(cacheRoot, name);
  if (!force) {
    try {
      return await fs.readFile(file, "utf8");
    } catch {}
  }
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not download ${url} (${response.status})`);
  const text = await response.text();
  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.writeFile(file, text);
  return text;
}

const first = (row: Record<string, string>, names: string[]) => {
  const lower = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/\s+/g, ""), value]));
  for (const name of names) {
    const value = lower.get(name.toLowerCase().replace(/\s+/g, ""));
    if (value) return value.trim();
  }
  return "";
};

export async function getSecurityMaster(force = false): Promise<InstrumentRecord[]> {
  const rows = parseCsv(await cachedText("dhan-scrip-master-detailed.csv", process.env.DHAN_SECURITY_MASTER_URL || scripMasterUrl, force));
  return rows
    .map((row) => {
      const exchange = first(row, ["EXCH_ID", "SEM_EXM_EXCH_ID", "Exchange"]);
      const segment = first(row, ["SEGMENT", "SEM_SEGMENT", "Segment"]);
      const instrument = first(row, ["INSTRUMENT", "SEM_INSTRUMENT_NAME", "INSTRUMENT_TYPE", "Instrument"]);
      const securityId = first(row, ["SECURITY_ID", "SEM_SMST_SECURITY_ID", "SecurityId"]);
      const symbol = first(row, ["UNDERLYING_SYMBOL", "SYMBOL", "TRADING_SYMBOL", "SEM_TRADING_SYMBOL", "SYMBOL_NAME", "SM_SYMBOL_NAME"]);
      const tradingSymbol = first(row, ["TRADING_SYMBOL", "SEM_TRADING_SYMBOL", "UNDERLYING_SYMBOL", "SYMBOL", "Trading Symbol"]) || symbol;
      const isin = first(row, ["ISIN", "SEM_ISIN_CODE", "ISIN_CODE"]);
      const isNseEquity = exchange === "NSE" && segment === "E" && instrument.toUpperCase().includes("EQUITY");
      return {
        security_id: securityId,
        symbol: tradingSymbol.replace(/-EQ$/, ""),
        trading_symbol: tradingSymbol,
        company_name: first(row, ["DISPLAY_NAME", "SM_SYMBOL_NAME", "SEM_CUSTOM_SYMBOL", "COMPANY_NAME"]) || symbol || tradingSymbol,
        isin,
        exchange,
        exchange_segment: isNseEquity ? "NSE_EQ" : "",
        segment,
        instrument,
        status: securityId && isNseEquity ? "ACTIVE" : "UNMAPPED",
        price_adjustment_status: "UNKNOWN",
      } satisfies InstrumentRecord;
    })
    .filter((row) => row.security_id && row.status === "ACTIVE");
}

export async function getCurrentUniverse(universeName?: UniverseName, force = false): Promise<UniverseMemberRecord[]> {
  const names: UniverseName[] = universeName ? [universeName] : ["MIDCAP", "SMALLCAP"];
  const master = await getSecurityMaster(force);
  const bySymbol = new Map(master.map((item) => [item.symbol.toUpperCase(), item]));
  const verifiedAt = new Date().toISOString();
  const members: UniverseMemberRecord[] = [];
  for (const name of names) {
    const source = universeSources[name];
    const rows = parseCsv(await cachedText(`${name.toLowerCase()}-constituents.csv`, source.url, force));
    for (const row of rows) {
      const symbol = first(row, ["Symbol", "SYMBOL"]).toUpperCase().replace(/-EQ$/, "");
      if (!symbol) continue;
      const instrument = bySymbol.get(symbol);
      members.push({
        universe_name: name,
        symbol,
        company_name: first(row, ["Company Name", "Company", "Name"]) || instrument?.company_name || symbol,
        security_id: instrument?.security_id ?? "",
        isin: instrument?.isin ?? "",
        exchange: "NSE",
        segment: instrument?.exchange_segment ?? "NSE_EQ",
        instrument: "EQUITY",
        universe_source: "current_index_constituents",
        is_current_constituent: true,
        source: `${source.label}: ${source.url}`,
        last_verified_at: verifiedAt,
      });
    }
  }
  return members;
}

export async function refreshUniverseData(force = false) {
  const db = await readDatabase();
  const members = await getCurrentUniverse(undefined, force);
  const masterBySecurity = new Map((await getSecurityMaster(false)).map((instrument) => [instrument.security_id, instrument]));
  for (const member of members) {
    upsertUniverseMember(db, member);
    if (member.security_id) {
      markFailureResolved(db, `UNMAPPED:${member.symbol}`);
      markFailureResolved(db, member.security_id);
    }
    const instrument = masterBySecurity.get(member.security_id);
    if (instrument) upsertInstrument(db, instrument);
  }
  await writeDatabase(db);
  return members;
}

export function requiredHistoryStartDate() {
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear() - 5, end.getUTCMonth(), end.getUTCDate()));
  return dhanDate(start);
}

export async function getMissingDateRanges(securityId: string) {
  const db = await readDatabase();
  return missingDateRangesFromLatest(latestPriceDate(db, securityId)).ranges;
}

function missingDateRangesFromLatest(latest?: string) {
  const tradingDate = getIndiaTradingDate();
  if (!latest) return { latest, ranges: [{ fromDate: requiredHistoryStartDate(), toDate: tradingDate }] };
  return { latest, ranges: latest <= tradingDate ? [{ fromDate: latest, toDate: tradingDate }] : [] };
}

function isNseBusinessDay(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return false;
  return !fixedNseHolidayMonthDays.has(date.slice(5));
}

function dateRange(fromDate: string, toDate: string) {
  const dates: string[] = [];
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(dhanDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function isTodayOnlyHistoricalGap(fromDate: string, toDate: string) {
  const tradeDate = today();
  if (toDate !== tradeDate || !isNseBusinessDay(tradeDate)) return false;
  const missingBusinessDays = dateRange(fromDate, toDate).filter(isNseBusinessDay);
  return missingBusinessDays.length === 1 && missingBusinessDays[0] === tradeDate;
}

function isNoHistoricalDataError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("no daily candles") || message.includes("no data") || message.includes("no data present");
}

function isNoIntradayDataError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return isNoHistoricalDataError(error) || message.includes("missing required fields") || message.includes("bad values for parameters") || message.includes("incorrect parameters");
}

function dhanExchangeSegment(segment?: string) {
  if (segment === "NSE_EQ" || segment === "BSE_EQ") return segment;
  if (segment === "E" || !segment) return "NSE_EQ";
  return segment;
}

const pendingEodNotice = () =>
  "Dhan Daily did not include today's EOD candle yet. Today's candle was constructed from completed Dhan intraday candles where available and will be reconciled automatically on a later refresh.";

export async function withRetry<T>(label: string, task: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      last = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
  throw last instanceof Error ? last : new Error(`${label} failed`);
}

async function postDhanJson(pathname: string, payload: Record<string, unknown>) {
  return new Promise<{ ok: boolean; status: number; body: any }>((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request({
      hostname: "api.dhan.co",
      path: `/v2${pathname}`,
      method: "POST",
      rejectUnauthorized: false,
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        "access-token": process.env.DHAN_ACCESS_TOKEN!,
        "client-id": process.env.DHAN_CLIENT_ID!,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: any = {};
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          parsed = { message: text || "Invalid JSON response from Dhan." };
        }
        resolve({ ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300), status: response.statusCode ?? 0, body: parsed });
      });
    });
    request.setTimeout(15000, () => request.destroy(new Error("Dhan request timed out.")));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

export async function getHistoricalData(security: Pick<Security, "securityId" | "symbol" | "segment">, fromDate: string, toDate: string): Promise<Candle[]> {
  if (!hasDhanCredentials()) throw new Error("Dhan credentials are not configured.");
  return withRetry(`Dhan historical ${security.symbol}`, async () => {
      const response = await postDhanJson("/charts/historical", {
      securityId: security.securityId,
      exchangeSegment: dhanExchangeSegment(security.segment),
      instrument: "EQUITY",
      expiryCode: 0,
      oi: false,
      fromDate,
      toDate,
    });
    if (response.status === 429 || response.status >= 500) throw new Error(`Dhan transient error ${response.status}`);
    const body = response.body;
    const candles = body.data?.timestamp ? body.data : body;
    const ok = response.ok && (body.status === undefined || body.status === "success") && candles.timestamp?.length;
    if (!ok) {
      throw new Error(dhanReason(body, "No daily candles were returned."));
    }
    return candles.timestamp.map((ts: number, index: number) => ({
      date: dhanDailyTimestampDate(ts),
      open: Number(candles.open[index]),
      high: Number(candles.high[index]),
      low: Number(candles.low[index]),
      close: Number(candles.close[index]),
      volume: Number(candles.volume[index] ?? 0),
    }));
  });
}

export async function getIntradayData(securityId: string, interval = 60, days = 30): Promise<Candle[]> {
  if (!hasDhanCredentials()) throw new Error("Dhan credentials are not configured.");
  if (![1, 5, 15, 25, 60].includes(interval)) throw new Error("Unsupported intraday interval.");
  const db = await readDatabase();
  const instrument = db.instruments.find((row) => row.security_id === securityId);
  const member = db.universe_members.find((row) => row.security_id === securityId);
  if (!instrument && !member) throw new Error(`No instrument metadata found for security ID ${securityId}.`);

  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - Math.min(Math.max(days, 1), 90));
  from.setHours(9, 15, 0, 0);

  const exchangeSegment = dhanExchangeSegment(instrument?.exchange_segment || member?.segment);
  const symbol = instrument?.symbol || member?.symbol || securityId;
  return withRetry(`Dhan intraday ${symbol}`, async () => {
    const response = await postDhanJson("/charts/intraday", {
      securityId,
      exchangeSegment,
      instrument: "EQUITY",
      interval: String(interval),
      oi: false,
      fromDate: dhanDateTime(from),
      toDate: dhanDateTime(to),
    });
    if (response.status === 429 || response.status >= 500) throw new Error(`Dhan transient error ${response.status}`);
    const body = response.body;
    const candles = body.data?.timestamp ? body.data : body;
    const ok = response.ok && (body.status === undefined || body.status === "success") && candles.timestamp?.length;
    if (!ok) {
      console.error("Dhan intraday response did not include candles", {
        status: response.status,
        dhanStatus: body?.status,
        errorType: body?.errorType,
        errorCode: body?.errorCode,
        errorMessage: body?.errorMessage,
        remarks: body?.remarks,
        timestampLength: candles.timestamp?.length ?? 0,
      });
      throw new Error(dhanReason(body, "No intraday candles were returned."));
    }
    return candles.timestamp.map((ts: number, index: number) => ({
      date: new Date(ts * 1000).toISOString(),
      open: Number(candles.open[index]),
      high: Number(candles.high[index]),
      low: Number(candles.low[index]),
      close: Number(candles.close[index]),
      volume: Number(candles.volume[index] ?? 0),
    })).sort((a: Candle, b: Candle) => a.date.localeCompare(b.date));
  }, 1);
}

async function getIntradayDataForSession(security: Security, tradingDate: string, interval = 5): Promise<Candle[]> {
  if (!hasDhanCredentials()) throw new Error("Dhan credentials are not configured.");
  if (![1, 5, 15, 25, 60].includes(interval)) throw new Error("Unsupported intraday interval.");

  return withRetry(`Dhan intraday ${security.symbol}`, async () => {
    const response = await postDhanJson("/charts/intraday", {
      securityId: security.securityId,
      exchangeSegment: dhanExchangeSegment(security.segment),
      instrument: "EQUITY",
      interval: String(interval),
      oi: false,
      fromDate: indiaSessionDateTime(tradingDate, marketOpenMinutes),
      toDate: indiaSessionDateTime(tradingDate, marketCloseMinutes),
    });
    if (response.status === 429 || response.status >= 500) throw new Error(`Dhan transient error ${response.status}`);
    const body = response.body;
    const candles = body.data?.timestamp ? body.data : body;
    const ok = response.ok && (body.status === undefined || body.status === "success") && candles.timestamp?.length;
    if (!ok) throw new Error(dhanReason(body, "No intraday candles were returned."));
    return candles.timestamp.map((ts: number, index: number) => ({
      date: new Date(ts * 1000).toISOString(),
      open: Number(candles.open[index]),
      high: Number(candles.high[index]),
      low: Number(candles.low[index]),
      close: Number(candles.close[index]),
      volume: Number(candles.volume[index] ?? 0),
    })).sort((a: Candle, b: Candle) => a.date.localeCompare(b.date));
  });
}

export function validateConstructedDailyCandle(candle: Candle, sourceCandleCount: number, intervalMinutes = 5) {
  const values = [candle.open, candle.high, candle.low, candle.close, candle.volume];
  if (!candle.date) return { valid: false, reason: "missing_date" };
  if (values.some((value) => !Number.isFinite(value))) return { valid: false, reason: "non_numeric_ohlcv" };
  if ([candle.open, candle.high, candle.low, candle.close].some((value) => value <= 0)) return { valid: false, reason: "non_positive_price" };
  if (candle.high < candle.open || candle.high < candle.close || candle.high < candle.low) return { valid: false, reason: "invalid_high" };
  if (candle.low > candle.open || candle.low > candle.close) return { valid: false, reason: "invalid_low" };
  if (candle.volume < 0) return { valid: false, reason: "negative_volume" };
  const expectedFullSessionCandles = Math.floor((marketCloseMinutes - marketOpenMinutes) / intervalMinutes);
  const minimumReasonableCandles = Math.max(6, Math.floor(expectedFullSessionCandles * 0.25));
  if (sourceCandleCount < minimumReasonableCandles) return { valid: false, reason: "insufficient_intraday_candles" };
  return { valid: true };
}

export function aggregateIntradayToDaily(candles: Candle[], tradingDate: string, now = new Date(), intervalMinutes = 5) {
  const indiaNow = getIndiaNow(now);
  const lastCompletedMinute = indiaNow.date === tradingDate
    ? Math.min(marketCloseMinutes, indiaNow.hour * 60 + indiaNow.minute - ((indiaNow.hour * 60 + indiaNow.minute) % intervalMinutes))
    : marketCloseMinutes;
  const validCandles = candles
    .map((candle) => ({ candle, parts: indiaTimestampParts(candle.date) }))
    .filter(({ parts }) => parts?.date === tradingDate && parts.minutes >= marketOpenMinutes && parts.minutes < marketCloseMinutes && parts.minutes + intervalMinutes <= lastCompletedMinute)
    .sort((a, b) => (a.parts?.minutes ?? 0) - (b.parts?.minutes ?? 0))
    .map(({ candle }) => candle);

  if (!validCandles.length) return { candle: null, sourceCandleCount: 0, valid: false, reason: "no_intraday_trading_data" };

  const daily: Candle = {
    date: tradingDate,
    open: validCandles[0].open,
    high: Math.max(...validCandles.map((candle) => candle.high)),
    low: Math.min(...validCandles.map((candle) => candle.low)),
    close: validCandles.at(-1)!.close,
    // Dhan documents intraday history as candle OHLC and volume arrays, so volume is treated as per-candle volume and summed.
    volume: validCandles.reduce((sum, candle) => sum + candle.volume, 0),
  };
  return { candle: daily, sourceCandleCount: validCandles.length, ...validateConstructedDailyCandle(daily, validCandles.length, intervalMinutes) };
}

function validateCandles(securityId: string, symbol: string, candles: Candle[]): DataQualityIssueRecord[] {
  const now = new Date().toISOString();
  const issues: DataQualityIssueRecord[] = [];
  const seen = new Set<string>();
  let previous = "";
  candles.forEach((candle) => {
    const values = [candle.open, candle.high, candle.low, candle.close, candle.volume];
    const add = (issue_code: string, issue_message: string) =>
      issues.push({ id: `${securityId}-${candle.date}-${issue_code}`, security_id: securityId, symbol, trade_date: candle.date, issue_code, issue_message, severity: "error", created_at: now });
    if (!candle.date) add("missing_date", "Candle is missing a trade date.");
    if (seen.has(candle.date)) add("duplicate_date", "Duplicate trade date returned by source.");
    if (previous && candle.date < previous) add("unsorted_date", "Candles are not sorted by date.");
    if (values.some((value) => !Number.isFinite(value))) add("non_numeric_ohlcv", "OHLCV contains a non-numeric value.");
    if ([candle.open, candle.high, candle.low, candle.close].some((value) => value < 0)) add("negative_price", "OHLC contains an impossible negative price.");
    if (candle.high < candle.open || candle.high < candle.close) add("invalid_high", "High is below open or close.");
    if (candle.low > candle.open || candle.low > candle.close) add("invalid_low", "Low is above open or close.");
    if (candle.volume < 0) add("negative_volume", "Volume is negative.");
    seen.add(candle.date);
    previous = candle.date;
  });
  return issues;
}

function applyHistoricalData(db: SeasonalityDatabase, security: Security, candles: Candle[], dataSource: DailyPriceRecord["data_source"] = officialDataSource, isProvisional = false) {
  const now = new Date().toISOString();
  const issues = validateCandles(security.securityId, security.symbol, candles);
  let reconciled = 0;
  if (!isProvisional) {
    const incomingDates = new Set(candles.map((candle) => candle.date));
    reconciled = db.daily_prices.filter((row) => row.security_id === security.securityId && incomingDates.has(row.trade_date) && row.is_provisional).length;
  }
  const rows: DailyPriceRecord[] = candles.map((candle) => ({
    id: `${security.securityId}-${candle.date}`,
    security_id: security.securityId,
    symbol: security.symbol,
    isin: security.isin ?? "",
    trade_date: candle.date,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    exchange_segment: dhanExchangeSegment(security.segment),
    instrument: "EQUITY",
    data_source: dataSource,
    is_provisional: isProvisional,
    created_at: now,
    updated_at: now,
  }));
  upsertDailyPrices(db, rows);
  upsertInstrument(db, {
    security_id: security.securityId,
    symbol: security.symbol,
    trading_symbol: security.symbol,
    company_name: security.name,
    isin: security.isin ?? "",
    exchange: security.exchange,
    exchange_segment: dhanExchangeSegment(security.segment),
    segment: dhanExchangeSegment(security.segment) === "NSE_EQ" ? "E" : security.segment,
    instrument: security.instrument || "EQUITY",
    status: "ACTIVE",
    price_adjustment_status: "UNKNOWN",
  });
  replaceQualityIssues(db, security.securityId, issues);
  markFailureResolved(db, security.securityId);
  const stockRows = db.daily_prices.filter((row) => row.security_id === security.securityId).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const instrument = db.instruments.find((row) => row.security_id === security.securityId);
  if (instrument) {
    instrument.data_start_date = stockRows.at(0)?.trade_date;
    instrument.data_end_date = stockRows.at(-1)?.trade_date;
    instrument.last_updated_at = now;
    instrument.number_of_sessions = stockRows.length;
  }
  return { insertedOrUpdated: rows.length, issues: issues.length, dataThroughDate: stockRows.at(-1)?.trade_date, reconciled };
}

export async function saveHistoricalData(security: Security, candles: Candle[]) {
  return mutateDataStore(async () => {
    const db = await readDatabase();
    const result = applyHistoricalData(db, security, candles);
    await writeDatabase(db);
    return result;
  });
}

function securityFromMember(member: UniverseMemberRecord | Security): Security {
  return "securityId" in member
    ? { ...member, segment: dhanExchangeSegment(member.segment) }
    : { securityId: member.security_id, symbol: member.symbol, name: member.company_name, exchange: member.exchange, segment: dhanExchangeSegment(member.segment), instrument: member.instrument, isin: member.isin };
}

async function downloadHistoricalDataForMember(member: UniverseMemberRecord | Security, latest?: string) {
  const security = securityFromMember(member);
  if (!security.securityId) throw new Error(`No Dhan security ID is mapped for ${security.symbol}.`);
  const { ranges } = missingDateRangesFromLatest(latest);
  let total = 0;
  let dataThroughDate: string | undefined = latest;
  const candlesByRange: Candle[][] = [];
  for (const range of ranges) {
    let candles: Candle[];
    try {
      candles = await getHistoricalData(security, range.fromDate, range.toDate);
    } catch (error) {
      if (isNoHistoricalDataError(error)) {
        continue;
      }
      throw error;
    }
    total += candles.length;
    dataThroughDate = candles.at(-1)?.date ?? dataThroughDate;
    candlesByRange.push(candles);
  }
  return { security, candles: candlesByRange.flat(), downloadedRows: total, skipped: ranges.length === 0 && total === 0, dataThroughDate };
}

export async function refreshInstrumentData(member: UniverseMemberRecord | Security) {
  const security = securityFromMember(member);
  const db = await readDatabase();
  const result = await downloadHistoricalDataForMember(member, latestPriceDate(db, security.securityId));
  const tradingDate = getIndiaTradingDate();
  const hasOfficialToday = result.candles.some((candle) => candle.date === tradingDate);
  let provisionalAggregate: ReturnType<typeof aggregateIntradayToDaily> | null = null;
  let provisionalReason: string | undefined;

  if (!hasOfficialToday && isIndianMarketClosed()) {
    try {
      const intraday = await getIntradayDataForSession(result.security, tradingDate, 5);
      provisionalAggregate = aggregateIntradayToDaily(intraday, tradingDate, new Date(), 5);
      if (!provisionalAggregate.candle || !provisionalAggregate.valid) {
        provisionalReason = "reason" in provisionalAggregate ? provisionalAggregate.reason : "invalid_intraday_aggregation";
        console.info(`No intraday trading data available for ${tradingDate}.`, { securityId: result.security.securityId, symbol: result.security.symbol, reason: provisionalReason });
      }
    } catch (error) {
      if (isNoIntradayDataError(error)) {
        provisionalReason = "no_intraday_trading_data";
        console.info(`No intraday trading data available for ${tradingDate}.`, {
          securityId: result.security.securityId,
          symbol: result.security.symbol,
          segment: dhanExchangeSegment(result.security.segment),
          reason: error instanceof Error ? error.message : String(error),
        });
      } else {
        throw error;
      }
    }
  }

  return mutateDataStore(async () => {
    const db = await readDatabase();
    const official = result.candles.length ? applyHistoricalData(db, result.security, result.candles, officialDataSource, false) : { insertedOrUpdated: 0, dataThroughDate: result.dataThroughDate, reconciled: 0 };
    let provisionalCreated = 0;
    let pendingEod = false;
    let dataThroughDate = official.dataThroughDate ?? result.dataThroughDate;

    if (provisionalAggregate?.candle && provisionalAggregate.valid) {
      const saved = applyHistoricalData(db, result.security, [provisionalAggregate.candle], provisionalDataSource, true);
      provisionalCreated = saved.insertedOrUpdated;
      pendingEod = true;
      dataThroughDate = saved.dataThroughDate ?? dataThroughDate;
    }

    markFailureResolved(db, security.securityId);
    await writeDatabase(db);
    return {
      downloadedRows: official.insertedOrUpdated + provisionalCreated,
      historicalBackfilled: official.insertedOrUpdated,
      officialUpdated: official.insertedOrUpdated,
      reconciled: official.reconciled,
      provisionalCreated,
      skipped: official.insertedOrUpdated === 0 && provisionalCreated === 0,
      pendingEod,
      provisionalReason,
      dataThroughDate,
    };
  });
}

function startJob(universeName: UniverseName | undefined, total: number): DataDownloadJobRecord {
  return {
    id: `job-${Date.now()}`,
    universe_name: universeName,
    status: "running",
    total,
    completed: 0,
    successful: 0,
    failed: 0,
    remaining: total,
    progress: 0,
    current_status: "Starting",
    started_at: new Date().toISOString(),
    trading_date: getIndiaTradingDate(),
    historical_candles_backfilled: 0,
    official_candles_updated: 0,
    provisional_candles_created: 0,
    provisional_candles_reconciled: 0,
    already_up_to_date: 0,
    errors: [],
  };
}

type DataStatusListener = (job: DataDownloadJobRecord) => void;
const dataStatusListeners = ((globalThis as typeof globalThis & { __seasonalityDataStatusListeners?: Set<DataStatusListener> }).__seasonalityDataStatusListeners ??= new Set<DataStatusListener>());

export function addDataStatusListener(listener: DataStatusListener) {
  dataStatusListeners.add(listener);
  return () => dataStatusListeners.delete(listener);
}

function emitDataStatusJob(job: DataDownloadJobRecord) {
  const snapshot = { ...job, errors: [...job.errors] };
  dataStatusListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      dataStatusListeners.delete(listener);
    }
  });
}

async function updateJob(jobId: string, update: (job: DataDownloadJobRecord) => void) {
  return mutateDataStore(async () => {
    const db = await readDatabase();
    const job = db.data_download_jobs.find((row) => row.id === jobId);
    if (!job) return null;
    update(job);
    await writeDatabase(db);
    emitDataStatusJob(job);
    return job;
  });
}

async function markJobFailedBestEffort(jobId: string, error: unknown) {
  try {
    await updateJob(jobId, (job) => {
      job.status = "failed";
      job.finished_at = new Date().toISOString();
      job.current_status = "Failed";
      job.errors.push(error instanceof Error ? error.message : "Unknown refresh failure");
    });
  } catch (statusError) {
    console.error("Could not persist failed refresh status", {
      jobId,
      originalError: error instanceof Error ? error.message : String(error),
      statusError: statusError instanceof Error ? statusError.message : String(statusError),
    });
  }
}

async function runMemberWorkers<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function runHistoricalDataJob(jobId: string, universeName?: UniverseName, retryFailures = false, forceUniverse = false) {
  await updateJob(jobId, (job) => {
    job.status = "running";
    job.current_status = retryFailures ? "Preparing failed downloads" : "Refreshing universe";
  });

  try {
    if (!retryFailures) {
      const currentDb = await readDatabase();
      const hasUniverse = currentDb.universe_members.some((member) => !universeName || member.universe_name === universeName);
      if (forceUniverse || !hasUniverse) await refreshUniverseData(forceUniverse);
    }

    const db = await readDatabase();
    const members = retryFailures
      ? db.universe_members.filter((member) => db.download_failures.some((failure) => failure.status === "open" && failure.security_id === member.security_id))
      : db.universe_members.filter((member) => !universeName || member.universe_name === universeName);
    await updateJob(jobId, (job) => {
      job.total = members.length;
      job.remaining = members.length;
      job.progress = members.length ? 0 : 100;
      job.trading_date = getIndiaTradingDate();
      job.current_status = members.length ? "Starting downloads" : "No instruments to refresh";
    });

    const concurrency = dataRefreshConcurrency();
    await updateJob(jobId, (job) => {
      job.current_status = members.length ? `Downloading with ${Math.min(concurrency, members.length)} workers` : "No instruments to refresh";
    });

    for (let start = 0; start < members.length; start += concurrency) {
      const batch = members.slice(start, start + concurrency);
      const results = await Promise.all(batch.map(async (member) => {
        try {
          const result = await refreshInstrumentData(member);
          return { member, result };
        } catch (error) {
          return { member, error };
        }
      }));

      await mutateDataStore(async () => {
        const db = await readDatabase();
        const job = db.data_download_jobs.find((row) => row.id === jobId);
        for (const item of results) {
          if ("error" in item) {
            upsertFailure(db, {
              symbol: item.member.symbol,
              security_id: item.member.security_id || `UNMAPPED:${item.member.symbol}`,
              error_code: item.error instanceof Error && item.error.message.includes("429") ? "HTTP_429" : "DOWNLOAD_FAILED",
              error_message: item.error instanceof Error ? item.error.message : "Unknown download error",
            });
            if (job) {
              job.failed += 1;
              job.errors.push(`${item.member.symbol}: ${item.error instanceof Error ? item.error.message : "Unknown error"}`);
            }
          } else {
            if (job) {
              job.successful += 1;
              job.last_successful_update = new Date().toISOString();
              job.data_through_date = item.result.dataThroughDate ?? job.data_through_date;
              job.historical_candles_backfilled = (job.historical_candles_backfilled ?? 0) + (item.result.historicalBackfilled ?? 0);
              job.official_candles_updated = (job.official_candles_updated ?? 0) + (item.result.officialUpdated ?? 0);
              job.provisional_candles_created = (job.provisional_candles_created ?? 0) + (item.result.provisionalCreated ?? 0);
              job.provisional_candles_reconciled = (job.provisional_candles_reconciled ?? 0) + (item.result.reconciled ?? 0);
              if (item.result.skipped) job.already_up_to_date = (job.already_up_to_date ?? 0) + 1;
              if (item.result.pendingEod) {
                job.pending_eod_count = (job.pending_eod_count ?? 0) + 1;
                job.notice = pendingEodNotice();
              }
            }
          }

          if (job) {
            job.completed += 1;
            job.current_stock = item.member.symbol;
          }
        }
        if (job) {
          job.remaining = Math.max(job.total - job.completed, 0);
          job.progress = job.total ? Math.round((job.completed / job.total) * 100) : 100;
          job.current_status = job.remaining
            ? `Downloading with ${Math.min(concurrency, job.remaining)} workers`
            : job.pending_eod_count
              ? "Finished; waiting for Dhan EOD candle"
              : "Finished";
        }
        await writeDatabase(db);
        if (job) emitDataStatusJob(job);
      });
    }

    await updateJob(jobId, (job) => {
      job.status = job.failed ? "completed_with_failures" : "completed";
      job.finished_at = new Date().toISOString();
      job.current_status = "Finished";
      job.progress = 100;
      job.remaining = 0;
    });
  } catch (error) {
    await markJobFailedBestEffort(jobId, error);
  }
}

const activeRefreshJobs = ((globalThis as typeof globalThis & { __seasonalityActiveRefreshJobs?: Set<string> }).__seasonalityActiveRefreshJobs ??= new Set<string>());

export async function startHistoricalDataRefresh(universeName?: UniverseName, retryFailures = false, forceUniverse = false) {
  const result = await mutateDataStore(async () => {
    const db = await readDatabase();
    const running = db.data_download_jobs.find((job) => job.status === "running" || job.status === "queued");
    if (running && activeRefreshJobs.has(running.id) && !isStaleRefreshJob(running)) return { job: running, started: false };
    if (running) {
      running.status = "failed";
      running.finished_at = new Date().toISOString();
      running.current_status = "Interrupted";
      running.errors.push("This job was left running by a previous server process and was marked interrupted before starting a new job.");
      activeRefreshJobs.delete(running.id);
    }

    const job = startJob(universeName, 0);
    job.status = "queued";
    job.current_status = "Queued";
    db.data_download_jobs.unshift(job);
    await writeDatabase(db);
    emitDataStatusJob(job);
    return { job, started: true };
  });

  if (result.started && !activeRefreshJobs.has(result.job.id)) {
    activeRefreshJobs.add(result.job.id);
    void runHistoricalDataJob(result.job.id, universeName, retryFailures, forceUniverse)
      .catch((error) => {
        console.error("Unhandled historical data refresh failure", error);
      })
      .finally(() => activeRefreshJobs.delete(result.job.id));
  }

  return result;
}

export async function updateHistoricalData(universeName?: UniverseName, retryFailures = false) {
  const db = await readDatabase();
  const members = retryFailures
    ? db.universe_members.filter((member) => db.download_failures.some((failure) => failure.status === "open" && failure.security_id === member.security_id))
    : db.universe_members.filter((member) => !universeName || member.universe_name === universeName);
  const job = startJob(universeName, members.length);
  job.trading_date = getIndiaTradingDate();
  db.data_download_jobs.unshift(job);
  await writeDatabase(db);

  for (const member of members) {
    const liveDb = await readDatabase();
    const liveJob = liveDb.data_download_jobs.find((row) => row.id === job.id);
    if (!liveJob) continue;
    liveJob.current_stock = member.symbol;
    liveJob.current_status = "Downloading";
    await writeDatabase(liveDb);
    try {
      const result = await refreshInstrumentData(member);
      const after = await readDatabase();
      const afterJob = after.data_download_jobs.find((row) => row.id === job.id)!;
      afterJob.successful += 1;
      afterJob.last_successful_update = new Date().toISOString();
      afterJob.data_through_date = result.dataThroughDate ?? after.daily_prices.filter((row) => row.security_id === member.security_id).map((row) => row.trade_date).sort().at(-1) ?? afterJob.data_through_date;
      afterJob.historical_candles_backfilled = (afterJob.historical_candles_backfilled ?? 0) + (result.historicalBackfilled ?? 0);
      afterJob.official_candles_updated = (afterJob.official_candles_updated ?? 0) + (result.officialUpdated ?? 0);
      afterJob.provisional_candles_created = (afterJob.provisional_candles_created ?? 0) + (result.provisionalCreated ?? 0);
      afterJob.provisional_candles_reconciled = (afterJob.provisional_candles_reconciled ?? 0) + (result.reconciled ?? 0);
      if (result.skipped) afterJob.already_up_to_date = (afterJob.already_up_to_date ?? 0) + 1;
      if (result.pendingEod) {
        afterJob.pending_eod_count = (afterJob.pending_eod_count ?? 0) + 1;
        afterJob.notice = pendingEodNotice();
      }
      markFailureResolved(after, member.security_id);
      await writeDatabase(after);
    } catch (error) {
      const failedDb = await readDatabase();
      upsertFailure(failedDb, {
        symbol: member.symbol,
        security_id: member.security_id,
        error_code: error instanceof Error && error.message.includes("429") ? "HTTP_429" : "DOWNLOAD_FAILED",
        error_message: error instanceof Error ? error.message : "Unknown download error",
      });
      const failedJob = failedDb.data_download_jobs.find((row) => row.id === job.id)!;
      failedJob.failed += 1;
      failedJob.errors.push(`${member.symbol}: ${error instanceof Error ? error.message : "Unknown error"}`);
      await writeDatabase(failedDb);
    } finally {
      const progressDb = await readDatabase();
      const progressJob = progressDb.data_download_jobs.find((row) => row.id === job.id)!;
      progressJob.completed += 1;
      progressJob.remaining = Math.max(progressJob.total - progressJob.completed, 0);
      progressJob.progress = progressJob.total ? Math.round((progressJob.completed / progressJob.total) * 100) : 100;
      progressJob.current_status = progressJob.remaining ? "Continuing" : progressJob.pending_eod_count ? "Finished; waiting for Dhan EOD candle" : "Finished";
      await writeDatabase(progressDb);
    }
  }

  const finalDb = await readDatabase();
  const finalJob = finalDb.data_download_jobs.find((row) => row.id === job.id)!;
  finalJob.status = finalJob.failed ? "completed_with_failures" : "completed";
  finalJob.finished_at = new Date().toISOString();
  finalJob.current_status = "Finished";
  finalJob.progress = 100;
  await writeDatabase(finalDb);
  return finalJob;
}

export async function getDataStatus() {
  const db = await readDatabase();
  const summaries = (["MIDCAP", "SMALLCAP"] as UniverseName[]).map((universeName) => {
    const members = db.universe_members.filter((member) => member.universe_name === universeName);
    const securityIds = new Set(members.map((member) => member.security_id).filter(Boolean));
    const prices = db.daily_prices.filter((row) => securityIds.has(row.security_id));
    const downloaded = new Set(prices.map((row) => row.security_id));
    const failed = new Set(db.download_failures.filter((failure) => failure.status === "open" && securityIds.has(failure.security_id)).map((failure) => failure.security_id));
    const dates = prices.map((row) => row.trade_date).sort();
    const latestDate = dates.at(-1) ?? null;
    const latestRows = latestDate ? prices.filter((row) => row.trade_date === latestDate) : [];
    const provisionalRows = latestRows.filter((row) => row.is_provisional);
    const lastRefresh = members.map((member) => db.instruments.find((instrument) => instrument.security_id === member.security_id)?.last_updated_at).filter(Boolean).sort().at(-1);
    return {
      universe_name: universeName,
      total_constituents: members.length,
      mapped: members.filter((member) => member.security_id).length,
      stocks_downloaded: downloaded.size,
      stocks_pending: Math.max(securityIds.size - downloaded.size - failed.size, 0),
      stocks_failed: failed.size,
      earliest_data_date: dates.at(0) ?? null,
      latest_data_date: latestDate,
      total_ohlcv_rows: prices.length,
      last_refresh: lastRefresh ?? null,
      historical_sessions: prices.length,
      latest_official: latestRows.length - provisionalRows.length,
      latest_provisional: provisionalRows.length,
    };
  });
  const allDates = db.daily_prices.map((row) => row.trade_date).sort();
  const latestMarketDate = allDates.at(-1) ?? null;
  const latestMarketRows = latestMarketDate ? db.daily_prices.filter((row) => row.trade_date === latestMarketDate) : [];
  const latestProvisional = latestMarketRows.filter((row) => row.is_provisional).length;
  return {
    dhan_connected: hasDhanCredentials(),
    database_size_bytes: await getDatabaseSizeBytes(),
    price_adjustment_status: "UNKNOWN",
    latest_market_data: latestMarketDate
      ? {
          trading_date: latestMarketDate,
          official: latestMarketRows.length - latestProvisional,
          provisional: latestProvisional,
          data_status: latestProvisional > 0 ? "EOD candle constructed from Dhan intraday data." : "Official Dhan EOD data synchronized.",
        }
      : null,
    survivorship_bias_note: "Historical analysis currently uses the current constituent universe and may contain survivorship bias.",
    universe_sources: universeSources,
    latest_job: db.data_download_jobs[0] ?? null,
    summaries,
    failures: db.download_failures.filter((failure) => failure.status === "open"),
    quality_issues: db.data_quality_issues,
  };
}

export async function getPrices(securityId: string) {
  const db = await readDatabase();
  return db.daily_prices.filter((row) => row.security_id === securityId).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
}
