/**
 * RTSX 音效生成器（离线、无版权素材）
 * 用程序合成 16-bit PCM WAV，直接产出 assets/sfx/*.wav
 * 运行： node gen-sfx.js
 */
const fs = require("fs");
const path = require("path");

const SR = 44100;
const OUT = path.join(__dirname, "..");
const FILES = [];

function buf(dur) { return new Float32Array(Math.max(1, Math.round(dur * SR))); }
function idx(t) { return Math.round(t * SR); }

function sine(b, o) {
  const start = idx(o.start || 0);
  const dur = o.dur || 0.2;
  const n = idx(dur);
  const f0 = o.freq || 440, f1 = o.sweepTo || f0;
  const amp = o.amp == null ? 0.6 : o.amp;
  const decay = o.decay == null ? 3 : o.decay;
  const attack = o.attack == null ? 0.004 : o.attack;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const f = f0 + (f1 - f0) * k;
    ph += (2 * Math.PI * f) / SR;
    let e;
    if (i < idx(attack)) e = i / Math.max(1, idx(attack));
    else e = Math.exp(-decay * (k - attack / dur));
    const s = Math.sin(ph) * amp * e;
    const j = start + i;
    if (j < b.length) b[j] += s;
  }
}

function noise(b, o) {
  const start = idx(o.start || 0);
  const n = idx(o.dur || 0.2);
  const amp = o.amp == null ? 0.4 : o.amp;
  const decay = o.decay == null ? 4 : o.decay;
  const lp = o.lowpass == null ? 0.35 : o.lowpass;   // 0..1 越小越闷
  let z = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const raw = Math.random() * 2 - 1;
    z += lp * (raw - z);
    const e = Math.exp(-decay * k);
    const j = start + i;
    if (j < b.length) b[j] += z * amp * e;
  }
}

function bell(b, o) {
  // 基频 + 泛音，做"叮"的金属感
  const parts = o.parts || [1, 2.01, 3.02, 4.98];
  const amps = o.amps || [1, 0.45, 0.28, 0.14];
  const base = o.freq || 880;
  const start = o.start || 0;
  const decay = o.decay == null ? 2.2 : o.decay;
  const amp = o.amp == null ? 0.5 : o.amp;
  parts.forEach((m, i) => {
    sine(b, { freq: base * m, amp: amp * amps[i], start, dur: o.dur || 0.4, decay: decay * (1 + i * 0.6) });
  });
}

function hp(b, cutoff) {
  // 简单一阶高通，让噪声更像"气声"
  let z = 0;
  const a = Math.min(0.99, cutoff / SR * 2 * Math.PI);
  for (let i = 0; i < b.length; i++) {
    z += a * (b[i] - z);
    b[i] -= z;
  }
}

function normalize(b, peak) {
  let mx = 0;
  for (let i = 0; i < b.length; i++) mx = Math.max(mx, Math.abs(b[i]));
  if (mx < 1e-6) return;
  const g = peak / mx;
  for (let i = 0; i < b.length; i++) b[i] *= g;
}

function fadeEdges(b, ms) {
  const n = Math.min(idx(ms / 1000), (b.length / 2) | 0);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    b[i] *= k;
    b[b.length - 1 - i] *= k;
  }
}

function save(name, b, peak) {
  normalize(b, peak || 0.9);
  fadeEdges(b, 4);
  const n = b.length;
  const data = Buffer.alloc(44 + n * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SR, 24);
  data.writeUInt32LE(SR * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, b[i])) * 32767;
    data.writeInt16LE(v < 0 ? v - 0.5 | 0 : v + 0.5 | 0, 44 + i * 2);
  }
  const file = path.join(OUT, name + ".wav");
  fs.writeFileSync(file, data);
  FILES.push({ name: name + ".wav", bytes: data.length, ms: Math.round(n / SR * 1000) });
}

/* ---------------- 逐个音效 ---------------- */

// UI 点击：干脆的短促 tick
[1250, 980, 1560].forEach((f, i) => {
  const b = buf(0.085);
  sine(b, { freq: f, amp: 0.55, decay: 7, attack: 0.002 });
  sine(b, { freq: f * 1.9, amp: 0.18, decay: 10 });
  noise(b, { amp: 0.12, dur: 0.03, decay: 8, lowpass: 0.9 });
  save("ui-click-" + (i + 1), b, 0.82);
});

// UI 悬停：极轻的软 blip
[620, 720].forEach((f, i) => {
  const b = buf(0.13);
  sine(b, { freq: f, amp: 0.22, decay: 5, attack: 0.006, sweepTo: f * 1.08 });
  save("ui-hover-" + (i + 1), b, 0.6);
});

// 返回：下滑
[900, 1100].forEach((f, i) => {
  const b = buf(0.19);
  sine(b, { freq: f, sweepTo: f * 0.45, amp: 0.4, decay: 4, attack: 0.005 });
  noise(b, { amp: 0.06, dur: 0.08, decay: 6, lowpass: 0.5 });
  save("ui-back-" + (i + 1), b, 0.78);
});

