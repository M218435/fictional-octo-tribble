// One context and one bounded selection sequence per canvas. Three owns its GL
// state restoration; this module owns game resources and local input suspension.
const contexts = new WeakMap();
const recoveries = new WeakMap();
const LIMIT = 240;
const text = (value) => String(value ?? "").slice(0, LIMIT);
const softwareRenderer = /swiftshader|llvmpipe|softpipe|lavapipe|software|swrast|microsoft basic render|\bWARP\b|GDI Generic/i;
const hardwareRenderer = /nvidia|geforce|quadro|radeon|\bAMD\b|\bATI\b|intel|apple|adreno|mali|powervr|qualcomm|samsung/i;

function describe(record) {
  const gl = record.context;
  record.renderer = null;
  record.software = null;
  record.powerPreference = null;
  if (!gl || gl.isContextLost()) return;
  try {
    record.powerPreference = gl.getContextAttributes()?.powerPreference ?? null;
  } catch {
    // Browsers can revoke the context between the loss check and disclosure.
  }
  // Privacy policies may withhold the unmasked renderer. A generic vendor name
  // is not evidence of GPU acceleration, even when a strict strategy succeeded.
  try {
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    const unmasked = extension && gl.getParameter(extension.UNMASKED_RENDERER_WEBGL);
    const renderer = unmasked || gl.getParameter(gl.RENDERER);
    record.renderer = renderer ? text(renderer) : null;
    if (softwareRenderer.test(renderer ?? "")) record.software = true;
    else if (unmasked && hardwareRenderer.test(unmasked))
      record.software = false;
  } catch {
    // Renderer disclosure is optional and never gates starting the game.
  }
}

function observe(canvas) {
  const record = {
    context: null, status: "failed", strategy: null, powerPreference: null,
    renderer: null, software: null, attempts: [], lossCount: 0,
    restoreCount: 0, startupLoss: false, error: null, currentAttempt: null,
  };
  contexts.set(canvas, record);
  canvas.addEventListener("webglcontextcreationerror", (event) => {
    if (record.currentAttempt) record.currentAttempt.reason = text(event.statusMessage || "Context creation rejected");
  });
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    record.status = "lost";
    record.lossCount++;
    record.startupLoss ||= !recoveries.has(canvas);
    record.error = text(event.statusMessage || "WebGL context lost; waiting for browser restoration");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    record.status = "restored";
    record.restoreCount++;
    record.error = null;
    describe(record);
  });
  return record;
}

export function createWebGLContext(canvas, type, attributes = {}) {
  const previous = contexts.get(canvas);
  // Three makes an extra getContext call to diagnose total failure. Do not run
  // the strategies again, nor allocate another renderer on a successful canvas.
  if (previous) return type === "webgl2" ? previous.context : null;
  const record = observe(canvas);
  if (type !== "webgl2") {
    record.error = "This renderer requires WebGL 2; WebGL 1 is not a fallback";
    return null;
  }
  const strategies = [
    ["high-performance-hardware", "high-performance", true],
    ["default-hardware", "default", true],
    ["compatible", "default", false],
  ];
  for (const [strategy, powerPreference, failIfMajorPerformanceCaveat] of strategies) {
    const attempt = { strategy, powerPreference, failIfMajorPerformanceCaveat, outcome: "rejected", reason: null };
    record.attempts.push(attempt);
    record.currentAttempt = attempt;
    try {
      const gl = canvas.getContext(type, { ...attributes, powerPreference, failIfMajorPerformanceCaveat });
      if (gl) {
        record.context = gl;
        record.strategy = strategy;
        attempt.outcome = "selected";
        if (gl.isContextLost()) {
          record.status = "lost";
          record.startupLoss = true;
          record.error = "WebGL context was lost during creation";
        } else {
          record.status = "ready";
          record.error = null;
          describe(record);
        }
        return gl;
      }
      attempt.reason ||= "getContext returned null";
    } catch (error) {
      attempt.outcome = "exception";
      attempt.reason = text(error?.message || error);
    } finally {
      record.currentAttempt = null;
    }
  }
  record.error = "WebGL 2 creation failed for hardware-preferred and software-compatible strategies";
  return null;
}

