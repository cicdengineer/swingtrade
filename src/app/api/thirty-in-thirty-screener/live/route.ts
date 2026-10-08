import { NextResponse } from "next/server";
import { createDhanLiveStream } from "@/lib/dhanLiveStream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ids = (url.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    if (!ids.length) return NextResponse.json({ error: "No security IDs provided." }, { status: 400 });

    return createDhanLiveStream(request, ids);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Live feed unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.map((id: unknown) => String(id).trim()).filter(Boolean) : [];
    if (!ids.length) return NextResponse.json({ error: "No security IDs provided." }, { status: 400 });

    return createDhanLiveStream(request, ids);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Live feed unavailable" }, { status: 500 });
  }
}
