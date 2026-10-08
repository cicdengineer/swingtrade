import "server-only";
import { dhanLiveFeed } from "./dhanLiveFeed";

export function createDhanLiveStream(request: Request, ids: string[]) {
  const idSet = new Set(ids);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let remove = () => {};
      let removeStatus = () => {};
      let keepAlive: ReturnType<typeof setInterval> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        remove();
        removeStatus();
        try {
          controller.close();
        } catch {}
      };

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          close();
        }
      };

      remove = dhanLiveFeed.addListener((tick) => {
        if (idSet.has(tick.securityId)) send("tick", tick);
      });
      removeStatus = dhanLiveFeed.addStatusListener((status) => send("status", status));

      try {
        dhanLiveFeed.subscribe(ids);
        send("status", dhanLiveFeed.getStatus());
        send("snapshot", dhanLiveFeed.getSnapshot(ids));
      } catch (error) {
        send("status", { state: "error", message: error instanceof Error ? error.message : "Live feed unavailable", updatedAt: Date.now() });
        close();
        return;
      }

      keepAlive = setInterval(() => send("keepalive", { updatedAt: Date.now() }), 15000);
      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
