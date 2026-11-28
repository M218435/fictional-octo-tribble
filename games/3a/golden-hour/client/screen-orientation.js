// Mobile landscape orientation enforcement and proactive fullscreen/orientation lock helpers.

export function isIOSDevice(nav = globalThis.navigator) {
  if (!nav) return false;
  const ua = String(nav.userAgent || "");
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return nav.platform === "MacIntel" && Number(nav.maxTouchPoints || 0) > 1;
}

export function isLandscapeViewport(win = globalThis.window) {
  if (!win) return true;
  const width = Number(win.innerWidth || 0);
  const height = Number(win.innerHeight || 0);
  return width >= height;
}

export async function lockLandscapeOrientation(scr = globalThis.screen) {
  if (!scr) return { locked: false, unsupported: true };
  if (typeof scr.orientation?.lock === "function") {
    let lastError = null;
    for (const mode of ["landscape", "landscape-primary"]) {
      try {
        await scr.orientation.lock(mode);
        return { locked: true, mode };
      } catch (error) {
        lastError = error;
      }
    }
    return { locked: false, error: lastError };
  }
  for (const method of ["lockOrientation", "webkitLockOrientation", "mozLockOrientation"]) {
    if (typeof scr[method] === "function") {
      try {
        const result = scr[method]("landscape");
        if (result !== false) return { locked: true, mode: "landscape" };
      } catch (error) {
        return { locked: false, error };
      }
    }
  }
  return { locked: false, unsupported: true };
}

export async function requestFullscreenElement(doc = globalThis.document) {
  if (!doc) return { entered: false, unsupported: true };
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    return { entered: true, already: true };
  }
  const el = doc.documentElement;
  if (!el) return { entered: false, unsupported: true };
  if (typeof el.requestFullscreen === "function") {
    try {
      await el.requestFullscreen({ navigationUI: "hide" });
      return { entered: true };
    } catch (firstError) {
      try {
        await el.requestFullscreen();
        return { entered: true };
      } catch (error) {
        return { entered: false, error: error || firstError };
      }
    }
  }
  if (typeof el.webkitRequestFullscreen === "function") {
    try {
      await el.webkitRequestFullscreen();
      return { entered: true };
    } catch (error) {
      return { entered: false, error };
    }
  }
  return { entered: false, unsupported: true };
}

export async function requestLandscape({
  win = globalThis.window,
  doc = globalThis.document,
  screen: scr = globalThis.screen,
  navigator: nav = globalThis.navigator,
  interactive = true,
} = {}) {
  if (!interactive) {
    const locked = await lockLandscapeOrientation(scr);
    return {
      ok: locked.locked || isLandscapeViewport(win),
      locked: locked.locked,
      fullscreen: !!(doc?.fullscreenElement || doc?.webkitFullscreenElement),
      reason: locked.locked ? "locked" : "passive-blocked",
      message: "",
    };
  }

  const fs = await requestFullscreenElement(doc);
  const lock = await lockLandscapeOrientation(scr);
  if (lock.locked || isLandscapeViewport(win)) {
    return {
      ok: true,
      locked: lock.locked,
      fullscreen: fs.entered,
      reason: lock.locked ? "locked" : "already-landscape",
      message: "",
    };
  }

  if (isIOSDevice(nav)) {
    return {
      ok: false,
      locked: false,
      fullscreen: fs.entered,
      reason: "ios-unsupported",
      message: "iOS 浏览器不支持网页自动旋转：请下拉右上角控制中心关闭「竖排方向锁定」，再将手机横放。",
    };
  }
  if (lock.unsupported && fs.unsupported) {
    return {
      ok: false,
      locked: false,
      fullscreen: false,
      reason: "unsupported",
      message: "当前浏览器或 App 内嵌页不支持自动旋转：请开启系统「自动旋转」，再将手机横放。",
    };
  }
  return {
    ok: false,
    locked: false,
    fullscreen: fs.entered,
    reason: "denied",
    message: "未能自动切换横屏：请下拉状态栏关闭「方向锁定」后手动横向握持设备。",
  };
}
