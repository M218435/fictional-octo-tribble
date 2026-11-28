import { TouchInput, stickVector } from "./touch-input.js";
import { GyroAim } from "./gyro-aim.js";
import "./input-devices.js";
import { startupPolicy } from "./performance-policy.js";
import { defaultLayout, normalizeLayout, controlRect, readLayout, saveLayout, canStartLook, touchLookDelta, LAYOUT_KEY } from "./touch-layout.js";
import { lockLandscapeOrientation, requestLandscape } from "./screen-orientation.js";

const heldActions = {
  fire: "Mouse0",
  aim: "Mouse1",
  jump: "Space",
  reload: "KeyR",
  grenade: "KeyG",
  melee: "KeyV",
  upgrade: "KeyB",
  dive: "KeyX",
  inspect: "KeyT",
};
const toggleActions = { sprint: "ShiftLeft", score: "Tab" };
const actions = [
  ["fire", "开火"], ["aim", "瞄准"], ["jump", "跳跃"],
  ["crouch", "蹲下"], ["reload", "换弹"], ["swap", "切枪"],
  ["sprint", "冲刺"], ["grenade", "手雷", true],
  ["melee", "近战"], ["upgrade", "军犬", true],
  ["dive", "飞扑", true],
];

export class TouchControls {
  constructor() {
    this.coarse = matchMedia("(pointer: coarse)");
    this.handheld = startupPolicy({ coarse: this.coarse.matches, mobile: navigator.userAgentData?.mobile,
      userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }).mobile;
    this.enabled = this.handheld;
    this.usedTouch = false;
    this.pointers = new Map();
    this.owners = new Map();
    this.vector = {};
    this.lookVector = {};
    this.lookOwner = null;
    try { this.storage = globalThis.localStorage; } catch { this.storage = null; }
    this.gyro = new GyroAim({
      storage: this.storage,
      canAim: mode => this.canGyroAim(mode),
      look: (yaw, pitch) => this.addLook(-yaw / 0.0022, -pitch / 0.0022),
    });
    this.layout = readLayout(this.storage, Math.max(innerWidth, innerHeight), Math.min(innerWidth, innerHeight));
    try { this.customLayout = JSON.parse(this.storage?.getItem(LAYOUT_KEY))?.version === 1; } catch { this.customLayout = false; }
    this.buttons = new Map();
    this.root = document.createElement("div");
    this.root.id = "touch-controls";
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "触屏战斗操作");
    this.look = document.createElement("div");
    this.look.id = "touch-look";
    this.look.setAttribute("aria-label", "拖动调整视角");
    this.stick = document.createElement("div");
    this.stick.id = "touch-stick";
    this.stick.setAttribute("aria-label", "移动摇杆");
    this.stick.innerHTML = '<span class="touch-stick-knob"></span>';
    const group = document.createElement("div");
    group.className = "touch-actions";
    for (const [action, label, offline] of actions) {
      const button = this.button(action, label);
      if (offline) button.dataset.offline = "";
      group.append(button);
    }
    this.root.append(this.look, this.stick, group);
    this.utility = document.createElement("div");
    this.utility.className = "touch-utility";
    for (const [action, label] of [["score", "战绩"], ["pause", "暂停"], ["inspect", "检视"], ["fullscreen", "全屏"]])
      this.utility.append(this.button(action, label));
    this.rotate = document.createElement("div");
    this.rotate.id = "touch-rotate";
    this.rotate.hidden = true;
    this.rotate.setAttribute("role", "alertdialog");
    this.rotate.setAttribute("aria-modal", "true");
    this.rotate.setAttribute("aria-label", "请横屏游玩");
    this.rotate.innerHTML = `<div class="touch-rotate-card">
      <div class="touch-rotate-phone" aria-hidden="true">
        <span class="touch-rotate-phone-body"><span class="touch-rotate-phone-screen"></span></span>
        <span class="touch-rotate-arrow">↻</span>
      </div>
      <div class="touch-rotate-title">请横屏游玩</div>
      <div class="touch-rotate-note">本游戏为横屏 FPS 射击体验，请横向握持手机或平板；也可点击下方按钮尝试自动切换横屏。</div>
      <div class="touch-rotate-actions">
        <button type="button" class="btn" data-rotate-action="landscape">一键切换横屏</button>
        <button type="button" class="btn ghost" data-rotate-action="quit" hidden>返回主菜单</button>
      </div>
      <p class="touch-rotate-status" role="status"></p>
    </div>`;
    this.rotateLockButton = this.rotate.querySelector('[data-rotate-action="landscape"]');
    this.rotateQuitButton = this.rotate.querySelector('[data-rotate-action="quit"]');
    this.rotateStatus = this.rotate.querySelector(".touch-rotate-status");
    this.rotateLockButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.tryAutoLandscape({ interactive: true });
    });
    this.rotateQuitButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.bind()) this.gh.debug.ctx.hud.menus.cb.onQuit();
    });
    this.rotate.addEventListener("click", (event) => {
      if (event.target.closest('[data-rotate-action="quit"]')) return;
      void this.tryAutoLandscape({ interactive: true });
    });
    this.safeBounds = document.createElement("div");
    this.safeBounds.className = "touch-safe-bounds";
    this.safeBounds.setAttribute("aria-hidden", "true");
    document.body.append(this.safeBounds, this.root, this.utility, this.rotate);
    this.buttons.get("fullscreen").hidden = !(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    this.root.addEventListener("pointerdown", (event) => this.pointerDown(event));
    this.utility.addEventListener("pointerdown", (event) => this.pointerDown(event));
    addEventListener("pointermove", (event) => this.pointerMove(event), { passive: false });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      addEventListener(type, (event) => this.pointerEnd(event));
    addEventListener("pointerdown", (event) => {
      if (!this.usedTouch && (event.pointerType === "touch" || event.pointerType === "pen")) {
        this.usedTouch = true;
        this.setDevice();
      }
    }, { capture: true });
    for (const element of [this.root, this.utility]) {
      element.addEventListener("contextmenu", (event) => event.preventDefault());
      element.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (event.detail === 0 && button && !button.disabled) {
          event.preventDefault();
          this.tap(button.dataset.action);
        }
      });
    }
    this.coarse.addEventListener("change", () => this.setDevice());
    addEventListener("resize", () => this.resize());
    globalThis.visualViewport?.addEventListener("resize", () => this.resize());
    addEventListener("orientationchange", () => this.resize());
    globalThis.screen?.orientation?.addEventListener?.("change", () => this.resize());
    document.addEventListener("fullscreenchange", () => this.resize());
    addEventListener("blur", () => this.suspend());
    addEventListener("pagehide", () => this.suspend());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.suspend();
    });
    this.setDevice();
  }
  button(action, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "touch-button";
    button.dataset.action = action;
    button.textContent = label;
    button.setAttribute("aria-label", label);
    if (toggleActions[action] || action === "crouch" || action === "fire" || action === "aim")
      button.setAttribute("aria-pressed", "false");
    this.buttons.set(action, button);
    return button;
  }
  setDevice() {
    const enabled = globalThis.GHInput ? globalThis.GHInput.effective === "touch" : this.coarse.matches || this.handheld || this.usedTouch;
    if (!enabled && this.enabled) this.deactivate();
    this.enabled = enabled;
    this.gyro.setTouchSelected(enabled);
    document.body.classList.toggle("touch-device", enabled || this.handheld);
    this.resize();
  }
  resize() {
    const portrait = (this.enabled || this.handheld) && innerHeight > innerWidth;
    if (portrait && !this.portrait) {
      this.suspend();
      void this.tryAutoLandscape({ interactive: false });
    } else if (this.pointers.size) this.reset();
    this.portrait = portrait;
    if (!portrait && this.rotateStatus) this.rotateStatus.textContent = "";
    this.gyro.reset();
    document.body.classList.toggle("touch-portrait", portrait);
    const { width, height } = this.viewport();
    if (!this.customLayout) this.layout = defaultLayout(Math.max(width, height), Math.min(width, height));
    this.applyLayout();
    this.update();
  }
  async tryAutoLandscape({ interactive = true } = {}) {
    if (this._rotating) return { ok: false, reason: "busy", message: "" };
    this._rotating = true;
    if (interactive && this.rotateLockButton) this.rotateLockButton.disabled = true;
    try {
      const result = await requestLandscape({ interactive });
      this.resize();
      if (interactive && !result.ok && this.portrait && this.rotateStatus) {
        this.rotateStatus.textContent = result.message;
      } else if (result.ok && this.rotateStatus) {
        this.rotateStatus.textContent = "";
      }
      return result;
    } finally {
      this._rotating = false;
      if (this.rotateLockButton) this.rotateLockButton.disabled = false;
    }
  }
  viewport() {
    const rect = this.safeBounds.getBoundingClientRect();
    return rect.width && rect.height ? rect : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }
  setLayout(value) {
    const { width, height } = this.viewport();
    this.reset();
    this.layout = normalizeLayout(value, width, height);
    this.customLayout = true;
    this.applyLayout();
    return saveLayout(this.storage, this.layout);
  }
  applyLayout() {
    const { width, height } = this.viewport();
    for (const [id, item] of Object.entries(this.layout.controls)) {
      const element = id === "stick" ? this.stick : this.buttons.get(id);
      if (!element) continue;
      const utility = this.utility.contains(element);
      if (utility && !this.layoutPlaying) {
        for (const property of ["left", "top", "width", "height", "--touch-opacity"]) element.style.removeProperty(property);
        continue;
      }
      const rect = controlRect(item, width, height);
      element.style.left = `${rect.left}px`;
      element.style.top = `${rect.top}px`;
      element.style.width = element.style.height = `${rect.size}px`;
      element.style.setProperty("--touch-opacity", item.opacity);
    }
  }
  bind() {
    const gh = globalThis.GH;
    if (!gh?.ready) return false;
    if (!this.state) {
      this.gh = gh;
      this.state = new TouchInput(gh.debug.input);
    }
    return true;
  }
  activate() {
    if (!this.enabled || this.portrait || document.hidden || !this.bind()) return false;
    void lockLandscapeOrientation();
    this.reset();
    this.state.input.touchActive = true;
    this.state.input.onLockChange?.(true);
    this.update();
    this.gh.debug.ctx.hud.hint("左侧摇杆移动 · 右侧拖动瞄准 · 按住开火可同时调整视角", 5);
    return true;
  }
  deactivate() {
    this.gyro.stop();
    this.reset();
    if (this.state) this.state.input.touchActive = false;
  }
  suspend() {
    if (!this.enabled) return;
    this.deactivate();
    if (this.bind() && this.gh.G.state === "playing") this.state.input.onLockChange?.(false);
    this.update();
  }
  reset() {
    this.gyro.reset();
    this.state?.reset();
    const pointers = [...this.pointers.values()];
    this.pointers.clear();
    this.owners.clear();
    this.lookOwner = null;
    for (const pointer of pointers)
      if (pointer.element.hasPointerCapture(pointer.id)) pointer.element.releasePointerCapture(pointer.id);
    this.stick.style.setProperty("--stick-x", "0px");
    this.stick.style.setProperty("--stick-y", "0px");
    for (const button of this.buttons.values())
      if (button.hasAttribute("aria-pressed")) button.setAttribute("aria-pressed", "false");
  }
  update() {
    if (!this.bind()) {
      this.rotate.hidden = !this.portrait;
      if (this.rotateQuitButton) this.rotateQuitButton.hidden = true;
      this.utility.hidden = !this.enabled || this.portrait;
      for (const action of ["score", "pause", "inspect"]) this.buttons.get(action).hidden = true;
      return;
    }
    const { G, debug } = this.gh;
    const playing = G.state === "playing";
    const paused = G.state === "paused";
    const rotationHidden = !this.portrait;
    if (this.rotate.hidden !== rotationHidden) this.rotate.hidden = rotationHidden;
    if (this.rotateQuitButton) {
      const quitHidden = !(playing || paused);
      if (this.rotateQuitButton.hidden !== quitHidden) this.rotateQuitButton.hidden = quitHidden;
    }
    const alive = debug.player.alive;
    const online = document.body.classList.contains("online-session");
    const interactive = this.enabled && !this.portrait && !document.hidden && playing && alive && debug.ctx.match.state !== "countdown" && debug.ctx.match.state !== "over";
    if ((!interactive && this.interactive) || (this.enabled && this.online !== undefined && this.online !== online)) this.reset();
    this.interactive = interactive;
    this.online = online;
    if (globalThis.GHInput?.effective !== "gamepad")
      this.state.input.touchActive = this.enabled && !this.portrait && !document.hidden && playing;
    const board = this.state.input.keys.has("Tab") || this.state.input.touchKeys.has("Tab");
    const aiming = interactive && !!this.state.input.aim?.requested();
    this.gyro.sync();
    const view = this.view;
    if (view && view.state === G.state && view.phase === debug.ctx.match.state &&
        view.alive === alive && view.online === online && view.board === board && view.aiming === aiming &&
        view.portrait === this.portrait && view.enabled === this.enabled &&
        view.hidden === document.hidden && view.revision === this.state.revision &&
        view.stance === debug.player.stance && view.mode === debug.player.mode) return;
    this.view = {
      state: G.state, phase: debug.ctx.match.state, alive, online, board, aiming,
      portrait: this.portrait, enabled: this.enabled, hidden: document.hidden,
      revision: this.state.revision, stance: debug.player.stance, mode: debug.player.mode,
    };
    this.root.hidden = !this.enabled || this.portrait || !playing || board;
    this.utility.hidden = !this.enabled || this.portrait;
    this.buttons.get("score").hidden = !playing;
    this.buttons.get("pause").hidden = !playing && !paused;
    this.buttons.get("inspect").hidden = !interactive;
    const pauseLabel = paused ? "继续" : "暂停";
    if (this.buttons.get("pause").textContent !== pauseLabel) {
      this.buttons.get("pause").textContent = pauseLabel;
      this.buttons.get("pause").setAttribute("aria-label", pauseLabel);
    }
    document.body.classList.toggle("touch-playing", this.enabled && playing);
    if (this.layoutPlaying !== playing) {
      this.layoutPlaying = playing;
      this.applyLayout();
    }
    document.body.classList.toggle("touch-dead", this.enabled && playing && !alive);
    for (const [action, button] of this.buttons) {
      if (action in heldActions || action === "crouch" || action === "swap" || action === "sprint")
        button.disabled = !interactive;
      if (button.hasAttribute("data-offline")) button.hidden = online;
      if (button.hasAttribute("aria-pressed")) {
        const code = heldActions[action] || toggleActions[action];
        const pressed = action === "aim" ? aiming : action === "crouch"
          ? (online ? this.state.input.touchKeys.has("KeyC") : debug.player.stance === "crouch" || debug.player.mode === "slide")
          : this.state.input.touchKeys.has(code);
        const value = String(pressed);
        if (button.getAttribute("aria-pressed") !== value) button.setAttribute("aria-pressed", value);
      }
    }
  }
  pointerDown(event) {
    if (!this.enabled || this.portrait || (event.pointerType === "mouse" && event.button !== 0)) return;
    const button = event.target.closest("button[data-action]");
    if (button?.disabled) return;
    event.preventDefault();
    const action = button?.dataset.action;
    if (action && !(action in heldActions) && !(this.online && action === "crouch")) {
      this.tap(action);
      return;
    }
    if (!this.interactive || this.owners.has(button || event.target)) return;
    let kind, element, code;
    if (event.target === this.stick || this.stick.contains(event.target)) {
      kind = "stick";
      element = this.stick;
    } else if (event.target === this.look || action === "fire") {
      if (!action && !canStartLook(event.clientX, this.viewport(), this.lookOwner !== null)) return;
      kind = action === "fire" && !this.layout.fireLook ? "button" : "look";
      element = button || this.look;
      code = heldActions[action];
    } else if (action === "crouch" && this.online) {
      kind = "button";
      element = button;
      code = "KeyC";
    } else if (action in heldActions) {
      kind = "button";
      element = button;
      code = heldActions[action];
    } else return;
    if (element.hasAttribute("data-offline") && this.online) return;
    const tapAim = action === "aim" && globalThis.GHInput?.preferences.aim.touch.mode === "toggle";
    const pointer = { id: event.pointerId, element, kind, code: tapAim ? null : code, tapAim, x: event.clientX, y: event.clientY };
    if (kind === "stick") pointer.rect = element.getBoundingClientRect();
    this.pointers.set(event.pointerId, pointer);
    this.owners.set(element, event.pointerId);
    if (kind === "look" && this.lookOwner === null) this.lookOwner = event.pointerId;
    element.setPointerCapture(event.pointerId);
    if (pointer.code) this.state.press(pointer.code);
    if (kind === "stick") this.moveStick(pointer, event);
    this.update();
  }
  pointerMove(event) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    event.preventDefault();
    const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : null;
    const events = samples && samples.length ? samples : [event];
    if (pointer.kind === "stick") {
      this.moveStick(pointer, events[events.length - 1]);
      return;
    }
    if (pointer.kind === "look") {
      if (this.lookOwner === null) this.lookOwner = event.pointerId;
      let totalDx = 0, totalDy = 0;
      for (const sample of events) {
        totalDx += sample.clientX - pointer.x;
        totalDy += sample.clientY - pointer.y;
        pointer.x = sample.clientX;
        pointer.y = sample.clientY;
      }
      if (this.lookOwner === event.pointerId && (totalDx || totalDy)) {
        const { player } = this.gh.debug;
        const delta = touchLookDelta(totalDx, totalDy,
          this.layout.sensitivity, player.adsK, this.lookVector);
        this.addLook(delta.x, delta.y);
      }
    }
  }
  canGyroAim(mode) {
    if (!this.enabled || this.portrait || document.hidden || !this.gh) return false;
    const { G, debug } = this.gh;
    const input = this.state.input;
    return G.state === "playing" && !G.freeCam && debug.ctx.match.state === "live" &&
      debug.player.alive && input.enabled && input.touchActive &&
      !input.keys.has("Tab") && !input.touchKeys.has("Tab") &&
      (mode === "always" || (input.held("Mouse1") || input.held("Mouse2")));
  }
  addLook(x, y) {
    // Both versions apply the desktop sensitivity after reading touch input.
    const { player, ctx } = this.gh.debug;
    const mouseScale = ctx.settings.sens * (1 + (ctx.settings.adsSens - 1) * player.adsK);
    const compensation = Number.isFinite(mouseScale) && mouseScale > 0 ? mouseScale : 1;
    this.state.look(x / compensation, y / compensation);
  }
  moveStick(pointer, event) {
    const rect = pointer.rect;
    const radius = Math.max(0, Math.min(rect.width, rect.height) / 2 - 22);
    const v = stickVector(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2, radius, this.vector);
    this.state.move(v.forward, v.right);
    this.stick.style.setProperty("--stick-x", `${v.x}px`);
    this.stick.style.setProperty("--stick-y", `${v.y}px`);
  }
  pointerEnd(event) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    this.pointers.delete(event.pointerId);
    this.owners.delete(pointer.element);
    if (this.lookOwner === event.pointerId) this.lookOwner = null;
    if (pointer.code) this.state.release(pointer.code);
    if (pointer.tapAim && event.type === "pointerup" && this.interactive) this.state.pulse("Mouse1");
    if (pointer.kind === "stick") {
      this.state.move(0, 0);
      this.stick.style.setProperty("--stick-x", "0px");
      this.stick.style.setProperty("--stick-y", "0px");
    }
    if (pointer.element.hasPointerCapture(pointer.id)) pointer.element.releasePointerCapture(pointer.id);
    this.update();
  }
  tap(action) {
    if (action === "fullscreen") return this.fullscreen();
    if (!this.bind()) return;
    if (action === "pause") {
      if (this.gh.G.state === "paused") this.gh.debug.ctx.hud.menus.cb.onResume();
      else this.suspend();
      return;
    }
    if (action === "score") {
      if (this.gh.G.state !== "playing") return;
      // Stop captured movement/fire before opening the scrollable scoreboard.
      const opening = !this.state.input.touchKeys.has("Tab");
      this.reset();
      if (opening) this.state.press("Tab");
    } else if (this.interactive) {
      if (toggleActions[action]) this.state.toggle(toggleActions[action]);
      else if (action === "crouch") {
        if (this.online) this.state.pulse("KeyC");
        else {
          const crouched = this.gh.debug.player.stance === "crouch" || this.gh.debug.player.mode === "slide";
          if (crouched) this.state.release("KeyC");
          else this.state.press("KeyC");
          this.state.pulse("KeyC");
        }
      } else if (action === "swap") this.state.pulse(this.gh.debug.ctx.arsenal.cur === 0 ? "Digit2" : "Digit1");
      else if (heldActions[action]) this.state.pulse(heldActions[action]);
    }
    this.update();
  }
  async fullscreen() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        await exit.call(document);
      } else {
        const enter = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
        if (enter) {
          await enter.call(document.documentElement);
          if (this.enabled || this.handheld) await lockLandscapeOrientation();
        }
      }
    } catch {
      if (this.bind()) this.gh.debug.ctx.hud.hint("浏览器未允许全屏，请通过浏览器菜单收起工具栏。", 4);
    }
  }
}

if (typeof document !== "undefined") globalThis.GHTouch = new TouchControls();
