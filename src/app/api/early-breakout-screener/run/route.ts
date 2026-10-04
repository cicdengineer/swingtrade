import { NextResponse } from "next/server";
import { runEarlyBreakoutScreener } from "@/lib/earlyBreakoutScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(await runEarlyBreakoutScreener(body.filters ?? body));
}
