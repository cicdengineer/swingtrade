import "server-only";
import type { DhanHolding } from "./dhan";
import { readDatabase, writeDatabase } from "./localDatabase";
import {
  calculateOpenRisk,
  calculatePositionSizing,
  calculateRMultiple,
  defaultTradingSettings,
  evaluateTradeLifecycle,
  normalizeTimeframe,
  normalizeTrailMethod,
} from "./tradeManagement";
import { calculateEma } from "./swingScreenerService";
import type {
  DailyPriceRecord,
  ManagedTradeRecord,
  TradeEventRecord,
  TradeEventType,
  TradeTrancheRecord,
  TradingSettingsRecord,
} from "./types";

export type ManagedTradeView = ManagedTradeRecord & {
  quantity: number;
  brokerQuantity: number | null;
  brokerEntryDate?: string;
  brokerCalendarDaysHeld?: number;
  tradingDaysHeld: number;
  calendarDaysHeld: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  rMultiple: number;
  peakR: number;
  ema10?: number;
  ema20?: number;
  distanceFrom10EmaPct?: number;
  distanceFrom20EmaPct?: number;
  currentOpenRisk: number;
  currentOpenRiskPct: number;
  initialRiskPct: number;
  stage: ReturnType<typeof evaluateTradeLifecycle>["stage"];
  instruction: string;
  recommendedAction: string;
  nextReview: string;
  events: TradeEventRecord[];
};

