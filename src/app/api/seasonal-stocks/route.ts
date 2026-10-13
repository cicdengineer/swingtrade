import { NextResponse } from "next/server";
import { runSeasonalStocks } from "@/lib/seasonalStocksService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const monthParam = new URL(request.url).searchParams.get("month");
    const month = monthParam === null ? new Date().getMonth() : Number(monthParam);
    return NextResponse.json(await runSeasonalStocks(month));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Seasonal stocks unavailable" }, { status: 500 });
  }
}
