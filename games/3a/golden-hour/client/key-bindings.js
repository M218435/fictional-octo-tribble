// Physical keyboard/mouse bindings translate to the prototype's stable input
// codes. Touch and gamepad already write those codes on their own channel.
export const KEY_BINDINGS_KEY = "gh-key-bindings-v1";
export const MAX_BINDINGS = 4;
export const KEY_ACTIONS = [
  { id: "forward", label: "向前移动", group: "移动", code: "KeyW", defaults: ["KeyW", "ArrowUp"] },
  { id: "back", label: "向后移动", group: "移动", code: "KeyS", defaults: ["KeyS", "ArrowDown"] },
  { id: "left", label: "向左移动", group: "移动", code: "KeyA", defaults: ["KeyA", "ArrowLeft"] },
  { id: "right", label: "向右移动", group: "移动", code: "KeyD", defaults: ["KeyD", "ArrowRight"] },
  { id: "sprint", label: "冲刺", group: "移动", code: "ShiftLeft", defaults: ["ShiftLeft", "ShiftRight"] },
  { id: "jump", label: "跳跃／翻越", group: "移动", code: "Space", defaults: ["Space"] },
  { id: "crouch", label: "蹲下／滑铲", group: "移动", code: "KeyC", defaults: ["KeyC", "ControlLeft", "ControlRight"] },
  { id: "dive", label: "趴下／飞扑", group: "移动", code: "KeyX", defaults: ["KeyX", "KeyZ"], training: true },
  { id: "fire", label: "开火", group: "战斗", code: "Mouse0", defaults: ["Mouse0"] },
  { id: "ads", label: "瞄准", group: "战斗", code: "Mouse1", defaults: ["Mouse2", "Mouse1"] },
  { id: "reload", label: "换弹", group: "战斗", code: "KeyR", defaults: ["KeyR"] },
  { id: "melee", label: "近战", group: "战斗", code: "KeyV", defaults: ["KeyV", "KeyF", "Mouse3", "Mouse4"] },
  { id: "grenade", label: "投掷手雷", group: "战斗", code: "KeyG", defaults: ["KeyG", "KeyQ"], training: true },
  { id: "primary", label: "主武器", group: "武器与战绩", code: "Digit1", defaults: ["Digit1"] },
  { id: "secondary", label: "副武器", group: "武器与战绩", code: "Digit2", defaults: ["Digit2"] },
  { id: "swap", label: "切换武器", group: "武器与战绩", code: "KeyE", defaults: ["KeyE", "WheelUp", "WheelDown"] },
  { id: "inspect", label: "检视武器", group: "武器与战绩", code: "KeyT", defaults: ["KeyT"] },
  { id: "score", label: "按住查看战绩", group: "武器与战绩", code: "Tab", defaults: ["Tab"] },
  { id: "k9", label: "呼叫 K9", group: "武器与战绩", code: "KeyB", defaults: ["KeyB", "Digit3"], training: true },
];
const actions = new Map(KEY_ACTIONS.map(action => [action.id, action]));
export function validBinding(code) {
  return typeof code === "string" && /^(Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal)|Arrow(?:Up|Down|Left|Right)|Shift(?:Left|Right)|Control(?:Left|Right)|Space|Tab|Enter|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Insert|Home|End|PageUp|PageDown|F(?:[1-4]|[7-9])|Mouse[0-4]|Wheel(?:Up|Down))$/.test(code);
}
export function bindingLabel(code) {
  if (!code) return "未绑定";
  const names = { Space: "空格", ShiftLeft: "左 Shift", ShiftRight: "右 Shift", ControlLeft: "左 Ctrl", ControlRight: "右 Ctrl",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Mouse0: "鼠标左键", Mouse1: "鼠标中键", Mouse2: "鼠标右键",
    Mouse3: "鼠标侧键 1", Mouse4: "鼠标侧键 2", WheelUp: "滚轮上", WheelDown: "滚轮下", Backquote: "\u0060", Minus: "−", Equal: "=",
    BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", CapsLock: "Caps Lock",
    PageUp: "Page Up", PageDown: "Page Down" };
  return names[code] || code.replace(/^Key|^Digit/, "").replace(/^Numpad/, "小键盘 ");
}
export function normalizeBindings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
  const result = {}, used = new Set();
  // Explicit saved bindings take priority over defaults added by a future version.
  for (const custom of [true, false]) for (const action of KEY_ACTIONS) {
    const explicit = Object.hasOwn(value, action.id) && Array.isArray(value[action.id]);
    if (custom !== explicit) continue;
    result[action.id] = [];
    for (const code of explicit ? value[action.id] : action.defaults) {
      if (!validBinding(code) || used.has(code) || result[action.id].length >= MAX_BINDINGS) continue;
      used.add(code);
      result[action.id].push(code);
    }
  }
  return result;
}

