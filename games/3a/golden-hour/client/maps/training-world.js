// K9's hotel graph is small enough for a precomputed all-pairs table. The
// asset maps have thousands of nodes, so compute routes only to active goals.
export function trainingRoutes(nodes) {
  const incoming = nodes.map(() => []);
  for (const node of nodes) for (const link of node.links) incoming[link.to].push({ from: node.i, cost: link.c });
  const emptyRow = () => ({
    distance: new Float32Array(incoming.length).fill(1e9),
    next: new Int16Array(incoming.length).fill(-1),
  });
  const rows = new Map();
  let unreachable;
  return {
    row(goal) {
      if (!Number.isInteger(goal) || goal < 0 || goal >= incoming.length) return unreachable ??= emptyRow();
      if (rows.has(goal)) {
        const row = rows.get(goal);
        rows.delete(goal);
        rows.set(goal, row);
        return row;
      }
      const row = emptyRow();
      const { distance, next } = row;
      distance[goal] = 0;
      next[goal] = goal;
      const heap = [[goal, 0]];
      while (heap.length) {
        const [to, cost] = heap[0], last = heap.pop();
        if (heap.length) {
          let i = 0, child = 1;
          while (child < heap.length) {
            if (child + 1 < heap.length && heap[child + 1][1] < heap[child][1]) child++;
            if (last[1] <= heap[child][1]) break;
            heap[i] = heap[child];
            i = child;
            child = i * 2 + 1;
          }
          heap[i] = last;
        }
        if (cost > distance[to]) continue;
        for (const edge of incoming[to]) {
          const candidate = Math.fround(cost + edge.cost);
          if (candidate >= distance[edge.from]) continue;
          distance[edge.from] = candidate;
          next[edge.from] = to;
          let i = heap.length;
          while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heap[parent][1] <= candidate) break;
            heap[i] = heap[parent];
            i = parent;
          }
          heap[i] = [edge.from, candidate];
        }
      }
      if (rows.size >= 8) rows.delete(rows.keys().next().value);
      rows.set(goal, row);
      return row;
    },
  };
}

const noPool = { x0: Infinity, x1: Infinity, z0: Infinity, z1: Infinity, water: -Infinity };

export function prepareTrainingWorld(engine, data) {
  const { ctx, debug } = engine;
  const { world, nav, physics, glass, hotel, match, fx } = debug;
  const k9 = match.k9;
  if (!world?.addCollider || !nav?.add || !physics?.reset || !Array.isArray(glass?.panes) ||
      !hotel?.inPool || !k9?.navDistance)
    throw Error('当前游戏版本不支持这张训练地图。');

  // The prototype keeps closures over these objects (physics, audio, weapons,
  // bot rigs). Swap the map-owned data behind the shared native interfaces.
  const collision = new world.constructor();
  for (const box of data.colliders)
    collision.addCollider(...box.min, ...box.max, box.surf || 'concrete', { noMove: box.noMove, noRay: box.noRay });
  const pathing = new nav.constructor(world);
  for (const { pos } of data.nodes) pathing.add(...pos);
  for (const node of pathing.nodes) {
    node.links = data.nodes[node.i].links.map(to => {
      const target = pathing.nodes[to];
      return { to, c: Math.hypot(target.x - node.x, target.y - node.y, target.z - node.z) };
    });
  }
  const spawns = data.spawns.map(({ pos: [x, y, z], yaw = 0, team }) => ({ x, y, z, yaw, side: team }));
  const routes = trainingRoutes(pathing.nodes);
  const undo = [];
  const swap = (object, fields) => {
    const saved = Object.fromEntries(Object.keys(fields).map(key => [key, object[key]]));
    undo.push(() => Object.assign(object, saved));
    Object.assign(object, fields);
  };
  const clearProps = () => {
    // K9 caches node indices on actors that survive a map change.
    for (const actor of match.actors) actor._k9n = -1;
    physics.reset();
    for (const bot of match.bots) {
      bot.corpses.length = 0;
      bot.e.groundCol = bot.e.hitWall = null;
    }
    debug.player.e.groundCol = debug.player.e.hitWall = null;
    fx.reset?.();
  };
  const restore = () => { while (undo.length) undo.pop()(); };
  try {
    // Reset any remnants of the previous hotel round before hiding its props.
    clearProps();
    glass.reset();
    swap(world, { cols: collision.cols, grid: collision.grid, _q: collision._q, _stamp: 0, groundCol: null });
    swap(nav, { nodes: pathing.nodes, islands: [] });
    swap(k9, { nn: pathing.nodes.length, ghRoutes: routes });
    swap(ctx, { spawns, resetWorld: () => {} });
    swap(physics, { bodies: [], props: [], _cands: [] });
    swap(glass, { panes: [] });
    swap(hotel, { pool: noPool, inPool: () => false, indoor: () => false });
  } catch (failure) {
    restore();
    throw failure;
  }
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    try { clearProps(); } finally { restore(); }
  };
}
