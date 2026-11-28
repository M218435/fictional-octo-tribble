function visitCell(candidates, grid, x, z, stamp) {
  const cells = grid.get((x + 512) * 1024 + z + 512);
  if (!cells) return;
  for (let i = 0; i < cells.length; i++) {
    const box = cells[i];
    if (box.stamp === stamp) continue;
    box.stamp = stamp;
    candidates.push(box);
  }
}

// Preserve the original slab test while narrowing it to candidates from the
// native world's 4 m collision grid.
export function installNativeRaycast(world) {
  const fallback = world.raycast;
  const orders = new WeakMap();
  const candidates = [];
  world.raycast = function (x, y, z, dx, dy, dz, limit, hit, skipWater = false) {
    const argsSafe = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) &&
      Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(dz) &&
      Math.abs(x) < 1e6 && Math.abs(z) < 1e6 &&
      limit > 0 && limit <= 10000 && limit * (Math.abs(dx) + Math.abs(dz) + 2e-9) < 4096 &&
      Number.isSafeInteger(this._stamp + 1);
    if (!argsSafe) return fallback.call(this, x, y, z, dx, dy, dz, limit, hit, skipWater);

    // Training maps swap both the collider array and its index. Keep a
    // separate insertion order for each array so equal-distance hits match
    // the old scan (surface, pane exclusions and callbacks included).
    const { cols, grid } = this;
    let order = orders.get(cols);
    if (!order || order.size !== cols.length) {
      order = new Map();
      for (let i = 0; i < cols.length; i++) order.set(cols[i], i);
      orders.set(cols, order);
    }

    if (Math.abs(dx) < 1e-9) dx = 1e-9;
    if (Math.abs(dy) < 1e-9) dy = 1e-9;
    if (Math.abs(dz) < 1e-9) dz = 1e-9;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const stepX = Math.abs(4 * ix), stepZ = Math.abs(4 * iz);
    let cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    let nextX = ((cx + (sx > 0 ? 1 : 0)) * 4 - x) * ix;
    let nextZ = ((cz + (sz > 0 ? 1 : 0)) * 4 - z) * iz;
    let distance = limit, box = null, axis = 0;
    const stamp = ++this._stamp;
    let entry = 0;
    while (entry <= distance + 1e-8) {
      visitCell(candidates, grid, cx, cz, stamp);
      for (const c of candidates) {
        if (c.off || c.noRay || c.pane || (skipWater && c.water)) continue;
        let lo = (c.x0 - x) * ix, hi = (c.x1 - x) * ix;
        let from = lo < hi ? lo : hi, to = lo < hi ? hi : lo, side = 0;
        lo = (c.y0 - y) * iy; hi = (c.y1 - y) * iy;
        let n = lo < hi ? lo : hi, f = lo < hi ? hi : lo;
        if (n > from) { from = n; side = 1; }
        if (f < to) to = f;
        if (from > to) continue;
        lo = (c.z0 - z) * iz; hi = (c.z1 - z) * iz;
        n = lo < hi ? lo : hi; f = lo < hi ? hi : lo;
        if (n > from) { from = n; side = 2; }
        if (f < to) to = f;
        if (from > to || from < 0 || from >= limit || from > distance ||
            (box && from === distance && order.get(c) >= order.get(box))) continue;
        distance = from; box = c; axis = side;
      }
      candidates.length = 0;

      // At a corner include both adjacent cells. Allow a small tolerance
      // for rounding in the accumulated crossing times.
      if (Math.abs(nextX - nextZ) <= 1e-10 * Math.max(1, Math.abs(nextX), Math.abs(nextZ))) {
        entry = Math.min(nextX, nextZ);
        if (entry > distance + 1e-8) break;
        cx += sx; cz += sz;
        visitCell(candidates, grid, cx - sx, cz, stamp);
        visitCell(candidates, grid, cx, cz - sz, stamp);
        nextX += stepX; nextZ += stepZ;
      } else if (nextX < nextZ) {
        entry = nextX; cx += sx; nextX += stepX;
      } else {
        entry = nextZ; cz += sz; nextZ += stepZ;
      }
    }
    if (!box) return false;
    if (hit) {
      hit.t = distance; hit.col = box;
      hit.nx = axis === 0 ? -sx : 0;
      hit.ny = axis === 1 ? (dy > 0 ? -1 : 1) : 0;
      hit.nz = axis === 2 ? -sz : 0;
    }
    return true;
  };
}
