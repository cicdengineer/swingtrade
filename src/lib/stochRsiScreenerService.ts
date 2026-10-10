import "server-only";
import type { DailyPriceRecord, UniverseName } from "./types";
import { readDatabase } from "./localDatabase";
import { calculateEma, calculateSma } from "./swingScreenerService";

export type StochRsiSetupType = "GREEN_SETUP" | "BLUE_SETUP";
export type StochRsiEntrySignal = "GREEN_ENTRY" | "BLUE_ENTRY" | "NONE";

export type StochRsiScreenerFilters = {
  universe: UniverseName | "ALL";
  rsiLength: number;
  stochLength: number;
  smoothK: number;
  smoothD: number;
  upperThreshold: number;
  lowerThreshold: number;
  minWeeklyCandles: number;
  showAll: boolean;
};

export type StochRsiRecentPoint = {
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  daily_stoch_d?: number;
  weekly_stoch_d?: number;
  setup_type?: StochRsiSetupType;
  entry_signal?: StochRsiEntrySignal;
  new_lowest_candle?: boolean;
  lowest_price_in_zone?: number;
};

export type StochRsiScreenerRow = {
  status: StochRsiSetupType;
  qualifies: boolean;
  security_id: string;
  symbol: string;
  company_name: string;
  universe_name: UniverseName;
  current_date: string;
  current_close: number;
  weekly_stoch_d: number;
  daily_stoch_d: number;
  setup_type: StochRsiSetupType;
  entry_signal: StochRsiEntrySignal;
  current_daily_high: number;
  previous_daily_high: number;
  current_daily_low: number;
  new_lowest_candle: boolean;
  lowest_price_in_zone: number;
  ema10?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  data_freshness: string;
  candle_completed: boolean;
  provisional: boolean;
  reason: string;
  recent: StochRsiRecentPoint[];
};

export const defaultStochRsiScreenerFilters: StochRsiScreenerFilters = {
  universe: "ALL",
  rsiLength: 14,
  stochLength: 14,
  smoothK: 3,
  smoothD: 3,
  upperThreshold: 80,
  lowerThreshold: 20,
  minWeeklyCandles: 40,
  showAll: false,
};

type CacheValue = { key: string; expiresAt: number; value: Awaited<ReturnType<typeof calculateStochRsiScreener>> };
const globalCache = globalThis as typeof globalThis & { __stochRsiScreenerCache?: CacheValue };

type Candle = Pick<DailyPriceRecord, "trade_date" | "open" | "high" | "low" | "close" | "volume"> & { is_provisional?: boolean };
type WeekCandle = Candle & { week_key: string };

const pct = (value: number, base: number) => (value / Math.max(0.01, base) - 1) * 100;

function mondayWeekKey(dateText: string) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

