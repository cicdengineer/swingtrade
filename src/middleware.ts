import { getToken } from "next-auth/jwt";
import { type NextRequest, NextResponse } from "next/server";

// These POST handlers accept query/filter payloads for research or live quotes.
const viewerQueries = new Set([
  "/api/analysis", "/api/scanner", "/api/basket-backtest", "/api/usa-data",
  "/api/qullamaggie-screener", "/api/trade-management/preview",
  ...["early-breakout", "ema-no-touch", "ema-reversal-pullback", "hourly-breakout",
    "momentum-contraction", "stoch-rsi", "swing", "thirty-in-thirty", "thirty-up"]
    .map(name => `/api/${name}-screener/run`),
  ...["ema-no-touch", "ema-reversal-pullback", "stoch-rsi", "thirty-in-thirty"]
    .map(name => `/api/${name}-screener/live`),
]);

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/auth/") || path === "/api/cron/daily-refresh") return NextResponse.next();

  const secret = process.env.NEXTAUTH_SECRET;
  const token = secret ? await getToken({ req: request, secret }) : null;
  if (!token?.sub) return NextResponse.json({ error: "Sign in with Google to continue." }, { status: 401 });

  const readsData = request.method === "GET" || request.method === "HEAD" ||
    (request.method === "POST" && viewerQueries.has(path));
  if (!readsData && !token.isAdmin) {
    return NextResponse.json({ error: "Only the owner can change shared data." }, { status: 403 });
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(process.env.NEXTAUTH_URL || request.url).origin) {
      return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
    }
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: "/api/:path*" };
