// Optional weapon art loads after boot. Characters keep the native geometry,
// materials, animation, ragdoll and hit-volume ownership from the game bundle.
import { installM200Handling, prepareM200Gun } from './m200-handling.js';
const models = new URL('../assets/models/', import.meta.url);
const nativeShell = new Set(['metal', 'poly', 'furn', 'hardware', 'marks']);

function installCarbine(vm, scene) {
  const parts = Object.fromEntries(['Frame', 'Magazine', 'Stock', 'Muzzle'].map(name => [name, scene.getObjectByName(name)]));
  if (Object.values(parts).some(part => !part)) throw Error('卡宾枪模型缺少外观部件。');
  function apply(gun) {
    // Factory-shell replacements need the standard stock. Other stock shapes
    // and purchased camos retain their own authored surfaces.
    if (gun.id !== 'ar' || !gun.parts?.mag || gun.build.camo !== 'factory' || gun.build.stock !== 'std') return gun;
    const clearShell = node => {
      for (const child of [...node.children]) if (child.isMesh && nativeShell.has(child.name)) node.remove(child);
    };
    clearShell(gun.root);
    // Native folded sights were shaped for the old receiver's fixed bases.
    // The active optical mount and the selected iron sight stay on their
    // original sight line.
    if (gun.build.optic !== 'irons') {
      clearShell(gun.parts.buisFrontArm);
      clearShell(gun.parts.buisRearArm);
    }
    const frame = parts.Frame.clone();
    frame.name = 'hotel-carbine-frame';
    gun.root.add(frame, parts.Stock.clone());
    if (gun.build.muzzle === 'none') gun.root.add(parts.Muzzle.clone());
    if (gun.build.magazine === 'std') {
      const mag = parts.Magazine.clone();
      mag.position.set(0, 0, 0);
      clearShell(gun.parts.mag);
      gun.parts.mag.add(mag);
    }
    return gun;
  }
  const build = vm.ctx.buildGun.bind(vm.ctx);
  vm.ctx.buildGun = (...args) => apply(build(...args));
  for (const gun of Object.values(vm.guns)) apply(gun);
}

const m200Slots = {
  Optic: 'optic', Muzzle: 'muzzle', Bipod: 'underbarrel', Magazine: 'magazine', Stock: 'stock',
};
// Eye-relief distances (adsDist) stop each optic's rear ocular ring 6.4-7.1 cm
// in front of vmCamera (near = 0.01 m) so the 3D scope never clips the camera
// near plane and matches the #m200-scope overlay aperture diameter at full ADS.
export const m200Sights = {
  m200prism: { line: [0, .1025, -.068], eye: [0, .1025, .126], adsDist: .172, rearZ: .0394, lensZ: .0370, lensR: .0118 },
  m200long: { line: [0, .1201, -.15], eye: [0, .1201, .23], adsDist: .360, rearZ: .1393, lensZ: .1348, lensR: .0146 },
};
export const m200FactorySight = { line: [0, .1113, -.13], eye: [0, .1113, .23], adsDist: .393, rearZ: .1987, lensZ: .1715, lensR: .0142 };
const m200MuzzleEnds = { m200quiet: -.945, m200brake: -.86 };

const smoothStep = (start, end, value) => {
  const k = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return k * k * (3 - 2 * k);
};

export function m200ScopeState(adsK, active = true) {
  const k = active && Number.isFinite(adsK) ? Math.max(0, Math.min(1, adsK)) : 0;
  const portalOpen = smoothStep(.16, .64, k);
  const scopeBlend = smoothStep(.68, .94, k);
  return {
    portalActive: k > .14,
    veilOpacity: 1 - portalOpen * .94,
    lensOpacity: .92 * (1 - portalOpen * .9),
    scopeBlend,
    scopeScale: .93 + .07 * scopeBlend,
    hideRig: scopeBlend >= .985,
  };
}

