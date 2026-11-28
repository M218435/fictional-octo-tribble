// Coalesce repeated reliable room events while a map is downloading. A leave
// aborts that generation so a late download cannot mount over the main menu.
export class RoomContent {
  constructor() { this.controller = null; this.request = null; this.key = null; }
  reset() {
    this.controller?.abort();
    this.controller = null;
    this.request = null;
    this.key = null;
  }
  prepare(key, load) {
    if (this.key === key && this.request) return this.request;
    this.reset();
    this.key = key;
    const controller = this.controller = new AbortController();
    const request = Promise.resolve().then(() => load(controller.signal));
    this.request = request;
    request.catch(() => { if (this.request === request) this.reset(); });
    return request;
  }
}
