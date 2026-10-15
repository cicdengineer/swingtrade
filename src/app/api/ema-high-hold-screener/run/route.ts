import { NextResponse } from "next/server";
import { runEmaHighHoldScreener } from "@/lib/emaHighHoldScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runEmaHighHoldScreener(body.filters ?? body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "EMA high hold screener failed" }, { status: 500 });
  }
}
