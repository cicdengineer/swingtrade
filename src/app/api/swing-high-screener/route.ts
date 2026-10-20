import { NextResponse } from "next/server";
import { runSwingHighScreener } from "@/lib/swingHighScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runSwingHighScreener(body.universe === "CNX500" ? "CNX500" : "ALL"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "SwingHigh scan failed" }, { status: 500 });
  }
}
