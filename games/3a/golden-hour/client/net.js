import { RTCTransport } from "./webrtc.js";
import { SocketTransport } from "./socket-transport.js";
import { socketURL } from "./api-config.js";

const PHASES = ["lobby", "countdown", "live", "over"];
export const WEAPONS = ["ar", "smg", "shotgun", "pistol", "m200", "rpk"];
const INPUT_BYTES = 25;
const INPUT_MAGIC = 0x4748;
const MAX_RELIABLE_COMMANDS = 128;
const MAX_RELIABLE_BYTES = 65536;
const MOTION_FIELDS = ["x", "y", "z", "vx", "vy", "vz", "yaw", "pitch"];
const COUNTER_FIELDS = [
  "hp",
  "ammo",
  "reserve",
  "kills",
  "deaths",
  "score",
  "respawn",
  "reload",
];

async function deadline(operation, timeout, message, signal) {
  if (signal?.aborted) throw Error("连接已取消。");
  let timer, abort;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(message)), timeout);
        if (signal) {
          abort = () => reject(Error("连接已取消。"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}

// Movement datagrams are fixed-size binary packets. This removes JSON parsing
// and UTF-8 allocation from the 30 Hz input path while the server still accepts
// JSON for older clients during rolling upgrades.
export function encodeInput(input, bytes = new Uint8Array(INPUT_BYTES)) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(0, INPUT_MAGIC, true);
  view.setUint8(2, 1);
  view.setUint8(3, 1);
  view.setUint32(4, input.seq >>> 0, true);
  view.setFloat32(8, input.forward ?? 0, true);
  view.setFloat32(12, input.right ?? 0, true);
  view.setFloat32(16, input.yaw ?? 0, true);
  view.setFloat32(20, input.pitch ?? 0, true);
  view.setUint8(24, input.buttons || 0);
  return bytes;
}
export function decodeSnapshot(bytes) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  if (bytes.byteLength < 24) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = v.getUint8(3);
  if (
    v.getUint16(0, true) !== 0x4748 ||
    v.getUint8(2) !== 1 ||
    (kind !== 2 && kind !== 4)
  )
    return null;
  const count = v.getUint8(13);
  const zombieCount = v.getUint8(23);
  const playerEnd = 24 + 64 * count;
  const zombieEnd = playerEnd + 14 * zombieCount;
  const hasShotAcks = kind === 4;
  if (count > 10 || zombieCount > 16 || (zombieCount && (count > 4 || v.getUint8(12) !== 2)) ||
      bytes.byteLength !== zombieEnd + (hasShotAcks ? 4 * count : 0) || v.getUint8(12) > 3)
    return null;
  const out = {
    tick: v.getUint32(4, true),
    time: v.getUint32(8, true),
    phase: PHASES[v.getUint8(12)],
    scores: [v.getUint16(14, true), v.getUint16(16, true)],
    remaining: v.getUint32(18, true),
    winner: v.getInt8(22),
    players: [],
  };
  for (let i = 0; i < count; i++) {
    const o = 24 + i * 64,
      flags = v.getUint8(o + 57);
    const p = { id: v.getUint32(o, true), ack: v.getUint32(o + 4, true) };
    for (let j = 0; j < MOTION_FIELDS.length; j++) {
      const key = MOTION_FIELDS[j];
      p[key] = v.getFloat32(o + 8 + j * 4, true);
      if (!Number.isFinite(p[key])) return null;
    }
    for (let j = 0; j < COUNTER_FIELDS.length; j++)
      p[COUNTER_FIELDS[j]] = v.getUint16(o + 40 + j * 2, true);
    p.team = v.getUint8(o + 56);
    p.alive = !!(flags & 1);
    p.crouch = !!(flags & 2);
    p.ground = !!(flags & 4);
    p.connected = !!(flags & 8);
    p.protected = !!(flags & 16);
    p.jumpHeld = !!(flags & 32);
    p.bot = !!(flags & 64);
    p.sliding = !!(flags & 128);
    p.weapon = WEAPONS[v.getUint8(o + 58)];
    p.slideCooldown = v.getUint8(o + 59) / 100;
    p.cooldown = v.getUint16(o + 60, true);
    p.slideTime = v.getUint16(o + 62, true) / 1000;
    if (hasShotAcks) p.shotAck = v.getUint32(zombieEnd + 4 * i, true);
    if (p.team > 1 || !p.weapon) return null;
    out.players.push(p);
  }
  if (zombieCount) {
    out.zombies = [];
    const ids = new Set();
    for (let i = 0; i < zombieCount; i++) {
      const o = playerEnd + i * 14;
      const id = v.getUint32(o, true), kind = v.getUint8(o + 12), flags = v.getUint8(o + 13);
      if (id < 0x80000000 || ids.has(id) || kind > 2 || flags > 3) return null;
      ids.add(id);
      out.zombies.push({
        id, kind, x: v.getInt16(o + 4, true) / 100, y: v.getInt16(o + 6, true) / 100,
        z: v.getInt16(o + 8, true) / 100, yaw: v.getInt16(o + 10, true) * Math.PI / 32767,
        moving: !!(flags & 1), attacking: !!(flags & 2),
      });
    }
  }
  return out;
}
export function decodeCosmeticEvent(bytes) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  if (bytes.byteLength !== 36) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(0, true) !== 0x4748 || v.getUint8(2) !== 1 || v.getUint8(3) !== 3) return null;
  const id = v.getUint32(4, true), weapon = WEAPONS[v.getUint8(8)];
  if (!id || !weapon) return null;
  const values = [];
  for (let offset = 12; offset < 36; offset += 4) {
    const value = v.getFloat32(offset, true);
    if (!Number.isFinite(value)) return null;
    values.push(value);
  }
  return { type: "shot", id, weapon,
    x: values[0], y: values[1], z: values[2], dx: values[3], dy: values[4], dz: values[5] };
}

