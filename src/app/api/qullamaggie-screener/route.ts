import { NextResponse } from "next/server";
import { runQullamaggieScreener } from "@/lib/qullamaggieScreenerService";
import { runQullamaggieBacktest } from "@/lib/qullamaggieBacktest";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.historical) return NextResponse.json(await runQullamaggieBacktest({ ...body.historical, filters: body.filters ?? {} }));
    return NextResponse.json(await runQullamaggieScreener(body.filters ?? {}, { rescan: Boolean(body.rescan), asOf: body.asOf }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Screener failed" }, { status: 400 });
  }
}
