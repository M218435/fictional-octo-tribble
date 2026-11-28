const KEY = "gh-runtime-diagnostics-v1";
const MAX_EVENTS = 12;
const MAX_SAMPLES = 10;
const LIMIT = 16384;
const shorten = (value, length = 240) => String(value ?? "").slice(0, length);

// Small local breadcrumbs survive a reload; they cannot prove an OS memory
// kill. Never capture room tokens, player identity, URLs or cloud progress.
export function installRuntimeDiagnostics({ win = window, doc = document, version, profile,
  now = () => Date.now(), storage } = {}) {
  if (storage === undefined) {
    try { storage = win.localStorage; } catch { storage = null; }
  }
  let previous = null;
  try {
    const raw = storage?.getItem(KEY);
    if (raw && raw.length <= LIMIT) {
      const parsed = JSON.parse(raw);
      if (parsed?.schema === 1) previous = parsed;
    }
  } catch {}
  const state = { schema: 1, version: shorten(version, 64), profile,
    startedAt: now(), updatedAt: now(), lifecycle: "loading",
    discarded: !!doc.wasDiscarded, events: [], samples: [] };
  let writtenAt = -Infinity, sampledAt = -Infinity, disposed = false;
  const persist = (force = false) => {
    if (disposed || (!force && now() - writtenAt < 1000)) return;
    writtenAt = now();
    state.updatedAt = writtenAt;
    try { storage?.setItem(KEY, JSON.stringify(state)); } catch {}
  };
  const record = (type, detail = "") => {
    const message = shorten(detail);
    const last = state.events.at(-1);
    if (last?.type === type && last.detail === message) last.count++;
    else {
      state.events.push({ at: now(), type, detail: message, count: 1 });
      if (state.events.length > MAX_EVENTS) state.events.shift();
    }
    persist();
  };
  const listen = (target, type, callback, capture = false) => {
    target.addEventListener(type, callback, capture);
    return () => target.removeEventListener(type, callback, capture);
  };
  const remove = [
    listen(win, "error", event => record("error", event.message || "Resource load failed"), true),
    listen(win, "unhandledrejection", event => record("rejection", event.reason?.message || event.reason)),
    listen(doc, "webglcontextlost", () => record("webgl-lost"), true),
    listen(doc, "webglcontextrestored", () => record("webgl-restored"), true),
    listen(doc, "visibilitychange", () => {
      state.lifecycle = doc.hidden ? "hidden" : "active";
      persist(true);
    }),
    listen(win, "pagehide", event => {
      state.lifecycle = event.persisted ? "suspended" : "closed";
      persist(true);
    }),
    listen(win, "pageshow", () => { state.lifecycle = "active"; persist(true); }),
  ];
  persist(true);
  return {
    record,
    sample(value) {
      if (disposed || doc.hidden || now() - sampledAt < 15000) return;
      sampledAt = now();
      const numeric = key => Number.isFinite(value[key]) ? Math.round(value[key]) : null;
      state.samples.push({ at: now(), mode: shorten(value.mode, 20), quality: shorten(value.quality, 10),
        fps: numeric("fps"), heapBytes: numeric("heapBytes"), geometries: numeric("geometries"),
        textures: numeric("textures"), programs: numeric("programs"), actors: numeric("actors"),
        physicsBodies: numeric("physicsBodies"), contextLosses: numeric("contextLosses"),
        queuedCommands: numeric("queuedCommands"), inputDropped: numeric("inputDropped") });
      if (state.samples.length > MAX_SAMPLES) state.samples.shift();
      if (state.lifecycle === "loading") state.lifecycle = "active";
      persist();
    },
    report() { return structuredClone({ current: state, previous }); },
    dispose() { persist(true); disposed = true; remove.forEach(fn => fn()); },
  };
}
