// Reliable, bounded pane state; never infer permanent destruction from a
// cosmetic shot. Native glass supplies the meshes, shards, sounds and cascade.
export function glassCollider(p) {
  return { min: p.axis === 0 ? [p.pos - .035, p.y0, p.a0] : [p.a0, p.y0, p.pos - .035],
    max: p.axis === 0 ? [p.pos + .035, p.y1, p.a1] : [p.a1, p.y1, p.pos + .035],
    noMove: false, noRay: true, surf: 'glass', paneId: p.id };
}
export function validGlass(defs = []) {
  return Array.isArray(defs) && defs.length <= 512 && defs.every((p, i) => p && p.id === i &&
    [0, 2].includes(p.axis) && [p.pos, p.a0, p.a1, p.y0, p.y1].every(v => Number.isFinite(v) && Math.abs(v) <= 10000) &&
    p.a1 > p.a0 && p.y1 > p.y0 && ['frame', 'bottom'].includes(p.support) &&
    Number.isInteger(p.nx) && Number.isInteger(p.ny) && p.nx >= 2 && p.ny >= 2 && p.nx <= 128 && p.ny <= 128 && p.nx * p.ny <= 4096) &&
    defs.reduce((n, p) => n + p.nx * p.ny, 0) <= 65536;
}

export class OnlineGlass {
  constructor(native, THREE) {
    this.native = native; this.THREE = THREE; this.states = new Map();
    this.round = -1; this.revision = -1; this.defs = []; this.boxes = [];
    if (!native) return;
    this.original = Object.fromEntries(['hit', 'shatter', 'bodyHit', 'blast'].map(key => [key, native[key]]));
    this.visible = [native.intact?.visible, native.shards?.visible];
    // Props/ragdolls may touch glass locally, but cannot change a room's state.
    native.hit = native.shatter = native.blast = () => {};
    native.bodyHit = pane => !!(pane.gone || pane.col.off);
    native.reset();
  }
  begin(round) {
    this.round = round; this.revision = -1; this.states.clear();
    this.resetRendering();
  }
  resetRendering() {
    this.native?.reset();
    for (const box of this.boxes) box.noMove = false;
  }
  receive(e, audible = false) {
    if (e.type === 'room') {
      const key = `${e.room}:${e.mapId}@${e.mapVersion}`;
      if (key !== this.key) { this.key = key; this.begin(e.round || 0); }
      else if (e.round > this.round) this.begin(e.round);
      if (e.round < this.round || !e.glass || e.glass.revision < this.revision) return;
      this.revision = e.glass.revision;
      for (const state of e.glass.panes || []) this.accept(state, false);
    } else if (e.type === 'round-start' && e.round > this.round) {
      this.begin(e.round);
    } else if (e.type === 'glass' && e.round === this.round && e.revision > this.revision) {
      this.revision = e.revision; this.accept(e.pane, audible, e);
    }
  }
  attach(room, defs, boxes) {
    this.receive(room); this.defs = defs; this.boxes = boxes;
    // The native hotel is currently the only map with authored glass.
    this.renderable = room.mapId === 'hotel' && this.native?.panes.length === defs.length &&
      defs.every((d, i) => ['axis', 'pos', 'a0', 'a1', 'y0', 'y1', 'nx', 'ny'].every(k => Math.abs(d[k] - this.native.panes[i][k]) < 1e-6));
    this.resetRendering();
    if (this.native) {
      this.native.intact.visible = !!this.renderable;
      this.native.shards.visible = !!this.renderable;
    }
    for (const state of this.states.values()) this.render(state, false);
  }
  accept(state, audible, impact) {
    if (!state || !Number.isInteger(state.id) || state.id < 0 || state.id >= 512 || typeof state.broken !== 'boolean') return;
    const old = this.states.get(state.id);
    this.states.set(state.id, state);
    if (old?.broken === state.broken && old?.mask === state.mask) return;
    this.render(state, audible, impact);
  }
  render(state, audible, impact = {}) {
    const def = this.defs[state.id], box = this.boxes[state.id];
    if (!def || !box) return;
    let mask;
    if (!state.broken) {
      try { mask = Uint8Array.from(atob(state.mask), c => c.charCodeAt(0)); } catch { return; }
      if (mask.length !== Math.ceil(def.nx * def.ny / 8)) return;
    }
    box.noMove = state.broken;
    if (!this.renderable) return;
    const g = this.native, p = g.panes[state.id];
    const a = Number.isFinite(impact.a) ? impact.a : (p.a0 + p.a1) / 2;
    const y = Number.isFinite(impact.y) ? impact.y : (p.y0 + p.y1) / 2;
    const dir = new this.THREE.Vector3(...(Array.isArray(impact.dir) && impact.dir.every(Number.isFinite) ? impact.dir : [0, 0, 1]));
    if (state.broken) {
      if (audible) this.original.shatter.call(g, p, a, y, dir, impact.radius > 0 ? .5 : impact.power || 1);
      else {
        if (p.mesh) { g.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh = null; }
        p.gone = true; p.cascade = null; p.col.off = true; p.count = 0;
        g.intact.setMatrixAt(p.id, new this.THREE.Matrix4().makeScale(0, 0, 0));
        g.intact.instanceMatrix.needsUpdate = true;
      }
      return;
    }
    if (p.gone || p.cascade) return;
    g._ensure(p);
    const radius = impact.radius || 0, power = impact.power || 1, speed = 2.2 + 2.2 * power;
    for (let i = 0; i < p.total; i++) {
      if ((mask[i >> 3] & (1 << (i & 7))) && p.alive[i]) {
        if (audible) g._breakCell(p, i, dir.x * speed, dir.y * speed * .5, dir.z * speed, 1.2);
        else { p.alive[i] = 0; p.count--; p.mesh.geometry.attributes.position.array.fill(0, i * 18, i * 18 + 18); }
      } else if (p.alive[i] && radius > 0) {
        const distance = Math.hypot(p.a0 + (i % p.nx + .5) * p.w / p.nx - a, p.y0 + (Math.floor(i / p.nx) + .5) * p.h / p.ny - y);
        const edge = radius * (.7 + .6 * (Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1));
        p.crack[i] = Math.max(p.crack[i], Math.max(0, Math.min(1, 1 - (distance - edge) / (radius * 2.6))));
      }
    }
    g._commit(p);
    if (audible) {
      const point = new this.THREE.Vector3(p.axis === 0 ? p.pos : a, y, p.axis === 2 ? p.pos : a);
      if (g.time - g._lastCrack > .04) { g.hooks.audio.glassCrack(point); g._lastCrack = g.time; }
      g.hooks.fx.chips(point.x, point.y, point.z, dir.x * .6, .2, dir.z * .6, 5, [.85, .95, 1], { speed: 3 });
      g.hooks.fx.glassBurst?.(point, dir, .3);
    }
  }
  dispose() {
    if (this.native) {
      Object.assign(this.native, this.original); this.native.reset();
      [this.native.intact.visible, this.native.shards.visible] = this.visible;
    }
    this.states.clear(); this.defs = []; this.boxes = [];
  }
}
