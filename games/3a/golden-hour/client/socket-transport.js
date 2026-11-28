// A browser WebSocket carries the same reliable JSON and binary state frames.
export class SocketTransport {
  constructor(url) {
    const socket = this.socket = new WebSocket(url, "gh-pvp-v1");
    socket.binaryType = "arraybuffer";
    this.closed = new Promise(resolve => { this.finish = resolve; });
    this.ready = new Promise((resolve, reject) => {
      this.rejectReady = reject;
      socket.addEventListener("open", () => {
        if (socket.protocol === "gh-pvp-v1") resolve();
        else this.close();
      }, { once: true });
    });
    this.ready.catch(() => {});
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    let events, snapshots;
    const writer = (text) => ({
      write: async bytes => {
        if (socket.readyState !== WebSocket.OPEN) throw Error("备用连接已关闭。");
        if (socket.bufferedAmount + bytes.byteLength > (text ? 65536 : 8192)) {
          if (!text) return false;
          throw Error("备用连接发送队列已满。");
        }
        socket.send(text ? decoder.decode(bytes) : bytes);
        return true;
      },
    });
    this.stream = {
      readable: new ReadableStream({ start(controller) { events = controller; } }, { highWaterMark: 128 }),
      writable: { getWriter: () => writer(true) },
    };
    this.datagrams = {
      readable: new ReadableStream({ start(controller) { snapshots = controller; } }, { highWaterMark: 1 }),
      writable: { getWriter: () => writer(false) },
    };
    this.controllers = [events, snapshots];
    socket.addEventListener("message", ({ data }) => {
      if (!this.controllers) return;
      if (typeof data === "string") {
        if (data.length > 16384 || events.desiredSize <= 0) return this.close();
        events.enqueue(encoder.encode(data));
      } else if (data instanceof ArrayBuffer && data.byteLength <= 1200 && snapshots.desiredSize > 0) {
        snapshots.enqueue(new Uint8Array(data));
      }
    });
    for (const event of ["close", "error"]) socket.addEventListener(event, () => this.close(), { once: true });
  }
  async createBidirectionalStream() { return this.stream; }
  close() {
    if (!this.controllers) return;
    for (const controller of this.controllers) controller.close();
    this.controllers = null;
    this.rejectReady(Error("备用连接未能打开。"));
    this.finish();
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}
