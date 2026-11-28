import { createSceneDisposer } from '../maps/gltf-scene.js';
import { downloadSceneBuffer } from '../maps/scene-download.js';
import { prepareTeamHud } from './teams.js';

const kinds = ['walker', 'runner', 'brute'];
const poolLimits = [16, 4, 2];
const places = {
  P1: '供电大厅', P2: '北侧通信站', P3: '中央撤离场',
  A2: '弹药补给', A3: '弹药补给', M1: '医疗补给', M2: '医疗补给',
};
const angleDelta = (target, source) => Math.atan2(Math.sin(target - source), Math.cos(target - source));

export function zombieLobby() {
  return [{ id: 0, name: '灰港行动小队', capacity: 4 }];
}

async function loadRigs({ mapData, signal, onProgress }, low) {
  const base = new URL('../../' + mapData.sceneAsset, import.meta.url);
  const [THREE, { GLTFLoader }, { MeshoptDecoder }, response] = await Promise.all([
    import('../vendor/three-core.js'),
    import('../vendor/gltf-loader.js'),
    import('../vendor/meshopt-decoder.js'),
    fetch(new URL('actors.json', base), { signal }),
  ]);
  if (!response.ok) throw Error('无法读取灰港感染者资源。');
  const manifest = await response.json();
  onProgress?.({ stage: 'actors' });
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const rigs = kinds.map(() => ({}));
  const tasks = kinds.flatMap((kind, index) => (low ? [3] : [3, 2]).map(async lod => {
    const entry = manifest[kind]?.[lod];
    if (entry?.file !== `${kind}-lod${lod}.glb` || !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 20 || entry.bytes > 2000000 || !/^[a-f0-9]{64}$/.test(entry.sha256))
      throw Error('感染者资源清单无效。');
    const bytes = await downloadSceneBuffer(new URL(entry.file, base), entry.bytes, signal);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      byte => byte.toString(16).padStart(2, '0')).join('');
    if (entry.sha256 !== hash || bytes.byteLength !== entry.bytes) throw Error('感染者资源版本不匹配。');
    signal?.throwIfAborted();
    const gltf = await loader.parseAsync(bytes, new URL('.', base).href);
    rigs[index][lod] = { root: gltf.scene, dispose: createSceneDisposer(gltf) };
    gltf.scene.traverse(node => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material.vertexColors) material.color.setRGB(1, 1, 1);
        material.roughness = Math.max(.68, material.roughness || 0);
      }
    });
  }));
  const results = await Promise.allSettled(tasks);
  const dispose = () => rigs.forEach(lods => Object.values(lods).forEach(rig => rig.dispose()));
  const failure = results.find(item => item.status === 'rejected');
  if (failure || signal?.aborted) {
    dispose();
    if (failure) throw failure.reason;
    signal.throwIfAborted();
  }
  return { THREE, rigs, dispose };
}

function cloneRig(template, root) {
  const copy = template.clone(true);
  const copiedNodes = new Map(), originals = [];
  template.traverse(node => originals.push(node));
  let index = 0;
  copy.traverse(node => copiedNodes.set(originals[index++], node));
  const bones = {}, rest = {}, skeletons = new Set();
  for (const [source, node] of copiedNodes) {
    if (node.isBone) {
      bones[node.name] = node;
      rest[node.name] = node.quaternion.clone();
    }
    if (node.isSkinnedMesh) {
      const { skeleton } = source;
      node.skeleton = skeleton.clone();
      node.skeleton.bones = skeleton.bones.map(bone => copiedNodes.get(bone));
      node.bind(node.skeleton, source.bindMatrix);
      skeletons.add(node.skeleton);
      node.frustumCulled = false;
      node.castShadow = false;
    }
  }
  root.add(copy);
  return { copy, bones, rest, skeletons };
}

