// Opt-in in-page WebGL performance benchmark, loaded ONLY when ?bench=1 is set.
// Measures boot time, GPU/JS memory, and deterministic 5-viewpoint runtime FPS /
// frame-time / draw-call / triangle load across medium and high quality tiers.

const VIEWPOINTS = [
  { name: 'lobby_reception', pos: [0, 1.7, 4, 0, -4, 90] },
  { name: 'lobby_pool', pos: [0, 1.7, 2, 180, -4, 90] },
  { name: 'restaurant', pos: [-20, 1.7, -14, -90, -2, 90] },
  { name: 'bar', pos: [-18, 1.7, 5, 0, -2, 90] },
  { name: 'conference', pos: [19, 1.7, -4, 90, -2, 90] },
];

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

async function sampleViewpoint(gh, renderer, vp, warmupFrames = 8, measureFrames = 40) {
  gh.debug.view(...vp.pos);
  for (let i = 0; i < warmupFrames; i++) await nextFrame();
  const dts = [];
  let sumCalls = 0;
  let sumTris = 0;
  let maxCalls = 0;
  let maxTris = 0;
  let prev = await nextFrame();
  for (let i = 0; i < measureFrames; i++) {
    const now = await nextFrame();
    const dt = now - prev;
    prev = now;
    dts.push(dt);
    const c = renderer.info.render.calls;
    const t = renderer.info.render.triangles;
    sumCalls += c;
    sumTris += t;
    if (c > maxCalls) maxCalls = c;
    if (t > maxTris) maxTris = t;
  }
  const sorted = [...dts].sort((a, b) => a - b);
  const avgMs = dts.reduce((a, b) => a + b, 0) / dts.length;
  return {
    name: vp.name,
    avgFps: +(1000 / Math.max(avgMs, 0.1)).toFixed(1),
    avgMs: +avgMs.toFixed(2),
    p50Ms: +percentile(sorted, 0.5).toFixed(2),
    p95Ms: +percentile(sorted, 0.95).toFixed(2),
    avgCalls: Math.round(sumCalls / measureFrames),
    maxCalls,
    avgTris: Math.round(sumTris / measureFrames),
    maxTris,
  };
}

export async function runHotelBenchmark({ mode, clearCache, bootReadyMs }) {
  const gh = globalThis.GH;
  const gfx = gh?.debug?.gfx;
  const renderer = gfx?.renderer;
  const scene = gfx?.scene;
  if (!gh || !gfx || !renderer || !scene) {
    throw Error('GH renderer not ready for benchmark');
  }

  let sceneMeshes = 0;
  let culledMeshes = 0;
  let instancedMeshes = 0;
  scene.traverse(obj => {
    if (!obj.isMesh && !obj.isPoints && !obj.isLine && !obj.isSprite) return;
    sceneMeshes++;
    if (obj.frustumCulled) culledMeshes++;
    if (obj.isInstancedMesh) instancedMeshes++;
  });

  const resources = performance.getEntriesByType?.('resource') || [];
  const transferBytes = resources.reduce((s, r) => s + (r.transferSize || 0), 0);
  const decodedBytes = resources.reduce((s, r) => s + (r.decodedBodySize || 0), 0);

  const summary = {
    mode,
    clearCache: !!clearCache,
    viewport: [innerWidth, innerHeight],
    dpr: globalThis.devicePixelRatio || 1,
    bootReadyMs: Math.round(bootReadyMs),
    transferMB: +(transferBytes / 1048576).toFixed(2),
    decodedMB: +(decodedBytes / 1048576).toFixed(2),
    bootStats: { ...(globalThis.GHBoot?.stats || {}) },
    memory: {
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length || 0,
      sceneMeshes,
      culledMeshes,
      instancedMeshes,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    },
    tiers: {},
  };

  for (const tier of ['medium', 'high']) {
    gfx.setQuality(tier);
    for (let i = 0; i < 6; i++) await nextFrame();
    const views = [];
    for (const vp of VIEWPOINTS) {
      views.push(await sampleViewpoint(gh, renderer, vp, 8, 40));
    }
    const mean = key => +(views.reduce((s, v) => s + v[key], 0) / views.length).toFixed(2);
    summary.tiers[tier] = {
      avgFps: +mean('avgFps').toFixed(1),
      avgMs: mean('avgMs'),
      p50Ms: mean('p50Ms'),
      p95Ms: mean('p95Ms'),
      avgCalls: Math.round(mean('avgCalls')),
      avgTris: Math.round(mean('avgTris')),
      maxTris: Math.max(...views.map(v => v.maxTris)),
      views,
    };
  }

  // Restore default viewpoint & expose clean JSON in DOM for browser readout.
  gh.debug.view(null);
  let out = document.getElementById('gh-bench-result');
  if (!out) {
    out = document.createElement('pre');
    out.id = 'gh-bench-result';
    out.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:999999;max-width:480px;max-height:240px;overflow:auto;background:rgba(0,0,0,0.85);color:#7ef;font:11px/1.3 monospace;padding:8px;border:1px solid #356;pointer-events:auto;';
    document.body.append(out);
  }
  out.textContent = JSON.stringify(summary, null, 2);
  out.dataset.done = '1';
  globalThis.__GH_BENCH__ = summary;
  return summary;
}
