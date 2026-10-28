import { NextResponse } from "next/server";
import { getNifty500Snapshot } from "@/lib/historicalDataService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getNifty500Snapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nifty 500 data unavailable" }, { status: 502 });
  }
}
