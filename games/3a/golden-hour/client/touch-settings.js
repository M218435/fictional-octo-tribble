import { CONTROL_DEFS, defaultLayout, normalizeLayout, controlRect, overlappingControls } from "./touch-layout.js";

// Reuse the native settings panel and page controller, including Back/Escape.
export function installTouchSettings({ menus, controls }) {
  if (!controls) return;
  const settings = document.createElement("section");
  settings.className = "touch-settings";
  settings.innerHTML = `<h4>移动端触屏操作</h4>
    <p>左侧摇杆移动，右半屏空白处滑动转向。可按自己的握持方式安排按键。</p>
    <label class="touch-setting">转向灵敏度 <input aria-label="触屏转向灵敏度" type="range" min="0.25" max="3" step="0.05" data-touch-sensitivity><output></output></label>
    <label class="touch-setting"><input type="checkbox" data-touch-fire-look> 开火键支持拖动瞄准</label>
    <div class="touch-gyro-settings">
      <label class="touch-setting"><input type="checkbox" data-gyro-enabled aria-describedby="gyro-status"> 陀螺仪瞄准</label>
      <div data-gyro-options hidden>
        <label class="touch-setting">启用时机<select data-gyro-mode aria-label="陀螺仪启用时机">
          <option value="ads">仅开镜</option><option value="always">始终启用</option>
        </select></label>
        <label class="touch-setting">灵敏度<input type="range" min="0.25" max="3" step="0.05" data-gyro-sensitivity aria-label="陀螺仪灵敏度"><output></output></label>
      </div>
      <p id="gyro-status" role="status"></p>
    </div>
    <button class="btn" data-nav data-touch-edit>自定义摇杆与按键布局 ›</button>
    <p class="touch-settings-status" role="status">布局保存在当前浏览器，单人与联机共用。</p>`;
  menus.pages.settings.querySelector('.st-panel[data-tab="controls"]').append(settings);
  const gyro = controls.gyro;
  const gyroEnabled = settings.querySelector("[data-gyro-enabled]");
  const gyroMode = settings.querySelector("[data-gyro-mode]");
  const gyroSensitivity = settings.querySelector("[data-gyro-sensitivity]");
  const gyroMessages = {
    idle: "横屏时转动手机微调视角，可同时拖动屏幕瞄准。",
    requesting: "正在等待浏览器的动作传感器授权…",
    checking: "正在检测传感器，可轻轻转动手机。",
    ready: "已检测到传感器。单人训练和联机均可使用。",
    denied: "浏览器未授予动作传感器权限，可继续拖动瞄准。",
    https: "动作传感器需要 HTTPS 页面，可继续拖动瞄准。",
    blocked: "当前内嵌页限制访问传感器，可在浏览器中打开游戏，或继续拖动瞄准。",
    unsupported: "当前浏览器不支持动作传感器，可继续拖动瞄准。",
    "no-data": "未收到动作数据。可关闭后重新开启，或用浏览器直接打开游戏。",
  };
  function renderGyro() {
    const { enabled, mode, sensitivity } = gyro.preferences;
    gyroEnabled.checked = enabled && !gyro.unavailable;
    gyroEnabled.disabled = !!gyro.unavailable || gyro.status === "requesting";
    settings.querySelector("[data-gyro-options]").hidden = !gyroEnabled.checked;
    settings.querySelector("#gyro-status").textContent = gyroMessages[gyro.status];
    gyroMode.value = mode;
    gyroSensitivity.value = sensitivity;
    gyroSensitivity.nextElementSibling.value = sensitivity.toFixed(2) + "×";
  }
  gyroEnabled.addEventListener("change", () => {
    if (gyroEnabled.checked) void gyro.enable();
    else gyro.disable();
  });
  gyroMode.addEventListener("change", () => gyro.save({ mode: gyroMode.value }));
  gyroSensitivity.addEventListener("input", () => gyro.save({ sensitivity: Number(gyroSensitivity.value) }));
  gyro.addEventListener("change", renderGyro);
  renderGyro();
  const page = menus._page("touch-layout", `
    <div class="touch-layout-screen" aria-label="全屏 1:1 触屏键位编辑器">
      <span class="touch-layout-zone">右半屏 · 滑动转向</span>
      <span class="touch-layout-cross" aria-hidden="true">＋</span>
    </div>
    <aside class="touch-layout-panel" data-dock="top" data-collapsed="true" aria-label="键位编辑工具栏">
      <div class="touch-layout-bar">
        <button class="btn touch-bar-btn" type="button" data-nav data-touch-cancel>‹ 返回</button>
        <select aria-label="选中控件" class="touch-bar-select" data-touch-select>${CONTROL_DEFS.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select>
        <button class="btn touch-bar-btn" type="button" data-touch-toggle-panel aria-expanded="false">属性 ▾</button>
        <button class="btn touch-bar-btn" type="button" data-touch-dock title="切换工具栏位置">移到底部</button>
        <button class="btn touch-bar-btn" type="button" data-nav data-touch-reset>重置</button>
        <button class="btn primary touch-bar-btn" type="button" data-nav data-touch-save>保存</button>
      </div>
      <section class="touch-layout-options" hidden>
        <p class="touch-layout-hint">全屏 1:1 实机比例：直接拖动摇杆或按键到舒适位置，可点上方按钮切换工具栏上下位置。</p>
        <div class="touch-layout-sliders">
          <label class="touch-setting">大小<input aria-label="控件大小" type="range" min="44" max="120" step="2" data-touch-prop="size"><output></output></label>
          <label class="touch-setting">透明度<input aria-label="控件透明度" type="range" min="0.25" max="1" step="0.05" data-touch-prop="opacity"><output></output></label>
          <label class="touch-setting">水平<input aria-label="控件水平位置" type="range" min="0" max="1" step="0.01" data-touch-prop="x"><output></output></label>
          <label class="touch-setting">垂直<input aria-label="控件垂直位置" type="range" min="0" max="1" step="0.01" data-touch-prop="y"><output></output></label>
        </div>
        <p class="touch-layout-status" role="status">全屏 1:1 预览包含全部按键，联机中仅显示已支持的动作。</p>
      </section>
    </aside>`);
  const screen = page.querySelector(".touch-layout-screen");
  const panel = page.querySelector(".touch-layout-panel");
  const optionsPanel = page.querySelector(".touch-layout-options");
  const toggleBtn = page.querySelector("[data-touch-toggle-panel]");
  const dockBtn = page.querySelector("[data-touch-dock]");
  const select = page.querySelector("[data-touch-select]");
  const keys = new Map();
  let draft, selected = "stick", drag;
  const setPanelExpanded = expanded => {
    panel.dataset.collapsed = expanded ? "false" : "true";
    optionsPanel.hidden = !expanded;
    toggleBtn.setAttribute("aria-expanded", String(expanded));
    toggleBtn.textContent = expanded ? "收起 ▴" : "属性 ▾";
  };
  const setPanelDock = dock => {
    panel.dataset.dock = dock;
    dockBtn.textContent = dock === "top" ? "移到底部" : "移到顶部";
  };
  const previewViewport = () => {
    const { width, height } = controls.viewport();
    return { width: Math.max(1, width), height: Math.max(1, height) };
  };
  for (const [id, label] of CONTROL_DEFS) {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "touch-layout-key";
    key.dataset.control = id;
    key.dataset.label = label;
    key.textContent = label;
    key.setAttribute("aria-label", `调整${label}位置`);
    key.setAttribute("aria-pressed", "false");
    screen.append(key);
    keys.set(id, key);
  }
  function syncSettings() {
    const layout = controls.layout;
    settings.querySelector("[data-touch-sensitivity]").value = layout.sensitivity;
    settings.querySelector("output").value = layout.sensitivity.toFixed(2) + "×";
    settings.querySelector("[data-touch-fire-look]").checked = layout.fireLook;
  }
  function render() {
    if (!draft) return;
    const rectScreen = screen.getBoundingClientRect();
    const viewport = previewViewport();
    const w = rectScreen.width > 0 ? rectScreen.width : viewport.width;
    const h = rectScreen.height > 0 ? rectScreen.height : viewport.height;
    for (const [id, key] of keys) {
      const item = draft.controls[id], rect = controlRect(item, w, h);
      key.style.left = `${rect.left}px`;
      key.style.top = `${rect.top}px`;
      key.style.width = key.style.height = `${rect.size}px`;
      key.textContent = rect.size < 40 ? Array.from(key.dataset.label).slice(0, 2).join("") : key.dataset.label;
      key.style.fontSize = `${Math.max(11, Math.min(15, rect.size * 0.23))}px`;
      key.style.setProperty("--control-opacity", item.opacity);
      key.setAttribute("aria-pressed", String(id === selected));
    }
    select.value = selected;
    const overlaps = overlappingControls(draft, selected, w, h);
    page.querySelector(".touch-layout-status").textContent = overlaps.length
      ? `当前控件与${overlaps.join("、")}重叠，可能误触；可继续拖动调整。`
      : "全屏 1:1 预览包含全部按键，联机中仅显示已支持的动作。";
    for (const input of page.querySelectorAll("[data-touch-prop]")) {
      const prop = input.dataset.touchProp, value = draft.controls[selected][prop];
      if (prop === "size") { input.min = selected === "stick" ? 80 : 44; input.max = selected === "stick" ? 180 : 120; }
      input.value = value;
      input.nextElementSibling.value = prop === "size" ? `${Math.round(value)}px` : `${Math.round(value * 100)}%`;
    }
  }
  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const previous = drag;
    drag = null;
    if (previous.element.hasPointerCapture(previous.id)) previous.element.releasePointerCapture(previous.id);
  }
  function open() {
    controls.suspend();
    void controls.tryAutoLandscape?.({ interactive: false });
    draft = normalizeLayout(controls.layout, previewViewport().width, previewViewport().height);
    setPanelDock("top");
    setPanelExpanded(false);
    menus.go("touch-layout");
    render();
    requestAnimationFrame(() => render());
    select.focus({ preventScroll: true });
  }
  settings.querySelector("[data-touch-edit]").addEventListener("click", open);
  settings.addEventListener("input", event => {
    const layout = normalizeLayout(controls.layout);
    if (event.target.hasAttribute("data-touch-sensitivity")) layout.sensitivity = Number(event.target.value);
    else if (event.target.hasAttribute("data-touch-fire-look")) layout.fireLook = event.target.checked;
    else return;
    const saved = controls.setLayout(layout);
    settings.querySelector(".touch-settings-status").textContent = saved ? "触屏设置已保存。" : "设置已生效；浏览器存储不可用，下次打开需重新设置。";
    syncSettings();
  });
  select.addEventListener("change", () => { selected = select.value; render(); });
  page.addEventListener("keydown", event => {
    if (event.code !== "Escape" || event.isComposing) return;
    // Native settings skip keyboard navigation inside inputs. The editor still
    // needs a reliable way to cancel while its select or a slider has focus.
    event.preventDefault();
    event.stopPropagation();
    menus.back();
  });
  page.addEventListener("input", event => {
    const prop = event.target.dataset.touchProp;
    if (!prop || !draft) return;
    draft.controls[selected][prop] = Number(event.target.value);
    render();
  });
  screen.addEventListener("pointerdown", event => {
    const element = event.target.closest("[data-control]");
    if (!element || drag || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    selected = element.dataset.control;
    const bounds = screen.getBoundingClientRect();
    // Start from the displayed center, including safe-edge clamping.
    const rect = element.getBoundingClientRect();
    drag = { id: event.pointerId, element, bounds, x: event.clientX, y: event.clientY,
      cx: (rect.left + rect.width / 2 - bounds.left) / bounds.width,
      cy: (rect.top + rect.height / 2 - bounds.top) / bounds.height };
    element.setPointerCapture(event.pointerId);
    render();
  });
  screen.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    const item = draft.controls[selected];
    item.x = Math.max(0, Math.min(1, drag.cx + (event.clientX - drag.x) / drag.bounds.width));
    item.y = Math.max(0, Math.min(1, drag.cy + (event.clientY - drag.y) / drag.bounds.height));
    render();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) screen.addEventListener(type, endDrag);
  page.addEventListener("click", event => {
    if (event.target.closest("[data-touch-toggle-panel]")) {
      setPanelExpanded(panel.dataset.collapsed === "true");
      return;
    }
    if (event.target.closest("[data-touch-dock]")) {
      setPanelDock(panel.dataset.dock === "top" ? "bottom" : "top");
      return;
    }
    if (event.target.closest("[data-touch-cancel]")) return menus.back();
    if (event.target.closest("[data-touch-reset]")) {
      endDrag();
      const { sensitivity, fireLook } = draft;
      draft = { ...defaultLayout(previewViewport().width, previewViewport().height), sensitivity, fireLook };
      render();
    }
    if (event.target.closest("[data-touch-save]")) {
      const saved = controls.setLayout(draft);
      settings.querySelector(".touch-settings-status").textContent = saved ? "布局已保存，单人与联机共用。" : "布局已生效；浏览器存储不可用，下次打开需重新设置。";
      menus.back();
    }
    const control = event.target.closest("[data-control]");
    if (control) { selected = control.dataset.control; render(); }
  });
  const back = menus.back;
  menus.back = function (...args) {
    if (this.page === "touch-layout") {
      endDrag(); draft = null;
      this.go("settings"); this._tab("controls"); syncSettings();
      return;
    }
    return back.apply(this, args);
  };
  const go = menus.go;
  menus.go = function (name, ...args) {
    if (this.page === "touch-layout" && name !== "touch-layout") { endDrag(); draft = null; }
    document.body.classList.toggle("touch-editing", name === "touch-layout");
    return go.call(this, name, ...args);
  };
  addEventListener("blur", () => endDrag());
  addEventListener("resize", () => { endDrag(); render(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) endDrag(); });
  new ResizeObserver(() => { endDrag(); render(); }).observe(screen);
  syncSettings();
}
