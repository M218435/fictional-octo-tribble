// The native HUD remains shared; only map data and labels change per room.
export function mapRaycast(colliders) {
  return (x, y, z, dx, dy, dz, distance) => {
    let nearest = distance, hit = false;
    for (const box of colliders) {
      if (box.noRay) continue;
      let near = 0, far = nearest;
      for (let axis = 0; axis < 3; axis++) {
        const origin = axis === 0 ? x : axis === 1 ? y : z;
        const direction = axis === 0 ? dx : axis === 1 ? dy : dz;
        if (Math.abs(direction) < 1e-9) {
          if (origin < box.min[axis] || origin > box.max[axis]) { far = -1; break; }
        } else {
          const a = (box.min[axis] - origin) / direction, b = (box.max[axis] - origin) / direction;
          near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
          if (near > far) break;
        }
      }
      if (near <= far && far >= 0) { nearest = near; hit = true; }
    }
    return hit ? { dist: nearest } : false;
  };
}

export function prepareMapHud({ engine, mapData, room }) {
  const ctx = engine.ctx, hud = ctx.hud, map = hud?.map;
  if (!map?.cv || !map._plan || !hud.update || !hud.matchStart || !hud.board)
    throw Error('当前 HUD 不支持地图切换。');
  const saved = Object.fromEntries(['minx', 'minz', 'wm', 'hm', 'cv'].map(key => [key, map[key]]));
  const { minX, maxX, minZ, maxZ } = mapData.bounds;
  const cols = mapData.colliders.map(box => ({
    x0: box.min[0], y0: box.min[1], z0: box.min[2],
    x1: box.max[0], y1: box.max[1], z1: box.max[2], noRay: box.noRay,
  }));
  const pixelsPerMeter = Math.round(saved.cv[0].width / saved.wm);
  Object.assign(map, { minx: minX - 1, minz: minZ - 1, wm: maxX - minX + 2, hm: maxZ - minZ + 2 });
  const canvases = saved.cv.map((old, level) => {
    const canvas = old.ownerDocument.createElement('canvas');
    canvas.width = Math.round(map.wm * pixelsPerMeter); canvas.height = Math.round(map.hm * pixelsPerMeter);
    canvas.style.width = `calc(var(--mpm) * ${map.wm})`;
    canvas.style.height = `calc(var(--mpm) * ${map.hm})`;
    canvas.style.opacity = level ? 0 : 1;
    map._plan(canvas, { cols }, {}, 0, null);
    if (mapData.sites) {
      const paint = canvas.getContext('2d');
      paint.save();
      paint.textAlign = 'center';
      paint.textBaseline = 'middle';
      paint.font = 'bold ' + Math.max(14, pixelsPerMeter * 2.6) + 'px sans-serif';
      for (const [name, color] of [['A', '#ebbb56'], ['B', '#83d2b9']]) {
        const point = mapData.anchors?.[name]?.[0];
        if (!point) continue;
        const x = (point.X - map.minx) * pixelsPerMeter, y = (point.Z - map.minz) * pixelsPerMeter;
        paint.strokeStyle = '#142020';
        paint.lineWidth = 3;
        paint.strokeText(name, x, y);
        paint.fillStyle = color;
        paint.fillText(name, x, y);
      }
      paint.restore();
    }
    return canvas;
  });
  saved.cv.forEach((old, i) => old.replaceWith(canvases[i]));
  map.cv = canvases;
  map.reset(); map._lay = true;
  const update = hud.update, matchStart = hud.matchStart;
  const mapUpdate = map.update;
  const world = Object.create(ctx.world);
  world.raycast = mapRaycast(mapData.colliders);
  const title = room.mapName || mapData.mapId;
  const zoneTitle = map.zone.title;
  const zoneText = map.zone.textContent;
  // The native intro is built lazily by matchStart, so there may be no
  // heading at room preparation time. Save styles when the node exists.
  const introStyles = new Map();
  const saveIntroStyle = heading => {
    if (heading && !introStyles.has(heading)) introStyles.set(heading, heading.getAttribute('style'));
  };
  saveIntroStyle(hud.e.intro.querySelector('.i-map'));
  map.update = function(...args) {
    const value = mapUpdate.apply(this, args);
    this.zone.textContent = title.split(' · ').at(-1);
    this.zone.title = title;
    return value;
  };
  hud.update = function(dt, state) {
    const originalWorld = ctx.world;
    ctx.world = world;
    try { return update.call(this, dt, { ...state, world }); }
    finally { ctx.world = originalWorld; }
  };
  hud.matchStart = function(...args) {
    const value = matchStart.apply(this, args);
    const heading = this.e.intro.querySelector('.i-map');
    saveIntroStyle(heading);
    if (heading) {
      heading.textContent = title;
      Object.assign(heading.style, { fontSize: 'clamp(20px, 4vw, 58px)', maxWidth: '88vw', textAlign: 'center' });
    }
    return value;
  };
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    hud.update = update; hud.matchStart = matchStart; map.update = mapUpdate;
    canvases.forEach((canvas, i) => canvas.replaceWith(saved.cv[i]));
    Object.assign(map, saved);
    map.zone.title = zoneTitle;
    map.zone.textContent = zoneText;
    for (const [heading, style] of introStyles) {
      if (style === null) heading.removeAttribute('style');
      else heading.setAttribute('style', style);
    }
    map.reset(); map._lay = true;
  };
}
