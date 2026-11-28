import { Connection } from "./net.js";
import { Engine } from "./engine.js";
import { setTeamPerspective } from './allegiance.js';
import { installMenuPages } from './menu-layout.js';
import { loadApiConfig } from "./api-config.js";
import { RoomDirectory, joinHello } from "./lobby.js";
import { loadCatalog, loadMapData } from "./catalog.js";
import { filterClientCatalog, mapSceneAdapter, modeAdapter } from "./content-adapters.js";
import { RoomContent } from './room-content.js';
import { MatchLoading } from './match-loading.js';
import { MapPicker } from './maps/map-picker.js';
import { loadTrainingCatalog, loadTrainingMap } from './maps/training-catalog.js';
import { prepareTrainingWorld } from './maps/training-world.js';
import { ToyAccount } from "./toy-account.js";
import { autoAuthorizeToyIdentity, isLocalDevSession, requireToyIdentity, showBilibiliLoginPrompt } from "./toy-play-auth.js";
import { OnlineKills } from "./online-kills.js";
import { MatchReportGate } from "./online-results.js";
import { installToyMenus } from "./toy-menu.js";
import { installTrainingKills } from "./training-kills.js";
import { installTouchSettings } from "./touch-settings.js";
import { installInputSettings } from "./input-settings.js";
import { installNativeProgress } from "./native-progress.js";
import { installWeaponChallenges } from "./rpk-challenges.js";
import { ToyWeaponAccess, installWeaponGate } from "./toy-weapons.js";

const net = new Connection();
const engine = new Engine(net);
const account = new ToyAccount();
const localDev = isLocalDevSession({ account });
const onlineKills = new OnlineKills(account);
const reportGate = new MatchReportGate();
const query = new URLSearchParams(location.search);
const multiplayerEnabled = document.documentElement.dataset.apiOrigin !== "";
let lastRosterAt = 0;
let joinGeneration = 0;
let room = null,
  busy = false,
  identityAuthBusy = false,
  returnPage = null;
let roomGeometryReady = false,
  latestSnapshot = null,
  roomSetupPromise = null,
  resolveRoomSetup = null,
  rejectRoomSetup = null;
const mapDataCache = new Map();
let clientCatalog = null;
let activeRoomAdapters = null;
const roomContent = new RoomContent();
await engine.ready();
const { ctx } = engine;
// Shared by training and online physics: keep ejected cases, silence their
// floor impacts/bounces before they allocate any Web Audio voices.
ctx.audio.casing = () => {};
// Read-only diagnostics consumed by the local graphics settings report.
engine.debug.network = net.metrics;
const menus = ctx.hud.menus;
let trainingRequest = null, activeTraining = null;
const matchLoading = new MatchLoading({ cancel: () => void leave() });
installTouchSettings({ menus, controls: globalThis.GHTouch });
installInputSettings({ menus, devices: globalThis.GHInput, controls: globalThis.GHTouch });
const $ = (id) => document.getElementById(id);
const visible = (id, value) => {
  $(id).hidden = !value;
};
const label = (id, value) => {
  $(id).textContent = value;
};
const inMatch = () => room && ["live", "countdown"].includes(room.phase);
const current = () => room?.players.find((p) => p.id === net.id);
const difficultyLabel = (value) => ({ recruit: "新兵", regular: "普通", normal: "普通", hardened: "强化", veteran: "老兵" }[value] || "普通");

function getMapData(id, version) {
  const key = `${id}@${version}`;
  if (!mapDataCache.has(key)) {
    const request = loadMapData(document.documentElement.dataset.apiOrigin, location.href, id, version)
      .then((data) => {
        while (mapDataCache.size >= 4) mapDataCache.delete(mapDataCache.keys().next().value);
        mapDataCache.set(key, Promise.resolve(data));
        return data;
      })
      .catch((error) => {
        mapDataCache.delete(key);
        throw error;
      });
    mapDataCache.set(key, request);
  }
  return mapDataCache.get(key);
}

