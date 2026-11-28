import { startupPolicy } from "./performance-policy.js";
import { clearInputState } from "./desktop-input.js";
import { GamepadControls, navigateGamepadMenu } from "./gamepad-controls.js";
import { KeyBindings } from "./key-bindings.js";
import { aimPreferences, installAimInput } from "./aim-input.js";

export const INPUT_SETTINGS_KEY = "gh-input-devices-v1";
export const INPUT_MODES = ["auto", "keyboard", "touch", "gamepad"];
export function inputPreferences(value = {}) {
  const number = (key, fallback, min, max) => Number.isFinite(value[key]) ? Math.max(min, Math.min(max, value[key])) : fallback;
  return { mode: INPUT_MODES.includes(value.mode) ? value.mode : "auto",
    sensitivity: number("sensitivity", 1, .25, 3), deadzone: number("deadzone", .18, .08, .35),
    invertY: value.invertY === true, aim: aimPreferences(value.aim) };
}

export class InputDevices extends EventTarget {
  constructor({ storage, handheld = false, win, doc, getPads } = {}) {
    super();
    this.storage = storage;
    this.keyBindings = new KeyBindings({ storage });
    this.win = win;
    this.doc = doc;
    this.handheld = handheld;
    this.getPads = getPads;
    let saved;
    try { saved = JSON.parse(storage?.getItem(INPUT_SETTINGS_KEY) || "{}"); } catch {}
    this.preferences = inputPreferences(saved || {});
    this.automatic = handheld ? "touch" : "keyboard";
    this.effective = this.preferences.mode === "auto" ? this.automatic : this.preferences.mode;
    this.padStatus = "尚未检测到手柄，连接后按任意按键。";
    this.events = new AbortController();
    const options = { capture: true, signal: this.events.signal };
    win?.addEventListener("pointerdown", event => {
      this.choose(event.pointerType === "touch" || event.pointerType === "pen" ? "touch" : "keyboard");
    }, options);
    win?.addEventListener("keydown", event => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey) this.choose("keyboard");
    }, options);
    this.paint();
  }
  paint() {
    const body = this.doc?.body;
    if (body) {
      body.dataset.inputMode = this.effective;
      for (const mode of INPUT_MODES.slice(1)) body.classList.toggle("input-" + mode, mode === this.effective);
    }
  }
  save(value) {
    const previous = this.effective;
    const previousAim = this.preferences.aim[previous];
    this.preferences = inputPreferences({ ...this.preferences, ...value });
    this.effective = this.preferences.mode === "auto" ? this.automatic : this.preferences.mode;
    let saved = true;
    try { if (!this.storage) throw Error(); this.storage.setItem(INPUT_SETTINGS_KEY, JSON.stringify(this.preferences)); } catch { saved = false; }
    if (previous !== this.effective) this.changed();
    else {
      const aim = this.preferences.aim[this.effective];
      if (aim.mode !== previousAim.mode || aim.auto !== previousAim.auto) this.gh?.debug.input.aim?.reset();
      this.dispatchEvent(new Event("change"));
    }
    return saved;
  }
  choose(mode) {
    if (this.preferences.mode !== "auto" || this.effective === mode) return;
    this.automatic = mode;
    this.effective = mode;
    this.changed();
  }
  changed() {
    this.pause();
    this.gamepad?.reset();
    this.win?.GHTouch?.deactivate();
    if (this.gh) clearInputState(this.gh.debug.input);
    this.paint();
    this.win?.GHTouch?.setDevice();
    this.dispatchEvent(new Event("change"));
  }
  pause() {
    if (!this.gh) return;
    if (this.suspend) this.suspend();
    else {
      const { debug, G } = this.gh;
      clearInputState(debug.input);
      if (G.state === "playing") {
        debug.input.onLockChange?.(false);
        if (G.state === "playing") { G.state = "paused"; debug.ctx.hud.show("pause"); }
      }
    }
  }
  bind(gh, suspend) {
    if (this.gh) return;
    this.gh = gh;
    this.suspend = suspend;
    const input = gh.debug.input, manager = this, lock = input.lock;
    installAimInput(gh, this);
    input.lock = function (...args) {
      if (manager.effective === "gamepad") return manager.activate();
      return lock.apply(this, args);
    };
    this.gamepad = new GamepadControls({ manager: this, gh, getPads: this.getPads,
      menu: action => navigateGamepadMenu(gh, action, this.doc), doc: this.doc });
    const loop = time => {
      this.gamepad.poll(time);
      this.frame = this.win.requestAnimationFrame(loop);
    };
    this.frame = this.win?.requestAnimationFrame(loop);
    for (const type of ["blur", "pagehide"]) this.win?.addEventListener(type, () => this.gamepad.suspend(), { signal: this.events.signal });
    this.doc?.addEventListener("visibilitychange", () => { if (this.doc.hidden) this.gamepad.suspend(); }, { signal: this.events.signal });
  }
  activate() {
    if (this.effective !== "gamepad" || !this.gh || this.doc?.hidden) return false;
    if (!this.gamepad?.connected) { this.pause(); return false; }
    this.gamepad.reset();
    const input = this.gh.debug.input;
    input.touchActive = true;
    input.enabled = true;
    input.allowLock = false;
    input.onLockChange?.(true);
    return true;
  }
  status(value) {
    if (value === this.padStatus) return;
    this.padStatus = value;
    this.dispatchEvent(new Event("change"));
  }
  dispose() {
    this.events.abort();
    if (this.frame !== undefined) this.win?.cancelAnimationFrame(this.frame);
    this.gamepad?.reset();
  }
}

if (typeof window !== "undefined") {
  let storage;
  try { storage = localStorage; } catch {}
  const handheld = startupPolicy({ coarse: matchMedia("(pointer: coarse)").matches,
    mobile: navigator.userAgentData?.mobile, userAgent: navigator.userAgent,
    platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }).mobile;
  globalThis.GHInput = new InputDevices({ storage, handheld, win: window, doc: document });
}
