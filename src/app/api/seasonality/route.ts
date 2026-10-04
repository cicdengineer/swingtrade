import { NextRequest, NextResponse } from "next/server";
import { getSeasonalityDataset } from "@/lib/seasonalityEngine";
import type { UniverseName } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const windowKey = url.searchParams.get("window") || "Jan-Mar";
  const universe = url.searchParams.get("universe") as UniverseName | "ALL" | null;
  const sector = url.searchParams.get("sector") || "ALL";
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const securityId = url.searchParams.get("securityId");
  const beforeYear = Number(url.searchParams.get("beforeYear") || 0);
  const data = await getSeasonalityDataset();
  let statistics = data.statistics.filter((row) => row.window_key === windowKey);
  if (universe && universe !== "ALL") statistics = statistics.filter((row) => row.universe_name === universe);
  if (sector !== "ALL") statistics = statistics.filter((row) => row.sector === sector);
  if (search) statistics = statistics.filter((row) => row.symbol.toLowerCase().includes(search) || row.company_name.toLowerCase().includes(search));
  const observations = securityId
    ? data.observations.filter((row) => row.security_id === securityId && row.window_key === windowKey && (!beforeYear || row.occurrence_year < beforeYear)).sort((a, b) => a.occurrence_year - b.occurrence_year)
    : [];
  return NextResponse.json({ ...data, statistics, observations });
}
