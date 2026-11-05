import { getEarnings } from "@/lib/earningsService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getEarnings(), { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return Response.json({ error: "NSE earnings unavailable" }, { status: 503 });
  }
}
