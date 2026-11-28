import { SceneLayers } from '../scene-layers.js';
import { downloadSceneBuffer } from './scene-download.js';

const assetBase = new URL('../../', import.meta.url);

export async function limitSceneTextures(root, limit, resize = globalThis.createImageBitmap, signal) {
  if (!Number.isFinite(limit) || limit < 1 || typeof resize !== 'function') return;
  const sources = new Set();
  root.traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) for (const value of Object.values(material)) if (value?.isTexture && value.source) sources.add(value.source);
    }
  });
  // Resize one shared image at a time, before any texture reaches the GPU.
  const images = new Map();
  for (const source of sources) {
    const refs = images.get(source.data) || [];
    refs.push(source); images.set(source.data, refs);
  }
  for (const [image, refs] of images) {
    signal?.throwIfAborted();
    const max = Math.max(image?.width || 0, image?.height || 0);
    if (max <= limit) continue;
    const scaled = await resize(image, { resizeWidth: Math.max(1, Math.round(image.width * limit / max)),
      resizeHeight: Math.max(1, Math.round(image.height * limit / max)), resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    if (signal?.aborted) { scaled.close?.(); signal.throwIfAborted(); }
    for (const source of refs) { source.data = scaled; source.needsUpdate = true; }
    image.close?.();
  }
}

// Capture original assets before adapters replace materials, then also collect
// runtime additions on release. Alternate GLTF scenes can share these assets.
export function createSceneDisposer(result) {
  const roots = new Set([...(result?.scenes || []), result?.scene || result].filter(root => root?.traverse));
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const extras = new Set();
  const textureValues = value => {
    if (value?.isTexture) textures.add(value);
    else if (Array.isArray(value)) for (const entry of value) textureValues(entry);
  };
  const capture = () => {
    for (const root of roots) root.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) textureValues(value);
        for (const uniform of Object.values(material.uniforms || {})) textureValues(uniform?.value);
      }
      if (object.shadow) extras.add(object.shadow);
      if (object.skeleton) extras.add(object.skeleton);
      if (object.isInstancedMesh) extras.add(object);
    });
  };
  capture();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    capture();
    const images = new Set(), failures = [];
    // Read the current image: mobile texture limiting may have closed and
    // replaced the original ImageBitmap since the first asset capture.
    for (const texture of textures) if (texture.source?.data?.close) images.add(texture.source.data);
    for (const resource of [...extras, ...textures, ...materials, ...geometries]) {
      try { resource.dispose?.(); } catch (failure) { failures.push(failure); }
    }
    for (const image of images) { try { image.close(); } catch (failure) { failures.push(failure); } }
    for (const resources of [roots, extras, textures, materials, geometries]) resources.clear();
    if (failures.length) throw new AggregateError(failures, '地图资源释放失败。');
  };
}

