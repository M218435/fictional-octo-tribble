'use strict';
/* =============================================================================
 * Phigros 风格音游 —— 引擎
 *
 * 素材与谱面：https://mihoyo.wiki/Phigros/ 与 https://mihoyo.wiki/phigros-charts-repo/
 *
 * 硬性约束（不可改动）：
 *  1. 全场没有 Web Audio：不创建 AudioContext / OscillatorNode / AudioBufferSourceNode。
 *     音乐、打击音、UI 音效全部由预先存在的音频文件经 <audio> / Audio 播放。
 *  2. 每帧唯一时间来源是 AudioClock.chartTime()：以 audio.currentTime 为基准 +
 *     performance.now() 插值，100ms 抽检、偏差 >50ms 才重置基准。
 *  3. rAF 时间戳 / delta 累加 一律不参与音符位置、判定线动画与特效计算。
 *  4. 判定窗口：Perfect ±80ms / Good ±80~160ms / Bad ±160~180ms / Miss >180ms。
 * ========================================================================== */

const T_UNIT = 1.875;                       // 1T = 1.875 / BPM 秒（官方 128 分音符单位）
// 官方 judgeNote 的判定窗是「不对称」的：
//   早 160~200ms → Bad（按太早，音符掉下去）
//   早 80~160ms  → Good(Early)
//   早 40~80ms   → Perfect(Early)
//   ±40ms        → Perfect(Max)
//   晚 40~80ms   → Perfect(Late)
//   晚 80~160ms  → Good(Late)
//   晚 > 160ms   → 还没打就 Miss
// 所以 BAD 只存在于「提前按」这一侧，晚按超过 160ms 直接算 Miss，不是 Bad。
const WINDOWS = [0.08, 0.16, 0.2];
const LATE_MISS = 0.16;
// 黄键 / 红键的判定窗与判定宽度，取自官方模拟器的 judgeNote：
//   judgeNote(Renderer.drags,  t, 画布宽 * 0.117775)
//   judgeNote(Renderer.flicks, t, 画布宽 * 0.117775)
// 两者都只比「沿判定线方向」的距离（(x-x0)*cosr + (y-y0)*sinr），垂直方向不设限，
// 时间窗 ±0.16s，命中即 PERFECT —— 不像 Tap 那样分 Perfect/Good/Bad。
const DRAG_WINDOW = 0.16;
const JUDGE_WIDTH_RATIO = 0.117775;
// 红键要真的「划」一下：从按下点累计位移至少这么多像素才算划动。
// 只按时间窗判、又没有速度门槛时，点一下手指抖 2~3px 也会被当成一段划动 ——
// 这就是「红键点一下就行了」的来源。20px 能挡掉正常点按的抖动，又不影响短划。
const FLICK_MIN_TRAVEL = 20;
// 键盘键位：五个「虚拟手指」列 + 一个划动键，设置页面里可以逐个改。
// tap 的第 i 个键在判定线方向上算作 KEY_COLUMNS[i] 那一列，所以黄键能按列接住。
const DEFAULT_KEYMAP = {
  tap: ['KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK'],
  flick: 'ArrowUp'
};
const KEY_COLUMNS = [3, 5.5, 9, 12.5, 15];    // 18 等分里五根虚拟手指的横坐标
// Hold 的全部时间常数照官方（见 README 的「长条」一节）：
//  - **没有尾判**：不看松手准不准，只要求「尾到头之前，这一列上始终有手指」；
//    尾到判定线那一刻结算，手指还在就完成，按住不放也没事（原版可以一直按着）。
//  - 抬手保护 80ms（约 5 帧）：浏览器里手指落点/合成器有抖动，
//    0 宽限会让「刚按下去就被判松手」→ 打中了也只出 MISS，所以必须留一点。
const HOLD_REGRAB = 0.08;
const HOLD_LATE_MISS = 0.16; // 没按住的长条和 Tap 一样，超前 160ms 就 Miss（官方 judgeNote 第一段）
const NOTE_WEIGHT = { PERFECT: 1, GOOD: 0.65, BAD: 0.2, MISS: 0 };
const JUDGE_COLORS = {
  PERFECT: '#ffeca0', GOOD: '#b4e1ff', BAD: '#9aa6b8', MISS: '#fe4365'
};

const ASSET_FILES = {
  tap: 'assets/Tap.png',
  tapHL: 'assets/TapHL.png',
  drag: 'assets/Drag.png',
  dragHL: 'assets/DragHL.png',
  flick: 'assets/Flick.png',
  flickHL: 'assets/FlickHL.png',
  holdHead: 'assets/HoldHead.png',
  holdHeadHL: 'assets/HoldHeadHL.png',
  holdBody: 'assets/Hold.png',
  holdBodyHL: 'assets/HoldHL.png',
  holdEnd: 'assets/HoldEnd.png',
  line: 'assets/JudgeLine.png',
  click: 'assets/clickRaw.png',
  progress: 'assets/ProgressBar.png'
};