function attachM200OcularPortal(GH, model, sight) {
  const opticGroup = model.getObjectByName('Optic');
  if (!opticGroup) return null;
  let lensMesh = null;
  opticGroup.traverse(node => {
    if (node.isMesh && (node.material?.name === 'Blue-green optical coating' || String(node.name).includes('Blue-green optical coating'))) {
      lensMesh = node;
    }
  });
  if (lensMesh?.material?.clone) {
    lensMesh.material = lensMesh.material.clone();
    lensMesh.material.transparent = true;
    lensMesh.material.depthWrite = false;
    lensMesh.material.opacity = .92;
    lensMesh.renderOrder = 9;
  }
  let apertureMask = null;
  let lensVeil = null;
  const T = GH?.three;
  if (T?.CircleGeometry && T?.Mesh && T?.MeshBasicMaterial) {
    const maskGeo = new T.CircleGeometry(sight.lensR, 32);
    maskGeo.clearGroups();
    maskGeo.addGroup(0, Infinity, 1);
    // Material[0] is transparent so vmBlur skips velocity writes inside the
    // ocular aperture; group 0->material[1] writes depth first in vmPass so
    // solid interior scope geometry behind the rear lens is cleanly culled.
    const skipBlurMat = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    const depthPunchMat = new T.MeshBasicMaterial({ transparent: false, colorWrite: false, depthWrite: true, depthTest: true });
    apertureMask = new T.Mesh(maskGeo, [skipBlurMat, depthPunchMat]);
    apertureMask.name = 'M200OcularMask';
    apertureMask.position.set(0, sight.line[1], sight.lensZ);
    apertureMask.renderOrder = -10;
    apertureMask.frustumCulled = false;
    apertureMask.visible = false;

    const veilMat = new T.MeshBasicMaterial({
      color: 0x0e1920, transparent: true, opacity: 1, depthWrite: false, depthTest: true, fog: false,
    });
    lensVeil = new T.Mesh(new T.CircleGeometry(sight.lensR, 32), veilMat);
    lensVeil.name = 'M200OcularVeil';
    lensVeil.position.set(0, sight.line[1], sight.lensZ + .0004);
    lensVeil.renderOrder = 8;
    lensVeil.frustumCulled = false;
    lensVeil.visible = false;
    opticGroup.add(apertureMask, lensVeil);
  }
  return {
    lensMesh,
    apertureMask,
    lensVeil,
    apply(state) {
      if (apertureMask) apertureMask.visible = state.portalActive;
      if (lensVeil) {
        lensVeil.visible = state.portalActive;
        lensVeil.material.opacity = state.veilOpacity;
      }
      if (lensMesh?.material) lensMesh.material.opacity = state.lensOpacity;
    },
  };
}

function installM200Scope(GH, vm) {
  const doc = globalThis.document;
  const hud = doc?.getElementById('hud');
  if (!vm.update) return;
  let scope = null;
  if (hud && doc?.createElement) {
    scope = doc.createElement('div');
    scope.id = 'm200-scope';
    scope.hidden = true;
    scope.setAttribute('aria-hidden', 'true');
    hud.prepend(scope);
  }
  let lastPortal = null;
  const update = vm.update.bind(vm);
  vm.update = (dt, player, arsenal) => {
    if (vm.id === 'm200' && player?.alive) {
      // Replace the sharp iron-sight shoulder jolt at ADS endpoints with a
      // subtle heavy-rifle settle so the ocular ring does not kick off-axis.
      if (player.adsK >= 1 && vm.adsPrev < 1) {
        vm.adsPrev = 1;
        vm.sp?.rz?.hit(.035);
        vm.sp?.py?.hit(-.008);
      } else if (player.adsK <= 0 && vm.adsPrev > 0) {
        vm.adsPrev = 0;
        vm.sp?.rz?.hit(-.04);
        vm.sp?.py?.hit(-.01);
      }
    }
    update(dt, player, arsenal);
    if (vm.id === 'm200' && Number.isFinite(vm.adsArc)) {
      vm.adsArc *= 1 - .58 * smoothStep(.32, .85, player?.adsK ?? 0);
    }
    const active = vm.id === 'm200' && Boolean(player?.alive) && GH.G?.state === 'playing';
    const state = m200ScopeState(player?.adsK ?? 0, active);
    const portal = active ? vm.gun?.m200Portal ?? null : null;
    if (lastPortal && lastPortal !== portal) lastPortal.apply(m200ScopeState(0, false));
    if (portal) portal.apply(state);
    lastPortal = portal;
    if (scope) {
      const visible = state.scopeBlend > .001;
      if (scope.hidden === visible) scope.hidden = !visible;
      if (visible) {
        const optic = vm.gun?.build?.optic ?? 'm200scope';
        if (scope.dataset.optic !== optic) scope.dataset.optic = optic;
        scope.style.opacity = state.scopeBlend.toFixed(3);
        scope.style.setProperty('--scope-scale', state.scopeScale.toFixed(4));
      } else {
        scope.style.opacity = '0';
      }
    }
    if (state.hideRig && vm.rig) vm.rig.visible = false;
  };
}

