import { NextRequest, NextResponse } from "next/server";
import { getPrices } from "@/lib/historicalDataService";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ securityId: string }> }) {
  const { securityId } = await params;
  return NextResponse.json(await getPrices(securityId));
}
