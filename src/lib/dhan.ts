import "server-only";
import fs from "node:fs/promises"; import path from "node:path";
import type { Candle, Security } from "./types";
const cacheRoot = path.join(process.cwd(), ".data", "dhan");
function dateInTimeZone(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
const date = (d: Date) => dateInTimeZone(d, "Asia/Kolkata");
const dailyTimestampDate = (timestampSeconds: number) => dateInTimeZone(new Date(timestampSeconds * 1000), "Asia/Kolkata");
async function cached<T>(key:string, load:()=>Promise<T>, force=false): Promise<T> { const file=path.join(cacheRoot,`${key}.json`); if (!force) try { return JSON.parse(await fs.readFile(file,"utf8")); } catch {} const value=await load(); await fs.mkdir(cacheRoot,{recursive:true}); await fs.writeFile(file,JSON.stringify(value)); return value; }
export const hasDhanCredentials = () => Boolean(process.env.DHAN_CLIENT_ID && process.env.DHAN_ACCESS_TOKEN);
async function dhanGet<T>(endpoint: string): Promise<T> {
  if (!hasDhanCredentials()) throw new Error("Dhan credentials are not configured.");
  let response: Response;
  try {
    response = await fetch(`https://api.dhan.co/v2${endpoint}`, {
      headers: { "accept": "application/json", "content-type": "application/json", "access-token": process.env.DHAN_ACCESS_TOKEN!, "client-id": process.env.DHAN_CLIENT_ID! },
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network request failed";
    throw new Error(`Could not reach Dhan API for ${endpoint}: ${reason}`);
  }
  const responseText = await response.text();
  let body: any;
  try { body = JSON.parse(responseText); } catch { body = {}; }
  if (!response.ok) {
    const rawReason = body?.remarks ?? body?.message ?? body?.error ?? body?.data;
    const reason = typeof rawReason === "string" ? rawReason : rawReason ? JSON.stringify(rawReason) : responseText.trim() || "No response details";
    throw new Error(`Dhan API request failed for ${endpoint}: HTTP ${response.status} (${reason})`);
  }
  return body as T;
}
export async function searchSecurities(query:string): Promise<Security[]> { const master = await cached("security-master-v3", async () => {
  const response=await fetch(process.env.DHAN_SECURITY_MASTER_URL || "https://images.dhan.co/api-data/api-scrip-master-detailed.csv", { cache:"no-store" });
  if(!response.ok) throw new Error("Could not download the Dhan security master. Check your internet connection and try again."); const lines=(await response.text()).split(/\r?\n/); const headers=(lines.shift()?.split(",") ?? []).map(h=>h.trim());
  const splitCsv=(line:string)=>line.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)?.map(value=>value.replace(/,$/,"").replace(/^"|"$/g,"").replace(/""/g,"\"")) ?? [];
  return lines.map(line=>{ const p=splitCsv(line); const val=(...names:string[])=>{ for (const name of names) { const value=p[headers.indexOf(name)]?.trim(); if (value) return value; } return ""; }; const exchange=val("SEM_EXM_EXCH_ID","EXCH_ID"); const segment=val("SEM_SEGMENT","SEGMENT"); const symbol=val("SEM_TRADING_SYMBOL","TRADING_SYMBOL","UNDERLYING_SYMBOL","SYMBOL","SYMBOL_NAME").replace(/-EQ$/,""); const exchangeSegment=exchange === "BSE" && segment === "E" ? "BSE_EQ" : exchange === "NSE" && segment === "E" ? "NSE_EQ" : exchange === "NSE" && segment === "I" ? "IDX_I" : ""; return {securityId:val("SEM_SMST_SECURITY_ID","SECURITY_ID"),symbol,name:val("SM_SYMBOL_NAME","DISPLAY_NAME","SEM_CUSTOM_SYMBOL","SYMBOL_NAME", "UNDERLYING_SYMBOL") || symbol,exchange,segment:exchangeSegment,instrument:val("SEM_INSTRUMENT_NAME","INSTRUMENT")}; }).filter(x=>x.securityId && x.symbol && x.segment);
 }); const needle=query.toLowerCase(); return master.filter(s=>s.symbol.toLowerCase().includes(needle)||s.name.toLowerCase().includes(needle)).sort((a,b)=>{ const aExact=a.symbol.toLowerCase()===needle ? 1 : 0; const bExact=b.symbol.toLowerCase()===needle ? 1 : 0; if(aExact!==bExact)return bExact-aExact; const aNse=a.segment==="NSE_EQ" ? 1 : 0; const bNse=b.segment==="NSE_EQ" ? 1 : 0; if(aNse!==bNse)return bNse-aNse; return a.symbol.localeCompare(b.symbol); }).slice(0,12); }
export async function historical(security:Security, force=false): Promise<Candle[]> { if(!hasDhanCredentials()) throw new Error("Dhan credentials are not configured."); const end=new Date(); const start=new Date(end); start.setUTCFullYear(start.getUTCFullYear()-5); start.setUTCDate(start.getUTCDate()+1); return cached(`daily-${security.securityId}`, async()=>{ const response=await fetch("https://api.dhan.co/v2/charts/historical",{method:"POST",headers:{"content-type":"application/json","access-token":process.env.DHAN_ACCESS_TOKEN!,"client-id":process.env.DHAN_CLIENT_ID!},body:JSON.stringify({securityId:security.securityId,exchangeSegment:security.segment || "NSE_EQ",instrument:"EQUITY",expiryCode:0,oi:false,fromDate:date(start),toDate:date(new Date(end.getTime()+86400000))}),cache:"no-store"}); const body=await response.json(); const candles=body.data?.timestamp ? body.data : body; const succeeded=body.status === undefined || body.status === "success"; if(!response.ok || !succeeded || !candles.timestamp?.length) { const rawReason=body.remarks ?? body.message ?? body.error; const reason=typeof rawReason === "string" ? rawReason : rawReason ? JSON.stringify(rawReason) : "No daily candles were returned."; console.error("Dhan historical-data response",{status:response.status,securityId:security.securityId,segment:security.segment,fromDate:date(start),toDate:date(end),reason}); throw new Error(`Dhan historical data unavailable for ${security.symbol}: ${reason}`); } return candles.timestamp.map((ts:number,i:number)=>({date:dailyTimestampDate(ts),open:candles.open[i],high:candles.high[i],low:candles.low[i],close:candles.close[i],volume:candles.volume[i]})); },force); }

export type DhanHolding = {
  exchange: string;
  tradingSymbol: string;
  securityId: string;
  isin: string;
  totalQty: number;
  dpQty: number;
  t1Qty: number;
  availableQty: number;
  collateralQty: number;
  avgCostPrice: number;
  ltp?: number;
  lastTradedPrice?: number;
  currentPrice?: number;
  unrealizedProfit?: number;
  unrealizedPnl?: number;
  pnl?: number;
  totalPnl?: number;
};

export type DhanPosition = {
  tradingSymbol: string;
  securityId: string;
  positionType: string;
  exchangeSegment: string;
  productType: string;
  buyAvg: number;
  buyQty: number;
  costPrice: number;
  sellAvg: number;
  sellQty: number;
  netQty: number;
  realizedProfit: number;
  unrealizedProfit: number;
  lastTradedPrice?: number;
  ltp?: number;
  dayPnl?: number;
  dayBuyValue: number;
  daySellValue: number;
};

export type DhanTrade = {
  orderId: string;
  exchangeTradeId: string;
  transactionType: "BUY" | "SELL";
  exchangeSegment: string;
  productType: string;
  orderType: string;
  tradingSymbol: string | null;
  customSymbol: string | null;
  securityId: string;
  tradedQuantity: number;
  tradedPrice: number;
  isin: string;
  instrument: string;
  sebiTax?: number | string;
  stt?: number | string;
  brokerageCharges?: number | string;
  serviceTax?: number | string;
  exchangeTransactionCharges?: number | string;
  stampDuty?: number | string;
  exchangeTime: string;
};

export type DhanOrderRequest = {
  correlationId?: string;
  transactionType: "BUY" | "SELL";
  exchangeSegment: "NSE_EQ" | "BSE_EQ";
  productType: "CNC" | "INTRADAY" | "MARGIN" | "MTF" | "CO" | "BO";
  orderType: "LIMIT" | "MARKET" | "STOP_LOSS" | "STOP_LOSS_MARKET";
  validity: "DAY" | "IOC";
  securityId: string;
  quantity: number;
  disclosedQuantity?: number;
  price?: number;
  triggerPrice?: number;
  afterMarketOrder?: boolean;
  amoTime?: "PRE_OPEN" | "OPEN" | "OPEN_30" | "OPEN_60" | "";
  boProfitValue?: number | "";
  boStopLossValue?: number | "";
};

export type DhanOrderResponse = {
  orderId: string;
  orderStatus: "TRANSIT" | "PENDING" | "REJECTED" | "CANCELLED" | "TRADED" | "EXPIRED";
};

async function dhanPost<T>(endpoint: string, body: unknown): Promise<T> {
  if (!hasDhanCredentials()) throw new Error("Dhan credentials are not configured.");
  let response: Response;
  try {
    response = await fetch(`https://api.dhan.co/v2${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", "access-token": process.env.DHAN_ACCESS_TOKEN!, "client-id": process.env.DHAN_CLIENT_ID! },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network request failed";
    throw new Error(`Could not reach Dhan API for ${endpoint}: ${reason}`);
  }
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const rawReason = responseBody?.remarks ?? responseBody?.message ?? responseBody?.error;
    const reason = typeof rawReason === "string" ? rawReason : rawReason ? JSON.stringify(rawReason) : `HTTP ${response.status}`;
    throw new Error(`Dhan API request failed for ${endpoint}: ${reason}`);
  }
  return responseBody as T;
}

export function isNseMarketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const total = hour * 60 + minute;
  return weekday !== "Sat" && weekday !== "Sun" && total >= 9 * 60 + 15 && total <= 15 * 60 + 30;
}

export async function placeOrder(input: DhanOrderRequest) {
  const payload = {
    dhanClientId: process.env.DHAN_CLIENT_ID!,
    correlationId: input.correlationId,
    transactionType: input.transactionType,
    exchangeSegment: input.exchangeSegment,
    productType: input.productType,
    orderType: input.orderType,
    validity: input.validity,
    securityId: input.securityId,
    quantity: input.quantity,
    disclosedQuantity: input.disclosedQuantity ?? 0,
    price: input.price ?? 0,
    triggerPrice: input.triggerPrice ?? 0,
    afterMarketOrder: input.afterMarketOrder ?? false,
    amoTime: input.amoTime ?? "",
    boProfitValue: input.boProfitValue ?? "",
    boStopLossValue: input.boStopLossValue ?? "",
  };
  return dhanPost<DhanOrderResponse>("/orders", payload);
}

export const getHoldings = () => dhanGet<DhanHolding[]>("/holdings");
export const getPositions = () => dhanGet<DhanPosition[]>("/positions");

const tradeWindowCache = new Map<string, { trades: DhanTrade[]; expiresAt: number }>();
const tradeWindowLoads = new Map<string, Promise<DhanTrade[]>>();
let tradeRequestQueue: Promise<void> = Promise.resolve();
let nextTradeRequestAt = 0;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function queuedTradePage(endpoint: string): Promise<DhanTrade[]> {
  const request = tradeRequestQueue.then(async () => {
    await wait(Math.max(0, nextTradeRequestAt - Date.now()));
    nextTradeRequestAt = Date.now() + 300;
    return dhanGet<DhanTrade[]>(endpoint);
  });
  tradeRequestQueue = request.then(() => undefined, () => undefined);
  return request;
}

async function tradePage(endpoint: string): Promise<DhanTrade[]> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await queuedTradePage(endpoint);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("HTTP 429")) throw error;
      if (attempt === 3) throw new Error(`Dhan trade history is rate limited after retries. Please try again in a minute. (${error.message})`);
      await wait(1000 * 2 ** attempt);
    }
  }
  throw new Error("Dhan trade history could not be loaded.");
}

async function loadTradeWindow(start: string, end: string): Promise<DhanTrade[]> {
  const key = `${process.env.DHAN_CLIENT_ID}/${start}/${end}`;
  const cached = tradeWindowCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.trades;
  const pending = tradeWindowLoads.get(key);
  if (pending) return pending;

  const load = (async () => {
    const trades: DhanTrade[] = [];
    const seenPages = new Set<string>();
    for (let page = 0; page < 500; page += 1) {
      const rows = await tradePage(`/trades/${start}/${end}/${page}`);
      if (!Array.isArray(rows) || rows.length === 0) break;
      const pageKey = JSON.stringify(rows.map((row) => [
        row.exchangeTradeId, row.orderId, row.exchangeTime, row.securityId,
        row.tradingSymbol, row.transactionType, row.tradedQuantity, row.tradedPrice,
      ]));
      if (seenPages.has(pageKey)) break;
      seenPages.add(pageKey);
      trades.push(...rows);
    }
    const today = new Date().toISOString().slice(0, 10);
    tradeWindowCache.set(key, { trades, expiresAt: Date.now() + (end >= today ? 15_000 : 86_400_000) });
    return trades;
  })();
  tradeWindowLoads.set(key, load);
  try { return await load; } finally { tradeWindowLoads.delete(key); }
}

export async function getTradeHistory(fromDate: string, toDate: string) {
  if (!hasDhanCredentials()) throw new Error("Dhan credentials are not configured.");
  const trades: DhanTrade[] = [];
  let windowStart = new Date(`${fromDate}T00:00:00Z`);
  const lastDay = new Date(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(windowStart.getTime()) || !Number.isFinite(lastDay.getTime()) || windowStart > lastDay) {
    throw new Error("Invalid Dhan trade history date range.");
  }
  const formatDate = (value: Date) => value.toISOString().slice(0, 10);
  while (windowStart <= lastDay) {
    // Keep requests small; Dhan may reject a long history range with HTTP 400.
    const windowEnd = new Date(Math.min(lastDay.getTime(), windowStart.getTime() + 29 * 86400000));
    const start = formatDate(windowStart);
    const end = formatDate(windowEnd);
    trades.push(...await loadTradeWindow(start, end));
    windowStart = new Date(windowEnd.getTime() + 86400000);
  }
  return trades;
}