export class Connection extends EventTarget {
  constructor({ connectTimeoutMs = 12000, leaveTimeoutMs = 500, writeTimeoutMs = 5000, snapshotTimeoutMs = 5000 } = {}) {
    super();
    this.connectTimeoutMs = connectTimeoutMs;
    this.leaveTimeoutMs = leaveTimeoutMs;
    this.writeTimeoutMs = writeTimeoutMs;
    this.snapshotTimeoutMs = snapshotTimeoutMs;
    this.generation = 0;
    this.intentional = true;
    this.sendChain = Promise.resolve();
    this.sendQueue = { count: 0, bytes: 0, abort: new AbortController() };
    this.inputFlight = null;
    this.retry = 0;
    this.latestTick = 0;
    this.inputBytes = new Uint8Array(INPUT_BYTES);
    this.metrics = {
      inputPackets: 0,
      inputBytes: 0,
      inputDropped: 0,
      snapshots: 0,
      snapshotBytes: 0,
      ack: 0,
      rttMs: 0,
      queuedCommands: 0,
      queuedBytes: 0,
      snapshotAgeMs: 0,
      snapshotGaps: 0,
    };
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  checkSupport() {
    if (![globalThis.WebTransport, globalThis.RTCPeerConnection, globalThis.WebSocket].some(transport => typeof transport === "function"))
      throw Error(
        "当前浏览器不支持联机连接，请更新浏览器后重试。",
      );
    if (!globalThis.isSecureContext)
      throw Error("联机需要 HTTPS。开发时请使用本机 localhost 地址。");
  }
  async connect(hello, config) {
    this.checkSupport();
    const rtc = config.rtc && typeof globalThis.RTCPeerConnection === "function";
    const socket = typeof globalThis.WebSocket === "function" && socketURL(config);
    const preferRTC = rtc && config.preferredTransport === "webrtc";
    const kinds = [];
    const resumeSocket = hello.resume && this.metrics.transport === "websocket" && socket;
    if (resumeSocket) kinds.push("websocket");
    if (typeof globalThis.WebTransport === "function" && !preferRTC) kinds.push("webtransport");
    if (rtc) kinds.push("webrtc");
    if (socket && !resumeSocket) kinds.push("websocket");
    if (!kinds.length) throw Error("当前服务器和浏览器没有可用的联机协议。");
    for (const [index, kind] of kinds.entries()) {
      const attempt = this.generation + 1;
      const joining = this.hello?.resume && index ? this.hello : hello;
      try {
        await this.connectAttempt(joining, config, kind);
        return;
      } catch (error) {
        if (index === kinds.length - 1 || this.generation !== attempt + 1 || error.application || this.intentional) throw error;
        this.emit("status", "正在切换备用连接…");
      }
    }
  }
  async connectAttempt(hello, config, kind) {
    clearInterval(this.watchdog);
    this.sendQueue.abort.abort();
    this.intentional = false;
    this.hello = { ...hello, weaponProtocol: 2 };
    this.config = config;
    const generation = ++this.generation;
    this.emit("status", "正在连接服务器…");
    const options = {};
    if (config.certificateHash) {
      options.serverCertificateHashes = [
        {
          algorithm: "sha-256",
          value: Uint8Array.from(atob(config.certificateHash), (c) =>
            c.charCodeAt(0),
          ),
        },
      ];
    }
    let wt;
    const current = () => {
      if (generation !== this.generation) throw Error("连接已取消。");
    };
    try {
      if (kind === "webrtc") wt = new RTCTransport(config.rtc);
      else if (kind === "websocket") wt = new SocketTransport(socketURL(config));
      else wt = new WebTransport(config.url, options);
      this.transport = wt;
      wt.closed.catch(() => {});
      // One deadline covers TLS, stream creation, the hello write and welcome.
      // Some browsers can leave stream creation or a write pending indefinitely.
      await deadline(async () => {
        await wt.ready;
        current();
        this.emit("status", "正在建立对战连接…");
        const stream = await wt.createBidirectionalStream();
        current();
        this.writer = stream.writable.getWriter();
        // Safari implements the newer createWritable() API; Chromium also
        // exposes the original writable stream. Both carry QUIC datagrams.
        const outgoing = wt.datagrams.writable ?? wt.datagrams.createWritable?.();
        if (!outgoing?.getWriter)
          throw Error("当前浏览器缺少 WebTransport 数据报支持，请更新浏览器后重试。");
        this.datagrams = outgoing.getWriter();
        // A pending write belongs to its old transport. Reconnection must not
        // share its input buffer or let that write block the new input lane.
        this.inputBytes = new Uint8Array(INPUT_BYTES);
        this.inputFlight = null;
        this.sendChain = Promise.resolve();
        this.sendQueue = { count: 0, bytes: 0, abort: new AbortController() };
        const accepted = new Promise((resolve, reject) => {
          this.handshake = { generation, resolve, reject };
        });
        accepted.catch(() => {});
        this.readEvents(stream.readable, generation);
        this.readSnapshots(wt.datagrams.readable, generation);
        this.emit("status", "正在加入房间…");
        await this.send({ ...this.hello, type: "hello", cosmeticDatagrams: true, shotAcks: true });
        await accepted;
        current();
      }, this.connectTimeoutMs, "连接超时，请稍后重试。");
      this.handshake = null;
      this.retry = 0;
      this.metrics.transport = kind;
      this.lastSnapshotAt = performance.now();
      this.watchdog = setInterval(() => {
        if (generation !== this.generation || this.intentional) return;
        this.metrics.snapshotAgeMs = Math.round(performance.now() - this.lastSnapshotAt);
        if (this.metrics.snapshotAgeMs > this.snapshotTimeoutMs) this.fail(generation);
      }, Math.min(1000, this.snapshotTimeoutMs));
      this.watchdog.unref?.();
      this.emit("status", "已连接");
      wt.closed.then(
        () => this.closed(generation),
        () => this.closed(generation),
      );
    } catch (error) {
      if (generation === this.generation) {
        this.generation++;
        clearInterval(this.watchdog);
        this.sendQueue.abort.abort();
        this.handshake?.reject(error);
        this.handshake = null;
        this.writer = null;
        this.datagrams = null;
        this.transport = null;
        this.sendChain = Promise.resolve();
      }
      try { wt?.close(); } catch {}
      throw error;
    }
  }
  send(message) {
    if (!this.writer) return Promise.reject(Error("尚未连接服务器"));
    const writer = this.writer,
      generation = this.generation,
      queue = this.sendQueue;
    // Check command count before serializing: a stalled reliable stream must
    // not retain an unbounded promise chain and command payloads while firing.
    if (queue.count >= MAX_RELIABLE_COMMANDS) {
      this.fail(generation);
      return Promise.reject(Error("发送队列已满，正在恢复连接。"));
    }
    const data = new TextEncoder().encode(JSON.stringify(message) + "\n");
    if (data.byteLength > 16384 || queue.bytes + data.byteLength > MAX_RELIABLE_BYTES) {
      this.fail(generation);
      return Promise.reject(Error("发送队列已满，正在恢复连接。"));
    }
    queue.count++;
    queue.bytes += data.byteLength;
    this.metrics.queuedCommands = queue.count;
    this.metrics.queuedBytes = queue.bytes;
    const next = this.sendChain.then(() => {
      if (generation !== this.generation || writer !== this.writer)
        throw Error("连接已取消。");
      return deadline(() => writer.write(data), this.writeTimeoutMs, "发送超时，正在恢复连接。", queue.abort.signal);
    });
    const release = () => {
      queue.count--; queue.bytes -= data.byteLength;
      if (queue === this.sendQueue) {
        this.metrics.queuedCommands = queue.count;
        this.metrics.queuedBytes = queue.bytes;
      }
    };
    next.then(release, () => {
      release();
      if (generation === this.generation && writer === this.writer)
        this.fail(generation);
    });
    this.sendChain = next.catch(() => {});
    return next;
  }
  async input(input) {
    if (!this.datagrams) return;
    if (this.inputFlight) {
      this.metrics.inputDropped++;
      return;
    }
    const flight = { writer: this.datagrams, generation: this.generation };
    this.inputFlight = flight;
    try {
      // One write in flight: reuse storage only after the stream consumes it.
      const bytes = encodeInput(input, this.inputBytes);
      const sent = await deadline(() => flight.writer.write(bytes), this.writeTimeoutMs,
        "输入发送超时。", this.sendQueue.abort.signal);
      if (flight.generation === this.generation) {
        if (sent === false) this.metrics.inputDropped++;
        else {
          this.metrics.inputPackets++;
          this.metrics.inputBytes += INPUT_BYTES;
        }
      }
    } catch {
      if (flight.generation === this.generation && flight.writer === this.datagrams)
        this.fail(flight.generation);
    } finally {
      if (this.inputFlight === flight) this.inputFlight = null;
    }
  }
  async readEvents(readable, generation) {
    const reader = readable.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    try {
      while (generation === this.generation) {
        const { value, done } = await reader.read();
        if (done || generation !== this.generation || this.failedGeneration === generation) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 65536) throw Error("可靠流消息过大");
        let n;
        while ((n = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, n);
          buffer = buffer.slice(n + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === "pong" && Number.isFinite(e.nonce))
            this.metrics.rttMs = Math.round(performance.now() - e.nonce);
          if (e.type === "welcome") {
            this.hello = {
              ...this.hello,
              create: false,
              quick: false,
              room: e.room,
              resume: e.resume,
            };
            this.id = e.id;
            this.latestTick = 0;
            this.handshake?.resolve();
          }
          if (e.type === "error" && this.handshake?.generation === generation) {
            const error = Error(e.message);
            error.application = true;
            this.handshake.reject(error);
          }
          if (e.type === "left") this.leftResolve?.();
          this.emit("event", e);
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.handshake?.reject(error);
        this.emit("error", error.message);
      }
    } finally {
      if (this.handshake?.generation === generation)
        this.handshake.reject(Error("服务器在加入房间前关闭了连接。"));
      reader.releaseLock();
      if (generation === this.generation && !this.intentional)
        this.fail(generation);
    }
  }
  async readSnapshots(readable, generation) {
    const reader = readable.getReader();
    try {
      while (generation === this.generation) {
        const { value, done } = await reader.read();
        if (done || generation !== this.generation || this.failedGeneration === generation) break;
        const cosmetic = decodeCosmeticEvent(value);
        if (cosmetic) {
          this.emit("event", cosmetic);
          continue;
        }
        const snapshot = decodeSnapshot(value);
        if (snapshot && snapshot.tick > this.latestTick) {
          if (this.latestTick) this.metrics.snapshotGaps += Math.max(0, Math.floor((snapshot.tick - this.latestTick) / 2) - 1);
          this.lastSnapshotAt = performance.now();
          this.metrics.snapshotAgeMs = 0;
          this.metrics.snapshots++;
          this.metrics.snapshotBytes += value.byteLength;
          this.metrics.ack =
            snapshot.players.find((p) => p.id === this.id)?.ack || 0;
          this.latestTick = snapshot.tick;
          this.emit("snapshot", snapshot);
        }
      }
    } catch {
    } finally {
      reader.releaseLock();
      if (generation === this.generation && !this.intentional)
        this.fail(generation);
    }
  }
  fail(generation) {
    if (generation !== this.generation || this.intentional || this.failedGeneration === generation) return;
    const transport = this.transport;
    if (this.handshake?.generation === generation)
      this.handshake.reject(Error("连接通道已中断。"));
    else this.closed(generation);
    try { transport?.close(); } catch {}
  }
  closed(generation) {
    if (generation !== this.generation || this.intentional || this.failedGeneration === generation) return;
    this.failedGeneration = generation;
    clearInterval(this.watchdog);
    this.sendQueue.abort.abort();
    this.writer = null;
    this.datagrams = null;
    this.inputFlight = null;
    this.emit("status", "连接中断，正在恢复");
    if (!this.hello?.resume) {
      this.emit("error", "连接已关闭，请重新加入。");
      return;
    }
    this.reconnect(generation);
  }
  async reconnect(generation) {
    if (this.retry >= 4) {
      this.emit("error", "恢复连接失败，请重新加入房间。");
      return;
    }
    const delay = Math.min(4000, 500 * 2 ** this.retry++);
    await new Promise((r) => setTimeout(r, delay));
    if (this.intentional || generation !== this.generation) return;
    try {
      await this.connect(this.hello, this.config);
    } catch (error) {
      this.emit("status", error.message);
      this.reconnect(this.generation);
    }
  }
  async leave() {
    this.intentional = true;
    clearInterval(this.watchdog);
    if (this.writer) {
      const accepted = new Promise((resolve) => {
        this.leftResolve = resolve;
      });
      try {
        await deadline(async () => {
          await this.send({ type: "leave" });
          await accepted;
        }, this.leaveTimeoutMs, "退出房间超时。");
      } catch {}
    }
    this.leftResolve = null;
    this.generation++;
    this.sendQueue.abort.abort();
    try { this.transport?.close(); } catch {}
    this.transport = null;
    this.writer = null;
    this.datagrams = null;
    this.id = null;
    this.hello = null;
    this.sendChain = Promise.resolve();
    this.sendQueue = { count: 0, bytes: 0, abort: new AbortController() };
    this.inputFlight = null;
    this.metrics.queuedCommands = this.metrics.queuedBytes = 0;
    this.metrics.transport = null;
  }
}
