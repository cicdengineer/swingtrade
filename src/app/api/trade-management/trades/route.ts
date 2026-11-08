import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { getHoldings, hasDhanCredentials } from "@/lib/dhan";
import { createManagedTrade, getTradeManagementSnapshot } from "@/lib/tradeManagementStore";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getServerSession(authOptions))?.fullAccess) return NextResponse.json({ error: "Full access required." }, { status: 403 });
  const holdings = hasDhanCredentials() ? await getHoldings().catch(() => []) : [];
  return NextResponse.json({ tradeManagement: await getTradeManagementSnapshot(holdings) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const trade = await createManagedTrade(body);
    return NextResponse.json({ trade }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create managed trade." }, { status: 400 });
  }
}
