import { NextResponse } from "next/server";
import { runStochRsiScreener } from "@/lib/stochRsiScreenerService";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await runStochRsiScreener());
}
