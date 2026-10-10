import { NextResponse } from "next/server";
import { runEmaConsolidationScreener } from "@/lib/emaConsolidationScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runEmaConsolidationScreener(body.filters ?? body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "20 EMA Consolidation screener failed" }, { status: 500 });
  }
}
