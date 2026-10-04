import { NextRequest, NextResponse } from "next/server";
import { startHistoricalDataRefresh } from "@/lib/historicalDataService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractBearerToken(header: string | null) {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function isAuthorized(req: NextRequest) {
  const expected = process.env.DATA_REFRESH_SECRET?.trim();
  if (!expected) return false;

  const bearer = extractBearerToken(req.headers.get("authorization"));
  const querySecret = req.nextUrl.searchParams.get("secret")?.trim() ?? "";
  const headerSecret = req.headers.get("x-data-refresh-secret")?.trim() ?? "";

  return [bearer, querySecret, headerSecret].some((candidate) => candidate === expected);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const retryFailures = req.nextUrl.searchParams.get("retryFailures") !== "false";
    const forceUniverse = req.nextUrl.searchParams.get("forceUniverse") === "true";
    const result = await startHistoricalDataRefresh(undefined, retryFailures, forceUniverse);
    return NextResponse.json(
      {
        ...result,
        message: result.started ? "Daily refresh queued." : "A refresh is already running.",
      },
      { status: result.started ? 202 : 200 },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Daily refresh failed" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
