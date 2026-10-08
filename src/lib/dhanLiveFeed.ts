import "server-only";
import { hasDhanCredentials } from "./dhan";

type LiveTick = {
  securityId: string;
  ltp: number;
  prevClose?: number;
  dayOpen?: number;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
  lastTradeTime?: number;
  receivedAt: number;
};

type Listener = (tick: LiveTick) => void;
type LiveFeedStatus = { state: "idle" | "connecting" | "live" | "error"; message: string; updatedAt: number };
type StatusListener = (status: LiveFeedStatus) => void;

const feedUrl = "wss://api-feed.dhan.co?version=2&authType=2";
const exchangeSegments: Record<number, string> = {
  1: "NSE_EQ",
  4: "BSE_EQ",
};
const disconnectMessages: Record<number, string> = {
  805: "Active websocket connection limit exceeded",
  806: "Subscribe to Dhan Data APIs to continue",
  807: "Access token is expired",
  808: "Invalid Dhan client ID",
  809: "Dhan websocket authentication failed",
};

class DhanLiveFeed {
  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private subscribed = new Set<string>();
  private pending = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = 1500;
  private currentErrorIsFatal = false;
  private ticks = new Map<string, LiveTick>();
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private status: LiveFeedStatus = { state: "idle", message: "Live feed idle", updatedAt: Date.now() };

  getSnapshot(ids: string[]) {
    return ids.map((id) => this.ticks.get(id)).filter((tick): tick is LiveTick => Boolean(tick));
  }

