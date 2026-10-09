import { NextResponse } from "next/server";
import { getEmaReversalPullbackDetail } from "@/lib/emaReversalPullbackScreenerService";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ securityId: string }> }) {
  const { securityId } = await params;
  const detail = await getEmaReversalPullbackDetail(securityId);
  if (!detail) return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  return NextResponse.json(detail);
}
