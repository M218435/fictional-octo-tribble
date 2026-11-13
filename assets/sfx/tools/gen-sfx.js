/**
 * RTSX 音效生成器 v2
 * 48kHz 立体声 16-bit PCM，程序合成；加入柔化包络、低通、类混响尾音、软限幅
 * 运行： node gen-sfx.js
 */
const fs = require("fs");
const path = require("path");

const SR = 48000;
const OUT = path.join(__dirname, "..");
const FILES = [];
const EMBED = {};

/* ---------- 基础 ---------- */
function make(dur) {
  const n = Math.round(dur * SR);
  return { n: n, L: new Float32Array(n), R: new Float32Array(n) };
}
function t2i(t) { return Math.round(t * SR); }

function mixStereo(buf, i, v, pan) {
  if (i < 0 || i >= buf.n) return;
  const p = pan || 0;                 // -1..1
  const l = Math.sqrt((1 - p) * 0.5) * 1.414;
  const r = Math.sqrt((1 + p) * 0.5) * 1.414;
  buf.L[i] += v * l * 0.5;
  buf.R[i] += v * r * 0.5;
}

/* 正弦层：可扫频 + 软攻击 + 双指数尾巴 */
function tone(buf, o) {
  const start = t2i(o.start || 0);
  const n = t2i(o.dur || 0.2);
  const f0 = o.freq || 440;
  const f1 = o.to == null ? f0 : o.to;
  const amp = o.amp == null ? 0.5 : o.amp;
  const atk = t2i(o.attack == null ? 0.006 : o.attack);
  const d1 = o.decay == null ? 12 : o.decay;      // 主衰减速度
  const d2 = o.tail == null ? 2.4 : o.tail;       // 尾巴衰减
  let ph = (o.phase || 0) * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const f = f0 + (f1 - f0) * Math.pow(k, o.curve == null ? 1 : o.curve);
    ph += (2 * Math.PI * f) / SR;
    let e;
    if (i < atk) { const a = i / Math.max(1, atk); e = a * a * (3 - 2 * a); }
    else {
      const kk = (i - atk) / Math.max(1, n - atk);
      e = 0.55 * Math.exp(-d1 * kk) + 0.45 * Math.exp(-d2 * kk);
    }
    mixStereo(buf, start + i, Math.sin(ph) * amp * e, o.pan || 0);
  }
}

/* 噪声层：低通+高通近似带通，适合"气声/摩擦" */
function noise(buf, o) {
  const start = t2i(o.start || 0);
  const n = t2i(o.dur || 0.15);
  const amp = o.amp == null ? 0.3 : o.amp;
  const lp = o.lp == null ? 0.25 : o.lp;     // 低通系数（越小越闷）
  const hpA = o.hp == null ? 0 : o.hp;       // 高通系数
  const decay = o.decay == null ? 10 : o.decay;
  let z = 0, hz = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const raw = Math.random() * 2 - 1;
    z += lp * (raw - z);
    hz += hpA * (z - hz);
    const sig = z - hz;
    const e = Math.exp(-decay * k);
    mixStereo(buf, start + i, sig * amp * e, o.pan || 0);
  }
}

/* 金属/木质混合：非谐泛音，听起来不"电子" */
function chime(buf, o) {
  const base = o.freq || 660;
  const parts = o.parts || [1, 2.32, 3.71, 5.1];
  const amps = o.amps || [1, 0.42, 0.24, 0.12];
  const decay = o.decay == null ? 9 : o.decay;
  const dur = o.dur || 0.34;
  const amp = o.amp == null ? 0.5 : o.amp;
  parts.forEach((m, i) => {
    tone(buf, {
      freq: base * m, amp: amp * amps[i], dur: dur * (1 - i * 0.08),
      start: o.start || 0, decay: decay * (1 + i * 1.15), tail: 3.2,
      attack: 0.004, pan: (o.pan || 0) + (i - 1.5) * 0.06
    });
  });
}

/* 类混响：几组短延迟反馈，给尾音一点空间感（不适合做大厅，只做"房间"） */
function room(buf, mix) {
  const taps = [
    { d: 0.0091, g: 0.42 }, { d: 0.0137, g: 0.36 },
    { d: 0.0193, g: 0.30 }, { d: 0.0267, g: 0.22 }
  ];
  const chans = [buf.L, buf.R];
  chans.forEach((ch, ci) => {
    const src = Float32Array.from(ch);
    const acc = new Float32Array(buf.n);
    taps.forEach((t, ti) => {
      const del = t2i(t.d * (ci ? 1.12 : 1.0)) + ti;
      const g = t.g * (mix == null ? 1 : mix);
      let prev = 0;
      for (let i = del; i < buf.n; i++) {
        let v = src[i - del];
        prev += 0.35 * (v - prev);          // 让尾音偏暗
        acc[i] += prev * g;
      }
    });
    // 湿声叠加
    for (let i = 0; i < buf.n; i++) ch[i] += acc[i] * 0.55;
  });
}

