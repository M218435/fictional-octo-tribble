import { emptyProfile, profile, profileDelta, same, loadout, maxProfile } from "./progress-ledger.js";

// Native rR/yI/vI remain the source of rank, XP, weapon mastery and camo rules.
// Authenticated saves go to account-scoped pending components, never the guest key.
export function installNativeProgress({ gh, account, bridge = globalThis.GHProgress }) {
  if (!bridge) throw Error("原型缺少成长存档接入，请重新运行 optimize。");
  const menus = gh.debug.ctx.hud.menus;
  let applying = false, pending = 0, epoch = 0, wasReady = false;
  const initialProfile = bridge.readProfile();
  const oldProfileHasProgress = initialProfile.xp > 0 || initialProfile.kills > 0 || initialProfile.matches > 0 ||
    Object.values(initialProfile.weapons ?? {}).some(weapon => (weapon?.kills ?? 0) > 0);
  const legacyWhenMissing = initialProfile.allAttachmentsUnlocked === undefined &&
    (bridge.savedProfileAtStartup === true || oldProfileHasProgress);
  let baseline = profile(initialProfile, { legacyWhenMissing });
  if (!same(initialProfile, baseline)) bridge.writeProfile(baseline);
  let legacy = structuredClone(baseline), restoringGuest = false;
  let guestLoadout = loadout(bridge.readLoadout());
  let allowWeapon = () => true;
  function refreshMenus() {
    if (!menus.root?.classList.contains("hidden")) {
      if (menus.page === "main") menus._refreshMain();
      if (menus.page === "gunsmith") menus._gsRender(false);
    }
  }
  function apply() {
    if (applying || pending || account.state.status !== "ready" || !account.state.progress) return;
    applying = true;
    try {
      baseline = profile(account.state.progress);
      bridge.writeProfile(baseline);
      if (account.state.loadout) {
        const saved = loadout(account.state.loadout);
        const effective = { ...saved, primary: allowWeapon(saved.primary) ? saved.primary : "ar" };
        if (!same(effective, bridge.readLoadout())) bridge.writeLoadout(effective);
      }
      refreshMenus();
    } finally { applying = false; }
  }
  function track(operation) {
    const token = epoch;
    pending++;
    Promise.resolve(operation).catch(() => {}).finally(() => {
      if (token !== epoch) return;
      pending--;
      apply();
    });
  }
  function recordWeaponChallenges(weapon, challenge) {
    if (!challenge || typeof challenge !== "object") return false;
    const next = profile(bridge.readProfile());
    const stats = next.weapons[weapon];
    if (!stats) return false;
    let changed = false;
    for (const [field, key] of [["adsKills", "ads"], ["hipfireKills", "hipfire"], ["longshots", "longshot"], ["multikills", "multikill"]]) {
      if (challenge[key] === true) { stats[field]++; changed = true; }
    }
    if (!changed) return false;
    bridge.writeProfile(next);
    bridge.persist?.(bridge.profileKey, next);
    return true;
  }
  bridge.persist = (key, value) => {
    if (applying) return true;
    if (key !== bridge.profileKey && key !== bridge.buildKey) return false;
    if (account.state.status !== "ready") {
      if (key === bridge.profileKey) { baseline = profile(value); legacy = structuredClone(baseline); }
      else guestLoadout = loadout(bridge.readLoadout());
      return false;
    }
    // Only a successfully restored identity owns new cloud progress. Failed
    // authorization/baseline reads continue as a separately importable guest save.
    if (key === bridge.profileKey) {
      const next = profile(value), delta = profileDelta(next, baseline);
      baseline = next;
      if (!same(delta, emptyProfile())) track(account.recordProgress(delta));
    } else track(account.saveLoadout(bridge.readLoadout()));
    return true;
  };
  account.addEventListener("change", () => {
    if (account.state.status === "authorizing") {
      if (wasReady) {
        epoch++; pending = 0; wasReady = false; restoringGuest = true;
        applying = true;
        try { baseline = structuredClone(legacy); bridge.writeProfile(baseline); bridge.writeLoadout({ ...guestLoadout, primary: "ar" }); refreshMenus(); }
        finally { applying = false; }
      }
      return;
    }
    if (account.state.status === "ready") { wasReady = true; restoringGuest = false; apply(); }
    else if (account.state.status !== "authorizing" && (wasReady || restoringGuest)) {
      epoch++; pending = 0; wasReady = false; restoringGuest = false;
      applying = true;
      try { baseline = structuredClone(legacy); bridge.writeProfile(baseline); bridge.writeLoadout({ ...guestLoadout, primary: "ar" }); refreshMenus(); }
      finally { applying = false; }
    }
  });
  const equip = menus._gsEquip;
  menus._gsEquip = function (...args) {
    const before = bridge.readLoadout().primary;
    const result = equip.apply(this, args);
    if (before !== bridge.readLoadout().primary) {
      if (account.state.status === "ready") track(account.saveLoadout(bridge.readLoadout()));
      else guestLoadout = loadout(bridge.readLoadout());
    }
    return result;
  };
  return {
    get legacy() { return structuredClone(legacy); },
    get hasLegacy() { return (legacy.xp > 0 || legacy.kills > 0 || legacy.matches > 0) && (!account.progress.ready || !same(maxProfile(legacy, account.progress.legacy), account.progress.legacy)); },
    importLegacy: async () => { await account.importLegacy(legacy); await account.saveLoadout(guestLoadout); apply(); await account.flush(); },
    setWeaponPolicy(policy) { allowWeapon = policy; apply(); },
    refresh: apply,
    kill(weapon, head, delta = 1, challenge = null) {
      // A gap's missing kills cannot truthfully be attributed to the last weapon.
      if (delta > 1) {
        const next = profile(bridge.readProfile()); next.kills += delta - 1;
        bridge.writeProfile(next); bridge.persist(bridge.profileKey, next);
      }
      if (["ar", "smg", "shotgun", "pistol", "m200", "rpk"].includes(weapon)) {
        const beforeChallenges = structuredClone(bridge.readProfile().weapons[weapon]);
        const unlocked = bridge.recordKill(weapon, !!head, delta === 1 ? challenge : null);
        for (const camo of unlocked) gh.debug.ctx.hud.unlock?.(weapon, camo);
        const afterChallenges = bridge.readProfile().weapons[weapon];
        const handled = challenge && ["adsKills", "hipfireKills", "longshots", "multikills"].some(key => afterChallenges[key] !== beforeChallenges[key]);
        if (!handled && delta === 1) recordWeaponChallenges(weapon, challenge);
        this.onChallengesChanged?.();
      } else {
        const next = profile(bridge.readProfile()); next.kills++;
        bridge.writeProfile(next); bridge.persist(bridge.profileKey, next);
      }
    },
    challengeKill(weapon, challenge) {
      if (["ar", "smg", "shotgun", "pistol", "m200", "rpk"].includes(weapon)) {
        recordWeaponChallenges(weapon, challenge);
        this.onChallengesChanged?.();
      }
    },
    finish(score, won) {
      const result = bridge.awardMatch(score, won);
      this.onChallengesChanged?.();
      return result;
    },
  };
}
