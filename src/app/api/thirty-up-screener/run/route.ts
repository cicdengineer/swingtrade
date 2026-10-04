import { NextResponse } from "next/server";
import { runThirtyUpScreener } from "@/lib/thirtyUpScreenerService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(await runThirtyUpScreener(body.filters ?? body));
}
