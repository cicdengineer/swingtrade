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
      headers: { "content-type": "application/json", "access-token": process.env.DHAN_ACCESS_TOKEN! },
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network request failed";
    throw new Error(`Could not reach Dhan API for ${endpoint}: ${reason}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const rawReason = body?.remarks ?? body?.message ?? body?.error;
    const reason = typeof rawReason === "string" ? rawReason : rawReason ? JSON.stringify(rawReason) : `HTTP ${response.status}`;
    throw new Error(`Dhan API request failed for ${endpoint}: ${reason}`);
  }
  return body as T;
}
export async function searchSecurities(query:string): Promise<Security[]> { const master = await cached("security-master-v3", async () => {
  const response=await fetch(process.env.DHAN_SECURITY_MASTER_URL || "https://images.dhan.co/api-data/api-scrip-master-detailed.csv", { cache:"no-store" });
  if(!response.ok) throw new Error("Could not download the Dhan security master. Check your internet connection and try again."); const lines=(await response.text()).split(/\r?\n/); const headers=(lines.shift()?.split(",") ?? []).map(h=>h.trim());
  const splitCsv=(line:string)=>line.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)?.map(value=>value.replace(/,$/,"").replace(/^"|"$/g,"").replace(/""/g,"\"")) ?? [];
  return lines.map(line=>{ const p=splitCsv(line); const val=(...names:string[])=>{ for (const name of names) { const value=p[headers.indexOf(name)]?.trim(); if (value) return value; } return ""; }; const exchange=val("SEM_EXM_EXCH_ID","EXCH_ID"); const segment=val("SEM_SEGMENT","SEGMENT"); const symbol=val("SEM_TRADING_SYMBOL","TRADING_SYMBOL","UNDERLYING_SYMBOL","SYMBOL","SYMBOL_NAME").replace(/-EQ$/,""); return {securityId:val("SEM_SMST_SECURITY_ID","SECURITY_ID"),symbol,name:val("SM_SYMBOL_NAME","DISPLAY_NAME","SEM_CUSTOM_SYMBOL","SYMBOL_NAME", "UNDERLYING_SYMBOL") || symbol,exchange,segment:exchange === "BSE" && segment === "E" ? "BSE_EQ" : exchange === "NSE" && segment === "E" ? "NSE_EQ" : "",instrument:val("SEM_INSTRUMENT_NAME","INSTRUMENT")}; }).filter(x=>x.securityId && x.symbol && x.segment);
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
      headers: { "content-type": "application/json", "access-token": process.env.DHAN_ACCESS_TOKEN! },
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
export async function getTradeHistory(fromDate: string, toDate: string) {
  const trades: DhanTrade[] = [];
  const seenPages = new Set<string>();
  for (let page = 0; page < 500; page += 1) {
    const rows = await dhanGet<DhanTrade[]>(`/trades/${fromDate}/${toDate}/${page}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    const pageKey = JSON.stringify(rows.map((row) => [
      row.exchangeTradeId,
      row.orderId,
      row.exchangeTime,
      row.securityId,
      row.tradingSymbol,
      row.transactionType,
      row.tradedQuantity,
      row.tradedPrice,
    ]));
    if (seenPages.has(pageKey)) break;
    seenPages.add(pageKey);
    trades.push(...rows);
  }
  return trades;
}