function createActors(engine, assets) {
  const { THREE, rigs } = assets;
  const scene = engine.ctx.gfx.scene;
  const root = new THREE.Group();
  root.name = 'grayharbor-infected';
  scene.add(root);
  engine.sceneLayers?.share(root);
  const pools = kinds.map(() => []);
  const active = new Map(), killed = new Map();
  const offset = new THREE.Vector3(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler();
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4();
  const camera = engine.ctx.gfx.camera;
  const shadowGeometry = new THREE.PlaneGeometry(1.45, 1.45);
  shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMaterial = new THREE.ShaderMaterial({
    uniforms: {}, transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 p;void main(){p=uv*2.0-1.0; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 p;void main(){gl_FragColor=vec4(0.015,0.018,0.024,0.24*(1.0-smoothstep(0.08,1.0,length(p*vec2(1.1,0.9)))));}',
  });
  const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, 16);
  const matrix = new THREE.Matrix4();
  shadows.count = 0;
  shadows.frustumCulled = false;
  root.add(shadows);
  let frameTime = 0, lastTick = -1, nextLod = 0;
  const highDetail = new Set(), candidates = [];

  function destroy(actor) {
    actor.root.removeFromParent();
    for (const rig of Object.values(actor.variants)) {
      for (const skeleton of rig.skeletons) skeleton.dispose();
    }
  }

  function release(actor) {
    active.delete(actor.id);
    actor.root.visible = false;
    const pool = pools[actor.kind];
    if (pool.length < poolLimits[actor.kind]) pool.push(actor);
    else destroy(actor);
  }

  function acquire(state) {
    const pool = pools[state.kind], reuse = pool.pop();
    const actor = reuse || { root: new THREE.Group(), variants: {} };
    if (!reuse) root.add(actor.root);
    Object.assign(actor, { id: state.id, kind: state.kind, state, lostAt: 0, death: 0, flinch: 0,
      step: (state.id % 11) * .57, poseAt: 0, strikeAt: state.attacking ? frameTime : 0,
      stride: 0, yaw: state.yaw, targetAge: frameTime });
    actor.root.position.set(state.x, state.y, state.z);
    actor.root.rotation.set(0, state.yaw, 0);
    active.set(state.id, actor);
    nextLod = 0;
    return actor;
  }

  function reset() {
    for (const actor of active.values()) release(actor);
    killed.clear();
    highDetail.clear();
    candidates.length = 0;
    nextLod = 0;
    shadows.count = 0;
    lastTick = -1;
  }

  function snapshot(s) {
    if (s.tick === lastTick) return;
    lastTick = s.tick;
    if (s.phase !== 'live') {
      if (active.size || killed.size) reset();
      return;
    }
    const seen = new Set();
    for (const state of s.zombies || []) {
      if (killed.has(state.id)) continue;
      seen.add(state.id);
      const actor = active.get(state.id) || acquire(state);
      if (state.attacking && !actor.state.attacking) actor.strikeAt = frameTime;
      actor.state = state;
      actor.lostAt = 0;
      actor.targetAge = frameTime;
    }
    for (const actor of active.values()) {
      if (!seen.has(actor.id) && !actor.death && !actor.lostAt) actor.lostAt = frameTime + .16;
    }
  }

  function pose(actor, rig, time) {
    const { bones, rest } = rig;
    const rotate = (name, x = 0, y = 0, z = 0) => {
      if (bones[name]) bones[name].quaternion.copy(rest[name]).multiply(quaternion.setFromEuler(euler.set(x, y, z)));
    };
    const fast = actor.kind === 1, heavy = actor.kind === 2;
    const osc = Math.sin(actor.step), stride = actor.stride;
    const attackAge = actor.state.attacking ? time - actor.strikeAt : 1;
    const swing = attackAge < .27 ? Math.sin(attackAge / .27 * Math.PI / 2) * -.48 :
      attackAge < .73 ? Math.sin((attackAge - .27) / .46 * Math.PI) : 0;
    const flinch = Math.max(0, 1 - (time - actor.flinch) * 7) * (actor.flinch > 0 ? 1 : 0);
    if (bones.hips) {
      bones.hips.position.y = actor.hipRest + (.012 + .032 * stride) * Math.abs(osc) - .035 * stride;
      rotate('hips', 0, osc * stride * .05, osc * stride * .045);
    }
    rotate('spine', (fast ? .20 : .11) - swing * .28 + flinch * .24);
    rotate('chest', swing * -.19, osc * stride * .12, Math.sin(actor.step * .5) * .07);
    rotate('head', -.06 + Math.cos(actor.step * .5) * .065, osc * .055);
    rotate('jaw', -.06 - Math.abs(swing) * .25);
    rotate('thighL', osc * stride * (fast ? .7 : .46));
    rotate('thighR', -osc * stride * (fast ? .7 : .46));
    rotate('shinL', -Math.max(0, -osc) * stride * .72);
    rotate('shinR', -Math.max(0, osc) * stride * .72);
    rotate('armL', .27 - osc * stride * .34 + swing * 1.10, 0, -.51 + swing * .16);
    rotate('armR', (heavy ? .36 : .13) + osc * stride * .37 + swing * 1.29, 0, .53 - swing * .17);
    rotate('foreL', -.47 + swing * .8, 0, -.20);
    rotate('foreR', -.43 + swing * .83, 0, .19);
  }

  function update(dt) {
    const time = performance.now() / 1000;
    frameTime = time;
    if (engine.lastSnapshot) snapshot(engine.lastSnapshot);
    if (!active.size) return;
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection);
    if (time >= nextLod) {
      nextLod = time + .18;
      candidates.length = 0;
      const quality = engine.ctx.gfx.quality;
      const budget = quality === 'low' ? 0 : quality === 'medium' ? 4 : 6;
      if (budget) {
        for (const actor of active.values()) {
          if (!rigs[actor.kind][2]) continue;
          const distance = actor.root.position.distanceToSquared(camera.position);
          if (distance >= 29 ** 2) continue;
          offset.copy(actor.root.position).y += .95;
          if (frustum.planes.some(plane => plane.distanceToPoint(offset) < -1.4)) continue;
          actor.lodPriority = distance * (highDetail.has(actor.id) ? .9 : 1);
          candidates.push(actor);
        }
        candidates.sort((a, b) => a.lodPriority - b.lodPriority || a.id - b.id);
      }
      highDetail.clear();
      for (let index = 0; index < Math.min(budget, candidates.length); index++)
        highDetail.add(candidates[index].id);
    }
    let shadowCount = 0;
    for (const [id, until] of killed) if (until < time) killed.delete(id);
    for (const actor of active.values()) {
      if ((actor.lostAt && time >= actor.lostAt) || (actor.death && time - actor.death >= 1.15)) {
        release(actor);
        continue;
      }
      const state = actor.state, position = actor.root.position;
      const blend = 1 - Math.exp(-Math.min(dt, .08) * 19);
      if (!actor.death) {
        offset.set(state.x, state.y, state.z);
        if (offset.distanceToSquared(position) > 20) position.copy(offset);
        else position.lerp(offset, blend);
        actor.yaw += angleDelta(state.yaw, actor.yaw) * blend;
      }
      const distance = position.distanceToSquared(camera.position);
      offset.copy(position).y += .95;
      // Expanded boundary keeps limbs visible at the edge of the screen.
      actor.root.visible = distance < 125 ** 2 && frustum.planes.every(plane => plane.distanceToPoint(offset) > -1.4);
      if (!actor.root.visible) continue;
      const lod = highDetail.has(actor.id) ? 2 : 3;
      if (!actor.variants[lod]) {
        const variant = actor.variants[lod] = cloneRig(rigs[actor.kind][lod].root, actor.root);
        variant.copy.rotation.y = Math.PI;
        variant.hipRest = variant.bones.hips?.position.y || 0;
      }
      if (actor.variants[2]) actor.variants[2].copy.visible = lod === 2;
      if (actor.variants[3]) actor.variants[3].copy.visible = lod === 3;
      const fall = actor.death ? Math.min(1, (time - actor.death) / .37) : 0;
      actor.root.rotation.set(-Math.sin(fall * Math.PI / 2) * 1.48, actor.yaw, 0, 'YXZ');
      if (actor.death && fall < 1) position.y = state.y + fall * .09;
      actor.stride += ((state.moving && !actor.death ? 1 : 0) - actor.stride) * blend;
      actor.step += Math.min(dt, .1) * (1.4 + actor.stride * (actor.kind === 1 ? 11.8 : 7.1));
      if (time >= actor.poseAt || actor.lod !== lod) {
        actor.poseAt = time + (distance < 20 ** 2 ? .032 : distance < 45 ** 2 ? .060 : .125);
        actor.lod = lod;
        const variant = actor.variants[lod];
        actor.hipRest = variant.hipRest;
        pose(actor, variant, time);
      }
      if (shadowCount < 16 && distance < 48 ** 2) {
        matrix.makeTranslation(position.x, state.y + .022, position.z);
        shadows.setMatrixAt(shadowCount++, matrix);
      }
    }
    shadows.count = shadowCount;
    if (shadowCount) shadows.instanceMatrix.needsUpdate = true;
  }

  function hit(event) {
    const time = performance.now() / 1000;
    const actor = active.get(event.id);
    if (actor) {
      actor.flinch = time;
      if (event.kill) {
        actor.death = time;
        actor.lostAt = 0;
      }
    }
    if (event.kill) killed.set(event.id, time + 1.5);
  }
  return {
    update, hit, reset,
    dispose() {
      reset();
      for (const pool of pools) for (const actor of pool) destroy(actor);
      engine.sceneLayers?.forget(root);
      root.removeFromParent();
      shadows.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
    },
  };
}

