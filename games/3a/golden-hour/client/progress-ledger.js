// Toy's cloud has no compare-and-swap. Each browser owns a grow-only component;
// aggregate counters add components, while the one-time legacy baseline takes max.
export const GROWTH_PREFIX = "gh_growth_v1_";
export const LEGACY_KEY = "gh_growth_legacy_v1";
export const LOADOUT_KEY = "gh_loadout_v1";
export const LEGACY_PREFIX = "gh_legacy_v1_";
export const LOADOUT_PREFIX = "gh_loadout_v1_";
export const WEAPON_IDS = ["ar", "smg", "shotgun", "pistol", "m200", "rpk"];
const COUNTERS = ["xp", "matches", "wins", "kills"];
const PARTS = ["optic", "muzzle", "underbarrel", "magazine", "stock", "camo"];
const ATTACHMENT_COUNTERS = ["adsKills", "hipfireKills", "longshots", "multikills"];
const clone = value => JSON.parse(JSON.stringify(value));
const number = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw Error("invalid progress counter");
  return value;
};
export function emptyProfile() {
  const weapons = Object.fromEntries(WEAPON_IDS.map(id => [id, {
    kills: 0, headshots: 0, ...Object.fromEntries(ATTACHMENT_COUNTERS.map(field => [field, 0])),
  }]));
  return { xp: 0, matches: 0, wins: 0, kills: 0, allAttachmentsUnlocked: false, weapons };
}
export function profile(value, { legacyWhenMissing = false } = {}) {
  if (!value || typeof value !== "object" || !value.weapons) throw Error("invalid progress");
  const out = emptyProfile();
  for (const field of COUNTERS) out[field] = number(value[field]);
  if (value.allAttachmentsUnlocked !== undefined && typeof value.allAttachmentsUnlocked !== "boolean") throw Error("invalid attachment entitlement");
  out.allAttachmentsUnlocked = value.allAttachmentsUnlocked ?? legacyWhenMissing;
  for (const id of WEAPON_IDS) {
    const weapon = value.weapons[id] ?? { kills: 0, headshots: 0 };
    out.weapons[id] = {
      kills: number(weapon?.kills), headshots: number(weapon?.headshots),
      ...Object.fromEntries(ATTACHMENT_COUNTERS.map(field => [field, number(weapon?.[field] ?? 0)])),
    };
    if (weapon.headshots > weapon.kills) throw Error("invalid headshots");
  }
  if (out.wins > out.matches || WEAPON_IDS.reduce((n, id) => n + out.weapons[id].kills, 0) > out.kills) throw Error("inconsistent progress");
  return out;
}
function combine(a, b, operation) {
  const out = emptyProfile();
  for (const field of COUNTERS) out[field] = operation(a[field], b[field]);
  out.allAttachmentsUnlocked = a.allAttachmentsUnlocked || b.allAttachmentsUnlocked;
  for (const id of WEAPON_IDS) for (const field of ["kills", "headshots", ...ATTACHMENT_COUNTERS]) out.weapons[id][field] = operation(a.weapons[id][field], b.weapons[id][field]);
  return profile(out);
}
export const addProfile = (a, b) => combine(a, b, (x, y) => number(x + y));
export const maxProfile = (a, b) => {
  // Divergent legacy saves can contain kills earned with different weapons.
  // Preserve both mastery high-water marks and keep the aggregate consistent.
  const totalKills = WEAPON_IDS.reduce((n, id) => n + Math.max(a.weapons[id].kills, b.weapons[id].kills), 0);
  return combine({ ...a, kills: Math.max(a.kills, totalKills) }, b, Math.max);
};
export const profileDelta = (after, before) => {
  const delta = combine(after, before, (x, y) => Math.max(0, x - y));
  delta.allAttachmentsUnlocked = after.allAttachmentsUnlocked && !before.allAttachmentsUnlocked;
  return delta;
};
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function loadout(value) {
  if (!value || !["ar", "smg", "shotgun", "m200", "rpk"].includes(value.primary) || !value.builds || typeof value.builds !== "object") throw Error("invalid loadout");
  const builds = {};
  for (const id of WEAPON_IDS) {
    const build = {};
    for (const part of PARTS) {
      const choice = value.builds[id]?.[part];
      if (choice !== undefined) {
        if (typeof choice !== "string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(choice)) throw Error("invalid attachment");
        build[part] = choice;
      }
    }
    builds[id] = build;
  }
  return { primary: value.primary, builds };
}
function pack(value) {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > 1024) throw Error("progress exceeds Toy value limit");
  return text;
}
function readProfile(raw) {
  const data = JSON.parse(raw);
  if (data.v !== 1) throw Error("unsupported progress schema");
  return profile(data.p, { legacyWhenMissing: true });
}
function readLoadout(raw) {
  if (raw === undefined) return null;
  const data = JSON.parse(raw);
  if (data.v !== 1 || !Number.isSafeInteger(data.at) || data.at < 0 || typeof data.device !== "string") throw Error("invalid loadout revision");
  return { v: 1, at: data.at, device: data.device, value: loadout(data.value) };
}
function newest(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.at > b.at || a.at === b.at && a.device >= b.device ? a : b;
}

