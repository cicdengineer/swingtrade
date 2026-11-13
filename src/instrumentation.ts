export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DHAN_ACCESS_TOKEN || !process.env.DHAN_CLIENT_ID) return;
  const { ensureDhanLiveUniverse } = await import("./lib/dhanLiveUniverse");
  const state = globalThis as typeof globalThis & { __dhanUniverseTimer?: ReturnType<typeof setInterval> };
  const refresh = () => { void ensureDhanLiveUniverse().catch(error => console.error("Unable to subscribe stored stocks to live feed", error)); };
  refresh();
  state.__dhanUniverseTimer ??= setInterval(refresh, 60_000);
  state.__dhanUniverseTimer.unref();
}
