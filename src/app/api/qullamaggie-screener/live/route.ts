import { NextResponse } from "next/server";
import { createDhanLiveStream } from "@/lib/dhanLiveStream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const securityId = new URL(request.url).searchParams.get("id")?.trim();
    if (!securityId || !/^\d+$/.test(securityId)) return NextResponse.json({ error: "Valid security ID required." }, { status: 400 });
    return createDhanLiveStream(request, [securityId]);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Live feed unavailable" }, { status: 500 });
  }
}