// 得分：明亮叮声
[1046, 1318, 1568].forEach((f, i) => {
  const b = buf(0.33);
  bell(b, { freq: f, amp: 0.55, dur: 0.3, decay: 2.4, parts: [1, 2.01, 3.05], amps: [1, 0.4, 0.2] });
  save("score-" + (i + 1), b, 0.86);
});

// 收下/接住：带一点闪光的拨弦
[440, 523, 622].forEach((f, i) => {
  const b = buf(0.30);
  sine(b, { freq: f, amp: 0.5, decay: 3.4, attack: 0.003, sweepTo: f * 1.12 });
  sine(b, { freq: f * 2.4, amp: 0.16, decay: 6 });
  noise(b, { amp: 0.10, dur: 0.07, decay: 7, lowpass: 0.95 });
  save("catch-" + (i + 1), b, 0.88);
});

// 错误 / 拒绝：低频嗡
[150, 128].forEach((f, i) => {
  const b = buf(0.36);
  sine(b, { freq: f, amp: 0.5, decay: 2.6, attack: 0.006, sweepTo: f * 1.35 });
  sine(b, { freq: f * 0.5, amp: 0.25, decay: 2.0 });
  noise(b, { amp: 0.08, dur: 0.2, decay: 3, lowpass: 0.18 });
  save("error-" + (i + 1), b, 0.9);
});

// 落地：闷重撞击
[0, 1, 2].forEach((i) => {
  const b = buf(0.26);
  sine(b, { freq: 68 + i * 9, amp: 0.5, decay: 3.2, attack: 0.005 });
  sine(b, { freq: 130 + i * 14, amp: 0.22, decay: 5 });
  noise(b, { amp: 0.34, dur: 0.07, decay: 6, lowpass: 0.22 });
  save("land-" + (i + 1), b, 0.9);
});

// 异常体 / 故障：门限噪声 + 方波扫频
[0, 1, 2].forEach((v) => {
  const b = buf(0.34);
  const f0 = 200 + v * 30;
  sine(b, { freq: f0, sweepTo: f0 * 2.6, amp: 0.32, decay: 1.4, attack: 0.004 });
  sine(b, { freq: f0 * 1.7, sweepTo: f0 * 0.6, amp: 0.18, decay: 1.8 });
  noise(b, { amp: 0.5, dur: 0.3, decay: 1.2, lowpass: 0.85 });
  // 门限：每 0.02 秒开关一次，做出数字故障感
  for (let i = 0; i < b.length; i++) {
    const gate = Math.sin(i / SR * Math.PI * 2 * 26) > 0 ? 1 : 0.25;
    b[i] *= gate;
  }
  hp(b, 120);
  save("glitch-" + (v + 1), b, 0.86);
});

// 警告：两声短促提示
[520, 640].forEach((f, i) => {
  const b = buf(0.42);
  sine(b, { freq: f, amp: 0.42, decay: 9, attack: 0.005, dur: 0.13 });
  sine(b, { freq: f * 1.06, amp: 0.17, decay: 9, dur: 0.13, start: 0.16 });
  save("warn-" + (i + 1), b, 0.84);
});

// 开始：上冲能量
[0, 1].forEach((v) => {
  const b = buf(0.55);
  sine(b, { freq: 220 + v * 40, sweepTo: 880 + v * 120, amp: 0.45, decay: 1.1, attack: 0.01 });
  sine(b, { freq: 330, sweepTo: 1320, amp: 0.2, decay: 1.4, attack: 0.02 });
  noise(b, { amp: 0.12, dur: 0.4, decay: 1.6, lowpass: 0.6 });
  save("start-" + (v + 1), b, 0.88);
});

// 完成：琶音
[0, 1].forEach((v) => {
  const b = buf(0.62);
  const notes = v === 0 ? [523, 659, 784, 1046] : [587, 740, 880, 1174];
  notes.forEach((f, i) => {
    bell(b, { freq: f, amp: 0.42, start: i * 0.09, dur: 0.3, decay: 3.0 });
  });
  save("success-" + (v + 1), b, 0.86);
});

// 开关：双击咔嗒
[0, 1].forEach((v) => {
  const b = buf(0.14);
  sine(b, { freq: 1500 - v * 200, amp: 0.4, decay: 12, attack: 0.002, dur: 0.03 });
  sine(b, { freq: 900 + v * 150, amp: 0.3, decay: 12, attack: 0.002, dur: 0.03, start: 0.055 });
  noise(b, { amp: 0.14, dur: 0.02, decay: 10, lowpass: 0.95 });
  save("toggle-" + (v + 1), b, 0.8);
});

/* ---------------- 清单 ---------------- */
const manifest = {
  generatedAt: new Date().toISOString(),
  total: FILES.length,
  bytes: FILES.reduce((s, f) => s + f.bytes, 0),
  files: FILES
};
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("files=" + FILES.length + "  total=" + (manifest.bytes / 1024).toFixed(1) + " KB");
FILES.forEach(f => console.log("  " + f.name + "  " + f.ms + "ms  " + (f.bytes / 1024).toFixed(1) + "KB"));
