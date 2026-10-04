import { NextResponse } from "next/server";
import { getTradingSettings, saveTradingSettings } from "@/lib/tradeManagementStore";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: await getTradingSettings() });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ settings: await saveTradingSettings(body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save trading settings." }, { status: 400 });
  }
}
