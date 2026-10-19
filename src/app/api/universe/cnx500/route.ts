import { NextResponse } from "next/server";
import { readDatabase } from "@/lib/localDatabase";
import { refreshUniverseData } from "@/lib/historicalDataService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    let db = await readDatabase();
    if (!db.universe_members.some((member) => member.universe_name === "CNX500")) {
      await refreshUniverseData();
      db = await readDatabase();
    }
    return NextResponse.json(db.universe_members.filter((member) => member.universe_name === "CNX500"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nifty 500 universe unavailable" }, { status: 502 });
  }
}
