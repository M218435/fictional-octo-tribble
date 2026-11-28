// The first choice in each slot is the factory configuration. Every later
// choice is earned with that weapon, so mastery never transfers between guns.
const CHOICES = Object.freeze({
  ar: { optic: ["reflex", "irons", "holo", "prism"], muzzle: ["none", "suppressor", "comp", "brake"], underbarrel: ["none", "vgrip", "angled", "laser"], magazine: ["std", "ext", "fast"], stock: ["std", "light", "heavy"] },
  smg: { optic: ["irons", "reflex", "holo"], muzzle: ["none", "suppressor", "comp"], underbarrel: ["none", "vgrip", "laser"], magazine: ["std", "ext", "fast"], stock: ["std", "light"] },
  shotgun: { optic: ["irons", "reflex"], muzzle: ["none", "choke", "brake"], underbarrel: ["none", "laser"], magazine: ["std", "ext"], stock: ["std", "heavy"] },
  pistol: { optic: ["irons", "reflex"], muzzle: ["none", "suppressor", "comp"], underbarrel: ["none", "laser"], magazine: ["std", "ext"], stock: [] },
  m200: { optic: ["m200scope", "m200prism", "m200long"], muzzle: ["none", "m200quiet", "m200brake"], underbarrel: ["m200bipod", "m200fold", "m200light"], magazine: ["std", "m200ext", "m200fast"], stock: ["std", "m200stocklight", "m200padded"] },
  rpk: { optic: ["irons", "rpkprism", "rpkscope"], muzzle: ["none", "rpkbrake", "rpkquiet"], underbarrel: ["rpkbipod", "rpkfold"], magazine: ["rpk40", "rpk75", "rpkfast"], stock: ["rpkwood", "rpkfoldstock"] },
});

const KILL_SCALE = Object.freeze({ ar: 1, smg: .95, shotgun: .8, pistol: .9, m200: .55, rpk: 1.05 });
const LABELS = Object.freeze({
  kills: "击杀", headshots: "爆头", adsKills: "ADS 击杀", hipfireKills: "腰射击杀",
  longshots: "远距离击杀", multikills: "短时间连杀", wins: "胜利对局",
});
const DEFAULTS = Object.freeze({ optic: "irons", muzzle: "none", underbarrel: "rpkbipod", magazine: "rpk40", stock: "rpkwood" });
const WEAPON_NAMES = Object.freeze({ ar: "突击步枪", smg: "冲锋枪", shotgun: "霰弹枪", pistol: "手枪", m200: "狙击枪", rpk: "轻机枪" });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function challengeFor(weapon, slot, variant) {
  const kills = Math.ceil((8 + (variant - 1) * 8) * KILL_SCALE[weapon]);
  const need = { kills };
  if (slot === "optic") {
    if (weapon === "m200") need.longshots = 3 + (variant - 1) * 3;
    else need.adsKills = 4 + (variant - 1) * 4;
  } else if (slot === "muzzle") {
    if (variant % 2) need.multikills = 2 + Math.floor((variant - 1) / 2) * 2;
    else need.headshots = 4 + (variant - 1) * 3;
  } else if (slot === "underbarrel") {
    need.hipfireKills = 4 + (variant - 1) * 3;
  } else if (slot === "magazine") {
    need.headshots = 3 + (variant - 1) * 3;
    if (variant > 1) need.wins = 1;
  } else if (slot === "stock") {
    need.longshots = 3 + (variant - 1) * 3;
  }
  return Object.freeze({ weapon, slot, need: Object.freeze(need) });
}

const ATTACHMENTS = Object.freeze(Object.fromEntries(Object.entries(CHOICES).map(([weapon, slots]) => [
  weapon,
  Object.freeze(Object.fromEntries(Object.entries(slots).flatMap(([slot, choices]) =>
    choices.slice(1).map((id, index) => [id, challengeFor(weapon, slot, index + 1)])))),
])));

const CAMOS = Object.freeze({
  dune: { kills: 5 },
  timberline: { kills: 15, hipfireKills: 5 },
  fracture: { kills: 25, adsKills: 8 },
  tigerstripe: { kills: 25, headshots: 8 },
  topo: { kills: 45, headshots: 12, longshots: 8 },
  carbon: { kills: 60, hipfireKills: 10, multikills: 8 },
  damascus: { kills: 90, longshots: 18, multikills: 10 },
  gold: { kills: 120, headshots: 25, adsKills: 30 },
  obsidian: { kills: 160, allAttachments: true, gold: true, wins: 5 },
});

function metrics(profile, weapon) { return profile?.weapons?.[weapon] ?? {}; }
function attachmentCount(profile, weapon) {
  const ids = Object.keys(ATTACHMENTS[weapon] ?? {});
  const unlocked = ids.filter(id => attachmentStatus(profile, weapon, id).done).length;
  return { unlocked, total: ids.length };
}

function status(profile, weapon, need) {
  const stats = metrics(profile, weapon), parts = [], ratios = [];
  for (const [key, amount] of Object.entries(need)) {
    if (key === "allAttachments") {
      const { unlocked, total } = attachmentCount(profile, weapon);
      parts.push(`${unlocked}/${total} 个配件`); ratios.push(total ? unlocked / total : 1);
    } else if (key === "gold") {
      const gold = status(profile, weapon, CAMOS.gold);
      parts.push(gold.done ? "黄金迷彩已解锁" : "先解锁黄金迷彩"); ratios.push(gold.done ? 1 : 0);
    } else {
      const current = Math.min((key === "wins" ? profile?.wins : stats[key]) ?? 0, amount);
      parts.push(`${current}/${amount} ${LABELS[key]}`);
      ratios.push(Math.min(1, current / amount));
    }
  }
  return { done: ratios.every(value => value >= 1), t: ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : 1, text: parts.join(" · ") };
}

