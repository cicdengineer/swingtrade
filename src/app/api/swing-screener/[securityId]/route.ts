import { NextRequest, NextResponse } from "next/server";
import { getSwingScreenerDetail } from "@/lib/swingScreenerService";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ securityId: string }> }) {
  const { securityId } = await params;
  const detail = await getSwingScreenerDetail(securityId);
  if (!detail) return NextResponse.json({ error: "Swing screener detail unavailable" }, { status: 404 });
  return NextResponse.json(detail);
}
