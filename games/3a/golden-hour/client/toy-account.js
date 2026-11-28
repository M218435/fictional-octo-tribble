import { ProgressLedger } from "./progress-ledger.js";

const CLOUD_PREFIX = "gh_kills_v1_";
const COMPONENT_KEY = "gh_toy_component_v1";
const LOCAL_PREFIX = "gh_toy_pending_v1_";
const SDK_URL = "https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js";
const MAX_SCORE = 16777215;
export const DEFAULT_PLAYER_NAME = "干员";
const loaders = new WeakMap();

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
function randomComponent() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw Error("random unavailable");
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function toyURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "www.bilibilitoy.com" ||
      ((url.hostname === "bilibili.com" || url.hostname.endsWith(".bilibili.com")) && /^\/toy(?:\/|$)/.test(url.pathname)));
  } catch { return false; }
}
function inToy(window, document) {
  return [window?.location?.href, document?.referrer, ...Array.from(window?.location?.ancestorOrigins ?? [])].some(toyURL);
}
function loadSDK(window, document) {
  if (window?.toy) return Promise.resolve(window.toy);
  if (!document?.createElement) return Promise.reject(Error("document unavailable"));
  if (loaders.has(document)) return loaders.get(document);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const finish = (error) => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else resolve(window.toy);
    };
    const timer = setTimeout(() => finish(Error("SDK timeout")), 15000);
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => finish(window.toy ? null : Error("SDK unavailable"));
    script.onerror = () => finish(Error("SDK load failed"));
    try { (document.head ?? document.documentElement).appendChild(script); } catch (error) { finish(error); }
  });
  loaders.set(document, promise);
  promise.catch(() => loaders.delete(document));
  return promise;
}
function counts(value) {
  if (!value || !Number.isSafeInteger(value.online) || value.online < 0 ||
      !Number.isSafeInteger(value.training) || value.training < 0 ||
      !Number.isSafeInteger(value.online + value.training)) throw Error("invalid ledger");
  return { online: value.online, training: value.training };
}
function merge(a, b) {
  return { online: Math.max(a.online, b.online), training: Math.max(a.training, b.training) };
}
function equal(a, b) { return a.online === b.online && a.training === b.training; }
function cloudComponents(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("invalid cloud storage");
  const components = new Map();
  let online = 0, training = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(CLOUD_PREFIX)) continue;
    if (typeof value !== "string") throw Error("invalid cloud component");
    const component = counts(JSON.parse(value));
    online += component.online;
    training += component.training;
    counts({ online, training });
    components.set(key, component);
  }
  return components;
}
function errorText(stage, error) {
  if (error?.type === "not_logged_in" || String(error?.code ?? "") === "-101")
    return "请先登录 B站并授权 Toy 身份，完成后才能开始游戏。";
  if (error?.type === "http_error" && String(error?.message || "").includes("getUserProfile is unauthorized"))
    return "Toy 身份未获授权，请登录 B站并确认平台授权后重试。";
  if (error?.type === "user_denied")
    return "未授权 Toy 身份，完成 B站登录与授权后才能开始游戏。";
  if (String(error?.message || "").includes("toy id not available"))
    return "Toy 平台未提供当前作品上下文，请从正式 B站 Toy 页面打开并登录后重试。";
  // SDK errors can contain account or cloud payloads. Only expose the numeric code.
  const raw = error?.code ?? error?.errorCode;
  const code = /^\d{1,9}$/.test(String(raw)) ? `（错误码 ${raw}）` : "";
  return `${stage}失败${code}，可稍后手动重试；未同步进度仍保留。`;
}
function requiresLogin(error) {
  return error?.type === "not_logged_in" || String(error?.code ?? "") === "-101" ||
    (error?.type === "http_error" && String(error?.message || "").includes("getUserProfile is unauthorized")) ||
    String(error?.message || "").includes("toy id not available");
}

// The online server identity must be the Toy-scoped OpenID returned by the SDK.
// Numeric profile fields are not accepted as protocol identity.
function profileUID(user) {
  return profileOpenID(user);
}
function profileOpenID(user) {
  const value = user?.toyOpenId;
  if (typeof value !== "string") return null;
  const openId = value.trim();
  return openId && openId.length <= 128 && !/[\u0000-\u001f\u007f]/.test(openId) ? openId : null;
}

