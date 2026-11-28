import { rtcSignalingURL } from "./api-config.js";

// Present the same two lanes as WebTransport so prediction, rooms and combat
// share one protocol. ICE/DTLS/SCTP connect to the Go server, never a peer player.
export class RTCTransport {
  constructor(config) {
    this.abort = new AbortController();
    this.closed = new Promise((resolve) => { this.finish = resolve; });
    this.pc = new RTCPeerConnection({ iceServers: config.iceServers || [] });
    try {
      this.reliable = this.pc.createDataChannel("reliable", { ordered: true, protocol: "gh-pvp-v1" });
      this.state = this.pc.createDataChannel("state", { ordered: false, maxRetransmits: 0, protocol: "gh-pvp-v1" });
    } catch (error) { this.pc.close(); throw error; }
    this.reliable.binaryType = this.state.binaryType = "arraybuffer";
    let events, snapshots;
    this.stream = { readable: new ReadableStream({ start(controller) { events = controller; } }, { highWaterMark: 128 }) };
    this.datagrams = { readable: new ReadableStream({ start(controller) { snapshots = controller; } }, { highWaterMark: 1 }) };
    this.controllers = [events, snapshots];
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    this.reliable.addEventListener("message", ({ data }) => {
      if (this.abort.signal.aborted) return;
      const bytes = typeof data === "string" ? encoder.encode(data) : new Uint8Array(data);
      if (bytes.byteLength > 16384 || events.desiredSize <= 0) { this.close(); return; }
      events.enqueue(bytes);
    });
    this.state.addEventListener("message", ({ data }) => {
      if (this.abort.signal.aborted || !(data instanceof ArrayBuffer) || data.byteLength > 1200) return;
      if (snapshots.desiredSize > 0) snapshots.enqueue(new Uint8Array(data));
    });
    const writer = (channel, text) => ({
      write: async (bytes) => {
        if (channel.readyState !== "open") throw Error("WebRTC 连接已关闭。");
        if (channel.bufferedAmount + bytes.byteLength > (text ? 65536 : 8192)) {
          if (!text) return false;
          throw Error("WebRTC 发送队列已满。");
        }
        channel.send(text ? decoder.decode(bytes) : bytes);
        return true;
      },
    });
    this.stream.writable = { getWriter: () => writer(this.reliable, true) };
    this.datagrams.writable = { getWriter: () => writer(this.state, false) };
    for (const channel of [this.reliable, this.state]) {
      channel.addEventListener("close", () => this.close());
      channel.addEventListener("error", () => this.close());
    }
    this.pc.addEventListener("connectionstatechange", () => {
      if (["failed", "closed"].includes(this.pc.connectionState)) this.close();
    });
    this.pc.addEventListener("iceconnectionstatechange", () => {
      if (this.pc.iceConnectionState === "disconnected") {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = setTimeout(() => {
          if (this.pc.iceConnectionState === "disconnected") this.close();
        }, 3000);
      }
    });
    this.ready = this.connect(config).catch(error => { this.close(); throw error; });
    this.ready.catch(() => {});
  }
  async until(target, event, test, partial) {
    if (this.abort.signal.aborted) throw Error("连接已取消。");
    if (test()) return;
    await new Promise((resolve, reject) => {
      let allowPartial = false;
      const done = () => {
        if (test() || (allowPartial && partial.usable())) { cleanup(); resolve(); }
      };
      const aborted = () => { cleanup(); reject(Error("连接已取消。")); };
      const cleanup = () => {
        clearTimeout(timer);
        target.removeEventListener(event, done);
        if (partial) target.removeEventListener(partial.event, done);
        this.abort.signal.removeEventListener("abort", aborted);
      };
      const timer = partial ? setTimeout(() => { allowPartial = true; done(); }, partial.afterMs) : null;
      target.addEventListener(event, done);
      if (partial) target.addEventListener(partial.event, done);
      this.abort.signal.addEventListener("abort", aborted, { once: true });
      done();
    });
  }
  async connect(config) {
    const url = rtcSignalingURL(config, location.href);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    // Some WebKit builds wait for the answer before reporting ICE complete,
    // even after STUN has discovered an address usable with the game server.
    await this.until(this.pc, "icegatheringstatechange", () => this.pc.iceGatheringState === "complete", {
      event: "icecandidate",
      afterMs: 2000,
      usable: () => /^a=candidate:.*\btyp (?:srflx|relay)\b/m.test(this.pc.localDescription?.sdp || ""),
    });
    // Approval is bound by the config loader, never read from remote JSON.
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.pc.localDescription), signal: this.abort.signal,
      cache: "no-store",
      credentials: "omit", redirect: "error",
    });
    if (!response.ok) throw Error("WebRTC 服务连接失败，请稍后重试。");
    await this.pc.setRemoteDescription(await response.json());
    await Promise.all([this.reliable, this.state].map(channel => this.until(channel, "open", () => channel.readyState === "open")));
  }
  createBidirectionalStream() { return Promise.resolve(this.stream); }
  close() {
    if (this.abort.signal.aborted) return;
    this.abort.abort();
    clearTimeout(this.disconnectTimer);
    for (const controller of this.controllers) { try { controller.close(); } catch {} }
    try { this.pc.close(); } finally { this.finish(); }
  }
}
