import { NextResponse } from "next/server";
import { getHoldings, getPositions, getTradeHistory, hasDhanCredentials, type DhanHolding, type DhanPosition, type DhanTrade } from "@/lib/dhan";
import { getTradeManagementSnapshot } from "@/lib/tradeManagementStore";
import { readDatabase, writeDatabase } from "@/lib/localDatabase";
import { calculateEma } from "@/lib/swingScreenerService";

export const dynamic = "force-dynamic";

type ClosedTrade = {
  date: string;
  symbol: string;
  securityId: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
};
type OpenLot = { date: string; quantity: number; price: number };

const toNumber = (value: unknown) => Number(value ?? 0) || 0;
const fixedNseHolidayMonthDays = new Set(["01-26", "08-15", "10-02", "12-25"]);
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
const tradeCharges = (trade: DhanTrade) =>
  toNumber(trade.sebiTax) + toNumber(trade.stt) + toNumber(trade.brokerageCharges) + toNumber(trade.serviceTax) + toNumber(trade.exchangeTransactionCharges) + toNumber(trade.stampDuty);

function portfolioPeriod(today = new Date()) {
  const to = dateInTimeZone(today, "Asia/Kolkata");
  return {
    label: "15 Apr 2026 onwards",
    from: "2026-04-15",
    to,
    // FIFO needs purchases made before the visible reporting period.
    inventoryFrom: "2026-01-01",
  };
}

function parseDhanDateTime(value?: string | null) {
  if (!value || value === "NA") return null;
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (match) {
    const [, day, month, year, hour = "00", minute = "00", second = "00"] = match;
    return {
      date: `${year}-${month}-${day}`,
      sortKey: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
    };
  }
  const isoDate = value.slice(0, 10);
  return {
    date: isoDate,
    sortKey: value,
  };
}

function tradeDate(trade: DhanTrade) {
  return parseDhanDateTime(trade.exchangeTime)?.date ?? new Date().toISOString().slice(0, 10);
}

function tradeSortKey(trade: DhanTrade) {
  return parseDhanDateTime(trade.exchangeTime)?.sortKey ?? `${tradeDate(trade)} ${trade.exchangeTradeId || trade.orderId}`;
}

function tradeInstrumentKey(trade: DhanTrade) {
  return `${trade.exchangeSegment}:${trade.securityId}`;
}

function calculateClosedTrades(trades: DhanTrade[]) {
  const inventory = new Map<string, { quantity: number; price: number; chargesPerShare: number }[]>();
  const closed: ClosedTrade[] = [];
  const sorted = [...trades].sort((a, b) => tradeSortKey(a).localeCompare(tradeSortKey(b)));

  for (const trade of sorted) {
    const quantity = toNumber(trade.tradedQuantity);
    const price = toNumber(trade.tradedPrice);
    if (!quantity || !price) continue;
    const key = tradeInstrumentKey(trade);
    const symbol = trade.tradingSymbol || trade.customSymbol || key;
    const lots = inventory.get(key) ?? [];
    const chargesPerShare = tradeCharges(trade) / quantity;

    if (trade.transactionType === "BUY") {
      lots.push({ quantity, price, chargesPerShare });
      inventory.set(key, lots);
      continue;
    }

    let remaining = quantity;
    const sellChargesPerShare = chargesPerShare;
    while (remaining > 0 && lots.length) {
      const lot = lots[0];
      const matched = Math.min(remaining, lot.quantity);
      const grossPnl = (price - lot.price) * matched;
      const charges = (lot.chargesPerShare + sellChargesPerShare) * matched;
      closed.push({ date: tradeDate(trade), symbol, securityId: trade.securityId, quantity: matched, buyPrice: lot.price, sellPrice: price, grossPnl, charges, netPnl: grossPnl - charges });
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity <= 0) lots.shift();
    }
    inventory.set(key, lots);
  }

  return closed;
}