export class ProgressLedger {
  constructor(storage) { this.storage = storage; this.reset(); }
  reset() {
    this.ready = false;
    this.key = this.localKey = null;
    this.own = emptyProfile();
    this.legacyOwn = emptyProfile();
    this.legacyCloud = emptyProfile();
    this.components = new Map();
    this.loadouts = new Map();
    this.preferencesOwn = null;
    this.data = {};
    this.warning = "";
  }
  open({ identity, component, data }) {
    this.reset();
    this.component = component;
    this.key = GROWTH_PREFIX + component;
    this.legacyKey = LEGACY_PREFIX + component;
    this.loadoutKey = LOADOUT_PREFIX + component;
    this.localKey = identity ? `gh_growth_pending_v1_${encodeURIComponent(identity)}_${component}` : null;
    this.mergeCloud(data);
    this.mergeLocal();
    this.ready = true;
    this.persist();
  }
  mergeLocal() {
    let raw;
    try { raw = this.localKey && this.storage?.getItem(this.localKey); } catch { this.warning = "本地待同步存档读取失败。"; }
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.v !== 1) throw Error("unsupported pending progress");
    this.own = maxProfile(this.own, profile(saved.own, { legacyWhenMissing: true }));
    this.legacyOwn = maxProfile(this.legacyOwn, profile(saved.legacy, { legacyWhenMissing: true }));
    this.preferencesOwn = newest(this.preferencesOwn, saved.preferences ? readLoadout(JSON.stringify(saved.preferences)) : null);
  }
  mergeCloud(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("invalid cloud progress");
    const components = new Map(), loadouts = new Map();
    let legacy = data[LEGACY_KEY] === undefined ? emptyProfile() : readProfile(data[LEGACY_KEY]);
    for (const [key, raw] of Object.entries(data)) {
      if (key.startsWith(GROWTH_PREFIX)) components.set(key, readProfile(raw));
      if (key.startsWith(LEGACY_PREFIX)) legacy = maxProfile(legacy, readProfile(raw));
      if (key.startsWith(LOADOUT_PREFIX)) loadouts.set(key, readLoadout(raw));
    }
    if (data[LOADOUT_KEY]) loadouts.set(LOADOUT_KEY, readLoadout(data[LOADOUT_KEY]));
    const own = maxProfile(this.own, components.get(this.key) ?? emptyProfile());
    const legacyOwn = maxProfile(this.legacyOwn, data[this.legacyKey] === undefined ? emptyProfile() : readProfile(data[this.legacyKey]));
    let total = addProfile(maxProfile(legacy, legacyOwn), own);
    for (const [key, value] of components) if (key !== this.key) total = addProfile(total, value);
    // Commit only after validating the whole restored aggregate. A later bad
    // cloud read must not corrupt the last usable in-page/pending snapshot.
    this.components = components;
    this.loadouts = loadouts;
    this.own = own;
    this.legacyCloud = legacy;
    this.legacyOwn = legacyOwn;
    this.preferencesOwn = newest(this.preferencesOwn, loadouts.get(this.loadoutKey));
    this.data = data;
  }
  get legacy() { return maxProfile(this.legacyCloud, this.legacyOwn); }
  get preferences() {
    let selected = this.preferencesOwn;
    for (const value of this.loadouts.values()) selected = newest(selected, value);
    return selected;
  }
  total(own = this.own, legacyOwn = this.legacyOwn) {
    let out = addProfile(maxProfile(this.legacyCloud, legacyOwn), own);
    for (const [key, value] of this.components) if (key !== this.key) out = addProfile(out, value);
    return out;
  }
  record(delta) {
    if (!this.ready) return false;
    this.mergeLocal();
    const next = addProfile(this.own, profile(delta));
    this.total(next);
    this.own = next;
    this.persist();
    return true;
  }
  importLegacy(value) {
    this.mergeLocal();
    const next = maxProfile(this.legacyOwn, profile(value));
    this.total(this.own, next);
    this.legacyOwn = next;
    this.persist();
  }
  saveLoadout(value, now = Date.now()) {
    this.mergeLocal();
    const next = loadout(value);
    if (same(next, this.preferences?.value)) return;
    const revision = { v: 1, at: Math.max(now, (this.preferences?.at ?? 0) + 1), device: this.component, value: next };
    pack(revision);
    this.preferencesOwn = revision;
    this.persist();
  }
  writes() {
    if (!this.ready) return {};
    const writes = {};
    if (!same(this.own, this.components.get(this.key) ?? emptyProfile())) writes[this.key] = pack({ v: 1, p: this.own });
    const legacy = this.data[this.legacyKey] === undefined ? emptyProfile() : readProfile(this.data[this.legacyKey]);
    if (!same(this.legacyOwn, legacy)) writes[this.legacyKey] = pack({ v: 1, p: this.legacyOwn });
    if (this.preferencesOwn && !same(this.preferencesOwn, this.loadouts.get(this.loadoutKey) ?? null)) writes[this.loadoutKey] = pack(this.preferencesOwn);
    return writes;
  }
  pending() { return Object.keys(this.writes()).length > 0; }
  persist() {
    if (!this.localKey || !this.storage) return;
    try {
      this.storage.setItem(this.localKey, JSON.stringify({ v: 1, own: this.own, legacy: this.legacyOwn, preferences: this.preferencesOwn }));
    } catch { this.warning = "本地存储不可用，未同步进度仅在当前页面保留，请在离开前同步云档。"; }
  }
  snapshot() { return clone(this.total()); }
}
