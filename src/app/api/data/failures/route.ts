import { NextRequest, NextResponse } from "next/server";
import { readDatabase } from "@/lib/localDatabase";
import { startHistoricalDataRefresh } from "@/lib/historicalDataService";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDatabase();
  return NextResponse.json(db.download_failures.filter((failure) => failure.status === "open"));
}

export async function POST(_req: NextRequest) {
  try {
    const result = await startHistoricalDataRefresh(undefined, true);
    return NextResponse.json(result, { status: result.started ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Retry failed downloads failed" }, { status: 502 });
  }
}
