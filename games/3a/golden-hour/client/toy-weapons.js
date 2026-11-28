export const WEAPON_CAMPAIGN = Object.freeze({
  bvid: "BV1drWB6wEyr", aid: 117609609626997, author: "49800433",
  title: "B站点开就能玩，随时随地 COD，使命在召唤！5V5射击实机",
});
const INITIAL = new Set(["ar", "pistol", "m200", "rpk"]);

// Grants come only from a fresh official SDK response in the current session.
// Saved booleans, clicked links and cloud loadouts never grant weapon access.
export class ToyWeaponAccess extends EventTarget {
  constructor(account, campaign = WEAPON_CAMPAIGN, { localDev = false } = {}) {
    super(); this.account = account; this.campaign = campaign; this.generation = 0; this._localDev = !!(localDev && !account?.isToy);
    this.state = this._localDev
      ? Object.freeze({ status: "unlocked", unlocked: true, following: true, liked: true, coined: true, favorited: true, author: true, message: "本地开发模式已解锁全部武器供试玩测试。" })
      : Object.freeze({ status: "idle", unlocked: false, message: "关注作者并为宣传视频点赞、投币、收藏，可解锁 VESPER 9 与 M12。" });
    if (this._localDev) return;
    let previous = account.state.status;
    account.addEventListener("change", () => {
      const status = account.state.status;
      if (status === "authorizing" && previous !== status) {
        this.generation++; this.request = null;
        this.change({ status: "idle", unlocked: false, following: false, liked: false, coined: false, favorited: false, author: false, message: "正在切换 Toy 身份…" });
      }
      previous = status;
      if (status === "ready" && this.state.status === "idle") void this.check();
    });
  }
  change(patch) { this.state = Object.freeze({ ...this.state, ...patch }); this.dispatchEvent(new Event("change")); }
  canUse(weapon) { return INITIAL.has(weapon) || ["smg", "shotgun"].includes(weapon) && this.state.unlocked; }
  check({ refresh = false } = {}) {
    if (this.request) return this.request;
    if (!refresh && !["idle", "login"].includes(this.state.status)) return Promise.resolve(this.state);
    if (!this.account.state.authenticated || !this.account.sdk) {
      this.change({ status: "login", unlocked: false, message: "请先在正式 B站 Toy 页面同步 B站身份，再校验解锁条件。初始四把枪可直接使用。" });
      return Promise.resolve(this.state);
    }
    const token = this.generation, sdk = this.account.sdk;
    this.change({ status: "checking", message: "正在通过 Toy 校验关注与视频三连状态…" });
    const operation = (async () => {
      try {
        const supported = await Promise.all([sdk.isSupport("getAuthorRelation"), sdk.isSupport("getVideoUserActions")]);
        if (supported.some(value => value !== true)) throw Error("unsupported");
        const [relation, videos] = await Promise.all([
          sdk.getAuthorRelation(), sdk.getVideoUserActions({ videos: [{ bvid: this.campaign.bvid }] }),
        ]);
        if (token !== this.generation) return this.state;
        if (relation?.status !== "ok" || typeof relation.data?.isFollowing !== "boolean") throw Error(relation?.status || "unavailable");
        const author = relation.data.isAuthor === true;
        const item = videos?.items?.find(item => item.bvid === this.campaign.bvid && item.aid === this.campaign.aid);
        if (!author && (!["ok", "partial"].includes(videos?.status) || item?.status !== "ok" ||
          typeof item.liked !== "boolean" || !Number.isInteger(item.coinCount) || item.coinCount < 0 || typeof item.favorited !== "boolean")) throw Error(videos?.status || "unavailable");
        const following = relation.data.isFollowing, liked = item?.liked === true, coined = item?.coinCount > 0, favorited = item?.favorited === true;
        // An SDK-verified creator cannot follow/coin their own video; allow the
        // owner to test their work. Other identities require all four conditions.
        const unlocked = author || following && liked && coined && favorited;
        this.change({ status: unlocked ? "unlocked" : "locked", unlocked, following, liked, coined, favorited, author,
          message: author ? "Toy 已核验作者本人，可测试全部武器。" : unlocked ? "关注与视频三连已核验，VESPER 9 和 M12 已解锁。"
      : "完成下方条件后，返回点击「重新校验」。仅打开页面不会解锁。" });
      } catch (error) {
        if (token !== this.generation) return this.state;
        const status = String(error?.message || error?.type || "");
        this.change({ status: "unavailable", unlocked: false, message: status.includes("unsupported")
          ? "当前容器不支持互动状态校验，请在 B站 App 或桌面正式 Toy 页面重试。初始四把枪仍可使用。"
          : "暂时无法核验互动状态，请确认已登录并稍后手动重试。初始四把枪仍可使用。" });
      }
      return this.state;
    })();
    this.request = operation;
    operation.finally(() => { if (this.request === operation) this.request = null; });
    return operation;
  }
  navigate(type) {
    const sdk = this.account.sdk;
    if (!sdk?.navigate) { this.change({ message: "请在 B站 Toy 页面打开作者或视频。" }); return Promise.resolve(false); }
    // Invoke immediately in the user's click turn; never perform social actions.
    let promise;
    try { promise = sdk.navigate({ type: type === "author" ? "space" : "video", id: type === "author" ? this.campaign.author : this.campaign.bvid }); }
    catch (error) { promise = Promise.reject(error); }
    return Promise.resolve(promise).then(() => true, () => { this.change({ message: "页面打开失败，请在 B站 App 内重试。" }); return false; });
  }
}

