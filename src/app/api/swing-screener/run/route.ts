import { NextRequest, NextResponse } from "next/server";
import { runSwingScreener } from "@/lib/swingScreenerService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await runSwingScreener(body.filters ?? body));
}
