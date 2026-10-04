import { NextResponse } from "next/server";
import { calculatePositionSizing } from "@/lib/tradeManagement";
import { getTradingSettings } from "@/lib/tradeManagementStore";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const settings = await getTradingSettings();
    const sizing = calculatePositionSizing({
      totalCapital: Number(body.totalCapital ?? settings.totalCapital),
      riskPercent: Number(body.riskPercent ?? settings.riskPercent),
      entryPrice: Number(body.entryPrice),
      stopLoss: Number(body.stopLoss),
    });
    return NextResponse.json({ settings, sizing, liveOrderSupported: false, protectiveStopSupported: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not calculate preview." }, { status: 400 });
  }
}
