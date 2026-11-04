import { NextResponse } from "next/server";
import { getIndexSnapshot } from "@/lib/historicalDataService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getIndexSnapshot("NIFTYSC500"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nifty Smallcap 500 data unavailable" }, { status: 502 });
  }
}
