import { NextResponse } from "next/server";
import { runMomentumContractionScreener } from "@/lib/momentumContractionScannerService";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await runMomentumContractionScreener());
}
