import { NextResponse } from "next/server";
import { runThirtyUpScreener } from "@/lib/thirtyUpScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runThirtyUpScreener(body.filters ?? body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "30%Up screener failed" }, { status: 500 });
  }
}
