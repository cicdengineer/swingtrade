import { NextResponse } from "next/server";
import { runEmaReversalPullbackScreener } from "@/lib/emaReversalPullbackScreenerService";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await runEmaReversalPullbackScreener());
}
