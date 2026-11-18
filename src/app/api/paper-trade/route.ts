import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { positionSizingFromStop } from "@/lib/entrySizing";
import { closePaperTrade, listPaperTrades, openPaperTrade } from "@/lib/paperTradeStore";
import { getTradingSettings } from "@/lib/tradeManagementStore";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });
const forbidden = () => fail("Administrator access required.", 403);
const validId = (id: unknown): id is string => typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const validPrice = (price: unknown): price is number =>
  typeof price === "number" && Number.isFinite(price) && price > 0 && price <= 1_000_000_000;

export async function GET() {
  if (!(await getServerSession(authOptions))?.isAdmin) return forbidden();
  try {
    return NextResponse.json({ trades: await listPaperTrades() });
  } catch (error) {
    console.error("Could not load paper trades", error);
    return fail("Could not load paper trades.", 500);
  }
}

export async function POST(request: Request) {
  if (!(await getServerSession(authOptions))?.isAdmin) return forbidden();
  const body = await request.json().catch(() => null);
  if (!validId(body?.id) || typeof body.securityId !== "string" || !/^\d{1,16}$/.test(body.securityId) ||
      typeof body.symbol !== "string" || !body.symbol.trim() || body.symbol.length > 80 ||
      !validPrice(body.entry) || !validPrice(body.stop)) {
    return fail("A stock, entry and daily-low stop are required.", 400);
  }
  try {
    if ((await listPaperTrades()).some(trade => trade.id === body.id)) return NextResponse.json({ saved: true });
    const settings = await getTradingSettings();
    const sizing = positionSizingFromStop(body.entry, body.stop, settings);
    if (!sizing.valid || !Number.isSafeInteger(sizing.quantity)) return fail("The daily-low stop does not produce a valid position size.", 400);
    if (sizing.quantity !== body.quantity) return fail("Trading settings changed. Refresh the workspace and try again.", 409);

    await openPaperTrade({
      id: body.id, securityId: body.securityId, symbol: body.symbol.trim(), entry: body.entry,
      stop: body.stop, quantity: sizing.quantity, capital: settings.totalCapital, riskPercent: settings.riskPercent,
      openedAt: new Date().toISOString(), exitPrice: null, closedAt: null,
    });
    return NextResponse.json({ saved: true }, { status: 201 });
  } catch (error) {
    console.error("Could not open paper trade", error);
    return fail("Could not save the paper trade.", 500);
  }
}

export async function PATCH(request: Request) {
  if (!(await getServerSession(authOptions))?.isAdmin) return forbidden();
  const body = await request.json().catch(() => null);
  if (!validId(body?.id) || !validPrice(body.exitPrice)) return fail("Enter a valid simulated exit price.", 400);
  try {
    await closePaperTrade(body.id, body.exitPrice);
    const trades = await listPaperTrades();
    if (!trades.some(trade => trade.id === body.id)) return fail("Paper trade not found.", 404);
    return NextResponse.json({ trades });
  } catch (error) {
    console.error("Could not close paper trade", error);
    return fail("Could not close the paper trade.", 500);
  }
}
