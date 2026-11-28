import {
  World,
  motion,
  STEP,
  clamp,
  JUMP,
  SPRINT,
  CROUCH,
  ADS,
  SLIDE,
  rayBoxContact,
} from "./simulation.js";
import { WEAPONS } from "./net.js";
import { clearInputState } from "./desktop-input.js";
import { requestPointerLock } from "./pointer-lock.js";
import { updateLocomotion } from "./locomotion.js";
import { nativeSceneLayers } from './scene-layers.js';
import { ImpactSurfaces, effectWorld, wallImpact } from './impact-surfaces.js';
import { OnlineGlass, glassCollider } from './glass.js';
import { teamPalette, setTeamPerspective, resetTeamRadar, syncTeamRadar } from './allegiance.js';

const INITIAL_EVENT_TYPES = new Set(["shot", "damage", "kill"]);
const INITIAL_EVENT_LIMIT = 64;
const INITIAL_EVENT_MAX_AGE = 1500;
const RELOAD_CONFIRM_TIMEOUT = 2500;
const WEAPON_IMPULSE = { ar: 7, smg: 5, shotgun: 6, pistol: 6, m200: 9, rpk: 6 };
const colliderKey = (min, max) => [...min, ...max].map(v => v.toFixed(4)).join(",");
const playerId = value => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const samePlayer = (a, b) => playerId(a) !== null && playerId(a) === playerId(b);

