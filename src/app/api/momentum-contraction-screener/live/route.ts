import { NextResponse } from "next/server";
import { dhanLiveFeed } from "@/lib/dhanLiveFeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ids = (url.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    if (!ids.length) return NextResponse.json({ error: "No security IDs provided." }, { status: 400 });

    const idSet = new Set(ids);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        const remove = dhanLiveFeed.addListener((tick) => {
          if (idSet.has(tick.securityId)) send("tick", tick);
        });
        const removeStatus = dhanLiveFeed.addStatusListener((status) => send("status", status));
        try {
          dhanLiveFeed.subscribe(ids);
          send("status", dhanLiveFeed.getStatus());
          send("snapshot", dhanLiveFeed.getSnapshot(ids));
        } catch (error) {
          send("status", { state: "error", message: error instanceof Error ? error.message : "Live feed unavailable", updatedAt: Date.now() });
          remove();
          removeStatus();
          controller.close();
          return;
        }
        const keepAlive = setInterval(() => {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        }, 15000);
        request.signal.addEventListener("abort", () => {
          clearInterval(keepAlive);
          remove();
          removeStatus();
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Live feed unavailable" }, { status: 500 });
  }
}
