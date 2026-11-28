import { AdaptiveQuality } from "./performance-policy.js";
import { contextDiagnostics } from "./webgl-context.js";

// Local diagnostics only: no uploads, no extra RAF loop and bounded storage.
const report = document.createElement("output");
report.id = "gh-performance";
report.hidden = true;
document.body.append(report);
async function install() {
  while (!window.GH?.ready) await new Promise((r) => setTimeout(r, 100));
  const { GH } = window;
  const d = GH.debug,
    gfx = d.gfx,
    renderer = gfx.renderer;
  const gl = renderer.getContext();
  const webglVersion = gl.getParameter(gl.VERSION);
  const startup = document.createElement("output");
  startup.id = "gh-startup";
  startup.hidden = true;
  const startupState = {
    readyMs: Math.round(performance.now()),
    stages: d.boot,
    armouryMs: d.ctx.hud.studio?.bakeMs,
    swatchesMs: d.ctx.hud.warmMs,
    cache: globalThis.GHBoot?.stats,
    transferredBytes: performance
      .getEntriesByType("resource")
      .reduce((sum, item) => sum + item.transferSize, 0),
  };
  startup.textContent = JSON.stringify(startupState);
  document.body.append(startup);
  let device = contextDiagnostics(renderer.domElement);
  let gpu = device.renderer || "浏览器未公开显卡型号";
  let software = device.software;
  const policy = new AdaptiveQuality(performance.now());
  const samples = new Float32Array(600);
  let used = 0,
    index = 0,
    last = 0,
    lastMode = "",
    renderMs = 0;
  function reset() {
    used = index = 0;
    last = 0;
  }
  const originalQuality = gfx.setQuality.bind(gfx);
  const originalScale = gfx.setRenderScale.bind(gfx);
  function apply({ quality, scale }) {
    if (quality !== undefined) {
      if (quality !== gfx.quality) originalQuality(quality);
    } else if (scale !== undefined) {
      originalScale(scale);
    }
    reset();
  }
  const weakGpuRe = /intel|uhd|iris|hd graphics|vega\s*[368]\b|radeon\(tm\)\s*graphics|adreno\s*\(tm\)\s*[3456]|mali-g[567]|powervr|swiftshader|llvmpipe|basic render/i;
  gfx.setQuality = (value) => {
    const thin =
      software ||
      globalThis.GHBoot?.policy.mobile ||
      weakGpuRe.test(gpu) ||
      navigator.hardwareConcurrency <= 4 ||
      navigator.deviceMemory <= 4;
    const target = value === "auto" ? (thin ? "low" : "medium") : value;
    apply({ quality: target });
    policy.reset(performance.now());
  };
  gfx.setRenderScale = (value) => {
    originalScale(value);
    reset();
    policy.reset(performance.now());
  };
  // An old desktop/high preset must not rebuild large targets just after the
  // bounded mobile boot. Explicit graphics changes during this visit still work.
  if (globalThis.GHBoot?.policy.mobile) d.ctx.settings.quality = "auto";
  gfx.setQuality(d.ctx.settings.quality);

  const render = gfx.render;
  gfx.render = function (dt) {
    if (gl.isContextLost()) {
      renderMs = 0;
      reset();
      return;
    }
    const now = performance.now(),
      mode = GH.G.state;
    if (mode !== lastMode || document.hidden) {
      reset();
      lastMode = mode;
    }
    if (last && !document.hidden) {
      samples[index++ % samples.length] = now - last;
      used = Math.min(used + 1, samples.length);
    }
    last = now;
    const start = performance.now();
    render.call(this, dt);
    renderMs = performance.now() - start;
  };

  // Minimap DOM/layout work does not need to run at the aiming frame rate.
  const map = d.ctx.hud.map,
    updateMap = map.update;
  let mapTime = 0;
  map.update = function (dt, ...args) {
    mapTime += dt;
    if (mapTime < 0.1) return;
    updateMap.call(this, mapTime, ...args);
    mapTime = 0;
  };
  // Keep physics cadence coupled to per-frame pushFrom calls (never skip frames
  // while pushFrom stacks impulses), clamping only large frame hitches.
  const physics = d.physics,
    updatePhysics = physics.update;
  physics.update = function (dt) {
    updatePhysics.call(this, Math.min(dt, 1 / 30));
  };
  setInterval(() => {
    device = contextDiagnostics(renderer.domElement);
    gpu = device.renderer || "浏览器未公开显卡型号";
    software = device.software;
    startup.textContent = JSON.stringify(startupState);
    const values = Array.from(samples.subarray(0, used)).sort((a, b) => a - b);
    const mean = used ? values.reduce((a, b) => a + b, 0) / used : 0;
    const p95 = values[Math.floor(values.length * 0.95)] || 0;
    const state = {
      fps: mean ? Math.round(1000 / mean) : 0,
      frameMs: +mean.toFixed(2),
      p95Ms: +p95.toFixed(2),
      samples: used,
      renderSubmitMs: +renderMs.toFixed(2),
      gpu,
      software,
      context: device,
      webgl: webglVersion,
      automatic: d.ctx.settings.quality === "auto",
      quality: gfx.quality,
      scale: gfx.q.scale,
      motionBlur: gfx.motionBlur,
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length || 0,
      heapBytes: performance.memory?.usedJSHeapSize,
      physicsBodies: physics.bodies.length,
      actors: d.ctx.match.actors.length,
      mode: GH.G.state,
      network: d.network,
    };
    report.textContent = JSON.stringify(state);
    globalThis.GHDiagnostics?.sample({ ...state, contextLosses: device.lossCount,
      queuedCommands: d.network?.queuedCommands || 0, inputDropped: d.network?.inputDropped || 0 });
    const panel = d.ctx.hud.menus.pages.settings.querySelector(
      '.st-panel[data-tab="graphics"] .st-side',
    );
    if (panel && d.ctx.hud.menus.page === "settings") {
      let status = panel.querySelector(".gh-device");
      if (!status) {
        status = document.createElement("p");
        status.className = "gh-device";
        panel.append(status);
      }
      if (globalThis.GHDiagnostics && !panel.querySelector(".gh-copy-diagnostics")) {
        const copy = document.createElement("button");
        copy.className = "btn gh-copy-diagnostics";
        copy.textContent = "复制故障诊断";
        copy.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(JSON.stringify(globalThis.GHDiagnostics.report(), null, 2));
            copy.textContent = "已复制诊断，可随问题反馈";
          } catch { copy.textContent = "复制失败，请允许剪贴板访问后重试"; }
        });
        panel.append(copy);
      }
      const acceleration = software === true ? "软件渲染" : software === false ? "显卡加速" : "渲染器类型未公开";
      const contextState = device.status === "failed" ? " · 显卡资源恢复失败"
        : device.status === "lost" || device.status === "restoring" ? " · 显卡上下文恢复中"
        : device.restoreCount ? " · 显卡上下文已恢复" : "";
      status.textContent = `${acceleration}${contextState} · ${state.fps} FPS · 特效 ${state.automatic ? "自动 / " : ""}${{ low: "低", medium: "中", high: "高", ultra: "极高" }[state.quality]} · 渲染分辨率 ${Math.round(state.scale * 100)}% · ${state.buffer.join(" × ")}\n${gpu}\nWebGL 策略：${device.strategy || "未公开"} · ${device.powerPreference || "浏览器默认"}\n本次加载 ${(startupState.readyMs / 1000).toFixed(1)} 秒${startupState.cache?.materials === "hit" ? " · 本地材质缓存" : ""}${startupState.cache?.armoury === "prebaked" ? " · 预生成武器图像" : ""}`;
      status.style.overflowWrap = "anywhere";
    }
    const next = policy.observe({
      now: performance.now(),
      automatic: state.automatic,
      playing: state.mode === "playing",
      hidden: document.hidden,
      count: used,
      mean,
      p95,
      quality: state.quality,
      scale: state.scale,
      mobile: Boolean(globalThis.GHBoot?.policy.mobile),
    });
    if (next) apply(next);
    reset();
  }, 2000);
}
install().catch((error) => console.error("Performance controller:", error));
