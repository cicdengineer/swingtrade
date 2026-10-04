import { NextResponse } from "next/server";
import { isNseMarketOpen, placeOrder } from "@/lib/dhan";
import { runDryVolumeBreakoutScreener } from "@/lib/dryVolumeBreakoutScreenerService";
import { calculatePositionSizing } from "@/lib/tradeManagement";
import { createManagedTrade, getTradingSettings } from "@/lib/tradeManagementStore";

export const dynamic = "force-dynamic";

const tick = (value: number) => Math.round(value * 20) / 20;
const today = () => new Date().toISOString().slice(0, 10);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const securityId = String(body.securityId ?? "");
    if (!securityId) throw new Error("Security ID is required.");

    const scan = await runDryVolumeBreakoutScreener();
    const row = scan.results.find((item) => item.security_id === securityId);
    if (!row || !row.entry_price || !row.stop_loss) throw new Error("Dry-volume breakout setup was not found for this stock.");
    if (!row.qualifies) throw new Error(row.reason || "This stock is not currently eligible for a dry-volume breakout order.");

    const settings = await getTradingSettings();
    const entryPrice = tick(row.entry_price);
    const stopLoss = tick(row.stop_loss);
    const sizing = calculatePositionSizing({
      totalCapital: settings.totalCapital,
      riskPercent: settings.riskPercent,
      entryPrice,
      stopLoss,
    });
    if (!sizing.valid) throw new Error(sizing.errors.join(" "));
    const quantity = Math.max(0, Math.floor(Number(body.quantity ?? sizing.quantity)));
    if (quantity <= 0) throw new Error("Calculated quantity is zero. Adjust capital, risk, entry, or SL.");

    const afterMarketOrder = !isNseMarketOpen();
    const order = await placeOrder({
      correlationId: `dry-${securityId}-${Date.now().toString(36)}`.slice(0, 32),
      transactionType: "BUY",
      exchangeSegment: "NSE_EQ",
      productType: "CNC",
      orderType: "STOP_LOSS",
      validity: "DAY",
      securityId,
      quantity,
      price: entryPrice,
      triggerPrice: entryPrice,
      afterMarketOrder,
      amoTime: afterMarketOrder ? "OPEN" : "",
    });

    const managedTrade = await createManagedTrade({
      symbol: row.symbol,
      companyName: row.company_name,
      exchange: "NSE",
      instrumentId: row.security_id,
      strategy: "Dry Volume Breakout",
      entryDate: today(),
      averageEntry: entryPrice,
      quantity,
      initialStop: stopLoss,
      plannedStop: stopLoss,
      trailMethod: "10 EMA",
      managementTimeframe: "Daily",
      source: "MANUAL",
      notes: `Dhan ${afterMarketOrder ? "AMO " : ""}STOP_LOSS buy order ${order.orderId} submitted from Dry Breakout screener. Entry trigger ${entryPrice}, app SL ${stopLoss}. Verify broker fill and protective SL after execution.`,
    });

    return NextResponse.json({
      order,
      managedTrade,
      mode: afterMarketOrder ? "AMO" : "MARKET_OPEN",
      row,
      sizing: { ...sizing, quantity },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not place dry-volume breakout order." }, { status: 400 });
  }
}
