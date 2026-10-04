import { NextResponse } from "next/server";
import { runBasketRotationBacktest } from "@/lib/basketRotationBacktestService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runBasketRotationBacktest(body.filters ?? body ?? {});
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Basket backtest failed" }, { status: 500 });
  }
}