// Optional map-owned atmosphere, authored into the GLB. Legacy maps retain
// their current lighting; a new map need not borrow hotel reflections/rays.
export function prepareMapLighting(root, engine, THREE) {
  const spec = root.userData.ghLighting;
  if (!spec) return null;
  const gfx = engine.ctx.gfx, scene = gfx.scene, view = gfx.vmScene;
  const sky = root.getObjectByName(spec.sky), sun = root.getObjectByName(spec.sun);
  if (!sky?.material?.map || !sun?.isDirectionalLight) throw Error('地图天空或太阳光资产缺失。');
  const saved = { intensity: scene.environmentIntensity, viewEnvironment: view.environment,
    viewIntensity: view.environmentIntensity, shadowType: gfx.renderer.shadowMap.type };
  let target = null, disposed = false;
  const rebuild = () => {
    const source = sky.material.map.clone();
    source.mapping = THREE.EquirectangularReflectionMapping;
    const generator = new THREE.PMREMGenerator(gfx.renderer);
    try {
      const next = generator.fromEquirectangular(source);
      target?.dispose(); target = next;
    } finally { generator.dispose(); source.dispose(); }
  };
  rebuild();
  const beforeRender = () => {
    if (disposed) return;
    // Native hotel code rewrites view lighting every frame. Apply the active
    // map after that update and before the compositor renders either scene.
    scene.environment = view.environment = target.texture;
    scene.environmentIntensity = spec.environmentIntensity;
    view.environmentIntensity = spec.viewIntensity;
    if (!sky.position.equals(gfx.camera.position)) {
      sky.position.copy(gfx.camera.position);
      sky.updateMatrixWorld();
    }
    gfx.rayK = 0; // Hotel sunset rays use another sun direction and occlusion.
    // Native render() has already populated post-effect uniforms this frame.
    // Correct them before the world/effect passes, without wrapping render().
    if (gfx.rays) gfx.rays.uniforms.uK.value = 0;
    if (gfx.bloom) gfx.bloom.strength = .3;
  };
  const quality = () => {
    if (spec.filteredShadows) gfx.renderer.shadowMap.type = THREE.PCFShadowMap;
    const size = globalThis.GHBoot?.policy?.mobile || gfx.quality === 'low' ? 512 : 1024;
    root.traverse(light => {
      if (!light.shadow || !light.castShadow) return;
      if (light.shadow.mapSize.width !== size) {
        light.shadow.map?.dispose(); light.shadow.map = null;
        light.shadow.mapPass?.dispose(); light.shadow.mapPass = null;
        light.shadow.mapSize.set(size, size);
      }
      light.shadow.bias = size === 512 ? -.00065 : -.00045;
      light.shadow.normalBias = size === 512 ? .1 : .08;
      light.shadow.needsUpdate = true;
    });
    gfx.renderer.shadowMap.needsUpdate = true;
  };
  return {
    get environment() { return target.texture; },
    beforeRender, quality,
    recover() {
      if (disposed) return;
      // The scene adapter first captures the native map with our hooks paused.
      // Keep its new handles so leaving cannot restore pre-loss GPU resources.
      saved.intensity = scene.environmentIntensity;
      saved.viewEnvironment = view.environment; saved.viewIntensity = view.environmentIntensity;
      rebuild(); beforeRender(); quality();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.environmentIntensity = saved.intensity;
      view.environment = saved.viewEnvironment; view.environmentIntensity = saved.viewIntensity;
      gfx.renderer.shadowMap.type = gfx.q ? (gfx.q.soft ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap) : saved.shadowType;
      gfx.renderer.shadowMap.needsUpdate = true;
      target.dispose();
    },
  };
}

// Optional compact procedural/triplanar shaders for lightweight baked maps.
// Materials without these userData flags remain completely untouched.
const wireFenceGLSL = `
  varying vec3 vGhFenceWorld;
  const float ghWireFrac = 0.058;
  vec2 ghStripInt(vec2 x) { return floor(x) * ghWireFrac + min(fract(x), vec2(ghWireFrac)); }
  vec2 ghDiamond(vec2 p) { return vec2(p.x + p.y, p.x - p.y) / 0.15; }
  float ghFenceAlpha() {
    vec3 dx = dFdx(vGhFenceWorld), dy = dFdy(vGhFenceWorld);
    vec3 n = cross(dx, dy);
    vec3 right = abs(n.y) > 0.97 * length(n) ? vec3(1., 0., 0.) : normalize(vec3(n.z, 0., -n.x));
    vec3 up = normalize(cross(n, right));
    vec2 p = ghDiamond(vec2(dot(vGhFenceWorld, right), dot(vGhFenceWorld, up)));
    vec2 sx = ghDiamond(vec2(dot(dx, right), dot(dx, up)));
    vec2 sy = ghDiamond(vec2(dot(dy, right), dot(dy, up)));
    vec2 span = clamp(abs(sx) + abs(sy), vec2(0.001), vec2(1.0));
    vec2 center = fract(p + 0.5 * ghWireFrac);
    vec2 lanes = clamp((ghStripInt(center + 0.5 * span) - ghStripInt(center - 0.5 * span)) / span, 0.0, 1.0);
    return 1.0 - (1.0 - lanes.x) * (1.0 - lanes.y);
  }
`;

