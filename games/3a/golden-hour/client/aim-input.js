const defaults = { keyboard: "hold", touch: "toggle", gamepad: "hold" };
const isAim = code => code === "Mouse1" || code === "Mouse2";

export function aimPreferences(value) {
  return Object.fromEntries(Object.entries(defaults).map(([device, mode]) => {
    const saved = value?.[device];
    return [device, {
      mode: saved?.mode === "hold" || saved?.mode === "toggle" ? saved.mode : mode,
      auto: saved?.auto === true,
    }];
  }));
}

export function installAimInput(gh, devices) {
  const { input, player, ctx } = gh.debug;
  const eligible = () => gh.G.state === "playing" && player.alive && ctx.match.state === "live";
  const selected = () => devices.preferences.aim[devices.effective];
  const held = code => input.keys.has(code) || input.touchKeys.has(code);
  let latched = false;
  const aim = input.aim = {
    press(code) {
      if (isAim(code) && eligible() && selected().mode === "toggle") latched = !latched;
    },
    requested() {
      if (!input.enabled || !eligible()) return false;
      const { mode, auto } = selected();
      if (mode === "toggle" ? latched : held("Mouse1") || held("Mouse2")) return true;
      // A quick trigger tap can be released before native weapon update.
      return auto && (held("Mouse0") || input.down.has("Mouse0") || input.touchDown.has("Mouse0"));
    },
    reset() { latched = false; },
    endFrame() { if (!eligible()) latched = false; },
  };
  // Native animation and offline movement use held(); online sends the same intent.
  const originalHeld = input.held;
  input.held = function (code) {
    return isAim(code) ? aim.requested() : originalHeld.call(this, code);
  };
}
