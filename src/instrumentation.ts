export async function register() {
  // Keep Node-only imports inside this branch so Next can eliminate them
  // when compiling the instrumentation hook for the Edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.DHAN_ACCESS_TOKEN || !process.env.DHAN_CLIENT_ID) return;
    const { ensureDhanLiveUniverse } = await import("./lib/dhanLiveUniverse");
    const state = globalThis as typeof globalThis & { __dhanUniverseTimer?: ReturnType<typeof setInterval> };
    const refresh = () => { void ensureDhanLiveUniverse().catch(error => console.error("Unable to subscribe stored stocks to live feed", error)); };
    refresh();
    state.__dhanUniverseTimer ??= setInterval(refresh, 60_000);
    state.__dhanUniverseTimer.unref();
  }
}