function calculateOpenLotsBySecurity(trades: DhanTrade[]) {
  const inventory = new Map<string, OpenLot[]>();
  const sorted = [...trades].sort((a, b) => tradeSortKey(a).localeCompare(tradeSortKey(b)));

  for (const trade of sorted) {
    const quantity = toNumber(trade.tradedQuantity);
    const price = toNumber(trade.tradedPrice);
    if (!quantity || !price) continue;
    const lots = inventory.get(trade.securityId) ?? [];
    if (trade.transactionType === "BUY") {
      lots.push({ date: tradeDate(trade), quantity, price });
      inventory.set(trade.securityId, lots);
      continue;
    }
    let remaining = quantity;
    while (remaining > 0 && lots.length) {
      const lot = lots[0];
      const matched = Math.min(remaining, lot.quantity);
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity <= 0) lots.shift();
    }
    inventory.set(trade.securityId, lots);
  }

  return inventory;
}

function maxDrawdown(values: number[]) {
  let peak = 0;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, value - peak);
  }
  return worst;
}

function weekdayTradingDaysSince(entryDate: string, currentDate: string) {
  const start = new Date(`${entryDate}T00:00:00Z`);
  const end = new Date(`${currentDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0;
  let days = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (isNseBusinessDay(cursor.toISOString().slice(0, 10))) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function isNseBusinessDay(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const day = parsed.getUTCDay();
  const monthDay = `${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
  return day !== 0 && day !== 6 && !fixedNseHolidayMonthDays.has(monthDay);
}

function tradingDaysHeldFromPrices(prices: { security_id: string; trade_date: string }[], securityId: string, entryDate: string, currentDate: string) {
  const rows = new Set(prices.filter((row) => row.security_id === securityId && row.trade_date >= entryDate && row.trade_date <= currentDate).map((row) => row.trade_date));
  if (isNseBusinessDay(entryDate)) rows.add(entryDate);
  if (isNseBusinessDay(currentDate)) rows.add(currentDate);
  if (rows.size) return rows.size;
  const marketDates = new Set(prices.filter((row) => row.trade_date >= entryDate && row.trade_date <= currentDate).map((row) => row.trade_date));
  if (isNseBusinessDay(entryDate)) marketDates.add(entryDate);
  if (isNseBusinessDay(currentDate)) marketDates.add(currentDate);
  return marketDates.size || weekdayTradingDaysSince(entryDate, currentDate);
}

function todaySellFromHoldingQty(position?: DhanPosition) {
  if (!position) return 0;
  return Math.max(0, position.sellQty - position.buyQty, -position.netQty);
}

function openBuyQty(position: DhanPosition) {
  return Math.max(0, position.netQty, position.buyQty - position.sellQty);
}

function isDeliveryPosition(position: DhanPosition) {
  return position.productType === "CNC" || position.productType === "DELIVERY" || position.productType === "Delivery";
}

function isEtfLike(securityId: string, symbol: string, tradeInstruments: Map<string, string>) {
  const normalized = symbol.toUpperCase();
  const instrument = (tradeInstruments.get(securityId) ?? "").toUpperCase();
  return instrument.includes("ETF") || /\bETF\b/.test(normalized) || normalized.endsWith("BEES") || normalized.includes("IETF");
}

function holdingEntryDate(openLots: OpenLot[]) {
  return openLots.find((lot) => lot.quantity > 0)?.date;
}

function numberField(input: object | undefined, keys: string[]) {
  const record = input as Record<string, unknown> | undefined;
  for (const key of keys) {
    const value = record?.[key];
    const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : undefined;
    if (numberValue !== undefined && Number.isFinite(numberValue)) return numberValue;
  }
  return undefined;
}

function latestPrice(prices: { security_id: string; trade_date: string; close: number }[], securityId: string) {
  return prices
    .filter((row) => row.security_id === securityId)
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    .at(-1)?.close;
}

type DailyPrice = { security_id: string; symbol?: string; trade_date: string; open?: number; high?: number; low?: number; close: number; volume?: number };

function securityPrices(prices: DailyPrice[], securityId: string) {
  return prices
    .filter((row) => row.security_id === securityId)
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
}

function latestEma(prices: DailyPrice[], securityId: string, period: number) {
  return calculateEma(securityPrices(prices, securityId).map((row) => row.close), period).at(-1);
}

function recentChartRows(prices: DailyPrice[], securityId: string) {
  const rows = securityPrices(prices, securityId).slice(-120);
  const closes = rows.map((row) => row.close);
  const ema50 = calculateEma(closes, 50);
  return rows.map((row, index) => {
    const previousVolume = rows.slice(Math.max(0, index - 20), index).map((item) => item.volume ?? 0).filter((volume) => volume > 0);
    const averageVolume = previousVolume.length ? previousVolume.reduce((sum, volume) => sum + volume, 0) / previousVolume.length : 0;
    return {
      trade_date: row.trade_date,
      open: row.open ?? row.close,
      high: row.high ?? row.close,
      low: row.low ?? row.close,
      close: row.close,
      ema50: ema50[index],
      volume: row.volume ?? 0,
      volume_ratio: averageVolume > 0 && row.volume ? row.volume / averageVolume : undefined,
    };
  });
}

function currentDayMove(rows: DailyPrice[]) {
  const latest = [...rows].sort((a, b) => a.trade_date.localeCompare(b.trade_date)).at(-1);
  if (!latest) return undefined;
  const base = latest.open && latest.open > 0 ? latest.open : rows.filter((row) => row.trade_date < latest.trade_date).at(-1)?.close;
  return base ? ((latest.close - base) / base) * 100 : undefined;
}

function marketIndexTiles(prices: DailyPrice[]) {
  const findRows = (match: (symbol: string) => boolean) => prices.filter((row) => match((row.symbol ?? "").toUpperCase()));
  const tile = (label: string, rows: DailyPrice[]) => ({ label, changePct: currentDayMove(rows) });
  const nifty50Rows = findRows((symbol) => ["NIFTY", "NIFTY50", "NIFTY 50", "NIFTY_INDEX"].includes(symbol));
  return [
    tile("Nifty 50", nifty50Rows),
    tile("Nifty Midcap 150", findRows((symbol) => symbol.includes("MIDCAP")).length ? findRows((symbol) => symbol.includes("MIDCAP")) : []),
    tile("Nifty Smallcap 250", findRows((symbol) => symbol.includes("SMALLCAP")).length ? findRows((symbol) => symbol.includes("SMALLCAP")) : []),
  ];
}

function positionLtp(position: DhanPosition | undefined, fallback?: number) {
  const price = numberField(position, ["lastTradedPrice", "ltp", "LTP", "lastPrice", "currentPrice"]) ?? fallback;
  return Number.isFinite(price) && price && price > 0 ? price : undefined;
}

function holdingLtp(holding: DhanHolding, position: DhanPosition | undefined, fallback?: number) {
  const price = numberField(holding, ["lastTradedPrice", "ltp", "LTP", "lastPrice", "currentPrice"]) ?? positionLtp(position) ?? fallback;
  return Number.isFinite(price) && price && price > 0 ? price : undefined;
}

function enrichHolding(input: DhanHolding & { totalQty: number; availableQty: number }, position: DhanPosition | undefined, openLots: OpenLot[], today: string, prices: DailyPrice[], stopLoss?: number) {
  const brokerEntryDate = holdingEntryDate(openLots) ?? today;
  const invested = input.totalQty * input.avgCostPrice;
  const ltp = holdingLtp(input, position, position ? undefined : latestPrice(prices, input.securityId));
  const ema50 = latestEma(prices, input.securityId, 50);
  const holdingPnl = numberField(input, ["unrealizedProfit", "unrealizedPnl", "pnl", "totalPnl"]);
  const positionPnl = position && openBuyQty(position) > 0 ? position.unrealizedProfit : undefined;
  const unrealizedPnl = holdingPnl ?? (ltp ? (ltp - input.avgCostPrice) * input.totalQty : positionPnl ?? 0);
  const dayPnl = position?.dayPnl ?? (position ? (position.daySellValue ?? 0) - (position.dayBuyValue ?? 0) : 0);
  const riskFree = stopLoss !== undefined && stopLoss >= input.avgCostPrice;
  const accountRisk = stopLoss === undefined || riskFree ? 0 : Math.max(0, input.avgCostPrice - stopLoss) * input.totalQty;
  return {
    ...input,
    invested,
    currentPrice: ltp,
    unrealizedPnl,
    dayPnl,
    stopLoss,
    accountRisk,
    riskFree,
    ema50,
    distanceFrom50EmaPct: ema50 && ltp ? ((ltp - ema50) / ema50) * 100 : undefined,
    recent: recentChartRows(prices, input.securityId),
    productType: position?.productType ?? "CNC",
    positionType: position?.positionType ?? "HOLDING",
    brokerEntryDate,
    brokerCalendarDaysHeld: Math.max(0, Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${brokerEntryDate}T00:00:00Z`).getTime()) / 86_400_000)),
    brokerTradingDaysHeld: tradingDaysHeldFromPrices(prices, input.securityId, brokerEntryDate, today),
    brokerOpenLots: openLots.filter((lot) => lot.quantity > 0).length,
  };
}

function monthlyPnl(closedTrades: ClosedTrade[], trades: DhanTrade[]) {
  const buckets = new Map<string, number>();
  for (const trade of closedTrades) {
    const key = trade.date.slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 0) + trade.grossPnl);
  }
  for (const trade of trades) {
    const key = tradeDate(trade).slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 0) - tradeCharges(trade));
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, pnl]) => ({ month, pnl }));
}

export async function GET() {
  if (!hasDhanCredentials()) return NextResponse.json({ error: "Dhan credentials are not configured." }, { status: 401 });

  try {
    const period = portfolioPeriod();
    const [holdings, positions, inventoryTrades] = await Promise.all([getHoldings(), getPositions(), getTradeHistory(period.inventoryFrom, period.to)]);
    const trades = inventoryTrades.filter((trade) => {
      const date = tradeDate(trade);
      return date >= period.from && date <= period.to;
    });
    const positionBySecurity = new Map(positions.map((position) => [position.securityId, position]));
    const openLotsBySecurity = calculateOpenLotsBySecurity(inventoryTrades);
    const tradeInstruments = new Map(inventoryTrades.map((trade) => [trade.securityId, trade.instrument]));
    const db = await readDatabase();
    const stopLossBySecurity = new Map(db.portfolio_stop_losses.map((row) => [row.security_id, row.stop_loss]));
    const today = period.to;
    const holdingsBySecurity = new Set(holdings.map((holding) => holding.securityId));
    const adjustedHoldings = holdings.map((holding) => {
      const position = positionBySecurity.get(holding.securityId);
      const openLots = openLotsBySecurity.get(holding.securityId) ?? [];
      if (isEtfLike(holding.securityId, holding.tradingSymbol, tradeInstruments)) return null;
      const sellFromHoldingQty = todaySellFromHoldingQty(position);
      const effectiveQty = sellFromHoldingQty > 0 ? Math.max(0, holding.availableQty || holding.totalQty - sellFromHoldingQty) : holding.totalQty;
      if (effectiveQty <= 0) return null;
      return enrichHolding({ ...holding, totalQty: effectiveQty, availableQty: Math.min(holding.availableQty || effectiveQty, effectiveQty) }, position, openLots, today, db.daily_prices, stopLossBySecurity.get(holding.securityId));
    }).filter((holding): holding is NonNullable<typeof holding> => Boolean(holding));
    const boughtPositions = positions
      .filter((position) => !holdingsBySecurity.has(position.securityId) && isDeliveryPosition(position) && openBuyQty(position) > 0 && !isEtfLike(position.securityId, position.tradingSymbol, tradeInstruments))
      .map((position) => {
        const quantity = openBuyQty(position);
        const avgCostPrice = position.buyAvg || position.costPrice;
        const holding: DhanHolding & { totalQty: number; availableQty: number } = {
          exchange: position.exchangeSegment,
          tradingSymbol: position.tradingSymbol,
          securityId: position.securityId,
          isin: "",
          totalQty: quantity,
          dpQty: 0,
          t1Qty: quantity,
          availableQty: quantity,
          collateralQty: 0,
          avgCostPrice,
        };
        return enrichHolding(holding, position, [{ date: today, quantity, price: avgCostPrice }], today, db.daily_prices, stopLossBySecurity.get(position.securityId));
      });
    const enrichedHoldings = [...adjustedHoldings, ...boughtPositions];

    const closedTrades = calculateClosedTrades(inventoryTrades).filter((trade) => trade.date >= period.from && trade.date <= period.to);
    const wins = closedTrades.filter((trade) => trade.netPnl > 0);
    const losses = closedTrades.filter((trade) => trade.netPnl < 0);
    const grossPnl = closedTrades.reduce((sum, trade) => sum + trade.grossPnl, 0);
    const charges = trades.reduce((sum, trade) => sum + tradeCharges(trade), 0);
    const netPnl = grossPnl - charges;
    const chargesByDate = new Map<string, number>();
    for (const trade of trades) {
      const date = tradeDate(trade);
      chargesByDate.set(date, (chargesByDate.get(date) ?? 0) + tradeCharges(trade));
    }
    const grossByDate = new Map<string, number>();
    for (const trade of closedTrades) grossByDate.set(trade.date, (grossByDate.get(trade.date) ?? 0) + trade.grossPnl);
    let cumulative = 0;
    const equityDates = [...new Set([...grossByDate.keys(), ...chargesByDate.keys()])].sort();
    const equityCurve = equityDates.map((date) => {
      const pnl = (grossByDate.get(date) ?? 0) - (chargesByDate.get(date) ?? 0);
      cumulative += pnl;
      return { date, pnl, cumulative };
    });

    const totalInvested = enrichedHoldings.reduce((sum, holding) => sum + holding.invested, 0);
    const unrealizedPnl = enrichedHoldings.reduce((sum, holding) => sum + holding.unrealizedPnl, 0);
    const stats = {
      financialYear: period.label,
      from: period.from,
      to: period.to,
      totalTrades: trades.length,
      closedTrades: closedTrades.length,
      realizedPnl: netPnl,
      grossPnl,
      charges,
      unrealizedPnl,
      totalInvested,
      portfolioPnl: netPnl + unrealizedPnl,
      winners: wins.length,
      losers: losses.length,
      winRate: closedTrades.length ? (wins.length / closedTrades.length) * 100 : 0,
      averageWin: wins.reduce((sum, trade) => sum + trade.netPnl, 0) / (wins.length || 1),
      averageLoss: losses.reduce((sum, trade) => sum + trade.netPnl, 0) / (losses.length || 1),
      maxProfit: Math.max(...closedTrades.map((trade) => trade.netPnl), 0),
      maxLoss: Math.min(...closedTrades.map((trade) => trade.netPnl), 0),
      drawdown: maxDrawdown(equityCurve.map((point) => point.cumulative)),
      winLossRatio: Math.abs((wins.reduce((sum, trade) => sum + trade.netPnl, 0) / (wins.length || 1)) / (losses.reduce((sum, trade) => sum + trade.netPnl, 0) / (losses.length || 1) || -1)),
    };

    const tradeManagement = await getTradeManagementSnapshot(enrichedHoldings);

    return NextResponse.json({
      holdings: enrichedHoldings,
      positions,
      trades,
      closedTrades,
      equityCurve,
      monthlyPnl: monthlyPnl(closedTrades, trades),
      marketIndexes: marketIndexTiles(db.daily_prices),
      stats,
      tradeManagement,
      source: {
        tradeHistoryFrom: period.from,
        tradeHistoryTo: period.to,
        inventoryHistoryFrom: period.inventoryFrom,
        rawTrades: trades.length,
        closedLots: closedTrades.length,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Portfolio unavailable" }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const securityId = String(body.securityId ?? "").trim();
    const tradingSymbol = String(body.tradingSymbol ?? "").trim();
    const isin = body.isin ? String(body.isin) : undefined;
    const stopLoss = Number(body.stopLoss);
    if (!securityId) return NextResponse.json({ error: "Security ID is required." }, { status: 400 });
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) return NextResponse.json({ error: "Stop loss must be greater than zero." }, { status: 400 });
    const db = await readDatabase();
    const now = new Date().toISOString();
    const index = db.portfolio_stop_losses.findIndex((row) => row.security_id === securityId);
    if (index >= 0) db.portfolio_stop_losses[index] = { ...db.portfolio_stop_losses[index], isin, trading_symbol: tradingSymbol, stop_loss: stopLoss, updated_at: now };
    else db.portfolio_stop_losses.push({ security_id: securityId, isin, trading_symbol: tradingSymbol, stop_loss: stopLoss, created_at: now, updated_at: now });
    await writeDatabase(db);
    return NextResponse.json({ stopLoss: db.portfolio_stop_losses.find((row) => row.security_id === securityId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save stop loss." }, { status: 400 });
  }
}