const SFX_FILES = {
  tap: 'assets/HitSong0.ogg',
  drag: 'assets/HitSong1.ogg',
  flick: 'assets/HitSong2.ogg',
  ui: 'assets/Tap1.wav'
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function ease(p, type) {
  p = clamp(p, 0, 1);
  if (type === 1) return p * p;
  if (type === 2) return 1 - Math.pow(1 - p, 3);
  if (type === 3) return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  return p;
}

const tToSec = (t, bpm) => t * T_UNIT / (bpm || 120);

/* ---------------- 图片素材 ---------------- */
function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadAssets() {
  const entries = Object.entries(ASSET_FILES);
  const imgs = await Promise.all(entries.map(([, src]) => loadImage(src)));
  const out = {};
  entries.forEach(([key], i) => { out[key] = imgs[i]; });
  return out;
}

/** 用 source-in 把白色点击特效序列帧染成判定色 */
function tintSheet(img, color) {
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

function buildClickFrames(img) {
  if (!img) return {};
  return {
    PERFECT: tintSheet(img, '#ffeca0'),
    GOOD: tintSheet(img, '#b4e1ff'),
    BAD: tintSheet(img, '#9aa6b8')
  };
}

/* -----------------------------------------------------------------------------
 * 离屏烘焙
 *
 * 手机端“连续黄键卡”的根因是每帧都要重新算的东西太多：每个音符一次 shadowBlur、
 * 每个特效一次 createRadialGradient、判定线整条 40px 阴影、背景三层渐变整屏重画。
 * 这些图的形状和颜色其实都不变，只有透明度和缩放会变，所以全部一次性烤成图片，
 * 运行时只剩 drawImage ——画质不变，GPU/CPU 的模糊与渐变计算全免。
 * -------------------------------------------------------------------------- */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** 把音符贴图烤成“彩色光晕 + 本体”，返回可直接按 CSS 尺寸绘制的精灵 */
function bakeNoteGlow(img, color, blur, scale, dpr) {
  if (!img) return null;
  const cssW = img.width * scale, cssH = img.height * scale;
  if (!(cssW > 0.5) || !(cssH > 0.5)) return null;
  const pad = Math.ceil(blur * 1.7);
  const res = clamp(dpr, 1, 2);
  const w = cssW * res, h = cssH * res, p = pad * res;

  // 先做纯色剪影，保证光晕颜色和本体一致
  const sil = makeCanvas(w, h);
  const sx = sil.getContext('2d');
  sx.drawImage(img, 0, 0, w, h);
  sx.globalCompositeOperation = 'source-in';
  sx.fillStyle = color;
  sx.fillRect(0, 0, w, h);

  const c = makeCanvas(w + p * 2, h + p * 2);
  const x = c.getContext('2d');
  x.shadowColor = color;
  x.shadowBlur = blur * res;
  x.drawImage(sil, p, p);
  x.shadowBlur = 0;
  x.drawImage(sil, p, p);
  return { c, w: cssW + pad * 2, h: cssH + pad * 2 };
}

/** 圆形辉光（打击特效用），避免每帧 createRadialGradient */
function bakeRadialGlow(color) {
  const S = 128;
  const c = makeCanvas(S, S);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, color + 'cc');
  g.addColorStop(.45, color + '33');
  g.addColorStop(1, color + '00');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return c;
}

/** 判定线辉光：竖直方向高斯衰减的长条，横向可以随便拉伸。
 *  原版判定线的光是「贴着线的一圈暖白黄光」，不是一个铺开的大光斑：
 *  sigma 26 → 13、半高 84px → 46px，峰值也压到 0.24，离原版更近，顺手省一半填充率。 */
function bakeLineGlow(color) {
  const H = 92, W = 6, sigma = 13;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const img = x.createImageData(W, H);
  const rgb = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  for (let yy = 0; yy < H; yy++) {
    const d = yy - (H - 1) / 2;
    const a = Math.exp(-(d * d) / (2 * sigma * sigma)) * 0.24;
    for (let xx = 0; xx < W; xx++) {
      const i = (yy * W + xx) * 4;
      img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2];
      img.data[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  x.putImageData(img, 0, 0);
  return { c, h: H / 2 };                // 绘制高度（CSS px）
}

/** 判定线本体：一条「中心亮白、边缘偏暖黄」的窄带，整个游戏只烤一次。
 *  原版的线与光都是黄白调，之前贴的是白线 + 冷白青光，测试看着不对。 */
function bakeLineCore() {
  const H = 16, W = 4;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const img = x.createImageData(W, H);
  for (let yy = 0; yy < H; yy++) {
    const d = Math.abs(yy - (H - 1) / 2) / ((H - 1) / 2);   // 0 中心 → 1 边缘
    // 中心暖白、边缘纯正的 Phigros 黄 #ffd24a：竖起来的细线也不会显得发白
    const k = Math.pow(d, 1.25);
    const r = 255;
    const g = Math.round(252 - 30 * k);
    const b = Math.round(240 - 150 * k);
    const a = Math.round(255 * (1 - Math.pow(d, 3.2)));
    for (let xx = 0; xx < W; xx++) {
      const i = (yy * W + xx) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

/** 判定线上“命中亮斑”的横向渐变，一条 300px 宽的软光带 */
function bakeFlashBand() {
  const W = 256, H = 32;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(210,245,255,0)');
  g.addColorStop(.5, 'rgba(210,245,255,1)');
  g.addColorStop(1, 'rgba(210,245,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  return c;
}

/* =============================================================================
 * SfxBank —— 打击音。用多份 <audio> 元素做声部池，绝不使用 Web Audio。
 * ========================================================================== */
class SfxBank {
  constructor(files, volume) {
    this.volume = volume == null ? 0.65 : volume;
    this.enabled = true;
    this.pools = {};
    for (const [key, src] of Object.entries(files)) {
      const voices = [];
      for (let i = 0; i < 6; i++) {
        const a = new Audio();
        a.src = src;
        a.preload = 'auto';
        a.volume = this.volume;
        voices.push(a);
      }
      this.pools[key] = { voices, i: 0, src };
    }
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    for (const k in this.pools) {
      for (const a of this.pools[k].voices) a.volume = this.volume;
    }
  }

  play(key) {
    if (!this.enabled) return;
    const p = this.pools[key];
    if (!p) return;
    const a = p.voices[p.i];
    p.i = (p.i + 1) % p.voices.length;
    try {
      a.currentTime = 0;
      const r = a.play();
      if (r && r.catch) r.catch(() => {});
    } catch (_) {}
  }

  /**
   * 首次用户操作时预热播放管线，降低第一声的延迟。
   * 注意：必须用独立的临时元素预热 —— 若直接拿声部池里的元素静音播放，
   * 它的 volume 会被留在 0，导致“第一次打击没有声音”。
   */
  prime() {
    for (const k in this.pools) {
      const src = this.pools[k].src;
      if (!src) continue;
      const a = new Audio();
      a.src = src;
      a.muted = true;
      a.volume = 0;
      try {
        const r = a.play();
        if (r && r.then) r.then(() => { a.pause(); a.removeAttribute('src'); }).catch(() => {});
      } catch (_) {}
    }
  }
}

/* =============================================================================
 * AudioClock —— 音频插值时钟（唯一时间权威）
 * ========================================================================== */
class AudioClock {
  constructor(audio) {
    this.audio = audio;
    this.baseAudioTime = 0;
    this.basePerfNow = performance.now();
    this.lastCheckAt = this.basePerfNow;
    this.playbackRate = 1;
    this.offsetMs = 0;
    this.chartOffset = 0;
    this.forcePaused = false;
    this.driftMs = 0;
    this.pendingSeek = null;

    this._h = () => this.syncBase();
    this._hMeta = () => {
      if (this.pendingSeek != null && this.audio.readyState >= 1) {
        try { this.audio.currentTime = this.pendingSeek; } catch (_) {}
        this.pendingSeek = null;
      }
      this.syncBase();
    };
    ['play', 'playing', 'seeked', 'ratechange', 'pause', 'ended']
      .forEach(evt => audio.addEventListener(evt, this._h));
    audio.addEventListener('loadedmetadata', this._hMeta);
  }

  detach() {
    const a = this.audio;
    ['play', 'playing', 'seeked', 'ratechange', 'pause', 'ended']
      .forEach(evt => a.removeEventListener(evt, this._h));
    a.removeEventListener('loadedmetadata', this._hMeta);
  }

  syncBase() {
    const a = this.audio;
    this.baseAudioTime = Number.isFinite(a.currentTime) ? a.currentTime : 0;
    this.basePerfNow = performance.now();
    this.lastCheckAt = this.basePerfNow;
    this.playbackRate = a.playbackRate || 1;
  }

  /** 权威歌曲时间（秒）。不使用 rAF 时间，也不累加 delta。 */
  songTime() {
    const a = this.audio;
    const raw = Number.isFinite(a.currentTime) ? a.currentTime : 0;
    if (this.forcePaused || a.paused || a.ended) return raw;

    const now = performance.now();
    let estimated = this.baseAudioTime + (now - this.basePerfNow) / 1000 * this.playbackRate;

    // timeupdate 只有 ~4Hz，不能用来重设基准。这里每 100ms 抽检，
    // 只有偏差超过 50ms（标签页节流 / 设备卡顿）才用实际读数重置。
    if (now - this.lastCheckAt >= 100) {
      this.driftMs = (estimated - raw) * 1000;
      if (Math.abs(this.driftMs) > 50) {
        this.baseAudioTime = raw;
        this.basePerfNow = now;
        estimated = raw;
        this.driftMs = 0;
      }
      this.lastCheckAt = now;
    }
    return Math.max(0, estimated);
  }

  /** 谱面时间 = 歌曲时间 - 用户 offset - 谱面自带 offset */
  chartTime() {
    return this.songTime() - this.offsetMs / 1000 - this.chartOffset;
  }

  play() {
    this.forcePaused = false;
    const p = this.audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
    this.syncBase();
  }

  pause() {
    this.audio.pause();
    this.forcePaused = true;
    this.syncBase();
  }

  seek(sec) {
    this.pendingSeek = Math.max(0, sec);
    try {
      if (this.audio.readyState >= 1) {
        this.audio.currentTime = this.pendingSeek;
        this.pendingSeek = null;
      }
    } catch (_) {}
    this.baseAudioTime = Math.max(0, sec);
    this.basePerfNow = performance.now();
    this.lastCheckAt = this.basePerfNow;
  }

  setOffset(ms) { this.offsetMs = Number(ms) || 0; }
}

/* =============================================================================
 * 谱面解析 / 事件求值
 * ========================================================================== */
function prepEvents(list, pairs, sec) {
  return (list || []).map(e => ({
    s: sec(e.startTime),
    e: sec(e.endTime),
    a: pairs.map(p => Number(e[p[0]]) || 0),
    b: pairs.map(p => Number(e[p[1]]) || 0),
    easing: Number(e.easing) || 0
  })).sort((x, y) => x.s - y.s);
}

/**
 * 事件求值。带游标：时间在播放中是单调前进的，没必要每帧都从第 0 个事件线性扫
 * （长谱面单条判定线就可能上千个 move 事件，24 条线 × 3 组事件 × 60fps 直接吃满）。
 * 语义与“从头扫、返回第一个包含 t 的事件”完全一致，回退/重开时游标自动归零。
 */
function evalEvents(evs, t, defaults) {
  const n = evs.length;
  if (!n) return defaults.slice();
  let i = evs._i | 0;
  if (i > n) i = 0;
  // 时间倒退（重开、拖动进度）→ 游标失效
  if (i > 0 && evs[i - 1].e >= t) i = 0;
  while (i < n && evs[i].e < t) i++;
  evs._i = i;

  if (i < n && evs[i].s <= t) {
    const ev = evs[i];
    const out = new Array(ev.a.length);
    const k = ease(ev.e > ev.s ? (t - ev.s) / (ev.e - ev.s) : 1, ev.easing);
    for (let j = 0; j < out.length; j++) out[j] = lerp(ev.a[j], ev.b[j], k);
    return out;
  }
  // 落在事件之间的空档：沿用上一个事件的终值
  return (i > 0 ? evs[i - 1].b : defaults).slice();
}

class LineRuntime {
  constructor(data, index) {
    this.index = index;
    this.bpm = Number(data.bpm) || 120;
    const sec = t => tToSec(Number(t) || 0, this.bpm);

    this.move = prepEvents(data.judgeLineMoveEvents, [['start', 'end'], ['start2', 'end2']], sec);
    this.rotate = prepEvents(data.judgeLineRotateEvents, [['start', 'end']], sec);
    this.alphaEvents = prepEvents(data.judgeLineDisappearEvents, [['start', 'end']], sec);

    this.speedEvents = (data.speedEvents || []).map(e => ({
      s: sec(e.startTime), e: sec(e.endTime),
      // 不能写 `Number(e.value) || 1`：0 速是官谱里的「冻结」写法，被 || 吃掉就变成
      // 1 倍速，那一段的流速和官方直接不符（DeadSoul SP 里有 176 个 0 速事件）。
      v: Number.isFinite(Number(e.value)) ? Number(e.value) : 1
    })).sort((a, b) => a.s - b.s);
    if (!this.speedEvents.length || this.speedEvents[0].s > 0) {
      this.speedEvents.unshift({ s: 0, e: 0, v: 1 });
    }
    // 每个事件开始前已经累积的“滚动距离”前缀和：scrollAt 从线性扫描降到二分
    this.speedAcc = [];
    let acc = 0;
    for (const e of this.speedEvents) {
      this.speedAcc.push(acc);
      if (e.e > e.s) acc += (e.e - e.s) * e.v;
    }
    this._scT = NaN;
    this._scV = 0;

    this.notes = [];
    [[data.notesAbove, true], [data.notesBelow, false]].forEach(([arr, above]) => {
      (arr || []).forEach(n => {
        this.notes.push({
          line: this,
          type: Number(n.type),
          positionX: Number(n.positionX) || 0,
          above,
          // 官方模拟器对这个字段的写法是 `isNaN(speed) ? 1 : speed`，注释里专门
          // 警告不要写成 Number(speed) || 1 —— speed 0 代表音符直接贴在判定线上。
          noteSpeed: Number.isFinite(Number(n.speed)) ? Number(n.speed) : 1,
          targetTime: sec(n.time),
          holdDur: sec(n.holdTime || 0),
          state: 0,             // 0 未判定 / 1 正在按住的 Hold / 2 已判定
          holder: null,
          scored: false,
          pendingGrade: null,
          judgeAt: -99,
          grade: null,
          caughtAt: null,       // 黄键被手指够到的时刻（官方先记下、过线才结算）
          gapAt: null,          // 长条按住期间「手指离开判定区域」的时刻（抬手保护计时）
          isMulti: false
        });
      });
    });
    this.notes.sort((a, b) => a.targetTime - b.targetTime);
    // 音符到线时 / 尾端的滚动距离是定值，提前算好，避免每帧为每个音符重算
    for (const n of this.notes) {
      n.sTarget = this.scrollAt(n.targetTime);
      n.sEnd = this.scrollAt(n.targetTime + n.holdDur);
    }
    this.lastNoteTime = this.notes.reduce((m, n) => Math.max(m, n.targetTime + n.holdDur), 0);
    for (let i = 0; i < this.notes.length; i++) {
      for (let j = i + 1; j < this.notes.length; j++) {
        if (this.notes[j].targetTime - this.notes[i].targetTime > 0.02) break;
        this.notes[i].isMulti = this.notes[j].isMulti = true;
      }
    }
    this._cacheT = NaN;
    this._cache = null;
    this.flashAt = -99;
    this.flashX = 0;
    this.flashY = 0;
  }

  /** 判定线状态：中心、角度、透明度、切线与法线。全部由 chartTime 求值。 */
  stateAt(t) {
    if (this._cacheT === t) return this._cache;
    const mv = evalEvents(this.move, t, [0.5, 0.5]);      // x, 距底部比例
    const deg = evalEvents(this.rotate, t, [0])[0];
    const alpha = clamp(evalEvents(this.alphaEvents, t, [1])[0], 0, 1);
    const angle = -deg * Math.PI / 180;                   // 官方模拟器：startDeg = -Deg * start
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const st = {
      cx: this.game.pf.x + mv[0] * this.game.pf.w,
      cy: this.game.pf.y + (1 - mv[1]) * this.game.pf.h,
      angle, alpha, ux, uy,
      nx: uy, ny: -ux                                     // “上方”法线
    };
    this._cacheT = t; this._cache = st;
    return st;
  }

  /** speedEvents 的积分：变速时音符不跳变、不累积误差。二分 + 帧内记忆。 */
  scrollAt(t) {
    if (t <= 0) return 0;
    if (this._scT === t) return this._scV;
    const evs = this.speedEvents;
    let lo = 0, hi = evs.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (evs[mid].s <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    let v = 0;
    if (idx >= 0) {
      const e = evs[idx];
      v = this.speedAcc[idx];
      if (t > e.s) v += (Math.min(t, e.e) - e.s) * e.v;
    }
    this._scT = t; this._scV = v;
    return v;
  }

  /** 音符在判定线上的锚点（横向单位：屏宽 / 18，与官方一致） */
  anchor(note, st, out) {
    // 官方：below 音符的横向坐标取反
    const off = note.positionX * this.game.posUnit * (note.above ? 1 : -1);
    const r = out || { x: 0, y: 0 };
    r.x = st.cx + st.ux * off; r.y = st.cy + st.uy * off;
    return r;
  }

  /**
   * 音符位置。d > 0 表示还没到判定线，d < 0 表示已经滑过判定线 ——
   * 允许负值，音符会像原作那样“穿过”判定线并淡出，而不是卡在线上。
   * out 传进来时写入复用对象：绘制循环每帧要算上百个点，少一点 GC 抖动。
   */
  notePoint(note, t, st, out) {
    const a = this.anchor(note, st, this._av || (this._av = { x: 0, y: 0 }));
    const d = (note.sTarget - this.scrollAt(t)) * this.game.pps * note.noteSpeed * this.game.speedMul;
    const sign = note.above ? 1 : -1;
    const r = out || { x: 0, y: 0, d: 0 };
    r.x = a.x + st.nx * sign * d; r.y = a.y + st.ny * sign * d; r.d = d;
    return r;
  }

  tailDistance(note, t) {
    return (note.sEnd - this.scrollAt(t)) * this.game.pps * note.noteSpeed * this.game.speedMul;
  }
}

/* =============================================================================
 * Game
 * ========================================================================== */
class Game {
  constructor(opts) {
    this.chart = opts.chart;
    this.song = opts.song || {};
    this.level = opts.level || {};
    this.img = opts.images || {};
    this.sfx = opts.sfx || null;
    this.settings = opts.settings || {};
    // 画质档位要单独记一份「已应用值」：app.js 传进来的 settings 与
    // this.settings 是同一个对象引用，applySettings 里拿旧对象和参数比
    // 永远相等，切换档位就不会触发 resize —— 这正是画质设置形同虚设的原因。
    this._appliedQuality = this.settings.quality || 'auto';
    // 键位可以在设置里改：tap 是五根「虚拟手指」对应的键，flick 是划动键
    this.applyKeymap(this.settings.keyMap || DEFAULT_KEYMAP);
    // 自动画质：手机上如果一直掉帧，就再往下降一档分辨率（只在 quality=auto 时生效）
    this._autoCap = 0;
    this._frameTick = 0;
    this._frameAvg = 0;
    this.onFinish = opts.onFinish || (() => {});
    this.onJudge = opts.onJudge || (() => {});
    this.clickFrames = buildClickFrames(this.img.click);

    // 判定线闪烁 / 常时光带，整局只生成一次（打击特效用官方那套 30 帧图 + 方块，不再烤亮斑）
    this.flashBand = bakeFlashBand();
    // 原版判定线是暖黄白：常时一层暖黄、50 连之后稍微提到亮黄，都已经是「小光」了
    this.lineGlow = {
      warm: bakeLineGlow('#ffd85e'),
      cool: bakeLineGlow('#ffe98c')
    };
    this.lineCore = bakeLineCore();

    this.canvas = document.getElementById('stage');
    this.ctx = this.canvas.getContext('2d');
    this.audio = document.getElementById('bgm');
    this.clock = new AudioClock(this.audio);
    this.clock.chartOffset = Number(this.chart.offset) || 0;
    this.startAt = Number(this.level.startAt) || 0;

    this.lines = (this.chart.judgeLineList || []).map((d, i) => {
      const l = new LineRuntime(d, i);
      l.game = this;
      return l;
    });
    this.notes = this.lines.flatMap(l => l.notes).sort((a, b) => a.targetTime - b.targetTime);
    // 判定线贴图（原版 line.json）：被指定的那几条线整条换成一张图片。
    // 新曲里那几次「背景切换」（曲绘切到别的图 / 全黑）就是靠这几条线画出来的。
    if (opts.lineTex) {
      this.lineTex = opts.lineTex;
      for (const t of this.lineTex) {
        const l = this.lines[t.lineId];
        if (l) l.tex = t;
      }
    }
    this.total = this.notes.length;
    this.lastNoteTime = this.lines.reduce((m, l) => Math.max(m, l.lastNoteTime), 0);

    this.scoreSum = 0;
    this.judged = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { PERFECT: 0, GOOD: 0, BAD: 0, MISS: 0 };
    this.early = 0; this.late = 0;
    this.effects = [];
    this.activeIds = new Set();
    this.pointers = new Map();
    this.pointerLast = new Map();     // 上一次 pointermove 的落点：划动按「这一小段轨迹」判红键
    this.pointerDown = new Map();     // 按下点：红键要求从按下的位置真的划出 FLICK_MIN_TRAVEL
    this.running = false;
    this.paused = false;
    this.ended = false;
    this.lastJudge = null;
    this.lastJudgeAt = -99;

    this.hud = {
      score: document.getElementById('score'),
      acc: document.getElementById('acc'),
      comboWrap: document.getElementById('comboWrap'),
      combo: document.getElementById('combo'),
      judge: document.getElementById('judgeText'),
      sync: document.getElementById('syncMonitor')
    };
    this._hudCache = {};

    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.bindInput();
    this.requestLoop();
  }

  destroy() {
    this.running = false;
    this.destroyed = true;
    window.removeEventListener('resize', this._onResize);
    if (this._unbind) this._unbind();
    this.clock.detach();
    this.clock.pause();
  }

  resize() {
    // 手机 DPR 常见 3.0，画布像素量是 CSS 的 9 倍。这套画面全是柔光，不需要那么细：
    // 触屏默认封到 1.5（填充量只有 2.0 的 56%），是“连续黄键卡”最划算的一半解药。
    // 觉得糊可以在设置里选「高清」；反过来选「流畅」会再降一档。
    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const q = (this.settings && this.settings.quality) || 'auto';
    let cap = q === 'high' ? 3 : q === 'smooth' ? 1.25 : (coarse ? 1.5 : 2.5);
    // 自动档还会自己再降：手机上跑不动的机器，光靠固定上限压不住
    if (q === 'auto' && this._autoCap) cap = Math.min(cap, this._autoCap);
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.dpr = dpr;
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w; this.viewH = h;

    const ar = 16 / 9;
    if (w / h > ar) this.pf = { h: h, w: h * ar };
    else this.pf = { w: w, h: w / ar };
    this.pf.x = (w - this.pf.w) / 2;
    this.pf.y = (h - this.pf.h) / 2;
    const pf = this.pf;
    this.pfCorners = [
      [pf.x, pf.y],
      [pf.x + pf.w, pf.y],
      [pf.x, pf.y + pf.h],
      [pf.x + pf.w, pf.y + pf.h]
    ];

    this.posUnit = this.pf.w / 18;         // 官方：positionX 单位 = 屏宽 / 18
    this.pps = this.pf.h * 0.6;            // 官方：每秒 0.6 屏高
    this.noteScale = this.pf.w / 8000;     // 官方默认按键缩放 8e3
    this.lineH = Math.max(2.6, this.pf.w * 0.0026);

    this.buildBackdrop();
    this.buildNoteGlows();

    if (this.lines) this.lines.forEach(l => { l._cacheT = NaN; l._cache = null; });
  }

  /**
   * 背景是每帧都一样的（整屏压暗渐变 + playfield 暗角），烤成一张图，
   * 每帧用 'copy' 一次贴回：既省掉 clearRect，也省掉每帧两次整屏渐变。
   */
  buildBackdrop() {
    // 画布分辨率档位会变，缓存键必须带上 dpr，否则切到「高清」后
    // 背景仍贴的是按低分辨率烤的那张图。
    const w = Math.max(1, Math.round(this.viewW));
    const h = Math.max(1, Math.round(this.viewH));
    const dim = (this.settings.bgDim == null ? 55 : this.settings.bgDim) / 100;
    const dpr = this.dpr || 1;
    const key = w + 'x' + h + ':' + dim + '@' + dpr;
    if (this._bgCache && this._bgKey === key) return;

    const c = makeCanvas(Math.round(w * dpr), Math.round(h * dpr));
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 背景不透明度：官方就是「在黑底上盖一层 alpha 的纯黑」，
    // 所以这里 a0 直接等于滑杆值（0 = 曲绘全亮，100 = 几乎全黑）。
    // 以前映射成 0.1~0.68，滑块拉到头变化也只有一点点，看着像没反应。
    const a0 = clamp(0.02 + dim * 0.86, 0, 0.92);
    this.bgAlpha = a0;
    const dark = ctx.createLinearGradient(0, 0, 0, h);
    dark.addColorStop(0, 'rgba(4,7,14,' + a0.toFixed(3) + ')');
    dark.addColorStop(.55, 'rgba(3,5,11,' + (a0 * 0.92).toFixed(3) + ')');
    dark.addColorStop(1, 'rgba(2,3,8,' + Math.min(1, a0 * 1.1).toFixed(3) + ')');
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, w, h);

    const pf = this.pf;
    const vig = ctx.createRadialGradient(pf.x + pf.w / 2, pf.y + pf.h / 2, pf.h * 0.12,
      pf.x + pf.w / 2, pf.y + pf.h / 2, pf.h * 0.95);
    vig.addColorStop(0, 'rgba(90,150,220,.05)');
    vig.addColorStop(1, 'rgba(0,0,0,.26)');
    ctx.fillStyle = vig;
    ctx.fillRect(pf.x, pf.y, pf.w, pf.h);

    this._bgCache = c;
    this._bgKey = key;
  }

  /** 音符光晕。每种音符烤两档：常态一档、临近/高亮一档。 */
  buildNoteGlows() {
    const s = this.noteScale;
    const dpr = this.dpr || 1;
    const key = s + '@' + dpr;
    if (this.glows && this._glowKey === key) return;
    this._glowKey = key;
    const mk = (img, color) => ({
      // 光晕外扩的 pad 直接决定每个音符的填充面积。24px 的模糊半径烤出来
      // 是 200×94 的一张图，而音符本体只有 121×12 —— 连续黄键时几十个音符
      // 同时过线，光晕几乎全是透明像素却照样参与混合，这是手机上最贵的一笔。
      soft: bakeNoteGlow(img, color, 7, s, dpr),
      hot: bakeNoteGlow(img, color, 15, s, dpr)
    });
    this.glows = {
      1: mk(this.img.tap, '#aaebff'),
      2: mk(this.img.drag, '#ffee8c'),
      4: mk(this.img.flick, '#ff7896')
    };
    this.holdHeadGlow = this.img.holdHead
      ? { soft: bakeNoteGlow(this.img.holdHead, '#a9ebff', 7, s, dpr),
          hot: bakeNoteGlow(this.img.holdHead, '#a9ebff', 14, s, dpr) }
      : null;

    // 屏外剔除用的半径。精灵是绕音符中心旋转的，取「能盖住整张精灵的圆」当半径，
    // 判定必不漏判：中心点到裁切框的距离超过这个圆，这颗音符一个像素都进不了画面。
    // 原先前缀 4.2 秒的音符全都会被提交绘制（大多数离画面两三屏远），
    // 实测密集段一帧 24~31 次音符绘制里只有 5~10 个真的在画面内。
    let r = 0;
    for (const t of [1, 2, 4]) {
      const g = this.glows[t];
      if (g) {
        if (g.soft) r = Math.max(r, g.soft.w, g.soft.h);
        if (g.hot) r = Math.max(r, g.hot.w, g.hot.h);
      }
      const m = this.noteMetrics(t);            // 素材缺失时走 drawGlyphFallback，按音符本体尺寸算
      r = Math.max(r, m.w, m.h);
    }
    this._noteCullR = Math.max(40, r * 0.5 * 1.3 + 6);   // 1.3 覆盖命中瞬间 pop 放大到 1.24
    const holdHalf = Math.max(
      this.img.holdHead ? this.img.holdHead.width * s : 0,
      this.img.holdEnd ? this.img.holdEnd.width * s : 0,
      this.img.holdBody ? this.img.holdBody.width * s : 989 * s * 0.78,
      this.holdHeadGlow && this.holdHeadGlow.hot ? this.holdHeadGlow.hot.w : 0
    ) * 0.5;
    this._holdCullR = holdHalf + 10;              // 长条沿法线方向另算，这里只算横向宽度
  }

  get speedMul() { return Number(this.settings.noteSpeed) || 1; }

  /** 键位：tap 每个键算一根「虚拟手指」，flick 是一个划动键。设置页改完走这里。 */
  applyKeymap(map) {
    const src = (map && typeof map === 'object') ? map : DEFAULT_KEYMAP;
    const tap = (Array.isArray(src.tap) ? src.tap : DEFAULT_KEYMAP.tap)
      .map(c => String(c || '').trim()).filter(Boolean).slice(0, 6);
    this.keymap = {
      tap: tap.length ? tap : DEFAULT_KEYMAP.tap.slice(),
      flick: String(src.flick || DEFAULT_KEYMAP.flick)
    };
    this.keyColumn = {};
    for (let i = 0; i < this.keymap.tap.length; i++) this.keyColumn['k' + this.keymap.tap[i]] = i;
    this.keyTap = {};
    for (const code of this.keymap.tap) this.keyTap[code] = 1;
  }

  applySettings(s) {
    // 只用自己保存的 _appliedQuality 比较，不能读 this.settings.quality：
    // 调用方通常直接把同一个 settings 对象传进来，那样读到的永远是新值。
    const q = s.quality || 'auto';
    const qualityChanged = q !== this._appliedQuality;
    this.settings = s;
    this.applyKeymap(s.keyMap);
    if (this.sfx) {
      this.sfx.enabled = s.hitSound !== false;
      this.sfx.setVolume((s.hitVolume == null ? 65 : s.hitVolume) / 100);
    }
    this.audio.volume = (s.musicVolume == null ? 85 : s.musicVolume) / 100;
    if (this.hud.sync) this.hud.sync.style.display = s.showSync === false ? 'none' : '';
    if (qualityChanged) {
      this._appliedQuality = q;
      if (this.pf) this.resize();                 // 重设画布分辨率并重建所有烘焙精灵
    } else if (this.pf) {
      this.buildBackdrop();                       // 背景暗度改了要重烤
    }
  }

  reset() {
    this.scoreSum = 0; this.judged = 0; this.combo = 0; this.maxCombo = 0;
    this.counts = { PERFECT: 0, GOOD: 0, BAD: 0, MISS: 0 };
    this.early = 0; this.late = 0;
    this.effects = [];
    this.activeIds.clear(); this.pointers.clear(); this.pointerLast.clear(); this.pointerDown.clear();
    this.notes.forEach(n => {
      n.state = 0; n.holder = null; n.pendingGrade = null;
      n.judgeAt = -99; n.grade = null; n.caughtAt = null; n.gapAt = null; n.fxNext = null; n.scored = false;
    });
    this.lines.forEach(l => { l._cacheT = NaN; l._cache = null; l.flashAt = -99; l._scanFrom = 0; l._updFrom = 0; });
    this.ended = false; this.paused = false;
    this.lastJudge = null; this.lastJudgeAt = -99;
    this._hudCache = {};
    this._frameAvg = 0; this._frameTick = 0; this._lastFrameAt = 0;   // 自动画质重新取样
    this.updateHud(0);
  }

  /* ---------------- 每帧更新：只读 chartTime，不做时间累加 ---------------- */
  update(ct) {
    for (const line of this.lines) {
      const notes = line.notes;
      // 判定只需要看“当前时刻附近”的音符：更早的早就判完（state 2），更晚的
      // 最早也要 0.5 秒后才进入任何判定窗。原来每帧把整张谱从头扫一遍，
      // 564 个音符的谱面就是 564 次空转 —— 手机上和绘制抢同一块 CPU。
      let i0 = line._updFrom || 0;
      while (i0 < notes.length) {
        const n = notes[i0];
        // 长条要挂到「尾部 + 0.25s」才算彻底结束，所以它的存活时间比普通音符长，
        // 否则一个头没打中的长条会在 0.6s 时被这条快进逻辑提前判掉。
        const aliveT = n.type === 3 ? n.targetTime + n.holdDur + HOLD_LATE_MISS : n.targetTime + 0.6;
        if (n.state === 1 || ct <= aliveT) break;
        // 跨过一段还没判的（只有跳转时间轴才会出现）：补一个 MISS，行为与逐帧扫一致
        if (n.state === 0) this.finishNote(n, 'MISS', ct, line);
        i0++;
      }
      if (i0 > 0 && notes[i0] && notes[i0].targetTime - ct > 1.0) i0 = 0;   // 倒退/重开的兜底
      line._updFrom = i0;

      for (let i = i0; i < notes.length; i++) {
        const note = notes[i];
        if (note.targetTime - ct > 1.0) break;              // 还没进任何判定窗
        if (note.state === 2) continue;

        if (note.state === 1) {                       // Hold 正在按住
          // 官方判定口径是「Hold 结束前始终有手指在判定区域内」，不要求是同一根：
          // 所以这里比的是「这一列现在有没有手指」，换手 / 单指接长条塞键都成立。
          const endT = note.targetTime + note.holdDur;
          const touching = this.holdTouching(note, ct, line);
          if (touching) {
            note.gapAt = null;                          // 还在区域内，正常按着
          } else if (note.gapAt == null) {
            note.gapAt = ct;                            // 手指离开了，开始抬手保护计时
          }
          // 按住期间继续叠打击特效（官方 status3 循环里每隔 30/bpm 秒 push 一次
          // ClickEvent），所以长按的手感是「一直有反馈在冒」，而不是静悄悄地等尾巴。
          if (note.fxNext == null) note.fxNext = ct + (note.fxGap || 30 / (line.bpm || 120));
          if (ct >= note.fxNext) {
            const st0 = line.stateAt(ct);
            const p0 = line.notePoint(note, ct, st0);
            this.spawnHit(p0.x, p0.y, note.pendingGrade || 'PERFECT', ct, false);
            note.fxNext = ct + (note.fxGap || 30 / (line.bpm || 120));
          }
          // 官方：尾巴前 0.2s 就按头部评级**先记分**（加连击、计命中），
          // 但长条本身照样一直画到尾巴过线为止 —— 不是提前 0.2s 把条子抹掉。
          if (!note.scored && ct >= endT - 0.2) {
            note.scored = true;
            const st1 = line.stateAt(ct);
            const p1 = line.notePoint(note, Math.min(ct, note.targetTime), st1);
            note.jx = p1.x; note.jy = p1.y;
            this.register(note, note.pendingGrade || 'PERFECT', ct, line, p1);
          }
          if (ct >= endT) {                              // 尾巴过线：停止绘制
            note.state = 2;
            note.grade = note.pendingGrade || 'PERFECT';
            note.holder = null;
            continue;
          }
          if (!touching && note.gapAt != null && ct - note.gapAt > HOLD_REGRAB && !note.scored) {
            this.finishNote(note, 'MISS', ct, line);      // 官方松手当帧即 Miss
            continue;
          }
          continue;
        }

        // Drag（黄键）：官方判定是「有一只手指在这一列上」就 PERFECT，
        // 时间窗 ±0.16s、垂直方向不设限。原来套用 Tap 的 ±0.08s 并要求手指
        // 离音符 52px 以内，偏一点就 MISS —— 这是测试反馈黄键手感差的主因。
        // 另外官方是「够到就先记下（status=4），等音符过线才结算」：
        // 原来我们一进窗口就 finishNote，判定/连击/打击特效都比实际早了最多 160ms，
        // 看起来就像"黄键提前判、判定点飘"。
        if (note.type === 2) {
          const dt = ct - note.targetTime;
          if (Math.abs(dt) <= DRAG_WINDOW) {
            if (note.caughtAt == null && this.dragTouching(note, ct, line)) note.caughtAt = ct;
            if (note.caughtAt != null && dt >= -0.02) {
              this.finishNote(note, 'PERFECT', ct, line);      // 过线才落判
              continue;
            }
            continue;                                          // 窗口内先挂着，不算 MISS
          }
          if (dt > DRAG_WINDOW) { this.finishNote(note, 'MISS', ct, line); continue; }
        }

        if (note.type === 3) {
          // 官方：长条头部没打中（超过 ±180ms）时不马上 MISS，也不变暗、不断连，
          // 一直挂到「尾部 + 0.25s」才判 MISS；中途按上去仍然有效。
          if (ct - (note.targetTime + note.holdDur) > HOLD_LATE_MISS) this.finishNote(note, 'MISS', ct, line);
        } else if (note.type !== 2 && ct - note.targetTime > LATE_MISS) {
          this.finishNote(note, 'MISS', ct, line);
        }
      }
    }
    if (this.effects.length) this.effects = this.effects.filter(e => ct - e.born < 0.62);
    if (!this.ended && this.running && ct > this.lastNoteTime + 2.0) this.finish();
  }

  /**
   * 长条按住期间「这一列还有没有手指」。
   * 官方对 Hold 的判定是「结束前始终有手指位于判定区域内」，不绑某一根手指，
   * 所以换手长按、极短时间松开再按都能维持判定；这里直接复用黄键那套位置判定
   * （音符在判定线上的锚点 + 切线方向容差）。
   */
  holdTouching(note, ct, line) {
    // 判「这一列还有没有手指」。除了位置判定，只要按下去的那根手指/那个键还没抬起来，
    // 就认为仍然在按住 —— 浏览器里触点坐标会有几像素抖动、判定线还在转，
    // 只靠位置判定会出现「明明按着却判松手 → 打中也 MISS」。
    if (note.holder && this.activeIds.has(note.holder)) return true;
    return this.dragTouching(note, ct, line);
  }

  dragTouching(note, ct, line) {
    if (!this.activeIds.size) return false;
    const st = line.stateAt(ct);
    const p = line.notePoint(note, Math.min(ct, note.targetTime), st, this._ptD || (this._ptD = { x: 0, y: 0, d: 0 }));
    const m = this.noteMetrics(note.type);
    // 官方只比「沿判定线方向」的距离：手指在哪一格纵向并不重要，只要横向对得上
    // 就算接住（这就是 Phigros 里黄键不用精确按在键上的手感）。
    const alongR = Math.max(m.w * 0.62, JUDGE_WIDTH_RATIO * this.pf.w);
    for (const [id, pos] of this.pointers) {
      if (!this.activeIds.has(id)) continue;
      const dx = pos.x - p.x, dy = pos.y - p.y;
      if (Math.abs(dx * st.ux + dy * st.uy) < alongR) return true;
    }
    // 键盘：每个键当成一根「横坐标固定」的虚拟手指，只接自己那一列。
    // 原来是「只要按着任意一个键，全谱黄键都自动接住」—— 键盘玩起来黄键全是白给。
    // 键位改成设置里可选之后，列号跟着 keymap.tap 的顺序走。
    const codes = this.keymap.tap;
    for (let i = 0; i < codes.length; i++) {
      if (!this.activeIds.has('k' + codes[i])) continue;
      if (Math.abs(this.keyColumnX(i) - p.x) < alongR) return true;
    }
    return false;
  }

  /** 键盘虚拟手指的横坐标（按 18 等分铺开；默认五键还是原来那五个常用列） */
  keyColumnX(i) {
    const n = this.keymap.tap.length;
    const unit = n === 5 ? KEY_COLUMNS[i] : 18 * (i + 0.5) / n;
    return this.pf.w * unit / 18;
  }

  finishNote(note, grade, ct, line) {
    note.state = 2;
    note.judgeAt = ct;
    note.grade = grade;
    note.holder = null;
    const st = line.stateAt(ct);
    const p = line.notePoint(note, Math.min(ct, note.targetTime), st);
    note.jx = p.x; note.jy = p.y;
    this.register(note, grade, ct, line, p);
  }

  register(note, grade, ct, line, p) {
    this.judged++;
    this.scoreSum += NOTE_WEIGHT[grade];
    this.counts[grade]++;
    if (grade === 'PERFECT' || grade === 'GOOD') {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    } else {
      this.combo = 0;
    }
    this.lastJudge = grade;
    this.lastJudgeAt = ct;
    // 结算页的 Early / Late 计数：只统计真正打中的音符，偏移取打击那一刻
    // （长条取头部按下的偏移，不是结算点，否则恒为 Late）。
    if (grade !== 'MISS') {
      const off = note.hitOffset != null ? note.hitOffset : ct - note.targetTime;
      if (off < -0.001) this.early++;
      else if (off > 0.001) this.late++;
    }

    if (grade === 'MISS') {
      this.effects.push({ kind: 'miss', x: p.x, y: p.y, born: ct, alpha: 1 });
    } else if (note.type !== 3) {
      // 长条不在这里补特效：按住期间已经按 bpm 间隔一直叠了，尾巴再补一下
      // 反而比原版多、看着像「只有结束才响一下」。
      this.spawnHit(p.x, p.y, grade, ct, note.type === 2);
      if (this.sfx) {
        if (note.type === 2) this.sfx.play('drag');
        else if (note.type === 4) this.sfx.play('flick');
        else this.sfx.play('tap');
      }
      line.flashAt = ct; line.flashX = p.x; line.flashY = p.y;
    }
    this.onJudge(grade, this.combo);
  }

  /**
   * 打击特效。light = 黄键（Drag）：原作 Drag 只有柔和的亮斑、没有炸开的碎片，
   * 连续黄键时这一档能少掉大半绘制量，观感反而更接近原版。
   */
  spawnHit(x, y, grade, ct, light) {
    // 官方的溅射方块：Perfect 4 个、Good 3 个，距离基准 185~265（局部单位）
    const parts = [];
    if (!light) {
      const n = grade === 'PERFECT' ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        parts.push({ cx: Math.cos(a), cy: Math.sin(a), v: 185 + Math.random() * 80 });
      }
    }
    // 上限保护：极端密度下不让特效列表无限增长
    if (this.effects.length > 26) this.effects.splice(0, this.effects.length - 26);
    this.effects.push({ kind: 'hit', x, y, born: ct, grade, parts, light: !!light });
  }

  updateHud(ct) {
    const c = this._hudCache;
    const score = this.total ? Math.round(1e6 * this.scoreSum / this.total) : 0;
    if (c.score !== score) { this.hud.score.textContent = String(score).padStart(7, '0'); c.score = score; }
    const acc = this.judged ? 100 * this.scoreSum / this.judged : 100;
    const accText = 'ACC ' + acc.toFixed(2) + '%';
    if (c.acc !== accText) { this.hud.acc.textContent = accText; c.acc = accText; }
    if (c.combo !== this.combo) {
      this.hud.combo.textContent = String(this.combo);
      const colors = ['#fff', '#0ac3ff', '#f0ed69', '#a0e9fd', '#fe4365'];
      this.hud.combo.style.color = colors[Math.min(4, Math.floor(this.combo / 50))];
      c.combo = this.combo;
      // 连击数字的弹跳改到这里、每帧最多一次：以前是每个音符判一次，
      // 还要读一次 offsetWidth 强制同步布局，连续黄键时就是稳定的掉帧来源。
      if (this.combo > 2) this.bumpCombo();
    }
    const showCombo = this.combo > 2;
    if (c.comboVis !== showCombo) { this.hud.comboWrap.style.opacity = showCombo ? '1' : '0'; c.comboVis = showCombo; }

    const age = ct - this.lastJudgeAt;
    if (this.lastJudge && age >= 0 && age < 0.62) {
      if (c.judge !== this.lastJudge || c.judgeAt !== this.lastJudgeAt) {
        this.hud.judge.textContent = this.lastJudge;
        this.hud.judge.style.color = JUDGE_COLORS[this.lastJudge];
        this.popJudge();
        c.judge = this.lastJudge; c.judgeAt = this.lastJudgeAt;
      }
      const op = 1 - Math.max(0, age - 0.34) / 0.28;
      // 每帧写一次 style 会触发一次样式重算；只在肉眼可辨的幅度上写
      if (!(Math.abs((c.judgeOp == null ? -1 : c.judgeOp) - op) < 0.03)) {
        this.hud.judge.style.opacity = String(op);
        c.judgeOp = op;
      }
    } else if (c.judge !== null) {
      this.hud.judge.style.opacity = '0';
      c.judge = null;
    }

    if (this.hud.sync) {
      const d = this.clock.driftMs;
      const text = 'AUDIO CLOCK  Δ ' + (d >= 0 ? '+' : '') + d.toFixed(1) + ' ms';
      if (c.sync !== text) { this.hud.sync.textContent = text; c.sync = text; }
    }
  }

  /** 判定文字弹出：WAAPI 走合成器，不触发重排；老浏览器退回 CSS 动画 */
  popJudge() {
    const el = this.hud.judge;
    if (!el) return;
    // 连续黄键时每秒十几次判定，每次都 cancel + animate 会在手机上堆出大量
    // 合成器动画对象。70ms 内不重启，视觉上仍然是跟着节奏在跳。
    const now = performance.now();
    if (now - (this._popAt || 0) < 70) return;
    this._popAt = now;
    if (typeof el.animate === 'function') {
      if (this._popAnim) this._popAnim.cancel();
      this._popAnim = el.animate([
        { transform: 'translate(-50%,-50%) scale(1.45)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(.96)', opacity: 1, offset: .22 },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }
      ], { duration: 340, easing: 'cubic-bezier(.15,1.4,.4,1)' });
      return;
    }
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  bumpCombo() {
    const el = this.hud.combo;
    if (!el || typeof el.animate !== 'function') return;
    const now = performance.now();
    if (now - (this._bumpAt || 0) < 70) return;
    this._bumpAt = now;
    if (this._bumpAnim) this._bumpAnim.cancel();
    this._bumpAnim = el.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.13)', offset: .38 },
      { transform: 'scale(1)' }
    ], { duration: 220, easing: 'ease-out' });
  }

  noteMetrics(type) {
    const s = this.noteScale;
    if (type === 2) return { w: 989 * s, h: 60 * s };
    if (type === 3) return { w: 989 * s, h: 50 * s };
    if (type === 4) return { w: 989 * s, h: 200 * s };
    return { w: 989 * s, h: 100 * s };
  }

  /* ---------------- 判定匹配 ---------------- */
  /**
   * 触屏判定：官方 isInArea 只把「手指 - 音符」投影到判定线方向上，
   * 法线方向（音符往判定线飞的那个轴）完全不设限 —— 所以判定线旋转 ±90° 时
   * 照样是「沿着线对得齐就能打」，而不是要精确点到音符那一小块。
   *
   * 之前的写法在法线方向卡了 max(音符高*1.4, 52px)：判定线一竖起来，等于要求
   * 手指离判定线不到 52px，这就是测试说的「垂直判定没做好、手感不行」。
   * 现在按官方改成纯切线判定，横向容差 = 屏宽 * 0.117775（官方那个 hw）。
   */
  findCandidate(x, y, kind) {
    const ct = this.clock.chartTime();
    const wide = JUDGE_WIDTH_RATIO * this.pf.w;
    let best = null, bestCost = Infinity;
    for (const line of this.lines) {
      const st = line.stateAt(ct);
      for (const note of line.notes) {
        if (note.state !== 0) continue;
        const delta = ct - note.targetTime;
        if (delta > LATE_MISS || delta < -WINDOWS[2]) continue;
        // 长条头只有 ±160ms 的窗口（官方 type==3 分支里没有「提前 160~200ms」的 Bad 区）
        if (note.type === 3 && delta < -WINDOWS[1]) continue;
        if (kind === 'flick' && note.type !== 4) continue;
        // Tap 不能吃掉 Drag / Flick：黄键靠「按住滑到线」自动接住（PERFECT），
        // 红键靠划动；若让 tap 命中它们，提前点一下就会被判成 GOOD。
        if (kind === 'tap' && (note.type === 2 || note.type === 4)) continue;
        const m = this.noteMetrics(note.type);
        const p = line.notePoint(note, ct, st);
        const dx = x - p.x, dy = y - p.y;
        const along = Math.abs(dx * st.ux + dy * st.uy);
        if (along > Math.max(m.w * 0.58, wide)) continue;
        // 同时到线的两颗音符：先比时间，再比横向。时间优先才是原版的取舍
        // （同一时刻一左一右两颗，点哪边都能中，不会因为“更近”而抢错）。
        const cost = Math.abs(delta) * 60 + along * 0.35;
        if (cost < bestCost) { bestCost = cost; best = { note, line, delta, st }; }
      }
    }
    return best;
  }

  /** 键盘：按时间就近取音符（不限制横向位置，保证任何谱面都能打） */
  nearestByTime(kind) {
    const ct = this.clock.chartTime();
    let best = null, bestAbs = Infinity;
    for (const note of this.notes) {
      if (note.state !== 0) continue;
      if (note.targetTime - ct > WINDOWS[2]) break;         // notes 已按时间排序
      const delta = ct - note.targetTime;
      if (delta > LATE_MISS || delta < -WINDOWS[2]) continue;
      if (note.type === 3 && delta < -WINDOWS[1]) continue;  // 长条头没有 Bad 区
      const abs = Math.abs(delta);
      if (kind === 'flick' && note.type !== 4) continue;
      // 键盘 Tap 也不能吃掉 Drag / Flick，跟触屏保持同一套规则：
      // 黄键只靠按住滑到线自动接住，红键只靠划动。
      if (kind === 'tap' && (note.type === 2 || note.type === 4)) continue;
      if (abs < bestAbs) { bestAbs = abs; best = note; }
    }
    return best ? { note: best, line: best.line, delta: ct - best.targetTime } : null;
  }

  /**
   * 官方是「有符号」判定：早按和晚按的档位不一样，Bad 只在提前 160~200ms 出现。
   * 传进来的 delta 是 ct - targetTime（**负数 = 提前按**，正数 = 晚按）。
   */
  gradeOf(delta) {
    if (delta < -WINDOWS[1]) return 'BAD';       // 提前 160~200ms：Bad
    if (delta < -WINDOWS[0]) return 'GOOD';      // 提前 80~160ms：Good(Early)
    if (delta <= WINDOWS[0]) return 'PERFECT';   // ±80ms：Perfect（含 Early/Late 两档）
    if (delta <= WINDOWS[1]) return 'GOOD';      // 晚 80~160ms：Good(Late)
    return 'MISS';                               // 晚 >160ms 本来就不会进候选，兜底
  }

  contact(x, y, kind, id) {
    if (!this.running || this.paused || this.ended) return false;
    const hit = this.findCandidate(x, y, kind);
    if (!hit) return false;
    return this.applyHit(hit, kind, id);
  }

  contactNearest(kind, id) {
    if (!this.running || this.paused || this.ended) return false;
    const hit = this.nearestByTime(kind);
    if (!hit) return false;
    return this.applyHit(hit, kind, id);
  }

  /**
   * 划动判定：手指这一小段轨迹（x0,y0 → x1,y1）扫到的红键全部判掉。
   *
   * 之前红键只在 pointerdown 那一刻的位置判一次，等于必须先把手指点在键上再划
   * （测试说的「点划」）；从旁边直接划过来、或者一次划过一排红键都不认。
   * 现在改按轨迹判：音符中心到线段的最近点落在音符判定框里就算划中，
   * 容差与 findCandidate 完全同一套（沿切线按音符宽度、法线按音符高度）。
   */
  flickSweep(x0, y0, x1, y1, isUp) {
    if (!this.running || this.paused || this.ended) return false;
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    // 官方把「正在移动的手指」整体当成划动判定，没有速度门槛：
    // 只要这一小段轨迹动了就算划过，慢慢划也能吃到红键。
    if (len2 < 1) return false;
    if (isUp && len2 < 4) return false;          // 抬手那一下要真的划过 2px，原地松手不算
    const ct = this.clock.chartTime();
    const m = this.noteMetrics(4);
    const alongR = Math.max(m.w * 0.58, JUDGE_WIDTH_RATIO * this.pf.w);
    let hit = false;
    for (const line of this.lines) {
      const st = line.stateAt(ct);
      const notes = line.notes;
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        if (note.state !== 0 || note.type !== 4) continue;
        const delta = ct - note.targetTime;
        if (Math.abs(delta) > DRAG_WINDOW) continue;
        const p = line.notePoint(note, ct, st, this._ptF || (this._ptF = { x: 0, y: 0, d: 0 }));
        let k = ((p.x - x0) * dx + (p.y - y0) * dy) / len2;
        k = k < 0 ? 0 : (k > 1 ? 1 : k);
        const qx = x0 + dx * k - p.x, qy = y0 + dy * k - p.y;
        // 只比沿判定线方向的距离，垂直方向不设限（官方 isInArea 就是只投影到切线）
        if (Math.abs(qx * st.ux + qy * st.uy) > alongR) continue;
        this.finishNote(note, 'PERFECT', ct, line);
        this.consumeStacked(note, line, ct);
        hit = true;
      }
    }
    return hit;
  }

  applyHit(hit, kind, id) {
    const { note, line, delta } = hit;
    const ct = this.clock.chartTime();
    // 红键 / 黄键的判定只有「中 / 不中」两档：官方 judgeNote 里它们一旦进窗就是
    // PERFECT，不会因为早了 100ms 掉成 GOOD —— 测试说「红键判定没做好」多半是这个。
    // 长条头同理没有 Bad 档：±80ms 内 PERFECT，落在 ±80~180ms（包括提前的 early Bad
    // 区间）一律记 GOOD，继续按住就按 GOOD 结算（官方「长条不会评为 Bad」）。
    let grade = this.gradeOf(delta);
    if (kind === 'flick' || note.type === 2) grade = 'PERFECT';
    if (note.type === 3) grade = Math.abs(delta) <= WINDOWS[0] ? 'PERFECT' : 'GOOD';

    note.hitOffset = delta;                        // 记下打击时刻的偏移，用于结算页 Early/Late

    if (note.type === 3 && kind === 'tap') {       // Hold 头部
      note.state = 1;
      note.holder = id;
      note.pendingGrade = grade;
      note.gapAt = null;
      // 按下长条的那一下就出打击特效（官方抓住长条头时 push 一次 ClickEvent），
      // 之后按住期间按 bpm 间隔继续 push，观感是连环叠加，不是「最后才来一下」。
      const st0 = line.stateAt(ct);
      const p0 = line.notePoint(note, ct, st0);
      this.spawnHit(p0.x, p0.y, grade, ct, false);
      // 官方间隔 = 1.6e4 * realHoldTime / holdTime 毫秒，化简后就是 30 / bpm 秒，
      // 与长条多长无关（谱面 tick 与秒的换算是 1.875/bpm）。
      note.fxGap = 30 / (line.bpm || 120);
      note.fxNext = ct + note.fxGap;
      if (this.sfx) this.sfx.play('tap');
      this.onJudge(grade, this.combo);
      return true;
    }

    this.finishNote(note, grade, ct, line);
    this.consumeStacked(note, line, ct);
    return true;
  }

  /** 同位置叠加的音符（同一时间、同一横向位置）一起吃掉，避免“点一下只消失一个” */
  consumeStacked(note, line, ct) {
    if (note.type === 3) return;
    for (const n of line.notes) {
      if (n === note || n.state !== 0) continue;
      if (n.type !== note.type) continue;
      if (n.above !== note.above) continue;
      if (Math.abs(n.targetTime - note.targetTime) > 0.03) continue;
      if (Math.abs(n.positionX - note.positionX) > 0.5) continue;
      this.finishNote(n, note.grade || 'PERFECT', ct, line);
    }
  }

  release(id) {
    this.activeIds.delete(id);
    this.pointers.delete(id);
  }

  /* ---------------- 输入 ---------------- */
  bindInput() {
    const canvas = this.canvas;
    // 触屏走 touch 事件，不再走 pointer：多指同时落下时，pointer 事件在
    // Chrome 里没问题，但在国内 Android 的 X5 / 微信 / QQ 内置 webview 里经常
    // 只派发第一根手指，另一根连 pointercancel 一起丢掉 —— 表现就是测试说的
    // 「两个键同时落下只判一个」和「长条莫名断触」。touch 事件的 changedTouches
    // 一次就把这一批新手指数全，逐根判，绕开 webview 的多指 bug。
    // 鼠标 / 笔仍然用 pointer（触屏 pointer 直接跳过，避免同一根手指判两次）。
    const useTouch = typeof window !== 'undefined' &&
      ('ontouchstart' in window || (typeof navigator !== 'undefined' && navigator && navigator.maxTouchPoints > 0));

    const begin = (id, x, y) => {
      if (this.activeIds.has(id)) return;            // 同一根手指重复进来不重复判
      this.activeIds.add(id);
      this.pointers.set(id, { x: x, y: y });
      this.pointerDown.set(id, { x: x, y: y });      // 划动起点：红键要按累计位移判
      this.pointerLast.set(id, { x: x, y: y, t: performance.now() });
      this.contact(x, y, 'tap', id);
    };
    // 红键按「手指划过的这一小段」判，不再要求先把手指按在键上：
    // 从别处直接划过来、一次划过多颗红键都能吃到。
    const stepTo = (id, x, y) => {
      if (this.pointers.has(id)) this.pointers.set(id, { x: x, y: y });
      if (!this.running || this.paused || this.ended) return;
      const last = this.pointerLast.get(id), dn = this.pointerDown.get(id);
      if (!last) return;
      const now = performance.now();
      const dist = Math.hypot(x - last.x, y - last.y);
      this.pointerLast.set(id, { x: x, y: y, t: now });
      if (dist < 2) return;                              // 2px 以下当手抖
      if (!dn || Math.hypot(x - dn.x, y - dn.y) < FLICK_MIN_TRAVEL) return;  // 点按不算划
      this.flickSweep(last.x, last.y, x, y);
    };
    const endAt = (id, x, y) => {
      const last = this.pointerLast.get(id), dn = this.pointerDown.get(id);
      if (last && dn && this.running && !this.paused && !this.ended) {
        const travel = Math.hypot(x - dn.x, y - dn.y);
        if (travel >= FLICK_MIN_TRAVEL) {                // 抬手那一下也要求真的划出去了
          this.flickSweep(last.x, last.y, x, y, true);
        }
      }
      this.pointerLast.delete(id);
      this.pointerDown.delete(id);
      this.release(id);
    };

    /* --- 触屏：一根手指一个 contact，一次事件里把所有 new touch 都吃掉 --- */
    const tstart = e => {
      if (!this.running || this.paused || this.ended) return;
      e.preventDefault();
      // webview 常常吞掉 touchend，会留下一根「幽灵手指」：它停在原地，替你把黄键
      // 一直自动接住，新手指按下去反而被它的 id 挡住。每次按下都拿 e.touches 对账，
      // 已经被系统收走的手指立刻放掉。
      const live = new Set();
      const all = e.touches || [];
      for (let i = 0; i < all.length; i++) live.add('t' + all[i].identifier);
      for (const id of Array.from(this.activeIds)) {
        if (id.charAt(0) === 't' && !live.has(id)) {
          this.pointerLast.delete(id);
          this.pointerDown.delete(id);
          this.release(id);
        }
      }
      const list = e.changedTouches || [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        begin('t' + t.identifier, t.clientX, t.clientY);
      }
    };
    const tmove = e => {
      const list = e.changedTouches || [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        stepTo('t' + t.identifier, t.clientX, t.clientY);
      }
    };
    const tend = e => {
      const list = e.changedTouches || [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        endAt('t' + t.identifier, t.clientX, t.clientY);
      }
    };

    /* --- 鼠标 / 笔：仍然按 pointer，多键（多点）互不影响 --- */
    const down = e => {
      if (useTouch && e.pointerType === 'touch') return;  // 触屏已经由 touch 事件接管
      if (!this.running || this.paused || this.ended) return;
      e.preventDefault();
      const id = 'p' + e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      begin(id, e.clientX, e.clientY);
    };
    const move = e => {
      if (useTouch && e.pointerType === 'touch') return;
      // 快速划动时浏览器会把一段内的 move 合并成一个事件，取合并前的原始点逐段判，
      // 划得快、划过好几颗红键时不会漏（Chrome 一帧只派发一个 pointermove）。
      const list = (typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents()) || null;
      if (list && list.length > 1) {
        for (let i = 0; i < list.length; i++) stepTo('p' + list[i].pointerId, list[i].clientX, list[i].clientY);
      } else stepTo('p' + e.pointerId, e.clientX, e.clientY);
    };
    const up = e => {
      if (useTouch && e.pointerType === 'touch') return;
      endAt('p' + e.pointerId, e.clientX, e.clientY);
    };
    // 断触兜底：窗口失焦、标签页切走时把这一指（或全部）清掉。
    // 不清的话会留下“幽灵手指”：它停在原地的坐标会一直替你把黄键自动接住，
    // 而真正的手指再按下去也拿不回来，表现就是“按了没反应 / 长条莫名其妙断”。
    const dropAll = () => {
      this.activeIds.clear();
      this.pointers.clear();
      this.pointerLast.clear();
      this.pointerDown.clear();
    };
    const onBlur = () => dropAll();
    const onVis = () => { if (document.visibilityState === 'hidden') dropAll(); };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    // touchstart 必须 passive:false，否则 preventDefault 被忽略、双指会被当成缩放
    canvas.addEventListener('touchstart', tstart, { passive: false });
    canvas.addEventListener('touchmove', tmove, { passive: false });
    window.addEventListener('touchend', tend);
    window.addEventListener('touchcancel', tend);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('pointerlockchange', onBlur);
    // 长按 Hold 时别让浏览器弹右键菜单/文字选择——那会发 pointercancel，
    // 手指明明还按着却被当成松手，Hold 直接变 MISS。
    const noMenu = e => e.preventDefault();
    canvas.addEventListener('contextmenu', noMenu);

    const keydown = e => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Escape') {
        if (this.running) { e.preventDefault(); this.onEscape && this.onEscape(); }
        return;
      }
      if (!this.running || this.paused || this.ended) return;
      // 键位来自设置页（keymap）：五个 tap 键 + 一个 flick 键，都能自己改。
      if (e.repeat) return;
      if (!this.keyTap[e.code] && e.code !== this.keymap.flick) return;
      e.preventDefault();
      const id = 'k' + e.code;
      this.activeIds.add(id);
      if (e.code === this.keymap.flick) this.contactNearest('flick', 'kflick');
      else this.contactNearest('tap', id);
    };
    const keyup = e => this.release('k' + e.code);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);

    this._unbind = () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      canvas.removeEventListener('touchstart', tstart);
      canvas.removeEventListener('touchmove', tmove);
      window.removeEventListener('touchend', tend);
      window.removeEventListener('touchcancel', tend);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('pointerlockchange', onBlur);
      canvas.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    };
  }

  /* ---------------- 渲染 ---------------- */
  loop() {
    if (this.destroyed) return;
    // 复用同一个回调，不每帧新建闭包（每分钟 3600 个，手机 GC 会抽帧）
    if (!this._rafCb) this._rafCb = () => this.loop();
    requestAnimationFrame(this._rafCb);
    const ct = this.clock.chartTime();      // 唯一时间输入
    if (!this.paused) this.update(ct);
    this.draw(ct);
    this.updateHud(ct);
    this.autoQuality();
  }

  /**
   * 手机上还卡的话，自动档再往下降一档画布分辨率。
   * 只用 performance.now 量帧间隔 —— 这个数不进任何判定、音符位置计算，
   * 与「唯一时间来源是 chartTime」的约束不冲突。
   */
  autoQuality() {
    if (((this.settings && this.settings.quality) || 'auto') !== 'auto') return;
    if (!this.running || this.paused || this.ended) return;
    const now = performance.now();
    if (!this._lastFrameAt) { this._lastFrameAt = now; return; }
    const dt = now - this._lastFrameAt;
    this._lastFrameAt = now;
    if (dt > 120) return;                              // 切后台、长卡顿不算样本
    this._frameAvg = this._frameAvg ? this._frameAvg * 0.9 + dt * 0.1 : dt;
    this._frameTick++;
    if (this._frameTick < 90) return;                  // 约 1.5 秒取一次
    this._frameTick = 0;
    if (this._frameAvg < 21) return;                   // ≥48fps 就不动
    const dpr = this.dpr || 1;
    if (dpr <= 1.02) return;
    this._autoCap = Math.max(1, Math.round((dpr - 0.2) * 100) / 100);
    this._frameAvg = 0;
    this.resize();
  }

  requestLoop() { if (!this._rafCb) this._rafCb = () => this.loop(); requestAnimationFrame(this._rafCb); }

  draw(ct) {
    const ctx = this.ctx, pf = this.pf;
    if (!pf) return;

    // 背景是一张烤好的图：'copy' 直接覆盖整块画布，等价于 clearRect + 三层渐变，
    // 但每帧只有一次 drawImage。
    if (!this._bgCache) this.buildBackdrop();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this._bgCache, 0, 0, this.viewW, this.viewH);
    ctx.globalCompositeOperation = 'source-over';

    const lineMul = (this.settings.lineAlpha == null ? 100 : this.settings.lineAlpha) / 100;

    // 判定线 / 音符 / 打击特效一律裁进 playfield：
    // 判定线在逻辑上是无限长的，旋转或翻转时如果按固定长度画，
    // 两端会甩到 16:9 之外的黑边上、甚至盖住顶部进度条。
    ctx.save();
    ctx.beginPath();
    ctx.rect(pf.x, pf.y, pf.w, pf.h);
    ctx.clip();

    // 每条线这一帧的状态只算一次，后面三趟绘制共用（stateAt 自带帧内缓存，但
    // 三次取键、三次比较也不必要）。
    const states = this._states || (this._states = []);
    states.length = this.lines.length;
    let anyFlashing = false;
    for (let i = 0; i < this.lines.length; i++) {
      const st = this.lines[i].stateAt(ct);
      states[i] = (st.alpha * lineMul <= 0.012) ? null : st;
      if (states[i] && ct - this.lines[i].flashAt < 0.26) anyFlashing = true;
    }

    // 第 0 趟：判定线贴图。原版 drawLine 对带贴图的线只 drawImage，不画线体，
    // 尺寸按官方口径：Vert > 0 → 屏高 × Vert；Vert < 0 → 屏高 × |Vert|，
    // 宽度 = 高度 × 图片宽高比 × Horz。IsDark=1 的贴图在官方是垫在压暗层下面，
    // 这里等效成按压暗层的 alpha 再压一层。
    if (this.lineTex) {
      const a0 = this.bgAlpha == null
        ? 0.02 + ((this.settings.bgDim == null ? 55 : this.settings.bgDim) / 100) * 0.86
        : this.bgAlpha;
      for (let i = 0; i < this.lines.length; i++) {
        const t = this.lines[i].tex;
        if (!t || !states[i] || !states[i].alpha) continue;
        const st = states[i];
        const imgH = t.vert > 0 ? pf.h * t.vert : pf.h * (-t.vert || 1);
        const imgW = imgH * (t.img.naturalWidth / t.img.naturalHeight) * t.horz;
        if (!(imgW > 0) || !(imgH > 0)) continue;
        ctx.save();
        ctx.translate(st.cx, st.cy);
        ctx.rotate(st.angle);
        ctx.globalAlpha = clamp(st.alpha * (t.dark ? Math.max(0, 1 - a0) : 1), 0, 1);
        ctx.drawImage(t.img, -imgW / 2, -imgH / 2, imgW, imgH);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // 第一趟：所有辉光一次性画完。辉光是 'lighter' 加色，以前每画一条线就切一次
    // 合成模式（10 条线 = 20 次切换），Android 的合成管线每切一次都要重新配置，
    // 这就是手机上「一堆判定线」时掉帧的一大来源。
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.lines.length; i++) {
      if (states[i] && !this.lines[i].tex) this.drawLineGlow(this.lines[i], states[i], ct, lineMul);
    }
    ctx.globalCompositeOperation = 'source-over';

    // 第二趟：线体本身
    for (let i = 0; i < this.lines.length; i++) {
      if (states[i] && !this.lines[i].tex) this.drawLineBody(this.lines[i], states[i], lineMul);
    }

    // 第三趟：命中瞬间的亮斑（只有刚判中的 0.26s 内存在，绝大多数帧整趟是空的）
    if (anyFlashing) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.lines.length; i++) {
        if (states[i] && !this.lines[i].tex) this.drawLineFlash(this.lines[i], states[i], ct, lineMul);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    for (const line of this.lines) {
      const st = line.stateAt(ct);
      const notes = line.notes;
      // 已经彻底消失的音符不必每帧再从 0 号重新遍历一遍
      let i0 = line._scanFrom || 0;
      while (i0 < notes.length) {
        const n = notes[i0];
        if (n.state === 2 && ct - n.judgeAt > 0.3) i0++;
        else break;
      }
      if (i0 > 0 && notes[i0] && notes[i0].targetTime - ct > 4.2) i0 = 0;   // 时间倒退的兜底
      line._scanFrom = i0;

      for (let i = i0; i < notes.length; i++) {
        const note = notes[i];
        if (note.targetTime - ct > 4.2) break;
        if (note.state === 2 && ct - note.judgeAt > 0.3) continue;
        if (note.type === 3) this.drawHold(note, line, st, ct);
      }
      for (let i = i0; i < notes.length; i++) {
        const note = notes[i];
        if (note.targetTime - ct > 4.2) break;
        if (note.state === 2 && ct - note.judgeAt > 0.3) continue;
        if (note.type !== 3) this.drawNote(note, line, st, ct);
      }
    }

    this.drawEffects(ct);

    ctx.restore();

    this.drawProgress(ct);
  }

  drawProgress(ct) {
    const ctx = this.ctx, pf = this.pf;
    const dur = Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : 150;
    const prog = clamp(ct / dur, 0, 1);
    const ph = Math.max(2, pf.h * 0.006);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    ctx.fillRect(pf.x, pf.y, pf.w, ph);
    if (prog > 0.001) {
      ctx.save();
      ctx.beginPath(); ctx.rect(pf.x, pf.y, pf.w * prog, ph); ctx.clip();
      if (this.img.progress) {
        ctx.globalAlpha = 0.95;
        ctx.drawImage(this.img.progress, pf.x, pf.y, pf.w, ph);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.fillRect(pf.x, pf.y, pf.w * prog, ph);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  lineHalf(st) {
    // st 本身就是帧内缓存的同一个对象，直接挂在上面记住结果：
    // 辉光 / 线体 / 亮斑三趟都要用它，每个角算 4 次不值得重算三遍。
    if (st.half != null) return st.half;
    const corners = this.pfCorners;
    let half = 0;
    for (let i = 0; i < corners.length; i++) {
      const d = Math.abs((corners[i][0] - st.cx) * st.ux + (corners[i][1] - st.cy) * st.uy);
      if (d > half) half = d;
    }
    st.half = half + 2;                    // 补一点，避免端点落在裁切线内侧留下缝隙
    return st.half;
  }

  /** 只画贴线的一圈暖黄小光。原版的光又窄又亮，不是一个铺开的大光斑。 */
  drawLineGlow(line, st, ct, alphaMul) {
    const glow = this.combo >= 50 ? this.lineGlow.cool : this.lineGlow.warm;
    if (!glow) return;
    const ctx = this.ctx;
    const w = this.lineHalf(st) * 2;
    const flash = clamp(1 - (ct - line.flashAt) / 0.26, 0, 1);
    const gh = glow.h * (1 + flash * 0.3);
    ctx.save();
    ctx.translate(st.cx, st.cy);
    ctx.rotate(st.angle);
    ctx.globalAlpha = clamp(st.alpha * alphaMul * (0.85 + flash * 0.22), 0, 1);
    ctx.drawImage(glow.c, -w / 2, -gh / 2, w, gh);
    ctx.restore();
  }

  /** 线体：暖白黄的细芯 + 中心一条更亮的高光。 */
  drawLineBody(line, st, alphaMul) {
    const ctx = this.ctx;
    const w = this.lineHalf(st) * 2;
    const h = this.lineH;
    ctx.save();
    ctx.translate(st.cx, st.cy);
    ctx.rotate(st.angle);
    ctx.globalAlpha = clamp(st.alpha * alphaMul * 0.98, 0, 1);
    if (this.lineCore) ctx.drawImage(this.lineCore, -w / 2, -h / 2 - h * 0.35, w, h * 1.7);
    else { ctx.fillStyle = '#fff6d6'; ctx.fillRect(-w / 2, -h / 2, w, h); }
    // 中心高光：原版的线中间有一道更实的亮芯（偏暖黄，不是纯白）
    ctx.fillStyle = 'rgba(255,242,186,.92)';
    ctx.fillRect(-w / 2, -Math.max(0.7, h * 0.16), w, Math.max(1.4, h * 0.34));
    ctx.restore();
  }

  /** 命中瞬间在判定线上打一段亮斑（预烤渐变，一次 drawImage） */
  drawLineFlash(line, st, ct, alphaMul) {
    const flash = clamp(1 - (ct - line.flashAt) / 0.26, 0, 1);
    if (flash <= 0.01 || !this.flashBand) return;
    const ctx = this.ctx;
    const h = this.lineH;
    ctx.save();
    ctx.translate(st.cx, st.cy);
    ctx.rotate(st.angle);
    const local = (line.flashX - st.cx) * st.ux + (line.flashY - st.cy) * st.uy;
    // 亮斑也跟着光一起收小（原来 300×h*3.2 的暖光带在手机上很吃填充率）
    ctx.globalAlpha = clamp(flash * 0.85 * alphaMul, 0, 1);
    ctx.drawImage(this.flashBand, local - 118, -h * 2.4, 236, h * 4.8);
    ctx.restore();
  }

  pickNoteImage(note, near) {
    const hl = near || note.isMulti;
    if (note.type === 1) return hl ? (this.img.tapHL || this.img.tap) : this.img.tap;
    if (note.type === 2) return hl ? (this.img.dragHL || this.img.drag) : this.img.drag;
    if (note.type === 4) return hl ? (this.img.flickHL || this.img.flick) : this.img.flick;
    return null;
  }

  noteAlpha(note, ct) {
    // 正在按住的 Hold 必须一直可见：head 时间点过去后不能套用普通音符的淡出，
    // 否则按住 0.34s 后整条长条会透明消失，玩家只能松手 → 白丢一个 MISS。
    if (note.state === 1) return 1;
    if (note.state === 2) {
      // 打完的长条要一直画到尾巴真的过线（官方结算后仍然收尾），不能按 0.3s 淡出
      if (note.type === 3) {                       // 长条不管判成什么，都画到尾巴过线
        const endT = note.targetTime + note.holdDur;
        if (ct <= endT) return 1;
        return clamp(1 - (ct - endT) / 0.12, 0, 1);
      }
      const k = (ct - note.judgeAt) / 0.3;
      if (k <= 0) return 1;
      return k >= 1 ? 0 : 1 - k;
    }
    const passed = ct - note.targetTime;
    if (passed > 0) return clamp(1 - passed / 0.34, 0, 1);
    return 1;
  }

  drawNote(note, line, st, ct) {
    const alpha = this.noteAlpha(note, ct);
    if (alpha <= 0.01) return;
    const ctx = this.ctx;
    const t = note.state === 2 ? Math.min(ct, note.targetTime) : ct;
    const p = line.notePoint(note, t, st, this._pt || (this._pt = { x: 0, y: 0, d: 0 }));
    // 屏外剔除：绘制区被裁到 playfield，框外的音符画了也看不见。
    // 提前 4.2 秒的音符大多在两三屏外，这一步直接省掉它们的变换与贴图。
    const pf = this.pf, cr = this._noteCullR;
    if (p.x < pf.x - cr || p.x > pf.x + pf.w + cr || p.y < pf.y - cr || p.y > pf.y + pf.h + cr) return;
    const delta = Math.abs(ct - note.targetTime);
    const near = delta < 0.08;
    const pop = clamp(1 - delta / 0.22, 0, 1);

    const img = this.pickNoteImage(note, near);
    const sc = 1 + pop * 0.06 + (note.state === 2 ? clamp((ct - note.judgeAt) / 0.3, 0, 1) * 0.18 : 0);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(st.angle);
    ctx.globalAlpha = alpha * clamp(st.alpha * 0.35 + 0.65, 0, 1);   // 音符不随判定线一起消失
    ctx.scale(sc, sc);
    if (img) {
      const w = img.width * this.noteScale;
      const h = img.height * this.noteScale;
      // 光晕是预烤好的贴图，替代每帧一次的 shadowBlur（连续黄键时这一步能吃掉 18ms/帧）
      const g = this.glows[note.type];
      const sprite = g ? (near ? g.hot : g.soft) : null;
      if (sprite) ctx.drawImage(sprite.c, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      this.drawGlyphFallback(note, near);
    }
    ctx.restore();
  }

  drawGlyphFallback(note, near) {
    const ctx = this.ctx;
    const m = this.noteMetrics(note.type);
    const colors = { 1: ['#e6faff', '#4fb9ec'], 2: ['#fffbd0', '#c9bd39'], 3: ['#e6faff', '#4fb9ec'], 4: ['#ff9bae', '#b12449'] };
    const c = colors[note.type] || colors[1];
    const g = ctx.createLinearGradient(0, -m.h / 2, 0, m.h / 2);
    g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
    ctx.fillStyle = g;
    ctx.shadowBlur = near ? 22 : 10;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-m.w / 2, -m.h / 2, m.w, m.h, m.h * 0.42);
    else ctx.rect(-m.w / 2, -m.h / 2, m.w, m.h);
    ctx.fill();
  }

  drawHold(note, line, st, ct) {
    const endT = note.targetTime + note.holdDur;
    // 官方 drawNote：长条只按「头部时间 + 时长」判断是否还画，
    // 判 Miss / 判中都不影响它继续收尾（type!=3 才看 scored）。
    if (ct > endT) return;
    const missed = note.state === 2 && note.grade === 'MISS';
    let alpha = this.noteAlpha(note, ct);
    if (missed) alpha *= 0.45;                     // 官方判 Miss 后长条变半透明，而不是消失
    if (alpha <= 0.01) return;
    const ctx = this.ctx;
    const a = line.anchor(note, st, this._ptA || (this._ptA = { x: 0, y: 0 }));
    const rate = this.pps * note.noteSpeed * this.speedMul;   // px / 秒
    const len = rate * note.holdDur;                          // 整条长度（不随滚动变速）
    const held = note.state === 1 || missed || (note.state === 2 && note.grade !== 'MISS');
    let headD, tailD;
    if (held) {
      headD = 0;
      tailD = Math.max(0, endT - ct) * rate;
    } else {
      headD = (note.targetTime - ct) * rate;
      tailD = headD + len;
    }
    if (tailD <= 0.5) return;

    // 屏外剔除：整条长条从锚点沿法线伸到 tailD，加上横向宽度就是它的包围半径。
    const pf = this.pf;
    const hr = Math.max(Math.abs(tailD), Math.abs(headD), len) + this._holdCullR;
    if (a.x < pf.x - hr || a.x > pf.x + pf.w + hr || a.y < pf.y - hr || a.y > pf.y + pf.h + hr) return;

    const s = this.noteScale;
    const sign = note.above ? 1 : -1;

    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(st.angle);
    ctx.scale(1, sign);
    ctx.globalAlpha = alpha;

    const bodyH = Math.max(1, tailD - headD);
    // 官方长条本体就是 Hold.png 直接拉伸，不加色、不发光、按住也不换贴图
    if (bodyH >= 2) {
      if (this.img.holdBody) {
        const bw = this.img.holdBody.width * s;
        ctx.drawImage(this.img.holdBody, -bw / 2, -tailD, bw, bodyH);
      } else {
        const bw = 989 * s * 0.78;
        ctx.fillStyle = 'rgba(190,230,255,.55)';
        ctx.fillRect(-bw / 2, -tailD, bw, bodyH);
      }
    }

    // 尾帽：官方贴在本体末端上方（底边与条子末端对齐）
    const endImg = this.img.holdEnd;
    if (endImg && tailD >= 1) {
      const ew = endImg.width * s, eh = endImg.height * s;
      ctx.drawImage(endImg, -ew / 2, -tailD - eh, ew, eh);
    }

    // 头部只在「还没按下去」的时候画；按住以后头就没了
    const headImg = this.img.holdHead || this.img.holdHeadHL;
    if (headImg && !held && headD >= -0.5) {
      const hw = headImg.width * s, hh = headImg.height * s;
      ctx.drawImage(headImg, -hw / 2, -headD - hh / 2, hw, hh);
    }
    ctx.restore();
  }

  drawEffects(ct) {
    const ctx = this.ctx;
    const fx = this.effects;
    if (!fx.length) return;

    // 分三趟画，而不是每个特效各自 save / 切一次加色混合：
    // Canvas2D 每切换一次 globalCompositeOperation，Android 的合成管线都要重新配置，
    // 连续黄键时一帧十几个特效就是十几次切换——这是“黄键连打掉帧”的隐形开销。
    for (const e of fx) {
      if (e.kind !== 'miss') continue;
      const age = ct - e.born;
      if (age < 0 || age > 0.62) continue;
      const k = clamp(age / 0.42, 0, 1);
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = JUDGE_COLORS.MISS;
      ctx.lineWidth = 3 * (1 - k * 0.5) * (this.pf.w / 900);
      ctx.shadowColor = JUDGE_COLORS.MISS;
      ctx.shadowBlur = 16;
      const r = 18 + k * 34;
      ctx.beginPath();
      ctx.moveTo(e.x - r, e.y - r * 0.42); ctx.lineTo(e.x + r, e.y + r * 0.42);
      ctx.moveTo(e.x + r, e.y - r * 0.42); ctx.lineTo(e.x - r, e.y + r * 0.42);
      ctx.stroke();
      ctx.restore();
    }

    const hits = fx.filter(e => e.kind !== 'miss');
    if (!hits.length) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 官方 ClickEvent1：noteScale * 6 铺 256×256 的 30 帧图，整段 0.5s；
    // 再叠 3~4 个同色小方块往外溅（距离 185~265 局部单位）。没有大光球、没有冲击环。
    for (const e of hits) {
      const age = ct - e.born;
      if (age < 0 || age > 0.62) continue;
      const tick = clamp(age / 0.5, 0, 1);
      const sheet = this.clickFrames[e.grade];
      const s = this.noteScale * 6 * (e.light ? 0.7 : 1);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.scale(s, s);
      ctx.globalAlpha = e.light ? 0.7 : 1;
      if (sheet) {
        const frame = Math.min(29, Math.floor(tick * 30));
        ctx.drawImage(sheet, 0, frame * 256, 256, 256, -128, -128, 256, 256);
      }
      if (e.parts.length) {
        ctx.globalAlpha = (1 - tick) * (e.light ? 0.55 : 1);
        ctx.fillStyle = JUDGE_COLORS[e.grade] || '#fff';
        const size = 30 * (((0.2078 * tick - 1.6524) * tick + 1.6399) * tick + 0.4988);
        const ds9 = 9 * tick / (8 * tick + 1);
        for (const p of e.parts) {
          const ds = p.v * ds9;
          ctx.fillRect(p.cx * ds - size / 2, p.cy * ds - size / 2, size, size);
        }
      }
      ctx.restore();
    }

    ctx.restore();
  }

  /* ---------------- 结算 ---------------- */
  /**
   * 评级按官方 Phigros 的分数线，不看 ACC：
   *   φ（PHI）一分不扣；V ≥960000；S ≥920000；A ≥880000；B ≥820000；
   *   C ≥700000；再低就是 FALSE。全连/全 Perfect 另外给 FC / AP 标记。
   */
  result() {
    const acc = this.judged ? 100 * this.scoreSum / this.judged : 100;
    const score = Math.round(1e6 * this.scoreSum / Math.max(1, this.total));
    const c = this.counts;
    const ap = c.MISS === 0 && c.BAD === 0 && c.GOOD === 0 && this.judged >= this.total;
    let rank;
    if (ap) rank = 'PHI';
    else if (score >= 960000) rank = 'V';
    else if (score >= 920000) rank = 'S';
    else if (score >= 880000) rank = 'A';
    else if (score >= 820000) rank = 'B';
    else if (score >= 700000) rank = 'C';
    else rank = 'FALSE';
    return {
      score, acc,
      maxCombo: this.maxCombo,
      total: this.total,
      counts: { ...c },
      early: this.early, late: this.late,
      fullCombo: c.MISS === 0 && c.BAD === 0,
      allPerfect: ap,
      rank
    };
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    this.running = false;
    this.clock.pause();
    this.onFinish(this.result());
  }
}

window.PG = { Game, AudioClock, SfxBank, loadAssets, loadImage, ASSET_FILES, SFX_FILES, WINDOWS, JUDGE_COLORS };
