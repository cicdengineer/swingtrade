import { NextResponse } from "next/server";
import { runMomentumContractionScreener } from "@/lib/momentumContractionScannerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runMomentumContractionScreener(body.filters ?? body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Momentum Tight scanner failed" }, { status: 500 });
  }
}
