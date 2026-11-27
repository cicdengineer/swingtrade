import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { readMarketDataBatch, readDailyPricesForWatchlist } from "@/lib/localDatabase";
import { simulateMomentumBacktest } from "@/lib/momentumBacktest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: session ? 403 : 401 });

  const startDate = new URL(request.url).searchParams.get("start");
  if (startDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !Number.isFinite(Date.parse(startDate)) || new Date(startDate).toISOString().slice(0, 10) !== startDate)) {
    return NextResponse.json({ error: "Choose a valid start date." }, { status: 400 });
  }
  try {
    const db = await readMarketDataBatch([]);
    const ids = new Set(db.instruments.filter(row => row.exchange_segment === "NSE_EQ" && row.instrument === "EQUITY").map(row => row.security_id));
    const prices = db.daily_prices.length
      ? db.daily_prices.filter(row => ids.has(row.security_id))
      : await readDailyPricesForWatchlist([...ids]);
    return NextResponse.json(simulateMomentumBacktest(prices, startDate ?? undefined), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Backtesting failed." }, { status: error instanceof RangeError ? 400 : 500 });
  }
}
