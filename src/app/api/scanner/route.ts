import { NextRequest, NextResponse } from "next/server";
import { defaultScannerFilters, runWalkForwardScanner, type ScannerFilters } from "@/lib/seasonalityEngine";
import type { UniverseName } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const filters: ScannerFilters = body.filters ?? defaultScannerFilters;
  const windowKey = body.window ?? "Jan-Mar";
  const universe = body.universe as UniverseName | "ALL" | undefined;
  const sector = body.sector ?? "ALL";
  const evaluationYear = Number(body.evaluationYear ?? new Date().getFullYear());
  const allocationPerStock = Number(body.allocationPerStock ?? 25000);
  return NextResponse.json(await runWalkForwardScanner({ windowKey, universe, sector, evaluationYear, allocationPerStock, filters }));
}
