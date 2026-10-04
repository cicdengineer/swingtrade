import { NextResponse } from "next/server";
import { runThirtyInThirtyScreener } from "@/lib/thirtyInThirtyScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(await runThirtyInThirtyScreener(body.filters ?? body));
}