// Register one more page with the game's own menu controller. All navigation,
// backgrounds, transitions, keyboard controls, gunsmith and HUD stay native.
const deploy = menus.pages.main.querySelector('[data-act="deploy"]');
deploy.dataset.act = "online";
deploy.querySelector("b").textContent = "联机对战";
const training = document.createElement("button");
training.className = "nv";
training.dataset.nav = "";
training.dataset.act = "training";
training.innerHTML = "<b>单人训练</b><em>离线 · 人机作战</em>";
deploy.after(training);
if (!multiplayerEnabled) {
  training.classList.add("primary");
  deploy.remove();
}
const page = menus._page(
  "online",
  `
  <header class="topbar"><button class="backb" data-nav data-act="online-back">‹ <span>返回</span></button><h2>联机作战</h2><span class="online-mode">暮色酒店 · 团队死斗 · 先到 40 分</span></header>
  <div class="online-layout">
    <div class="map-briefing" id="online-maps">
      <h3 class="sech" id="online-map-heading">选择地图</h3>
      <div id="online-map" class="map-grid" role="radiogroup" aria-labelledby="online-map-heading"></div>
      <p class="map-notice" id="online-map-status" role="status">正在读取可用地图…</p>
    </div>
    <div class="online-commands">
      <div class="sech"><span id="online-section">公共房间大厅</span><span id="online-members">房间规则</span></div>
      <div id="online-connect">
        <div class="row online-field"><span>干员呼号</span><strong id="online-name" data-toy-name>匿名干员</strong></div>
        <label class="row online-field"><span>模式</span><select id="online-mode-select" aria-label="选择模式"><option value="tdm">团队死斗</option></select></label>
        <label class="row online-field" id="online-coop-difficulty" hidden><span>难度</span><select id="online-coop-select" aria-label="僵尸难度"><option value="recruit">新兵 · 适合初次探索</option><option value="normal" selected>普通 · 标准尸潮</option><option value="veteran">老兵 · 高压围攻</option></select></label>
        <button class="nv primary" id="online-quick" data-nav data-act="online-quick"><b>快速加入</b><em>立即进入战场 ›</em></button>
        <p class="online-connect-hint">优先加入所选地图的公开对局，没空位就自动补齐人机开战。</p>
        <button class="nv" id="online-create" data-nav data-act="online-create"><b>创建房间</b><em>编队准备 · 房主开战 ›</em></button>
      </div>
      <div id="online-room" hidden>
        <button class="nv primary" id="online-next" data-nav data-act="online-next" hidden><b>再来一局</b><em>当前房间立即开战 ›</em></button>
        <button class="nv" id="online-resume" data-nav data-act="online-resume" hidden><b>返回战场</b><em>›</em></button>
      </div>
      <button class="nv" data-nav data-act="online-gunsmith"><b>枪匠</b><em id="online-loadout">使用当前装备 ›</em></button>
      <button class="nv" id="online-leave" data-nav data-act="online-leave" hidden><b>退出房间</b><em>返回主菜单</em></button>
      <p id="online-status" role="status">快速加入或在大厅选择房间，空位自动补齐人机。</p>
      <p id="online-error" role="alert" hidden></p>
      <p id="online-trust" hidden>跨站连接未完成，可能与网络、服务器、跨域设置或证书信任有关；这不代表已确认是证书错误。<a id="online-trust-link" target="_blank" rel="noopener noreferrer" data-nav>打开服务器页面 / 信任证书 ↗</a>。如浏览器显示证书提示，请核对服务器地址并手动确认，然后回到游戏再次点击创建或加入。换证后可能需要重新确认；游戏无法绕过浏览器证书校验。</p>
    </div>
    <div class="online-squad">
      <div id="online-hall">
        <div class="kicker">PUBLIC ROOMS · 公开战场</div>
        <div class="sech online-hall-heading"><span>实时房间列表</span><button class="btn" id="online-refresh" data-nav data-act="online-refresh">刷新连接</button></div>
        <p id="online-directory-status" role="status">正在获取公开房间…</p>
        <p id="online-directory-trust" hidden>列表不可用不代表已确认是证书错误。<a id="online-directory-trust-link" target="_blank" rel="noopener noreferrer" data-nav>打开服务器页面 / 检查证书 ↗</a>。如浏览器提示证书问题，请核对地址并手动确认，再刷新连接。你可以刷新连接或尝试快速加入。</p>
        <div id="online-list" class="online-room-list" aria-label="公开房间"></div>
        <p class="online-fill">真人加入接替人机。快速加入立即作战；自建房间由房主开战。可前往枪匠配置武器。</p>
      </div>
      <div id="online-roster" hidden><div class="sech"><span id="online-phase">编队准备</span><span>真人优先 · 自动补位</span></div><h3 id="online-result" hidden></h3><div class="tbl" id="online-teams"></div><div class="online-team-actions"><button class="btn" id="online-team-a" data-nav data-act="online-team-a">加入先锋</button><button class="btn" id="online-team-b" data-nav data-act="online-team-b">加入余烬</button></div><p class="online-fill">人机自动就绪 · 真人加入时替换人机 · 断线后由人机暂时代打</p></div>
    </div>
  </div>
  <footer class="legend"><span><kbd>↑</kbd><kbd>↓</kbd> 导航</span><span><kbd>ENTER</kbd> 选择</span><span><kbd>ESC</kbd> 返回</span></footer>`,
);
const trainingPage = menus._page('training', `
  <header class="topbar"><button class="backb" data-nav data-act="training-back">‹ <span>返回</span></button><h2>单人训练</h2><span class="online-mode">离线 · 人机作战</span></header>
  <div class="training-layout">
    <h3 class="sech" id="training-map-heading">选择地图</h3>
    <div id="training-map" class="map-grid" role="radiogroup" aria-labelledby="training-map-heading"></div>
    <p class="map-notice" id="training-status" role="status"></p>
    <div class="training-actions">
      <span id="training-difficulty"></span>
      <button type="button" class="nv primary" id="training-start" data-nav data-act="training-start"><b>开始训练</b><em>›</em></button>
    </div>
  </div>
  <footer class="legend"><span><kbd>↑</kbd><kbd>↓</kbd> 导航</span><span><kbd>←</kbd><kbd>→</kbd> 选择地图</span><span><kbd>ENTER</kbd> 确认</span><span><kbd>ESC</kbd> 返回</span></footer>`);
const onlinePicker = new MapPicker($('online-map'), 'online-map');
const trainingPicker = new MapPicker($('training-map'), 'training-map');
const directory = new RoomDirectory({
  origin: document.documentElement.dataset.apiOrigin,
  pageURL: location.href,
  onChange: renderDirectory,
});
let catalogPromise;
function syncModeSelection() {
  if (!onlinePicker.selected || !clientCatalog) return;
  const select = $('online-mode-select');
  const supported = clientCatalog.modes.filter(mode => onlinePicker.selected.modes.includes(mode.id));
  const choice = supported.find(mode => mode.id === select.value) ||
    supported.find(mode => mode.id === clientCatalog.defaultMode) || supported[0];
  select.replaceChildren(...supported.map(mode => new Option(mode.name, mode.id)));
  select.value = choice.id;
  syncOnlineModeRules();
}

function syncOnlineModeRules() {
  const coop = $('online-mode-select').value === 'zombie-coop';
  visible('online-coop-difficulty', coop);
  $('online-connect').classList.toggle('coop-connect', coop);
  if (!room) status(coop ? '选择难度，创建房间或快速开始行动。' : '快速加入或在大厅选择房间，空位自动补齐人机。');
  page.querySelector('.online-connect-hint').textContent = coop
    ? '最多四人合作。对局中加入可先观战，在下一轮整备入场。'
    : '优先加入所选地图的公开对局，没空位就自动补齐人机开战。';
  setJoinBusy();
}
$('online-mode-select').addEventListener('change', syncOnlineModeRules);

