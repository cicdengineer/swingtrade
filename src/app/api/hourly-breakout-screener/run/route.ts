import { NextResponse } from "next/server";
import { runHourlyBreakoutScreener } from "@/lib/hourlyBreakoutScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runHourlyBreakoutScreener(body.filters ?? body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Hourly Breakout screener failed" }, { status: 500 });
  }
}
