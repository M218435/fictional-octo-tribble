/* ============================================================
 * gunzip.js —— 谱面压缩包解码
 *
 * 谱面 JSON 的键名高度重复（"startTime"/"endTime"/"start"/"end"…每个事件都写一遍），
 * 直接存一份要 100 多 MB。这里在构建时（build_songs.py）把谱面 gzip 成
 * base64 塞进 <曲目>/<难度>.js，体积掉到原来的十分之一，解出来的对象与原始
 * JSON 完全一致（无损，不丢任何音符/事件）。
 *
 * 解码优先用浏览器内置的 DecompressionStream（Chrome 80+/Edge/Safari 16.4+），
 * 老浏览器退回纯 JS 的 inflate（标准 RFC1951/1952），保证任何环境都读得出谱面。
 * ============================================================ */
(function (global) {
  'use strict';

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  // Huffman 表：canonical 码，解码方式同 zlib 的 puff
  function Table(lengths) {
    const count = new Array(16);
    for (let i = 0; i < 16; i++) count[i] = 0;
    for (let i = 0; i < lengths.length; i++) count[lengths[i]]++;
    count[0] = 0;
    const offs = new Array(16).fill(0);
    let total = 0;
    for (let i = 1; i < 16; i++) { offs[i] = total; total += count[i]; }
    const sym = new Array(total);
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) sym[offs[lengths[s]]++] = s;
    this.count = count;
    this.sym = sym;
  }

  function inflateRaw(src) {
    let pos = 0, bitBuf = 0, bitCnt = 0;
    let out = new Uint8Array(Math.max(1024, src.length * 6));
    let outLen = 0;
    let fixedLit = null, fixedDist = null;

    function bits(n) {
      let v = 0;
      for (let i = 0; i < n; i++) {
        if (bitCnt === 0) { bitBuf = src[pos++]; bitCnt = 8; }
        v |= (bitBuf & 1) << i;
        bitBuf >>= 1;
        bitCnt--;
      }
      return v;
    }
    function grow(need) {
      if (outLen + need <= out.length) return;
      let cap = out.length;
      while (cap < outLen + need) cap <<= 1;
      const n = new Uint8Array(cap);
      n.set(out.subarray(0, outLen));
      out = n;
    }
    function decode(h) {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len <= 15; len++) {
        code |= bits(1);
        const c = h.count[len];
        if (code - c < first) return h.sym[index + (code - first)];
        index += c;
        first += c;
        first <<= 1;
        code <<= 1;
      }
      throw new Error('gunzip: 非法 Huffman 码');
    }
    function buildDynamic() {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      const lens = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) lens[ORDER[i]] = bits(3);
      const clTable = new Table(lens);
      const all = [];
      while (all.length < hlit + hdist) {
        const sym = decode(clTable);
        if (sym < 16) { all.push(sym); continue; }
        let rep, val = 0;
        if (sym === 16) { if (!all.length) throw new Error('gunzip: 重复码缺前值'); val = all[all.length - 1]; rep = 3 + bits(2); }
        else if (sym === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        while (rep--) all.push(val);
      }
      const lit = all.slice(0, hlit), dist = all.slice(hlit, hlit + hdist);
      return { lit: new Table(lit), dist: new Table(dist) };
    }

    let final = 0;
    while (!final) {
      final = bits(1);
      const type = bits(2);
      if (type === 0) {                                  // 不压缩块
        bitCnt = 0; bitBuf = 0;
        const len = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        grow(len);
        for (let i = 0; i < len; i++) out[outLen++] = src[pos++];
        continue;
      }
      let lit, dist;
      if (type === 1) {                                  // 固定 Huffman
        if (!fixedLit) {
          const l = new Array(288);
          for (let i = 0; i < 144; i++) l[i] = 8;
          for (let i = 144; i < 256; i++) l[i] = 9;
          for (let i = 256; i < 280; i++) l[i] = 7;
          for (let i = 280; i < 288; i++) l[i] = 8;
          fixedLit = new Table(l);
          fixedDist = new Table(new Array(30).fill(5));
        }
        lit = fixedLit; dist = fixedDist;
      } else if (type === 2) {
        const t = buildDynamic(); lit = t.lit; dist = t.dist;
      } else {
        throw new Error('gunzip: 非法块类型');
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) { grow(1); out[outLen++] = sym; continue; }
        if (sym === 256) break;
        const li = sym - 257;
        if (li >= LEN_BASE.length) throw new Error('gunzip: 非法长度码');
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dist);
        if (di >= DIST_BASE.length) throw new Error('gunzip: 非法距离码');
        const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        grow(len);
        let from = outLen - d;
        for (let i = 0; i < len; i++) out[outLen++] = out[from++];
      }
    }
    return out.subarray(0, outLen);
  }

  // gzip 头（RFC1952）→ 中间的 raw deflate 数据
  function gunzipBytes(src) {
    let pos = 0;
    if (src[0] === 0x1f && src[1] === 0x8b) {
      const flags = src[3];
      pos = 10;
      if (flags & 4) { const xlen = src[pos] | (src[pos + 1] << 8); pos += 2 + xlen; }
      if (flags & 8) { while (src[pos++] !== 0) {} }
      if (flags & 16) { while (src[pos++] !== 0) {} }
      if (flags & 2) pos += 2;
    }
    return inflateRaw(src.subarray(pos));
  }

  function bytesToText(u8) {
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(u8);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return decodeURIComponent(escape(s));
  }

  const PG_GZ = {
    // base64(gzip(json)) → 谱面对象
    async decode(b64) {
      const bytes = b64ToBytes(b64);
      if (typeof DecompressionStream === 'function' && typeof Response === 'function') {
        try {
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
          const text = await new Response(stream).text();
          return JSON.parse(text);
        } catch (e) { /* 落到纯 JS 路径 */ }
      }
      return JSON.parse(bytesToText(gunzipBytes(bytes)));
    },
    // 同步版（无 DecompressionStream 时用；测试与兜底也能直接调）
    decodeSync(b64) {
      return JSON.parse(bytesToText(gunzipBytes(b64ToBytes(b64))));
    },
    inflateRaw
  };

  global.PG_GZ = PG_GZ;
  if (typeof module === 'object' && module.exports) module.exports = PG_GZ;
})(typeof window !== 'undefined' ? window : globalThis);
