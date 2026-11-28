import { KEY_ACTIONS, MAX_BINDINGS, bindingLabel, validBinding } from "./key-bindings.js";

export function installKeyBindingSettings({ menus, devices, doc = document }) {
  const bindings = devices?.keyBindings;
  if (!bindings) return;
  const panel = menus.pages.settings.querySelector('.st-panel[data-tab="controls"]');
  const section = doc.createElement("section");
  section.className = "keybinding-settings";
  section.innerHTML = '<div class="keybinding-heading"><div><h4>键鼠按键自定义</h4><p>点击键位后按新键，也支持鼠标按键和滚轮。Esc 取消，Backspace / Delete 清空。可添加备用键。</p></div><button class="btn" type="button" data-key-reset>恢复默认</button></div>' +
    '<div class="keybinding-feedback" aria-live="polite"><p data-key-status>设置自动保存在当前浏览器，单人与联机共用。Esc 固定为暂停；系统快捷键保留。</p><div data-key-confirm hidden><button class="btn" type="button" data-key-replace>替换原绑定</button><button class="btn" type="button" data-key-cancel>取消</button></div></div>' +
    '<div class="keybinding-groups"></div><p class="keybinding-note">冲刺需按住；蹲下键在冲刺时触发滑铲。飞扑、手雷和 K9 当前仅单人训练可用。</p>';
  // Replace the original static key reference, inside the original controls page.
  panel.querySelector(".binds")?.replaceWith(section);
  if (!section.parentElement) panel.append(section);
  const win = doc.defaultView, status = section.querySelector("[data-key-status]"), confirm = section.querySelector("[data-key-confirm]");
  for (const button of section.querySelectorAll("button")) button.dataset.nav = "";
  const groups = section.querySelector(".keybinding-groups");
  for (const name of [...new Set(KEY_ACTIONS.map(action => action.group))]) {
    const group = doc.createElement("div");
    group.className = "keybinding-group";
    const title = doc.createElement("h5"); title.textContent = name; group.append(title);
    for (const action of KEY_ACTIONS.filter(action => action.group === name)) {
      const row = doc.createElement("div"); row.className = "keybinding-row"; row.dataset.keyAction = action.id;
      const label = doc.createElement("span"); label.textContent = action.label;
      if (action.training) { const note = doc.createElement("small"); note.textContent = "单人"; label.append(note); }
      const keys = doc.createElement("div"); keys.className = "keybinding-keys";
      row.append(label, keys); group.append(row);
    }
    groups.append(group);
  }
  let active = null, pending = null, swallowClick = false, resetArmed = false;
  const disarmReset = () => { resetArmed = false; section.querySelector("[data-key-reset]").textContent = "恢复默认"; };
  const available = () => devices.effective === "keyboard" && menus.pages.settings.classList.contains("on") && panel.classList.contains("on");
  const message = text => { status.textContent = text; };
  function render() {
    section.hidden = devices.effective !== "keyboard";
    for (const action of KEY_ACTIONS) {
      const row = groups.querySelector('[data-key-action="' + action.id + '"]'), keys = row.querySelector(".keybinding-keys");
      keys.replaceChildren();
      const list = bindings.bindings[action.id];
      for (let i = 0; i < Math.min(MAX_BINDINGS, Math.max(2, list.length + 1)); i++) {
        const button = doc.createElement("button");
        button.type = "button"; button.className = "keybinding-key"; button.dataset.keySlot = i;
        button.dataset.nav = "";
        const recording = active?.id === action.id && active?.slot === i;
        button.textContent = recording ? "请按键…" : list[i] ? bindingLabel(list[i]) : i ? "+ 备用键" : "未绑定";
        button.setAttribute("aria-label", action.label + "，" + (i ? "备用键 " + i : "主键") + "：" + (recording ? "等待按键，Esc 取消" : bindingLabel(list[i])));
        button.setAttribute("aria-pressed", String(recording));
        keys.append(button);
      }
      row.classList.toggle("recording", active?.id === action.id);
      row.classList.toggle("unbound", list.length === 0);
    }
  }
  function stop({ focus = true } = {}) {
    const previous = active;
    active = null; pending = null; bindings.capturing = false; confirm.hidden = true;
    render();
    if (focus && previous && available()) groups.querySelector('[data-key-action="' + previous.id + '"] [data-key-slot="' + previous.slot + '"]')?.focus({ preventScroll: true });
  }
  function saved(result, description) {
    message(description + (result.saved ? " 已保存。" : " 已生效；浏览器存储不可用，下次打开需重新设置。"));
  }
  function choose(code) {
    const selected = active, result = bindings.assign(selected.id, selected.slot, code);
    if (result.conflict) {
      bindings.capturing = false; active = null;
      pending = { ...selected, code };
      render(); confirm.hidden = false;
      message(bindingLabel(code) + " 已用于「" + result.conflict.label + "」。替换会移除该操作的此键位。");
      section.querySelector("[data-key-replace]").focus({ preventScroll: true });
      return;
    }
    stop();
    saved(result, code ? selected.label + " → " + bindingLabel(code) + "。" : "已清空「" + selected.label + "」的此键位。");
  }
  section.addEventListener("click", event => {
    const button = event.target.closest("button"); if (!button) return;
    if (!button.hasAttribute("data-key-reset")) disarmReset();
    if (button.hasAttribute("data-key-slot")) {
      const id = button.closest("[data-key-action]").dataset.keyAction;
      const slot = Number(button.dataset.keySlot);
      stop({ focus: false });
      active = { id, slot, label: KEY_ACTIONS.find(action => action.id === id).label };
      bindings.capturing = true;
      message("正在设置「" + active.label + "」：按一个新键／鼠标键／滚轮；Esc 取消，Backspace / Delete 清空。");
      render();
      groups.querySelector('[data-key-action="' + id + '"] [data-key-slot="' + slot + '"]')?.focus({ preventScroll: true });
    } else if (button.hasAttribute("data-key-replace") && pending) {
      const selected = pending, result = bindings.assign(selected.id, selected.slot, selected.code, { replace: true });
      stop(); saved(result, selected.label + " → " + bindingLabel(selected.code) + "，已移除冲突绑定。");
    } else if (button.hasAttribute("data-key-cancel")) {
      stop(); message("已取消，原键位未修改。");
    } else if (button.hasAttribute("data-key-reset")) {
      stop({ focus: false });
      if (!resetArmed) {
        resetArmed = true; button.textContent = "确认恢复默认";
        message("再次点击恢复默认，将重置全部键鼠绑定。");
      } else {
        resetArmed = false; button.textContent = "恢复默认";
        saved(bindings.reset(), "全部键鼠绑定已恢复默认。");
      }
    }
  });
  win.addEventListener("keydown", event => {
    if ((!active && !pending) || !available()) return;
    if (!active && event.code !== "Escape") return;
    if (event.metaKey || event.altKey) { stop(); message("已取消改键，系统快捷键保留。"); return; }
    // The native menu also listens for Q/E, arrows, Enter and Escape. Capture
    // first so assigning them cannot navigate away or resume a paused match.
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.code === "Escape") { stop(); message("已取消，原键位未修改。"); return; }
    if (!active || event.repeat) return;
    if (event.code === "Backspace" || event.code === "Delete") { choose(null); return; }
    if (!validBinding(event.code)) { message("这个键由浏览器或系统保留，请换一个键。Esc 取消。"); return; }
    choose(event.code);
  }, { capture: true });
  for (const type of ["mousedown", "mouseup"]) win.addEventListener(type, event => {
    if (!active || !available()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (type === "mouseup" && event.button <= 4) {
      swallowClick = true;
      win.setTimeout(() => { swallowClick = false; }, 0);
      choose("Mouse" + event.button);
    }
  }, { capture: true });
  for (const type of ["click", "auxclick", "contextmenu"]) win.addEventListener(type, event => {
    if (active && available() || swallowClick) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true });
  win.addEventListener("wheel", event => {
    if (!active || !available() || !event.deltaY) return;
    event.preventDefault(); event.stopImmediatePropagation();
    choose(event.deltaY < 0 ? "WheelUp" : "WheelDown");
  }, { capture: true, passive: false });
  section.addEventListener("focusin", event => event.target.scrollIntoView({ block: "nearest", inline: "nearest" }));
  win.addEventListener("blur", () => { disarmReset(); if (active || pending) { stop({ focus: false }); message("改键已取消。"); } });
  // Cancel capture on tab/page transitions, including gamepad menu navigation.
  const observer = new win.MutationObserver(() => { if (!available()) { disarmReset(); if (active || pending) stop({ focus: false }); } });
  observer.observe(menus.pages.settings, { attributes: true, attributeFilter: ["class"] });
  observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
  devices.addEventListener("change", () => { if (!available()) stop({ focus: false }); else render(); });
  bindings.addEventListener("change", render);
  render();
}