/* 软化：低通去除毛刺，然后软限幅 */
function smooth(buf, cutoff) {
  const a = Math.min(0.95, (cutoff || 5200) / SR * 2 * Math.PI);
  [buf.L, buf.R].forEach(ch => {
    let z = 0;
    for (let i = 0; i < buf.n; i++) { z += a * (ch[i] - z); ch[i] = z; }
  });
}

function limit(buf, peak) {
  const p = peak || 0.72;
  let mx = 0;
  [buf.L, buf.R].forEach(ch => { for (let i = 0; i < ch.length; i++) mx = Math.max(mx, Math.abs(ch[i])); });
  if (mx < 1e-7) return;
  const g = p / mx;
  [buf.L, buf.R].forEach(ch => {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i] * g;
      ch[i] = Math.tanh(x * 1.05) * 0.96;   // 软限幅，去掉硬削的刺耳
    }
  });
}

/* 只软化尾部，起音保留冲击感；顺带去掉直流偏置 */
function fade(buf, ms) {
  const n = Math.min(t2i(ms / 1000), Math.floor(buf.n / 2));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    buf.L[buf.n - 1 - i] *= k; buf.R[buf.n - 1 - i] *= k;
  }
  [buf.L, buf.R].forEach(ch => {
    let m = 0;
    for (let i = 0; i < ch.length; i++) m += ch[i];
    m /= ch.length;
    for (let i = 0; i < ch.length; i++) ch[i] -= m;
  });
}

const OUT_SR = 16000;          // 落盘采样率：音效内容都在 5k 以下，16k 足够
const HOT = /^ui-click/;   // 点击音内嵌进 sfx.js，点下去立刻响，不等请求

function save(name, buf, peak) {
  // 先软限幅到 1.0，再统一峰值到 0.8；各类响度由 sfx.js 的 GAIN 控制
  limit(buf, 1.0);
  (function () {
    let pk = 0;
    [buf.L, buf.R].forEach(ch => { for (let i = 0; i < ch.length; i++) pk = Math.max(pk, Math.abs(ch[i])); });
    if (pk > 1e-6) {
      const g = 0.8 / pk;
      [buf.L, buf.R].forEach(ch => { for (let i = 0; i < ch.length; i++) ch[i] *= g; });
    }
  })();
  fade(buf, 6);

  // 降采样到 OUT_SR + 合并单声道（手机外放本来就是单声道）
  const factor = Math.round(SR / OUT_SR);
  const n = Math.floor(buf.n / factor);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < factor; k++) {
      const j = i * factor + k;
      acc += (buf.L[j] + buf.R[j]) * 0.5;
    }
    mono[i] = acc / factor;
  }

  const data = Buffer.alloc(44 + n * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);           // 单声道
  data.writeUInt32LE(OUT_SR, 24);
  data.writeUInt32LE(OUT_SR * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, mono[i])) * 32767;
    data.writeInt16LE(v < 0 ? v - 0.5 | 0 : v + 0.5 | 0, 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, name + ".wav"), data);
  FILES.push({ name: name + ".wav", bytes: data.length, ms: Math.round(n / OUT_SR * 1000) });
  if (HOT.test(name)) EMBED[name + ".wav"] = data.toString("base64");
}

/* ======================================================================
   1. 点击：木质轻叩（低频body + 高频柔tick + 一点气），不刺耳
   ====================================================================== */
[
  { f: 1180, body: 210, pan: -0.1 },
  { f: 980, body: 176, pan: 0.12 },
  { f: 1420, body: 240, pan: 0.0 }
].forEach((v, i) => {
  const b = make(0.10);
  tone(b, { freq: v.body, amp: 0.30, dur: 0.085, decay: 26, tail: 6, attack: 0.004, pan: v.pan });
  tone(b, { freq: v.f, amp: 0.34, dur: 0.055, decay: 40, tail: 9, attack: 0.002, pan: v.pan + 0.04 });
  noise(b, { amp: 0.10, dur: 0.035, decay: 30, lp: 0.6, hp: 0.02, pan: v.pan });
  room(b, 0.35);
  smooth(b, 6000);
  save("ui-click-" + (i + 1), b, 0.62);
});

/* 2. 悬停：一声很轻的呼吸 */
[
  { f: 540, pan: -0.15 },
  { f: 620, pan: 0.15 }
].forEach((v, i) => {
  const b = make(0.16);
  tone(b, { freq: v.f, to: v.f * 1.09, amp: 0.18, dur: 0.15, decay: 22, tail: 6, attack: 0.012, pan: v.pan, curve: 2 });
  noise(b, { amp: 0.05, dur: 0.12, decay: 16, lp: 0.14, hp: 0.01, pan: v.pan });
  room(b, 0.5);
  smooth(b, 4200);
  save("ui-hover-" + (i + 1), b, 0.36);
});

