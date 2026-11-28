import { apiOrigin } from "./api-config.js";

// Room identifiers stay inside the lobby/transport protocol; players select a room.
export function joinHello(mode, name, room, selection = {}, identity = {}) {
  const config = {};
  if (typeof selection.mapId === "string" && selection.mapId) config.mapId = selection.mapId;
  if (typeof selection.modeId === "string" && selection.modeId) config.modeId = selection.modeId;
  if (typeof identity.uid === "string" && identity.uid.trim()) config.uid = identity.uid.trim();
  if (mode === "quick") return { name, quick: true, ...config };
  // Older deployed servers require this constant flag to list a created room.
  if (mode === "create") return { name, create: true, public: true, ...config };
  if (mode !== "listed" || typeof room !== "string" || !room) throw Error("请从大厅选择房间。");
  return { name, room, ...config };
}

export class RoomDirectory {
  constructor({
    origin,
    pageURL,
    onChange,
    EventSource = globalThis.EventSource,
    retryDelays = [750, 1500],
    firstSnapshotTimeoutMs = 10000,
    schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
    cancelSchedule = (timer) => globalThis.clearTimeout(timer),
  }) {
    this.origin = origin;
    this.pageURL = pageURL;
    this.onChange = onChange;
    this.EventSource = EventSource;
    this.retryDelays = retryDelays;
    this.firstSnapshotTimeoutMs = firstSnapshotTimeoutMs;
    this.schedule = schedule;
    this.cancelSchedule = cancelSchedule;
    this.active = false;
    this.generation = 0;
    this.source = null;
    this.retryCount = 0;
    this.retryTimer = null;
    this.snapshotTimer = null;
  }
  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.close();
    if (active) {
      this.retryCount = 0;
      this.open();
    }
  }
  retry() {
    this.close();
    if (this.active) {
      this.retryCount = 0;
      this.open();
    }
  }
  close() {
    this.generation++;
    if (this.retryTimer !== null) this.cancelSchedule(this.retryTimer);
    if (this.snapshotTimer !== null) this.cancelSchedule(this.snapshotTimer);
    this.retryTimer = null;
    this.snapshotTimer = null;
    this.source?.close();
    this.source = null;
  }
  open({ retrying = false } = {}) {
    const generation = this.generation;
    if (!retrying) this.onChange({ state: "loading", rooms: [] });
    let approved;
    const offline = (message) => {
      const trustURL = approved && approved !== new URL(this.pageURL).origin && approved.startsWith("https:")
        ? new URL("/api/health", approved).href : null;
      this.onChange({ state: "offline", rooms: [], message, trustURL });
    };
    const isCurrent = (source) => this.active && generation === this.generation && source === this.source;
    const clearSnapshotTimer = () => {
      if (this.snapshotTimer !== null) this.cancelSchedule(this.snapshotTimer);
      this.snapshotTimer = null;
    };
    const failed = (message, source) => {
      if (!isCurrent(source)) return;
      clearSnapshotTimer();
      source.close();
      this.source = null;
      if (this.retryCount < this.retryDelays.length) {
        this.retryCount++;
        const attempt = this.retryCount;
        this.onChange({
          state: "loading",
          rooms: [],
          message: "实时房间列表连接失败，正在自动重试（" + attempt + "/" + this.retryDelays.length + "）…",
        });
        const delay = this.retryDelays[attempt - 1];
        this.retryTimer = this.schedule(() => {
          this.retryTimer = null;
          if (this.active && generation === this.generation && this.source === null)
            this.open({ retrying: true });
        }, delay);
      } else {
        offline(message + " 已自动重试 " + this.retryDelays.length + " 次仍无法连接。你可以刷新连接或尝试快速加入。");
      }
    };
    try {
      approved = apiOrigin(this.origin, this.pageURL);
      if (typeof this.EventSource !== "function") {
        offline("当前浏览器不支持实时房间列表。");
        return;
      }
      const source = new this.EventSource(new URL("/api/rooms/events", approved).href, { withCredentials: false });
      this.source = source;
      this.snapshotTimer = this.schedule(() => {
        this.snapshotTimer = null;
        failed("等待房间列表超时。", source);
      }, this.firstSnapshotTimeoutMs);
      source.addEventListener("rooms", (event) => {
        if (!isCurrent(source)) return;
        try {
          const data = JSON.parse(event.data);
          if (data?.type !== "rooms" || !Array.isArray(data.rooms) || !data.rooms.every((room) =>
            room && /^[A-F0-9]{8}$/.test(room.room) && typeof room.hostName === "string" &&
            ["lobby", "countdown", "live", "over"].includes(room.phase) && Number.isInteger(room.capacity) && room.capacity > 0 && room.capacity <= 255 &&
            Number.isInteger(room.humans) && room.humans > 0 && room.humans <= room.capacity &&
            Number.isInteger(room.bots) && room.bots >= 0 && room.bots <= room.capacity && typeof room.joinable === "boolean" &&
            (room.mapId === undefined || /^[a-z0-9][a-z0-9_-]{0,31}$/.test(room.mapId)) &&
            (room.modeId === undefined || /^[a-z0-9][a-z0-9_-]{0,31}$/.test(room.modeId))
          )) throw Error("房间列表数据无效，请重试。");
          clearSnapshotTimer();
          this.retryCount = 0;
          this.onChange({ state: "ready", rooms: data.rooms });
        } catch (error) {
          failed(error.message, source);
        }
      });
      source.addEventListener("error", () => {
        failed("实时列表连接中断。", source);
      });
    } catch (error) {
      offline(error.message);
    }
  }
}
