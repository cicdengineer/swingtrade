import { NextResponse } from "next/server";
import { getEmaConsolidationScreenerDetail } from "@/lib/emaConsolidationScreenerService";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ securityId: string }> }) {
  const { securityId } = await params;
  const detail = await getEmaConsolidationScreenerDetail(securityId);
  if (!detail) return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  return NextResponse.json(detail);
}
