const TOY_PLAY_AUTH_ERROR = "游玩《随时随地COD》需要登录 B站并授权 Toy 身份。请在授权弹窗中完成登录与授权后重试。";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalDevSession({ account = null, document = globalThis.document, location = globalThis.location } = {}) {
  if (account?.isToy) return false;
  if (document?.documentElement?.dataset?.localDev !== "1") return false;
  // 本地化分支：本站为自托管副本，不接 B站 Toy 身份，直接进入离线试玩。
  return true;
}

export async function autoAuthorizeToyIdentity({ account, authorize, promptLogin }) {
  if (!account?.isToy || account.onlineIdentityKey && account.state?.status !== "authorizing") return account?.state;
  const state = await authorize({ explicit: false });
  if (!account.onlineIdentityKey && state?.loginRequired) promptLogin?.();
  return state;
}

export async function requireToyIdentity({ account, authorize, promptLogin, localDev = false }) {
  if (localDev && !account?.isToy) return "";
  if (!account?.isToy) throw Error(TOY_PLAY_AUTH_ERROR);
  if (account.onlineIdentityKey && account.state?.status !== "authorizing") return account.onlineIdentityKey;
  const state = await authorize({ explicit: true });
  const uid = account.onlineIdentityKey;
  if (!uid) {
    if (state?.loginRequired) promptLogin?.();
    throw Error(state?.message || TOY_PLAY_AUTH_ERROR);
  }
  return uid;
}

export function showBilibiliLoginPrompt(document = globalThis.document) {
  if (!document?.body) return false;
  const existing = document.getElementById("bilibili-login-required");
  if (existing) {
    existing.querySelector("a")?.focus();
    return true;
  }
  const returnURL = "https://www.bilibili.com/toy/golden-hour/index.html";
  const loginURL = `https://passport.bilibili.com/login?gourl=${encodeURIComponent(returnURL)}`;
  const overlay = document.createElement("div");
  overlay.id = "bilibili-login-required";
  overlay.className = "bilibili-login-overlay";
  const dialog = document.createElement("section");
  dialog.className = "bilibili-login-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "bilibili-login-title");
  const title = document.createElement("h2");
  title.id = "bilibili-login-title";
  title.textContent = "登录 B站后继续";
  const message = document.createElement("p");
  message.textContent = "《随时随地COD》需要 B站账号身份。登录完成后回到本页，再次点击开始或加入。";
  const actions = document.createElement("div");
  actions.className = "bilibili-login-actions";
  const login = document.createElement("a");
  login.className = "nv primary";
  login.href = loginURL;
  login.target = "_blank";
  login.rel = "noopener noreferrer";
  login.textContent = "登录 B站";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn";
  cancel.textContent = "暂不登录";
  const close = () => overlay.remove();
  cancel.addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  actions.append(login, cancel);
  dialog.append(title, message, actions);
  overlay.append(dialog);
  document.body.append(overlay);
  login.focus();
  return true;
}

export { TOY_PLAY_AUTH_ERROR };
