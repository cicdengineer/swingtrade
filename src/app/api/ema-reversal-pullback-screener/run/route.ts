import { NextResponse } from "next/server";
import { runEmaReversalPullbackScreener } from "@/lib/emaReversalPullbackScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runEmaReversalPullbackScreener(body.filters ?? {}));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "50 EMA Reversal Pullback scanner failed" }, { status: 500 });
  }
}
