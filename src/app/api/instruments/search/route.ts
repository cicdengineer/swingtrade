import { NextRequest, NextResponse } from "next/server";
import { readDatabase } from "@/lib/localDatabase";
import { searchSecurities } from "@/lib/dhan";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase();
  if (!q) return NextResponse.json([]);
  const db = await readDatabase();
  const local = db.instruments
    .filter((row) => row.symbol.toLowerCase().includes(q) || row.company_name.toLowerCase().includes(q) || row.isin.toLowerCase().includes(q))
    .slice(0, 20);
  if (local.length) return NextResponse.json(local);
  try {
    const results = await searchSecurities(q);
    return NextResponse.json(results.map((row) => ({
      security_id: row.securityId,
      symbol: row.symbol,
      company_name: row.name,
      isin: row.isin ?? "",
      exchange_segment: row.segment,
      instrument: row.instrument,
    })));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Instrument search unavailable" }, { status: 502 });
  }
}
