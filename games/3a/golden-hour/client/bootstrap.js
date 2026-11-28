import "./touch-controls.js";
import { installCombatModels } from "./combat-models.js";
import { installMenuLayout } from "./menu-layout.js";
import { installDesktopInput } from "./desktop-input.js";
import { installRuntimeDiagnostics } from "./runtime-diagnostics.js";
import {
  createWebGLContext,
  installWebGLRecovery,
} from "./webgl-context.js";

import {
  readCache,
  writeMaterialsCache,
  restoreMaterials,
  hydrateArmoury,
} from "./startup-cache.js";
import { startupPolicy, textureSize, limitTextureData, renderPixelRatio } from "./performance-policy.js";
import { decodeOperators, restoreOperator, hydrateGrips } from "./startup-geometry.js";
import { decodeStartupPack, buildBufferGeometry, createBitmapTexture } from "./startup-pack.js";
import { installNativeRaycast } from "./native-raycast.js";

const base = new URL("../", import.meta.url);
const version = document.documentElement.dataset.bundle || "development";
const startupOptions = new URLSearchParams(location.search);
const baking = startupOptions.has("bake");
const proceduralHotel = baking || startupOptions.has("procedural-hotel");
const benchMode = startupOptions.has("bench");
const clearCacheMode = startupOptions.has("clear-cache");
const connection = navigator.connection;
const lowData = startupOptions.get("lowdata") === "1" || connection?.saveData === true ||
  ["slow-2g", "2g", "3g"].includes(connection?.effectiveType);
