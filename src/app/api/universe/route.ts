import { NextResponse } from "next/server";
import { readDatabase } from "@/lib/localDatabase";
import { refreshUniverseData } from "@/lib/historicalDataService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    let db = await readDatabase();
    if (!db.universe_members.length) {
      await refreshUniverseData();
      db = await readDatabase();
    }
    return NextResponse.json(db.universe_members);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Universe unavailable" }, { status: 502 });
  }
}
