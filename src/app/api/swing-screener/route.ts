import { NextResponse } from "next/server";
import { runSwingScreener } from "@/lib/swingScreenerService";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await runSwingScreener());
}
