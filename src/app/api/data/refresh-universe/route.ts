import { NextRequest, NextResponse } from "next/server";
import { startHistoricalDataRefresh } from "@/lib/historicalDataService";
import type { UniverseName } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const universe = body.universe === "MIDCAP" || body.universe === "SMALLCAP" ? body.universe as UniverseName : undefined;
    const result = await startHistoricalDataRefresh(universe, Boolean(body.retryFailures), Boolean(body.forceUniverse));
    return NextResponse.json(result, { status: result.started ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Universe refresh failed" }, { status: 502 });
  }
}
