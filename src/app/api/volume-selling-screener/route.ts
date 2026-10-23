import { NextResponse } from "next/server";
import { runVolumeSellingScreener } from "@/lib/volumeSellingScreenerService";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await runVolumeSellingScreener()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "VolumeSelling scan failed" }, { status: 500 }); }
}
