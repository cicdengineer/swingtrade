import { NextRequest, NextResponse } from "next/server";
import { readDatabase } from "@/lib/localDatabase";
import { refreshInstrumentData } from "@/lib/historicalDataService";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ securityId: string }> }) {
  try {
    const { securityId } = await params;
    const db = await readDatabase();
    const member = db.universe_members.find((row) => row.security_id === securityId);
    const instrument = db.instruments.find((row) => row.security_id === securityId);
    const price = db.daily_prices.find((row) => row.security_id === securityId);
    if (!member && !instrument && !price) return NextResponse.json({ error: "Security ID is not loaded in the local database." }, { status: 404 });
    const result = await refreshInstrumentData(member ?? {
      securityId: instrument?.security_id ?? price!.security_id,
      symbol: instrument?.symbol ?? price!.symbol,
      name: instrument?.company_name ?? price!.symbol,
      exchange: instrument?.exchange ?? "NSE",
      segment: instrument?.exchange_segment ?? price!.exchange_segment,
      instrument: instrument?.instrument ?? price!.instrument,
      isin: instrument?.isin ?? price!.isin,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Refresh failed" }, { status: 502 });
  }
}
