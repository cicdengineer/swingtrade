import type { DailyPriceRecord } from "./types";

export type QFilters = {
  universe: "ALL" | "MIDCAP" | "SMALLCAP"; momentumMode: "ANY" | "ALL";
  oneMonth: boolean; min1m: number; threeMonth: boolean; min3m: number; sixMonth: boolean; min6m: number;
  above50: boolean; emaStack: boolean; rising20: boolean; above10: boolean;
  minBaseDays: number; maxBaseDays: number; maxDepth: number; max5Range: number;
  shrinkingVolatility: boolean; contractingVolume: boolean; maxVolumeRatio: number;
  nearHigh: boolean; maxHighDistance: number; nearBreakout: number; minTightness: number;
  entryMode: "ORH" | "EOD"; openingMinutes: 1 | 5 | 10 | 15; maxStopAdr: number;
  capital: number; riskPct: number; maxExposurePct: number; partialPct: number; partialDay: number; trailEma: 10 | 20;
  showDiagnostics: boolean;
};

export const defaultQFilters: QFilters = {
  universe: "ALL", momentumMode: "ANY", oneMonth: true, min1m: 20, threeMonth: true, min3m: 30, sixMonth: true, min6m: 50,
  above50: true, emaStack: true, rising20: true, above10: false,
  minBaseDays: 5, maxBaseDays: 30, maxDepth: 15, max5Range: 8,
  shrinkingVolatility: true, contractingVolume: true, maxVolumeRatio: 0.7,
  nearHigh: true, maxHighDistance: 15, nearBreakout: 3, minTightness: 65,
  entryMode: "ORH", openingMinutes: 5, maxStopAdr: 1,
  capital: 10_000_000, riskPct: 0.2, maxExposurePct: 10, partialPct: 33, partialDay: 3, trailEma: 10,
  showDiagnostics: false,
};

export type QStage = "Momentum Leader" | "Building Base" | "Tight Consolidation" | "Near Breakout" | "Breakout Triggered" | "Extended / Missed Entry" | "Filtered" | "Insufficient Data";
export type QPoint = Pick<DailyPriceRecord, "trade_date" | "open" | "high" | "low" | "close" | "volume"> & { ema10?: number; ema20?: number; sma50?: number };
export type QRow = {
  security_id: string; symbol: string; company_name: string; universe_name: string; dataDate: string; close: number;
  return1m?: number; return3m?: number; return6m?: number; ema10?: number; ema20?: number; sma50?: number;
  atr20?: number; adr20?: number; averageVolume20?: number; averageVolume50?: number; high3m?: number;
  baseStart?: string; baseEnd?: string; baseDays?: number; baseDepth?: number; baseLow?: number; resistance?: number;
  rangeRatio?: number; volumeRatio?: number; distanceToBreakout?: number; tightness: number; setupScore: number;
  stage: QStage; qualifies: boolean; breakoutDate?: string; signalPrice?: number; stop?: number; stopPct?: number;
  diagnostics: { label: string; pass: boolean }[]; recent: QPoint[];
};

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const percent = (a: number, b: number) => (a / b - 1) * 100;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function averages(values: number[], period: number, exponential = false) {
  const out: (number | undefined)[] = Array(values.length).fill(undefined);
  if (values.length < period) return out;
  out[period - 1] = mean(values.slice(0, period));
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) out[i] = exponential ? values[i] * k + out[i - 1]! * (1 - k) : mean(values.slice(i - period + 1, i + 1));
  return out;
}
export function positionSize(entry: number, stop: number, capital: number, riskPct: number, maxExposurePct: number, committed = 0) {
  if (!(entry > stop && stop > 0 && capital > 0 && riskPct > 0)) return { quantity: 0, riskAmount: capital * riskPct / 100, positionValue: 0, warning: "Invalid entry or stop" };
  const riskAmount = capital * riskPct / 100;
  const byRisk = Math.floor(riskAmount / (entry - stop));
  const affordable = Math.floor(Math.max(0, Math.min(capital - committed, capital * maxExposurePct / 100)) / entry);
  const quantity = Math.min(byRisk, affordable);
  return { quantity, riskAmount, positionValue: quantity * entry, warning: quantity < byRisk ? "Quantity capped by available capital or exposure limit" : "" };
}

