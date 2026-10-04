import { NextResponse } from "next/server";
import { getIntradayData } from "@/lib/historicalDataService";

export async function GET(request: Request, { params }: { params: Promise<{ securityId: string }> }) {
  try {
    const { securityId } = await params;
    const url = new URL(request.url);
    const interval = Number(url.searchParams.get("interval") ?? 60);
    const days = Number(url.searchParams.get("days") ?? 30);
    const candles = await getIntradayData(securityId, interval, days);
    return NextResponse.json({ interval, days, candles });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Intraday data unavailable" }, { status: 500 });
  }
}
