export const LAYOUT_KEY = "gh-touch-layout-v1";
export const CONTROL_DEFS = [
  ["stick", "移动摇杆", 112], ["fire", "开火", 64], ["aim", "瞄准", 48],
  ["jump", "跳跃", 48], ["crouch", "蹲下", 48], ["reload", "换弹", 48],
  ["swap", "切枪", 48], ["sprint", "冲刺", 44], ["grenade", "手雷", 44],
  ["melee", "近战", 44], ["upgrade", "军犬", 44], ["dive", "飞扑", 44],
  ["score", "战绩", 44], ["pause", "暂停", 44], ["inspect", "检视", 44],
  ["fullscreen", "全屏", 44],
];
const finite = (value, fallback, min, max) => Number.isFinite(value)
  ? Math.max(min, Math.min(max, value)) : fallback;

export function defaultLayout(width = 844, height = 390) {
  width = Math.max(320, width);
  height = Math.max(240, height);
  const centers = {
    stick: [90, height - 80], fire: [width - 100, height - 136],
    aim: [width - 36, height - 144], jump: [width - 36, height - 90],
    crouch: [width - 36, height - 36], reload: [width - 92, height - 72],
    swap: [width - 148, height - 36], sprint: [50, height - 174],
    grenade: [width - 202, height - 34], melee: [width - 202, height - 86],
    upgrade: [width - 202, height - 138], dive: [width - 202, height - 190],
    score: [width - 184, 30], pause: [width - 134, 30],
    inspect: [width - 84, 30], fullscreen: [width - 34, 30],
  };
  return {
    version: 1, sensitivity: 1, fireLook: true,
    controls: Object.fromEntries(CONTROL_DEFS.map(([id, , size]) => [id, {
      x: centers[id][0] / width, y: centers[id][1] / height, size, opacity: 0.7,
    }])),
  };
}

export function normalizeLayout(value, width, height) {
  const layout = defaultLayout(width, height);
  if (!value || value.version !== 1) return layout;
  layout.sensitivity = finite(value.sensitivity, 1, 0.25, 3);
  layout.fireLook = typeof value.fireLook === "boolean" ? value.fireLook : true;
  for (const [id, , size] of CONTROL_DEFS) {
    const item = value.controls?.[id];
    if (!item || typeof item !== "object") continue;
    layout.controls[id] = {
      x: finite(item.x, layout.controls[id].x, 0, 1),
      y: finite(item.y, layout.controls[id].y, 0, 1),
      size: finite(item.size, size, id === "stick" ? 80 : 44, id === "stick" ? 180 : 120),
      opacity: finite(item.opacity, 0.7, 0.25, 1),
    };
  }
  return layout;
}

// Normalized centers survive rotation and different screen sizes. Clamp the
// entire hit box to the safe viewport, including oversized restored controls.
export function controlRect(control, width, height) {
  const size = Math.min(control.size, width, height);
  return {
    left: Math.max(0, Math.min(width - size, control.x * width - size / 2)),
    top: Math.max(0, Math.min(height - size, control.y * height - size / 2)), size,
  };
}

export function overlappingControls(layout, selected, width, height) {
  const a = controlRect(layout.controls[selected], width, height);
  return CONTROL_DEFS.filter(([id]) => {
    if (id === selected) return false;
    const b = controlRect(layout.controls[id], width, height);
    return a.left < b.left + b.size && b.left < a.left + a.size
      && a.top < b.top + b.size && b.top < a.top + a.size;
  }).map(([, label]) => label);
}

export function readLayout(storage, width, height) {
  try { return normalizeLayout(JSON.parse(storage?.getItem(LAYOUT_KEY)), width, height); }
  catch { return defaultLayout(width, height); }
}

export function saveLayout(storage, layout) {
  try {
    if (!storage) return false;
    storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    return true;
  } catch { return false; }
}

// Ownership is decided at touchdown, never transferred when crossing mid-screen.
// One finger owns free-look; the fire pointer can shoot at the same time without
// applying a second set of camera deltas.
export function canStartLook(x, bounds, hasLookOwner = false) {
  return !hasLookOwner && x >= bounds.left + bounds.width / 2 && x <= bounds.left + bounds.width;
}

export function touchLookDelta(dx, dy, sensitivity, ads = false, out = {}) {
  // Touch distance is in CSS pixels, independent of DPR and render resolution.
  // 3.4x base gain gives a crisp ~70 deg turn per natural 160px thumb swipe;
  // ADS keeps a light 15% trim because the engine already scales by adsSens & FOV.
  const aim = typeof ads === "number" ? finite(ads, 0, 0, 1) : Number(ads);
  const scale = finite(sensitivity, 1, 0.25, 3) * 3.4 * (1 - 0.15 * aim);
  out.x = dx * scale;
  out.y = dy * scale;
  return out;
}