function ensureCatalog() {
  if (!multiplayerEnabled) return Promise.resolve(null);
  if (!catalogPromise) {
    label('online-map-status', '正在读取可用地图…');
    visible('online-map-status', true);
    catalogPromise = loadCatalog(document.documentElement.dataset.apiOrigin, location.href)
      .then(filterClientCatalog)
      .then(catalog => {
        clientCatalog = catalog;
        onlinePicker.setMaps(catalog.maps, catalog.defaultMap);
        syncModeSelection();
        visible('online-map-status', false);
        return catalog;
      })
      .catch(failure => {
        catalogPromise = null;
        label('online-map-status', '地图列表加载失败，可点击「刷新连接」重试。');
        throw failure;
      });
  }
  return catalogPromise;
}

let trainingCatalog;
function openTraining() {
  if (!trainingPicker.selected)
    trainingPicker.setMaps([{ id: 'hotel', name: '暮色酒店', clientScene: 'hotel' }], 'hotel');
  label('training-difficulty', '人机难度 · ' + difficultyLabel(ctx.settings.difficulty));
  menus.go('training');
  if (trainingCatalog) return;
  label('training-status', '正在读取地图…');
  trainingCatalog = loadTrainingCatalog().then(catalog => {
    trainingPicker.setMaps(catalog.maps, catalog.defaultMap);
    if (!trainingRequest) label('training-status', '');
  }).catch(() => {
    trainingCatalog = null;
    if (!trainingRequest) label('training-status', '地图列表加载失败，仍可训练暮色酒店。返回后可重试。');
  });
}

function cancelTraining() {
  const request = trainingRequest;
  if (!request) return;
  // Keep the controls disabled until a decoder that cannot be interrupted
  // has finished releasing its resources.
  request.abort();
  matchLoading.hide();
  engine.cancelDeployment();
  label('training-status', '已取消加载');
}

function releaseTraining() {
  if (!activeTraining) return;
  const { scene, world } = activeTraining;
  activeTraining = null;
  try { disposeAdapter(world); } finally { disposeAdapter(scene); }
}

async function startTraining() {
  const map = trainingPicker.selected;
  if (!map || trainingRequest || room || busy || identityAuthBusy) return;
  if (!localDev) {
    label('training-status', '正在确认 B站登录状态并等待授权…');
    try {
      await authorizePlayer();
    } catch (failure) {
      label('training-status', failure.message);
      return;
    }
  }
  label('training-status', '');
  ctx.audio.init();
  if (map.clientScene === 'hotel') {
    originalAct.call(menus, 'deploy', 1);
    return;
  }
  const request = trainingRequest = new AbortController();
  const { signal } = request;
  let scene, world;
  trainingPicker.setDisabled(true);
  $('training-start').disabled = true;
  matchLoading.begin(map.name, '单人训练', { message: '正在读取地图配置', cancelLabel: '取消加载', onCancel: cancelTraining });
  // Reserve the user gesture for mouse capture like online deployment.
  engine.prepareDeployment();
  try {
    const mapData = await loadTrainingMap(map, AbortSignal.any([signal, AbortSignal.timeout(12000)]));
    signal.throwIfAborted();
    scene = await mapSceneAdapter(map.clientScene).prepare({
      engine, mapData, signal, room: { mapName: map.name },
      onProgress: showMapProgress,
    });
    signal.throwIfAborted();
    matchLoading.update(90, '正在准备人机路线');
    world = prepareTrainingWorld(engine, mapData);
    activeTraining = { scene, world };
    engine.deploymentRequested = false;
    originalAct.call(menus, 'deploy', 1);
    matchLoading.finish();
  } catch (failure) {
    activeTraining = null;
    disposeAdapter(world);
    disposeAdapter(scene);
    if (!signal.aborted) {
      engine.cancelDeployment();
      matchLoading.hide();
      ctx.hud.show('menu');
      menus.go('training', true);
      label('training-status', failure.name === 'TimeoutError' ? '读取地图配置超时，请重试。' : failure.message || '加载失败，请重试。');
    }
  } finally {
    trainingRequest = null;
    trainingPicker.setDisabled(false);
    $('training-start').disabled = false;
    if (menus.page === 'training') trainingPicker.focus();
  }
}

function showMapProgress(progress) {
  if (progress.stage === 'download') matchLoading.download(progress.loaded, progress.total);
  else if (progress.stage === 'verify') matchLoading.update(72, '正在校验地图资源');
  else if (progress.stage === 'parse') matchLoading.update(76, '正在解析地图场景');
  else if (progress.stage === 'actors') matchLoading.update(87, '正在准备感染者模型与动作');
  else if (progress.stage === 'textures') matchLoading.update(84, '正在准备材质与画面');
}

