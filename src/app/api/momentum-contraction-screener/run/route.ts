import { NextResponse } from "next/server";
import { runMomentumContractionScreener } from "@/lib/momentumContractionScannerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(await runMomentumContractionScreener(body.filters ?? body));
}
