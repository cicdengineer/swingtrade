import { NextResponse } from "next/server";
import { getHoldings, getPositions, getTradeHistory, hasDhanCredentials, type DhanTrade } from "@/lib/dhan";
import { getTradeManagementSnapshot } from "@/lib/tradeManagementStore";

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
const tradeCharges = (trade: DhanTrade) =>
  toNumber(trade.sebiTax) + toNumber(trade.stt) + toNumber(trade.brokerageCharges) + toNumber(trade.serviceTax) + toNumber(trade.exchangeTransactionCharges) + toNumber(trade.stampDuty);

function portfolioPeriod(today = new Date()) {
  const to = today.toISOString().slice(0, 10);
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
    const today = period.to;
    const enrichedHoldings = holdings.map((holding) => {
      const position = positionBySecurity.get(holding.securityId);
      const openLots = openLotsBySecurity.get(holding.securityId) ?? [];
      const brokerEntryDate = openLots.find((lot) => lot.quantity > 0)?.date;
      const invested = holding.totalQty * holding.avgCostPrice;
      const unrealizedPnl = position?.unrealizedProfit ?? 0;
      const dayPnl = (position?.daySellValue ?? 0) - (position?.dayBuyValue ?? 0);
      return {
        ...holding,
        invested,
        unrealizedPnl,
        dayPnl,
        productType: position?.productType ?? "CNC",
        positionType: position?.positionType ?? "HOLDING",
        brokerEntryDate,
        brokerCalendarDaysHeld: brokerEntryDate ? Math.max(0, Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${brokerEntryDate}T00:00:00Z`).getTime()) / 86_400_000)) : undefined,
        brokerOpenLots: openLots.filter((lot) => lot.quantity > 0).length,
      };
    });

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
