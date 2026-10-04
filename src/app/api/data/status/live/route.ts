import { NextResponse } from "next/server";
import { addDataStatusListener, getDataStatus } from "@/lib/historicalDataService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            closed = true;
            remove();
          }
        };
        const remove = addDataStatusListener((job) => send("job", job));

        try {
          send("snapshot", await getDataStatus());
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : "Data status unavailable" });
        }

        const keepAlive = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            closed = true;
            clearInterval(keepAlive);
            remove();
          }
        }, 15000);

        request.signal.addEventListener("abort", () => {
          if (closed) return;
          closed = true;
          clearInterval(keepAlive);
          remove();
          try {
            controller.close();
          } catch {}
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Data status live stream unavailable" }, { status: 500 });
  }
}