export function calculateRsi(values: number[], length = 14) {
  const out: Array<number | undefined> = Array(values.length).fill(undefined);
  if (values.length <= length) return out;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= length; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / length;
  let avgLoss = loss / length;
  out[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let index = length + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const currentGain = Math.max(change, 0);
    const currentLoss = Math.max(-change, 0);
    avgGain = (avgGain * (length - 1) + currentGain) / length;
    avgLoss = (avgLoss * (length - 1) + currentLoss) / length;
    out[index] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function calculateStochRsiD(values: number[], rsiLength = 14, stochLength = 14, smoothK = 3, smoothD = 3) {
  const rsi = calculateRsi(values, rsiLength);
  const rawK = rsi.map((value, index) => {
    if (value === undefined || index + 1 < stochLength) return undefined;
    const window = rsi.slice(index + 1 - stochLength, index + 1).filter((item): item is number => item !== undefined);
    if (window.length < stochLength) return undefined;
    const low = Math.min(...window);
    const high = Math.max(...window);
    return high === low ? 0 : ((value - low) / (high - low)) * 100;
  });
  const k = calculateSma(rawK.map((value) => value ?? Number.NaN), smoothK).map((value, index) => rawK.slice(index + 1 - smoothK, index + 1).every((item) => item !== undefined) ? value : undefined);
  return calculateSma(k.map((value) => value ?? Number.NaN), smoothD).map((value, index) => k.slice(index + 1 - smoothD, index + 1).every((item) => item !== undefined) ? value : undefined);
}

function deriveWeeklyCandles(rows: Candle[]) {
  const weeks: WeekCandle[] = [];
  for (const row of rows) {
    const weekKey = mondayWeekKey(row.trade_date);
    const latest = weeks.at(-1);
    if (!latest || latest.week_key !== weekKey) {
      weeks.push({ ...row, week_key: weekKey });
    } else {
      latest.high = Math.max(latest.high, row.high);
      latest.low = Math.min(latest.low, row.low);
      latest.close = row.close;
      latest.volume += row.volume;
      latest.trade_date = row.trade_date;
      latest.is_provisional = Boolean(latest.is_provisional || row.is_provisional);
    }
  }
  return weeks;
}

function analyzeStock(input: {
  securityId: string;
  symbol: string;
  companyName: string;
  universeName: UniverseName;
  prices: DailyPriceRecord[];
  filters: StochRsiScreenerFilters;
}): StochRsiScreenerRow | null {
  const rows = [...input.prices].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  if (rows.length < 80) return null;

  const weeklyRows = deriveWeeklyCandles(rows);
  if (weeklyRows.length < input.filters.minWeeklyCandles) return null;

  const closes = rows.map((row) => row.close);
  const dailyD = calculateStochRsiD(closes, input.filters.rsiLength, input.filters.stochLength, input.filters.smoothK, input.filters.smoothD);
  const weeklyD = calculateStochRsiD(weeklyRows.map((row) => row.close), input.filters.rsiLength, input.filters.stochLength, input.filters.smoothK, input.filters.smoothD);
  const weeklyDByWeek = new Map<string, number | undefined>();
  weeklyRows.forEach((row, index) => weeklyDByWeek.set(row.week_key, index > 0 ? weeklyD[index - 1] : undefined));

  const ema10 = calculateEma(closes, 10);
  const ema20 = calculateEma(closes, 20);
  const ema50 = calculateEma(closes, 50);
  const ema200 = calculateEma(closes, 200);

  let activeSetup: StochRsiSetupType | undefined;
  let lowestInZone = Infinity;
  const enriched: StochRsiRecentPoint[] = rows.map((row, index) => {
    const weeklyValue = weeklyDByWeek.get(mondayWeekKey(row.trade_date));
    const dailyValue = dailyD[index];
    const setup: StochRsiSetupType | undefined = weeklyValue !== undefined && dailyValue !== undefined && weeklyValue > input.filters.upperThreshold && dailyValue < input.filters.lowerThreshold
      ? "GREEN_SETUP"
      : weeklyValue !== undefined && dailyValue !== undefined && weeklyValue < input.filters.lowerThreshold && dailyValue > input.filters.upperThreshold
        ? "BLUE_SETUP"
        : undefined;
    if (setup !== activeSetup) {
      activeSetup = setup;
      lowestInZone = setup ? row.low : Infinity;
    }
    let newLowest = false;
    if (setup && row.low <= lowestInZone) {
      lowestInZone = row.low;
      newLowest = true;
    }
    const previous = rows[index - 1];
    const breakout = Boolean(previous && row.high > previous.high);
    return {
      trade_date: row.trade_date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      daily_stoch_d: dailyValue,
      weekly_stoch_d: weeklyValue,
      setup_type: setup,
      entry_signal: setup === "GREEN_SETUP" && breakout ? "GREEN_ENTRY" : setup === "BLUE_SETUP" && breakout ? "BLUE_ENTRY" : "NONE",
      new_lowest_candle: newLowest,
      lowest_price_in_zone: setup ? lowestInZone : undefined,
    };
  });

  const currentIndex = rows.length - 1;
  const current = rows[currentIndex];
  const previous = rows[currentIndex - 1];
  const latest = enriched[currentIndex];
  if (!current || !previous || !latest.setup_type || latest.daily_stoch_d === undefined || latest.weekly_stoch_d === undefined) return null;

  const signal = latest.entry_signal ?? "NONE";
  return {
    status: latest.setup_type,
    qualifies: true,
    security_id: input.securityId,
    symbol: input.symbol,
    company_name: input.companyName,
    universe_name: input.universeName,
    current_date: current.trade_date,
    current_close: current.close,
    weekly_stoch_d: latest.weekly_stoch_d,
    daily_stoch_d: latest.daily_stoch_d,
    setup_type: latest.setup_type,
    entry_signal: signal,
    current_daily_high: current.high,
    previous_daily_high: previous.high,
    current_daily_low: current.low,
    new_lowest_candle: Boolean(latest.new_lowest_candle),
    lowest_price_in_zone: latest.lowest_price_in_zone ?? current.low,
    ema10: ema10[currentIndex],
    ema20: ema20[currentIndex],
    ema50: ema50[currentIndex],
    ema200: ema200[currentIndex],
    data_freshness: current.trade_date,
    candle_completed: !current.is_provisional,
    provisional: Boolean(current.is_provisional),
    reason: `${latest.setup_type === "GREEN_SETUP" ? "Weekly %D is strong while Daily %D is oversold" : "Weekly %D is weak while Daily %D is overbought"}${signal === "NONE" ? "; waiting for previous-day-high breakout." : "; previous-day-high breakout fired."}`,
    recent: enriched.slice(-126),
  };
}

async function calculateStochRsiScreener(filters: Partial<StochRsiScreenerFilters> = {}) {
  const merged = { ...defaultStochRsiScreenerFilters, ...filters };
  const db = await readDatabase();
  const members = db.universe_members.filter((member) =>
    member.is_current_constituent &&
    member.security_id &&
    (merged.universe === "ALL" || member.universe_name === merged.universe)
  );
  const pricesBySecurity = new Map<string, DailyPriceRecord[]>();
  for (const price of db.daily_prices) {
    const list = pricesBySecurity.get(price.security_id);
    if (list) list.push(price);
    else pricesBySecurity.set(price.security_id, [price]);
  }
  const rows = members.flatMap((member) => {
    const row = analyzeStock({
      securityId: member.security_id,
      symbol: member.symbol,
      companyName: member.company_name,
      universeName: member.universe_name,
      prices: pricesBySecurity.get(member.security_id) ?? [],
      filters: merged,
    });
    return row ? [row] : [];
  });
  const results = rows.sort((a, b) => {
    if (a.entry_signal !== b.entry_signal) return a.entry_signal === "NONE" ? 1 : -1;
    return Math.abs(pct(a.current_close, a.previous_daily_high)) - Math.abs(pct(b.current_close, b.previous_daily_high));
  });
  const statusSummary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.setup_type] = (acc[row.setup_type] ?? 0) + 1;
    acc[row.entry_signal] = (acc[row.entry_signal] ?? 0) + 1;
    return acc;
  }, {});
  const snapshotDate = rows.map((row) => row.current_date).sort().at(-1) ?? null;
  return { filters: merged, evaluated: members.length, qualified: rows.length, statusSummary, snapshotDate, results, generatedAt: new Date().toISOString() };
}

export async function runStochRsiScreener(filters: Partial<StochRsiScreenerFilters> = {}) {
  const merged = { ...defaultStochRsiScreenerFilters, ...filters };
  const key = JSON.stringify(merged);
  const cached = globalCache.__stochRsiScreenerCache;
  if (cached?.key === key && cached.expiresAt > Date.now()) return cached.value;
  const value = await calculateStochRsiScreener(merged);
  globalCache.__stochRsiScreenerCache = { key, value, expiresAt: Date.now() + 60_000 };
  return value;
}

export async function getStochRsiScreenerDetail(securityId: string) {
  const response = await runStochRsiScreener({ showAll: true });
  return response.results.find((row) => row.security_id === securityId) ?? null;
}