function syncDirectory() {
  directory.setActive(multiplayerEnabled && menus.page === "online" && !menus.root.classList.contains("hidden") && !room && !busy && !document.hidden);
}
document.addEventListener("visibilitychange", syncDirectory);
for (const menuPage of [page, trainingPage]) {
  menuPage.addEventListener('click', event => {
    const button = event.target.closest('button[data-act]');
    if (button && !button.disabled) menus._act(button.dataset.act);
  });
}
const originalKey = menus._key;
menus._key = function (event) {
  const picker = this.page === 'online' ? onlinePicker : this.page === 'training' ? trainingPicker : null;
  if (!event.altKey && !event.metaKey && !event.ctrlKey && picker &&
      ['ArrowLeft', 'ArrowRight'].includes(event.code) &&
      picker.move(document.activeElement, event.code === 'ArrowLeft' ? -1 : 1)) {
    if (picker === onlinePicker) syncModeSelection();
    this.cb.sound('hover');
    event.preventDefault();
    return;
  }
  return originalKey.call(this, event);
};
const originalGo = menus.go;
menus.go = function (name, force) {
  if (!multiplayerEnabled && name === "online") return;
  originalGo.call(this, name, force);
  if (name === "online") {
    this.root.dataset.bg = room ? "dim" : "menu";
    const first = page.querySelector("[data-nav]:not([hidden]):not(:disabled)");
    first?.focus({ preventScroll: true });
    updateLoadout();
  }
  if (name === 'training') trainingPicker.focus();
  syncDirectory();
};
const originalHide = menus._hide;
menus._hide = function (...args) {
  originalHide.apply(this, args);
  syncDirectory();
};
const originalBack = menus.back;
menus.back = function () {
  if (this.page === "gunsmith" && this.gs.mode === "camo")
    return originalBack.call(this);
  if (returnPage && ["gunsmith", "settings"].includes(this.page)) {
    const target = returnPage;
    returnPage = null;
    this.go(target);
    updateLoadout();
    return;
  }
  if (this.page === "online") {
    if (busy) { void leave(); return; }
    this.go(inMatch() ? "pause" : "main");
    return;
  }
  if (this.page === 'training') {
    if (trainingRequest) { cancelTraining(); return; }
    this.go('main');
    training.focus({ preventScroll: true });
    return;
  }
  return originalBack.call(this);
};
const originalAct = menus._act;
menus._act = function (action, direction) {
  if (!multiplayerEnabled && (action === "online" || action?.startsWith("online-"))) return;
  if (action?.startsWith("online-room:")) {
    this.cb.sound("click");
    join("listed", action.slice("online-room:".length));
    return;
  }
  for (const picker of [onlinePicker, trainingPicker]) {
    const prefix = picker.action + ':';
    if (!action?.startsWith(prefix)) continue;
    if (picker.select(action.slice(prefix.length))) {
      this.cb.sound('click');
      if (picker === onlinePicker) syncModeSelection();
    }
    return;
  }
  if (actions[action]) {
    this.cb.sound("click");
    actions[action]();
    return;
  }
  return originalAct.call(this, action, direction);
};
const originalResume = menus.cb.onResume,
  originalQuit = menus.cb.onQuit,
  originalAgain = menus.cb.onAgain;
menus.cb.onResume = () => (engine.active ? resume() : originalResume());
menus.cb.onQuit = () => {
  if (engine.active) return leave();
  try { originalQuit(); }
  finally {
    releaseTraining();
    engine.resetHotelState({ muteLounge: true });
  }
};
menus.cb.onAgain = () => {
  if (engine.active) {
    openRoom();
    return;
  }
  originalAgain();
};
const roomButton = document.createElement("button");
roomButton.className = "nv";
roomButton.dataset.nav = "";
roomButton.dataset.act = "online";
roomButton.innerHTML = "<b>查看房间</b><em>编队 · 当前对局</em>";
roomButton.hidden = true;
menus.pages.pause.querySelector(".vnav").append(roomButton);
const dragButton = roomButton.cloneNode(true);
dragButton.dataset.act = "online-drag";
dragButton.innerHTML = "<b>拖动瞄准</b><em>当前窗口的备用操作</em>";
menus.pages.pause.querySelector(".vnav").append(dragButton);
const progression = installNativeProgress({ gh: engine.gh, account });
installWeaponChallenges({ gh: engine.gh, progression });
const access = new ToyWeaponAccess(account, undefined, { localDev });
onlineKills.progression = progression;
const toyMenus = installToyMenus({ account, engine, progression, access, localDev });
installWeaponGate({ access, engine, progression, authorize: toyMenus.authorize });
void autoAuthorizeToyIdentity({ account, authorize: toyMenus.authorize, promptLogin: showBilibiliLoginPrompt })
  .catch(() => {});
installMenuPages(menus);
const trainingKills = installTrainingKills({ gh: engine.gh, account, progression, isOnline: () => engine.active });
function saveKills() {
  trainingKills.sample();
  void account.flush();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveKills();
});
addEventListener("pagehide", saveKills);

