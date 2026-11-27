import "server-only";
import type { IpoListing } from "./ipoDataset";

const origin = "https://www.nseindia.in";
const listingPage = `${origin}/market-data/all-upcoming-issues-ipo`;
const months = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
const dayMs = 86_400_000;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const nseDate = (date: Date) => isoDate(date).split("-").reverse().join("-");

function listingDate(value: string) {
  const match = /^(\d{1,2})[- ]([A-Z]{3})[- ](\d{2}|\d{4})$/i.exec(value);
  if (match) {
    const month = months.indexOf(match[2].toUpperCase()) + 1;
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    value = `${year}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && isoDate(date) === value ? value : null;
}

export async function fetchNseIpoListings(from: string, today: string): Promise<IpoListing[]> {
  const headers = new Headers({ "User-Agent": "Mozilla/5.0", Accept: "application/json", Referer: listingPage });
  const deadline = AbortSignal.timeout(50_000);
  const request = (url: string, requestHeaders: Headers) => fetch(url, {
    headers: requestHeaders,
    cache: "no-store",
    signal: AbortSignal.any([deadline, AbortSignal.timeout(12_000)]),
  });
  const home = await request(listingPage, new Headers({ "User-Agent": headers.get("User-Agent")! }));
  const cookies = home.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
  await home.body?.cancel();
  if (cookies) headers.set("Cookie", cookies);

  const listings = new Map<string, IpoListing>();
  const end = Date.parse(today);
  // Issue dates can precede the first eligible listing date.
  for (let start = Date.parse(from) - 45 * dayMs; start <= end; start += 90 * dayMs) {
    const params = new URLSearchParams({
      from_date: nseDate(new Date(start)),
      to_date: nseDate(new Date(Math.min(end, start + 89 * dayMs))),
      security_type: "equity",
    });
    for (const board of ["equity", "sme"]) {
      params.set("security_type", board);
      const response = await request(`${origin}/api/public-past-issues?${params}`, headers);
      if (!response.ok) throw new Error(`NSE IPO listings request failed (HTTP ${response.status}).`);
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error("NSE returned an unexpected IPO listings response.");
      for (const row of body) {
        if (typeof row?.symbol !== "string" || !Object.hasOwn(row, "listingDate")) {
          throw new Error("NSE returned an unexpected IPO listings row.");
        }
        const symbol = row.symbol.trim().toUpperCase();
        const date = typeof row.listingDate === "string" ? listingDate(row.listingDate.trim()) : null;
        if (!date || date < from || date > today || !/^[A-Z0-9][A-Z0-9&._-]{0,31}$/.test(symbol)) continue;
        const company = row.companyName || row.company;
        const existing = listings.get(symbol);
        if (!existing || date < existing.listingDate) {
          listings.set(symbol, { symbol, listingDate: date, company: typeof company === "string" ? company.trim() : "" });
        }
      }
    }
  }
  if (!listings.size) throw new Error("NSE returned no dated equity IPO listings for the last year.");
  return [...listings.values()].sort((a, b) => b.listingDate.localeCompare(a.listingDate) || a.symbol.localeCompare(b.symbol));
}
