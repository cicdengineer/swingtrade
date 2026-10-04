import { NextResponse } from "next/server";
import { runThirtyUpScreener } from "@/lib/thirtyUpScreenerService";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await runThirtyUpScreener());
}
