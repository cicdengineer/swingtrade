import { NextResponse } from "next/server";
import { runDryVolumeBreakoutScreener } from "@/lib/dryVolumeBreakoutScreenerService";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await runDryVolumeBreakoutScreener());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Dry Breakout screener failed" }, { status: 500 });
  }
}