function installM200(GH, { scene, scenes = [] }) {
  const { vm, ctx, m200Art } = GH.debug;
  const factory = scene.getObjectByName('M200_Intervention');
  const variants = scenes.find(candidate => candidate.name === 'M200_attachments');
  const projected = new WeakMap();
  function buildModel(build) {
    if (!factory) return scene.clone(true);
    const model = factory.clone(false);
    for (const part of factory.children) {
      const choice = variants?.getObjectByName(build[m200Slots[part.name]]) ?? part;
      const copy = choice.clone(true);
      copy.name = part.name;
      model.add(copy);
    }
    if (m200Art && build.camo && build.camo !== 'factory') {
      model.traverse(mesh => {
        const surface = mesh.userData.camoSurface;
        if (!mesh.isMesh || !surface) return;
        const material = m200Art.camo(build.camo, surface);
        if (!material) return;
        const source = mesh.geometry;
        if (!projected.has(source)) projected.set(source, m200Art.project(source.clone()));
        mesh.geometry = projected.get(source);
        mesh.material = material;
      });
    }
    return model;
  }
  const menus = ctx?.hud?.menus;
  const studio = menus?.studio;
  const keepNative = new Set(['armR', 'armL', 'frag', 'fragInHand', 'mag']);
  function apply(gun, build = {}, isViewModel = false) {
    if (gun.root.name === 'M200 Intervention') return gun;
    for (const child of [...gun.root.children]) {
      if (keepNative.has(child.name) || child === vm.flashGroup || child === vm.laserBeam) continue;
      child.visible = false;
      const shell = [];
      child.traverse(object => { if (object.isMesh) shell.push(object); });
      for (const mesh of shell) mesh.removeFromParent();
    }
    gun.id = 'm200';
    gun.root.name = 'M200 Intervention';
    gun.build = build;
    const model = buildModel(build);
    gun.root.add(model);
    const mag = gun.parts?.mag;
    const magazine = model.getObjectByName('Magazine');
    if (mag && magazine) {
      mag.clear();
      // Transfer the display mesh into the native animated magazine group.
      gun.root.updateWorldMatrix(true, true);
      mag.attach(magazine);
    }
    const sight = m200Sights[build.optic] ?? m200FactorySight;
    const muzzle = m200MuzzleEnds[build.muzzle] ?? -.84;
    gun.anchors.muzzle.set(0, .04, muzzle);
    gun.anchors.sight.set(...sight.line);
    gun.mounts?.optic?.position.set(0, sight.line[1], -.055);
    gun.mounts?.muzzle?.position.set(0, .04, muzzle + .014);
    gun.mounts?.underbarrel?.position.set(0, -0.017, -0.30);
    gun.anchors.eject?.set(0.037, 0.044, -0.02);
    gun.anchors.eye?.set(...sight.eye);
    gun.anchors.gripR?.position.set(0.014, -0.044, 0.13);
    gun.anchors.gripL?.position.set(-0.023, -0.022, -0.26);
    gun.hip?.pos.set(0.1, -0.16, -0.32);
    gun.adsDist = sight.adsDist;
    if (isViewModel) {
      gun.m200Portal = attachM200OcularPortal(GH, model, sight);
      if (typeof gun.update === 'function') {
        const baseUpdate = gun.update.bind(gun);
        const levelQuat = vm.pose?.quaternion?.clone?.() ?? null;
        if (levelQuat) levelQuat.identity();
        gun.update = (dt, gs) => {
          const ars = GH.debug?.arsenal;
          const canAlign = !ars || ars.state === 'ready' || ars.state === 'draw';
          const ads = canAlign ? (gs?.ads ?? 0) : 0;
          const sinceFire = ars?.sinceFire ?? 9;
          const settle = smoothStep(.24, .86, ads) * smoothStep(.06, .24, sinceFire) * (1 - Math.min(1, gs?.sprint ?? 0));
          if (settle > 1e-3 && vm.pose) {
            // Bring cheek-weld X/Y onto the optical axis slightly ahead of Z
            // eye relief so the 3D ocular ring frames screen center cleanly.
            vm.pose.position.x += (-sight.line[0] - vm.pose.position.x) * settle * .8;
            vm.pose.position.y += (-sight.line[1] - vm.pose.position.y) * settle * .8;
            if (levelQuat && vm.pose.quaternion?.slerp) vm.pose.quaternion.slerp(levelQuat, settle * .72);
            vm.rig?.updateMatrixWorld?.(true);
          }
          return baseUpdate(dt, gs);
        };
      }
    }
    if (gun.clips && gun.anchors.gripR) prepareM200Gun(gun);
    return gun;
  }
  function patchBuilder(owner, key) {
    const build = owner[key].bind(owner);
    owner[key] = (id, options) => {
      if (id !== 'm200') return build(id, options);
      // The native shell only supplies movement and animation. The chosen
      // M200 parts and camo come from its own build and shared finish library.
      const body = { optic: 'irons', muzzle: 'none', underbarrel: 'none', magazine: 'std', stock: 'std', camo: 'factory' };
      if (key === 'worldGun') return apply(build('ar', body), options ?? {}, false);
      const isViewModel = owner === vm.ctx && options?.detail === 'view';
      return apply(build('ar', { ...options, build: body }), options?.build ?? m200Art?.build(id), isViewModel);
    };
  }
  patchBuilder(vm.ctx, 'buildGun');
  if (GH.debug.arsenal) installM200Handling(GH);
  installM200Scope(GH, vm);
  const activeBuild = vm.id === 'm200' ? vm.gun?.build : null;
  for (const [key, gun] of Object.entries(vm.guns)) {
    if (gun.id !== 'm200') continue;
    const build = gun.build ?? m200Art?.build('m200') ?? {};
    // A saved M200 primary can enter the cache before this optional model
    // loads. Rebuild it through the AR animation shell to obtain both arms.
    if (vm.build && vm.show) {
      gun.root.removeFromParent();
      delete vm.guns[key];
      vm.build(['m200'], { m200: build });
    } else apply(gun, build, true);
  }
  if (activeBuild && vm.show) {
    vm.show('m200', activeBuild);
    const arsenal = GH.debug.arsenal;
    if (arsenal?.clip) {
      arsenal.clip = vm.gun.clips[arsenal.clipName] ?? null;
      arsenal.clipDur = arsenal.clip?.duration ?? arsenal.clipDur;
    }
  }
  if (ctx?.botCtx?.worldGun) patchBuilder(ctx.botCtx, 'worldGun');
  if (!studio) return;

  patchBuilder(studio, 'buildGun');
  const refreshM200Studio = () => {
    for (const key of studio.items.keys()) {
      if (!key.startsWith('m200|')) continue;
      studio.pivot.remove(studio.items.get(key).holder);
      studio.items.delete(key);
      studio.flat.delete(key);
      studio.cards.delete(key);
    }
    studio.flat.delete('m200');
    delete studio.shaded.m200;
    const icon = studio.icons('m200');
    if (icon) {
      studio.flat.set('m200', icon);
      const tab = menus.pages?.gunsmith?.querySelector?.('[data-w="m200"] img');
      if (tab) tab.src = icon.line;
    }
    if (menus.page === 'gunsmith' && menus.gs?.w === 'm200') menus._gsRender?.(false);
  };
  if (menus.page === 'gunsmith') {
    refreshM200Studio();
  } else if (typeof menus.go === 'function') {
    const baseGo = menus.go.bind(menus);
    let refreshed = false;
    menus.go = (page, ...rest) => {
      const result = baseGo(page, ...rest);
      if (page === 'gunsmith' && !refreshed) {
        refreshed = true;
        refreshM200Studio();
      }
      return result;
    };
  }
}

