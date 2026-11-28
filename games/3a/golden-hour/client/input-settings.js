import { installKeyBindingSettings } from "./key-binding-settings.js";

const names = { keyboard: "鼠标键盘", touch: "屏幕触摸", gamepad: "手柄" };

export function installInputSettings({ menus, devices, controls }) {
  if (!devices) return;
  const section = document.createElement("section");
  section.className = "input-device-settings";
  section.innerHTML = `<h4>输入设备</h4>
    <label class="touch-setting">操作方式<select data-input-mode aria-label="操作方式">
      <option value="auto">自动识别</option><option value="keyboard">鼠标键盘</option><option value="touch">屏幕触摸</option><option value="gamepad">手柄</option>
    </select></label>
    <p data-input-status role="status"></p>
    <div class="aim-settings">
      <span id="aim-mode-label">开镜方式</span>
      <div class="aim-mode-options" role="group" aria-labelledby="aim-mode-label">
        <button type="button" data-aim-mode="hold" aria-pressed="false">按住开镜</button>
        <button type="button" data-aim-mode="toggle" aria-pressed="false">点按切换</button>
      </div>
      <label class="touch-setting aim-auto"><input type="checkbox" data-aim-auto> 开火时自动开镜</label>
    </div>
    <div data-gamepad-settings hidden>
      <p data-gamepad-status role="status"></p>
      <label class="touch-setting">转向灵敏度<input type="range" min="0.25" max="3" step="0.05" data-pad-setting="sensitivity" aria-label="手柄转向灵敏度"><output></output></label>
      <label class="touch-setting">摇杆死区<input type="range" min="0.08" max="0.35" step="0.01" data-pad-setting="deadzone" aria-label="手柄摇杆死区"><output></output></label>
      <label class="touch-setting"><input type="checkbox" data-pad-setting="invertY"> 反转手柄纵向视角</label>
      <p class="gamepad-bindings">左摇杆移动 · 右摇杆转向 · LT/L2 瞄准 · RT/R2 开火<br>A/× 跳跃 · B/○ 蹲下／冲刺时滑铲 · X/□ 换弹 · Y/△ 切枪<br>左摇杆按下切换冲刺 · RB/R1 或右摇杆按下近战<br>Start/Options 暂停／继续 · View/Share 战绩<br>菜单：左摇杆／方向键导航，A/× 确认，B/○ 返回，LB/RB 切换选项卡。<br>单人训练：LB/L1 手雷，方向键↓飞扑。联机暂不支持这两项。</p>
    </div>
    <p data-input-saved role="status">选择保存在当前浏览器，单人与联机共用。</p>`;
  menus.pages.settings.querySelector('.st-panel[data-tab="controls"]').prepend(section);
  const mode = section.querySelector("[data-input-mode]");
  const aimModes = section.querySelectorAll("[data-aim-mode]");
  const autoAim = section.querySelector("[data-aim-auto]");
  const savedStatus = section.querySelector("[data-input-saved]");
  const render = () => {
    mode.value = devices.preferences.mode;
    section.querySelector("[data-input-status]").textContent = devices.preferences.mode === "auto"
      ? "当前识别：" + names[devices.effective] + "。识别不准时可手动选择。"
      : "当前使用：" + names[devices.effective] + "。手动选择优先，不会被自动识别覆盖。";
    const aim = devices.preferences.aim[devices.effective];
    for (const button of aimModes) button.setAttribute("aria-pressed", String(button.dataset.aimMode === aim.mode));
    autoAim.checked = aim.auto;
    section.querySelector("[data-gamepad-settings]").hidden = devices.effective !== "gamepad";
    section.querySelector("[data-gamepad-status]").textContent = devices.padStatus;
    for (const input of section.querySelectorAll("[data-pad-setting]")) {
      const value = devices.preferences[input.dataset.padSetting];
      if (input.type === "checkbox") input.checked = value;
      else {
        input.value = value;
        input.nextElementSibling.textContent = input.dataset.padSetting === "deadzone" ? Math.round(value * 100) + "%" : value.toFixed(2) + "×";
      }
    }
    const touchSettings = menus.pages.settings.querySelector(".touch-settings");
    if (touchSettings) touchSettings.hidden = devices.effective !== "touch";
  };
  const save = value => {
    const saved = devices.save(value);
    if (value.mode !== undefined) controls?.setDevice();
    savedStatus.textContent = saved ? "操作设置已保存，单人与联机共用。" : "设置已生效；浏览器存储不可用，下次打开需重新设置。";
  };
  const saveAim = patch => {
    const { effective, preferences } = devices;
    save({ aim: { ...preferences.aim, [effective]: { ...preferences.aim[effective], ...patch } } });
  };
  for (const button of aimModes) button.addEventListener("click", () => saveAim({ mode: button.dataset.aimMode }));
  autoAim.addEventListener("change", () => saveAim({ auto: autoAim.checked }));
  section.addEventListener("change", event => {
    const target = event.target;
    const value = target === mode ? { mode: mode.value } : target.dataset.padSetting
      ? { [target.dataset.padSetting]: target.type === "checkbox" ? target.checked : Number(target.value) } : null;
    if (value) save(value);
  });
  devices.addEventListener("change", render);
  installKeyBindingSettings({ menus, devices });
  render();
}
