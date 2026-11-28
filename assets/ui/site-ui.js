/*!
 * RTSX Site UI —— 站点级菜单 / 设置 / 搜索（单文件，零依赖）
 *
 * 用法：在任意“页面外壳”里加两行即可（不要放进游戏内页面）
 *   <link rel="stylesheet" href="assets/ui/site-ui.css">
 *   <script src="assets/ui/site-ui.js" data-surface="light"></script>
 *
 * data-surface: light | dark  —— 声明该页面本身的明暗基调，决定样式与可用外观项
 *
 * 对外接口：
 *   RTSXUI.open("menu"|"settings"|"search")   RTSXUI.close()
 *   RTSXUI.get() / RTSXUI.set({...}) / RTSXUI.reset()
 *   RTSXUI.settingsCard()   返回设置卡片 DOM（独立页用）
 *   RTSXUI.toast("…")
 */
(function () {
  "use strict";
  if (window.RTSXUI) return;

  /* ---------- 0. 路径与配置 ---------- */
  var TAG = document.currentScript;
  if (!TAG) {
    var ss = document.getElementsByTagName("script");
    for (var i = ss.length - 1; i >= 0; i--) {
      if (ss[i].src && ss[i].src.indexOf("site-ui.js") !== -1) { TAG = ss[i]; break; }
    }
  }
  var SRC = (TAG && TAG.src) || "assets/ui/site-ui.js";
  var BASE = SRC.replace(/site-ui\.js(\?[^#]*)?(#.*)?$/, "");
  if (!/^(https?|file|\/)/.test(BASE)) BASE = "assets/ui/";
  var ROOT = BASE.replace(/assets\/ui\/$/, "");
  var ICONS = ROOT + "assets/icons/";
  var SURFACE = (TAG && TAG.getAttribute("data-surface")) || "light";
  var CAN_THEME = SURFACE === "light";

  function ico(name) { return ICONS + name + ".svg"; }
  function img(name, cls) {
    return '<img src="' + ico(name) + '" alt=""' + (cls ? ' class="' + cls + '"' : "") + " draggable=\"false\">";
  }

  /* ---------- 1. 偏好 ---------- */
  var KEY = "rtsx.ui.v1";
  var DEF = {
    theme: "auto", accent: "clay", radius: "std", fs: "std",
    motion: "full", density: "std",
    hotkeys: true, haptics: true, dock: true, fullbtn: true,
    lang: "zh"
  };
  var ACCENTS = {
    clay:   { c: "#D97757", d: "#B8542F", s: "rgba(217,119,87,.14)", zh: "陶土", en: "Clay" },
    moss:   { c: "#6E9276", d: "#4E7357", s: "rgba(110,146,118,.14)", zh: "苔绿", en: "Moss" },
    indigo: { c: "#5A78B4", d: "#3F5D96", s: "rgba(90,120,180,.13)", zh: "靛蓝", en: "Indigo" },
    plum:   { c: "#8C6BAE", d: "#6D4D8F", s: "rgba(140,107,174,.13)", zh: "紫藤", en: "Plum" },
    ink:    { c: "#6B6560", d: "#4A4540", s: "rgba(107,101,96,.13)", zh: "石墨", en: "Graphite" }
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function read() {
    var p = {};
    for (var k in DEF) p[k] = DEF[k];
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        for (var k2 in o) if (k2 in DEF && o[k2] !== null && o[k2] !== undefined) p[k2] = o[k2];
        if (!(p.accent in ACCENTS)) p.accent = DEF.accent;
      }
    } catch (e) {}
    return p;
  }
  var P = read();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {}
  }

  function sysDark() {
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; }
  }

  function apply() {
    if (!document.documentElement) return;
    var h = document.documentElement;
    var theme = CAN_THEME ? (P.theme === "auto" ? (sysDark() ? "dark" : "light") : P.theme) : "dark";
    h.setAttribute("data-rtsx-theme", theme);
    h.setAttribute("data-rtsx-radius", P.radius);
    h.setAttribute("data-rtsx-fs", P.fs);
    h.setAttribute("data-rtsx-motion", P.motion === "full" ? "full" : P.motion);
    h.setAttribute("data-rtsx-density", P.density);
    h.setAttribute("data-rtsx-can-theme", CAN_THEME ? "1" : "0");
    var a = ACCENTS[P.accent] || ACCENTS.clay;
    h.style.setProperty("--ui-accent", a.c);
    h.style.setProperty("--ui-accent-ink", a.d);
    h.style.setProperty("--ui-accent-soft", a.s);
    if (CAN_THEME) {
      h.style.setProperty("--ui-brand", a.c);
      h.style.setProperty("--ui-brand-ink", a.d);
    }
    var col = theme === "dark" ? "#131210" : "#F4F1EA";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", col);
  }

  /* 声音偏好与 SoundKit 共享同一组键 */
  var SFX_MUTE = "rtsx.sfx.muted", SFX_VOL = "rtsx.sfx.vol";
  function sfxVol() {
    var v = 0.75;
    try { var s = parseFloat(localStorage.getItem(SFX_VOL)); if (!isNaN(s) && s >= 0 && s <= 1) v = s; } catch (e) {}
    return v;
  }
  function setSfxVol(v) {
    v = clamp(v, 0, 1);
    try { localStorage.setItem(SFX_VOL, String(v)); } catch (e) {}
    try { if (window.RTSXSFX && RTSXSFX.setVolume) RTSXSFX.setVolume(v); } catch (e) {}
  }
  function sfxMuted() {
    try { return localStorage.getItem(SFX_MUTE) === "1"; } catch (e) { return false; }
  }
  function setSfxMuted(m) {
    try { localStorage.setItem(SFX_MUTE, m ? "1" : "0"); } catch (e) {}
    try { if (window.RTSXSFX && RTSXSFX.mute) RTSXSFX.mute(m); } catch (e) {}
  }

  /* ---------- 2. 文案 ---------- */
  function T(zh, en) { return P.lang === "en" ? en : zh; }

  /* ---------- 3. 站点目录 ---------- */
  var PAGES = [
    { id: "home",   g: "entry", i: "home",     h: "index.html",                 zh: "大厅",          en: "Lobby",        dz: "全部作品入口",           de: "Everything in one place" },
    { id: "67",     g: "entry", i: "cube",     h: "games/67/index.html",        zh: "67 专辑",       en: "67 Album",     dz: "3D 小游戏合集 · 收集 67", de: "3D mini-game collection", tag: "3D" },
    { id: "2040k",  g: "entry", i: "monitor",  h: "games/2040k/index.html",     zh: "2040K 画质",    en: "2040K Visuals", dz: "池核 / PPUBBG / 漫游",   de: "Poolcore, FPS, walkthrough", tag: "3D" },
    { id: "text",   g: "entry", i: "games",    h: "TextGame/index.html",        zh: "67-3A大作",     en: "67 Blockbuster", dz: "第一人称 3D 大作",       de: "First-person 3D" },
    { id: "mc",     g: "entry", i: "grid",     h: "games/Minecaraft/index.html",zh: "我的世界 网页版", en: "Minecraft Web", dz: "PE 触屏 / 1.21.11 锁鼠标", de: "PE touch and 1.21.11", tag: "MC" },
    { id: "icons",  g: "res",   i: "palette",  h: "icons.html",                 zh: "图标库",        en: "Icon library", dz: "58 个站点图标 · 本地精简集", de: "58 site icons", tag: "NEW" },
    { id: "sfx",    g: "res",   i: "wave",     h: "assets/sfx/index.html",      zh: "音效实验室",    en: "Sound lab",    dz: "离线音效试听与选择",      de: "Preview offline SFX" },
    { id: "flow",   g: "res",   i: "wand",     h: "assets/fourier-flow.html",   zh: "傅里叶曲线",    en: "Fourier flow", dz: "进度条组件参考",         de: "Progress component" },
    { id: "setting",g: "site",  i: "settings", h: "settings.html",              zh: "设置中心",      en: "Settings",     dz: "外观 / 声音 / 语言 / 数据", de: "Appearance, sound, data" },
    { id: "about",  g: "site",  i: "info",     h: "settings.html#about",        zh: "关于本站",      en: "About",        dz: "版本、图标包与许可",      de: "Version, icon pack, license" }
  ];
  var GROUPS = [
    { id: "entry", zh: "作品", en: "Works" },
    { id: "res",   zh: "资源", en: "Resources" },
    { id: "site",  zh: "站点", en: "Site" }
  ];
  var RECENT_KEY = "rtsx.ui.recent";

  function href(p) { return ROOT + p; }
  function pageName(p) { return T(p.zh, p.en); }
  function curId() {
    var path = location.pathname.replace(/\/index\.html$/, "/").replace(/\/+$/, "");
    for (var i = 0; i < PAGES.length; i++) {
      var ph = (ROOT + PAGES[i].h).replace(/#.*$/, "");
      var abs = new URL(ph, location.href).pathname.replace(/\/index\.html$/, "/").replace(/\/+$/, "");
      if (abs === path) return PAGES[i].id;
    }
    return "";
  }
  function recent() {
    try {
      var r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(r) ? r.slice(0, 4) : [];
    } catch (e) { return []; }
  }
  function pushRecent(id) {
    if (!id) return;
    var r = recent().filter(function (x) { return x !== id; });
    r.unshift(id);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 4))); } catch (e) {}
  }

  /* ---------- 4. 小工具 ---------- */
  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  var toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = h("div", "ritoast");
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove("on"); }, 1900);
  }
  function buzz(ms) {
    if (!P.haptics) return;
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) {}
  }

  /* ---------- 5. 外壳：遮罩 / 坞 / 面板 ---------- */
  var scrim = null, dock = null, menu = null, setPanel = null, pal = null;
  var openStack = [];

  function ensureShell() {
    if (scrim) return;
    scrim = h("div", "rtsx-scrim");
    scrim.addEventListener("click", function () { closeTop(); });
    document.body.appendChild(scrim);

    dock = h("div", "rdock");
    dock.setAttribute("role", "toolbar");
    dock.setAttribute("aria-label", T("站点工具栏", "Site toolbar"));
    dock.innerHTML =
      btn("menu", "menu", T("菜单", "Menu")) +
      btn("search", "search", T("搜索", "Search")) +
      '<div class="rsep"></div>' +
      btn("settings", "settings", T("设置", "Settings")) +
      (CAN_THEME ? btn("light", "theme", T("切换主题", "Toggle theme")) : "") +
      (P.fullbtn ? btn("monitor", "full", T("全屏", "Fullscreen")) : "");
    document.body.appendChild(dock);

    dock.addEventListener("click", function (ev) {
      var b = ev.target.closest(".rbtn");
      if (!b) return;
      buzz();
      var act = b.getAttribute("data-act");
      if (act === "menu") open("menu");
      else if (act === "search") open("search");
      else if (act === "settings") open("settings");
      else if (act === "theme") toggleTheme();
      else if (act === "full") toggleFull();
    });
    dock.addEventListener("pointerdown", function () { dock.removeAttribute("data-idle"); });
    if (P.dock === false) dock.style.display = "none"; // 兼容旧值

    // 游戏模态打开时收起坞，保证“游戏内没有站点 UI”
    watchGame();
    syncDock();
  }

  function btn(icon, act, tip) {
    return '<button class="rbtn" type="button" data-act="' + act + '" data-tip="' + tip + '" aria-label="' + tip + '">' +
      img(icon) + "</button>";
  }

  function watchGame() {
    var gm = document.getElementById("game-modal");
    if (!gm || !window.MutationObserver) return;
    var mo = new MutationObserver(syncDock);
    mo.observe(gm, { attributes: true, attributeFilter: ["aria-hidden", "class", "style"] });
  }
  function gameOpen() {
    var gm = document.getElementById("game-modal");
    if (!gm) return false;
    var hid = gm.getAttribute("aria-hidden");
    if (hid === "false") return true;
    return gm.classList.contains("on") || gm.classList.contains("open");
  }
  function syncDock() {
    if (!dock) return;
    dock.style.display = (gameOpen() || P.dock === false) ? "none" : "";
    var tbtn = dock.querySelector('[data-act="theme"]');
    if (tbtn) tbtn.style.display = CAN_THEME ? "" : "none";
    if (document.body) {
      var narrow = window.innerWidth <= 760;
      document.body.classList.toggle("rtsx-dock-pad", narrow && !gameOpen() && P.dock !== false);
    }
  }

  function toggleTheme() {
    if (!CAN_THEME) { toast(T("当前页面固定为深色", "This page is fixed to dark")); return; }
    var now = document.documentElement.getAttribute("data-rtsx-theme") === "dark" ? "light" : "dark";
    P.theme = now; save(); apply(); syncDock();
    toast(now === "dark" ? T("已切换到深色", "Dark theme on") : T("已切换到浅色", "Light theme on"));
  }
  function toggleFull() {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    } catch (e) { toast(T("当前浏览器不允许全屏", "Fullscreen blocked")); }
  }

  function scrimOn(on) {
    if (!scrim) return;
    scrim.classList.toggle("on", on);
    document.documentElement.style.overflow = on ? "hidden" : "";
  }

  function track(node, name) {
    openStack = openStack.filter(function (x) { return x.node !== node; });
    openStack.push({ node: node, name: name });
  }
  function untrack(node) {
    openStack = openStack.filter(function (x) { return x.node !== node; });
    if (!openStack.length) scrimOn(false);
  }
  function closeTop() {
    var top = openStack[openStack.length - 1];
    if (top) close(top.name);
  }

  /* ---------- 6. 抽屉菜单 ---------- */
  function buildMenu() {
    var cur = curId();
    var el = h("aside", "rpanel rmenu");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", T("站点菜单", "Site menu"));

    var head = h("div", "rhead");
    head.innerHTML =
      '<span class="itile lg" style="background:linear-gradient(155deg,#E2916F,#D97757 60%,#C4603F)">' +
        '<span style="font-family:Georgia,serif;font-weight:700;font-size:18px;color:#fff;line-height:1">R</span>' +
      "</span>" +
      '<span class="rhead-txt"><span class="rt">RTSX</span><span class="rs">' + T("站点导航", "Navigate") + "</span></span>" +
      '<button class="rclose" type="button" aria-label="' + T("关闭", "Close") + '">' + img("close") + "</button>";
    el.appendChild(head);

    var body = h("div", "rbody");
    el.appendChild(body);

    var rec = recent().filter(function (id) { return id !== cur; });
    if (rec.length) {
      body.appendChild(secHead(T("最近打开", "Recent")));
      var chips = h("div", "chips");
      rec.forEach(function (id) {
        var p = PAGES.filter(function (x) { return x.id === id; })[0];
        if (!p) return;
        var c = h("a", "chip");
        c.href = href(p.h);
        c.innerHTML = '<span class="itile">' + img(p.i) + "</span><span>" + pageName(p) + "</span>";
        c.addEventListener("click", function () { pushRecent(p.id); close("menu"); });
        chips.appendChild(c);
      });
      body.appendChild(chips);
    }

    GROUPS.forEach(function (g) {
      var items = PAGES.filter(function (p) { return p.g === g.id; });
      if (!items.length) return;
      body.appendChild(secHead(T(g.zh, g.en)));
      items.forEach(function (p) { body.appendChild(row(p, cur)); });
    });

    var foot = h("div", "rfoot");
    foot.innerHTML = '<img src="' + ico("shield") + '" width="13" height="13" alt="" style="filter:invert(1) opacity(.5)">' +
      "<span>" + T("图标 ", "Icons ") + "<b>58</b> · " + T("站点自用", "site set") + "</span>";
    el.appendChild(foot);

    head.querySelector(".rclose").addEventListener("click", function () { close("menu"); });
    el.addEventListener("keydown", trapTab);
    el.querySelectorAll("a.mrow").forEach(function (a) {
      a.addEventListener("click", function () {
        pushRecent(a.getAttribute("data-pid"));
        close("menu");
      });
    });
    return el;
  }

  function secHead(txt) {
    var e = h("div", "sec-t", "<span>" + txt + "</span><em></em>");
    return e;
  }

  function row(p, cur, compact) {
    var a = h("a", "mrow");
    a.href = href(p.h);
    a.setAttribute("data-pid", p.id);
    var isCur = p.id === cur;
    a.innerHTML =
      '<span class="itile sm">' + img(p.i) + "</span>" +
      '<span class="mtx"><span class="mn">' + pageName(p) + '</span>' +
      '<span class="md">' + T(p.dz, p.de) + "</span></span>" +
      (isCur ? '<span class="mtag">' + T("当前", "Now") + "</span>"
             : (p.tag ? '<span class="mtag">' + p.tag + "</span>" : "")) +
      '<span class="mgo">' + img("right") + "</span>";
    a.setAttribute("aria-current", isCur ? "page" : "false");
    return a;
  }

  function openMenu() {
    ensureShell();
    if (!menu) { menu = buildMenu(); document.body.appendChild(menu); }
    else { document.body.replaceChild(buildMenu(), menu); menu = document.body.lastChild; }
    menu.classList.add("on");
    scrimOn(true);
    track(menu, "menu");
    setTimeout(function () { menu.querySelector(".rclose").focus(); }, 60);
  }

  /* ---------- 7. 设置面板 ---------- */
  function settingsBody() {
    var wrap = h("div", "rbody");
    wrap.appendChild(tabsBar());
    wrap.appendChild(panesBlock());
    return wrap;
  }

  var TABS = [
    { id: "look",   i: "palette",  zh: "外观", en: "Look" },
    { id: "sound",  i: "volume",   zh: "声音", en: "Sound" },
    { id: "input",  i: "mouse",    zh: "交互", en: "Input" },
    { id: "lang",   i: "globe",    zh: "语言", en: "Language" },
    { id: "data",   i: "storage",  zh: "数据", en: "Data" },
    { id: "about",  i: "info",     zh: "关于", en: "About" }
  ];
  var activeTab = "look";

  function tabsBar() {
    var bar = h("div", "rtabs");
    bar.setAttribute("role", "tablist");
    TABS.forEach(function (t) {
      var b = h("button", "rtab");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("data-tab", t.id);
      b.setAttribute("aria-selected", t.id === activeTab ? "true" : "false");
      b.innerHTML = img(t.i, "") + "<span>" + T(t.zh, t.en) + "</span>";
      b.addEventListener("click", function () {
        activeTab = t.id;
        bar.querySelectorAll(".rtab").forEach(function (x) {
          x.setAttribute("aria-selected", x.getAttribute("data-tab") === activeTab ? "true" : "false");
        });
        var panes = bar.parentNode.querySelectorAll(".rpane");
        panes.forEach(function (p) { p.classList.toggle("on", p.getAttribute("data-pane") === activeTab); });
      });
      bar.appendChild(b);
    });
    return bar;
  }

  function panesBlock() {
    var box = h("div");
    TABS.forEach(function (t) {
      var pane = h("div", "rpane" + (t.id === activeTab ? " on" : ""));
      pane.setAttribute("data-pane", t.id);
      pane.setAttribute("role", "tabpanel");
      pane.innerHTML = PANE[t.id] ? PANE[t.id]() : "";
      box.appendChild(pane);
    });
    box.addEventListener("click", onPaneClick);
    box.addEventListener("input", onPaneInput);
    box.addEventListener("change", onPaneInput);
    return box;
  }

  function frow(icon, title, hint, control) {
    return '<div class="frow"><span class="itile sm">' + img(icon) + "</span>" +
      '<span class="fl"><span class="fn">' + title + "</span>" +
      (hint ? '<span class="fh">' + hint + "</span>" : "") + "</span>" +
      '<span class="fc">' + control + "</span></div>";
  }
  function seg(name, opts, val) {
    var s = '<span class="seg" data-seg="' + name + '">';
    opts.forEach(function (o) {
      s += '<button type="button" data-val="' + o.v + '" aria-pressed="' + (String(o.v) === String(val) ? "true" : "false") + '">' + o.t + "</button>";
    });
    return s + "</span>";
  }
  function sw(name, on) {
    return '<button type="button" class="sw" role="switch" aria-checked="' + (on ? "true" : "false") + '" data-sw="' + name + '" aria-label="' + name + '"></button>';
  }

  var PANE = {};

  PANE.look = function () {
    var a = ACCENTS[P.accent] || ACCENTS.clay;
    var dots = '<span class="dots">';
    Object.keys(ACCENTS).forEach(function (k) {
      dots += '<button type="button" class="dot" data-accent="' + k + '" aria-pressed="' + (k === P.accent ? "true" : "false") +
        '" style="background:' + ACCENTS[k].c + '" aria-label="' + T(ACCENTS[k].zh, ACCENTS[k].en) + '"></button>';
    });
    dots += "</span>";
    var html = "";
    if (CAN_THEME) {
      html += frow("light", T("主题", "Theme"),
        T("跟随系统时会自动切换", "Follows the system when set to auto"),
        seg("theme", [{ v: "light", t: T("浅色", "Light") }, { v: "dark", t: T("深色", "Dark") }, { v: "auto", t: T("跟随", "Auto") }], P.theme));
    }
    html += frow("palette", T("强调色", "Accent"), T("只影响站点外壳，不改作品画面", "Affects site chrome only"),
      dots);
    html += frow("quarter", T("圆角", "Radius"),
      T("面板与按钮的圆润程度", "Roundness of panels and buttons"),
      seg("radius", [{ v: "s", t: T("紧凑", "Sharp") }, { v: "std", t: T("标准", "Std") }, { v: "l", t: T("圆润", "Round") }], P.radius));
    html += frow("document", T("字号", "Text size"),
      T("站点文字大小，不影响游戏内 HUD", "Site text only; game HUD untouched"),
      seg("fs", [{ v: "s", t: T("小", "S") }, { v: "std", t: T("标准", "M") }, { v: "l", t: T("大", "L") }], P.fs));
    html += frow("expand", T("动效", "Motion"),
      T("面板进出与过渡的动画强度", "Animation intensity"),
      seg("motion", [{ v: "full", t: T("完整", "Full") }, { v: "lite", t: T("精简", "Lite") }, { v: "off", t: T("关闭", "Off") }], P.motion));
    html += frow("grid", T("界面密度", "Density"),
      T("列表与设置项的间距", "Spacing in lists"),
      seg("density", [{ v: "std", t: T("标准", "Std") }, { v: "c", t: T("紧凑", "Compact") }], P.density));
    if (!CAN_THEME) {
      html += '<div class="note">' + T("此页面本身是深色视觉，主题开关已停用；外观设置会在可切换主题的页面立即生效。", "This page is art-directed dark; theme switching is disabled here.") + "</div>";
    }
    return html;
  };

  PANE.sound = function () {
    var v = sfxVol();
    var pct = Math.round(v * 100);
    return frow("volume", T("界面音量", "Interface volume"),
      T("点击、悬停等站点音效，与游戏内音量互不影响", "Site SFX only; in-game volume is separate"),
      '<input class="slider" type="range" min="0" max="100" step="1" value="' + pct + '" data-vol style="--p:' + pct + '%" aria-label="' + T("界面音量", "Volume") + '">' +
      '<span class="val" data-volval>' + pct + "%</span>") +
      frow("mute", T("界面音效", "Interface sound"), T("关闭后站点不再播放任何提示音", "Silence all site SFX"), sw("mute", !sfxMuted())) +
      frow("wave", T("试听", "Preview"), T("播放一段点击音，确认音量合适", "Play a click to check"),
        '<button type="button" class="rbtn2" data-try>' + img("wave") + T("试听", "Play") + "</button>") +
      '<div class="note">' + T("作品内部的音量由各作品自己控制；这里的设置只作用于站点外壳的提示音。", "Inside works, each game owns its audio. This only controls site chrome sounds.") + "</div>";
  };

  PANE.input = function () {
    return frow("keyboard", T("快捷键", "Hotkeys"), T("Ctrl/⌘ + K 搜索，Esc 关闭面板", "Ctrl/Cmd+K to search, Esc to close"), sw("hotkeys", P.hotkeys)) +
      frow("mouse", T("触屏震动", "Haptics"), T("支持的设备上按下按钮会有轻微反馈", "Light feedback on supported devices"), sw("haptics", P.haptics)) +
      frow("menu", T("悬浮工具栏", "Floating dock"), T("关闭后仍可用快捷键与直达设置页", "Hide the dock; hotkeys still work"), sw("dock", P.dock)) +
      frow("monitor", T("全屏按钮", "Fullscreen button"), T("在工具栏上显示全屏开关", "Show fullscreen toggle in the dock"), sw("fullbtn", P.fullbtn));
  };

  PANE.lang = function () {
    return frow("globe", T("站点语言", "Site language"),
      T("只翻译菜单与设置，作品内容保持原样", "Chrome only; works keep their language"),
      seg("lang", [{ v: "zh", t: "中文" }, { v: "en", t: "English" }], P.lang)) +
      '<div class="note">' + T("切换后菜单与设置面板立即重建，不需要刷新。", "The menu and settings rebuild instantly.") + "</div>";
  };

  PANE.data = function () {
    var bytes = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("rtsx.") === 0) bytes += (localStorage.getItem(k) || "").length + k.length;
      }
    } catch (e) {}
    return frow("download", T("导出配置", "Export"), T("下载一份 JSON，换设备时可导入", "Download a JSON copy"),
        '<button type="button" class="rbtn2" data-exp>' + img("download") + T("导出", "Export") + "</button>") +
      frow("upload", T("导入配置", "Import"), T("读取之前导出的 JSON", "Load a previously exported JSON"),
        '<button type="button" class="rbtn2" data-imp>' + img("upload") + T("选择文件", "Choose") + "</button>") +
      frow("reset", T("恢复默认", "Reset"), T("外观、声音、交互全部回到初始值", "All preferences back to defaults"),
        '<button type="button" class="rbtn2" data-reset>' + img("reset") + T("恢复", "Reset") + "</button>") +
      frow("trash", T("清除本站数据", "Clear site data"), T("包含记录与音效偏好，不可撤销", "Includes history and SFX prefs"),
        '<button type="button" class="rbtn2 danger" data-wipe>' + img("trash") + T("清除", "Clear") + "</button>") +
      '<div class="note">' + T("本地占用约 ", "Local usage about ") + "<b>" + (bytes < 1024 ? bytes + " B" : (bytes / 1024).toFixed(1) + " KB") +
      "</b> · " + T("全部存在浏览器 localStorage，不上传任何服务器。", "Stored in localStorage only, never uploaded.") + "</div>";
  };

  PANE.about = function () {
    return '<div class="kv">' +
      "<b>" + T("版本", "Version") + "</b><span>RTSX Site UI 1.0 · " + T("外壳组件", "chrome kit") + "</span>" +
      "<b>" + T("图标", "Icons") + "</b><span>assets/icons · 58 个 SVG</span>" +
      "<b>" + T("许可", "License") + "</b><span>" + T("允许个人与商业使用、无需署名；禁止转售图标包本身", "Free for personal and commercial use; resale of the pack is not allowed") + "</span>" +
      "<b>" + T("范围", "Scope") + "</b><span>" + T("只在页面外壳生效，游戏画面内不注入任何站点 UI", "Chrome only; no site UI inside games") + "</span>" +
      "</div>" +
      '<div class="sec-t" style="padding-left:0"><span>' + T("快捷键", "Shortcuts") + "</span><em></em></div>" +
      '<div class="kbds">' +
      kbd("Ctrl / ⌘ + K", T("搜索面板", "Command palette")) +
      kbd("Esc", T("关闭最上层面板", "Close top panel")) +
      kbd("Ctrl / ⌘ + ,", T("打开设置", "Open settings")) +
      kbd("F", T("全屏切换（非输入状态）", "Fullscreen when not typing")) +
      "</div>" +
      '<div class="note">' + T("设置页也可以直接访问 ", "Settings page also lives at ") + "<b>settings.html</b>；" +
      T("图标库在 ", "icon library at ") + "<b>icons.html</b>。</div>";
  };
  function kbd(k, t) { return '<div class="kbd"><kbd>' + k + "</kbd><span>" + t + "</span></div>"; }

  function onPaneClick(ev) {
    var b = ev.target.closest("button");
    if (!b) return;
    var segEl = b.closest(".seg");
    if (segEl) {
      var name = segEl.getAttribute("data-seg"), val = b.getAttribute("data-val");
      segEl.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-pressed", "true");
      setPref(name, val);
      return;
    }
    if (b.hasAttribute("data-sw")) { togglePref(b.getAttribute("data-sw")); return; }
    if (b.hasAttribute("data-accent")) { P.accent = b.getAttribute("data-accent"); commit(true); return; }
    if (b.hasAttribute("data-try")) {
      try {
        if (window.RTSXSFX) RTSXSFX.play("click");
        else toast(T("此页未加载音效组件", "SoundKit not loaded here"));
      } catch (e) { toast(T("播放失败", "Playback failed")); }
      return;
    }
    if (b.hasAttribute("data-exp")) { exportPrefs(); return; }
    if (b.hasAttribute("data-imp")) { importPrefs(); return; }
    if (b.hasAttribute("data-reset")) { resetAll(); return; }
    if (b.hasAttribute("data-wipe")) { wipeAll(); return; }
  }

  function onPaneInput(ev) {
    var t = ev.target;
    if (t.hasAttribute && t.hasAttribute("data-vol")) {
      var v = clamp(parseFloat(t.value) / 100, 0, 1);
      t.style.setProperty("--p", Math.round(v * 100) + "%");
      var lab = t.parentNode.querySelector("[data-volval]");
      if (lab) lab.textContent = Math.round(v * 100) + "%";
      setSfxVol(v);
      if (ev.type === "change") toast(T("音量已保存", "Volume saved"));
    }
  }

  function setPref(name, val) {
    if (name === "lang") {
      P.lang = val; save();
      rebuildSettings();
      rebuildMenu();
      return;
    }
    P[name] = val; commit(true);
  }
  function togglePref(name) {
    P[name] = !P[name]; commit(true);
  }
  function commit(buzzIt) {
    save(); apply(); syncDock();
    if (buzzIt) buzz();
    // 开关与分段需要刷新状态
    var bar = document.querySelector(".rset .rtabs");
    if (bar) {
      var box = bar.parentNode;
      var scroll = box.querySelector(".rpane.on") ? box.querySelector(".rpane.on").scrollTop : 0;
      rebuildSettings();
      var np = box.querySelector(".rpane.on");
      if (np) np.scrollTop = scroll;
    } else if (document.querySelector(".rpage .panelcard")) {
      rebuildInlineSettings();
    }
  }

  function exportPrefs() {
    var obj = { app: "rtsx-site-ui", version: 1, prefs: P, sfx: { volume: sfxVol(), muted: sfxMuted() } };
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rtsx-settings.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1200);
    toast(T("已导出", "Exported"));
  }
  function importPrefs() {
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "application/json,.json";
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var o = JSON.parse(String(fr.result));
          var pre = o.prefs || o;
          Object.keys(DEF).forEach(function (k) {
            if (k in pre) P[k] = pre[k];
          });
          if (!(P.accent in ACCENTS)) P.accent = DEF.accent;
          if (o.sfx) {
            if (typeof o.sfx.volume === "number") setSfxVol(o.sfx.volume);
            if (typeof o.sfx.muted === "boolean") setSfxMuted(o.sfx.muted);
          }
          save(); apply(); rebuildSettings(); rebuildMenu();
          toast(T("配置已导入", "Imported"));
        } catch (e) { toast(T("文件解析失败", "Bad file")); }
      };
      fr.readAsText(f);
    });
    inp.click();
  }
  function resetAll() {
    P = {}; for (var k in DEF) P[k] = DEF[k];
    save(); apply(); rebuildSettings(); rebuildMenu();
    toast(T("已恢复默认", "Defaults restored"));
  }
  function wipeAll() {
    if (!window.confirm(T("清除本站保存的所有设置与记录？此操作不可撤销。", "Clear all saved settings and history? This cannot be undone."))) return;
    try {
      var ks = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("rtsx.") === 0) ks.push(k);
      }
      ks.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    P = {}; for (var k2 in DEF) P[k2] = DEF[k2];
    apply(); rebuildSettings(); rebuildMenu();
    toast(T("已清除", "Cleared"));
  }

  function buildSettings() {
    var el = h("aside", "rpanel rset");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", T("设置", "Settings"));
    var head = h("div", "rhead");
    head.innerHTML = '<span class="itile lg">' + img("settings") + "</span>" +
      '<span class="rhead-txt"><span class="rt">' + T("设置", "Settings") + '</span><span class="rs">' + T("站点外壳", "SITE CHROME") + "</span></span>" +
      '<button class="rclose" type="button" aria-label="' + T("关闭", "Close") + '">' + img("close") + "</button>";
    el.appendChild(head);
    el.appendChild(settingsBody());
    head.querySelector(".rclose").addEventListener("click", function () { close("settings"); });
    el.addEventListener("keydown", trapTab);
    return el;
  }
  function rebuildSettings() {
    if (!setPanel) return;
    var host = setPanel.parentNode;
    var wasOpen = setPanel.classList.contains("on");
    var fresh = buildSettings();
    host.replaceChild(fresh, setPanel);
    setPanel = fresh;
    if (wasOpen) setPanel.classList.add("on");
  }
  function rebuildMenu() {
    if (!menu) return;
    var host = menu.parentNode, on = menu.classList.contains("on");
    var fresh = buildMenu();
    host.replaceChild(fresh, menu);
    menu = fresh;
    if (on) menu.classList.add("on");
  }

  function openSettings() {
    ensureShell();
    if (!setPanel) { setPanel = buildSettings(); document.body.appendChild(setPanel); }
    else if (!setPanel.parentNode) document.body.appendChild(setPanel);
    setPanel.classList.add("on");
    scrimOn(true);
    track(setPanel, "settings");
    setTimeout(function () { var c = setPanel.querySelector(".rclose"); if (c) c.focus(); }, 60);
  }

  /* ---------- 8. 命令面板 ---------- */
  function buildPal() {
    var el = h("div", "rpal rpanel");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", T("搜索", "Search"));
    el.innerHTML =
      '<div class="rsearch">' + img("search") +
      '<input type="text" placeholder="' + T("搜索页面、作品或操作…", "Search pages, works, actions…") + '" aria-label="' + T("搜索", "Search") + '">' +
      '<span class="rk">ESC</span></div>' +
      '<div class="rlist"></div>' +
      '<div class="rfoot2"><span>' + T("回车打开", "Enter to open") + "</span><span>" + T("共 ", "Total ") + (PAGES.length + 4) + T(" 项", " items") + "</span></div>";
    var input = el.querySelector("input");
    var list = el.querySelector(".rlist");
    var cur = 0, results = [];

    function actions() {
      return [
        { i: "settings", zh: "打开设置", en: "Open settings", dz: "外观、声音、数据", de: "Look, sound, data", act: function () { open("settings"); } },
        { i: "light", zh: "切换明暗", en: "Toggle theme", dz: "浅色 / 深色", de: "Light or dark", act: toggleTheme },
        { i: "monitor", zh: "全屏", en: "Fullscreen", dz: "切换浏览器全屏", de: "Toggle fullscreen", act: toggleFull },
        { i: "home", zh: "回到大厅", en: "Back to lobby", dz: "站点首页", de: "Site home", act: function () { location.href = href("index.html"); } }
      ];
    }

    function render(q) {
      q = (q || "").trim().toLowerCase();
      var pool = PAGES.map(function (p) {
        return { i: p.i, zh: p.zh, en: p.en, dz: p.dz, de: p.de, k: "PAGE", go: function () { pushRecent(p.id); location.href = href(p.h); } };
      }).concat(actions());
      results = pool.filter(function (it) {
        if (!q) return true;
        var hay = (it.zh + " " + it.en + " " + it.dz + " " + it.de).toLowerCase();
        return q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
      });
      cur = 0;
      list.innerHTML = "";
      if (!results.length) {
        list.appendChild(h("div", "rempty", T("没有匹配的结果", "Nothing matched")));
        return;
      }
      results.forEach(function (it, idx) {
        var b = h("button", "pitem");
        b.type = "button";
        b.setAttribute("data-cur", idx === 0 ? "1" : "0");
        b.innerHTML = '<span class="itile sm">' + img(it.i) + "</span>" +
          '<span class="ptx"><span class="pn">' + T(it.zh, it.en) + '</span><span class="pd">' + T(it.dz, it.de) + "</span></span>" +
          '<span class="pk">' + (it.k || "") + "</span>";
        b.addEventListener("click", function () { run(idx); });
        list.appendChild(b);
      });
    }
    function mark() {
      list.querySelectorAll(".pitem").forEach(function (x, i) { x.setAttribute("data-cur", i === cur ? "1" : "0"); });
      var on = list.querySelector('.pitem[data-cur="1"]');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
    }
    function run(i) {
      var it = results[i];
      if (!it) return;
      close("search");
      if (it.go) it.go(); else if (it.act) it.act();
    }

    input.addEventListener("input", function () { render(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (cur < results.length - 1) { cur++; mark(); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (cur > 0) { cur--; mark(); } }
      else if (e.key === "Enter") { e.preventDefault(); run(cur); }
    });
    render("");
    return el;
  }
  function openPal() {
    ensureShell();
    if (pal && pal.parentNode) pal.parentNode.removeChild(pal);
    pal = buildPal();
    document.body.appendChild(pal);
    pal.classList.add("on");
    scrimOn(true);
    track(pal, "search");
    setTimeout(function () { var i = pal.querySelector("input"); if (i) i.focus(); }, 40);
  }

  /* ---------- 9. 焦点与快捷键 ---------- */
  function trapTab(e) {
    if (e.key !== "Tab") return;
    var box = e.currentTarget;
    var f = Array.prototype.filter.call(box.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'), function (x) {
      return x.offsetParent !== null;
    });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function onKey(e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "k" || e.key === "K")) { e.preventDefault(); open("search"); return; }
    if (mod && e.key === ",") { e.preventDefault(); open("settings"); return; }
    if (e.key === "Escape" && openStack.length) { e.preventDefault(); closeTop(); return; }
    if (!mod && !e.altKey && P.hotkeys) {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if ((e.key === "f" || e.key === "F")) { if (!document.fullscreenElement) { toggleFull(); } }
    }
  }

  /* ---------- 10. 公共接口 ---------- */
  function open(what) {
    if (what === "menu") openMenu();
    else if (what === "settings") openSettings();
    else if (what === "search") openPal();
  }
  function close(what) {
    var node = what === "menu" ? menu : what === "settings" ? setPanel : what === "search" ? pal : null;
    if (!node) return;
    node.classList.remove("on");
    untrack(node);
    (function (n) {
      setTimeout(function () {
        if (n && n.parentNode && !n.classList.contains("on")) n.parentNode.removeChild(n);
      }, 400);
    })(node);
    if (what === "menu") menu = null;
    if (what === "settings") setPanel = null;
    if (what === "search") pal = null;
  }

  /* 独立设置页：把同一份设置卡片放进来 */
  function settingsCard() {
    var card = h("div", "panelcard");
    var head = h("div", "rhead");
    head.innerHTML = '<span class="itile">' + img("settings") + "</span>" +
      '<span class="rhead-txt"><span class="rt">' + T("设置", "Settings") + '</span><span class="rs">' + T("站点外壳", "SITE CHROME") + "</span></span>";
    card.appendChild(head);
    card.appendChild(settingsBody());
    return card;
  }

  function mountInline(container) {
    var card = settingsCard();
    container.innerHTML = "";
    container.appendChild(card);
    container._inline = card;
  }
  function rebuildInlineSettings() {
    var card = document.querySelector(".rpage .panelcard");
    if (!card) return;
    var fresh = settingsCard();
    card.parentNode.replaceChild(fresh, card);
  }

  /* ---------- 11. 启动 ---------- */
  function boot() {
    apply();
    ensureShell();
    document.addEventListener("keydown", onKey);
    try {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq && mq.addEventListener) mq.addEventListener("change", function () { if (P.theme === "auto") { apply(); syncDock(); } });
    } catch (e) {}

    // 深链：?ui=settings / ?ui=menu / ?ui=search
    var q = location.search;
    if (/(^|[?&])ui=(settings|menu|search)(&|$)/.test(q)) {
      var which = q.replace(/^.*ui=(settings|menu|search).*$/, "$1");
      setTimeout(function () { open(which); }, 120);
    }
    if (location.hash === "#about") {
      activeTab = "about";
      setTimeout(function () { open("settings"); }, 120);
    }
    // 记录最近访问
    pushRecent(curId());
    // 自动隐藏坞
    var idle = 0;
    function poke() {
      if (!dock) return;
      dock.removeAttribute("data-idle");
      clearTimeout(idle);
      idle = setTimeout(function () { if (dock) dock.setAttribute("data-idle", "1"); }, 6500);
    }
    poke();
    window.addEventListener("pointermove", poke, { passive: true });
    window.addEventListener("keydown", poke);
    window.addEventListener("resize", function () { syncDock(); });
  }

  window.RTSXUI = {
    version: "1.0",
    open: open,
    close: function () { while (openStack.length) closeTop(); },
    get: function () { return JSON.parse(JSON.stringify(P)); },
    set: function (o) { for (var k in o) if (k in DEF) P[k] = o[k]; save(); apply(); syncDock(); },
    apply: apply,
    reset: resetAll,
    toast: toast,
    settingsCard: settingsCard,
    mountInline: mountInline,
    ids: { prefs: KEY, volume: SFX_VOL, muted: SFX_MUTE }
  };

  if (document.readyState === "loading") {
    // 尽早应用主题，避免闪白
    apply();
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    apply();
    boot();
  }
})();
