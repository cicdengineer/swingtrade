import { NextResponse } from "next/server";
import { runHourlyBreakoutScreener } from "@/lib/hourlyBreakoutScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(await runHourlyBreakoutScreener(body.filters ?? body));
}
