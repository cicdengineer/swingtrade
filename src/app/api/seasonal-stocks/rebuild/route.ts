import { NextResponse } from "next/server";
import { rebuildSeasonalStocks } from "@/lib/seasonalStocksService";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const snapshots = await rebuildSeasonalStocks();
    return NextResponse.json({ generatedAt: snapshots[0].generatedAt, counts: snapshots.map((snapshot) => snapshot.qualified) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not rebuild seasonal watchlists" }, { status: 500 });
  }
}