/* 3. 返回：往下走的气声 */
[
  { f: 760, pan: 0.1 },
  { f: 900, pan: -0.1 }
].forEach((v, i) => {
  const b = make(0.24);
  tone(b, { freq: v.f, to: v.f * 0.46, amp: 0.26, dur: 0.22, decay: 14, tail: 4, attack: 0.008, pan: v.pan, curve: 1.6 });
  noise(b, { amp: 0.16, dur: 0.2, decay: 12, lp: 0.2, hp: 0.005, pan: v.pan });
  room(b, 0.45);
  smooth(b, 4800);
  save("ui-back-" + (i + 1), b, 0.5);
});

/* 4. 得分：低频支撑 + 温暖钟 + 亮片，明确"奖励感" */
[0, 1, 2].forEach((v) => {
  const b = make(0.52);
  const base = 880 + v * 36;
  tone(b, { freq: 96, amp: 0.24, dur: 0.18, decay: 28, tail: 8, attack: 0.004 });
  chime(b, { freq: base, amp: 0.42, dur: 0.44, decay: 8.5, parts: [1, 2.02, 3.06, 4.62], amps: [1, 0.34, 0.16, 0.07] });
  chime(b, { freq: base * 1.52, amp: 0.13, start: 0.02, dur: 0.18, decay: 22, parts: [1, 1.41], amps: [1, 0.3] });
  tone(b, { freq: base * 0.5, amp: 0.12, dur: 0.34, decay: 14, tail: 4.5, attack: 0.008 });
  room(b, 0.8);
  smooth(b, 5800);
  save("score-" + (v + 1), b, 0.58);
});

/* 5. 接住：温润的拨弦 + 细碎亮片 */
[392, 466, 554].forEach((f, i) => {
  const b = make(0.36);
  tone(b, { freq: f, to: f * 1.05, amp: 0.40, dur: 0.3, decay: 13, tail: 4, attack: 0.006, curve: 2 });
  tone(b, { freq: f * 2.02, amp: 0.14, dur: 0.2, decay: 20, tail: 6, attack: 0.004, pan: 0.2 });
  noise(b, { amp: 0.09, dur: 0.12, decay: 14, lp: 0.5, hp: 0.02, pan: -0.2 });
  chime(b, { freq: f * 3.1, amp: 0.10, dur: 0.1, start: 0.05, decay: 26, parts: [1, 1.9], amps: [1, 0.3] });
  room(b, 0.55);
  smooth(b, 6000);
  save("catch-" + (i + 1), b, 0.6);
});

/* 6. 错误：闷住的低音 + 一点干涩，不做电子蜂鸣 */
[
  { f: 132, lp: 0.06, pan: -0.08 },
  { f: 108, lp: 0.05, pan: 0.08 }
].forEach((v, i) => {
  const b = make(0.42);
  tone(b, { freq: v.f, to: v.f * 1.14, amp: 0.36, dur: 0.4, decay: 11, tail: 3.4, attack: 0.014, pan: v.pan, curve: 1.4 });
  tone(b, { freq: v.f * 2.3, amp: 0.10, dur: 0.24, decay: 18, tail: 5, attack: 0.01 });
  noise(b, { amp: 0.14, dur: 0.32, decay: 10, lp: v.lp, hp: 0.004, pan: v.pan });
  room(b, 0.4);
  smooth(b, 3000);
  save("error-" + (i + 1), b, 0.5);
});

/* 7. 落地：闷重，低频下沉 */
[0, 1, 2].forEach((i) => {
  const b = make(0.30);
  const f = 54 + i * 7;
  tone(b, { freq: f, to: f * 0.82, amp: 0.42, dur: 0.29, decay: 15, tail: 3.2, attack: 0.008, curve: 1.2 });
  tone(b, { freq: f * 2.6, amp: 0.16, dur: 0.16, decay: 22, tail: 4, attack: 0.006 });
  noise(b, { amp: 0.30, dur: 0.10, decay: 18, lp: 0.09, hp: 0.002, pan: (i - 1) * 0.15 });
  room(b, 0.45);
  smooth(b, 2600);
  save("land-" + (i + 1), b, 0.56);
});

