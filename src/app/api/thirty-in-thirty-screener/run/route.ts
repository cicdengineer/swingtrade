import { NextResponse } from "next/server";
import { runThirtyInThirtyScreener } from "@/lib/thirtyInThirtyScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runThirtyInThirtyScreener(body.filters ?? body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "30 in 30 screener failed" }, { status: 500 });
  }
}
