import { NextResponse } from "next/server";
import { runThirtyInThirtyScreener } from "@/lib/thirtyInThirtyScreenerService";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await runThirtyInThirtyScreener());
}
