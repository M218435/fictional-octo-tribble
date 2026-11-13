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

  /*@@EMBED*/
  // 以下为常用音效的 base64 WAV（24k 单声道），内嵌后点击时不需要再发请求
  var EMBED = {
    "ui-click-1.wav": "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TwA6ACUADwD6/+f/1f/F/7j/rf+j/5r/kv+L/4T/fv95/3X/c/90/3f/fP+D/43/mP+k/7D/vP/J/9b/4//x/wAAEQAiADUASABbAG4AgACRAKEAsAC+AMoA1gDiAO0A+AACAQsBFAEaAR8BIgEjASIBHwEbARYBEQELAQQB/QD0AOsA4QDVAMkAuwCsAJwAjQB9AG4AYABSAEUAOAArAB4AEgAFAPn/7v/j/9r/0f/L/8X/wf+//73/vf+9/77/v//C/8X/yf/P/9X/3f/n//H/+/8HABIAHgAqADUAQQBMAFgAZABwAHwAiACUAJ8AqgC0AL0AxQDLANEA1wDbAN8A4gDkAOYA5wDnAOYA4wDgANsA1QDPAMgAwQC5ALEAqACfAJYAjQCDAHkAbgBjAFkATgBEADoAMAAoACAAGAARAAoABAD+//n/9f/x/+7/7P/r/+r/6//t/+//8//2//r///8EAAoAEAAWAB4AJQAuADYAPwBIAFEAWgBiAGsAcwB7AIIAiQCRAJcAngCkAKoArwCzALcAuQC8AL0AvQC+AL0AvAC7ALgAtgCzAK8AqwCmAKAAmgCUAI0AhgB/AHgAcQBqAGMAXABVAE4ARwBAADoAMwAtACgAIwAfABsAFwAVABIAEAAPAA4ADgAOAA4ADwARABQAFgAaAB4AIgAnACwAMQA2ADsAQQBHAE0AUwBZAF8AZQBrAHEAdwB8AIEAhgCLAI8AkgCWAJkAmwCdAJ8AoQChAKIAogChAKAAngCcAJoAlwCUAJAAjQCJAIUAgAB8AHcAcgBtAGcAYgBdAFgAUwBOAEoARQBBAD0AOQA2ADIALwAtACoAKQAnACYAJgAlACYAJgAnACgAKgAsAC4AMAAzADYAOQA9AEEARQBJAE0AUQBWAFoAXgBiAGYAagBuAHIAdgB5AH0AgACCAIUAhwCJAIoAjACMAI0AjQCNAI0AjACLAIoAiACHAIQAggB/AH0AegB2AHMAcABsAGkAZQBiAF4AWwBXAFQAUABNAEoARwBEAEIAQAA+ADwAOgA5ADgANwA2ADYANgA2ADcAOAA5ADoAPAA+AEAAQgBEAEYASQBMAE8AUQBUAFcAWwBeAGEAYwBmAGkAbABuAHEAcwB1AHcAeQB6AHwAfQB+AH8AfwB/AH8AfwB/AH4AfQB8AHsAeQB4AHYAdAByAHAAbQBrAGkAZgBkAGEAXwBcAFoAVwBVAFMAUABOAEwASwBJAEcARgBFAEQAQwBDAEIAQgBCAEIAQwBDAEQARQBGAFkAWwBbAFsAWwBbAFsAWwBbAFsAWwBbAFsAWwBbAFsAWwBcAFwAXABcAFwAXQBdAF0AXQBeAF4AXgBeAF8AXwBfAF8AXwBgAGAAYABgAGAAYABgAGEAYQBhAGEAYQBhAGEAYQBhAGAAYABgAGAAYABgAGAAXwBfAF8AXwBfAF4AXgBeAF4AXgBdAF0AXQBdAF0AXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABdAF0AXQBdAF0AXQBeAF4AXgBeAF4AXgBfAF8AXwBfAF8AXwBfAF8AYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAXwBfAF8AXwBfAF8AXwBfAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF0AXQBdAF0AXQBdAF0AXQBdAFwAXABcAFwAXQBdAF0AXQBdAF0AXQBdAF0AXQBdAF0AXQBdAF0AXQBdAF0AXQBdAF0AXQBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAA==",
    "ui-click-2.wav": "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xf/A/73/u/+7/73/wv/H/87/1v/e/+b/7v/2//3/BAAKABIAGgAjAC0AOQBGAFMAYgBwAH4AiwCYAKMArQC3AL8AxwDPANYA3gDmAO4A9wD/AAcBDgETARgBGwEcARwBGwEZARYBEwEQAQ0BCQEGAQMB/wD6APUA7wDoAOAA1wDNAMIAtwCtAKIAmACPAIYAfQB1AG4AZgBeAFYATQBFADwAMwArACQAHQAXABIADgALAAkACAAHAAcABwAHAAcABwAIAAkACwANABAAFAAZAB8AJgAtADQAOwBDAEoAUQBYAF8AZgBtAHQAewCCAIoAkgCaAKIAqgCxALgAvgDEAMkAzQDRANQA1wDaANwA3wDhAOIA5ADlAOYA5QDlAOMA4QDeANsA1wDSAM4AyQDEAL8AugC1ALAAqwCmAKAAmgCTAI0AhgB/AHgAcgBrAGUAYABbAFYAUQBNAEkARQBCAD4AOwA4ADUAMgAwAC8ALgAtAC0ALgAvADEAMwA1ADcAOgA9AD8AQgBGAEkATQBRAFYAWgBfAGUAagBwAHUAegB/AIUAiQCOAJIAlwCbAJ8AowCnAKsArwCyALUAuAC7AL0AvwDAAMEAwgDCAMIAwQDBAMAAvwC+AL0AuwC5ALcAtACxAK4AqwCnAKMAnwCbAJcAkwCPAIsAhwCDAH8AewB3AHQAcABsAGgAZQBhAF4AWwBYAFYAUwBRAFAATgBNAEwATABLAEsASwBLAEsATABNAE4ATwBRAFMAVQBYAFoAXQBgAGMAZgBpAGwAbwByAHUAeAB8AH8AggCGAIkAjACQAJMAlQCYAJsAnQCfAKEAowClAKYApwCpAKoAqgCrAKwArACsAKsAqwCqAKkAqACmAKUAowChAKAAngCbAJkAlwCVAJIAkACNAIoAhwCFAIIAfwB8AHoAdwB1AHIAcABuAGwAagBoAGYAZABjAGIAYABfAF4AXgBdAF0AXQBdAF0AXQBeAF8AYABhAGIAYwBkAGYAZwBpAGsAbQBuAHEAcwB1AHcAeQB8AH4AgACCAIQAhgCIAIoAjACOAJAAkQCTAJUAlgCXAJgAmQCaAJsAnACcAJwAnACcAJwAnACcAJsAmwCaAJkAmACXAJYAlQCTAJIAkACPAI0AjACKAIgAhgCFAIMAgQB/AH4AfAB6AHkAdwB1AHQAcgBxAHAAbwBuAG0AbABrAGsAagBqAGkAaQBpAGkAaQBpAGoAagBrAGsAbABtAG4AbwBwAHEAcgBzAHUAdgB3AHkAegB8AH0AfwCAAIYAhwCGAIYAhQCFAIQAhACDAIMAggCCAIEAgQCAAIAAfwB+AH4AfQB9AH0AfAB8AHsAewB7AHoAegB6AHoAeQB5AHkAeQB5AHkAeQB5AHkAeQB5AHoAegB6AHoAewB7AHsAfAB8AHwAfQB9AH4AfgB/AH8AfwCAAIAAgQCBAIIAggCCAIMAgwCDAIQAhACEAIUAhQCFAIUAhQCGAIYAhgCGAIYAhgCGAIYAhgCFAIUAhQCFAIUAhQCEAIQAhACDAIMAgwCCAIIAggCBAIEAgQCAAIAAgAB/AH8AfwB+AH4AfgB9AH0AfQB9AHwAfAB8AHwAfAB8AHwAfAB7AHsAewB7AHwAfAB8AHwAfAB8AHwAfAB9AH0AfQB9AH0AfgB+AH4AfwB/AH8AfwCAAIAAgACAAIEAgQCBAIEAgQCBAIEAggCCAIIAggCCAIIAggCCAIIAggCCAIIAggCCAIIAggCBAIEAgQCBAIEAgQCBAIEAgQCBAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgAB/AH8AfwB/AH8AfwB/AH8AfwB/AH8AfwB/AH8AfwCAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAA==",
    "ui-click-3.wav": "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uwDIANIA2wDjAOoA8QD3APwA/wD/AP0A+ADxAOcA3QDSAMcAuwCvAKMAlACFAHQAYQBPADwAKgAZAAoA/P/u/+H/1P/I/7z/sP+m/57/mP+U/5L/k/+U/5b/mf+d/6L/p/+v/7j/wv/P/9z/6//5/wcAFQAiADAAPQBLAFoAaAB2AIQAkACbAKUArQC0ALkAvgDCAMUAyADJAMkAxwDEAL4AuACwAKgAnwCVAIwAggB3AGwAYABTAEUAOAArAB4AEwAIAP7/9P/r/+P/2//T/8z/x//C/8D/vv++/7//wf/E/8j/zP/R/9b/3f/l/+7/+P8CAA0AFwAiACwANwBBAEsAVQBfAGkAcgB7AIMAigCQAJUAmQCcAJ8AoQCiAKIAogCgAJ4AmgCVAI8AiQCCAHsAcwBrAGMAWwBSAEkAPwA2ACwAIwAaABIACwAEAP3/9//y/+3/6P/k/+L/4P/f/9//4P/h/+T/5//q/+7/8//4//7/BAALABMAGwAjACsAMgA6AEIASQBQAFcAXgBlAGsAcQB2AHoAfgCBAIMAhQCGAIYAhgCFAIQAggB/AHsAdwByAG0AaABiAFwAVgBPAEkAQgA7ADQALgAnACEAGwAVABAACwAHAAMAAAD9//r/+f/3//f/9//4//n/+//9/wAAAwAHAAsADwAUABkAHwAlACoAMAA2ADwAQQBHAEwAUQBWAFsAXwBjAGcAagBtAG8AcABxAHIAcgByAHEAcABuAGwAaQBmAGIAXgBaAFYAUQBNAEgAQwA+ADkANAAvACoAJgAiAB4AGgAWABMAEQAOAAwACwAJAAkACAAJAAkACgAMAA4AEAATABUAGAAcAB8AIwAnACsAMAA0ADgAPABBAEUASQBMAFAAUwBWAFkAWwBeAF8AYQBiAGMAYwBjAGIAYgBhAF8AXQBbAFkAVgBTAFAATQBKAEYAQwA/ADwAOAA0ADEALQAqACcAJAAhAB8AHQAbABkAGAAXABYAFgAWABYAFgAXABgAGgAcAB0AIAAiACUAJwAqAC0AMAAzADYAOgA9AEAAQwBFAEgASwBNAE8AUQBTAFQAVgBXAFcAWABYAFgAVwBXAFYAVQBTAFIAUABOAEwASgBHAEUAQgA/AD0AOgA3ADUAMgAwAC0AKwApACcAJQAkACIAIQAgACAAHwAfAB8AHwAgACAAIQAjACQAJQAnACkAKwAtAC8AMQAzADYAOAA6ADwAPwBBAEMARQBHAEgASgBLAE0ATgBOAE8ATwBQAFAAUABPAE8ATgBNAD8APwBAAEEAQQBCAEMAQwBDAEQARABEAEQARABEAEQAQwBDAEIAQgBBAEAAPwA/AD4APQA8ADsAOgA5ADgANwA2ADUANQA0ADMAMwAyADEAMQAxADAAMAAwADAAMAAwADAAMQAxADIAMgAzADMANAA1ADUANgA3ADgAOAA5ADoAOwA8ADwAPQA+AD4APwA/AEAAQABBAEEAQQBBAEEAQQBBAEEAQQBAAEAAQAA/AD8APgA+AD0APAA8ADsAOgA6ADkAOAA4ADcANgA2ADUANQA0ADQAMwAzADMAMwAzADMAMwAzADMAMwAzADMANAA0ADQANQA1ADYANwA3ADgAOAA5ADkAOgA7ADsAPAA8AD0APQA+AD4APgA+AD8APwA/AD8APwA/AD4APgA+AD4APgA9AD0APQA9ADwAPAA7ADsAOwA6ADoAOQA5ADkAOAA4ADgAOAA3ADcANwA3ADcANwA3ADcANwA3ADcANwA3ADcANwA4ADgAOAA4ADgAOAA5ADkAOQA5ADkAOQA5ADoAOgA6ADoAOgA6ADoAOgA6ADoAOgA6ADoAOgA6ADoAOgA6ADoAOgA6ADoAOgA6ADoAOgA5ADkAOQA5ADkAOQA5ADkAOQA5ADkAOQA5ADkAOQA5AA=="
  };
  /*@@/EMBED*/

  var DURATION = {
    "ui-click-1.wav": 100, "ui-click-2.wav": 100, "ui-click-3.wav": 100,
    "ui-hover-1.wav": 160, "ui-hover-2.wav": 160,
    "ui-back-1.wav": 240, "ui-back-2.wav": 240,
    "score-1.wav": 520, "score-2.wav": 520, "score-3.wav": 520,
    "catch-1.wav": 360, "catch-2.wav": 360, "catch-3.wav": 360,
    "error-1.wav": 420, "error-2.wav": 420,
    "land-1.wav": 300, "land-2.wav": 300, "land-3.wav": 300,
    "glitch-1.wav": 400, "glitch-2.wav": 400, "glitch-3.wav": 400,
    "warn-1.wav": 460, "warn-2.wav": 460,
    "start-1.wav": 640, "start-2.wav": 640,
    "success-1.wav": 820, "success-2.wav": 820,
    "toggle-1.wav": 170, "toggle-2.wav": 170
  };

  // 各类音效的默认响度（打击类压低，提示类适中）
  var GAIN = {
    click: 0.72, hover: 0.5, back: 0.72, toggle: 0.6,
    score: 0.85, catch: 0.85, success: 0.85, start: 0.8,
    error: 0.7, warn: 0.75, land: 0.7, glitch: 0.6
  };

  /* ---------- 状态 ---------- */
  var MUTE_KEY = "rtsx.sfx.muted";
  var PREF_KEY = "rtsx.sfx.pref";
  var VOL_KEY = "rtsx.sfx.vol";

  var muted = false, master = 0.75;
  var prefs = {};
  var lastPick = {};
  var pools = {};        // file -> [HTMLAudioElement, ...]
  var POOL_SIZE = 2;
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
    var src = EMBED[file] ? ("data:audio/wav;base64," + EMBED[file]) : url(file);
    for (var i = 0; i < POOL_SIZE; i++) {
      var a = new Audio();
      a.preload = "auto";
      a.src = src;
      if (!EMBED[file]) a.load();
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
    var g = (GAIN[group] == null ? 0.8 : GAIN[group]);
    var vol = Math.max(0, Math.min(1, master * g * (o.volume == null ? 1 : o.volume)));
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

  /* 试听某个具体文件：走同一套池子，第一次之后就是秒出 */
  function preview(file, group) {
    if (!file) return null;
    if (muted) return file;
    var el = freeElement(file);
    var g = (GAIN[group] == null ? 0.8 : GAIN[group]);
    try {
      el.volume = Math.max(0, Math.min(1, master * g));
      el.currentTime = 0;
      var pr = el.play();
      if (pr && pr.catch) pr.catch(function () {});
    } catch (e) { return file; }
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
        var fired = false;
        // 按下就响，不等 click（click 要等手指抬起，听着像延迟）
        n.addEventListener("pointerdown", function () { fired = true; play(clickKey); });
        n.addEventListener("click", function () { if (!fired) play(clickKey); fired = false; });
        n.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { fired = true; play(clickKey); }
        });
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
    preview: preview,
    warm: function (file) { buildPool(file); return file; },
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

  // 常用音在脚本执行时就开始预取（不等 window.load，否则首批点击还在下载）
  preload(["click", "hover", "toggle", "back", "start"]);

  function boot() { bind(document); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
