import { NextResponse } from "next/server";
import { runEarlyBreakoutScreener } from "@/lib/earlyBreakoutScreenerService";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await runEarlyBreakoutScreener());
}