  addListener(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus() {
    return this.status;
  }

  addStatusListener(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  subscribe(ids: string[]) {
    ids.filter(Boolean).forEach((id) => {
      if (!this.subscribed.has(id)) this.pending.add(id);
    });
    this.connect();
    this.flushSubscriptions();
  }

  private connect() {
    if (this.connected || this.connecting) return;
    if (!hasDhanCredentials()) throw new Error("Dhan credentials are not configured.");
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const token = encodeURIComponent(process.env.DHAN_ACCESS_TOKEN!);
    const clientId = encodeURIComponent(process.env.DHAN_CLIENT_ID!);
    this.connecting = true;
    this.currentErrorIsFatal = false;
    this.setStatus("connecting", "Connecting to Dhan websocket");
    this.ws = new WebSocket(`${feedUrl}&token=${token}&clientId=${clientId}`);
    this.ws.binaryType = "arraybuffer";
    const connectTimeout = setTimeout(() => {
      if (this.connecting && !this.connected) {
        this.setStatus("error", "Dhan websocket connection timed out");
        this.ws?.close();
      }
    }, 10000);
    this.ws.addEventListener("open", () => {
      clearTimeout(connectTimeout);
      this.connected = true;
      this.connecting = false;
      this.retryDelayMs = 1500;
      this.setStatus("live", "Dhan websocket live");
      this.flushSubscriptions();
    });
    this.ws.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });
    this.ws.addEventListener("close", (event) => {
      clearTimeout(connectTimeout);
      const idsToRestore = new Set([...this.subscribed, ...this.pending]);
      this.connected = false;
      this.connecting = false;
      this.ws = null;
      this.subscribed.clear();
      this.pending = idsToRestore;
      if (this.status.state !== "error") {
        const reason = event.reason ? `Dhan websocket closed: ${event.reason}` : `Dhan websocket closed (${event.code})`;
        this.setStatus(this.pending.size ? "connecting" : "error", reason);
      }
      if (this.pending.size && !this.currentErrorIsFatal) this.scheduleReconnect();
    });
    this.ws.addEventListener("error", (event) => {
      this.connecting = false;
      const message = "message" in event && typeof event.message === "string" && event.message ? event.message : "Dhan websocket transport error";
      this.setStatus("error", message);
      this.ws?.close();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.connected || this.connecting) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, 30000);
    this.setStatus("connecting", `Reconnecting to Dhan websocket in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setStatus(state: LiveFeedStatus["state"], message: string) {
    this.status = { state, message, updatedAt: Date.now() };
    console.warn(`[DhanLiveFeed] ${state}: ${message}`);
    this.statusListeners.forEach((listener) => listener(this.status));
  }

  private flushSubscriptions() {
    if (!this.connected || !this.ws || this.pending.size === 0) return;
    const ids = Array.from(this.pending);
    this.pending.clear();
    for (let index = 0; index < ids.length; index += 100) {
      const batch = ids.slice(index, index + 100);
      const message = {
        RequestCode: 17,
        InstrumentCount: batch.length,
        InstrumentList: batch.map((securityId) => ({ ExchangeSegment: "NSE_EQ", SecurityId: securityId })),
      };
      this.ws.send(JSON.stringify(message));
      batch.forEach((id) => this.subscribed.add(id));
    }
  }

  private async handleMessage(data: unknown) {
    let buffer: ArrayBuffer;
    if (data instanceof ArrayBuffer) buffer = data;
    else if (data instanceof Blob) buffer = await data.arrayBuffer();
    else return;

    const view = new DataView(buffer);
    if (view.byteLength < 1) return;
    const responseCode = view.getUint8(0);
    if (responseCode === 50) {
      if (view.byteLength >= 10) {
        const errorCode = view.getUint16(8, true);
        this.currentErrorIsFatal = errorCode >= 806 && errorCode <= 809;
        this.setStatus("error", `${disconnectMessages[errorCode] ?? "Dhan server disconnected live feed"} (${errorCode})`);
      } else {
        this.setStatus("error", "Dhan server disconnected live feed");
      }
      this.ws?.close();
      return;
    }
    if (view.byteLength < 12) return;
    const exchangeCode = view.getUint8(3);
    if (!exchangeSegments[exchangeCode]) return;
    const securityId = String(view.getInt32(4, true));
    if (responseCode === 6) {
      const prevClose = view.getFloat32(8, true);
      if (!Number.isFinite(prevClose) || prevClose <= 0) return;
      const current = this.ticks.get(securityId);
      const tick = { ...current, securityId, ltp: current?.ltp ?? prevClose, prevClose, lastTradeTime: current?.lastTradeTime, receivedAt: Date.now() };
      this.ticks.set(securityId, tick);
      this.listeners.forEach((listener) => listener(tick));
      return;
    }
    if (responseCode === 4 && view.byteLength >= 50) {
      const current = this.ticks.get(securityId);
      const ltp = view.getFloat32(8, true);
      const lastTradeTime = view.getInt32(14, true);
      const volume = view.getInt32(22, true);
      const dayOpen = view.getFloat32(34, true);
      const prevClose = view.getFloat32(38, true);
      const dayHigh = view.getFloat32(42, true);
      const dayLow = view.getFloat32(46, true);
      if (!Number.isFinite(ltp) || ltp <= 0) return;
      const tick = {
        ...current,
        securityId,
        ltp,
        prevClose: Number.isFinite(prevClose) && prevClose > 0 ? prevClose : current?.prevClose,
        dayOpen: Number.isFinite(dayOpen) && dayOpen > 0 ? dayOpen : current?.dayOpen,
        dayHigh: Number.isFinite(dayHigh) && dayHigh > 0 ? dayHigh : current?.dayHigh,
        dayLow: Number.isFinite(dayLow) && dayLow > 0 ? dayLow : current?.dayLow,
        volume: Number.isFinite(volume) && volume >= 0 ? volume : current?.volume,
        lastTradeTime,
        receivedAt: Date.now(),
      };
      this.ticks.set(securityId, tick);
      this.listeners.forEach((listener) => listener(tick));
      return;
    }
    if (responseCode !== 2) return;
    const ltp = view.getFloat32(8, true);
    const lastTradeTime = view.byteLength >= 16 ? view.getInt32(12, true) : undefined;
    if (!Number.isFinite(ltp) || ltp <= 0) return;

    const current = this.ticks.get(securityId);
    const tick = { ...current, securityId, ltp, prevClose: current?.prevClose, lastTradeTime, receivedAt: Date.now() };
    this.ticks.set(securityId, tick);
    this.listeners.forEach((listener) => listener(tick));
  }
}

const globalFeed = globalThis as typeof globalThis & { __dhanLiveFeed?: DhanLiveFeed };
export const dhanLiveFeed = globalFeed.__dhanLiveFeed ??= new DhanLiveFeed();
