import { NextResponse } from "next/server";
import { runStochRsiScreener } from "@/lib/stochRsiScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runStochRsiScreener(body.filters ?? body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "StochRSI screener failed" }, { status: 500 });
  }
}
