import { NextResponse } from "next/server";
import { runEmaConsolidationScreener } from "@/lib/emaConsolidationScreenerService";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await runEmaConsolidationScreener());
}