export class KeyBindings extends EventTarget {
  constructor({ storage } = {}) {
    super();
    this.storage = storage;
    let saved;
    try { saved = JSON.parse(storage?.getItem(KEY_BINDINGS_KEY) || "null"); } catch {}
    this.bindings = normalizeBindings(saved?.version === 1 ? saved.bindings : {});
    this.reindex();
  }
  reindex() {
    this.byCode = new Map();
    for (const action of KEY_ACTIONS) for (const code of this.bindings[action.id]) this.byCode.set(code, action);
  }
  label(id) { return bindingLabel(this.bindings[id]?.[0]); }
  assign(id, slot, code, { replace = false } = {}) {
    if (!actions.has(id) || !Number.isInteger(slot) || slot < 0 || slot >= MAX_BINDINGS || (code !== null && !validBinding(code))) return { error: "invalid" };
    const conflict = code && this.byCode.get(code);
    if (conflict && conflict.id !== id && !replace) return { conflict };
    if (conflict && conflict.id !== id) this.bindings[conflict.id] = this.bindings[conflict.id].filter(key => key !== code);
    const list = this.bindings[id], previous = list[slot], same = code ? list.indexOf(code) : -1;
    if (same >= 0 && same !== slot) {
      list[same] = previous;
    }
    list[slot] = code;
    this.bindings[id] = list.filter(Boolean);
    return this.save();
  }
  reset(id) {
    if (!id) this.bindings = normalizeBindings();
    else {
      const action = actions.get(id);
      if (!action) return { error: "invalid" };
      // Resetting a single row must not silently take a key from another action.
      this.bindings[id] = action.defaults.filter(code => !this.byCode.has(code) || this.byCode.get(code).id === id);
    }
    return this.save();
  }
  save() {
    this.reindex();
    let saved = true;
    try { if (!this.storage) throw Error(); this.storage.setItem(KEY_BINDINGS_KEY, JSON.stringify({ version: 1, bindings: this.bindings })); } catch { saved = false; }
    this.dispatchEvent(new Event("change"));
    return { saved };
  }
}

export class BoundInput {
  constructor(input, bindings) {
    this.input = input;
    this.bindings = bindings;
    this.held = new Map();
    this.pulses = new Set();
  }
  press(code) {
    if (this.held.has(code)) return;
    const canonical = this.bindings.byCode.get(code)?.code;
    if (!canonical) return;
    this.held.set(code, canonical);
    if (!this.input.keys.has(canonical)) {
      this.input.keys.add(canonical);
      this.input.down.add(canonical);
      this.input.aim?.press(canonical);
    }
  }
  release(code) {
    const canonical = this.held.get(code);
    if (!canonical) return;
    this.held.delete(code);
    if (![...this.held.values()].includes(canonical)) {
      this.input.keys.delete(canonical);
      this.input.up.add(canonical);
    }
  }
  pulse(code) {
    this.press(code);
    this.pulses.add(code);
  }
  endFrame() { for (const code of this.pulses) this.release(code); this.pulses.clear(); }
  reset() { this.held.clear(); this.pulses.clear(); }
  releaseMouse() { for (const code of this.held.keys()) if (code.startsWith("Mouse")) this.release(code); }
}
