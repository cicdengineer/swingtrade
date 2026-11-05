import { collectOriginalResults, type EarningsBySymbol } from "./earnings";

const hour = 60 * 60_000;
let snapshot: EarningsBySymbol | undefined;
let nextRefresh = 0;
let pending: Promise<EarningsBySymbol> | undefined;

async function loadResults() {
  const now = new Date();
  const format = (date: Date) => date.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }).replaceAll("/", "-");
  const params = new URLSearchParams({
    index: "equities", type: "Integrated Filing- Financials",
    from_date: format(new Date(now.getTime() - 215 * 24 * hour)), to_date: format(now),
    size: "1000",
  });
  const results: EarningsBySymbol = Object.create(null);
  let received = 0;
  for (let page = 1; ; page++) {
    params.set("page", String(page));
    const response = await fetch(`https://www.nseindia.com/api/integrated-filing-results?${params}`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", Referer: "https://www.nseindia.com/companies-listing/corporate-integrated-filing" },
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`NSE returned ${response.status}`);
    const { data, totalCount, page: pageIndex } = await response.json();
    if (!Array.isArray(data) || !Number.isInteger(totalCount) || totalCount < 1 || !data.length || pageIndex !== page - 1) throw new Error("Incomplete NSE results feed");
    collectOriginalResults(data, results);
    received += data.length;
    if (received >= totalCount) break;
  }
  if (!Object.keys(results).length) throw new Error("No original financial results received");
  return results;
}

export async function getEarnings() {
  if (Date.now() < nextRefresh) {
    if (snapshot) return snapshot;
    throw new Error("NSE results temporarily unavailable");
  }
  pending ??= loadResults().then(results => {
    snapshot = results;
    nextRefresh = Date.now() + hour;
    return results;
  }).catch(error => {
    nextRefresh = Date.now() + 60_000;
    console.warn("Earnings refresh failed", error);
    if (snapshot) return snapshot;
    throw error;
  }).finally(() => { pending = undefined; });
  return pending;
}
