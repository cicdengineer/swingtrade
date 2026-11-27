import { NextResponse } from "next/server";
import { runFlagScreener } from "@/lib/flagScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    return NextResponse.json(await runFlagScreener(body?.filters ?? {}));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Flag screener unavailable" }, { status: 500 });
  }
}
