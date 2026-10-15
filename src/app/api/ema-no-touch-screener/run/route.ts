import { NextResponse } from "next/server";
import { runEmaNoTouchScreener } from "@/lib/emaNoTouchScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runEmaNoTouchScreener(body.filters ?? body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "10 EMA No Touch screener failed" }, { status: 500 });
  }
}
