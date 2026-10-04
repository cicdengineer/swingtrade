import { NextResponse } from "next/server";
import { runEarlyBreakoutScreener } from "@/lib/earlyBreakoutScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runEarlyBreakoutScreener(body.filters ?? body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Early Breakout screener failed" }, { status: 500 });
  }
}