const triplanarDetailGLSL = `
  varying vec3 vGhWorld;
  varying float vGhTag;
  float ghPickChannel(vec4 s, int ch) {
    if (ch == 0) return s.r;
    if (ch == 1) return s.g;
    if (ch == 2) return s.b;
    return clamp((s.a - 0.42) / 0.58, 0.0, 1.0);
  }
  float ghTriplanar(sampler2D tex, vec3 p, vec3 an, int ch) {
    vec3 w = pow(an, vec3(4.0));
    w /= max(w.x + w.y + w.z, 1e-5);
    float sx = ghPickChannel(texture2D(tex, p.zy), ch);
    float sy = ghPickChannel(texture2D(tex, p.xz), ch);
    float sz = ghPickChannel(texture2D(tex, p.xy), ch);
    return sx * w.x + sy * w.y + sz * w.z;
  }
`;

export function applyMapMaterialExtensions(material) {
  if (!material) return;
  if (material.userData?.ghWireFence) {
    material.customProgramCacheKey = () => 'gh-wire-fence-v1';
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGhFenceWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGhFenceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + wireFenceGLSL)
        .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a = ghFenceAlpha();\nif (diffuseColor.a < 0.02) discard;');
    };
  } else if (material.userData?.ghTriplanarDetail && material.map) {
    const cfg = material.userData.ghTriplanarDetail;
    const sun = cfg.sunDir || [-0.43, 0.84, -0.33];
    material.customProgramCacheKey = () => 'gh-triplanar-detail-v1';
    material.onBeforeCompile = shader => {
      shader.uniforms.uGhDetailMap = { value: material.map };
      shader.uniforms.uGhSunDir = { value: { x: sun[0], y: sun[1], z: sun[2] } };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGhWorld;\nvarying float vGhTag;')
        .replace('#include <color_vertex>', `#include <color_vertex>
          vGhTag = 255.0;
          #ifdef USE_COLOR_ALPHA
            vGhTag = floor(color.a * 255.0 + 0.5);
            vColor.a = 1.0;
          #endif`)
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGhWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uGhDetailMap;\nuniform vec3 uGhSunDir;\n' + triplanarDetailGLSL)
        .replace('#include <map_fragment>', '')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 ghDx = dFdx(vGhWorld), ghDy = dFdy(vGhWorld);
          vec3 ghN = normalize(cross(ghDx, ghDy) + vec3(0.0, 1e-8, 0.0));
          vec3 ghAN = abs(ghN);
          int ghTag = int(floor(vGhTag + 0.5));
          int ghCh = 0;
          float ghScale = 0.34;
          float ghStrength = 0.24;
          if (ghTag == 3) { ghCh = 2; ghScale = 0.56; ghStrength = 0.30; }
          else if (ghTag == 2 || ghTag == 33) { ghCh = 3; ghScale = 0.46; ghStrength = 0.22; }
          else if (ghTag == 6) { ghCh = 3; ghScale = 0.50; ghStrength = 0.28; }
          else if (ghTag == 1 || ghTag == 5 || (ghTag > 250 && ghAN.y > 0.68)) { ghCh = 1; ghScale = 0.30; ghStrength = 0.25; }
          float ghFoot = max(length(ghDx), length(ghDy)) * ghScale;
          float ghFade = 1.0 - smoothstep(0.10, 0.45, ghFoot);
          float ghDetail = ghTriplanar(uGhDetailMap, vGhWorld * ghScale, ghAN, ghCh);
          float ghBump = clamp((dFdx(ghDetail) * 0.6 + dFdy(ghDetail) * 0.8) * 1.6 * ghFade, -0.10, 0.10);
          float ghShade = 0.93 + 0.09 * max(0.0, dot(ghN, normalize(uGhSunDir))) + 0.03 * ghN.y + ghBump;
          diffuseColor.rgb *= ghShade * (1.0 + (ghDetail - 0.55) * 2.0 * ghStrength * ghFade);`);
    };
  }
}

export async function prepareGltfScene(context) {
  const { engine, mapData, signal, onProgress } = context;
  const expected = `assets/maps/${mapData?.mapId}/${mapData?.version}/scene.glb`;
  if (mapData?.sceneAsset !== expected) throw Error("地图场景资源路径与版本不匹配。");
  const [THREE, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('../vendor/three-core.js'),
    import('../vendor/gltf-loader.js'),
    import('../vendor/meshopt-decoder.js'),
  ]);
  const url = new URL(mapData.sceneAsset, assetBase);
  onProgress?.({ stage: 'download', loaded: 0, total: mapData.sceneBytes });
  const buffer = await downloadSceneBuffer(url, mapData.sceneBytes, signal,
    (loaded, total) => onProgress?.({ stage: 'download', loaded, total }));
  onProgress?.({ stage: 'verify' });
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (buffer.byteLength !== mapData.sceneBytes || hash !== mapData.sceneSHA256)
    throw Error('地图模型与服务器版本不一致，请刷新页面更新资源。');
  signal?.throwIfAborted();
  onProgress?.({ stage: 'parse' });
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, new URL('.', url).href);
  const disposeScene = createSceneDisposer(gltf);
  let mixer, lighting, environmentDisposed = false;
  const disposeEnvironment = () => {
    if (environmentDisposed) return;
    environmentDisposed = true;
    try { lighting?.dispose(); }
    finally { mixer?.stopAllAction(); mixer?.uncacheRoot(gltf.scene); }
  };
  try {
    signal?.throwIfAborted();
    onProgress?.({ stage: 'textures' });
    if (globalThis.GHBoot?.policy?.mobile)
      await limitSceneTextures(gltf.scene, globalThis.GHBoot.policy.textureLimit || 512, globalThis.createImageBitmap, signal);
    const hemisphere = gltf.scene.userData.ghHemisphere;
    if (hemisphere) gltf.scene.add(new THREE.HemisphereLight(new THREE.Color(...hemisphere.sky),
      new THREE.Color(...hemisphere.ground), hemisphere.intensity));
    const shadowSize = engine.ctx.settings.quality === 'low' || globalThis.GHBoot?.policy?.mobile ? 512 : 1024;
    const paddedMapGeos = new WeakSet();
    gltf.scene.traverse(object => {
      Object.assign(object, object.userData.ghRender || {});
      if (object.isInstancedMesh) {
        if (object.geometry?.attributes?.position) {
          if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
          if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
        }
        object.computeBoundingSphere?.();
        object.frustumCulled = false;
      } else if (object.isSkinnedMesh) {
        object.frustumCulled = false;
      } else if (object.isMesh && object.geometry?.attributes?.position) {
        const geo = object.geometry;
        if (!geo.boundingSphere || !Number.isFinite(geo.boundingSphere.radius) || geo.boundingSphere.radius <= 0) {
          geo.computeBoundingBox();
          geo.computeBoundingSphere();
        }
        if (geo.boundingSphere && !paddedMapGeos.has(geo)) {
          paddedMapGeos.add(geo);
          const maxScale = Math.max(Math.abs(object.scale?.x || 1), Math.abs(object.scale?.y || 1), Math.abs(object.scale?.z || 1), 1e-3);
          const r = geo.boundingSphere.radius;
          geo.boundingSphere.radius = Math.max(r * 1.12, r + 0.30 / maxScale);
        }
      }
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material) {
          Object.assign(material, material.userData.ghRender || {});
          applyMapMaterialExtensions(material);
        }
      }
      if (object.userData.ghShader) {
        const spec = object.userData.ghShader;
        // The original material can be shared with another mesh. Its captured
        // resources stay owned by this map until the complete scene is released.
        object.material = new THREE.ShaderMaterial({ vertexShader: spec.vertex, fragmentShader: spec.fragment,
          uniforms: Object.fromEntries(Object.entries(spec.uniforms).map(([key, value]) => [key, { value }])),
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      }
      if (object.userData.ghPoints) {
        const spec = object.userData.ghPoints;
        Object.assign(object.material, { size: spec.size, opacity: spec.opacity, depthWrite: spec.depthWrite, blending: THREE.AdditiveBlending });
      }
      if (object.isLight && object.userData.ghLight) {
        if (Number.isFinite(object.userData.ghLight.decay)) object.decay = object.userData.ghLight.decay;
        if (object.shadow) {
          Object.assign(object.shadow, object.userData.ghLight.shadow);
          if (object.userData.ghLight.shadowCamera) {
            Object.assign(object.shadow.camera, object.userData.ghLight.shadowCamera);
            object.shadow.camera.updateProjectionMatrix();
          }
          object.shadow.mapSize.set(shadowSize, shadowSize);
          // Global shadow refresh is already budgeted by native quality.shadowHz.
          // Freezing each light here leaves moving characters' shadows behind.
          object.shadow.autoUpdate = true;
          object.shadow.needsUpdate = true;
        }
      }
    });
    mixer = gltf.animations.length ? new THREE.AnimationMixer(gltf.scene) : null;
    for (const clip of gltf.animations) mixer.clipAction(clip).play();
    lighting = prepareMapLighting(gltf.scene, engine, THREE);
    let previousTime = performance.now();
    return await prepareGltfSceneWith(context, async () => gltf, {
      get environment() { return lighting?.environment || (gltf.scene.userData.ghEnvironment === 'outdoor' ? engine.gh.G.envOut : null); },
      recover: lighting?.recover,
      beforeRender: lighting?.beforeRender,
      quality: lighting?.quality,
      background: (hex) => hex ? new THREE.Color(`#${hex}`) : null,
      fog: (hex, density) => hex && density > 0 ? new THREE.FogExp2(`#${hex}`, density) : null,
      update() {
        const now = performance.now(), dt = Math.min(.1, (now - previousTime) / 1000);
        previousTime = now;
        mixer?.update(dt);
      },
      dispose: disposeEnvironment,
    }, disposeScene);
  } catch (failure) {
    try { try { disposeEnvironment(); } finally { disposeScene(); } }
    finally { throw failure; }
  }
}

