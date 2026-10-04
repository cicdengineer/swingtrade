import { NextResponse } from "next/server";
import { recordTradeEvent } from "@/lib/tradeManagementStore";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const event = await recordTradeEvent(id, body);
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record trade event." }, { status: 400 });
  }
}