export function contextDiagnostics(canvas) {
  const record = contexts.get(canvas);
  if (!record) return null;
  const { status, strategy, powerPreference, renderer, software, lossCount, restoreCount, startupLoss, error } = record;
  return { status, strategy, powerPreference, renderer, software, lossCount, restoreCount, startupLoss, error,
    attempts: record.attempts.map((attempt) => ({ ...attempt })) };
}

function resetShadows(scene) {
  scene.traverse((object) => {
    if (!object.shadow) return;
    for (const key of ["map", "mapPass"]) {
      object.shadow[key]?.dispose();
      object.shadow[key] = null;
    }
    object.shadow.needsUpdate = true;
  });
}

export function installWebGLRecovery(gh, suspend) {
  const gfx = gh.debug.gfx;
  const canvas = gfx.renderer.domElement;
  if (recoveries.has(canvas)) return recoveries.get(canvas);
  const record = contexts.get(canvas);
  if (!record?.context) throw Error("WebGL recovery requires the shared context factory");
  const render = gfx.render;
  const callbacks = gh.debug.ctx.hud.menus.cb;
  const resume = callbacks.onResume;
  let revision = 0;
  const resumeNote = gh.debug.ctx.hud.menus.pages?.pause?.querySelector('[data-act="resume"] em');
  const originalResumeNote = resumeNote?.textContent;
  let disposed = false;
  let restoring = false;
  const available = () => record.status === "ready" || record.status === "restored";
  const explain = () => {
    if (!resumeNote) return;
    resumeNote.textContent = available() ? originalResumeNote
      : record.status === "failed" ? "显卡资源恢复失败，请刷新页面重试"
      : "正在恢复显卡画面，请稍候再继续";
  };
  const guardedRender = function (dt) {
    if (available()) return render.call(gfx, dt);
    if (gh.G.state === "playing") suspend("webgl-unavailable");
  };
  const guardedResume = function (...args) {
    if (!available()) {
      explain();
      return suspend("webgl-unavailable");
    }
    return resume.apply(this, args);
  };
  gfx.render = guardedRender;
  callbacks.onResume = guardedResume;
  const lost = () => {
    revision++;
    suspend("webgl-context-lost");
    explain();
  };
  const restoreResources = async () => {
    restoring = true;
    let generation;
    do {
      generation = revision;
      try {
        // Yield until every listener, including Three's internal L0 rebuild,
        // completes. A second loss coalesces into one subsequent rebuild.
        await Promise.resolve();
        if (disposed || record.context.isContextLost()) break;
        if (generation !== revision) continue;
        gfx.renderer.setRenderTarget(null);
        resetShadows(gfx.scene);
        resetShadows(gfx.vmScene);
        const atlas = gfx.fx?.atlas;
        if (atlas) {
          atlas.rt.dispose();
          atlas.ready = false;
        }
        gfx._build();
        gfx.resize();
        gfx._shadowAt = 0;
        gfx._reflectAt = 0;
        gfx.renderer.shadowMap.needsUpdate = true;
        gfx.snapExposure();
        // These captures contain GPU-produced pixels, not CPU images Three
        // can re-upload. The prototype patch reuses its real capture routine.
        await gfx.restoreEnvironment();
        if (disposed || record.context.isContextLost()) break;
        if (generation !== revision) continue;
        suspend("webgl-context-restored");
        render.call(gfx, 0);
        record.status = "restored";
        record.error = null;
        describe(record);
        explain();
      } catch (error) {
        if (disposed) break;
        if (generation !== revision) continue;
        record.status = "failed";
        record.error = text(error?.message || error);
        suspend("webgl-recovery-failed");
        console.error("WebGL resource restoration failed:", error);
        explain();
      }
    } while (!disposed && generation !== revision && record.status === "restoring");
    restoring = false;
  };
  const restored = () => {
    ++revision;
    record.status = "restoring";
    suspend("webgl-context-restoring");
    explain();
    if (!restoring) void restoreResources();
  };
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  const recovery = {
    dispose() {
      disposed = true;
      revision++;
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      if (gfx.render === guardedRender) gfx.render = render;
      if (callbacks.onResume === guardedResume) callbacks.onResume = resume;
      recoveries.delete(canvas);
      if (resumeNote) resumeNote.textContent = originalResumeNote;
    },
  };
  recoveries.set(canvas, recovery);
  if (record.context.isContextLost()) lost();
  else if (record.startupLoss) restored();
  return recovery;
}