export function openingRangeSignal(candles: { date: string; open: number; high: number; low: number; close: number }[], resistance: number, minutes: 1 | 5 | 10 | 15, adrPct: number, maxStopAdr: number) {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const enriched = candles.map(c => { const parts = format.formatToParts(new Date(c.date)); const get = (key: string) => parts.find(p => p.type === key)?.value ?? ""; return { ...c, day: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) }; });
  const latest = enriched.at(-1)?.day;
  const day = enriched.filter(c => c.day === latest && c.minute >= 555 && c.minute <= 930);
  const opening = day.filter(c => c.minute >= 555 && c.minute < 555 + minutes);
  if (opening.length < minutes) return { status: "Intraday data required" as const };
  const openingHigh = Math.max(...opening.map(c => c.high)), openingLow = Math.min(...opening.map(c => c.low));
  const threshold = Math.max(openingHigh, resistance);
  for (let i = minutes; i < day.length; i++) {
    if (day[i - 1].close <= threshold && day[i].high > threshold) {
      // A minute candle does not reveal whether its low happened before or after its high.
      // Use completed earlier lows and the crossing candle's open, which are observable before the cross.
      const entry = threshold, stop = Math.min(day[i].open, ...day.slice(0, i).map(c => c.low));
      if (!(stop > 0 && entry > stop) || (entry - stop) / entry * 100 > adrPct * maxStopAdr) return { status: "Stop too wide" as const, openingHigh, openingLow, entry, stop };
      return { status: "Fresh ORH cross" as const, openingHigh, openingLow, entry, stop, date: latest };
    }
  }
  return { status: "Waiting for fresh cross" as const, openingHigh, openingLow };
}