// The bundle is used only for rendering, models, audio and weapon animation.
// PvP simulation and authority live in the new client modules and Go server.
export class Engine extends EventTarget {
  constructor(connection, { now = () => performance.now(),
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer) } = {}) {
    super();
    this.net = connection;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.ending = null;
    this.stairRise = this.previousStairRise = this.renderedStairRise = 0;
    this.lastUpdateAt = null;
    this.remoteRenderTime = null;
    this.jumpRequestUntil = 0;
    this.jumpInputHeld = false;
    this.remotes = new Map();
    this.pending = [];
    this.pendingShots = [];
    this.shotSeq = 0;
    this.shotAcks = false;
    this.seq = 0;
    this.accumulator = 0;
    this.snapshots = [];
    this.active = false;
    this.error = { x: 0, y: 0, z: 0 };
    this.hasInitialSnapshot = false;
    this.initialEvents = [];
    this.crouchInputHeld = false;
    this.slideRequestPending = false;
    this.slideRequestUntil = 0;
    this.lockAttempt = 0;
    this.deploymentRequested = false;
    this._propHit = { t: 0, body: null, nx: 0, ny: 0, nz: 0 };
  }
  resetHotelState({ muteLounge = false } = {}) {
    const ctx = this.ctx || globalThis.GH?.debug?.ctx;
    if (!ctx) return;
    ctx.fx?.reset?.();
    if (!this.active) ctx.glass?.reset?.();
    ctx.physics?.reset?.();
    ctx.resetWorld?.();
    if (muteLounge) ctx.audio?.lounge?.kill?.();
  }
  async ready() {
    if (this.gh) return;
    let last = performance.now(),
      stage = "",
      wasVisible = !document.hidden,
      idleVisibleMs = 0;
    while (!window.GH?.ready) {
      const now = performance.now();
      const loading = document.querySelector("#ltxt")?.textContent || "";
      const failure = document.querySelector("#err");
      if (failure)
        throw Error(failure.textContent || "3D 场景初始化失败。");
      if (loading !== stage) {
        stage = loading;
        idleVisibleMs = 0;
      } else if (!document.hidden && wasVisible) {
        idleVisibleMs += Math.min(now - last, 1000);
      }
      last = now;
      wasVisible = !document.hidden;
      if (idleVisibleMs > 120000)
        throw Error(`3D 场景在“${stage || "初始化"}”阶段长时间未完成，请检查浏览器的 WebGL 与显卡驱动支持。`);
      await new Promise((r) => setTimeout(r, 50));
    }
    this.gh = window.GH;
    this.debug = this.gh.debug;
    this.ctx = this.debug.ctx;
    this.player = this.debug.player;
    this.input = this.debug.input;
    if (!this.ctx?.botCtx?.createCharacter || !this.player?._camera)
      throw Error("当前游戏构建与联机适配器不兼容。");
    this.sceneLayers = nativeSceneLayers(this.debug);
    const nativeColliders = this.debug.world.cols.filter((c) => !c.pane);
    this.world = new World(
      nativeColliders
        .filter((c) => !c.off)
        .map((c) => ({
          min: [c.x0, c.y0, c.z0],
          max: [c.x1, c.y1, c.z1],
          noMove: !!c.noMove,
          noRay: !!c.noRay,
          surf: c.surf,
          nativeCol: c,
        })),
    );
    this.nativeSurfaces = new Map(nativeColliders.map(c =>
      [colliderKey([c.x0, c.y0, c.z0], [c.x1, c.y1, c.z1]), c.surf]));
    this.nativeCols = new Map(nativeColliders.map(c =>
      [colliderKey([c.x0, c.y0, c.z0], [c.x1, c.y1, c.z1]), c]));
  }
  async enter(primary = "ar") {
    await this.ready();
    if (this.active) return;
    // Clear any single-player/training destruction before mounting an online room.
    this.resetHotelState({ muteLounge: true });
    this.active = true;
    this.specs = this.m200Build = this.rpkBuild = null;
    this.resetEnding();
    this.resetStairs();
    // Debug/training cameras must never carry into an authoritative session.
    this.gh.G.freeCam = null;
    this.mapId = null;
    this.mapVersion = null;
    this.lastUpdateAt = null;
    this.remoteRenderTime = null;
    this.jumpRequestUntil = 0;
    this.jumpInputHeld = false;
    document.body.classList.add("online-session");
    setTeamPerspective(document.body, null);
    this.primary = primary;
    this.phase = "lobby";
    this.pending = [];
    this.seq = 0;
    this.snapshots = [];
    this.hasInitialSnapshot = false;
    this.initialEvents = [];
    this.crouchInputHeld = false;
    this.slideRequestPending = false;
    this.slideRequestUntil = 0;
    this.lastSpawn = null;
    this.roundStarted = false;
    this.lastSnapshot = null;
    this.reloadRequest = null;
    const { ctx, debug: d, player: p, input } = this;
    this.glass = new OnlineGlass(ctx.glass, this.gh.three);
    this.original = {
      playerUpdate: p.update,
      damage: p.damage,
      matchUpdate: ctx.match.update,
      matchDamage: ctx.match.damage,
      actors: ctx.match.actors,
      bots: ctx.match.bots,
      hudUpdate: ctx.hud.update,
      fire: ctx.combat.fire,
      melee: ctx.combat.melee,
      reload: ctx.arsenal.startReload,
      loadAmmo: ctx.arsenal._load,
      weaponEvents: ctx.arsenal._events,
      swap: ctx.arsenal.swap,
      lockChange: input.onLockChange,
      lock: input.lock,
      primary: ctx.settings.primary,
      playerTeam: p.team,
      scores: ctx.match.scores,
      time: ctx.match.time,
    };
    if (!this.deploymentRequested) input.unlock();
    ctx.match.k9.clear();
    for (const bot of ctx.match.bots)
      for (const rig of bot.rigs) rig.root.visible = false;
    ctx.match.bots = [];
    ctx.match.actors = [p];
    resetTeamRadar(ctx.hud.map);
    ctx.match.update = () => {};
    ctx.match.damage = () => {};
    ctx.hud.update = (dt, state) => {
      if (!this.lastSnapshot || !this.roundStarted) return;
      if (this.gh.G.state !== "playing") {
        this.renderRemotes(dt);
        this.modeFrame?.(dt);
      }
      this.original.hudUpdate.call(ctx.hud, dt, state);
      if (ctx.hud.magRoll) {
        // Online ammo is already confirmed. Finish the native number roll
        // before paint so the magazine and reserve change together.
        ctx.hud.magRoll = null;
        const counter = ctx.hud.e.mag;
        counter._v = state.ars.slot.ammo;
        counter.textContent = counter._v;
      }
    };
    p.damage = () => {};
    ctx.settings.primary = primary;
    ctx.arsenal.reset(primary);
    ctx.arsenal.grenades = 0;
    p.update = (dt, ars) => this.update(dt, ars);
    ctx.combat.fire = (actor, eye, dir, weapon, spread, muzzle) => {
      if (this.phase === "live" && p.alive) this.sendShot(dir, weapon.id);
      const range = this.specs?.find(w => w.id === weapon?.id)?.range || (weapon?.id === "m200" ? 180 : 140);
      this.shotFeedback(actor, eye, dir, muzzle, range, { weapon, spread });
      return {
        point: eye.clone().addScaledVector(dir, 140),
        actor: null,
        head: false,
        any: false,
        dist: 140,
      };
    };
    ctx.combat.melee = (actor, _eye, dir) => this.melee(actor, dir);
    const arsenal = ctx.arsenal;
    arsenal.startReload = () => this.startReload();
    // Native animation cues still play, but may only mark the clip as loaded.
    // A snapshot is the only source of a refill in an online match.
    arsenal._load = () => { arsenal.loaded = true; };
    arsenal._events = () => {
      this.original.weaponEvents.call(arsenal);
      if (arsenal.state === "reload" && arsenal.slot === this.reloadRequest?.slot &&
          (!arsenal.slot.def.pump || arsenal.clipName === "reloadEnd") && arsenal.clipT >= arsenal.clipDur) {
        // Keep the terminal pose while the server still reports the old ammo.
        arsenal.clipT = arsenal.clipDur - 1e-6;
      }
    };
    ctx.arsenal.swap = (slot) => {
      const w = arsenal.slots[slot];
      if (!w) return;
      const before = arsenal.state;
      this.original.swap.call(arsenal, slot);
      if (before !== "holster" && arsenal.state === "holster") {
        this.reloadRequest = null;
        this.net.send(this.equipCommand(w.def.id)).catch(() => {});
      }
    };
    input.onLockChange = (locked) => {
      if (!locked) {
        this.releaseDrag();
        clearInputState(input);
        if (this.gh.G.state === "playing") this.pause();
      }
      this.dispatchEvent(new CustomEvent("lock", { detail: locked }));
    };
    input.lock = () => this.lock({ automatic: true });
    this.dragMode = false;
    this.dragActive = false;
    this.dragPointer = null;
    this.controls = new AbortController();
    const opts = { signal: this.controls.signal };
    const canvas = input.el;
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.dragActive || e.pointerType === "touch") return;
        this.dragging = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.dragPointer = e.pointerId;
        canvas.setPointerCapture(e.pointerId);
      },
      opts,
    );
    canvas.addEventListener(
      "mousedown",
      (e) => {
        if (!this.dragActive) return;
        e.preventDefault();
        if (input.handleMouse) input.handleMouse(e, true);
        else {
          input.keys.add("Mouse" + e.button);
          input.down.add("Mouse" + e.button);
        }
      },
      opts,
    );
    canvas.addEventListener(
      "pointermove",
      (e) => {
        if (this.dragActive && this.dragging && e.pointerId === this.dragPointer) {
          input.mx += e.clientX - this.lastPointer.x;
          input.my += e.clientY - this.lastPointer.y;
          this.lastPointer = { x: e.clientX, y: e.clientY };
        }
      },
      opts,
    );
    canvas.addEventListener("pointerup", (e) => {
      if (e.pointerId === this.dragPointer) this.releaseDrag();
    }, opts);
    canvas.addEventListener("mouseup", (e) => {
      if (!this.dragActive) return;
      if (input.handleMouse) { input.handleMouse(e, false); return; }
      const key = "Mouse" + e.button;
      if (input.keys.delete(key)) input.up.add(key);
    }, opts);
    canvas.addEventListener("wheel", (e) => {
      if (this.dragActive) { e.preventDefault(); input.handleWheel?.(e); }
    }, { ...opts, passive: false });
    for (const type of ["pointercancel", "lostpointercapture"])
      canvas.addEventListener(type, (e) => {
        if (e.pointerId === this.dragPointer) input.onLockChange(false);
      }, opts);
    ctx.hud.show("menu");
    ctx.hud.menus.go("online");
    this.gh.G.state = "menu";
    this.gh.G.timeScale = 1;
    ctx.match.state = "idle";
    ctx.match.live = false;
  }
  setRoom(room, mapData) {
    if (room.phase !== "over") this.resetEnding();
    this.room = room;
    this.phase = room.phase;
    if (mapData && mapData.mapId === room.mapId && mapData.version === room.mapVersion) {
      const mapChanged = this.mapId !== mapData.mapId || this.mapVersion !== mapData.version;
      const colliders = mapData.mapId === 'hotel' ? mapData.colliders.map(box => {
        const key = colliderKey(box.min, box.max);
        return { ...box, surf: this.nativeSurfaces?.get(key), nativeCol: this.nativeCols?.get(key) };
      }) : mapData.colliders;
      const panes = (mapData.glass || []).map(glassCollider);
      this.world = new World([...colliders, ...panes], mapData.bounds);
      this.glass?.attach(room, mapData.glass || [], panes);
      this.effectWorld = effectWorld(this.world);
      if (mapChanged) {
        if (mapData.mapId === 'hotel') this.resetHotelState({ muteLounge: room.phase !== 'live' && room.phase !== 'countdown' });
        else this.ctx?.fx?.reset?.();
        this.impactSurfaces?.dispose();
        const scene = this.ctx?.gfx?.scene, THREE = this.gh?.three, physics = this.debug?.physics || this.ctx?.physics;
        this.impactSurfaces = scene && THREE ? new ImpactSurfaces(scene.children.filter(root =>
          root.visible && this.sceneLayers?.owners.get(root) !== 'shared'), THREE, mapData.bounds,
          [...(physics?.bodies || []).map(body => body.obj), physics?.chunkMesh, physics?.caseMesh]) : null;
      }
      this.mapId = mapData.mapId;
      this.mapVersion = mapData.version;
    }
    if (room.phase === "lobby") this.roundStarted = false;
    if (!this.active) return;
    const me = room.players.find(p => p.id === this.net.id);
    if (me) {
      this.player.team = me.team;
      setTeamPerspective(globalThis.document?.body, me.team);
    }
    for (const [id, r] of this.remotes) {
      const member = room.players.find((p) => p.id === id);
      if (!member || member.team !== r.team ||
          (me && r.visualTeam !== undefined && r.visualTeam !== teamPalette(member.team, me.team))) {
        this.removeRemote(id);
      }
    }
  }
  deploy() {
    if (!this.active) return;
    this.deploymentRequested = false;
    this.lastUpdateAt = null;
    this.ctx.audio.init();
    this.ctx.audio.setVolumes?.({ master: this.ctx.settings.master, sfx: this.ctx.settings.sfx, music: this.ctx.settings.music });
    this.setTimeScale(1);
    this.ctx.audio.music.menu(false);
    this.ctx.audio.ui?.('deploy');
    this.ctx.hud.show(null);
    this.gh.G.state = "playing";
    this.ctx.match.state = this.phase === "over" ? "ending" : this.phase;
    this.ctx.match.live = false;
    clearInputState(this.input);
    void this.lock({ automatic: true });
  }
  prepareDeployment() {
    // Unlock Web Audio during the initiating gesture on touch/gamepad too.
    this.ctx?.audio.init();
    if (!this.input || globalThis.GHTouch?.enabled || globalThis.GHInput?.effective === "gamepad") return;
    // Capture the click's user activation before matchmaking / scene downloads.
    // Creating a waiting room never calls this method.
    this.deploymentRequested = true;
    void this.lock({ automatic: true, preparing: true });
  }
  cancelDeployment() {
    this.deploymentRequested = false;
    this.lockAttempt++;
    this.lockRequest?.controller.abort();
    this.lockRequest = null;
    if (this.input) {
      this.input.allowLock = false;
      this.input.lockAttempt = (this.input.lockAttempt || 0) + 1;
      this.input.unlock();
    }
  }
  async lock({ automatic = false, preparing = false } = {}) {
    if (!(preparing && this.deploymentRequested) && (!this.active || this.gh.G.state !== "playing")) return;
    this.ctx.audio.init();
    if (globalThis.GHInput?.effective === "gamepad") {
      this.releaseDrag();
      this.dragActive = false;
      globalThis.GHInput.activate();
      return;
    }
    if (globalThis.GHTouch?.enabled) {
      this.releaseDrag();
      this.dragActive = false;
      globalThis.GHTouch.activate();
      return;
    }
    if (this.input.locked) return;
    if (this.dragMode && !preparing) {
      this.enableDrag();
      return;
    }
    if (this.lockRequest) return;
    const attempt = ++this.lockAttempt;
    const controller = new AbortController();
    const doc = this.input.el.ownerDocument;
    this.input.allowLock = true;
    this.input.lockAttempt = (this.input.lockAttempt || 0) + 1;
    const promise = requestPointerLock(this.input.el, { signal: controller.signal });
    this.lockRequest = { controller, promise };
    try {
      await promise;
      if (attempt !== this.lockAttempt && this.gh.G.state !== "playing") this.input.unlock();
    } catch {
      if (attempt === this.lockAttempt && this.active && this.gh.G.state === "playing") {
        const focused = !doc.hidden && doc.hasFocus();
        if (automatic && focused) {
          // Remote starts have no local click, and downloads may outlive user
          // activation. Keep the battlefield visible; a canvas click retries.
          clearInputState(this.input);
          this.dispatchEvent(new Event("lockneeded"));
        } else {
          this.pause();
          if (focused) this.dispatchEvent(new Event("lockerror"));
        }
      }
    } finally {
      if (this.lockRequest?.controller === controller) this.lockRequest = null;
    }
  }
  enableDrag() {
    this.dragMode = true;
    this.dragActive = true;
    this.input.el.tabIndex = 0;
    this.input.el.focus({ preventScroll: true });
    this.dispatchEvent(new CustomEvent("lock", { detail: true }));
  }
  releaseDrag() {
    this.dragging = false;
    this.lastPointer = null;
    const pointer = this.dragPointer;
    this.dragPointer = null;
    if (pointer !== null && pointer !== undefined &&
        this.input.el.hasPointerCapture(pointer))
      this.input.el.releasePointerCapture(pointer);
    this.input.boundInput?.releaseMouse();
    for (let button = 0; !this.input.boundInput && button <= 4; button++) {
      const key = "Mouse" + button;
      if (this.input.keys.delete(key)) this.input.up.add(key);
    }
  }
  equipCommand(weapon) {
    const command = { type: "equip", weapon };
    if (weapon === "m200") command.m200Build = this.gh?.debug?.m200Art?.build("m200");
    if (weapon === "rpk") command.rpkBuild = this.gh?.debug?.rpkArt?.build("rpk");
    return command;
  }
  movement() {
    const def = this.ctx.arsenal?.def;
    return ["m200", "rpk"].includes(def?.id) ? def : undefined;
  }
  applySpecs() {
    for (const slot of this.ctx.arsenal.slots) {
      if (slot.def.id === "m200" && this.m200Build && this.gh?.debug?.m200Art?.stats) {
        const build = { ...slot.def.build, ...this.m200Build };
        slot.def = this.gh.debug.m200Art.stats("m200", build);
        if (this.ctx.vm?.id === "m200") this.ctx.vm.show("m200", build);
      }
      if (slot.def.id === "rpk" && this.rpkBuild && this.gh?.debug?.rpkArt?.stats) {
        const build = { ...slot.def.build, ...this.rpkBuild };
        slot.def = this.gh.debug.rpkArt.stats("rpk", build);
        if (this.ctx.vm?.id === "rpk") this.ctx.vm.show("rpk", build);
      }
      const spec = this.specs?.find((w) => w.id === slot.def.id);
      if (spec)
        slot.def = {
          ...slot.def,
          rpm: 60 / spec.interval,
          mag: spec.mag,
          reserve: spec.reserve,
          pellets: spec.pellets,
        };
    }
  }
  startReload() {
    const { arsenal } = this.ctx;
    if (this.phase !== "live" || this.ending || !this.player.alive || !this.net.writer ||
        arsenal.state === "reload" || this.reloadRequest?.slot === arsenal.slot) return;
    this.original.reload.call(arsenal);
    if (arsenal.state !== "reload") return;
    const request = this.reloadRequest = {
      slot: arsenal.slot, reserve: arsenal.slot.reserve, deadline: this.now() + RELOAD_CONFIRM_TIMEOUT,
    };
    this.net.send({ type: "reload" }).catch(() => this.finishReload(request));
  }
  sendShot(dir, weapon) {
    const command = {
      type: "shot", weapon, tick: this.serverViewTick(),
      yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(clamp(dir.y, -1, 1)),
    };
    let shot;
    if (this.shotAcks) {
      command.shotSeq = ++this.shotSeq;
      shot = { seq: command.shotSeq, weapon };
      this.pendingShots.push(shot);
      if (this.pendingShots.length > 64) this.pendingShots.shift();
    }
    this.net.send(command).catch(() => {
      if (shot) this.pendingShots = this.pendingShots.filter(pending => pending !== shot);
    });
  }
  reconcileAmmo(me) {
    const { arsenal } = this.ctx;
    const slot = arsenal.slots.find(w => w.def.id === me.weapon);
    this.shotAcks = me.shotAck !== undefined;
    if (!me.alive || this.phase !== "live" || !this.shotAcks) this.pendingShots.length = 0;
    else if (this.pendingShots[0]?.seq <= me.shotAck)
      this.pendingShots = this.pendingShots.filter(shot => shot.seq > me.shotAck);
    if (slot) {
      let unconfirmed = 0;
      for (const shot of this.pendingShots) if (shot.weapon === me.weapon) unconfirmed++;
      slot.ammo = unconfirmed ? Math.max(0, me.ammo - unconfirmed) : me.ammo;
      slot.reserve = me.reserve;
    }
    const request = this.reloadRequest;
    if (!me.alive || this.phase !== "live") {
      this.reloadRequest = null;
      return;
    }
    if (!request || slot !== request.slot) return;
    if (me.reload > 0) {
      request.deadline = Math.max(request.deadline, this.now() + me.reload + 500);
      return;
    }
    // A refill consumes reserve even if all in-progress snapshots were lost.
    // A zero timer alone can precede the refill due to snapshot rounding.
    if (me.reserve >= request.reserve && this.now() < request.deadline) return;
    this.finishReload(request);
  }
  finishReload(request) {
    if (this.reloadRequest !== request) return;
    this.reloadRequest = null;
    const { arsenal, vm } = this.ctx;
    if (request.slot === arsenal.slot && arsenal.state === "reload") {
      arsenal.state = "ready";
      arsenal.clip = null;
      vm.release();
      vm.gun?.resetPose?.();
    }
  }
  readInput() {
    const k = this.input.keys,
      has = (...codes) => codes.some((c) => k.has(c) || this.input.touchKeys.has(c));
    const enabled =
      !!this.net.writer &&
      (this.input.locked || this.input.touchActive || this.dragActive) &&
      this.phase === "live" &&
      this.player.alive;
    const aiming = this.input.aim?.requested() ?? has("Mouse1", "Mouse2");
    const seq = ++this.seq,
      crouchHeld = enabled && has("KeyC", "ControlLeft", "ControlRight");
    let crouchPressed = crouchHeld && !this.crouchInputHeld;
    for (const code of ["KeyC", "ControlLeft", "ControlRight"]) {
      if (this.input.down?.delete(code)) crouchPressed = true;
      if (this.input.touchDown?.delete(code)) crouchPressed = true;
    }
    this.crouchInputHeld = crouchHeld;
    const moveIntent = has("KeyW", "ArrowUp", "KeyS", "ArrowDown", "KeyA", "ArrowLeft", "KeyD", "ArrowRight") ||
      Math.hypot(this.input.touchForward || 0, this.input.touchRight || 0) > 0.01;
    const canRequestSlide = crouchPressed && enabled && has("ShiftLeft", "ShiftRight") &&
      moveIntent && !aiming && this.predicted?.ground && !this.predicted?.crouch &&
      !this.predicted?.sliding && (this.predicted?.slideCooldown || 0) <= 0;
    const now = this.now();
    const jumpHeld = enabled && has("Space");
    let jumpPressed = jumpHeld && !this.jumpInputHeld;
    if (this.input.down?.delete("Space")) jumpPressed = true;
    if (this.input.touchDown?.delete("Space")) jumpPressed = true;
    this.jumpInputHeld = jumpHeld;
    if (jumpPressed && enabled && this.predicted?.ground) this.jumpRequestUntil = now + 600;
    if (canRequestSlide) {
      this.slideRequestPending = true;
      this.slideRequestUntil = now + 600;
    } else if (this.slideRequestPending && now >= this.slideRequestUntil) {
      this.slideRequestPending = false;
      this.slideRequestUntil = 0;
    }
    if (!enabled || !this.player?.alive) {
      this.slideRequestPending = false;
      this.slideRequestUntil = 0;
      this.jumpRequestUntil = 0;
    }
    let buttons = enabled
      ? Number(jumpHeld || now < this.jumpRequestUntil) * JUMP +
        Number(has("ShiftLeft", "ShiftRight")) * SPRINT +
        Number(crouchHeld || crouchPressed) * CROUCH +
        Number(aiming) * ADS
      : 0;
    if (enabled && this.slideRequestPending) {
      buttons |= SLIDE;
    }
    return {
      seq,
      forward: enabled
        ? clamp(Number(has("KeyW", "ArrowUp")) - Number(has("KeyS", "ArrowDown")) + this.input.touchForward, -1, 1)
        : 0,
      right: enabled
        ? clamp(Number(has("KeyD", "ArrowRight")) - Number(has("KeyA", "ArrowLeft")) + this.input.touchRight, -1, 1)
        : 0,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      buttons,
    };
  }
  update(dt, ars) {
    this.modeFrame?.(dt);
    const p = this.player;
    if (!this.predicted) return;
    // Native animation dt is capped at 1/18s. Use elapsed wall time for online
    // prediction, with at most six catch-up steps after a long frame.
    const now = this.now();
    const elapsed = this.lastUpdateAt === null ? dt : Math.max(0, (now - this.lastUpdateAt) / 1000);
    this.lastUpdateAt = now;
    if (!p.alive) {
      this.input.enabled = false;
      p._deadCam(dt);
      this.renderRemotes(dt);
      return;
    }
    if (!this.ending && (this.input.locked || this.input.touchActive || this.dragActive)) {
      const sens =
        0.0022 *
        this.ctx.settings.sens *
        (1 + (this.ctx.settings.adsSens - 1) * p.adsK);
      p.yaw -= (this.input.mx + this.input.touchMx) * sens;
      p.pitch = clamp(
        p.pitch - (this.input.my + this.input.touchMy) * sens * (this.ctx.settings.invertY ? -1 : 1),
        -1.5,
        1.5,
      );
    }
    this.accumulator = this.ending ? 0 : Math.min(this.accumulator + elapsed, 0.1);
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      const input = this.readInput();
      const m = this.predicted;
      const wasSliding = m.sliding;
      Object.assign(this.previousPosition, { x: m.x, y: m.y, z: m.z });
      this.previousStairRise = this.stairRise;
      if (this.phase === "live" && p.alive)
        this.stairRise += this.world.move(m, input, this.movement()) || 0;
      if (m.sliding !== wasSliding) {
        if (m.sliding) {
          p.ev.slide++;
          this.ctx.audio.slideStart?.(p.e.groundCol?.surf || "marble");
        } else {
          p.ev.slideEnd++;
          this.ctx.audio.slideStop?.();
        }
      }
      // Use actual displacement: the simulation retains desired velocity at
      // walls, which must not keep the native running animation at full speed.
      this.visualVelocity.x = (m.x - this.previousPosition.x) / STEP;
      this.visualVelocity.z = (m.z - this.previousPosition.z) / STEP;
      this.pending.push(input);
      if (this.pending.length > 120) this.pending.shift();
      if (input.seq % 2 === 0) this.net.input(input);
    }
    const m = this.predicted,
      decay = Math.exp(-15 * dt);
    for (const key of ["x", "y", "z"]) this.error[key] *= decay;
    const alpha = this.ending ? 1 : this.accumulator / STEP;
    for (const key of ["x", "y", "z"])
      p.e[key] = this.previousPosition[key] + (m[key] - this.previousPosition[key]) * alpha + this.error[key];
    const wasGrounded = p.e.onGround, previousVY = p.vel.y;
    p.e.h = m.sliding ? 0.95 : m.crouch ? 1.2 : 1.8;
    p.e.onGround = m.ground;
    p.pos.set(p.e.x, p.e.y, p.e.z);
    p.vel.set(this.visualVelocity.x, m.vy, this.visualVelocity.z);
    if (this.phase === "live" && p.alive && this.mapId === "hotel") {
      this.ctx?.physics?.pushFrom?.(p.e.x, p.e.y, p.e.y + p.e.h, p.e.z, m.sliding ? 0.36 : 0.44, p.vel.x, p.vel.z);
    }
    const stance = m.crouch ? "crouch" : "stand";
    if (p.stance !== stance) p.ev.stance++;
    p.stance = stance;
    p.mode = m.sliding ? "slide" : "normal";
    updateLocomotion(p, dt, ars, {
      sprint: !m.sliding && (this.input.held("ShiftLeft") || this.input.held("ShiftRight")),
      wasGrounded, previousVY,
    });
    // Apply the native camera's stair offset to the interpolated rise, rather
    // than all at once on a 60 Hz physics tick (which dips at high refresh rates).
    const rise = this.previousStairRise + (this.stairRise - this.previousStairRise) * alpha;
    p.stepOff = (p.stepOff || 0) - (rise - this.renderedStairRise);
    this.renderedStairRise = rise;
    p._camera(dt, ars);
    this.input.enabled =
      !!this.net.writer &&
      !this.ending &&
      this.phase === "live" &&
      p.alive &&
      (this.input.locked || this.input.touchActive || this.dragActive);
    this.renderRemotes(dt);
  }
  snapshot(s) {
    if (!this.active) return;
    // Unreliable live snapshots can trail the reliable round-end message.
    // Only round-start / a new room may reopen input or cancel the outro.
    if (this.ending && s.phase !== "over") return;
    const me = s.players.find((p) => p.id === this.net.id);
    if (!me) return;
    // Establish the viewer before matchStart can draw the first HUD frame.
    this.player.team = me.team;
    setTeamPerspective(globalThis.document?.body, me.team);
    this.phase = s.phase;
    if (s.phase === "over" && (this.room?.modeId !== "defusal" || this.room?.modeState?.matchFinished)) this.beginEnding();
    this.lastSnapshot = s;
    this.receivedAt = performance.now();
    const match = this.ctx.match;
    match.state = s.phase === "over" ? this.ending?.ready ? "over" : "ending" : s.phase;
    match.scores = s.scores;
    match.time = s.remaining / 1000;
    match.scoreLimit = this.room?.scoreLimit || 40;
    if ((s.phase === "countdown" || s.phase === "live") && !this.roundStarted) {
      this.roundStarted = true;
      this.count = -1;
      this.ctx.hud.matchStart();
      // PvP only exposes actions implemented by the authoritative server.
      this.ctx.hud.hint(
        this.room?.modeAdapter === "defusal"
          ? "<span><kbd>WASD</kbd> 移动</span><span><kbd>R</kbd> 换弹</span><span><kbd>" + (globalThis.GHInput?.keyBindings?.label('interact') || 'H') + "</kbd> 互动</span>"
          : this.room?.modeAdapter === "zombies"
          ? "<span><kbd>WASD</kbd> 移动</span><span><kbd>R</kbd> 换弹</span><span><kbd>E</kbd> 互动</span>"
          : "<span><kbd>WASD</kbd> 移动</span><span><kbd>R</kbd> 换弹</span><span><kbd>TAB</kbd> 战绩</span>",
        6,
      );
      this.ctx.audio.music.menu(false);
      this.deploy();
    }
    const count = s.phase === "countdown" ? Math.ceil(s.remaining / 1000) : 0;
    if (this.roundStarted && count !== this.count && s.phase !== "over") {
      if (count >= 1 && count <= 3 && (this.count < 0 || count < this.count)) this.ctx.audio.ui?.('countdown');
      else if (count === 0 && this.count > 0) this.ctx.audio.ui?.('go');
      this.count = count;
      this.ctx.hud.count(count);
    }
    const wasAlive = this.player.alive,
      first = !this.predicted,
      respawn = me.alive && (!wasAlive || first);
    if (respawn) {
      this.primary = this.ctx.settings.primary;
      if (this.roundStarted) this.ctx.hud.respawned();
      this.player.reset();
      this.player.yaw = me.yaw;
      this.player.pitch = me.pitch;
      this.pending = [];
      this.error = { x: 0, y: 0, z: 0 };
      this.reloadRequest = null;
      this.ctx.arsenal.reset(this.primary);
      this.applySpecs();
      this.ctx.arsenal.grenades = 0;
      this.net.send(this.equipCommand(this.primary)).catch(() => {});
    }
    const before = this.predicted ? { ...this.predicted } : motion(me);
    if (me.sliding || !me.alive || s.phase !== "live") {
      this.slideRequestPending = false;
      this.slideRequestUntil = 0;
    }
    if (me.jumpHeld || !me.alive || s.phase !== "live") this.jumpRequestUntil = 0;
    this.pending = this.pending.filter((i) => i.seq > me.ack);
    this.predicted = motion(me);
    if (s.phase === "live" && me.alive)
      for (const input of this.pending) this.world.move(this.predicted, input, this.movement());
    const continuous =
      !first &&
      !respawn &&
      Math.hypot(
        before.x - this.predicted.x,
        before.y - this.predicted.y,
        before.z - this.predicted.z,
      ) < 2;
    if (continuous) {
      this.error.x += before.x - this.predicted.x;
      this.error.y += before.y - this.predicted.y;
      this.error.z += before.z - this.predicted.z;
      // Move both interpolation endpoints with reconciliation; the decaying
      // error then preserves the displayed position instead of adding a hitch.
      for (const key of ["x", "y", "z"])
        this.previousPosition[key] += this.predicted[key] - before[key];
    } else {
      this.resetStairs();
      this.error = { x: 0, y: 0, z: 0 };
      this.previousPosition = { x: this.predicted.x, y: this.predicted.y, z: this.predicted.z };
      this.visualVelocity = { x: this.predicted.vx, z: this.predicted.vz };
      this.accumulator = 0;
      this.player.e.onGround = this.predicted.ground;
    }
    this.player.health = me.hp;
    this.player.alive = me.alive;
    this.player.team = me.team;
    this.ctx.hud.e.hpname.textContent = me.team ? "余烬" : "先锋";
    this.player.kills = me.kills;
    this.player.deaths = me.deaths;
    this.player.score = me.score;
    this.player.name =
      this.room?.players.find((p) => p.id === me.id)?.name || "干员";
    this.player.def = this.ctx.arsenal.slots.find(
      (w) => w.def.id === me.weapon,
    )?.def;
    if (!me.alive) this.ctx.hud.respawnIn(me.respawn / 1000);
    this.reconcileAmmo(me);
    this.snapshots.push({ ...s, received: this.now() });
    if (this.snapshots.length > 12) this.snapshots.shift();
    // Datagram snapshots can arrive after the reliable roster update. Reconcile
    // the complete roster here too, so a late packet cannot keep an old rig alive.
    for (const [id, remote] of this.remotes) {
      const other = s.players.find((player) => player.id === id);
      if (!other || other.team !== remote.team ||
          (remote.visualTeam !== undefined && remote.visualTeam !== teamPalette(other.team, me.team)))
        this.removeRemote(id);
    }
    for (const other of s.players)
      if (other.id !== this.net.id && !this.remotes.has(other.id))
        this.createRemote(other);
    this.syncActors(s);
    this.flushInitialEvents();
  }
  pause() {
    if (!this.active || this.ending) return;
    this.stopInput();
    this.gh.G.state = "paused";
    this.gh.G.timeScale = 1;
    this.lockAttempt++;
    this.lockRequest?.controller.abort();
    this.lockRequest = null;
    this.input.allowLock = false;
    this.input.lockAttempt = (this.input.lockAttempt || 0) + 1;
    this.dragActive = false;
    this.releaseDrag();
    globalThis.GHTouch?.deactivate();
    this.input.enabled = false;
    clearInputState(this.input);
    this.input.unlock();
    this.ctx.hud.show("pause");
  }
  stopInput() {
    this.lastUpdateAt = null;
    this.jumpRequestUntil = 0;
    this.jumpInputHeld = false;
    this.crouchInputHeld = false;
    this.slideRequestPending = false;
    this.slideRequestUntil = 0;
    if (this.net?.writer && this.phase === "live") {
      const input = { seq: ++this.seq, forward: 0, right: 0, buttons: 0,
        yaw: this.player.yaw, pitch: this.player.pitch };
      this.pending.push(input);
      if (this.pending.length > 120) this.pending.shift();
      void this.net.input(input);
    }
  }
  resetStairs() {
    this.stairRise = this.previousStairRise = this.renderedStairRise = 0;
    if (this.player) this.player.stepOff = 0;
  }
  setTimeScale(value) {
    if (this.ctx?.setTimeScale) this.ctx.setTimeScale(value);
    else if (this.gh) this.gh.G.timeScale = value;
  }
  resetEnding() {
    if (!this.ending) return;
    this.clearTimer(this.ending.timer);
    this.ending = null;
    this.setTimeScale(1);
  }
  beginEnding() {
    if (this.ending) return;
    const animate = this.roundStarted && this.gh.G.state === "playing";
    const ending = this.ending = { ready: false, shown: false, result: null };
    this.phase = "over";
    this.stopInput();
    clearInputState(this.input);
    this.input.enabled = false;
    this.ctx?.audio?.slideStop?.();
    const complete = () => {
      if (!this.active || this.ending !== ending) return;
      ending.ready = true;
      this.setTimeScale(1);
      this.ctx.match.state = "over";
      // Mark over before unlocking, so pointerlockchange cannot open Pause.
      this.gh.G.state = "over";
      this.dragActive = false;
      this.releaseDrag();
      globalThis.GHTouch?.deactivate();
      this.input.unlock();
      this.showRoundResult();
    };
    if (animate) {
      this.ctx.match.state = "ending";
      this.setTimeScale(.22);
      ending.timer = this.setTimer(complete, 2600);
    } else complete();
  }
  finishRound(outcome, award) {
    this.beginEnding();
    this.ending.result = { outcome, award };
    this.showRoundResult();
  }
  showRoundResult() {
    const ending = this.ending;
    if (!ending?.ready || !ending.result || ending.shown) return;
    ending.shown = true;
    const { outcome, award } = ending.result;
    this.ctx.audio.ui?.(outcome === 0 ? "victory" : "defeat");
    this.ctx.hud.matchEnd(outcome, this.ctx.match, award);
  }
  melee(actor, dir) {
    if (actor !== this.player || !this.active || !this.net.writer ||
        this.phase !== "live" || !actor.alive || this.gh.G.state !== "playing")
      return null;
    // Called at the native swing's contact frame. Only aim/tick go over the
    // reliable lane; the server chooses the victim and awards damage/score.
    this.reloadRequest = null;
    this.net.send({ type: "melee", tick: this.serverViewTick(),
      yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(clamp(dir.y, -1, 1)),
    }).catch(() => {});
    if (this.mapId === "hotel" && actor.eye?.clone) {
      this._meleePropFeedback(actor, actor.eye, dir);
    }
    return null;
  }
  _meleePropFeedback(actor, eye, dir) {
    const actors = this.ctx?.match?.actors || [];
    for (const target of actors) {
      if (target === actor || !target.alive || target.team === actor.team) continue;
      const dx = target.pos.x - eye.x, dy = target.pos.y + 1.1 - eye.y, dz = target.pos.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 0 && d <= 2.2 && (dx * dir.x + dy * dir.y + dz * dir.z) / d >= 0.55) return;
    }
    const physics = this.ctx?.physics;
    const hitProp = this._propHit || (this._propHit = { t: 0, body: null, nx: 0, ny: 0, nz: 0 });
    if (physics?.raycastProps?.(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 2, hitProp)) {
      const body = hitProp.body;
      const point = eye.clone().addScaledVector(dir, hitProp.t);
      physics.impulse?.(body, point.x, point.y, point.z, dir.x * 60, 22, dir.z * 60);
      if (body.breakable) physics.breakProp?.(body, dir);
      else this.ctx?.audio?.propHit?.(point, body.mat, 0.9);
      return;
    }
    const wall = this.world?.raycast?.(eye, dir, 1.7);
    if (wall && wall.distance > 1e-5) {
      const point = eye.clone().addScaledVector(dir, wall.distance);
      const normal = eye.clone().set(wall.normal.x, wall.normal.y, wall.normal.z);
      this.ctx?.audio?.impact?.(wall.surface, point);
      this.ctx?.fx?.smoke?.(point.x, point.y, point.z, 2, { size: 0.12, life: 0.6, a: 0.25 });
      wall.collider?.nativeCol?.onShot?.(point, normal, dir, actor);
    }
  }
  shotFeedback(shooter, origin, dir, muzzle, range = 140, opts = null) {
    const limit = Math.min(180, Math.max(1, range));
    const pellets = opts?.weapon?.pellets > 1 ? opts.weapon.pellets : 1;
    const spreadRad = pellets > 1 && opts?.spread > 0 ? opts.spread * Math.PI / 180 : 0;
    const soundState = { count: 0 };
    if (pellets === 1 || !spreadRad) {
      this._traceShotRay(shooter, origin, dir, muzzle, limit, opts, true, soundState);
      return;
    }
    const base = typeof dir.clone === "function" ? dir : origin.clone().set(dir.x, dir.y, dir.z);
    const axisA = origin.clone().set(0, 1, 0);
    if (Math.abs(base.y) > 0.95) axisA.set(1, 0, 0);
    axisA.cross(base).normalize();
    const axisB = base.clone().cross(axisA);
    for (let i = 0; i < pellets; i++) {
      const angle = Math.random() * Math.PI * 2, radius = Math.sqrt(Math.random()) * spreadRad;
      const rayDir = base.clone().addScaledVector(axisA, Math.cos(angle) * radius)
        .addScaledVector(axisB, Math.sin(angle) * radius).normalize();
      this._traceShotRay(shooter, origin, rayDir, muzzle, limit, opts, i === 0 || i % 3 === 0, soundState);
    }
  }
  _traceShotRay(shooter, origin, dir, muzzle, limit, opts, drawTracer, soundState) {
    const wall = this.world.raycast(origin, dir, limit);
    let distance = wall?.distance ?? limit, blockedByActor = false, propHit = null;
    for (const actor of this.ctx.match.actors) {
      if (actor === shooter || !actor.alive || actor.team === shooter.team) continue;
      const p = actor.pos, height = actor.e?.h || 1.8;
      const hit = rayBoxContact(origin, dir, [p.x - .3, p.y + .15, p.z - .3], [p.x + .3, p.y + height, p.z + .3], distance);
      if (hit && hit.distance < distance) { distance = hit.distance; blockedByActor = true; }
    }
    const physics = this.mapId === "hotel" ? this.ctx?.physics : null;
    const hitProp = this._propHit || (this._propHit = { t: 0, body: null, nx: 0, ny: 0, nz: 0 });
    if (physics?.raycastProps?.(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, distance, hitProp)) {
      distance = hitProp.t;
      blockedByActor = false;
      propHit = hitProp;
    }
    const point = origin.clone().addScaledVector(dir, distance);
    if (drawTracer) this.ctx.fx.tracer?.(muzzle || origin, point);
    if (propHit) {
      const body = propHit.body;
      const surf = body.mat === "soft" ? "fabric" : (body.mat || "wood");
      const normal = origin.clone().set(propHit.nx, propHit.ny, propHit.nz);
      this.ctx.fx?.impact?.(surf, point, normal);
      if (soundState.count++ < 3) this.ctx.audio?.impact?.(surf, point);
      const pellets = opts?.weapon?.pellets > 1 ? 0.55 : 1;
      const baseImpulse = opts?.weapon?.impulse ?? WEAPON_IMPULSE[opts?.weapon?.id ?? opts?.weaponId] ?? 6;
      const imp = Math.min(28, baseImpulse * pellets * 5);
      physics.impulse?.(body, point.x, point.y, point.z, dir.x * imp, dir.y * imp + imp * 0.12, dir.z * imp);
      if (body.breakable) physics.breakProp?.(body, dir);
      return;
    }
    if (wall && wall.distance > 1e-5 && !blockedByActor) {
      const normal = origin.clone().set(wall.normal.x, wall.normal.y, wall.normal.z);
      const nativeCol = this.mapId === "hotel" ? wall.collider?.nativeCol : null;
      nativeCol?.onShot?.(point, normal, dir, shooter);
      if (!nativeCol?.silent) {
        const floor = this.world.groundAt(point.x, point.z, point.y);
        wallImpact(this.ctx.fx, wall.surface, point, normal, Number.isFinite(floor) ? floor : -1e9,
          this.effectWorld, this.impactSurfaces);
        if (soundState.count++ < 3) this.ctx.audio.impact?.(wall.surface, point);
      }
    }
  }
  damageFeedback(e) {
    if (samePlayer(e.id, this.net.id)) return;
    const victim = this.actor(e.id), attacker = this.actor(e.attacker);
    const valid = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
    let point;
    if (valid(e.point)) point = this.player.pos.clone().set(...e.point);
    else if (victim?.pos) point = victim.pos.clone().set(victim.pos.x,
      victim.pos.y + (e.head ? (victim.e?.h || 1.8) - .17 : (victim.e?.h || 1.8) * .6), victim.pos.z);
    else return;
    const direction = point.clone();
    if (valid(e.dir)) direction.set(...e.dir);
    else if (attacker?.pos) direction.copy(point).sub(attacker.pos).setY(0);
    else direction.set(0, 0, -1);
    if (direction.lengthSq() < 1e-9) direction.set(0, 0, -1);
    direction.normalize();
    this.feedback(() => this.ctx.fx?.impact?.('flesh', point, direction.clone().negate()));
    this.feedback(() => this.ctx.fx?.bodyHit?.(point, direction, e.hp <= 0, !!e.head));
    this.feedback(() => this.ctx.audio.impact?.('flesh', point));
  }
  feedback(effect) {
    try { effect(); } catch {
      globalThis.GHDiagnostics?.record("online-feedback-error");
    }
  }
  syncActors(s) {
    const actors = this.ctx.match.actors;
    actors.length = 1;
    actors[0] = this.player;
    for (const p of s.players) {
      if (p.id === this.net.id) continue;
      const r = this.remotes.get(p.id);
      if (!r) continue;
      const actor = r.actor;
      Object.assign(actor, {
        id: p.id,
        name: this.room?.players.find((q) => q.id === p.id)?.name || "干员",
        team: p.team,
        yaw: p.yaw,
        health: p.hp,
        alive: p.alive,
        kills: p.kills,
        deaths: p.deaths,
        score: p.score,
      });
      actor.def.id = p.weapon;
      actor.e.h = p.sliding ? 0.95 : p.crouch ? 1.2 : 1.8;
      actor.pos.set(p.x, p.y, p.z);
      actors.push(actor);
    }
    this.ctx.match.actors = actors;
    syncTeamRadar(this.ctx.hud.map, actors);
  }
  actor(id) {
    if (samePlayer(id, this.net.id)) return this.player;
    return this.remotes.get(id)?.actor ?? this.remotes.get(Number(id))?.actor;
  }
  removeRemote(id) {
    const remote = this.remotes.get(id);
    if (!remote) return;
    // Native disposal releases the per-rig skeleton / bone texture and fade
    // materials. Body and weapon geometry/materials belong to shared caches.
    remote.rig.dispose?.();
    this.sceneLayers?.forget(remote.rig.root);
    remote.rig.root.removeFromParent();
    this.remotes.delete(id);
  }
  flushInitialEvents() {
    if (this.hasInitialSnapshot) return;
    this.hasInitialSnapshot = true;
    const now = performance.now(),
      queued = this.initialEvents;
    this.initialEvents = [];
    for (const item of queued)
      if (now - item.received <= INITIAL_EVENT_MAX_AGE)
        this.applyEvent(item.event);
  }
  createRemote(p) {
    // Native palette 0 is blue and palette 1 is red. Keep the authoritative
    // team on actors; choose model colours relative to the local player.
    const visualTeam = teamPalette(p.team, this.player.team);
    const ctx = this.ctx.botCtx,
      rig = ctx.createCharacter({
        team: visualTeam,
        gunFactory: (id) => ctx.worldGun(id),
        ground: (x, z, y) => this.world.groundAt(x, z, y),
      });
    rig.setWeapon(p.weapon);
    rig.root.visible = p.alive;
    ctx.scene.add(rig.root);
    this.sceneLayers?.share(rig.root);
    rig.root.traverse((n) => {
      if (n.isMesh) {
        // Remote rigs are cosmetic. Let Three.js cull off-screen meshes (including
        // body SkinnedMesh whose boundingSphere tracks live pelvis) and keep them
        // out of the expensive shadow-map pass.
        n._ghShadow = false;
        n.castShadow = false;
        n.receiveShadow = false;
        n.frustumCulled = n.name === "body" || !n.isSkinnedMesh;
      }
    });
    this.remotes.set(p.id, {
      rig,
      team: p.team,
      visualTeam,
      weapon: p.weapon,
      actor: {
        id: p.id,
        isPlayer: false,
        lastShot: -100,
        pos: this.player.pos.clone(),
        e: { h: 1.8 },
        def: { id: p.weapon },
      },
      pos: this.player.pos.clone(),
      state: {
        pos: this.player.pos.clone(),
        yaw: p.yaw,
        pitch: p.pitch,
        speed: 0,
        moveX: 0,
        moveZ: 0,
        stance: "stand",
        sprint: false,
        airborne: false,
        reloading: false,
        dead: false,
      },
    });
  }
  remoteRenderTimeAt(now) {
    const latest = this.snapshots.at(-1);
    if (!latest) return null;
    const desired = latest.time + (now - latest.received) - 100;
    // A delayed newer packet must not rewind a remote actor already rendered.
    return this.remoteRenderTime = Math.max(this.remoteRenderTime ?? desired,
      Math.min(latest.time, desired));
  }
  serverViewTick(now = this.now()) {
    const latest = this.snapshots.at(-1);
    if (!latest) return this.net.latestTick;
    const renderTime = this.remoteRenderTimeAt(now);
    const ticksBehind = Math.round(Math.max(0, latest.time - renderTime) / (1000 * STEP));
    return Math.max(0, latest.tick - ticksBehind);
  }
  renderRemotes(dt) {
    if (!this.snapshots.length) return;
    const latest = this.snapshots.at(-1);
    const target = this.remoteRenderTimeAt(this.now());
    let a = this.snapshots[0],
      b = latest;
    for (let i = 1; i < this.snapshots.length; i++)
      if (this.snapshots[i].time >= target) {
        a = this.snapshots[i - 1];
        b = this.snapshots[i];
        break;
      }
    const t = clamp((target - a.time) / (b.time - a.time || 1), 0, 1);
    for (const p of b.players) {
      const r = this.remotes.get(p.id);
      if (!r) continue;
      const previous = a.players.find((q) => q.id === p.id) || p;
      const prev = previous.alive === p.alive ? previous : p;
      r.rig.root.visible = p.alive && p.connected;
      if (!r.rig.root.visible) continue;
      if (r.weapon !== p.weapon) {
        r.rig.setWeapon(p.weapon);
        r.weapon = p.weapon;
      }
      const state = r.state;
      state.pos.set(
        prev.x + (p.x - prev.x) * t,
        prev.y + (p.y - prev.y) * t,
        prev.z + (p.z - prev.z) * t,
      );
      let delta = (p.yaw - prev.yaw) % (2 * Math.PI);
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      state.yaw = prev.yaw + delta * t;
      state.pitch = prev.pitch + (p.pitch - prev.pitch) * t;
      const vx = prev.vx + (p.vx - prev.vx) * t;
      const vz = prev.vz + (p.vz - prev.vz) * t;
      state.speed = Math.hypot(vx, vz);
      // Character rigs use the native bot convention (positive Z is back),
      // unlike the first-person player's forward-positive viewmodel contract.
      state.moveX =
        (vx * Math.cos(state.yaw) - vz * Math.sin(state.yaw)) / (state.speed || 1);
      state.moveZ =
        (vx * Math.sin(state.yaw) + vz * Math.cos(state.yaw)) / (state.speed || 1);
      state.stance = p.sliding ? "slide" : p.crouch ? "crouch" : "stand";
      state.sprint = !p.sliding && state.speed > 5;
      state.airborne = !p.ground;
      state.reloading = p.reload > 0;
      state.dead = false;
      r.actor.pos.copy(state.pos);
      r.actor.yaw = state.yaw;
      if (this.phase === "live" && this.mapId === "hotel" && Math.hypot(p.x - prev.x, p.z - prev.z) < 1.8) {
        const h = p.sliding ? 0.95 : p.crouch ? 1.2 : 1.8;
        const cvx = Math.max(-7, Math.min(7, vx));
        const cvz = Math.max(-7, Math.min(7, vz));
        this.ctx?.physics?.pushFrom?.(state.pos.x, state.pos.y, state.pos.y + h, state.pos.z, 0.4, cvx, cvz);
      }
      r.rig.update(dt, state);
    }
  }
  event(e) {
    if (!this.active) return;
    this.glass?.receive(e, this.roundStarted && this.gh.G.state === 'playing');
    if (!this.hasInitialSnapshot && INITIAL_EVENT_TYPES.has(e.type)) {
      if (this.initialEvents.length >= INITIAL_EVENT_LIMIT) {
        const cosmetic = this.initialEvents.findIndex(item => item.event.type === "shot");
        if (cosmetic >= 0) this.initialEvents.splice(cosmetic, 1);
        else if (e.type === "shot") return;
        else this.initialEvents.shift();
      }
      this.initialEvents.push({ event: e, received: performance.now() });
      return;
    }
    // The initial snapshot contains the current spawn state. Applying an
    // earlier reliable spawn after it would briefly mark the local player dead.
    if (!this.hasInitialSnapshot && e.type === "spawn") return;
    this.applyEvent(e);
  }
  applyEvent(e) {
    const p = this.player;
    if (e.type === "shot" && !samePlayer(e.id, this.net.id)) {
      const r = this.remotes.get(e.id);
      this.feedback(() => r?.rig.kick());
      if (r) r.actor.lastShot = this.ctx.time();
      const pos = p.pos.clone().set(e.x, e.y, e.z),
        dir = p.pos.clone().set(e.dx, e.dy, e.dz);
      this.feedback(() => this.ctx.audio.gunshot(e.weapon, pos));
      this.feedback(() => this.ctx.fx.muzzle?.(pos, dir, 1, true));
      if (r) this.feedback(() => this.shotFeedback(
        r.actor, pos, dir, pos,
        this.specs?.find(w => w.id === e.weapon)?.range || (e.weapon === "m200" ? 180 : 140),
        { weaponId: e.weapon },
      ));
    }
    if (e.type === "damage" && samePlayer(e.id, this.net.id)) {
      p.health = e.hp;
      this.feedback(() => p.addShake(0.25));
      this.feedback(() => { this.debug.gfx.uniforms.uDamage.value = 0.6; });
      this.feedback(() => this.ctx.audio.hurt(0.4));
      this.feedback(() => this.ctx.fx?.playerHurt?.(e.amount || 20));
    }
    if (e.type === "damage" && samePlayer(e.attacker, this.net.id)) {
      this.feedback(() => this.ctx.hud.hit(e.head, false, false));
      if (e.weapon === "melee") {
        this.feedback(() => this.ctx.audio.foley("melee_hit"));
        this.feedback(() => p.addShake(0.2));
      }
    }
    if (e.type === "damage") this.damageFeedback(e);
    if (e.type === "kill") {
      const killer = this.actor(e.killer),
        victim = this.actor(e.victim);
      const localKill = samePlayer(e.killer, this.net.id);
      // A kill can outrun the snapshot that creates the victim's rig.
      if (localKill) this.feedback(() => this.ctx.hud.hit(e.head, true, false));
      if (victim) {
        victim.alive = false;
        if (localKill) this.feedback(() => this.ctx.hud.kill(victim, []));
        if (samePlayer(e.victim, this.net.id)) this.feedback(() => this.ctx.hud.died(killer, e.weapon));
        this.feedback(() => this.ctx.hud.killfeed(killer, victim, e.weapon, e.head));
      }
    }
    if (e.type === "welcome") {
      this.shotAcks = false;
      this.shotSeq = 0;
      this.pendingShots.length = 0;
    }
    if (e.type === "welcome" || e.type === "loadout") {
      this.seq = Math.max(this.seq, e.inputSeq || 0);
      this.specs = e.weapons;
      this.m200Build = e.m200Build;
      this.rpkBuild = e.rpkBuild;
      this.applySpecs();
    }
    if (e.type === "round-start") {
      this.pendingShots.length = 0;
      this.resetEnding();
      this.resetStairs();
      if (this.mapId === "hotel") this.resetHotelState();
      else this.ctx?.fx?.reset?.();
      this.roundStarted = false;
      this.predicted = null;
      this.reloadRequest = null;
    }
    if (e.type === "round-end") {
      this.beginEnding();
    }
    if (e.type === "spawn" && e.id === this.net.id) {
      this.pendingShots.length = 0;
      this.player.alive = false;
      this.pending = [];
      this.reloadRequest = null;
    }
  }
  exit() {
    const wasActive = this.active;
    const wasHotel = !this.mapId || this.mapId === "hotel";
    this.active = false;
    this.mapId = null;
    this.mapVersion = null;
    this.resetEnding();
    this.resetStairs();
    this.cancelDeployment();
    if (!wasActive) return;
    this.ctx?.fx?.reset?.();
    this.impactSurfaces?.dispose();
    this.impactSurfaces = this.effectWorld = null;
    this.glass?.dispose();
    this.glass = null;
    if (wasHotel) this.resetHotelState({ muteLounge: true });
    document.body.classList.remove("online-session");
    setTeamPerspective(document.body, null);
    resetTeamRadar(this.ctx.hud.map);
    this.dragActive = false;
    this.releaseDrag();
    clearInputState(this.input);
    this.controls.abort();
    for (const id of this.remotes.keys()) this.removeRemote(id);
    this.snapshots = [];
    this.pending = [];
    this.pendingShots.length = 0;
    this.shotAcks = false;
    this.initialEvents = [];
    this.lastSnapshot = null;
    this.reloadRequest = null;
    this.room = null;
    this.hasInitialSnapshot = false;
    this.lastUpdateAt = null;
    this.remoteRenderTime = null;
    this.jumpRequestUntil = 0;
    this.jumpInputHeld = false;
    this.crouchInputHeld = false;
    this.slideRequestPending = false;
    this.slideRequestUntil = 0;
    const o = this.original,
      c = this.ctx,
      p = this.player;
    p.update = o.playerUpdate;
    p.damage = o.damage;
    p.team = o.playerTeam;
    c.match.update = o.matchUpdate;
    c.match.damage = o.matchDamage;
    c.match.actors = o.actors;
    c.match.bots = o.bots;
    c.match.scores = o.scores;
    c.match.time = o.time;
    c.hud.update = o.hudUpdate;
    c.combat.fire = o.fire;
    c.combat.melee = o.melee;
    c.arsenal.startReload = o.reload;
    c.arsenal._load = o.loadAmmo;
    c.arsenal._events = o.weaponEvents;
    c.arsenal.swap = o.swap;
    this.input.onLockChange = o.lockChange;
    this.input.lock = o.lock;

    this.predicted = null;
    this.gh.G.state = "menu";
    c.match.state = "idle";
    document.querySelector("#hud").style.display = "";
    c.hud.show("menu");
    c.audio.slideStop?.();
    c.audio.music.menu(true);
    p.reset();
    c.arsenal.reset(c.settings.primary);
  }
}