/* 8. 异常体：数字碎片 + 量化颗粒，脏但有节奏，不炸耳 */
[0, 1, 2].forEach((v) => {
  const b = make(0.40);
  tone(b, { freq: 118 + v * 14, to: 152 + v * 18, amp: 0.16, dur: 0.34, decay: 8, tail: 3, attack: 0.004, pan: -0.12 });
  const steps = [0, 0.035, 0.08, 0.118, 0.156, 0.198, 0.242];
  const pitches = [620, 900, 540, 1140, 760, 1320, 480];
  steps.forEach((t, i) => {
    const f = pitches[(i + v) % pitches.length];
    tone(b, {
      freq: f, to: f * (0.72 + ((i + v) % 3) * 0.18), amp: 0.19,
      dur: 0.032, decay: 55, tail: 14, attack: 0.002, start: t,
      pan: ((i % 3) - 1) * 0.3
    });
  });
  // 轻度量化，做出数字颗粒感又不至于刺耳
  const q = 1 / 64;
  [b.L, b.R].forEach(ch => { for (let i = 0; i < ch.length; i++) ch[i] = Math.round(ch[i] / q) * q; });
  room(b, 0.4);
  smooth(b, 5400);
  save("glitch-" + (v + 1), b, 0.55);
});

/* 9. 警告：两下低调的提示，像设备提示音 */
[
  { f: 440, pan: -0.06 },
  { f: 523, pan: 0.06 }
].forEach((v, i) => {
  const b = make(0.46);
  tone(b, { freq: v.f, amp: 0.30, dur: 0.15, decay: 14, tail: 5, attack: 0.01, pan: v.pan });
  tone(b, { freq: v.f * 1.02, amp: 0.14, dur: 0.15, decay: 16, tail: 6, attack: 0.012, start: 0.2, pan: v.pan });
  room(b, 0.55);
  smooth(b, 4000);
  save("warn-" + (i + 1), b, 0.5);
});

/* 10. 打开/开始：直接用开关音（用户指定），这里不再单独生成 start-*.wav */

/* 11. 完成：四音上行，尾巴长一点 */
[0, 1].forEach((v) => {
  const b = make(0.82);
  const notes = v === 0 ? [523, 659, 784, 1046] : [587, 698, 880, 1174];
  notes.forEach((f, i) => {
    chime(b, { freq: f, amp: 0.26, start: i * 0.1, dur: 0.34, decay: 14, parts: [1, 2.1, 3.5], amps: [1, 0.3, 0.14] });
  });
  room(b, 0.85);
  smooth(b, 5200);
  save("success-" + (v + 1), b, 0.54);
});

/* 12. 开关：两下小咔哒 */
[0, 1].forEach((v) => {
  const b = make(0.17);
  tone(b, { freq: 900 - v * 90, amp: 0.24, dur: 0.04, decay: 40, tail: 10, attack: 0.002, pan: -0.08 });
  tone(b, { freq: 640 + v * 60, amp: 0.18, dur: 0.05, decay: 36, tail: 9, attack: 0.002, start: 0.06, pan: 0.08 });
  noise(b, { amp: 0.10, dur: 0.025, decay: 30, lp: 0.5, hp: 0.01 });
  room(b, 0.25);
  smooth(b, 5000);
  save("toggle-" + (v + 1), b, 0.45);
});

/* ---------- 清单 ---------- */
const manifest = {
  version: 2,
  sampleRate: OUT_SR,
  channels: 1,
  generatedAt: new Date().toISOString(),
  total: FILES.length,
  bytes: FILES.reduce((s, f) => s + f.bytes, 0),
  embedded: Object.keys(EMBED).length,
  files: FILES
};
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

/* ---------- 把常用音效内嵌进 sfx.js（放在标记之间，重复生成会覆盖旧数据） ---------- */
(function patchEmbed() {
  const jsPath = path.join(OUT, "sfx.js");
  if (!fs.existsSync(jsPath)) return;
  const src = fs.readFileSync(jsPath, "utf8");
  const re = /\/\*@@EMBED\*\/[\s\S]*?\/\*@@\/EMBED\*\//;
  if (!re.test(src)) {
    console.log("! sfx.js 里没有 /*@@EMBED*/ 标记，跳过内嵌");
    return;
  }
  const body =
    "/*@@EMBED*/\n" +
    "  // 以下为常用音效的 base64 WAV（24k 单声道），内嵌后点击时不需要再发请求\n" +
    "  var EMBED = {\n" +
    Object.keys(EMBED).map(k => '    "' + k + '": "' + EMBED[k] + '"').join(",\n") +
    "\n  };\n" +
    "  /*@@/EMBED*/";
  fs.writeFileSync(jsPath, src.replace(re, body), "utf8");
  console.log("内嵌 " + Object.keys(EMBED).length + " 个音效到 sfx.js");
})();

console.log("files=" + FILES.length + "  total=" + (manifest.bytes / 1024).toFixed(1) + " KB");
FILES.forEach(f => console.log("  " + f.name + "  " + f.ms + "ms  " + (f.bytes / 1024).toFixed(1) + "KB"));