export function installWeaponGate({ access, engine, progression, authorize }) {
  const { menus } = engine.ctx.hud;
  let returnPage = "gunsmith";
  const page = menus._page("toy-unlock", `
    <header class="topbar"><button class="backb" data-nav data-act="unlock-back">‹ <span>返回</span></button><h2>武器解锁</h2><span class="online-mode">KR-7 · STRIX 9 · M200 · RPK · VESPER 9 · M12 全部可用</span></header>
    <div class="online-layout toy-unlock-layout">
      <section class="online-commands">
        <div class="sech"><span>扩展军械</span><span>VESPER 9 / M12</span></div>
        <h3>全部主武器已解锁</h3>
        <p>本地化版本不接入账号体系，六把主武器直接开放，在军械库选中即可携带。</p>
        <p data-unlock-status role="status"></p>
      </section>
      <section class="online-squad">
        <div class="sech"><span>说明</span><span>离线可用</span></div>
        <div class="toy-unlock-checks" data-unlock-checks></div>
        <p>存档保存在本机浏览器，换设备或清理站点数据后需要重新开始。</p>
      </section>
    </div>`);
  page.addEventListener("click", event => { const button = event.target.closest("button[data-act]"); if (button && !button.disabled) menus._act(button.dataset.act); });
  const render = () => {
    const state = access.state;
    page.querySelector("[data-unlock-status]").textContent = state.message;
    const list = page.querySelector("[data-unlock-checks]");
    list.replaceChildren();
    const chk = page.querySelector('[data-act="unlock-check"]');
    if (chk) chk.disabled = state.status === "checking";
    if (menus.page === "gunsmith") menus._gsRender(false);
  };
  function open() {
    returnPage = menus.page === "gunsmith" ? "gunsmith" : "main";
    menus.go("toy-unlock"); render(); void access.check();
  }
  const act = menus._act;
  menus._act = function (action, direction) {
    if (action === "unlock-back") return this.go(returnPage);
    if (action === "unlock-author") return void access.navigate("author");
    if (action === "unlock-video") return void access.navigate("video");
    if (action === "unlock-check") return void access.check({ refresh: true });
    if (action === "unlock-login") return void authorize({ explicit: true }).then(() => access.check({ refresh: true }));
    return act.call(this, action, direction);
  };
  const back = menus.back;
  menus.back = function () { return this.page === "toy-unlock" ? this.go(returnPage) : back.call(this); };
  const equip = menus._gsEquip;
  menus._gsEquip = function (...args) { if (!access.canUse(this.gs.w)) return open(); return equip.apply(this, args); };
  const renderGun = menus._gsRender;
  menus._gsRender = function (...args) {
    const result = renderGun.apply(this, args);
    if (!access.canUse(this.gs.w)) {
      const button = this.pages.gunsmith.querySelector("#gs-equip");
      button.disabled = false; button.textContent = "已解锁";
    }
    return result;
  };
  const arsenal = engine.ctx.arsenal, reset = arsenal.reset;
  arsenal.reset = function (primary, ...args) {
    if (!access.canUse(primary)) { primary = "ar"; engine.ctx.settings.primary = "ar"; }
    return reset.call(this, primary, ...args);
  };
  progression.setWeaponPolicy(weapon => access.canUse(weapon));
  access.addEventListener("change", () => { progression.refresh(); render(); });
  if (!access.canUse(engine.ctx.settings.primary)) engine.ctx.settings.primary = "ar";
  if (menus.page === "main") menus._refreshMain();
  render();
  return { open };
}
