/*!
 * RTSX SoundKit —— 离线音效选择与播放
 * 所有音频都在 assets/sfx/*.wav 本地文件里，不发任何外部请求。
 *
 * 用法：
 *   <script src="../../assets/sfx/sfx.js"></script>
 *   RTSXSFX.play("click");            // 同类音效里随机挑一个
 *   RTSXSFX.play("score", { volume: .8 });
 *   RTSXSFX.setPreference("click", "ui-click-2.wav");  // 固定选某个文件（会记住）
 *   <button data-sfx="click">…</button>   // 自动绑定点击音
 *
 * 目录/接口：
 *   RTSXSFX.groups()            有哪些音效组
 *   RTSXSFX.catalog()           完整清单（含时长、文件）
 *   RTSXSFX.pick(group)         按当前偏好挑一个文件名（不连着重复）
 *   RTSXSFX.setPreference(g, f) 固定选某个文件，f=null 恢复随机
 *   RTSXSFX.mute(true|false) / toggleMute() / isMuted()
 */
(function () {
  "use strict";
  if (window.RTSXSFX) return;

  /* ---------- 路径：以本脚本所在目录为基准 ---------- */
  var base = "";
  try {
    var s = document.currentScript || (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf("sfx.js") !== -1) return all[i];
      }
      return null;
    })();
    if (s && s.src) base = s.src.replace(/sfx\.js(\?[^#]*)?(#.*)?$/, "");
  } catch (e) { base = ""; }
  if (!/^(http|file|\/)/i.test(base)) base = "assets/sfx/";

  /* ---------- 清单（生成器和 wav 文件一一对应） ---------- */
  var CATALOG = {
    click:   { label: "点击", files: ["ui-click-1.wav", "ui-click-2.wav", "ui-click-3.wav"] },
    hover:   { label: "悬停", files: ["ui-hover-1.wav", "ui-hover-2.wav"] },
    back:    { label: "返回", files: ["ui-back-1.wav", "ui-back-2.wav"] },
    score:   { label: "得分", files: ["score-1.wav", "score-2.wav", "score-3.wav"] },
    catch:   { label: "接住", files: ["catch-1.wav", "catch-2.wav", "catch-3.wav"] },
    error:   { label: "错误", files: ["error-1.wav", "error-2.wav"] },
    land:    { label: "落地", files: ["land-1.wav", "land-2.wav", "land-3.wav"] },
    glitch:  { label: "故障", files: ["glitch-1.wav", "glitch-2.wav", "glitch-3.wav"] },
    warn:    { label: "警告", files: ["warn-1.wav", "warn-2.wav"] },
    start:   { label: "开始", files: ["start-1.wav", "start-2.wav"] },
    success: { label: "完成", files: ["success-1.wav", "success-2.wav"] },
    toggle:  { label: "开关", files: ["toggle-1.wav", "toggle-2.wav"] }
  };

  var DURATION = {
    "ui-click-1.wav": 85, "ui-click-2.wav": 85, "ui-click-3.wav": 85,
    "ui-hover-1.wav": 130, "ui-hover-2.wav": 130,
    "ui-back-1.wav": 190, "ui-back-2.wav": 190,
    "score-1.wav": 330, "score-2.wav": 330, "score-3.wav": 330,
    "catch-1.wav": 300, "catch-2.wav": 300, "catch-3.wav": 300,
    "error-1.wav": 360, "error-2.wav": 360,
    "land-1.wav": 260, "land-2.wav": 260, "land-3.wav": 260,
    "glitch-1.wav": 340, "glitch-2.wav": 340, "glitch-3.wav": 340,
    "warn-1.wav": 420, "warn-2.wav": 420,
    "start-1.wav": 550, "start-2.wav": 550,
    "success-1.wav": 620, "success-2.wav": 620,
    "toggle-1.wav": 140, "toggle-2.wav": 140
  };

  /* ---------- 状态 ---------- */
  var MUTE_KEY = "rtsx.sfx.muted";
  var PREF_KEY = "rtsx.sfx.pref";
  var VOL_KEY = "rtsx.sfx.vol";

  var muted = false, master = 0.9;
  var prefs = {};
  var lastPick = {};
  var pools = {};        // file -> [HTMLAudioElement, ...]
  var POOL_SIZE = 3;
  var useLimiter = true; // 同时播放过多时降音量，避免爆音
  var liveCount = 0;

  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) {}
  try {
    var pv = parseFloat(localStorage.getItem(VOL_KEY));
    if (!isNaN(pv) && pv > 0 && pv <= 1) master = pv;
  } catch (e) {}
  try {
    prefs = JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {};
  } catch (e) { prefs = {}; }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function url(file) { return base + file; }

  function buildPool(file) {
    if (pools[file]) return pools[file];
    var arr = [];
    for (var i = 0; i < POOL_SIZE; i++) {
      var a = new Audio();
      a.preload = "auto";
      a.src = url(file);
      a.load();
      arr.push(a);
    }
    pools[file] = arr;
    return arr;
  }

  function freeElement(file) {
    var pool = buildPool(file);
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].paused || pool[i].ended) return pool[i];
    }
    return pool[0];
  }

  function pick(group) {
    var g = CATALOG[group];
    if (!g) return null;
    var fixed = prefs[group];
    if (fixed && g.files.indexOf(fixed) !== -1) {
      lastPick[group] = fixed;
      return fixed;
    }
    if (g.files.length === 1) { lastPick[group] = g.files[0]; return g.files[0]; }
    var prev = lastPick[group];
    var cand = [], i;
    for (i = 0; i < g.files.length; i++) if (g.files[i] !== prev) cand.push(g.files[i]);
    if (!cand.length) cand = g.files.slice();
    var chosen = cand[Math.floor(Math.random() * cand.length)];
    lastPick[group] = chosen;
    return chosen;
  }

  function play(group, opts) {
    var file = pick(group);
    if (!file) return null;
    if (muted) return file;
    var o = opts || {};
    var el = freeElement(file);
    var vol = Math.max(0, Math.min(1, master * (o.volume == null ? 1 : o.volume)));
    if (liveCount > 3) vol *= 0.6;
    try {
      el.volume = vol;
      el.currentTime = 0;
      var pr = el.play();
      if (pr && pr.catch) {
        pr.catch(function () {
          // 浏览器未解锁或文件不可播：静默失败，不抛错
        });
      }
      liveCount++;
      setTimeout(function () { liveCount = Math.max(0, liveCount - 1); }, (DURATION[file] || 300) + 30);
    } catch (e) {
      return file;
    }
    if (o.label && window.console && console.debug) console.debug("[sfx]", group, file);
    return file;
  }

  /* ---------- 预加载 ---------- */
  function preload(groups) {
    var keys = groups || Object.keys(CATALOG);
    keys.forEach(function (k) {
      var g = CATALOG[k];
      if (!g) return;
      g.files.forEach(function (f) { buildPool(f); });
    });
  }

  /* ---------- 自动绑定 ---------- */
  function bind(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll("[data-sfx]");
    for (var i = 0; i < nodes.length; i++) {
      (function (n) {
        if (n.__sfxBound) return;
        n.__sfxBound = true;
        var clickKey = n.getAttribute("data-sfx") || "click";
        var hoverKey = n.getAttribute("data-sfx-hover");
        n.addEventListener("click", function () { play(clickKey); });
        if (hoverKey) {
          n.addEventListener("pointerenter", function () { play(hoverKey, { volume: 0.7 }); });
        }
      })(nodes[i]);
    }
  }

  /* ---------- 对外 ---------- */
  window.RTSXSFX = {
    version: "1.0",
    base: base,
    groups: function () { return Object.keys(CATALOG); },
    catalog: function () {
      var out = [];
      Object.keys(CATALOG).forEach(function (k) {
        out.push({
          key: k, label: CATALOG[k].label,
          files: CATALOG[k].files.map(function (f) {
            return { file: f, url: url(f), ms: DURATION[f] || 0, chosen: prefs[k] === f };
          })
        });
      });
      return out;
    },
    pick: pick,
    play: play,
    preload: preload,
    bind: bind,
    setPreference: function (group, file) {
      if (!CATALOG[group]) return false;
      if (file === null || typeof file === "undefined") delete prefs[group];
      else if (CATALOG[group].files.indexOf(file) === -1) return false;
      else prefs[group] = file;
      savePrefs();
      return true;
    },
    getPreference: function (group) { return prefs[group] || null; },
    mute: function (v) {
      muted = !!v;
      try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
      if (muted) {
        Object.keys(pools).forEach(function (f) {
          pools[f].forEach(function (a) { try { a.pause(); } catch (e) {} });
        });
      }
      return muted;
    },
    toggleMute: function () { return this.mute(!muted); },
    isMuted: function () { return muted; },
    setVolume: function (v) {
      master = Math.max(0, Math.min(1, v));
      try { localStorage.setItem(VOL_KEY, String(master)); } catch (e) {}
      return master;
    },
    getVolume: function () { return master; }
  };

  // 首次交互解锁音频（移动端必须由用户手势触发）
  function unlockOnce() {
    var one = "";
    try { one = play("toggle", { volume: 0.001 }); } catch (e) {}
    document.removeEventListener("pointerdown", unlockOnce, true);
    document.removeEventListener("keydown", unlockOnce, true);
    return one;
  }
  document.addEventListener("pointerdown", unlockOnce, true);
  document.addEventListener("keydown", unlockOnce, true);

  // 预加载常用组 + 绑定带 data-sfx 的元素（其余元素不自动发声，避免重复音）
  window.addEventListener("load", function () {
    preload(["click", "hover", "toggle", "back"]);
    bind(document);
  });
})();