export async function prepareGltfSceneWith({ engine, mapData, signal }, loadScene, environmentFactory = {}, releaseScene) {
  const scene = engine?.ctx?.botCtx?.scene;
  const camera = engine?.ctx?.gfx?.camera;
  if (!scene?.traverse || !scene?.add || !scene?.remove || !camera || typeof loadScene !== "function")
    throw Error("当前渲染器无法切换地图场景。");

  const result = await loadScene(mapData);
  const root = result?.scene || result;
  const disposeScene = releaseScene || createSceneDisposer(result);
  if (!root?.traverse) {
    try { try { environmentFactory.dispose?.(); } finally { disposeScene(); } }
    finally { throw Error("地图 GLB 中没有可显示的场景。"); }
  }
  if (signal?.aborted) {
    try { environmentFactory.dispose?.(); } finally { disposeScene(); }
    signal.throwIfAborted();
  }
  let visibility, clearColor, clearAlpha;

  const background = scene.background;
  const fog = scene.fog;
  let environment = scene.environment;
  const onBeforeRender = scene.onBeforeRender;
  const gfx = engine.ctx.gfx;
  const renderer = gfx.renderer;
  const preRender = gfx.preRender;
  const onQuality = gfx.onQuality;
  const restoreEnvironment = gfx.restoreEnvironment;
  const mapFrame = gfx.mapFrame;
  let disposed = false;
  const restore = () => {
    visibility?.restore();
    scene.background = background;
    scene.fog = fog;
    scene.environment = environment;
    scene.onBeforeRender = onBeforeRender;
    gfx.preRender = preRender;
    gfx.onQuality = onQuality;
    gfx.mapFrame = mapFrame;
    if (gfx.restoreEnvironment === recoverEnvironment) gfx.restoreEnvironment = restoreEnvironment;
    if (clearColor) renderer.setClearColor(clearColor, clearAlpha);
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    try {
      try { scene.remove(root); }
      finally { try { environmentFactory.dispose?.(); } finally { disposeScene(); } }
    } finally { restore(); }
  };
  const recoverEnvironment = async function(...args) {
    // Native recovery renders hotel cubemaps asynchronously. Temporarily show
    // that map and suspend the active map's lighting/visibility callbacks;
    // otherwise each capture re-applies the lost map PMREM and hides the hotel.
    const active = { background: scene.background, fog: scene.fog, before: scene.onBeforeRender,
      preRender: gfx.preRender, quality: gfx.onQuality, visible: root.visible,
      clearColor: clearColor ? renderer.getClearColor(environmentFactory.background('000000')).clone() : null,
      clearAlpha: renderer?.getClearAlpha?.() };
    root.visible = false;
    visibility.show();
    scene.background = background; scene.fog = fog; scene.environment = environment;
    scene.onBeforeRender = onBeforeRender; gfx.preRender = preRender; gfx.onQuality = onQuality;
    if (clearColor) renderer.setClearColor(clearColor, clearAlpha);
    try {
      await restoreEnvironment?.apply(this, args);
      environment = scene.environment;
      if (!disposed) environmentFactory.recover?.();
    } finally {
      if (!disposed) {
        root.visible = active.visible;
        visibility.enforce();
        scene.background = active.background; scene.fog = active.fog;
        scene.environment = environmentFactory.environment || null;
        scene.onBeforeRender = active.before; gfx.preRender = active.preRender; gfx.onQuality = active.quality;
        if (active.clearColor) renderer.setClearColor(active.clearColor, active.clearAlpha);
      }
    }
  };
  const env = mapData?.environment || {};
  try {
    const layers = engine.sceneLayers || new SceneLayers(scene).share(camera).captureMap();
    visibility = layers.hideMap();
    clearColor = renderer?.getClearColor && environmentFactory.background ? renderer.getClearColor(environmentFactory.background('000000')).clone() : null;
    clearAlpha = renderer?.getClearAlpha?.();
    scene.add(root);
    if (environmentFactory.background) {
      const color = environmentFactory.background(env.background);
      // A Scene color forces a clear in Three's later transparent/effect pass,
      // erasing the world. Keep the background in the renderer's clear color.
      if (clearColor) { renderer.setClearColor(color, 1); scene.background = null; }
      else scene.background = color;
    }
    if (environmentFactory.fog) scene.fog = environmentFactory.fog(env.fogColor, env.fogDensity);
    scene.environment = environmentFactory.environment || null;
    // Hotel planar reflections and quality callbacks own hotel-only resources.
    gfx.preRender = null;
    gfx.onQuality = function(...args) { onQuality?.apply(this, args); visibility.enforce(); environmentFactory.quality?.(); };
    environmentFactory.quality?.();
    if (environmentFactory.update) gfx.mapFrame = () => environmentFactory.update();
    scene.onBeforeRender = function(...args) {
      onBeforeRender?.apply(this, args);
      visibility.enforce(); environmentFactory.beforeRender?.();
    };
    gfx.restoreEnvironment = recoverEnvironment;
  } catch (failure) {
    try { cleanup(); } finally { throw failure; }
  }
  return cleanup;
}