/**
 * Per-browser grow-only cloud components; the board receives their absolute sum.
 * Only ready identities accept records. Without a Toy-scoped profile identity, unsynced records are
 * page-local and a new authorization is an identity boundary, never a nickname match.
 * All methods are asynchronous; flush failures resolve with an error state, while
 * ranks rejects so consumers cannot mistake an unavailable board for an empty one.
 */
export class ToyAccount extends EventTarget {
  constructor({ sdk = null, storage = browserStorage(), locks = globalThis.navigator?.locks,
    window = globalThis.window ?? globalThis, document = globalThis.document } = {}) {
    super();
    this._sdk = sdk;
    this._injected = !!sdk;
    this._storage = storage;
    this.progress = new ProgressLedger(storage);
    this._locks = locks;
    this._window = window;
    this._document = document;
    this._state = Object.freeze({ status: "anonymous", authenticated: false, loginRequired: false, uid: null, nickname: "", total: 0, online: 0, training: 0, sync: "idle", message: "登录并授权 B站身份后开始游戏。" });
    this._queue = Promise.resolve();
    this._prepare = null;
    this._authorization = null;
    this._prepared = false;
    this._writable = false;
    this._scoreWritable = false;
    this._identity = null;
    this._component = null;
    this._own = { online: 0, training: 0 };
    this._cloud = new Map();
    this._score = null;
    this._needsScore = false;
    this._rankCache = null;
    this._rankRequest = null;
    this._flushRequest = null;
    this._retryAfter = 0;
    this._warning = "";
  }
  get state() { return this._state; }
  get isToy() { return this._injected || inToy(this._window, this._document); }
  get playerName() { return this.state.authenticated ? this.state.nickname : this.isToy ? "匿名干员" : DEFAULT_PLAYER_NAME; }
  get sdk() { return this._sdk; }
  get identityKey() { return this._identity?.uid ?? null; }
  // A standalone page, an unauthenticated Toy session, or a profile without
  // an SDK account identifier has no online identity and cannot join a room.
  get onlineIdentityKey() { return this.state.authenticated ? this.identityKey : null; }
  get uid() { return this._identity?.uid ?? null; }
  _change(patch) {
    this._state = Object.freeze({ ...this._state, ...patch });
    this.dispatchEvent(new Event("change"));
  }
  _enqueue(operation) {
    const result = this._queue.then(operation);
    this._queue = result.catch(() => {});
    return result;
  }
  _lock(name, operation) {
    return this._locks?.request ? this._locks.request(name, { mode: "exclusive" }, operation) : operation();
  }
  _accountLock(operation) {
    return this._lock(`gh-toy-kills-v1:${this._identity.openId ? encodeURIComponent(this._identity.openId) : "session"}`, operation);
  }
  async _componentID() {
    if (this._component) return;
    await this._lock("gh-toy-component-v1", () => {
      try {
        const saved = this._storage?.getItem(COMPONENT_KEY);
        if (saved && /^[a-zA-Z0-9_-]{8,128}$/.test(saved)) this._component = saved;
        else {
          this._component = randomComponent();
          this._storage?.setItem(COMPONENT_KEY, this._component);
        }
        if (!this._storage) this._warning = "浏览器存储不可用，未同步击杀仅在当前页面保留。";
      } catch {
        this._component ??= randomComponent();
        this._storage = null;
        this._warning = "浏览器存储不可用，未同步击杀仅在当前页面保留。";
      }
    });
  }
  _localKey() {
    return this._identity.openId ? `${LOCAL_PREFIX}${encodeURIComponent(this._identity.openId)}_${this._component}` : null;
  }
  _readLocal() {
    const key = this._localKey();
    if (!key || !this._storage) return this._own;
    let raw;
    try { raw = this._storage.getItem(key); } catch {
      this._warning = "本地读取失败，未同步击杀仅在当前页面保留。";
      return this._own;
    }
    return raw === null ? this._own : merge(this._own, counts(JSON.parse(raw)));
  }
  _persist() {
    const key = this._localKey();
    if (key && this._storage) this._storage.setItem(key, JSON.stringify(this._own));
  }
  _totals(own = this._own) {
    let online = own.online, training = own.training;
    for (const [key, value] of this._cloud) {
      if (key === CLOUD_PREFIX + this._component) continue;
      online += value.online;
      training += value.training;
    }
    return counts({ online, training });
  }
  _showCounts(patch = {}) {
    const { online, training } = this._totals();
    this._change({ online, training, total: online + training,
      progress: this.progress.ready ? this.progress.snapshot() : null,
      loadout: this.progress.preferences?.value ?? null,
      progressSync: !this.progress.ready ? "idle" : !this._writable ? "readonly" : this.progress.pending() ? "pending" : "synced",
      ...patch });
  }
  prepare() {
    if (this._prepared) return Promise.resolve(this.state);
    if (this._prepare) return this._prepare;
    this._prepare = (async () => {
      if (!this.isToy) return this.state;
      this._change({ status: "loading", message: "正在连接 Toy 平台…" });
      try {
        this._sdk ??= await loadSDK(this._window, this._document);
        const [cloud, score] = await Promise.all([
          this._sdk.isSupport("setCloudStorage"), this._sdk.isSupport("submitScore"),
        ]);
        this._writable = cloud === true;
        this._scoreWritable = score === true;
        this._prepared = true;
        this._change({ status: "anonymous", loginRequired: false, sync: this._writable ? "idle" : "readonly",
          message: this._writable ? "登录并授权 B站身份后开始游戏。" : "当前 Toy 环境只读，不能保存击杀或提交排行榜。" });
      } catch (error) {
        this._change({ status: "anonymous", sync: "error", message: errorText("Toy SDK 连接或能力检测", error) });
      }
      return this.state;
    })().finally(() => { this._prepare = null; });
    return this._prepare;
  }
  authorize() {
    if (!this.isToy) return Promise.resolve(this.state);
    if (this._authorization) return this._authorization;
    // Invoke the SDK in the user-action turn when prepare() already completed.
    let profile;
    if (this._prepared) {
      try { profile = Promise.resolve(this._sdk.getUserProfile()); } catch (error) { profile = Promise.reject(error); }
      profile.catch(() => {});
    }
    this._change({ status: "authorizing", authenticated: false, loginRequired: false, nickname: "", online: 0, training: 0, total: 0,
      progress: null, loadout: null, progressSync: "loading", message: "正在读取 Toy 身份与成长云档…" });
    this._authorization = this._enqueue(async () => {
      let stage = "Toy 授权";
      try {
        if (!this._prepared) await this.prepare();
        if (!this._prepared) throw Error("SDK unavailable");
        const user = await (profile ?? this._sdk.getUserProfile());
        if (!user || typeof user.nickname !== "string" || !user.nickname.trim()) throw Error("invalid profile");
        const uid = profileUID(user);
        const openId = profileOpenID(user);
        if (!uid) throw Error("toy id not available");
        const previous = this._identity;
        const cloudIdentity = openId ?? uid;
        const retained = cloudIdentity && previous?.openId === cloudIdentity ? this._own : { online: 0, training: 0 };
        this._identity = { uid, openId: cloudIdentity };
        this._own = retained;
        this._cloud = new Map();
        this._score = null;
        this._needsScore = true;
        this._rankCache = null;
        this._warning = !this._storage ? "浏览器存储不可用，未同步击杀仅在当前页面保留。"
          : !cloudIdentity ? "平台未提供稳定用户标识，未同步击杀仅在当前页面保留。" : "";
        this._retryAfter = 0;
        this._change({ authenticated: true, loginRequired: false, uid, nickname: user.nickname, online: 0, training: 0, total: 0 });
        await this._componentID();
        stage = "云档读取";
        await this._accountLock(async () => {
          const data = await this._sdk.getCloudStorage();
          this._cloud = cloudComponents(data);
          this.progress.open({ identity: cloudIdentity, component: this._component, data });
          this._own = merge(this._cloud.get(CLOUD_PREFIX + this._component) ?? { online: 0, training: 0 }, this._readLocal());
          this._totals();
          try { this._persist(); } catch { this._warning = "本地保存失败，未同步击杀仅在当前页面保留。"; }
        });
        // Restore the actual board high-water mark, including a component upload whose score submission failed.
        stage = "个人榜位读取";
        this._score = this._scoreWritable ? this._rankScore(await this._sdk.getMyRank({ board: 1, period: "all" })) : 0;
        this._needsScore = this._scoreWritable && this._totals().online + this._totals().training > this._score;
        this._showCounts({ status: "ready", nickname: user.nickname, sync: this._writable ? (this._pending() ? "pending" : "synced") : "readonly",
          message: this._writable ? this._warning : "当前 Toy 环境只读，不能保存击杀或提交排行榜。" });
      } catch (error) {
        if (stage === "Toy 授权") {
          this._identity = null;
          this._own = { online: 0, training: 0 };
          this._cloud = new Map();
          this.progress.reset();
          this._rankCache = null;
        }
        // A failed rank read must not discard a successfully loaded ledger or its authenticated identity.
        const ready = stage === "个人榜位读取";
        this._change({ status: ready ? "ready" : "error", loginRequired: stage === "Toy 授权" && requiresLogin(error), sync: "error",
          message: errorText(stage, error) + (!ready && this.state.authenticated ? " 云档尚未就绪，击杀暂不计入排行榜；成长以本地试玩保存，可在恢复后选择导入。" : "") });
        if (ready) this._showCounts();
      }
      return this.state;
    }).finally(() => { this._authorization = null; });
    return this._authorization;
  }
  _pending() {
    return !equal(this._own, this._cloud.get(CLOUD_PREFIX + this._component) ?? { online: 0, training: 0 }) || this._needsScore || this.progress.pending();
  }
  _progressOperation(operation) {
    if (this.state.status !== "ready" || !this.progress.ready) return Promise.resolve(false);
    const identity = this._identity;
    return this._enqueue(async () => {
      if (this._identity !== identity) return false;
      try {
        await this._accountLock(() => operation(this.progress));
        this._showCounts({ sync: this._writable ? "pending" : "readonly", message: this.progress.warning || this._warning });
        return true;
      } catch (error) {
        this._change({ sync: "error", progressSync: "error", message: errorText("成长存档保存", error) });
        return false;
      }
    });
  }
  recordProgress(delta) { return this._progressOperation(store => store.record(delta)); }
  saveLoadout(value) { return this._progressOperation(store => store.saveLoadout(value)); }
  importLegacy(value) { return this._progressOperation(store => store.importLegacy(value)); }
  _rankScore(mine) {
    if (!mine || typeof mine.ranked !== "boolean") throw Error("invalid rank");
    if (!mine.ranked) return 0;
    if (!Number.isInteger(mine.score) || mine.score < 0 || mine.score > MAX_SCORE) throw Error("invalid score");
    return mine.score;
  }
  record(mode, delta) {
    if (this.state.status !== "ready" || !["online", "training"].includes(mode) || !Number.isSafeInteger(delta) || delta <= 0) return Promise.resolve(false);
    const identity = this._identity;
    return this._enqueue(async () => {
      if (this._identity !== identity) return false;
      try {
        return await this._accountLock(() => {
          this._own = this._readLocal();
          const next = { ...this._own, [mode]: this._own[mode] + delta };
          this._totals(next);
          this._own = next;
          let failure = "";
          try { this._persist(); } catch (error) { failure = errorText("本地保存", error); }
          this._showCounts({ sync: failure ? "error" : this._writable ? "pending" : "readonly",
            message: failure || (this._writable ? this._warning : "当前 Toy 环境只读，不能保存击杀或提交排行榜。") });
          return true;
        });
      } catch (error) {
        this._change({ sync: "error", message: errorText("击杀累计", error) });
        return false;
      }
    });
  }
  flush() {
    if (this._flushRequest) return this._flushRequest;
    if (Date.now() < this._retryAfter) return Promise.resolve(this.state);
    if (this.state.status !== "ready") return Promise.resolve(this.state);
    const identity = this._identity;
    this._flushRequest = this._enqueue(async () => {
      if (this._identity !== identity) return this.state;
      if (!this._writable) {
        this._change({ sync: "readonly", message: "当前 Toy 环境只读，不能保存击杀或提交排行榜。" });
        return this.state;
      }
      let stage = "云档读取";
      try {
        await this._accountLock(async () => {
          this._own = this._readLocal();
          if (!this._pending()) return;
          this._change({ sync: "syncing", message: "正在同步成长云档与战绩…" });
          const data = await this._sdk.getCloudStorage();
          this._cloud = cloudComponents(data);
          this.progress.mergeCloud(data);
          this.progress.mergeLocal();
          const key = CLOUD_PREFIX + this._component;
          this._own = merge(this._own, this._cloud.get(key) ?? { online: 0, training: 0 });
          try { this._persist(); } catch { this._warning = "本地保存失败，未同步击杀仅在当前页面保留。"; }
          const writes = this.progress.writes();
          if (!equal(this._own, this._cloud.get(key) ?? { online: 0, training: 0 })) writes[key] = JSON.stringify(this._own);
          if (Object.keys(writes).length) {
            stage = "云档保存";
            await this._sdk.setCloudStorage(writes);
            this._needsScore = this._scoreWritable;
            stage = "云档汇总读取";
            const confirmedData = await this._sdk.getCloudStorage();
            this._cloud = cloudComponents(confirmedData);
            this.progress.mergeCloud(confirmedData);
            if (this.progress.pending()) throw Error("growth write not confirmed");
            this.progress.persist();
            const confirmed = this._cloud.get(key);
            if (writes[key] && (!confirmed || confirmed.online < this._own.online || confirmed.training < this._own.training)) throw Error("cloud write not confirmed");
            if (confirmed) this._own = merge(this._own, confirmed);
          }
          const { online, training } = this._totals();
          const total = online + training;
          if (this._scoreWritable && (this._score === null || total > this._score)) {
            this._needsScore = true;
            stage = "个人榜位读取";
            this._score = Math.max(this._score ?? 0, this._rankScore(await this._sdk.getMyRank({ board: 1, period: "all" })));
          }
          if (this._scoreWritable && total > this._score) {
            stage = total > MAX_SCORE ? "排行榜提交（累计击杀超出平台上限 16777215）" : "排行榜提交";
            if (total > MAX_SCORE) throw Error("score exceeds platform range");
            await this._sdk.submitScore({ board: 1, score: total });
            this._score = total;
          }
          this._needsScore = false;
          this._rankCache = null;
          this._showCounts({ sync: "synced", message: this.progress.warning || this._warning || (!this._scoreWritable ? "成长云档已保存；当前环境不支持提交排行榜。" : "") });
        });
      } catch (error) {
        if (Number(error?.code ?? error?.errorCode) === 307044) this._retryAfter = Date.now() + 30000;
        this._showCounts({ sync: "error", message: errorText(stage, error) });
      }
      return this.state;
    }).finally(() => { this._flushRequest = null; });
    return this._flushRequest;
  }
  ranks({ refresh = false } = {}) {
    if (!refresh && this._rankCache) return Promise.resolve(this._rankCache);
    if (this._rankRequest) return this._rankRequest;
    const identity = this._identity;
    const authorized = this.state.authenticated;
    this._rankRequest = (async () => {
      await this.prepare();
      try {
        if (!this._prepared) throw Error("SDK unavailable");
        const list = await this._sdk.getRankList({ board: 1, period: "all", limit: 20 });
        if (!Array.isArray(list) || !list.every((entry) => Number.isInteger(entry.rank) && entry.rank > 0 &&
          Number.isInteger(entry.score) && typeof entry.nickname === "string" && typeof entry.avatar === "string")) throw Error("invalid rank list");
        const mine = authorized ? await this._sdk.getMyRank({ board: 1, period: "all" }) : null;
        if (mine) this._rankScore(mine);
        const result = { list, mine };
        if (identity !== this._identity || authorized !== this.state.authenticated) throw Error("identity changed");
        this._rankCache = result;
        return result;
      } catch (error) {
        this._change({ message: errorText("排行榜读取", error) });
        throw Error(this.state.message);
      }
    })().finally(() => { this._rankRequest = null; });
    return this._rankRequest;
  }
}