function updateLoadout() {
  const names = {
    ar: "KR-7 CARBINE",
    smg: "VESPER 9",
    shotgun: "M12 BREACHER",
    m200: "M200 INTERVENTION",
    rpk: "RPK LIGHT MACHINE GUN",
  };
  label("online-loadout", (names[ctx.settings.primary] || names.ar) + " ›");
  const loadout = engine.equipCommand(ctx.settings.primary);
  const loadoutKey = JSON.stringify(loadout);
  if (engine.active && engine.loadoutKey !== loadoutKey) {
    engine.loadoutKey = loadoutKey;
    engine.primary = ctx.settings.primary;
    if (!inMatch()) {
      ctx.arsenal.reset(engine.primary);
      engine.applySpecs();
    }
    if (!inMatch()) command(loadout);
    else command({ type: "loadout", m200Build: loadout.m200Build, rpkBuild: loadout.rpkBuild });
  }
}
function openRoom() {
  if (engine.active) {
    engine.stopInput();
    engine.dragActive = false;
    engine.input.unlock();
    engine.input.keys.clear();
    engine.gh.G.state = inMatch() ? "paused" : "menu";
  }
  ctx.hud.show(inMatch() ? "pause" : "menu");
  menus.go("online");
  renderRoom();
  void ensureCatalog().catch(() => {});
}
async function authorizePlayer() {
  identityAuthBusy = true;
  setJoinBusy();
  if (!trainingRequest) {
    trainingPicker.setDisabled(true);
    $('training-start').disabled = true;
  }
  try {
    return await requireToyIdentity({ account, authorize: toyMenus.authorize, promptLogin: showBilibiliLoginPrompt, localDev });
  } finally {
    identityAuthBusy = false;
    setJoinBusy();
    if (!trainingRequest) {
      trainingPicker.setDisabled(false);
      $('training-start').disabled = false;
    }
  }
}
async function openOnlineLobby() {
  if (room || engine.active) return openRoom();
  openRoom();
  visible("online-error", false);
  if (localDev) {
    status("本地开发模式（免 Toy 登录），可直接快速加入或创建房间。");
    return;
  }
  status("正在确认 B站登录状态并等待授权…");
  try {
    await authorizePlayer();
    visible("online-error", false);
    status("B站身份已确认。请选择房间、快速加入或创建房间。");
  } catch (failure) {
    error(failure.message);
    status("登录并授权 B站身份后才能进入联机房间。点击加入或创建可再次授权。");
  }
}
function resume(drag = false) {
  if (!inMatch()) return openRoom();
  engine.lastUpdateAt = null;
  engine.gh.G.state = "playing";
  ctx.hud.show(null);
  if (drag) engine.enableDrag();
  else {
    engine.dragMode = false;
    engine.dragActive = false;
    engine.releaseDrag();
    engine.lock();
  }
}
function status(value) {
  const transport = { webrtc: "WebRTC", webtransport: "WebTransport", websocket: "兼容连接" }[net.metrics.transport];
  label("online-status", value + (net.writer && transport ? ` · ${transport}` : ""));
}
function error(value) {
  label("online-error", value);
  visible("online-error", true);
}
async function command(value) {
  try {
    await net.send(value);
  } catch (e) {
    matchLoading.hide();
    if (!engine.roundStarted) engine.cancelDeployment();
    error(e.message);
  }
}
function setJoinBusy() {
  for (const id of ['online-quick', 'online-create'])
    $(id).disabled = busy || identityAuthBusy || !onlinePicker.selected;
  $('online-refresh').disabled = busy;
  $('online-coop-select').disabled = busy;
  $('online-mode-select').disabled = busy || $('online-mode-select').options.length < 2;
  onlinePicker.setDisabled(busy);
  for (const button of $("online-list").querySelectorAll("button"))
    button.disabled = busy || identityAuthBusy || button.dataset.joinable !== "true";
}
function disposeAdapter(cleanup) {
  if (typeof cleanup !== "function") return;
  try { cleanup(); } catch {}
}
function disposeRoomAdapters() {
  roomContent.reset();
  disposeAdapter(activeRoomAdapters?.modeCleanup);
  disposeAdapter(activeRoomAdapters?.sceneCleanup);
  activeRoomAdapters = null;
}
async function prepareRoomAdapters(value, mapData, generation, signal) {
  const catalog = clientCatalog || await ensureCatalog();
  const map = catalog.maps.find((entry) => entry.id === value.mapId && entry.version === value.mapVersion && entry.clientScene === value.clientScene);
  const mode = catalog.modes.find((entry) => entry.id === value.modeId && entry.clientAdapter === value.modeAdapter);
  const sceneAdapter = map && mapSceneAdapter(map.clientScene);
  const gameModeAdapter = mode && modeAdapter(mode.clientAdapter);
  if (!map || !mode || !map.modes.includes(mode.id) || !sceneAdapter || !gameModeAdapter)
    throw Error("当前客户端不支持该房间的地图或模式，请刷新大厅后选择其他房间。");

  const sceneKey = `${map.id}@${map.version}:${map.clientScene}`;
  const modeKey = `${mode.id}:${mode.clientAdapter}`;
  if (activeRoomAdapters?.sceneKey === sceneKey && activeRoomAdapters?.modeKey === modeKey) return true;
  if (signal.aborted || generation !== joinGeneration) return false;
  if (mapData.clientScene !== map.clientScene || mapData.sceneAsset !== map.sceneAsset || mapData.sceneSHA256 !== map.sceneSHA256)
    throw Error('客户端地图目录与碰撞数据版本不一致，请刷新大厅。');
  const context = { engine, room: value, map, mapData, signal, onProgress(progress) {
    if (signal.aborted || generation !== joinGeneration) return;
    showMapProgress(progress);
  } };
  let sceneCleanup, modeCleanup;
  try {
    // Retire the old visual scene first; its restore must never run after the
    // replacement has hidden the native hotel and installed its environment.
    disposeAdapter(activeRoomAdapters?.modeCleanup);
    disposeAdapter(activeRoomAdapters?.sceneCleanup);
    activeRoomAdapters = null;
    sceneCleanup = await sceneAdapter.prepare(context);
    signal.throwIfAborted();
    modeCleanup = await gameModeAdapter.prepare(context);
    matchLoading.update(90, '正在准备对局');
  } catch (failure) {
    disposeAdapter(modeCleanup);
    disposeAdapter(sceneCleanup);
    throw failure;
  }
  if (signal.aborted || generation !== joinGeneration) {
    disposeAdapter(modeCleanup);
    disposeAdapter(sceneCleanup);
    return false;
  }
  activeRoomAdapters = { sceneKey, modeKey, sceneCleanup, modeCleanup };
  return true;
}
function setupRoomWorld(value, generation) {
  room = value;
  roomGeometryReady = false;
  const key = `${generation}:${value.room}:${value.mapId}@${value.mapVersion}:${value.modeId}`;
  const request = roomContent.prepare(key, async (signal) => {
    matchLoading.update(10, '正在读取地图配置');
    const mapData = await getMapData(value.mapId, value.mapVersion);
    signal.throwIfAborted();
    if (!room || room.room !== value.room || room.mapId !== value.mapId || room.mapVersion !== value.mapVersion) return;
    return prepareRoomAdapters(value, mapData, generation, signal).then(ready => ready ? mapData : null);
  }).then((mapData) => {
    if (!mapData) return;
    const ready = generation === joinGeneration;
    if (!ready || generation !== joinGeneration || !room || room.room !== value.room || room.mapId !== value.mapId || room.mapVersion !== value.mapVersion) return;
    if (engine.mapId === value.mapId && engine.mapVersion === value.mapVersion) engine.setRoom(room);
    else engine.setRoom(room, mapData);
    roomGeometryReady = true;
    matchLoading.update(96, '正在同步出生位置');
    renderRoom();
    if (latestSnapshot) {
      const snapshot = latestSnapshot;
      latestSnapshot = null;
      engine.snapshot(snapshot);
    }
    finishMatchLoading();
    resolveRoomSetup?.();
  }).catch((failure) => {
    if (generation === joinGeneration && room?.room === value.room && room.mapVersion === value.mapVersion && failure.name !== 'AbortError') {
      rejectRoomSetup?.(failure);
      matchLoading.hide();
      engine.cancelDeployment();
      error(`地图资源加载失败：${failure.message}`);
    }
    throw failure;
  });
  request.catch(() => {});
  return request;
}
function finishMatchLoading() {
  if (!roomGeometryReady || !room) return;
  // A waiting room is ready after its map is mounted. Active matches also need
  // the authoritative local spawn; never reveal the old menu/camera in between.
  if (!inMatch() || engine.roundStarted) matchLoading.finish();
}
function renderDirectory({ state, rooms, message, trustURL }) {
  label("online-directory-status", state === "loading"
    ? message || "正在获取公开房间…"
    : state === "offline" ? message
      : rooms.length ? `${rooms.length} 个公开房间 · 实时更新` : "暂无公开房间。点击快速加入，自动创建并立即开战。");
  visible("online-directory-trust", !!trustURL);
  if (trustURL) $("online-directory-trust-link").href = trustURL;
  const list = $("online-list");
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.act : null;
  list.replaceChildren();
  const phases = { lobby: "房间准备", countdown: "开战倒计时", live: "对局进行中", over: "等待再战" };
  for (const summary of rooms) {
    const entry = document.createElement("section");
    entry.className = "online-room-entry";
    const info = document.createElement("div");
    const host = document.createElement("b");
    host.textContent = summary.hostName + " 的房间";
    const details = document.createElement("span");
    const roster = summary.modeId === "zombie-coop" ? difficultyLabel(summary.difficulty) : `${difficultyLabel(summary.difficulty)}人机 · ${summary.humans} 真人 / ${summary.bots} 人机`;
    details.textContent = `${summary.mapName || "暮色酒店"} · ${summary.modeName || "团队死斗"} · ${phases[summary.phase]} · ${roster} · ${summary.humans}/${summary.capacity} 席`;
    info.append(host, details);
    const button = document.createElement("button");
    button.className = "btn";
    button.dataset.nav = "";
    button.dataset.act = "online-room:" + summary.room;
    button.dataset.joinable = String(summary.joinable);
    button.disabled = busy || identityAuthBusy || !summary.joinable;
    button.textContent = summary.joinable ? "加入战场 ›" : "真人已满";
    entry.append(info, button);
    list.append(entry);
  }
  if (focused) {
    const next = [...list.querySelectorAll("button")].find((button) => button.dataset.act === focused && !button.disabled);
    (next || $("online-quick")).focus({ preventScroll: true });
  }
}
async function join(mode, roomID) {
  if (!multiplayerEnabled || busy || room) return;
  busy = true;
  const generation = ++joinGeneration;
  setJoinBusy();
  syncDirectory();
  visible("online-error", false);
  visible("online-trust", false);
  status("正在连接战场…");
  try {
    net.checkSupport();
    // Do not capture the pointer over a Toy authorization dialog.
    if (mode === "quick" && (!account.isToy || account.state.authenticated)) engine.prepareDeployment();
    const uid = await authorizePlayer();
    if (generation !== joinGeneration) return;
    matchLoading.begin(mode === 'listed' ? '正在获取房间地图' : onlinePicker.selected?.name,
      mode === 'listed' ? '' : $('online-mode-select').selectedOptions[0]?.textContent);
    if (mode === "quick" && !engine.deploymentRequested) engine.prepareDeployment();
    const config = await loadApiConfig(document.documentElement.dataset.apiOrigin, location.href);
    if (generation !== joinGeneration) return;
    if (query.get("transport") === "webrtc" || document.documentElement.dataset.preferredTransport === "webrtc")
      config.preferredTransport = "webrtc";
    const catalog = await ensureCatalog();
    if (generation !== joinGeneration) return;
    const selection = mode === "listed" ? {} : {
      mapId: onlinePicker.value,
      modeId: $("online-mode-select").value || "tdm",
    };
    if (mode !== "listed" && (!catalog.maps.some((map) => map.id === selection.mapId && map.modes.includes(selection.modeId))))
      throw Error("所选地图与模式当前不可用，请重新选择。");
    await engine.enter(ctx.settings.primary);
    if (generation !== joinGeneration) return;
    roomGeometryReady = false;
    latestSnapshot = null;
    roomSetupPromise = new Promise((resolve, reject) => {
      resolveRoomSetup = resolve;
      rejectRoomSetup = reject;
    });
    roomSetupPromise.catch(() => {});
    const name = account.playerName;
    const hello = joinHello(mode, name, roomID, selection, { uid });
    hello.m200Build = engine.equipCommand(ctx.settings.primary).m200Build;
    hello.rpkBuild = engine.equipCommand(ctx.settings.primary).rpkBuild;
    if (mode !== "listed") hello.difficulty = selection.modeId === 'zombie-coop'
      ? $('online-coop-select').value : ctx.settings.difficulty;
    await net.connect(hello, config);
    if (generation !== joinGeneration) return;
    let setupTimer;
    try {
      await Promise.race([
        roomSetupPromise,
        new Promise((_, reject) => {
          setupTimer = setTimeout(() => reject(Error("等待地图与房间状态超时，请重试。")), 45000);
        }),
      ]);
    } finally {
      clearTimeout(setupTimer);
    }
    await command(engine.equipCommand(ctx.settings.primary));
    if (generation !== joinGeneration) return;
    roomButton.hidden = false;
    menus.pages.pause.querySelector("h1").textContent = "战术菜单";
  } catch (e) {
    if (generation !== joinGeneration) return;
    matchLoading.hide();
    roomContent.reset();
    rejectRoomSetup?.(e);
    resolveRoomSetup = rejectRoomSetup = null;
    error(e.message);
    if (e.trustURL) {
      $("online-trust-link").href = e.trustURL;
      visible("online-trust", true);
    }
    status("连接未完成");
    await net.leave();
    if (generation !== joinGeneration) return;
    disposeRoomAdapters();
    engine.exit();
    room = null;
    renderRoom();
    openRoom();
  } finally {
    if (generation === joinGeneration) {
      busy = false;
      setJoinBusy();
      renderRoom();
      syncDirectory();
    }
  }
}
async function leave() {
  const generation = ++joinGeneration;
  matchLoading.hide();
  rejectRoomSetup?.(new DOMException('已取消进入战场', 'AbortError'));
  engine.cancelDeployment();
  roomContent.reset();
  busy = true;
  setJoinBusy();
  syncDirectory();
  await net.leave();
  if (generation !== joinGeneration) return;
  onlineKills.reset();
  void account.flush();
  disposeRoomAdapters();
  engine.exit();
  engine.resetHotelState({ muteLounge: true });
  toyMenus.render();
  room = null;
  roomGeometryReady = false;
  latestSnapshot = null;
  roomSetupPromise = null;
  resolveRoomSetup = rejectRoomSetup = null;
  busy = false;
  setJoinBusy();
  returnPage = null;
  reportGate.reset();
  roomButton.hidden = dragButton.hidden = true;
  menus.pages.pause.querySelector("h1").textContent = "已暂停";
  visible("online-error", false);
  visible("online-trust", false);
  renderRoom();
  menus.go("main");
  status("已退出房间。空位由人机接替。");
}
const actions = {
  online: () => void openOnlineLobby(),
  training: () => {
    if (room || busy) void leave().then(openTraining);
    else openTraining();
  },
  'training-back': () => menus.back(),
  'training-start': startTraining,
  "online-back": () => menus.back(),
  "online-quick": () => join("quick"),
  "online-create": () => join("create"),
  "online-refresh": () => {
    directory.retry();
    void ensureCatalog().catch(() => {});
  },
  "online-next": () => {
    if (!room || inMatch() || current()?.id !== room.host || !net.writer || !roomGeometryReady) return;
    engine.prepareDeployment();
    matchLoading.begin(room.mapName || room.mapId, room.modeName || room.modeId);
    matchLoading.update(94, '正在等待服务器开战');
    void command({ type: "start" });
  },
  "online-team-a": () => command({ type: "team", team: 0 }),
  "online-team-b": () => command({ type: "team", team: 1 }),
  "online-leave": leave,
  "online-resume": () => resume(),
  "online-drag": () => resume(true),
  "online-gunsmith": () => {
    returnPage = "online";
    menus.go("gunsmith");
  },
};
function renderRoom() {
  setTeamPerspective(page, current()?.team);
  const coop = room?.modeId === "zombie-coop";
  const difficulty = difficultyLabel(room?.difficulty || ctx.settings.difficulty);
  page.querySelector(".online-mode").textContent = room
    ? `${room.mapName || room.mapId} · ${room.modeName || room.modeId} · ${difficulty}${coop ? "" : "人机"}`
    : "选择地图与模式，创建或快速加入";
  visible("online-connect", !room);
  visible('online-maps', !room);
  setJoinBusy();
  visible("online-hall", !room);
  syncDirectory();
  for (const id of ["online-room", "online-roster", "online-leave"])
    visible(id, !!room);
  if (!room) {
    label("online-section", "公共房间大厅");
    label("online-members", "房间规则");
    status($("online-mode-select").value === "zombie-coop" ? "选择难度，创建房间或快速开始行动。" : "快速加入或在大厅选择房间，空位自动补齐人机。");
    return;
  }
  const me = current(),
    active = inMatch();
  if (menus.page === "online") menus.root.dataset.bg = "dim";
  const humans = room.players.filter((p) => !p.bot).length;
  label("online-section", active ? "公开战场" : "房间编队");
  label("online-members", coop ? `${humans} / ${room.capacity} 干员` : `${humans} 真人 / ${room.players.filter(p => p.bot).length} 人机`);
  page.querySelector('#online-roster .sech span:last-child').textContent = coop ? '最多四人合作' : '真人优先 · 自动补位';
  page.querySelector('.online-fill').textContent = coop ? '中途加入将在下一轮整备入场。' : '人机自动就绪 · 真人加入时替换人机 · 断线后由人机暂时代打';
  label(
    "online-phase",
    active ? "对局进行中" : room.phase === "over" ? "对局战绩" : "编队准备",
  );
  const table = $("online-teams");
  table.replaceChildren();
  const teams = modeAdapter(room.modeAdapter)?.lobby?.(room) ||
    Array.from({ length: room.teamCount }, (_, id) => ({ id, name: `队伍 ${id + 1}`, capacity: room.teamSize }));
  for (const { id: team, name: teamName, capacity } of teams) {
    const section = document.createElement("section");
    section.className = "t" + team;
    const heading = document.createElement("div");
    heading.className = "th";
    const title = document.createElement("b");
    title.textContent = teamName;
    const score = document.createElement("em");
    score.textContent =
      active || room.phase === "over" ? room.scores[team] : `${room.players.filter(p => p.team === team).length} / ${capacity}`;
    heading.append(title, score);
    section.append(heading);
    for (const [index, p] of room.players
      .filter((p) => p.team === team)
      .entries()) {
      const row = document.createElement("div");
      row.className = "rw online-member" + (p.id === net.id ? " me" : "");
      const n = document.createElement("span");
      n.textContent = String(index + 1).padStart(2, "0");
      const name = document.createElement("span");
      name.textContent = p.name + (p.id === net.id ? "（你）" : "");
      const state = document.createElement("span");
      state.textContent =
        active || room.phase === "over"
          ? p.kills + " / " + p.deaths
          : p.bot
            ? "人机 · 就绪"
            : !p.connected
              ? "人机代打"
              : "在线";
      const role = document.createElement("small");
      role.textContent =
        p.id === room.host ? "房主" : p.bot ? "自动补位" : "真人干员";
      name.append(role);
      row.append(n, name, state);
      section.append(row);
    }
    table.append(section);
  }
  const isHost = me?.id === room.host;
  visible("online-next", !active && isHost);
  $("online-next").querySelector("b").textContent = room.phase === "over" ? "再来一局" : "开始对局";
  $("online-next").querySelector("em").textContent = coop ? "房主开始 · 进入行动 ›" : "房主开战 · 空位人机补齐 ›";
  $("online-next").disabled = busy || !roomGeometryReady;
  visible("online-resume", active);
  for (const [index, id] of ["online-team-a", "online-team-b"].entries()) {
    const team = teams[index];
    visible(id, !coop && !!team);
    $(id).disabled = active;
    if (team) $(id).textContent = `加入${team.name}`;
  }
  visible("online-result", room.phase === "over");
  if (room.phase === "over")
    label(
      "online-result",
      coop ? room.modeState?.result || "行动结束" : room.winner < 0
        ? "平局"
        : room.winner === me?.team
          ? "任务完成 · 胜利"
          : "任务结束 · 再战",
    );
  status(
    coop ? active ? "行动进行中。" : isHost ? "准备好后，点击开始对局。" : "等待房主开始对局。" : active
      ? "战场持续运行，空位由人机补齐。"
      : isHost ? "等待编队完成后，点击开始对局；空位由人机补齐。" : "等待房主开始对局；空位由人机补齐。",
  );
}
net.addEventListener("status", ({ detail }) => {
  status(detail);
  if (detail.includes("中断")) matchLoading.hide();
  if (detail.includes("中断") && inMatch()) engine.pause();
});
net.addEventListener("error", ({ detail }) => error(detail));
net.addEventListener("event", ({ detail: e }) => {
  engine.event(e);
  const coopEvent = e.modeId === 'zombie-coop' || room?.modeId === 'zombie-coop';
  const settlement = coopEvent ? undefined : onlineKills.event(e, net.id);
  if (e.type === "error") {
    matchLoading.hide();
    if (!engine.roundStarted) engine.cancelDeployment();
    return error(e.message);
  }
  if (e.type === "welcome") visible("online-error", false);
  if (e.type === "room") {
    room = e;
    if (matchLoading.active || (inMatch() && !engine.roundStarted))
      matchLoading.begin(room.mapName || room.mapId, room.modeName || room.modeId);
    void setupRoomWorld(e, joinGeneration);
    renderRoom();
    const me = room.players.find((player) => player.id === net.id);
    if (engine.active && me && (room.modeId !== "defusal" || room.modeState?.matchFinished) && reportGate.claim(room)) {
      const match = ctx.match;
      match.scores = room.scores;
      match.scoreLimit = room.scoreLimit || 40;
      for (const player of room.players) {
        const actor = engine.actor(player.id);
        if (!actor) continue;
        Object.assign(actor, {
          name: player.name,
          team: player.team,
          kills: player.kills,
          deaths: player.deaths,
          score: player.score,
        });
      }
      const outcome = room.winner < 0 ? -1 : room.winner === me.team ? 0 : 1;
      engine.finishRound(outcome, settlement?.award);
    }
  }
});
net.addEventListener("snapshot", ({ detail: s }) => {
  if (!roomGeometryReady) {
    latestSnapshot = s;
    return;
  }
  engine.snapshot(s);
  finishMatchLoading();
  if (room) {
    room.scores = s.scores;
    for (const p of s.players) {
      const member = room.players.find((q) => q.id === p.id);
      if (member) {
        member.kills = p.kills;
        member.deaths = p.deaths;
        member.score = p.score;
      }
    }
    if (performance.now() - lastRosterAt > 500) {
      lastRosterAt = performance.now();
      if (menus.page === "online") renderRoom();
      if (menus.page === "pause") menus._refreshPause();
    }
  }
});
engine.addEventListener("lockerror", () => {
  dragButton.hidden = false;
  if (!inMatch()) return;
  menus.pages.pause.querySelector('[data-act="resume"] em').textContent = "点击后锁定鼠标 ›";
  ctx.hud.hint("点击「继续」锁定鼠标并返回战场；受限窗口可选择「拖动瞄准」。", 7);
});
engine.addEventListener("lockneeded", () => {
  dragButton.hidden = false;
  if (!engine.active || engine.gh.G.state !== "playing") return;
  ctx.hud.hint("点击画面开始瞄准 · Esc 打开战术菜单", 10);
});
engine.addEventListener("lock", ({ detail: locked }) => {
  if (locked) menus.pages.pause.querySelector('[data-act="resume"] em').textContent = "›";
  if (!locked && inMatch() && engine.gh.G.state === "playing") engine.pause();
});
if (multiplayerEnabled) setInterval(() => {
  if (net.writer) command({ type: "ping", nonce: performance.now() });
}, 1500);
if (multiplayerEnabled && query.has("pvp")) void openOnlineLobby();
