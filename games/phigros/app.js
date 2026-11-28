'use strict';
/* =============================================================================
 * app.js —— 界面流程：主菜单 / 选曲 / 设置 / 游玩 / 结算
 * 引擎在 game.js（window.PG），这里只做 DOM 与状态管理。
 * ========================================================================== */
(() => {
  const { Game, SfxBank, loadAssets, SFX_FILES } = window.PG;
  const $ = id => document.getElementById(id);

  const DEFAULT_SETTINGS = {
    offsetMs: 0,
    musicVolume: 85,
    hitVolume: 65,
    hitSound: true,
    noteSpeed: 1,
    bgDim: 55,
    lineAlpha: 100,
    showSync: true,
    autoPause: false,
    rotateHint: true,
    quality: 'auto',         // auto | high | smooth：画布分辨率档位，手机掉帧时降档
    // 电脑键位：tap 五个键从左到右对应谱面的五列（黄键按列接住），flick 是划动键
    keyMap: { tap: ['KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK'], flick: 'ArrowUp' }
  };
  const DEFAULT_KEYMAP = { tap: ['KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK'], flick: 'ArrowUp' };
  const KEY_NAMES = {
    Space: 'SPACE', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT', AltRight: 'R-ALT', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP',
    Escape: 'ESC', Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
    CapsLock: 'CAPS'
  };
  function keyName(code) {
    if (!code) return '—';
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    if (code.indexOf('Key') === 0) return code.slice(3);
    if (code.indexOf('Digit') === 0) return code.slice(5);
    if (code.indexOf('Numpad') === 0) return 'NUM' + code.slice(6);
    return code;
  }
  function normalizeKeymap(km) {
    const src = (km && typeof km === 'object') ? km : {};
    const tap = (Array.isArray(src.tap) ? src.tap : DEFAULT_KEYMAP.tap)
      .map(c => String(c || '')).slice(0, 5);
    while (tap.length < 5) tap.push(DEFAULT_KEYMAP.tap[tap.length]);
    return { tap, flick: String(src.flick || DEFAULT_KEYMAP.flick) };
  }
  const LS_SETTINGS = 'pg.settings.v1';
  const LS_SCORES = 'pg.scores.v1';
  const MENU_BG = 'assets/menu-bg.webp';

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (_) { return fallback; }
  }
  function saveJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {}
  }

  let settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON(LS_SETTINGS, {}));
  settings.keyMap = normalizeKeymap(settings.keyMap);
  let scores = loadJSON(LS_SCORES, {});

  let songs = [];
  let images = null;
  let sfx = null;
  let game = null;
  let currentScreen = 'menuScreen';
  let settingsFrom = 'menuScreen';   // 设置界面从哪来：'menuScreen' 或 null（游玩暂停中）
  let sel = { song: 0, level: 0 };
  // 排序方式：照原版 songSelect 的 sortMode（默认 / 难度 / 名称），默认「名称」
  const SORT_MODES = [['default', '默认'], ['level', '难度'], ['name', '名称']];
  let sortOrder = 2;
  let currentBlobUrl = null;
  let audioSrc = null;
  let busy = false;

  /* ---------------- 背景音乐：主菜单 / 结算 ---------------- */
  // 原版在开始页和结算页各有一轨音乐。浏览器禁止「没操作就自动播」，
  // 所以统一等第一次点击 / 按键之后再起播，之后进出界面自行接上。
  let menuBgm = null, resultBgm = null, bgmUnlocked = false;

  function bgmLevel(k) { return Math.max(0, Math.min(1, (settings.musicVolume / 100) * k)); }
  function ensureBgm() {
    if (!menuBgm) {
      menuBgm = new Audio('assets/audio/menu.ogg');
      menuBgm.loop = true; menuBgm.preload = 'auto'; menuBgm.volume = bgmLevel(0.75);
    }
    if (!resultBgm) {
      resultBgm = new Audio('assets/audio/result.ogg');
      resultBgm.loop = true; resultBgm.preload = 'auto'; resultBgm.volume = bgmLevel(0.85);
    }
    window.__bgm = Object.assign(window.__bgm || {}, { menu: menuBgm, result: resultBgm });   // 调试用，正式逻辑不读它
  }
  function playMenuBgm() {
    if (game) return;                       // 打歌或暂停里不放菜单曲
    ensureBgm();
    menuBgm.volume = bgmLevel(0.75);
    if (menuBgm.paused) {
      const p = menuBgm.play();
      if (p && p.catch) p.catch(() => {});  // 被自动播放策略拦了就等第一次操作
    }
  }
  function stopMenuBgm() { if (menuBgm && !menuBgm.paused) menuBgm.pause(); }
  function playResultBgm() {
    ensureBgm();
    resultBgm.volume = bgmLevel(0.85);
    try { resultBgm.currentTime = 0; } catch (_) {}
    const p = resultBgm.play();
    if (p && p.catch) p.catch(() => {});
  }
  function stopResultBgm() {
    if (!resultBgm) return;
    resultBgm.pause();
    try { resultBgm.currentTime = 0; } catch (_) {}
  }
  /** 第一次用户操作之后把「欠着的」音乐补上（结算页也一样） */
  function unlockBgm() {
    bgmUnlocked = true;
    ensureBgm();
    if ($('resultOverlay').classList.contains('show')) {
      if (resultBgm && resultBgm.paused) playResultBgm();
    } else if (currentScreen === 'selectScreen') {
      playPreview(currentSong());
    } else if (currentScreen !== null) {
      playMenuBgm();
    }
  }

  /* ---------------- 选曲预览曲 ---------------------------- */
  // 原版选歌界面是「选中哪首就放哪首」，主菜单那轨不进选曲页。
  let previewBgm = null, previewCode = null;
  function playPreview(song) {
    if (!song || !song.music) return;
    ensureBgm();
    if (!previewBgm || previewCode !== song.code) {
      if (previewBgm) { previewBgm.pause(); previewBgm.removeAttribute('src'); previewBgm.load(); }
      previewBgm = new Audio(song.music);
      previewBgm.loop = true; previewBgm.preload = 'auto';
      previewCode = song.code;
      window.__bgm.preview = previewBgm;
    }
    previewBgm.volume = bgmLevel(0.8);
    if (previewBgm.paused) {
      try { previewBgm.currentTime = 0; } catch (_) {}
      const p = previewBgm.play();
      if (p && p.catch) p.catch(() => {});
    }
  }
  function stopPreview() {
    if (previewBgm && !previewBgm.paused) previewBgm.pause();
  }

  /* ---------------- 小工具 ---------------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let toastTimer = 0;
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2600);
  }
  function hideToast() { $('toast').classList.remove('show'); }

  /**
   * 两个全屏版式都要按「真实可视区」算缩放，不能用 100vw / 100vh：
   * 手机浏览器地址栏会吃掉一块高度（100vh 比看得见的高度大），用 vh 缩放会把底部裁掉；
   * 窗口拖动 / 旋转屏幕时也必须重算，否则比例会停在打开那一刻。
   */
  function layoutScales() {
    const vv = window.visualViewport;
    const vw = Math.round((vv && vv.width) || document.documentElement.clientWidth || window.innerWidth);
    const vh = Math.round((vv && vv.height) || document.documentElement.clientHeight || window.innerHeight);
    if (!vw || !vh) return;
    const selEl = $('selectScreen');
    if (selEl) {
      // 版式照原版：不放大、左上角贴屏幕左边（退出按钮才不会被切），
      // 右边那几块（曲绘 / 底栏 / 开始键）固定尺寸靠右贴边，多出来的宽度全给曲绘去出血。
      const ss = Math.min(vw / 1239, vh / 891, 1);
      const ex = Math.max(0, vw / ss - 1239);      // 比 1239 宽出来的部分（设计像素）
      selEl.style.setProperty('--ss', ss.toFixed(4));
      selEl.style.setProperty('--ssex', ex.toFixed(1) + 'px');
      // 窄屏照原版 1239 版式；宽屏把多出来的宽度让给曲绘，右边几块保持原尺寸贴右边缘
      /* 宽屏：曲绘整张铺到屏幕右缘（右锚定斜切，不再靠出血把画面切掉） */
      selEl.style.setProperty('--artx', (ex > 1 ? 1239 + ex - 928 : 470).toFixed(1) + 'px');
      selEl.style.setProperty('--artw', (ex > 1 ? 928 : 800).toFixed(0) + 'px');
      selEl.style.setProperty('--barx', (ex > 1 ? 1239 + ex - 958 : 323).toFixed(1) + 'px');
      selEl.style.setProperty('--barw', (ex > 1 ? 958 : 916).toFixed(0) + 'px');
    }
    const ov = $('resultOverlay');
    if (ov) {
      // 横屏口径照原版 LevelOver：面板固定 800×300（我们的设计画布 774×300），
      // 只在小窗口才缩，超大窗口也不放大 —— 之前按 967×620 放大会比原版大 24%
      // 竖屏走「上曲绘 + 下分数块」的竖排版式，字号跟屏宽走
      const rs = vh > vw
        ? vw / 774
        : Math.min(1, (vw * 0.82) / 774, (vh * 0.66) / 300);
      ov.style.setProperty('--rs', rs.toFixed(4) + 'px');
    }
    window.__layout = { vw, vh };
  }
  window.addEventListener('resize', () => layoutScales(), { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => layoutScales(), { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(layoutScales, 120));

  function showScreen(id) {
    currentScreen = id;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === id));
    layoutScales();
    layoutScales();
    document.body.classList.toggle('playing', id === null);
    // 主菜单 / 设置 / 玩法指引沿用网页版入口插画作为背景
    document.body.classList.toggle('at-menu', id === 'menuScreen' || id === 'settingsScreen' || id === 'guideScreen');
    document.body.classList.toggle('at-select', id === 'selectScreen');
    if (id === 'menuScreen' || id === 'guideScreen') setBackground(MENU_BG);
    if (id !== null) {
      document.body.classList.remove('playing');
      hideAllOverlays();
    }
    // 主菜单曲只在主菜单响；选曲页放选中曲目的预览；进游戏（id === null）两轨都停
    if (id === null) { stopMenuBgm(); stopPreview(); }
    else if (id === 'menuScreen') { stopPreview(); if (!game) playMenuBgm(); }
    else if (id === 'selectScreen') { stopMenuBgm(); if (!game) playPreview(currentSong()); }
    else if (id === 'guideScreen') { if (!game) playMenuBgm(); }
    else if (id === 'settingsScreen' && !game && settingsFrom === 'menuScreen') playMenuBgm();
  }
  function hideAllOverlays() {
    ['pauseOverlay', 'resultOverlay'].forEach(id => $(id).classList.remove('show'));
    stopResultBgm();
  }

  /**
   * 设置界面有两个入口：主菜单、以及游玩中暂停面板。
   * 从暂停进来的，关闭后必须回到暂停浮层，不能把玩家甩回主菜单。
   */
  function openSettings(from) {
    settingsFrom = from;
    $('settingsBack').textContent = from === null ? '返回游戏' : '关闭';
    syncSettingsUI();
    showScreen('settingsScreen');
  }
  function closeSettings() {
    const backToGame = settingsFrom === null;
    showScreen(settingsFrom);
    if (backToGame) {
      $('pauseOverlay').classList.add('show');
      $('pauseBtn').classList.add('paused');
    }
    settingsFrom = 'menuScreen';
  }

  /* ---------------- 横屏建议 ----------------
   * 竖屏时判定线与音符被压得太窄，这里给一次友好提示；
   * 游玩途中转成竖屏会先暂停，转回来再继续，绝不吞掉进度。
   * ------------------------------------------ */
  const mqPortrait = window.matchMedia('(orientation: portrait)');
  const mqCoarse = window.matchMedia('(pointer: coarse)');
  let hintOpen = false;
  let hintPausedGame = false;
  let hintDismissed = false;         // 本次会话内已选择继续竖屏

  function isPortraitNow() {
    return mqPortrait.matches || window.innerHeight > window.innerWidth;
  }
  /** 只对手机/平板这类真正能旋转的设备提示，桌面临时拉窄窗口不打扰 */
  function isHandheld() {
    if (mqCoarse.matches) return true;
    const s = Math.min(window.screen.width || 0, window.screen.height || 0);
    return s > 0 && s <= 820;
  }
  function needLandscapeHint() {
    return !!settings.rotateHint && isPortraitNow() && isHandheld();
  }

  function openRotateHint() {
    if (hintOpen) return;
    hintOpen = true;
    hintPausedGame = false;
    if (game && game.running && !game.paused) {
      togglePause();                 // 复用暂停逻辑，保证时钟、覆盖层状态一致
      hintPausedGame = true;
    }
    $('rotateHint').classList.add('show');
    document.body.classList.add('rotate-hint');
  }

  function closeRotateHint() {
    if (!hintOpen) return;
    hintOpen = false;
    $('rotateHint').classList.remove('show');
    document.body.classList.remove('rotate-hint');
    const resume = hintPausedGame && game && game.running && game.paused;
    hintPausedGame = false;
    if (resume) togglePause();
  }

  function checkOrientation(isInitial) {
    if (!needLandscapeHint()) { closeRotateHint(); return; }
    if (hintOpen || hintDismissed) return;
    const playing = game && game.running;
    if (playing || isInitial) openRotateHint();
  }

  let rotTimer = 0;
  function scheduleOrientationCheck(delay) {
    clearTimeout(rotTimer);
    rotTimer = setTimeout(() => checkOrientation(false), delay || 140);
  }
  function bindOrientation() {
    $('rotateHintClose').addEventListener('click', () => {
      hintDismissed = true;
      closeRotateHint();
    });
    $('rotateHintNever').addEventListener('click', () => {
      settings.rotateHint = false;
      applySettings();
      syncSettingsUI();
      closeRotateHint();
      toast('已关闭横屏提示');
    });
    window.addEventListener('resize', () => scheduleOrientationCheck(140));
    window.addEventListener('orientationchange', () => scheduleOrientationCheck(360));
    if (window.screen && screen.orientation && screen.orientation.addEventListener) {
      screen.orientation.addEventListener('change', () => scheduleOrientationCheck(360));
    }
  }

  /* ---------------- 背景曲绘 ---------------- */
  function setBackground(cover) {
    const url = 'url("' + cover + '")';
    if ($('bgArt').style.backgroundImage !== url) $('bgArt').style.backgroundImage = url;
  }

  /* ---------------- 音频准备：保证任何环境下都能精确 seek ---------------- */
  function waitMeta(audio, ms) {
    return new Promise(resolve => {
      if (audio.readyState >= 1) return resolve();
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        audio.removeEventListener('loadedmetadata', fin);
        resolve();
      };
      audio.addEventListener('loadedmetadata', fin);
      setTimeout(fin, ms || 8000);
    });
  }

  async function prepareAudio(src) {
    const audio = $('bgm');
    if (audioSrc === src && audio.readyState >= 1) return;
    audioSrc = src;
    audio.pause();
    // 先指向原文件：file:// 下 fetch 会被拦，但本地文件本身可 seek
    audio.src = src;
    audio.load();
    try {
      const res = await fetch(src, { cache: 'force-cache' });
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 1024) {
          if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
          currentBlobUrl = URL.createObjectURL(blob);
          audio.src = currentBlobUrl;
          audio.load();
        }
      }
    } catch (_) { /* 保持相对路径 */ }
    await waitMeta(audio);
    audio.volume = settings.musicVolume / 100;
  }

  /* ---------------- 谱面加载 ---------------- */
  // 谱面统一走 <曲目>/<难度>.js：里面是 base64(gzip(谱面))，由 gunzip.js 解回。
  // 用 <script> 注入而不是 fetch，file:// 双击打开和 http 服务都能用（fetch 在 file:// 会被 CORS 拦）。
  function loadChartScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => { s.parentNode && s.parentNode.removeChild(s); resolve(); };
      s.onerror = () => reject(new Error('无法读取谱面 ' + src));
      document.head.appendChild(s);
    });
  }

  async function loadChart(song, level) {
    window.__PG_CHARTS = window.__PG_CHARTS || {};
    const key = song.code + '|' + level.id;
    if (window.__PG_CHARTS[key] && window.__PG_CHARTS[key].judgeLineList) return window.__PG_CHARTS[key];
    const src = (level.js || level.chart.replace(/\.json$/i, '.js'));
    await loadChartScript(src);
    const rec = window.__PG_CHARTS[key];
    if (!rec) throw new Error('谱面数据缺失：' + src);
    const chart = rec.gz ? await PG_GZ.decode(rec.gz) : rec;
    window.__PG_CHARTS[key] = chart;
    return chart;
  }

  /* ---------------- 选曲列表 ---------------- */
  function currentSong() { return songs[sel.song]; }
  function currentLevel() { return currentSong().levels[sel.level]; }
  function scoreKey(song, level) { return song.code + '|' + level.id; }

  /** 按当前排序方式给出「歌曲下标」的顺序；口径照原版 SongList.setOrder：
   *  默认=原顺序、难度=当前难度等级从高到低（原版是 `a < b ? 1 : -1`）、名称=曲名字典序。 */
  function sortedIndices() {
    const idx = songs.map((_, i) => i);
    const mode = SORT_MODES[sortOrder][0];
    if (mode === 'level') {
      // 排序键取「行里显示的那个等级」，否则只有别的难度的曲子会按一个看不见的数字乱插
      const rankOf = (s) => {
        const lv = s.levels[sel.level] || s.levels[0];
        return lv && typeof lv.rank === 'number' ? lv.rank : -1;
      };
      idx.sort((a, b) => {
        const va = rankOf(songs[a]), vb = rankOf(songs[b]);
        return va < vb ? 1 : -1;
      });
    } else if (mode === 'name') {
      idx.sort((a, b) => (songs[a].name > songs[b].name ? 1 : -1));
    }
    return idx;
  }

  /** ↑↓ 换歌走「屏幕上下相邻」，排序变了也还是相邻那一首。 */
  function stepSong(d) {
    const idx = sortedIndices();
    const pos = idx.indexOf(sel.song);
    const next = idx[Math.max(0, Math.min(idx.length - 1, (pos < 0 ? 0 : pos) + d))];
    if (next === undefined || next === sel.song) return;
    selectSong(next);
  }

  function applySortOrder(i) {
    sortOrder = ((i === undefined ? sortOrder + 1 : i) % SORT_MODES.length + SORT_MODES.length) % SORT_MODES.length;
    const label = $('ssSortName');
    if (label) label.textContent = SORT_MODES[sortOrder][1];
    renderSongList();
    refreshSelectUI();
    // 重排后把选中的那首拉回列表中间，不然点一下排序当前曲目就跑到屏幕外了
    const list = $('songList'), active = document.querySelector('.ssRow.sel');
    if (list && active) list.scrollTop = Math.max(0, active.offsetTop - Math.round(list.clientHeight / 2));
  }

  function renderSongList() {
    const ul = $('songList');
    ul.innerHTML = '';
    const idxs = sortedIndices();
    idxs.forEach(i => {
      const s = songs[i];
      const li = document.createElement('li');
      li.className = 'ssRow';
      li.dataset.i = String(i);
      const lv = s.levels[sel.level] || s.levels[0];
      li.innerHTML =
        '<span class="n">' + esc(s.name) + '</span>' +
        '<span class="a">' + esc(s.artist) + '</span>' +
        '<span class="lv"><b>' + (lv ? lv.rank : '-') + '</b></span>';
      li.addEventListener('click', () => selectSong(i));
      ul.appendChild(li);
    });
    const label = $('ssSortName');
    if (label) label.textContent = SORT_MODES[sortOrder][1];
    const hint = $('ssHint');
    if (hint) hint.innerHTML = '共 <b>' + songs.length + '</b> 首 · 滚轮 / ↑↓ 换歌<br>←→ 换难度 · Enter 开始';
  }

  function selectSong(i, levelId) {
    sel.song = Math.max(0, Math.min(songs.length - 1, i));
    const song = currentSong();
    const prevLevel = levelId || (song.levels[sel.level] ? song.levels[sel.level].id : null);
    let idx = song.levels.findIndex(l => l.id === prevLevel);
    if (idx < 0) idx = 0;
    sel.level = idx;
    refreshSelectUI();
    if (currentScreen === 'selectScreen') playPreview(song);   // 选中哪首就放哪首
    sfx && sfx.play('ui');
  }

  function selectLevel(idx) {
    sel.level = Math.max(0, Math.min(currentSong().levels.length - 1, idx));
    // 按难度排序时，换难度等级等于换排序键，列表要跟着重排
    if (SORT_MODES[sortOrder][0] === 'level') renderSongList();
    refreshSelectUI();
    sfx && sfx.play('ui');
  }

  function refreshSelectUI() {
    const song = currentSong();
    const level = currentLevel();
    if (!song || !level) return;

    document.querySelectorAll('.ssRow').forEach(li => {
      const i = Number(li.dataset.i);
      const s = songs[i];
      if (!s) return;
      const lv = s.levels.find(l => l.id === level.id) || s.levels[0];
      li.classList.toggle('sel', i === sel.song);
      const nameEl = li.querySelector('.n');
      if (nameEl) {
        nameEl.textContent = s.name;
        // 长曲名缩字号，别整行被省略号吃掉（原版选曲也是长名自动变小）
        const long = s.name.length;
        nameEl.style.fontSize = i === sel.song
          ? (long > 12 ? '21px' : long > 9 ? '24px' : long > 7 ? '30px' : '')
          : '';
      }
      const num = li.querySelector('.lv b');
      if (num) num.textContent = lv ? lv.rank : '-';
      const artist = li.querySelector('.a');
      if (artist) artist.textContent = s.artist;
    });
    const active = document.querySelector('.ssRow.sel');
    if (active) {
      const list = $('songList');
      const top = active.offsetTop;
      if (top < list.scrollTop) list.scrollTo({ top: Math.max(0, top - 30), behavior: 'smooth' });
      else if (top + active.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTo({ top: top - list.clientHeight + active.offsetHeight + 30, behavior: 'smooth' });
    }

    $('selCover').src = song.cover;
    $('selArtist').innerHTML = esc(song.artist).replace(/\s*&\s*/g, '<br>');

    const lv = $('selLevels');
    lv.innerHTML = '';
    song.levels.forEach((l, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ssLv' + (i === sel.level ? ' on' : '');
      b.innerHTML = '<i>' + l.rank + '</i><u>' + esc(l.label) + '</u>';
      b.addEventListener('click', () => selectLevel(i));
      lv.appendChild(b);
    });

    const best = scores[scoreKey(song, level)];
    $('selScore').textContent = best ? String(best.score).padStart(7, '0') : '0000000';
    $('selAcc').textContent = best ? best.acc.toFixed(2) + '%' : '00.00%';
    $('selNew').classList.toggle('off', !!best);

    setBackground(song.cover);
  }

  /* ---------------- 判定线贴图（原版的「背景切换」）---------------- */
  // 原版 meta.json 的 lineTexture 指向一个 line.json：里面按 LineId 指名几根判定线，
  // 让它们整条换成一张图片（Vert/Horz 是缩放，IsDark 表示垫在压暗层下面）。
  // 拿不到就静默跳过 —— 其它曲目本来就没有这个文件。
  async function loadLineTex(song) {
    if (!song || !song.lineTex) return null;
    try {
      const res = await fetch(song.lineTex);
      if (!res.ok) return null;
      const list = await res.json();
      if (!Array.isArray(list) || !list.length) return null;
      const dir = song.lineTex.replace(/[^/]*$/, '');
      const out = [];
      for (const it of list) {
        const img = await PG.loadImage(dir + it.Image);
        if (!img || !img.width) continue;
        out.push({
          lineId: Number(it.LineId),
          img,
          vert: Number(it.Vert),
          horz: Number(it.Horz) || 1,
          dark: Number(it.IsDark) ? 1 : 0
        });
      }
      return out.length ? out : null;
    } catch (e) { return null; }
  }

  /* ---------------- 开始游玩 ---------------- */
  async function startPlay() {
    if (busy) return;
    const song = currentSong();
    const level = currentLevel();
    if (!song || !level) return;
    busy = true;
    if (sfx) sfx.prime();          // 点击就是用户手势，此处解锁音频管线，避免第一声延迟
    stopPreview();                 // 选曲预览曲先掐掉，别和谱面音乐叠在一起
    toast('正在加载 ' + song.name + ' …', 8000);
    try {
      const chart = await loadChart(song, level);
      const lineTex = await loadLineTex(song);
      await prepareAudio(song.music);
      if (game) { game.destroy(); game = null; }
      game = new Game({
        chart, song, level, images, sfx, settings, lineTex,
        onFinish: handleFinish,
        onJudge: handleJudge
      });
      game.onEscape = () => {
        // 设置 / 指引界面打开时，Escape 只负责关界面，不动游戏暂停状态
        if (currentScreen) return;
        togglePause();
      };
      window.__game = game;            // 便于调试与自动化验证
      game.applySettings(settings);
      game.clock.setOffset(settings.offsetMs);
      hideToast();
      showScreen(null);
      beginRound();
    } catch (e) {
      console.error(e);
      toast('加载失败：' + (e && e.message ? e.message : e));
    } finally {
      busy = false;
    }
  }

  function beginRound() {
    if (!game) return;
    const song = currentSong(), level = currentLevel();
    game.reset();
    game.clock.setOffset(settings.offsetMs);
    game.clock.seek(game.startAt);
    game.running = true;
    game.paused = false;
    game.ended = false;
    game.clock.play();
    game.applySettings(settings);
    hideAllOverlays();
    stopMenuBgm();
    stopPreview();
    stopResultBgm();
    document.body.classList.add('playing');
    $('songInfo').innerHTML = '<b>' + esc(song.name) + '</b><br>' + esc(level.label) + ' Lv.' + level.rank + ' · ' + Math.round(level.bpm) + ' BPM';
    $('pauseBtn').classList.remove('paused');
    sfx && sfx.play('ui');
  }

  function togglePause() {
    if (!game || !game.running) return;
    if (game.paused) {
      game.paused = false;
      game.clock.play();
      $('pauseOverlay').classList.remove('show');
      $('pauseBtn').classList.remove('paused');
    } else {
      game.paused = true;
      game.clock.pause();
      $('offsetPause').value = String(settings.offsetMs);
      $('pauseOverlay').classList.add('show');
      $('pauseBtn').classList.add('paused');
    }
    sfx && sfx.play('ui');
  }

  function quitToSelect() {
    if (game) {
      game.paused = true;
      game.clock.pause();
      game.running = false;
      game.destroy();          // 停掉渲染循环，回到选曲不再空转
      game = null;
      window.__game = null;
    }
    hideAllOverlays();
    showScreen('selectScreen');
    refreshSelectUI();
  }

  function handleJudge(grade, combo) {
    // HUD 的弹跳动画已经交给引擎在每帧统一处理（每帧最多一次），
    // 这里不再为每个音符读 offsetWidth 强制同步布局。
  }

  function handleFinish(res) {
    const song = currentSong(), level = currentLevel();
    const key = scoreKey(song, level);
    const best = scores[key];
    const isBetter = !best || res.score > best.score;
    if (isBetter) {
      scores[key] = { score: res.score, acc: res.acc, rank: res.rank, fc: res.fullCombo };
      saveJSON(LS_SCORES, scores);
    }

    // 版式照原版 LevelOver：左曲绘（斜切）、右分数块 + 两条细条，全部平行四边形。
    // 尺寸统一按 --rs（1 设计像素 = 多少屏幕像素）换算，窗口多大版式比例都不变。
    const overlay = $('resultOverlay');
    layoutScales();                  // --rs 交给 layoutScales，窗口变化后会跟着重算
    overlay.style.setProperty('--resArt', 'url("' + song.cover + '")');
    $('resultJacket').src = song.cover;
    overlay.dataset.rank = res.rank;

    $('resultSongName').textContent = song.name;
    $('resultSongMeta').textContent = level.label + ' Lv.' + level.rank;
    $('resultRank').textContent = res.rank === 'PHI' ? 'φ' : res.rank === 'FALSE' ? 'F' : res.rank;

    $('resultAcc').textContent = res.acc.toFixed(2) + '%';
    $('resultCombo').textContent = res.maxCombo;
    $('resPerfect').textContent = res.counts.PERFECT;
    $('resGood').textContent = res.counts.GOOD;
    $('resBad').textContent = res.counts.BAD;
    $('resMiss').textContent = res.counts.MISS;
    $('resEarly').textContent = res.early || 0;
    $('resLate').textContent = res.late || 0;
    $('resultFlag').textContent = res.allPerfect ? 'ALL PERFECT' : (res.fullCombo ? 'FULL COMBO' : '');
    $('resultNew').classList.toggle('show', !!isBetter);
    $('resultFoot').classList.toggle('show', !!(res.allPerfect || res.fullCombo || isBetter));

    stopMenuBgm();
    playResultBgm();                 // 结算曲（原版结算页那一轨）
    overlay.classList.add('show');

    // 分数滚动（纯 UI，动画不参与任何时间计算）
    const target = res.score;
    const t0 = performance.now();
    const dur = 720;
    (function tick() {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      const el = document.getElementById('resScore');
      if (el) el.textContent = String(Math.round(target * eased)).padStart(7, '0');
      if (k < 1) requestAnimationFrame(tick);
    })();
  }

  /* ---------------- 设置 ---------------- */
  /** 预览窗把「盲调」的四项变成看得见：背景暗度 / 判定线 / 流速 / 画质。 */
  function updatePreview() {
    const scene = $('spScene');
    if (!scene) return;
    const bg = $('bgArt').style.backgroundImage;
    if (bg) scene.style.setProperty('--sp-bg', bg);
    // 引擎里的映射：a0 = 0.02 + dim * 0.86（0 = 曲绘全亮，100 = 几乎全黑）
    $('spDim').style.opacity = String(0.02 + (settings.bgDim / 100) * 0.86);
    $('spLine').style.opacity = String(settings.lineAlpha / 100);
    scene.style.setProperty('--fall', (2.2 / (settings.noteSpeed || 1)).toFixed(2) + 's');

    const q = settings.quality || 'auto';
    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const cap = q === 'high' ? 3 : q === 'smooth' ? 1.25 : (coarse ? 1.5 : 2.5);
    const dpr = game ? game.dpr : Math.min(window.devicePixelRatio || 1, cap);
    const label = { smooth: '流畅', auto: '自动', high: '高清' }[q] || '自动';
    $('spTag').textContent = label + ' · ' + dpr.toFixed(2) + '×';
  }

  function applySettings(skipSave) {
    if (game) game.applySettings(settings);
    if (sfx) {
      sfx.enabled = settings.hitSound;
      sfx.setVolume(settings.hitVolume / 100);
    }
    const audio = $('bgm');
    if (!game) audio.volume = settings.musicVolume / 100;
    if (menuBgm) menuBgm.volume = bgmLevel(0.75);
    if (resultBgm) resultBgm.volume = bgmLevel(0.85);
    $('syncMonitor').style.display = settings.showSync ? '' : 'none';
    updatePreview();
    if (!skipSave) saveJSON(LS_SETTINGS, settings);
  }

  function syncSettingsUI() {
    $('setOffset').value = String(settings.offsetMs);
    $('offsetPause').value = String(settings.offsetMs);
    $('setMusicVol').value = String(settings.musicVolume);
    $('vMusicVol').textContent = String(settings.musicVolume);
    $('setHitVol').value = String(settings.hitVolume);
    $('vHitVol').textContent = String(settings.hitVolume);
    $('setSpeed').value = String(Math.round(settings.noteSpeed * 100));
    $('vSpeed').textContent = settings.noteSpeed.toFixed(2) + '×';
    $('setDim').value = String(settings.bgDim);
    $('vDim').textContent = String(settings.bgDim);
    $('setLine').value = String(settings.lineAlpha);
    $('vLine').textContent = String(settings.lineAlpha);
    $('setHitSound').classList.toggle('on', !!settings.hitSound);
    $('setSync').classList.toggle('on', !!settings.showSync);
    $('setAutoPause').classList.toggle('on', !!settings.autoPause);
    $('setRotateHint').classList.toggle('on', !!settings.rotateHint);
    const quality = settings.quality || 'auto';
    $('setQuality').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.q === quality));
    refreshKeySlots();
  }

  /* ---------------- 按键映射 ---------------- */
  let armedSlot = null;
  function refreshKeySlots() {
    const slots = document.querySelectorAll('.keySlot');
    for (let i = 0; i < slots.length; i++) {
      const b = slots[i], k = b.dataset.key;
      const code = k === 'flick' ? settings.keyMap.flick : settings.keyMap.tap[Number(k.slice(3))];
      b.textContent = (armedSlot === b) ? '按任意键' : keyName(code);
      b.classList.toggle('arm', armedSlot === b);
    }
  }

  function bindSettings() {
    const offsetApply = v => {
      settings.offsetMs = Math.max(-500, Math.min(500, Math.round(v)));
      $('setOffset').value = String(settings.offsetMs);
      $('offsetPause').value = String(settings.offsetMs);
      if (game) game.clock.setOffset(settings.offsetMs);
      applySettings();
    };
    $('setOffset').addEventListener('change', e => offsetApply(Number(e.target.value) || 0));
    $('offsetPause').addEventListener('change', e => offsetApply(Number(e.target.value) || 0));
    document.querySelectorAll('.stepBtn[data-off]').forEach(b => {
      b.addEventListener('click', () => offsetApply(settings.offsetMs + Number(b.dataset.off)));
    });

    $('setMusicVol').addEventListener('input', e => {
      settings.musicVolume = Number(e.target.value);
      $('vMusicVol').textContent = String(settings.musicVolume);
      applySettings();
    });
    $('setHitVol').addEventListener('input', e => {
      settings.hitVolume = Number(e.target.value);
      $('vHitVol').textContent = String(settings.hitVolume);
      applySettings();
      if (sfx && settings.hitSound) sfx.play('tap');
    });
    $('setSpeed').addEventListener('input', e => {
      settings.noteSpeed = Number(e.target.value) / 100;
      $('vSpeed').textContent = settings.noteSpeed.toFixed(2) + '×';
      applySettings();
    });
    $('setDim').addEventListener('input', e => {
      settings.bgDim = Number(e.target.value);
      $('vDim').textContent = String(settings.bgDim);
      applySettings();
    });
    $('setLine').addEventListener('input', e => {
      settings.lineAlpha = Number(e.target.value);
      $('vLine').textContent = String(settings.lineAlpha);
      applySettings();
    });
    $('setHitSound').addEventListener('click', () => {
      settings.hitSound = !settings.hitSound;
      $('setHitSound').classList.toggle('on', settings.hitSound);
      applySettings();
      if (settings.hitSound && sfx) sfx.play('tap');
    });
    $('setSync').addEventListener('click', () => {
      settings.showSync = !settings.showSync;
      $('setSync').classList.toggle('on', settings.showSync);
      applySettings();
    });
    $('setAutoPause').addEventListener('click', () => {
      settings.autoPause = !settings.autoPause;
      $('setAutoPause').classList.toggle('on', settings.autoPause);
      applySettings();
    });
    $('setRotateHint').addEventListener('click', () => {
      settings.rotateHint = !settings.rotateHint;
      $('setRotateHint').classList.toggle('on', settings.rotateHint);
      applySettings();
      hintDismissed = false;
      if (!settings.rotateHint) {
        closeRotateHint();
        toast('已关闭横屏提示');
      } else {
        toast('已开启横屏提示');
      }
    });
    $('setQuality').addEventListener('click', e => {
      const btn = e.target.closest('button[data-q]');
      if (!btn) return;
      settings.quality = btn.dataset.q;
      syncSettingsUI();
      applySettings();
      if (sfx) sfx.play('ui');
    });
    $('clearScores').addEventListener('click', () => {
      scores = {};
      saveJSON(LS_SCORES, scores);
      refreshSelectUI();
      toast('已清空成绩记录');
    });

    // 点格子 → 进入「按键…」状态，下一次键盘按下就是新键位。
    // 这里必须 stopImmediatePropagation：不然同一下按键会被选曲界面 / 引擎当成操作。
    const slotsWrap = $('keySlots');
    if (slotsWrap) {
      slotsWrap.addEventListener('click', e => {
        const b = e.target.closest('.keySlot');
        if (!b) return;
        armedSlot = (armedSlot === b) ? null : b;
        if (sfx) sfx.play('ui');
        refreshKeySlots();
      });
      window.addEventListener('keydown', e => {
        if (!armedSlot) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === 'Escape') { armedSlot = null; refreshKeySlots(); return; }
        const k = armedSlot.dataset.key;
        if (k === 'flick') settings.keyMap.flick = e.code;
        else settings.keyMap.tap[Number(k.slice(3))] = e.code;
        armedSlot = null;
        applySettings();
        syncSettingsUI();
        if (sfx) sfx.play('tap');
      }, true);
    }
    const keyResetBtn = $('keyReset');
    if (keyResetBtn) {
      keyResetBtn.addEventListener('click', () => {
        settings.keyMap = normalizeKeymap(DEFAULT_KEYMAP);
        armedSlot = null;
        applySettings();
        syncSettingsUI();
        toast('已恢复默认键位');
      });
    }

    $('resetSettings').addEventListener('click', () => {
      settings = Object.assign({}, DEFAULT_SETTINGS, { keyMap: normalizeKeymap(DEFAULT_KEYMAP) });
      armedSlot = null;
      applySettings();
      syncSettingsUI();
      toast('已恢复默认设置');
    });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindUI() {
    $('menuStart').addEventListener('click', () => {
      sfx && sfx.play('ui');
      showScreen('selectScreen');
      refreshSelectUI();
    });
    $('menuSettings').addEventListener('click', () => {
      sfx && sfx.play('ui');
      openSettings('menuScreen');
    });
    $('pauseSettingsBtn').addEventListener('click', () => {
      sfx && sfx.play('ui');
      openSettings(null);
    });
    $('menuGuide').addEventListener('click', () => {
      sfx && sfx.play('ui');
      showScreen('guideScreen');
    });
    $('guideBack').addEventListener('click', () => {
      sfx && sfx.play('ui');
      showScreen('menuScreen');
    });
    $('settingsBack').addEventListener('click', () => {
      sfx && sfx.play('ui');
      closeSettings();
    });
    $('selectBack').addEventListener('click', () => {
      sfx && sfx.play('ui');
      showScreen('menuScreen');
    });
    $('ssSettings').addEventListener('click', () => {
      sfx && sfx.play('ui');
      openSettings('selectScreen');
    });
    // 排序方式：原版是点一下循环「默认 → 难度 → 名称」
    $('ssSortName').addEventListener('click', e => {
      e.stopPropagation();
      sfx && sfx.play('ui');
      applySortOrder();
    });
    $('playBtn').addEventListener('click', startPlay);

    $('pauseBtn').addEventListener('click', togglePause);
    $('resumeBtn').addEventListener('click', togglePause);
    $('pauseRestartBtn').addEventListener('click', () => { hideAllOverlays(); beginRound(); });
    $('pauseQuitBtn').addEventListener('click', quitToSelect);
    $('resultRetryBtn').addEventListener('click', () => { hideAllOverlays(); beginRound(); });
    $('resultBackBtn').addEventListener('click', quitToSelect);

    // 选曲页的任何一次点击都顺手把预览曲补起来（自动播放策略拦了也能补救）
    document.addEventListener('pointerdown', () => {
      if (currentScreen === 'selectScreen' && previewBgm && previewBgm.paused) playPreview(currentSong());
    }, true);

    // 首次交互预热音频管线（仍是 <audio>，无 Web Audio）
    const prime = () => {
      if (sfx) sfx.prime();
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
    window.addEventListener('pointerdown', prime);
    window.addEventListener('keydown', prime);

    // 设置 / 玩法指引界面 Esc 返回。必须掐断同层后续监听：引擎的 keydown
    // 也监听 Escape，若让它收到，关闭设置的同一下会顺手把游戏取消暂停。
    window.addEventListener('keydown', e => {
      if (e.code !== 'Escape') return;
      if (currentScreen === 'settingsScreen') {
        e.preventDefault(); e.stopImmediatePropagation();
        sfx && sfx.play('ui');
        closeSettings();
      } else if (currentScreen === 'guideScreen') {
        e.preventDefault(); e.stopImmediatePropagation();
        sfx && sfx.play('ui');
        showScreen('menuScreen');
      }
    });

    // 选曲界面键盘操作
    window.addEventListener('keydown', e => {
      if (currentScreen !== 'selectScreen') return;
      if (e.code === 'ArrowDown') { e.preventDefault(); stepSong(1); }
      else if (e.code === 'ArrowUp') { e.preventDefault(); stepSong(-1); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); selectLevel(sel.level + 1); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); selectLevel(sel.level - 1); }
      else if (e.code === 'Enter') { e.preventDefault(); startPlay(); }
      else if (e.code === 'Escape') { showScreen('menuScreen'); }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        if (settings.autoPause && game && game.running && !game.paused) togglePause();
        return;
      }
      // 回到前台：直接按真实播放时间重新对齐，不做任何时间累加
      if (game && game.running && !game.paused) game.clock.syncBase();
    });

    bindOrientation();
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    applySettings(true);
    bindSettings();
    bindUI();
    syncSettingsUI();

    images = await loadAssets();
    sfx = new SfxBank(SFX_FILES, settings.hitVolume / 100);
    window.__sfx = sfx;
    sfx.enabled = settings.hitSound;

    songs = (window.__PG_SONGS && window.__PG_SONGS.songs) ? window.__PG_SONGS.songs : [];
    if (!songs.length) {
      try {
        const res = await fetch('songs.json', { cache: 'no-store' });
        if (res.ok) songs = (await res.json()).songs || [];
      } catch (_) {}
    }
    if (!songs.length) {
      toast('未找到 songs.json / songs.js，请先运行 build_songs.py', 999999);
      return;
    }

    renderSongList();
    sel.song = 0; sel.level = 0;
    refreshSelectUI();
    setBackground(songs[0].cover);
    showScreen('menuScreen');
    // 浏览器不允许无操作自动播放：第一次点击或按键后补放菜单曲
    const unlock = () => { if (!bgmUnlocked) unlockBgm(); };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    document.addEventListener('keydown', unlock, { once: true });
    checkOrientation(true);          // 竖屏首次进入时给一次横屏建议
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
