import { NextResponse } from "next/server";
import { getDataStatus } from "@/lib/historicalDataService";

import { readLatestDownloadJob } from "@/lib/localDatabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("job") === "latest") return NextResponse.json(await readLatestDownloadJob());
    return NextResponse.json(await getDataStatus());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Data status unavailable" }, { status: 502 });
  }
}
