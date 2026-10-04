import { NextResponse } from "next/server";
import { getDataStatus } from "@/lib/historicalDataService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getDataStatus());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Data status unavailable" }, { status: 502 });
  }
}
