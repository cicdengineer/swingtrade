import { NextResponse } from "next/server";
import { runHourlyBreakoutScreener } from "@/lib/hourlyBreakoutScreenerService";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await runHourlyBreakoutScreener());
}
