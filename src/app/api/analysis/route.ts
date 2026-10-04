import { NextRequest, NextResponse } from "next/server";
import { calculateMonthlySeasonality, calculateQuarterlySeasonality, calculateRollingSeasonality } from "@/lib/analytics";
import { getPrices, refreshInstrumentData } from "@/lib/historicalDataService";

export async function POST(req: NextRequest) {
  try {
    const { security, refresh } = await req.json();
    if (refresh) await refreshInstrumentData(security);
    let stored = await getPrices(security.securityId);
    if (!stored.length) {
      await refreshInstrumentData(security);
      stored = await getPrices(security.securityId);
    }
    const candles = stored.map((row) => ({ date: row.trade_date, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume }));
    return NextResponse.json({
      candles,
      monthly: calculateMonthlySeasonality(candles),
      quarterly: calculateQuarterlySeasonality(candles),
      rolling: calculateRollingSeasonality(candles, 3),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Analysis unavailable" }, { status: 400 });
  }
}