export function analyzeQStock(input: { securityId: string; symbol: string; companyName: string; universeName: string; prices: DailyPriceRecord[]; filters: QFilters; asOf?: string }): QRow {
  const f = input.filters;
  const rows = input.prices.filter(r => !r.is_provisional && (!input.asOf || r.trade_date <= input.asOf) && r.open > 0 && r.high >= Math.max(r.open, r.close) && r.low > 0 && r.low <= Math.min(r.open, r.close) && r.close > 0 && r.volume >= 0).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const last = rows.at(-1);
  const initial: QRow = { security_id: input.securityId, symbol: input.symbol, company_name: input.companyName, universe_name: input.universeName, dataDate: last?.trade_date ?? "", close: last?.close ?? 0, tightness: 0, setupScore: 0, stage: "Insufficient Data", qualifies: false, diagnostics: [], recent: [] };
  if (rows.length < Math.max(75, f.maxBaseDays + 45)) return initial;
  const n = rows.length - 1, closes = rows.map(r => r.close), volumes = rows.map(r => r.volume);
  const ema10 = averages(closes, 10, true), ema20 = averages(closes, 20, true), sma50 = averages(closes, 50);
  const ret = (days: number) => n >= days ? percent(closes[n], closes[n - days]) : undefined;
  const return1m = ret(21), return3m = ret(63), return6m = ret(126);
  const ranges = rows.map(r => (r.high - r.low) / r.close);
  const trueRanges = rows.map((r, i) => Math.max(r.high - r.low, Math.abs(r.high - (rows[i - 1]?.close ?? r.close)), Math.abs(r.low - (rows[i - 1]?.close ?? r.close))));
  const atr20 = mean(trueRanges.slice(-20)), adr20 = mean(ranges.slice(-20)) * 100;
  const averageVolume20 = mean(volumes.slice(-20)), averageVolume50 = mean(volumes.slice(-50));
  const high3m = Math.max(...rows.slice(-63).map(r => r.high));
  const diagnostics: QRow["diagnostics"] = [];
  const check = (label: string, pass: boolean) => { diagnostics.push({ label, pass }); return pass; };
  const periods = [[f.oneMonth, return1m, f.min1m, "1M momentum"], [f.threeMonth, return3m, f.min3m, "3M momentum"], [f.sixMonth, return6m, f.min6m, "6M momentum"]] as const;
  const enabled = periods.filter(p => p[0]);
  const periodPass = enabled.length === 0 || (f.momentumMode === "ALL" ? enabled.every(p => p[1] !== undefined && p[1] >= p[2]) : enabled.some(p => p[1] !== undefined && p[1] >= p[2]));
  check("Enabled momentum periods (" + f.momentumMode + ")", periodPass);
  const trendPass = [!f.above50 || check("Above 50 SMA", closes[n] > sma50[n]!), !f.emaStack || check("10 EMA above 20 EMA", ema10[n]! > ema20[n]!), !f.rising20 || check("20 EMA rising", ema20[n]! > ema20[n - 5]!), !f.above10 || check("Above 10 EMA", closes[n] > ema10[n]!)].every(Boolean);
  const momentumPass = periodPass && trendPass;
  const common = { ...initial, return1m, return3m, return6m, ema10: ema10[n], ema20: ema20[n], sma50: sma50[n], atr20, adr20, averageVolume20, averageVolume50, high3m, diagnostics, recent: rows.slice(-126).map((r, i) => ({ trade_date: r.trade_date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, ema10: ema10[rows.length - Math.min(126, rows.length) + i], ema20: ema20[rows.length - Math.min(126, rows.length) + i], sma50: sma50[rows.length - Math.min(126, rows.length) + i] })) };
  if (!momentumPass) return { ...common, stage: "Filtered" };
  type Base = { start: number; end: number; high: number; low: number; depth: number; rangeRatio: number; volumeRatio: number; score: number };
  let best: Base | undefined;
  // A candidate ends on the last completed candle, or immediately before it for a fresh EOD cross.
  for (const end of [n, n - 1]) for (let days = f.minBaseDays; days <= f.maxBaseDays; days++) {
    const start = end - days + 1;
    if (start < 45 || days < 5) continue;
    const base = rows.slice(start, end + 1), high = Math.max(...base.map(r => r.high)), low = Math.min(...base.map(r => r.low));
    const depth = (high - low) / high * 100;
    const segment = Math.max(3, Math.floor(days / 3));
    const early = base.slice(0, segment), late = base.slice(-segment);
    const rangeRatio = mean(late.map(r => (r.high - r.low) / r.close)) / Math.max(0.00001, mean(early.map(r => (r.high - r.low) / r.close)));
    const earlyVolume = mean(early.map(r => r.volume));
    const volumeRatio = earlyVolume > 0 ? mean(late.map(r => r.volume)) / earlyVolume : Infinity;
    const five = base.slice(-5), fiveRange = (Math.max(...five.map(r => r.high)) - Math.min(...five.map(r => r.low))) / Math.max(...five.map(r => r.high)) * 100;
    const pre = rows.slice(Math.max(0, start - 45), start);
    const advance = pre.length >= 20 ? percent(pre.at(-1)!.close, Math.min(...pre.map(r => r.low))) : 0;
    const advanceRequired = enabled.length ? Math.min(...enabled.map(p => p[2]), 20) : 20;
    if (depth > f.maxDepth || fiveRange > f.max5Range || advance < advanceRequired || low < Math.min(...pre.slice(-10).map(r => r.low)) * 0.9) continue;
    if (f.shrinkingVolatility && rangeRatio >= 1 || f.contractingVolume && volumeRatio > f.maxVolumeRatio || f.nearHigh && (high3m - closes[end]) / high3m * 100 > f.maxHighDistance) continue;
    if (end === n - 1 && !(closes[n - 1] <= high && closes[n] > high)) continue;
    const score = (1 - depth / Math.max(1, f.maxDepth)) * 30 + clamp(1 - rangeRatio) * 25 + clamp(1 - volumeRatio) * 25 + clamp(1 - (high - closes[end]) / high / 0.1) * 20;
    if (!best || end === n - 1 && best.end === n || end === best.end && (score > best.score || score === best.score && days > best.end - best.start + 1)) best = { start, end, high, low, depth, rangeRatio, volumeRatio, score };
  }
  if (!best) return { ...common, stage: "Momentum Leader", qualifies: true, diagnostics: [...diagnostics, { label: "Qualifying consolidation", pass: false }] };
  const base = best as Base;
  const range3 = mean(ranges.slice(-3)), range5 = mean(ranges.slice(-5)), range20 = mean(ranges.slice(-20));
  const vol3 = mean(volumes.slice(-3)), vol5 = mean(volumes.slice(-5));
  const distance = (base.high - closes[n]) / base.high * 100;
  // Tightness = range compression 25 + 5-day range compression 15 + 3-day volume dryness 15
  // + 5-day volume dryness 10 + EMA proximity 10 + resistance proximity 15 + base contraction 10.
  const tightness = Math.round(25 * clamp(2 - range3 / range20) + 15 * clamp(2 - range5 / range20) + 15 * clamp(2 - vol3 / Math.max(1, averageVolume20)) + 10 * clamp(2 - vol5 / Math.max(1, averageVolume20)) + 10 * clamp(1 - Math.abs(ema10[n]! - ema20[n]!) / closes[n] / 0.05) + 15 * clamp(1 - Math.max(0, distance) / Math.max(0.01, f.nearBreakout * 2)) + 10 * clamp(2 - base.rangeRatio));
  const tight = tightness >= f.minTightness && (!f.contractingVolume || base.volumeRatio <= f.maxVolumeRatio) && (!f.shrinkingVolatility || base.rangeRatio < 1);
  let stage: QStage = tight ? distance <= f.nearBreakout && distance >= 0 ? "Near Breakout" : "Tight Consolidation" : "Building Base";
  let breakoutDate: string | undefined, signalPrice: number | undefined, stop: number | undefined, stopPct: number | undefined;
  if (tight && base.end === n - 1 && closes[n] > base.high && closes[n - 1] <= base.high) {
    breakoutDate = rows[n].trade_date; signalPrice = closes[n]; stop = rows[n].low; stopPct = (signalPrice - stop) / signalPrice * 100;
    stage = stop > 0 && stop < signalPrice && stopPct / adr20 <= f.maxStopAdr ? "Breakout Triggered" : "Extended / Missed Entry";
  } else if (distance < 0) stage = "Extended / Missed Entry";
  check("Qualifying consolidation", true); check("Tightness threshold", tight);
  return { ...common, stage, qualifies: true, baseStart: rows[base.start].trade_date, baseEnd: rows[base.end].trade_date, baseDays: base.end - base.start + 1, baseDepth: base.depth, baseLow: base.low, resistance: base.high, rangeRatio: base.rangeRatio, volumeRatio: base.volumeRatio, distanceToBreakout: distance, tightness, setupScore: Math.round(base.score * 0.4 + tightness * 0.6), breakoutDate, signalPrice, stop, stopPct };
}
