import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { parseBacktestConfig, runScreenerBacktest, type BacktestConfig } from "@/lib/screenerBacktest";
import { getTradingSettings } from "@/lib/tradeManagementStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: session ? 403 : 401 });
  let config: BacktestConfig;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid backtesting settings.");
    config = parseBacktestConfig(body, await getTradingSettings());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid backtesting settings." }, { status: 400 });
  }
  try {
    return NextResponse.json(await runScreenerBacktest(config), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Backtesting failed." }, { status: 500 });
  }
}
