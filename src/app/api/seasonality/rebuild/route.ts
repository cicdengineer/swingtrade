import { NextResponse } from "next/server";
import { rebuildSeasonalityStatistics } from "@/lib/seasonalityEngine";

export const dynamic = "force-dynamic";

export async function POST() {
  const build = await rebuildSeasonalityStatistics();
  return NextResponse.json(build, { status: build.status === "completed" ? 200 : 500 });
}
