import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { readMarketDataBatch, readDailyPricesForWatchlist } from "@/lib/localDatabase";
import { simulateMomentumBacktest } from "@/lib/momentumBacktest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: session ? 403 : 401 });

  try {
    const db = await readMarketDataBatch([]);
    const ids = new Set(db.instruments.filter(row => row.exchange_segment === "NSE_EQ" && row.instrument === "EQUITY").map(row => row.security_id));
    const prices = db.daily_prices.length
      ? db.daily_prices.filter(row => ids.has(row.security_id))
      : await readDailyPricesForWatchlist([...ids]);
    return NextResponse.json(simulateMomentumBacktest(prices), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Backtesting failed." }, { status: 500 });
  }
}
