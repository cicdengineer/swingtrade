import { NextResponse } from "next/server";
import { runDryVolumeBreakoutScreener } from "@/lib/dryVolumeBreakoutScreenerService";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(await runDryVolumeBreakoutScreener());
}
