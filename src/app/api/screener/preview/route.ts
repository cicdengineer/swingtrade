import { NextResponse } from "next/server";
import { runThirtyInThirtyScreener } from "@/lib/thirtyInThirtyScreenerService";
import { runQullamaggieScreener } from "@/lib/qullamaggieScreenerService";
import { runEmaNoTouchScreener } from "@/lib/emaNoTouchScreenerService";
import { runStochRsiScreener } from "@/lib/stochRsiScreenerService";
import { runVolumeSellingScreener } from "@/lib/volumeSellingScreenerService";
import { getSeasonalStocks } from "@/lib/seasonalStocksService";
import { findSwingHigh, isAboveSwingHighRed } from "@/lib/swingHigh";
import { findStochHigh } from "@/lib/stochHigh";
import { isLatestLowAbove10Ema } from "@/lib/dailyEmaLow";

export const dynamic = "force-dynamic";

// Rank the default combined watchlist before sending any stock details to a viewer.
export async function GET() {
  const [thirty, q, ema, stoch, seasonal, selling] = await Promise.allSettled([
    runThirtyInThirtyScreener({ universe: "ALL", showAll: true }),
    runQullamaggieScreener({ universe: "ALL" }), runEmaNoTouchScreener({ universe: "ALL" }),
    runStochRsiScreener({ universe: "ALL" }), getSeasonalStocks(new Date().getMonth()),
    runVolumeSellingScreener(),
  ] as const);
  if (thirty.status !== "fulfilled") return NextResponse.json({ error: "Screener unavailable." }, { status: 503 });
  const members = new Map<string, string[]>();
  function add(id: string, source: string) { members.set(id, [...(members.get(id) ?? []), source]); }
  if (q.status === "fulfilled") q.value.results.filter(row => row.qualifies).forEach(row => add(row.security_id, "Qullamaggie"));
  if (ema.status === "fulfilled") ema.value.results.forEach(row => add(row.security_id, "10 EMA Catchup"));
  if (stoch.status === "fulfilled") stoch.value.results.filter(row => row.qualifies).forEach(row => add(row.security_id, "StochRSI"));
  if (selling.status === "fulfilled") selling.value.results.filter(row => row.signal_age < 21).forEach(row => add(row.security_id, "SellingClimax"));
  const rows = new Map(thirty.value.results.map(row => [row.security_id, row]));
  for (const row of seasonal.status === "fulfilled" ? seasonal.value.results : []) {
    add(row.security_id, "Seasonal Stocks");
    if (!rows.has(row.security_id)) rows.set(row.security_id, row);
  }
  const matches = [];
  for (const row of rows.values()) {
    const previous = row.recent.at(-2)?.close;
    const volume = [...row.recent].reverse().find(point => point.volume > 0)?.volume_ratio ?? 0;
    if (!previous || row.current_close <= previous || volume < 1.5 || !isLatestLowAbove10Ema(row) || !isAboveSwingHighRed(row.recent, row.current_close)) continue;
    if (row.qualifies) add(row.security_id, "30 in 30");
    if (findSwingHigh(row.recent, row.current_close)?.qualifies) add(row.security_id, "SwingHigh");
    if (findStochHigh(row.recent)?.qualifies) add(row.security_id, "StochHigh");
    if ((row.monthly_stoch_d ?? 0) > 79) add(row.security_id, "MStochRSI80");
    if (members.has(row.security_id)) matches.push({ row, gain: row.current_close / previous });
  }
  matches.sort((a,b) => b.gain - a.gain);
  const results = matches.slice(0, 1).map(match => match.row);
  return NextResponse.json({ data: { ...thirty.value, results }, lockedCount: Math.max(0, matches.length - 1),
    membership: Object.fromEntries(results.map(row => [row.security_id, members.get(row.security_id)])) });
}
