import { NextRequest, NextResponse } from "next/server";
import { hasDhanCredentials } from "@/lib/dhan";
import { getHistoricalData, getIndiaTradingDate, getSecurityMaster, isIndianMarketClosed } from "@/lib/historicalDataService";
import type { IpoDataset } from "@/lib/ipoDataset";
import { readIpoDataset, writeIpoDataset } from "@/lib/localDatabase";
import { fetchNseIpoListings } from "@/lib/nseIpoListings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const dateString = (date: Date) => date.toISOString().slice(0, 10);
const dateAtMidnight = (value: string) => new Date(`${value}T00:00:00Z`);
let refreshing = false;

export async function GET(request: NextRequest) {
  try {
    const dataset = await readIpoDataset<IpoDataset>();
    if (request.nextUrl.searchParams.get("format") !== "csv") return NextResponse.json({ dataset });
    if (!dataset) return NextResponse.json({ error: "Refresh IPO data first." }, { status: 404 });
    const rows = dataset.listings.flatMap(({ symbol, listingDate, securityId, candles }) =>
      candles.map(({ date, open, high, low, close, volume }) =>
        [symbol, listingDate, securityId, date, open, high, low, close, volume].join(",")));
    return new NextResponse(["symbol,listing_date,security_id,date,open,high,low,close,volume", ...rows].join("\r\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=nse-ipo-ohlcv.csv",
      },
    });
  } catch (error) {
    console.error("Could not read the IPO dataset", error);
    return NextResponse.json({ error: "Could not read the saved IPO dataset." }, { status: 500 });
  }
}

// Middleware restricts shared dataset writes to the owner.
export async function POST() {
  if (refreshing) return NextResponse.json({ error: "An IPO refresh is already running." }, { status: 409 });
  if (!hasDhanCredentials()) return NextResponse.json({ error: "Dhan credentials are not configured." }, { status: 503 });
  refreshing = true;
  try {
    const now = new Date();
    const today = getIndiaTradingDate(now);
    const to = dateAtMidnight(today);
    if (isIndianMarketClosed(now)) to.setUTCDate(to.getUTCDate() + 1);
    const through = new Date(to.getTime() - 86_400_000);
    const start = dateAtMidnight(today);
    const day = start.getUTCDate();
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    if (start.getUTCDate() !== day) start.setUTCDate(0);
    const from = dateString(start);
    const listings = await fetchNseIpoListings(from, today).catch((error) => {
      console.error("Could not fetch NSE IPO listings", error);
      return null;
    });
    if (!listings) return NextResponse.json({ error: "Could not download NSE IPO listings. Try again shortly." }, { status: 502 });

    const [master, previous] = await Promise.all([getSecurityMaster(), readIpoDataset<IpoDataset>()]);
    const instruments = new Map<string, Set<string>>();
    for (const instrument of master) {
      if (instrument.exchange_segment !== "NSE_EQ") continue;
      const symbol = instrument.symbol.toUpperCase().replace(/-(EQ|BE|BZ|SM|ST)$/, "");
      const ids = instruments.get(symbol) ?? new Set<string>();
      ids.add(instrument.security_id);
      instruments.set(symbol, ids);
    }
    const prior = new Map(previous?.listings.map((listing) => [`${listing.symbol}:${listing.listingDate}`, listing]));
    const pending = listings.map((listing, index) => {
      const old = prior.get(`${listing.symbol}:${listing.listingDate}`);
      return { listing, index, old };
    }).sort((a, b) => (a.old?.candles.at(-1)?.date ?? "").localeCompare(b.old?.candles.at(-1)?.date ?? ""));
    const results: IpoDataset["listings"] = [];
    let next = 0;
    const deadline = now.getTime() + 220_000;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < pending.length) {
        const { listing, index, old } = pending[next++];
        const ids = instruments.get(listing.symbol);
        const securityId = ids?.size === 1 ? [...ids][0] : undefined;
        const saved = old?.securityId === securityId ? old?.candles ?? [] : [];
        let candles = saved;
        let issue: string | undefined;
        if (!securityId) {
          issue = ids?.size ? "Multiple Dhan instruments match this symbol." : "Symbol missing from Dhan's NSE equity master.";
        } else if (listing.listingDate >= dateString(to)) {
          issue = "Awaiting the first completed trading session.";
        } else if (Date.now() >= deadline) {
          issue = "Refresh time limit reached. Refresh again to continue.";
        } else {
          try {
            const last = saved.at(-1)?.date;
            const since = saved[0]?.date === listing.listingDate ? last ?? listing.listingDate : listing.listingDate;
            const incoming = await getHistoricalData({ securityId, symbol: listing.symbol, segment: "NSE_EQ" }, since, dateString(to));
            const byDate = new Map(saved.map((candle) => [candle.date, candle]));
            for (const candle of incoming) {
              if (candle.date < since || candle.date >= dateString(to) ||
                  ![candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) ||
                  candle.low <= 0 || candle.low > Math.min(candle.open, candle.close) ||
                  candle.high < Math.max(candle.open, candle.close) || candle.volume < 0) continue;
              byDate.set(candle.date, candle);
            }
            candles = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
            if (candles[0]?.date !== listing.listingDate) issue = "Dhan did not return a valid listing-day candle.";
          } catch {
            issue = "Dhan historical data could not be fetched. Refresh to retry.";
          }
        }
        results[index] = { ...listing, securityId, candles, issue };
      }
    }));
    if (results.every((listing) => !listing.candles.length) && previous) {
      return NextResponse.json({ error: "Dhan returned no usable candles. The saved dataset is still available." }, { status: 502 });
    }
    const dataset = { from, through: dateString(through), refreshedAt: now.toISOString(), listings: results };
    await writeIpoDataset(dataset);
    return NextResponse.json({ dataset });
  } catch (error) {
    console.error("Could not refresh the IPO dataset", error);
    return NextResponse.json({ error: "Could not load the Dhan instrument master or save IPO data." }, { status: 502 });
  } finally {
    refreshing = false;
  }
}