function prepareHud({ engine, room }, onInteract) {
  const hud = engine.ctx.hud;
  const cleanup = prepareTeamHud({ engine, room });
  document.body.classList.add('coop-session');
  const block = document.createElement('aside');
  block.className = 'coop-hud';
  block.hidden = true;
  block.innerHTML = '<div class="coop-header"><b data-wave></b><span data-clock></span></div><strong data-status></strong><small data-detail></small><progress max="60" hidden></progress>';
  const interact = document.createElement('button');
  interact.type = 'button';
  interact.className = 'coop-interact';
  interact.hidden = true;
  interact.addEventListener('pointerdown', event => event.stopPropagation());
  interact.addEventListener('click', onInteract);
  const marker = document.createElement('div');
  marker.className = 'coop-marker';
  marker.hidden = true;
  document.querySelector('#hud').append(block, marker);
  document.body.append(interact);
  const wave = block.querySelector('[data-wave]'), clock = block.querySelector('[data-clock]');
  const status = block.querySelector('[data-status]'), detail = block.querySelector('[data-detail]');
  const progress = block.querySelector('progress');
  const beforeStart = hud.matchStart, menus = hud.menus, beforeEnd = menus.buildEnd;
  const pauseRule = menus.pages.pause.querySelector('#p-board .sech span:last-child');
  if (pauseRule) pauseRule.textContent = '八轮行动 · 守卫两处设施后撤离';
  hud.matchStart = function (...args) {
    const value = beforeStart.apply(this, args);
    this.e.intro.querySelector('.i-sub').textContent = '恢复供电 · 接通通信 · 呼叫撤离';
    return value;
  };
  menus.buildEnd = function (...args) {
    const value = beforeEnd.apply(this, args);
    const page = this.pages.end, summary = engine.room?.modeState;
    const heading = page.querySelector('.e-k');
    if (heading) heading.textContent = '灰港隔离区 · 合作僵尸';
    const verdict = page.querySelector('.e-t');
    if (verdict && summary?.result) verdict.textContent = summary.result;
    const boardLabel = page.querySelector('.e-col:last-child .sech span:last-child');
    if (boardLabel) boardLabel.textContent = '灰港行动小队';
    const personal = summary?.personal?.[engine.net.id];
    if (personal && heading) {
      const row = page.ownerDocument.createElement('p');
      row.className = 'coop-end-summary';
      row.textContent = `第 ${Math.min(8, summary.wave)} 波 · ${personal.extracted ? '已撤离' : '未撤离'} · 协助 ${personal.assists} · 救援 ${personal.rescues} · 设备 ${personal.objectives}/2`;
      heading.after(row);
    }
    return value;
  };
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  let refreshedAt = -1, rendered = null;
  const keys = new AbortController();
  window.addEventListener('keydown', event => {
    if (event.code === 'KeyE' && !event.repeat && !interact.hidden && onInteract()) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }, { capture: true, signal: keys.signal });
  return {
    marker,
    render(state, now, cue) {
      const playing = engine.gh.G.state === 'playing' && engine.phase === 'live';
      block.hidden = !playing || !state;
      interact.hidden = block.hidden || !state.self?.interaction && !state.self?.acting;
      if (block.hidden) {
        marker.hidden = true;
        return;
      }
      if (state === rendered && now - refreshedAt < .10) return;
      refreshedAt = now;
      rendered = state;
      const self = state.self || {};
      const since = now - state.received, seconds = Math.ceil(Math.max(0, state.remaining - since));
      setText(wave, state.wave > 8 ? '最终撤离' : `第 ${state.wave} / 8 波`);
      setText(clock, `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      setText(status, self.spectator ? '观战中 · 下轮入场' : self.down > 0 ? `倒地 · ${Math.ceil(Math.max(0, self.down - since))} 秒` : state.status);
      setText(detail, self.spectator ? '正在等待下一次整备' : cue ? `${cue.direction}发现感染者` : self.point && state.status !== '防守设备' && state.status !== '等待撤离'
        ? places[self.point] : state.alive + state.pending > 0 ? `剩余 ${state.alive + state.pending} · 本波击杀 ${state.killed}`
          : '整备弹药与医疗物资');
      progress.hidden = state.status !== '防守设备';
      if (!progress.hidden) progress.value = state.progress;
      if (!interact.hidden) {
        const action = self.acting || self.interaction;
        interact.disabled = !!self.acting;
        const key = globalThis.GHInput?.effective === 'gamepad' ? 'LB  ·  ' : document.body.classList.contains('touch-playing') ? '' : 'E  ·  ';
        setText(interact, self.acting ? `${places[action] || action} · ${Math.max(.1, self.actionRemaining - since).toFixed(1)} 秒`
          : `${key}${places[action] || action}`);
      }
    },
    dispose() {
      keys.abort();
      hud.matchStart = beforeStart;
      menus.buildEnd = beforeEnd;
      cleanup();
      document.body.classList.remove('coop-session');
      block.remove();
      interact.remove();
      marker.remove();
    },
  };
}

export async function prepareZombies(context) {
  const { engine, mapData } = context;
  const assets = await loadRigs(context, !!globalThis.GHBoot?.policy?.mobile);
  let actors, hud, state, cue;
  const events = new AbortController();
  const cleanup = () => {
    events.abort();
    engine.modeFrame = null;
    try { hud?.dispose(); } finally { try { actors?.dispose(); } finally { assets.dispose(); } }
  };
  try {
    actors = createActors(engine, assets);
    const markerPosition = new assets.THREE.Vector3();
    const projected = new assets.THREE.Vector3();
    hud = prepareHud(context, () => {
      if (engine.gh.G.state !== 'playing' || !state?.self?.interaction || state.self.acting) return false;
      engine.net.send({ type: 'coop-interact' }).catch(() => {});
      return true;
    });
    engine.net.addEventListener('event', ({ detail: event }) => {
      if (event.type === 'coop-state' && event.round === engine.room?.round) state = { ...event, received: performance.now() / 1000 };
      if (event.type === 'coop-cue' && event.round === engine.room?.round) cue = { ...event, until: performance.now() / 1000 + event.seconds + 1 };
      if (event.type === 'round-start') {
        state = cue = null;
        actors.reset();
      }
      if (event.type !== 'zombie-hit' || !engine.roundStarted || engine.phase !== 'live') return;
      actors.hit(event);
      const point = new assets.THREE.Vector3(...event.point);
      const dir = new assets.THREE.Vector3(...event.dir).normalize();
      engine.ctx.fx?.impact?.('flesh', point, dir.clone().negate());
      engine.ctx.fx?.bodyHit?.(point, dir, event.kill, event.head);
      engine.ctx.audio.impact?.('flesh', point);
      if (event.attacker === engine.net.id) {
        engine.ctx.hud.hit(event.head, event.kill, false);
        if (event.weapon === 'melee') engine.ctx.audio.foley?.('melee_hit');
      }
    }, { signal: events.signal });
    let gamepadHeld = false;
    engine.modeFrame = dt => {
      actors.update(dt);
      const playing = engine.gh.G.state === 'playing' && engine.phase === 'live';
      const time = performance.now() / 1000;
      hud.render(state, time, cue && cue.until > time ? cue : null);
      const pad = globalThis.GHInput?.effective === 'gamepad' ? navigator.getGamepads?.()?.find(device => device?.connected) : null;
      const pressed = !!pad?.buttons[4]?.pressed;
      if (pressed && !gamepadHeld && playing && state?.self?.interaction && !state.self.acting && globalThis.GHInput?.effective === 'gamepad')
        engine.net.send({ type: 'coop-interact' }).catch(() => {});
      gamepadHeld = pressed;
      const point = playing && mapData.anchors?.[state?.self?.point]?.[0];
      const coords = Array.isArray(point) ? point : point ? [point.x, point.y, point.z] : null;
      if (!coords?.every(Number.isFinite)) {
        hud.marker.hidden = true;
        return;
      }
      const camera = engine.ctx.gfx.camera;
      markerPosition.set(coords[0], coords[1] + 1.5, coords[2]);
      projected.copy(markerPosition).project(camera);
      const delta = angleDelta(Math.atan2(camera.position.x - coords[0], camera.position.z - coords[2]), engine.player.yaw);
      const onScreen = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < .9 && Math.abs(projected.y) < .68;
      const x = onScreen ? (projected.x + 1) * 50 : 50 + 39 * Math.sin(delta);
      const y = onScreen ? 50 - projected.y * 50 : 18;
      hud.marker.hidden = false;
      hud.marker.style.setProperty('--coop-x', x + '%');
      hud.marker.style.setProperty('--coop-y', y + '%');
      const description = `${onScreen ? '◇' : delta < -.15 ? '‹' : delta > .15 ? '›' : '◇'} ${places[state.self.point]} · ${Math.round(camera.position.distanceTo(markerPosition))} m`;
      if (hud.marker.textContent !== description) hud.marker.textContent = description;
    };
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