const rpkSlots = {
  Receiver: 'receiver', Optic: 'optic', Muzzle: 'muzzle', Bipod: 'underbarrel', Magazine: 'magazine', Stock: 'stock',
};

function installRPK(GH, { scene, scenes = [] }) {
  const { vm, ctx, rpkArt, m200Art } = GH.debug;
  const factory = scene.getObjectByName('RPK_74');
  if (!factory) throw Error('RPK 模型缺少工厂外观。');
  const variants = scenes.find(candidate => candidate.name === 'RPK attachments');
  const projected = new WeakMap();
  function buildModel(build) {
    const model = factory.clone(false);
    for (const source of factory.children) {
      const variant = variants?.getObjectByName(build[rpkSlots[source.name]]) ?? source;
      const copy = variant.clone(true);
      copy.name = source.name;
      model.add(copy);
    }
    if (m200Art && build.camo && build.camo !== 'factory') {
      model.traverse(mesh => {
        const surface = mesh.userData.camoSurface;
        if (!mesh.isMesh || !surface) return;
        const material = m200Art.camo(build.camo, surface);
        if (!material) return;
        const source = mesh.geometry;
        if (!projected.has(source)) projected.set(source, m200Art.project(source.clone()));
        mesh.geometry = projected.get(source);
        mesh.material = material;
      });
    }
    return model;
  }
  const menus = ctx?.hud?.menus;
  const studio = menus?.studio;
  function apply(gun, build = {}) {
    if (gun.root.name === 'RPK') return gun;
    for (const child of [...gun.root.children]) {
      if (['armR', 'armL', 'frag', 'fragInHand', 'mag'].includes(child.name) || child === vm.flashGroup || child === vm.laserBeam) continue;
      child.visible = false;
      const meshes = [];
      child.traverse(object => { if (object.isMesh) meshes.push(object); });
      for (const mesh of meshes) mesh.removeFromParent();
    }
    gun.id = 'rpk';
    gun.root.name = 'RPK';
    gun.build = build;
    gun.root.add(buildModel(build));
    const magazine = gun.root.getObjectByName('Magazine');
    if (gun.parts?.mag && magazine) {
      gun.parts.mag.clear();
      gun.root.updateWorldMatrix(true, true);
      gun.parts.mag.attach(magazine);
    }
    gun.anchors.muzzle.set(0, .066, build.muzzle === 'rpkquiet' ? -1.073 : -.975);
    gun.anchors.sight.set(0, build.optic === 'rpkscope' ? .163 : .145, -.145);
    gun.anchors.gripR?.position.set(.014, -.044, .13);
    gun.anchors.gripL?.position.set(-.023, -.022, -.30);
    gun.hip?.pos.set(.08, -.14, -.39);
    gun.adsDist = .08;
    return gun;
  }
  function patchBuilder(owner, key) {
    const build = owner[key].bind(owner);
    owner[key] = (id, options) => {
      if (id !== 'rpk') return build(id, options);
      const body = { optic: 'irons', muzzle: 'none', underbarrel: 'rpkbipod', magazine: 'rpk40', stock: 'rpkwood', camo: 'factory' };
      if (key === 'worldGun') return apply(build('ar', body), options ?? {});
      return apply(build('ar', { ...options, build: body }), options?.build ?? rpkArt?.build(id));
    };
  }
  patchBuilder(vm.ctx, 'buildGun');
  if (ctx?.botCtx?.worldGun) patchBuilder(ctx.botCtx, 'worldGun');
  const activeBuild = vm.id === 'rpk' ? vm.gun.build : null;
  for (const [key, gun] of Object.entries(vm.guns)) {
    if (gun.id !== 'rpk') continue;
    const build = gun.build ?? rpkArt?.build('rpk') ?? {};
    if (vm.build && vm.show) {
      gun.root.removeFromParent();
      delete vm.guns[key];
      vm.build(['rpk'], { rpk: build });
    } else apply(gun, build);
  }
  if (activeBuild && vm.show) vm.show('rpk', activeBuild);
  if (!studio) return;
  patchBuilder(studio, 'buildGun');
  const refreshRPKStudio = () => {
    for (const key of studio.items.keys()) {
      if (!key.startsWith('rpk|')) continue;
      studio.pivot.remove(studio.items.get(key).holder);
      studio.items.delete(key);
      studio.flat.delete(key);
      studio.cards.delete(key);
    }
    studio.flat.delete('rpk');
    delete studio.shaded.rpk;
    const icon = studio.icons('rpk');
    if (icon) {
      studio.flat.set('rpk', icon);
      const tab = menus.pages?.gunsmith?.querySelector?.('[data-w="rpk"] img');
      if (tab) tab.src = icon.line;
    }
    if (menus.page === 'gunsmith' && menus.gs?.w === 'rpk') menus._gsRender?.(false);
  };
  if (menus.page === 'gunsmith') {
    refreshRPKStudio();
  } else if (typeof menus.go === 'function') {
    const baseGo = menus.go.bind(menus);
    let refreshed = false;
    menus.go = (page, ...rest) => {
      const result = baseGo(page, ...rest);
      if (page === 'gunsmith' && !refreshed) {
        refreshed = true;
        refreshRPKStudio();
      }
      return result;
    };
  }
}

export function installCombatModels(GH, injected = {}) {
  const loader = injected.load ? null : Promise.all([import('./vendor/gltf-loader.js'), import('./vendor/meshopt-decoder.js')])
    .then(([{GLTFLoader}, {MeshoptDecoder}]) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder));
  const load = injected.load ?? (name => loader.then(value => value.loadAsync(new URL(name, models).href)));
  const report = (name, promise) => promise.then(() => true, error => {
    console.warn(name + '模型未载入，使用原有外观。', error);
    return false;
  });
  GH.combatModels = Promise.all([
    report('卡宾枪', load('hotel-carbine.glb').then(({scene}) => installCarbine(GH.debug.vm, scene))),
    report('M200', load('m200.glb').then(asset => installM200(GH, asset))),
    report('RPK', load('rpk.glb').then(asset => installRPK(GH, asset))),
  ]).then(([carbine, m200, rpk]) => ({ operator: true, carbine, m200, rpk }));
}
