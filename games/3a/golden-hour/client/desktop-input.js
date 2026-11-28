import { KeyBindings, BoundInput } from "./key-bindings.js";

function editable(event) {
  return (event.composedPath?.() || [event.target]).some((target) =>
    target?.isContentEditable || target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"),
  );
}

function browserEscape(event) {
  return event.altKey || event.metaKey || event.code === "F11" || event.code === "F12" ||
    (event.ctrlKey && ["KeyW", "KeyT", "KeyN", "KeyL", "KeyR"].includes(event.code));
}

// Clear edges as well as holds: a down edge surviving a pause can fire on resume.
export function clearInputState(input) {
  input.boundInput?.reset();
  input.aim?.reset();
  for (const field of ["keys", "down", "up", "touchKeys", "touchDown", "touchUp"])
    input[field]?.clear();
  for (const field of ["mx", "my", "wheel", "touchForward", "touchRight", "touchMx", "touchMy"])
    input[field] = 0;
  input.touchActive = false;
}

export function installDesktopInput(gh, bindings = globalThis.GHInput?.keyBindings || new KeyBindings()) {
  const input = gh.debug.input;
  const canvas = input.el;
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const playing = () => gh.G.state === "playing";
  // The replay patch consults this before the prototype records keyboard state.
  input.acceptKeyboard = (event) => playing() && !editable(event) && !browserEscape(event);
  const bound = input.boundInput = new BoundInput(input, bindings);
  input.handleKeyboard = (event, down) => {
    if (!down) bound.release(event.code);
    else if (input.acceptKeyboard(event) && !event.repeat && !bindings.capturing) bound.press(event.code);
  };
  input.handleMouse = (event, down) => {
    const code = "Mouse" + event.button;
    if (!down) bound.release(code);
    else if (playing() && !bindings.capturing && !editable(event)) bound.press(code);
  };
  input.handleWheel = (event) => {
    if (playing() && !bindings.capturing && event.deltaY) bound.pulse(event.deltaY < 0 ? "WheelUp" : "WheelDown");
  };
  input.finishBindings = () => {
    bound.endFrame();
    input.aim?.endFrame();
  };
  const refreshHints = () => {
    const { hud, match } = gh.debug.ctx;
    if (hud.c) hud.c.cue = "";
    if (match.k9?.view) match.k9.view.key = bindings.label("k9");
    const key = doc.querySelector?.("#loadcard .lc-fu kbd");
    if (key) key.textContent = bindings.label("k9");
  };
  bindings.addEventListener("change", () => { clearInputState(input); refreshHints(); });
  refreshHints();
  let suspending = false;
  function suspend() {
    if (suspending) return;
    suspending = true;
    try {
      const wasPlaying = playing();
      globalThis.GHTouch?.deactivate();
      input.allowLock = false;
      input.lockAttempt = (input.lockAttempt || 0) + 1;
      clearInputState(input);
      input.enabled = false;
      if (wasPlaying) {
        input.onLockChange?.(false);
        // Native ?nolock mode deliberately ignores lock loss; it must still pause
        // on blur, Escape and renderer loss rather than silently resume firing.
        if (playing()) {
          gh.G.state = "paused";
          gh.G.pausedAt = performance.now();
          gh.debug.ctx.hud.show("pause");
          gh.debug.ctx.audio?.slideStop?.();
          gh.debug.ctx.match.k9?.pause();
        }
      }
      input.unlock();
      clearInputState(input);
    } finally {
      suspending = false;
    }
  }
  win.addEventListener("keydown", (event) => {
    if (!playing() || editable(event)) return;
    if (event.code === "Escape") {
      suspend();
      return; // Preserve the browser's pointer-lock/fullscreen escape.
    }
    if (!browserEscape(event) && bindings.byCode.has(event.code)) event.preventDefault();
  }, { capture: true });
  win.addEventListener("blur", suspend);
  win.addEventListener("pagehide", suspend);
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) suspend();
  });
  doc.addEventListener("pointerlockchange", () => {
    if (doc.pointerLockElement !== canvas && playing() && (input.locked || !input.touchActive)) suspend();
  }, { capture: true });
  for (const type of ["mousedown", "auxclick", "contextmenu", "dragstart", "selectstart", "wheel"])
    canvas.addEventListener(type, (event) => {
      if (playing()) event.preventDefault();
    }, { passive: false });
  canvas.style.userSelect = "none";
  canvas.style.touchAction = "none";
  return { suspend };
}