export type TradeManagementSnapshot = {
  settings: TradingSettingsRecord;
  trades: ManagedTradeView[];
  summary: {
    totalCapital: number;
    riskPercent: number;
    riskUnit: number;
    managedTrades: number;
    tradesAtInitialRisk: number;
    protectedTrades: number;
    runners: number;
    totalCurrentOpenRisk: number;
    portfolioOpenRiskPct: number;
    unrealizedPnl: number;
    realizedSwingPnl: number;
    averageR: number;
    medianR: number;
    largestWinnerR: number;
    largestLoserR: number;
    riskLevel: "Normal" | "Elevated" | "High";
  };
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const newId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
type HoldingForManagement = DhanHolding & { brokerEntryDate?: string; brokerCalendarDaysHeld?: number };

export async function getTradingSettings() {
  const db = await readDatabase();
  if (!db.trading_settings.length) {
    const settings = defaultTradingSettings();
    db.trading_settings = [settings];
    await writeDatabase(db);
    return settings;
  }
  return { ...defaultTradingSettings(), ...db.trading_settings[0], id: "default" as const };
}

export async function saveTradingSettings(input: Partial<TradingSettingsRecord>) {
  const db = await readDatabase();
  const current = db.trading_settings[0] ?? defaultTradingSettings();
  const now = new Date().toISOString();
  const settings: TradingSettingsRecord = {
    ...current,
    totalCapital: Number(input.totalCapital ?? current.totalCapital),
    riskPercent: Number(input.riskPercent ?? current.riskPercent),
    defaultStopSource: input.defaultStopSource === "Manual" ? "Manual" : "Setup Candle Low",
    defaultManagementTimeframe: normalizeTimeframe(input.defaultManagementTimeframe),
    initialManagementDays: Number(input.initialManagementDays ?? current.initialManagementDays),
    partialStartDay: Number(input.partialStartDay ?? current.partialStartDay),
    partialEndDay: Number(input.partialEndDay ?? current.partialEndDay),
    partialPercent: Number(input.partialPercent ?? current.partialPercent),
    partialMinR: Number(input.partialMinR ?? current.partialMinR),
    defaultTrailMA: normalizeTrailMethod(input.defaultTrailMA),
    moveStopToBreakevenAfterPartial: Boolean(input.moveStopToBreakevenAfterPartial ?? current.moveStopToBreakevenAfterPartial),
    exitConfirmationRule:
      input.exitConfirmationRule === "Intraday break" || input.exitConfirmationRule === "2 closes below EMA"
        ? input.exitConfirmationRule
        : "Close below EMA",
    portfolioRiskNormalPct: Number(input.portfolioRiskNormalPct ?? current.portfolioRiskNormalPct),
    portfolioRiskElevatedPct: Number(input.portfolioRiskElevatedPct ?? current.portfolioRiskElevatedPct),
    portfolioRiskHighPct: Number(input.portfolioRiskHighPct ?? current.portfolioRiskHighPct),
    id: "default",
    created_at: current.created_at,
    updated_at: now,
  };
  db.trading_settings = [settings];
  await writeDatabase(db);
  return settings;
}

function latestPricesBySecurity(prices: DailyPriceRecord[]) {
  const latest = new Map<string, DailyPriceRecord>();
  for (const row of prices) {
    const current = latest.get(row.security_id);
    if (!current || row.trade_date > current.trade_date) latest.set(row.security_id, row);
  }
  return latest;
}

function tradingDaysSince(prices: DailyPriceRecord[], securityId: string | undefined, entryDate: string, currentDate: string) {
  if (!securityId) return 0;
  return prices.filter((row) => row.security_id === securityId && row.trade_date > entryDate && row.trade_date <= currentDate).length;
}

function calendarDaysSince(entryDate: string, currentDate: string) {
  const start = new Date(`${entryDate}T00:00:00Z`).getTime();
  const end = new Date(`${currentDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function movingAverages(prices: DailyPriceRecord[], securityId: string | undefined) {
  if (!securityId) return {};
  const rows = prices.filter((row) => row.security_id === securityId).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const closes = rows.map((row) => row.close);
  const ema10 = calculateEma(closes, 10).at(-1);
  const ema20 = calculateEma(closes, 20).at(-1);
  const closesBelow10 = rows.slice(-2).filter((row, index, slice) => {
    const originalIndex = rows.length - slice.length + index;
    const ema = calculateEma(closes, 10)[originalIndex];
    return ema !== undefined && row.close < ema;
  }).length;
  const closesBelow20 = rows.slice(-2).filter((row, index, slice) => {
    const originalIndex = rows.length - slice.length + index;
    const ema = calculateEma(closes, 20)[originalIndex];
    return ema !== undefined && row.close < ema;
  }).length;
  return { ema10, ema20, closesBelow10, closesBelow20 };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function getTradeManagementSnapshot(holdings: HoldingForManagement[] = []): Promise<TradeManagementSnapshot> {
  const db = await readDatabase();
  const settings = db.trading_settings[0] ?? defaultTradingSettings();
  const latestPrices = latestPricesBySecurity(db.daily_prices);
  const holdingsBySecurity = new Map(holdings.map((holding) => [holding.securityId, holding]));
  const eventsByTrade = new Map<string, TradeEventRecord[]>();
  for (const event of db.trade_events) {
    const rows = eventsByTrade.get(event.managedTradeId) ?? [];
    rows.push(event);
    eventsByTrade.set(event.managedTradeId, rows);
  }

  const views = db.managed_trades.map((trade) => {
    const tranches = db.trade_tranches.filter((tranche) => tranche.managedTradeId === trade.id);
    const quantity = tranches.reduce((sum, tranche) => sum + tranche.remainingQuantity, 0);
    const holding = trade.instrumentId ? holdingsBySecurity.get(trade.instrumentId) : undefined;
    const brokerQuantity = holding?.totalQty ?? null;
    const currentDate = latestPrices.get(trade.instrumentId ?? "")?.trade_date ?? todayIso();
    const dayCountEntryDate = holding?.brokerEntryDate ?? trade.entryDate;
    const currentPrice = latestPrices.get(trade.instrumentId ?? "")?.close ?? trade.averageEntry;
    const mas = movingAverages(db.daily_prices, trade.instrumentId);
    const tradingDaysHeld = tradingDaysSince(db.daily_prices, trade.instrumentId, dayCountEntryDate, currentDate);
    const calendarDaysHeld = calendarDaysSince(dayCountEntryDate, todayIso());
    const initialRiskPerShare = trade.initialRiskPerShare || trade.averageEntry - trade.initialStop;
    const initialRiskAmount = tranches.reduce((sum, tranche) => sum + tranche.initialRisk, 0) || initialRiskPerShare * quantity;
    const unrealizedPnl = (currentPrice - trade.averageEntry) * quantity;
    const rMultiple = calculateRMultiple(trade.averageEntry, trade.initialStop, currentPrice);
    const allPrices = db.daily_prices.filter((row) => row.security_id === trade.instrumentId && row.trade_date >= trade.entryDate);
    const peakR = Math.max(rMultiple, ...allPrices.map((row) => calculateRMultiple(trade.averageEntry, trade.initialStop, row.high)));
    const closesBelowTrail = trade.trailMethod === "20 EMA" ? mas.closesBelow20 : mas.closesBelow10;
    const lifecycle = evaluateTradeLifecycle({
      status: brokerQuantity !== null && brokerQuantity !== quantity && trade.status === "ACTIVE" ? "RECONCILIATION_REQUIRED" : trade.status,
      entryPrice: trade.averageEntry,
      currentPrice,
      initialStop: trade.initialStop,
      plannedStop: trade.plannedStop,
      remainingQuantity: quantity,
      tradingDaysHeld,
      partialTaken: trade.partialTaken,
      trailMethod: trade.trailMethod,
      exitConfirmationRule: settings.exitConfirmationRule,
      ema10: mas.ema10,
      ema20: mas.ema20,
      closesBelowTrail,
      settings,
    });
    const openRisk = calculateOpenRisk(quantity, currentPrice, trade.plannedStop);
    const view: ManagedTradeView = {
      ...trade,
      status: brokerQuantity !== null && brokerQuantity !== quantity && trade.status === "ACTIVE" ? "RECONCILIATION_REQUIRED" : trade.status,
      quantity,
      brokerQuantity,
      brokerEntryDate: holding?.brokerEntryDate,
      brokerCalendarDaysHeld: holding?.brokerCalendarDaysHeld,
      tradingDaysHeld,
      calendarDaysHeld,
      currentPrice,
      unrealizedPnl: round(unrealizedPnl),
      unrealizedPnlPct: trade.averageEntry > 0 ? ((currentPrice - trade.averageEntry) / trade.averageEntry) * 100 : 0,
      rMultiple,
      peakR,
      ema10: mas.ema10,
      ema20: mas.ema20,
      distanceFrom10EmaPct: mas.ema10 ? ((currentPrice - mas.ema10) / mas.ema10) * 100 : undefined,
      distanceFrom20EmaPct: mas.ema20 ? ((currentPrice - mas.ema20) / mas.ema20) * 100 : undefined,
      currentOpenRisk: round(openRisk),
      currentOpenRiskPct: settings.totalCapital > 0 ? (openRisk / settings.totalCapital) * 100 : 0,
      initialRiskPct: settings.totalCapital > 0 ? (initialRiskAmount / settings.totalCapital) * 100 : 0,
      stage: lifecycle.stage,
      instruction: lifecycle.instruction,
      recommendedAction: lifecycle.recommendedAction,
      nextReview: lifecycle.nextReview,
      events: (eventsByTrade.get(trade.id) ?? []).sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    };
    return view;
  });

  const rValues = views.map((trade) => trade.rMultiple);
  const totalCurrentOpenRisk = views.reduce((sum, trade) => sum + trade.currentOpenRisk, 0);
  const portfolioOpenRiskPct = settings.totalCapital > 0 ? (totalCurrentOpenRisk / settings.totalCapital) * 100 : 0;
  const riskLevel = portfolioOpenRiskPct >= settings.portfolioRiskHighPct ? "High" : portfolioOpenRiskPct >= settings.portfolioRiskElevatedPct ? "Elevated" : "Normal";
  const riskUnit = calculatePositionSizing({ totalCapital: settings.totalCapital, riskPercent: settings.riskPercent, entryPrice: 2, stopLoss: 1 }).riskAmount;

  return {
    settings,
    trades: views,
    summary: {
      totalCapital: settings.totalCapital,
      riskPercent: settings.riskPercent,
      riskUnit,
      managedTrades: views.length,
      tradesAtInitialRisk: views.filter((trade) => trade.stage === "INITIAL RISK" || trade.stage === "EARLY HOLD").length,
      protectedTrades: views.filter((trade) => trade.stage === "BREAKEVEN / PROTECTED").length,
      runners: views.filter((trade) => trade.stage === "RUNNER" || trade.stage === "TREND TRAIL").length,
      totalCurrentOpenRisk: round(totalCurrentOpenRisk),
      portfolioOpenRiskPct,
      unrealizedPnl: round(views.reduce((sum, trade) => sum + trade.unrealizedPnl, 0)),
      realizedSwingPnl: round(db.trade_tranches.reduce((sum, tranche) => sum + tranche.realizedPnl, 0)),
      averageR: rValues.length ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : 0,
      medianR: median(rValues),
      largestWinnerR: Math.max(...rValues, 0),
      largestLoserR: Math.min(...rValues, 0),
      riskLevel,
    },
  };
}

export async function createManagedTrade(input: {
  broker?: "DHAN" | "MANUAL";
  symbol: string;
  companyName?: string;
  exchange?: string;
  instrumentId?: string;
  isin?: string;
  strategy?: string;
  entryDate: string;
  averageEntry: number;
  quantity: number;
  initialStop: number;
  plannedStop?: number;
  trailMethod?: unknown;
  managementTimeframe?: unknown;
  source: "30UP" | "BROKER_HOLDING" | "MANUAL";
  notes?: string;
}) {
  const db = await readDatabase();
  const settings = db.trading_settings[0] ?? defaultTradingSettings();
  const duplicate = db.managed_trades.find((trade) =>
    trade.status !== "CLOSED" &&
    ((input.instrumentId && trade.instrumentId === input.instrumentId) || (!input.instrumentId && trade.symbol.toUpperCase() === input.symbol.toUpperCase()))
  );
  if (duplicate) throw new Error(`${input.symbol} is already in active trade management. Edit or delete the existing managed trade first.`);
  const sizing = calculatePositionSizing({
    totalCapital: settings.totalCapital,
    riskPercent: settings.riskPercent,
    entryPrice: input.averageEntry,
    stopLoss: input.initialStop,
  });
  if (!(input.quantity > 0)) throw new Error("Quantity must be greater than zero.");
  if (!(input.averageEntry > input.initialStop)) throw new Error("Entry must be above initial stop.");
  const now = new Date().toISOString();
  const id = newId("mt");
  const initialRiskPerShare = input.averageEntry - input.initialStop;
  const initialRiskAmount = initialRiskPerShare * input.quantity;
  const trade: ManagedTradeRecord = {
    id,
    broker: input.broker ?? "DHAN",
    symbol: input.symbol,
    companyName: input.companyName,
    exchange: input.exchange ?? "NSE",
    instrumentId: input.instrumentId,
    isin: input.isin,
    strategy: input.strategy ?? "30%Up Swing",
    status: "ACTIVE",
    entryDate: input.entryDate,
    averageEntry: input.averageEntry,
    initialStop: input.initialStop,
    plannedStop: input.plannedStop ?? input.initialStop,
    initialRiskPerShare,
    initialRiskAmount,
    trailMethod: normalizeTrailMethod(input.trailMethod ?? settings.defaultTrailMA),
    managementTimeframe: normalizeTimeframe(input.managementTimeframe ?? settings.defaultManagementTimeframe),
    partialTaken: false,
    protectedStopRecorded: false,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
  const tranche: TradeTrancheRecord = {
    id: newId("tr"),
    managedTradeId: id,
    entryDate: input.entryDate,
    entryPrice: input.averageEntry,
    quantity: input.quantity,
    initialStop: input.initialStop,
    initialRisk: initialRiskAmount,
    remainingQuantity: input.quantity,
    realizedQuantity: 0,
    realizedPnl: 0,
    status: "OPEN",
  };
  const events: TradeEventRecord[] = [
    { id: newId("ev"), managedTradeId: id, eventType: "ENTRY", timestamp: now, price: input.averageEntry, quantity: input.quantity, notes: input.notes ?? `Managed trade created. Suggested risk quantity was ${sizing.quantity}.`, source: "USER" },
    { id: newId("ev"), managedTradeId: id, eventType: "STOP_DEFINED", timestamp: now, price: input.initialStop, notes: "Initial stop stored internally. Protective stop not confirmed at broker.", source: "USER" },
  ];
  db.managed_trades.push(trade);
  db.trade_tranches.push(tranche);
  db.trade_events.push(...events);
  await writeDatabase(db);
  return trade;
}

export async function updateManagedTrade(managedTradeId: string, input: Partial<{
  strategy: string;
  entryDate: string;
  averageEntry: number;
  quantity: number;
  initialStop: number;
  plannedStop: number;
  trailMethod: unknown;
  managementTimeframe: unknown;
  partialTaken: boolean;
  protectedStopRecorded: boolean;
}>) {
  const db = await readDatabase();
  const trade = db.managed_trades.find((row) => row.id === managedTradeId);
  if (!trade) throw new Error("Managed trade not found.");
  const nextAverageEntry = Number(input.averageEntry ?? trade.averageEntry);
  const nextInitialStop = Number(input.initialStop ?? trade.initialStop);
  const nextPlannedStop = Number(input.plannedStop ?? trade.plannedStop);
  const nextQuantity = Number(input.quantity ?? db.trade_tranches.filter((row) => row.managedTradeId === managedTradeId).reduce((sum, tranche) => sum + tranche.remainingQuantity, 0));
  if (!(nextQuantity > 0)) throw new Error("Quantity must be greater than zero.");
  if (!(nextAverageEntry > nextInitialStop)) throw new Error("Entry must be above initial stop.");
  if (!(nextPlannedStop > 0)) throw new Error("Planned stop must be greater than zero.");

  const now = new Date().toISOString();
  trade.strategy = String(input.strategy ?? trade.strategy);
  trade.entryDate = String(input.entryDate ?? trade.entryDate);
  trade.averageEntry = nextAverageEntry;
  trade.initialStop = nextInitialStop;
  trade.plannedStop = nextPlannedStop;
  trade.initialRiskPerShare = nextAverageEntry - nextInitialStop;
  trade.initialRiskAmount = trade.initialRiskPerShare * nextQuantity;
  trade.trailMethod = normalizeTrailMethod(input.trailMethod ?? trade.trailMethod);
  trade.managementTimeframe = normalizeTimeframe(input.managementTimeframe ?? trade.managementTimeframe);
  if (input.partialTaken !== undefined) trade.partialTaken = Boolean(input.partialTaken);
  if (input.protectedStopRecorded !== undefined) trade.protectedStopRecorded = Boolean(input.protectedStopRecorded);
  trade.updatedAt = now;

  const tranches = db.trade_tranches.filter((row) => row.managedTradeId === managedTradeId);
  const first = tranches[0];
  if (first) {
    first.entryDate = trade.entryDate;
    first.entryPrice = nextAverageEntry;
    first.initialStop = nextInitialStop;
    first.initialRisk = trade.initialRiskAmount;
    first.quantity = nextQuantity + first.realizedQuantity;
    first.remainingQuantity = nextQuantity;
    first.status = nextQuantity > 0 ? "OPEN" : "CLOSED";
  }

  db.trade_events.push({
    id: newId("ev"),
    managedTradeId,
    eventType: "BROKER_SYNC",
    timestamp: now,
    price: nextAverageEntry,
    quantity: nextQuantity,
    notes: "Managed trade variables updated by user.",
    source: "USER",
  });
  await writeDatabase(db);
  return trade;
}

export async function deleteManagedTrade(managedTradeId: string) {
  const db = await readDatabase();
  const trade = db.managed_trades.find((row) => row.id === managedTradeId);
  if (!trade) throw new Error("Managed trade not found.");
  db.managed_trades = db.managed_trades.filter((row) => row.id !== managedTradeId);
  db.trade_tranches = db.trade_tranches.filter((row) => row.managedTradeId !== managedTradeId);
  db.trade_events = db.trade_events.filter((row) => row.managedTradeId !== managedTradeId);
  await writeDatabase(db);
  return { deleted: true };
}

export async function recordTradeEvent(managedTradeId: string, input: { eventType: TradeEventType; price?: number; quantity?: number; notes?: string }) {
  const db = await readDatabase();
  const trade = db.managed_trades.find((row) => row.id === managedTradeId);
  if (!trade) throw new Error("Managed trade not found.");
  const now = new Date().toISOString();
  if (input.eventType === "PARTIAL_EXECUTED") {
    trade.partialTaken = true;
    const qty = Number(input.quantity ?? 0);
    const price = Number(input.price ?? trade.averageEntry);
    let remaining = qty;
    for (const tranche of db.trade_tranches.filter((row) => row.managedTradeId === managedTradeId && row.remainingQuantity > 0)) {
      const sold = Math.min(remaining, tranche.remainingQuantity);
      tranche.remainingQuantity -= sold;
      tranche.realizedQuantity += sold;
      tranche.realizedPnl += (price - tranche.entryPrice) * sold;
      if (tranche.remainingQuantity <= 0) tranche.status = "CLOSED";
      remaining -= sold;
      if (remaining <= 0) break;
    }
  }
  if (input.eventType === "STOP_UPDATED" && input.price) {
    trade.plannedStop = input.price;
    trade.protectedStopRecorded = input.price >= trade.averageEntry;
  }
  if (input.eventType === "EXIT") trade.status = "CLOSED";
  trade.updatedAt = now;
  const event: TradeEventRecord = { id: newId("ev"), managedTradeId, eventType: input.eventType, timestamp: now, price: input.price, quantity: input.quantity, notes: input.notes, source: "USER" };
  db.trade_events.push(event);
  await writeDatabase(db);
  return event;
}