installMenuLayout();
const policy = startupPolicy({
  coarse: matchMedia("(pointer: coarse)").matches,
  mobile: navigator.userAgentData?.mobile,
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints,
  devicePixelRatio: globalThis.devicePixelRatio,
});
globalThis.GHDiagnostics = installRuntimeDiagnostics({ version, profile: policy.mobile ? "mobile" : "desktop" });
// Mobile textures have their own key and a smaller read/write budget; never
// deserialize the desktop's 154 MiB pixel pack into a phone's memory.
const key = `materials-v2:${policy.mobile ? "mobile" : "desktop"}:${version}`;
const shaderJobs = [];
const stats = {
  version,
  materials: "miss",
  resourceProfile: policy.mobile ? "mobile" : "desktop",
  armoury: "fallback",
  operators: "fallback",
  cacheReadMs: 0,
  shaderJobs: 0,
  shaderErrors: 0,
};
const start = performance.now();
const boot = (globalThis.GHBoot = {
  stats,
  createWebGLContext,
  policy,
  defaultRenderScale() {
    return policy.defaultRenderScale;
  },
  renderPixelRatio(scale, width, height) {
    return renderPixelRatio({ scale, width, height, mobile: policy.mobile,
      devicePixelRatio: globalThis.devicePixelRatio, pixelBudget: policy.renderPixelBudget });
  },
  limitTextureData(data, width, height) {
    return limitTextureData(data, width, height, policy.textureLimit);
  },
  limitTextureCanvas(canvas) {
    if (!canvas?.width || !canvas.height ||
        Math.max(canvas.width, canvas.height) <= policy.textureLimit) return canvas;
    const [width, height] = textureSize(canvas.width, canvas.height, policy.textureLimit);
    const reduced = document.createElement("canvas");
    reduced.width = width;
    reduced.height = height;
    reduced.getContext("2d").drawImage(canvas, 0, 0, width, height);
    return reduced;
  },
  materials: null,
  armoury: null,
  operators: null,
  startup: null,
  restoreActorTexture(name, create) {
    const rec = this.startup?.actorTextures?.[name];
    if (rec?.image) {
      try {
        const tex = createBitmapTexture(rec, img => create({ image: img, width: rec.width, height: rec.height }), {
          flipY: false,
          wrap: 1000,
          minFilter: 1008,
          magFilter: 1006,
          generateMipmaps: true,
          anisotropy: 8,
          colorSpace: name === "normal" ? "" : "srgb",
        });
        stats.actorTextures = "prebaked-pack";
        return tex;
      } catch {
        // Fall through to legacy pack or procedural generator.
      }
    }
    if (!this.actorTextures && this.actorMaterialPack) {
      try {
        this.actorTextures = restoreMaterials(this.actorMaterialPack, create, 8);
        stats.actorTextures = "prebaked";
      } catch { this.actorTextures = null; }
      this.actorMaterialPack = null;
    }
    return this.actorTextures?.[name] || null;
  },
  hydrateGrips(kind, gun, vector, quaternion) {
    try {
      const hit = hydrateGrips(kind, gun, this.grips, vector, quaternion);
      if (hit) stats.gripsRestored = (stats.gripsRestored || 0) + 1;
      return hit;
    } catch { return false; }
  },
  prepareOperators() {
    // Wait for the compact startup pack (started in parallel at t=0 with high
    // priority) before 38% weapons/operators build so we never fall back to
    // multi-second CPU synthesis on normal networks.
    return Promise.race([startupPackJob, new Promise(resolve => setTimeout(resolve, 4000))]);
  },
  restoreOperator(team, createGeometry, createAttribute) {
    const packRec = this.startup?.operators?.[team];
    if (packRec) {
      const geometry = buildBufferGeometry(packRec, createGeometry, createAttribute);
      this.startup.operators[team] = null;
      stats.operators = "prebaked-pack";
      stats.operatorsRestored = (stats.operatorsRestored || 0) + 1;
      return geometry;
    }
    const record = this.operators?.[team];
    if (!record) return null;
    const geometry = restoreOperator(record, createGeometry, createAttribute);
    this.operators[team] = null;
    stats.operators = "prebaked";
    stats.operatorsRestored = (stats.operatorsRestored || 0) + 1;
    return geometry;
  },
  restoreArmsGeo(createGeometry, createAttribute) {
    const arms = this.startup?.arms;
    if (!arms?.geometry) return null;
    try {
      const geometry = buildBufferGeometry(arms.geometry, createGeometry, createAttribute);
      arms.geometry = null;
      stats.armsGeo = "prebaked";
      return { geometry, info: arms.info };
    } catch { return null; }
  },
  restoreArmsAtlas(createTex, C) {
    const atlas = this.startup?.arms?.atlas;
    if (!atlas?.albedo?.image || !atlas?.data?.image || !atlas?.mask?.image || !atlas?.detail?.image) return null;
    try {
      const make = (rec, srgb) => createBitmapTexture(rec, createTex, {
        flipY: rec.flipY,
        colorSpace: srgb ? C.ts : C.hi,
        anisotropy: 8,
        generateMipmaps: true,
        minFilter: C.Ln,
        wrap: C.Ki,
      });
      const detail = createBitmapTexture(atlas.detail, createTex, {
        flipY: atlas.detail.flipY,
        colorSpace: C.hi,
        anisotropy: 8,
        generateMipmaps: true,
        minFilter: C.Ln,
        wrap: 1000,
      });
      stats.armsAtlas = "prebaked";
      return { albedo: make(atlas.albedo, true), data: make(atlas.data, false), mask: make(atlas.mask, false), detail, ms: { paint: 0, assemble: 0 } };
    } catch { return null; }
  },
  restoreArmsSleeve(createDataTex, createTex, C) {
    const sleeve = this.startup?.arms?.sleeve;
    if (!sleeve?.noise?.data || !sleeve?.weave?.image) return null;
    try {
      const noise = createDataTex(sleeve.noise.data, sleeve.noise.width, sleeve.noise.height);
      noise.wrapS = noise.wrapT = C.Bs;
      noise.magFilter = noise.minFilter = C.ls;
      noise.generateMipmaps = false;
      noise.needsUpdate = true;
      const weave = createBitmapTexture(sleeve.weave, createTex, {
        flipY: sleeve.weave.flipY,
        wrap: C.Bs,
        generateMipmaps: true,
        minFilter: C.Ln,
        magFilter: C.ls,
        anisotropy: 8,
      });
      stats.armsSleeve = "prebaked";
      return { noise, weave };
    } catch { return null; }
  },
  restoreAoTextures(createTex, C) {
    const ao = this.startup?.weaponMats?.ao;
    if (!ao?.pairs || !ao.wood?.image || !ao.sleeve?.image) return null;
    try {
      const pair = key => {
        const p = ao.pairs[key];
        return {
          n: createBitmapTexture(p.n, createTex, { flipY: p.n.flipY, wrap: C.Bs, anisotropy: 4 }),
          r: createBitmapTexture(p.r, createTex, { flipY: p.r.flipY, wrap: C.Bs, anisotropy: 4 }),
        };
      };
      const m = createBitmapTexture(ao.wood, createTex, { flipY: ao.wood.flipY, wrap: C.Bs, colorSpace: C.ts, repeat: [3.2, 9], anisotropy: 8 });
      const v = createBitmapTexture(ao.sleeve, createTex, { flipY: ao.sleeve.flipY, wrap: C.Bs, colorSpace: C.ts, repeat: [5, 5] });
      stats.weaponMats = "prebaked";
      return { i: pair("i"), a: pair("a"), r: pair("r"), l: pair("l"), c: pair("c"), h: pair("h"), m, v };
    } catch { return null; }
  },
  restoreAoMark(createTex, C) {
    const ao = this.startup?.weaponMats?.ao;
    if (!ao?.mark?.image || !ao.markCells) return null;
    try {
      const tex = createBitmapTexture(ao.mark, createTex, { flipY: ao.mark.flipY, colorSpace: C.ts, anisotropy: 8 });
      return { C: tex, E: ao.markCells };
    } catch { return null; }
  },
  restoreP4Wear(createTex, C) {
    const rec = this.startup?.weaponMats?.p4?.wear;
    if (!rec?.image) return null;
    try {
      return createBitmapTexture(rec, createTex, { flipY: rec.flipY, wrap: C.Bs, magFilter: C.ls, minFilter: C.Ln, generateMipmaps: true, anisotropy: 4 });
    } catch { return null; }
  },
  restoreP4Mark(createTex, C) {
    const p4 = this.startup?.weaponMats?.p4;
    if (!p4?.mark?.image || !p4.markCells) return null;
    try {
      const d = createBitmapTexture(p4.mark, createTex, { flipY: p4.mark.flipY, colorSpace: C.ts, anisotropy: 8 });
      const m = new C.Mat({ map: d, color: 16777215, transparent: true, roughness: 0.6, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      m.name = "kr7:marks";
      m.userData = { base: new C.Dt(6974576), wear: 1, cells: p4.markCells };
      return m;
    } catch { return null; }
  },
  restoreBkWear(createTex, C) {
    const rec = this.startup?.weaponMats?.bk?.wear;
    if (!rec?.image) return null;
    try {
      return createBitmapTexture(rec, createTex, { flipY: rec.flipY, wrap: C.Bs, magFilter: C.ls, minFilter: C.Ln, generateMipmaps: true, anisotropy: 4 });
    } catch { return null; }
  },
  restoreCamo(id, createTex, C) {
    const pack = this.startup?.camos?.packs?.[id];
    if (!pack?.map?.image || !pack?.normalMap?.image || !pack?.orm?.image) return null;
    try {
      const rep = [1 / (pack.tile || 1), 1 / (pack.tile || 1)];
      const make = (rec, srgb) => createBitmapTexture(rec, createTex, {
        flipY: rec.flipY,
        wrap: C.Bs,
        magFilter: C.ls,
        minFilter: C.Ln,
        generateMipmaps: true,
        anisotropy: 8,
        repeat: rep,
        colorSpace: srgb ? C.ts : C.hi,
      });
      stats.camosRestored = (stats.camosRestored || 0) + 1;
      return { map: make(pack.map, true), normalMap: make(pack.normalMap, false), orm: make(pack.orm, false) };
    } catch { return null; }
  },
  restoreCamoDetail(id, createTex, C) {
    const rec = this.startup?.camos?.details?.[id];
    if (!rec?.image) return null;
    try {
      return createBitmapTexture(rec, createTex, { flipY: rec.flipY, wrap: C.Bs, magFilter: C.ls, minFilter: C.Ln, generateMipmaps: true, anisotropy: 4 });
    } catch { return null; }
  },
  restoreNoise3D(create3D, C) {
    const rec = this.startup?.fx?.noise3d;
    if (!rec?.data) return null;
    try {
      const tex = create3D(rec.data, rec.size);
      tex.format = C.Ls;
      tex.type = C.Ho;
      tex.minFilter = tex.magFilter = C.ls;
      tex.wrapS = tex.wrapT = tex.wrapR = C.Bs;
      tex.unpackAlignment = 1;
      tex.colorSpace = C.hi;
      tex.needsUpdate = true;
      this.startup.fx.noise3d = null;
      stats.fxNoise3d = "prebaked";
      return tex;
    } catch { return null; }
  },
  restoreFxSprites(createTex, C) {
    const rec = this.startup?.fx?.sprites;
    if (!rec?.image) return null;
    try {
      const tex = createBitmapTexture(rec, createTex, { flipY: rec.flipY, minFilter: C.ls, magFilter: C.ls, generateMipmaps: false, colorSpace: C.hi });
      stats.fxSprites = "prebaked";
      return tex;
    } catch { return null; }
  },
  restoreDecalAtlas(createTex, C) {
    const dec = this.startup?.fx?.decals;
    if (!dec?.map?.image || !dec?.normalMap?.image) return null;
    try {
      const map = createBitmapTexture(dec.map, createTex, { flipY: dec.map.flipY, colorSpace: C.ts, anisotropy: 4 });
      const normalMap = createBitmapTexture(dec.normalMap, createTex, { flipY: dec.normalMap.flipY, colorSpace: C.hi, anisotropy: 4 });
      stats.fxDecals = "prebaked";
      return { map, normalMap };
    } catch { return null; }
  },
  restoreK9Textures(createTex, C) {
    const k9 = this.startup?.k9;
    if (!k9?.detail?.image || !k9?.mask?.image || !k9?.marks?.image || !k9.cells) return null;
    try {
      const detail = createBitmapTexture(k9.detail, createTex, { flipY: k9.detail.flipY, wrap: C.Bs, generateMipmaps: true, minFilter: C.Ln, magFilter: C.ls, anisotropy: 8, colorSpace: C.hi });
      const mask = createBitmapTexture(k9.mask, createTex, { flipY: k9.mask.flipY, wrap: C.Bs, generateMipmaps: true, minFilter: C.Ln, magFilter: C.ls, anisotropy: 8, colorSpace: C.hi });
      const marks = createBitmapTexture(k9.marks, createTex, { flipY: k9.marks.flipY, colorSpace: C.ts, anisotropy: 8 });
      stats.k9Tex = "prebaked";
      return { detail, mask, marks, cells: k9.cells, parts: [0, 0, 0], ms: 0, bytes: 0 };
    } catch { return null; }
  },
  restoreK9Geo(createGeometry, createAttribute) {
    const eb = this.startup?.k9?.eb;
    if (!eb?.geometry) return null;
    try {
      const geometry = buildBufferGeometry(eb.geometry, createGeometry, createAttribute);
      this.startup.k9.eb = null;
      stats.k9Geo = "prebaked";
      return { geometry, rest: eb.rest, stats: eb.stats };
    } catch { return null; }
  },
  restoreArGeo(key, createGeometry, createAttribute) {
    const parts = this.startup?.arGeo?.[key];
    if (!parts) return null;
    try {
      const out = {};
      for (const [name, rec] of Object.entries(parts)) {
        out[name] = buildBufferGeometry(rec, createGeometry, createAttribute);
      }
      this.startup.arGeo[key] = null;
      stats.arGeo = "prebaked";
      return out;
    } catch { return null; }
  },
  restoreMinimap(mapObj) {
    const mm = this.startup?.minimap;
    if (!mm?.floor0?.image || !mm?.floor1?.image || !mapObj?.cv?.[0] || !mapObj?.cv?.[1]) return false;
    if (
      mapObj.cv[0].width !== mm.width ||
      mapObj.cv[0].height !== mm.height ||
      Math.abs(mapObj.minx - mm.minx) > 0.05 ||
      Math.abs(mapObj.minz - mm.minz) > 0.05
    ) {
      return false;
    }
    try {
      mapObj.cv[0].getContext("2d").drawImage(mm.floor0.image, 0, 0, mm.width, mm.height);
      mapObj.cv[1].getContext("2d").drawImage(mm.floor1.image, 0, 0, mm.width, mm.height);
      stats.minimap = "prebaked";
      return true;
    } catch { return false; }
  },
  swatches: new Map(),
  restoreCanvas(record) {
    const canvas = document.createElement("canvas");
    canvas.width = record.width;
    canvas.height = record.height;
    canvas
      .getContext("2d")
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(
            record.data.buffer,
            record.data.byteOffset,
            record.data.byteLength,
          ),
          record.width,
          record.height,
        ),
        0,
        0,
      );
    return canvas;
  },
  captureMaterials(value) {
    if (policy.cacheMaterials) this.pendingMaterials = value;
  },
  restoreMaterials(create, anisotropy) {
    if (!this.materials) return null;
    try {
      const result = restoreMaterials(this.materials, create, anisotropy, { consume: true });
      if (result) stats.materials = "hit";
      this.materials = null;
      return result;
    } catch {
      this.materials = null;
      stats.materials = "invalid";
      return null;
    }
  },
  hydrateArmoury(studio) {
    try {
      const hit = hydrateArmoury(studio, this.armoury);
      if (hit) stats.armoury = "prebaked";
      return hit;
    } catch {
      return false;
    }
  },
  trackShader(job) {
    stats.shaderJobs++;
    shaderJobs.push(Promise.resolve(job).then(
      () => null,
      (error) => {
        const failure = error instanceof Error ? error : Error(String(error));
        stats.shaderErrors++;
        stats.lastShaderError = failure.message.slice(0, 200);
        return failure;
      },
    ));
  },
  async finishShaders() {
    const results = await Promise.all(shaderJobs.splice(0));
    const failure = results.find((result) => result !== null);
    if (failure) throw failure;
  },
});
// Browser HTTP cache can fetch/parse the stable, versioned bundle while local
// material data and pre-baked icons load in parallel.
const game = new URL("dist/game.js", base);
const preload = document.createElement("link");
preload.rel = "preload";
preload.as = "script";
preload.href = game.href;
preload.fetchPriority = "high";
document.head.append(preload);
// Fetch while the renderer builds the hotel; only join at the operator stage.
// On constrained connections, use the procedural fallback and reserve
// bandwidth for the script needed to reach the home screen.
const usePrebakedAssets = !baking && !lowData;
const useBakedHotel = !proceduralHotel;
let hotelPreloadJob = null;
if (useBakedHotel) {
  hotelPreloadJob = import("./maps/hotel-baked.js")
    .then(mod => mod.preloadBakedHotel(base))
    .catch(() => null);
  boot.loadBakedHotel = async env => {
    const mod = await import("./maps/hotel-baked.js");
    return mod.loadBakedHotel(env, hotelPreloadJob);
  };
}
const startupPackJob = !usePrebakedAssets ? Promise.resolve() : fetch(new URL("assets/startup-pack.bin", base), {
  signal: AbortSignal.timeout(15000),
  priority: "high",
}).then(async response => {
  if (!response.ok) throw Error(`startup-pack HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (globalThis.GH?.ready) return;
  boot.startup = await decodeStartupPack(buffer, version, { textureLimit: policy.textureLimit });
  stats.startupPack = "prebaked";
}).catch(async () => {
  stats.startupPack = "fallback";
  try {
    const response = await fetch(new URL("assets/operators.bin", base), {
      signal: AbortSignal.timeout(15000),
      priority: "low",
    });
    if (!response.ok) return;
    const buffer = await response.arrayBuffer();
    if (globalThis.GH?.ready) return;
    boot.operators = decodeOperators(buffer, version);
    boot.grips = boot.operators.grips;
    boot.actorMaterialPack = boot.operators.materials;
  } catch { stats.operators = "fallback"; }
});
if (clearCacheMode && globalThis.indexedDB?.deleteDatabase) {
  await new Promise(resolve => {
    try {
      const req = indexedDB.deleteDatabase("golden-hour-startup");
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
      setTimeout(resolve, 600);
    } catch { resolve(); }
  });
}
if (!baking) {
  await Promise.allSettled([
    (!useBakedHotel && policy.cacheMaterials ? readCache(key, policy.materialCacheBytes, { signal: AbortSignal.timeout(1200) })
      : Promise.resolve(null)).then((value) => {
      boot.materials = value || null;
    }),
    usePrebakedAssets && fetch(new URL("assets/armoury.json", base), {
      signal: AbortSignal.timeout(1500),
      priority: "high",
    }).then(async (response) => {
      if (response.ok) {
        const pack = await response.json();
        if (pack.source !== version) return;
        boot.armoury = pack;
        await Promise.allSettled(
          (pack.swatches || []).map(async ([key, url]) => {
            if (!/^data:image\/png;base64,/.test(url)) return;
            const image = await createImageBitmap(
              await (await fetch(url)).blob(),
            );
            boot.swatches.set(key, image);
          }),
        );
        stats.swatches = boot.swatches.size;
      }
    }),
    usePrebakedAssets && fetch(new URL("assets/grips.json", base), { signal: AbortSignal.timeout(1200), priority: "high" })
      .then(async response => {
        if (!response.ok) return;
        const pack = await response.json();
        if (pack.schema === 1 && pack.source === version && Array.isArray(pack.grips)) boot.grips = pack.grips;
      }),
  ]);
}
stats.cacheReadMs = Math.round(performance.now() - start);
const script = document.createElement("script");
script.src = game.href;
script.onerror = () => {
  document.querySelector("#ltxt").textContent = "游戏资源加载失败，请刷新重试";
};
document.body.append(script);
await Promise.all([import("./telemetry.js"), import("./pvp.js")]);
while (!globalThis.GH?.ready)
  await new Promise((resolve) => setTimeout(resolve, 100));
const ghReadyMs = performance.now();
installNativeRaycast(globalThis.GH.debug.world);
if (!baking) installCombatModels(globalThis.GH);
const { installHotelWood } = await import("./maps/hotel-wood.js");
installHotelWood(globalThis.GH);
const desktop = installDesktopInput(globalThis.GH);
globalThis.GHInput?.bind(globalThis.GH, desktop.suspend);
installWebGLRecovery(globalThis.GH, desktop.suspend);
// Geometry actually used by the renderer owns its buffers. Release unused
// optional data while keeping small runtime-reusable camo/weapon textures.
boot.operators = null;
boot.actorMaterialPack = null;
if (boot.startup) {
  boot.startup.operators = null;
  boot.startup.actorTextures = null;
  boot.startup.arms = null;
  boot.startup.fx = null;
  boot.startup.k9 = null;
  boot.startup.minimap = null;
}
if (benchMode) {
  import("./bench.js")
    .then(mod => mod.runHotelBenchmark({
      mode: useBakedHotel ? "baked" : "procedural",
      clearCache: clearCacheMode,
      bootReadyMs: ghReadyMs,
    }))
    .catch(err => {
      const out = document.createElement("pre");
      out.id = "gh-bench-result";
      out.dataset.done = "error";
      out.textContent = String(err?.stack || err);
      document.body.append(out);
    });
}
if (!baking && policy.cacheMaterials && boot.pendingMaterials) {
  const save = () => {
    try {
      const materials = boot.pendingMaterials;
      boot.pendingMaterials = null;
      writeMaterialsCache(key, materials, policy.materialCacheBytes)
        .then((saved) => {
          stats.materialsSaved = saved.textures;
          stats.materialBytes = saved.bytes;
        })
        .catch(() => {
          stats.cacheWrite = "unavailable";
        });
    } catch {
      boot.pendingMaterials = null;
      stats.cacheWrite = "unavailable";
    }
  };
  if (globalThis.requestIdleCallback)
    requestIdleCallback(save, { timeout: 5000 });
  else setTimeout(save, 1000);
}