function attachmentStatus(profile, weapon, id) {
  if (profile?.allAttachmentsUnlocked === true) return { done: true, t: 1, text: "老玩家已解锁" };
  const challenge = ATTACHMENTS[weapon]?.[id];
  return challenge ? status(profile, weapon, challenge.need) : { done: true, t: 1, text: "原厂配置" };
}

export function weaponChallengeCatalog() { return { choices: CHOICES, attachments: ATTACHMENTS, camos: CAMOS }; }
export function weaponAttachmentStatus(profile, weapon, id) { return attachmentStatus(profile, weapon, id); }
export function sanitizeWeaponBuild(profile, weapon, build = {}) {
  const next = { ...build };
  for (const [slot, choices] of Object.entries(CHOICES[weapon] ?? {})) {
    const fallback = choices[0];
    if (ATTACHMENTS[weapon]?.[next[slot]] && !attachmentStatus(profile, weapon, next[slot]).done) next[slot] = fallback;
  }
  return next;
}
export function rpkChallengeCatalog() { return { attachments: ATTACHMENTS.rpk, camos: CAMOS }; }
export function rpkAttachmentStatus(profile, id) { return attachmentStatus(profile, "rpk", id); }
export function rpkCamoStatus(profile, id) {
  if (id === "factory") return { done: true, t: 1, text: "原厂涂装" };
  return CAMOS[id] ? status(profile, "rpk", CAMOS[id]) : null;
}

export function installWeaponChallenges({ gh, progression, bridge = globalThis.GHProgress }) {
  if (!bridge) throw Error("缺少成长存档接入，无法安装武器配件挑战。");
  const menus = gh.debug.ctx.hud.menus;
  const challengeAPI = {
    attachmentStatus(weapon, id) { return attachmentStatus(bridge.readProfile(), weapon, id); },
    attachment(weapon, id) { return ATTACHMENTS[weapon]?.[id] ?? null; },
    canUseAttachment(weapon, id) { return attachmentStatus(bridge.readProfile(), weapon, id).done; },
    camo(weapon, id) {
      if (weapon !== "rpk") return null;
      if (id === "factory") return { done: true, t: 1, text: "原厂涂装" };
      return CAMOS[id] ? status(bridge.readProfile(), weapon, CAMOS[id]) : null;
    },
    sanitize(weapon, build = {}) {
      return sanitizeWeaponBuild(bridge.readProfile(), weapon, build);
    },
  };
  globalThis.GHWeaponChallenges = challengeAPI;
  globalThis.GHRPKChallenges = challengeAPI;

  // Imported builds may come from another device or an older version. Check
  // every gun before the renderer can equip or send one to the match server.
  const saved = bridge.readLoadout();
  const builds = { ...saved.builds };
  let changed = false;
  for (const weapon of Object.keys(CHOICES)) {
    const safe = challengeAPI.sanitize(weapon, builds[weapon]);
    if (JSON.stringify(safe) !== JSON.stringify(builds[weapon])) changed = true;
    builds[weapon] = safe;
  }
  if (changed) bridge.writeLoadout({ ...saved, builds });

  const render = menus._gsRender;
  menus._gsRender = function (...args) {
    const result = render.apply(this, args);
    const weapon = this.gs?.w;
    if (!ATTACHMENTS[weapon] || this.gs.mode !== "att") return result;
    const options = this.pages.gunsmith.querySelector("#gs-opts");
    for (const button of options.querySelectorAll(".opt[data-id]")) {
      const challenge = challengeAPI.attachment(weapon, button.dataset.id);
      const detail = button.querySelector(".gh-challenge");
      if (!challenge) {
        button.classList.remove("gh-locked");
        detail?.remove();
        continue;
      }
      const progress = challengeAPI.attachmentStatus(weapon, button.dataset.id);
      button.classList.toggle("gh-locked", !progress.done);
      button.setAttribute("aria-label", `${button.querySelector(".on-n")?.textContent ?? "配件"}；${progress.done ? "已解锁" : `未解锁：${progress.text}`}`);
      const equipped = button.querySelector(".eqd");
      if (equipped) equipped.textContent = button.classList.contains("on") ? "EQUIPPED" : progress.done ? "UNLOCKED" : "LOCKED";
      let challengeDetail = detail;
      if (!progress.done) {
        if (!challengeDetail) { challengeDetail = document.createElement("div"); challengeDetail.className = "gh-challenge"; button.append(challengeDetail); }
        challengeDetail.textContent = `解锁挑战（${WEAPON_NAMES[weapon]}）：${progress.text}`;
      } else challengeDetail?.remove();
    }
    return result;
  };

  const pick = menus._gsPick;
  menus._gsPick = function (id, ...args) {
    const weapon = this.gs?.w;
    const challenge = challengeAPI.attachment(weapon, id);
    if (challenge) {
      const progress = challengeAPI.attachmentStatus(weapon, id);
      if (!progress.done) {
        this.cb.sound("error");
        this._gsConfirm(`配件未解锁 · ${progress.text}`);
        return;
      }
    }
    return pick.call(this, id, ...args);
  };

  const refresh = () => { if (menus.page === "gunsmith") menus._gsRender(false); };
  const onProgress = progression.onChallengesChanged;
  progression.onChallengesChanged = () => { onProgress?.(); refresh(); };
  if (menus.page === "gunsmith") menus._gsRender(false);
  return challengeAPI;
}

export const installRPKChallenges = installWeaponChallenges;
