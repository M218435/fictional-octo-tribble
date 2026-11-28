// Pre-baked 1:1 Solstice Hotel (47F) scene loader.
// Loads the exact, unsimplified Hotel GLB + world.json while faithfully
// restoring EVERY procedural shader (gh-surface2, gh-crystal, gh-leaf-atlas,
// gh-foliage, gh-farhaze, |ghLV GI light volume), planar floor reflections,
// raytraced env maps, 101 dynamic physics props, and all 15 interactive /
// animated Hotel systems (chandelier, shootable lamps/TVs/slats/bottles/
// extinguishers/speaker/kitchen-ceiling/bell/piano, 4 UTC world clocks,
// 2 pool floaties, fire pit & shower emitters, and live twilight skyline).
import { limitSceneTextures } from './gltf-scene.js';

const assetBase = new URL('../../', import.meta.url);

const POOL_VERTEX_SHADER =
  'varying vec3 vW; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }';

const POOL_FRAGMENT_SHADER = `
  uniform float uTime; uniform vec3 uSun, uSunCol; uniform vec4 uRipple[4]; varying vec3 vW;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  float height(vec2 p) {
    float t = uTime;
    float w = sin(dot(p, vec2(1.3, 0.9)) * 1.7 + t * 1.15) * 0.16 + sin(dot(p, vec2(-0.8, 1.5)) * 2.4 - t * 1.4) * 0.11
            + sin(dot(p, vec2(0.4, -1.9)) * 4.6 + t * 2.1) * 0.05 + vn(p * 2.3 + vec2(t * 0.22, -t * 0.18)) * 0.30 + vn(p * 7.0 - t * 0.45) * 0.09;
    for (int i = 0; i < 4; i++) { float age = t - uRipple[i].z; if (age > 0.0 && age < 3.0) { float d = length(p - uRipple[i].xy); w += sin(d * 9.0 - age * 9.0) * exp(-age * 1.4) * smoothstep(age * 3.2 + 0.4, age * 3.2 - 0.6, d) * uRipple[i].w * 2.0; } }
    return w;
  }
  float caustic(vec2 p, float t) {
    p = mod(p * 6.2831853, 6.2831853) - 250.0;
    vec2 i = p; float c = 1.0; const float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float tt = t * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0; c = 1.17 - pow(c, 1.4);
    return pow(abs(c), 8.0);
  }
  void main() {
    vec2 p = vW.xz; float e = 0.05;
    float h0 = height(p), hx = height(p + vec2(e, 0.0)), hz = height(p + vec2(0.0, e));
    vec3 n = normalize(vec3((h0 - hx) * 0.36, 1.0, (h0 - hz) * 0.36));
    vec3 V = normalize(cameraPosition - vW);
    float ndv = clamp(dot(n, V), 0.0, 1.0);
    float fres = 0.025 + 0.975 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, n);
    float az = clamp(dot(normalize(R.xz + 1e-4), normalize(uSun.xz)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky = mix(vec3(0.05, 0.09, 0.20), mix(vec3(0.40, 0.27, 0.36), vec3(2.4, 1.0, 0.30), pow(az, 1.6)), pow(clamp(1.0 - R.y, 0.0, 1.0), 3.0));
    float sd = clamp(dot(R, uSun), 0.0, 1.0);
    vec3 spec = uSunCol * (pow(sd, 1400.0) * 120.0 + pow(sd, 90.0) * 1.3);
    vec2 fl = p - V.xz / max(V.y, 0.22) * 0.72 + n.xz * 0.55;
    float ca = caustic(fl * 0.42 + n.xz * 0.05, uTime * 0.55);
    float path = 0.96 / max(V.y, 0.25);
    vec3 tint = exp(-path * vec3(0.62, 0.11, 0.09));
    vec3 body = vec3(0.02, 0.19, 0.21) * (0.35 + 0.65 * tint) + vec3(0.30, 0.62, 0.52) * ca * 0.55 * tint.g;
    float alpha = mix(0.50, 0.92, clamp(1.0 - tint.r + ca * 0.4, 0.0, 1.0));
    gl_FragColor = vec4(mix(body, sky, fres) + spec, mix(alpha, 1.0, fres));
  }
`;

const BILLBOARD_VERTEX_SHADER =
  'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

const BILLBOARD_FRAGMENT_SHADER = `
  uniform float uTime; uniform vec3 uHaze; varying vec2 vUv;
  void main() {
    vec2 uv = vUv; float t = uTime * 0.07;
    vec3 orange = vec3(1.0, 0.40, 0.07), teal = vec3(0.04, 0.72, 0.70), cream = vec3(1.0, 0.86, 0.62), ink = vec3(0.02, 0.05, 0.08);
    float sw = smoothstep(0.25, 0.75, uv.x + 0.22 * sin(t * 2.3 + uv.y * 2.6));
    vec3 col = mix(teal * 0.55, orange * 0.75, sw);
    float bars = smoothstep(0.80, 0.86, sin((uv.x * 1.3 + uv.y * 0.55 - t * 1.6) * 6.2832) * 0.5 + 0.5);
    col = mix(col, cream, bars * 0.35);
    vec2 p = (uv - vec2(0.5 + 0.24 * sin(t * 1.3), 0.50)) * vec2(1.944, 1.0);
    float d = length(p);
    float disc = smoothstep(0.31, 0.30, d);
    float cut = step(0.0, -p.y) * step(0.45, fract((p.y - t * 0.35) * 13.0));
    col = mix(col, cream, disc * (1.0 - cut));
    col = mix(col, ink, smoothstep(0.012, 0.0, abs(d - 0.36)) * 0.5);
    float strip = step(uv.y, 0.12);
    float tick = step(0.5, fract(uv.x * 18.0 - t * 5.0)) * step(0.3, fract(floor(uv.x * 18.0 - t * 5.0) * 0.37));
    col = mix(col, mix(ink, cream, tick * step(0.03, uv.y) * step(uv.y, 0.09)), strip);
    col = mix(col * 1.7, uHaze, 0.32);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const BEACON_VERTEX_SHADER = `
  attribute vec3 aCol; attribute vec3 aDat; uniform float uTime, uScale; varying vec4 vCol;
  void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
    float d = max(1.0, -mv.z);
    gl_PointSize = clamp(uScale * 0.26 * aDat.x / d, 2.2 * min(aDat.x, 1.6), 22.0);
    float on = aDat.y > 0.0 ? smoothstep(0.82, 0.9, sin((uTime * aDat.y + aDat.z) * 6.2832) * 0.5 + 0.5) : 1.0;
    vCol = vec4(aCol * 2.6, on * exp(-d * 0.0007)); }
`;

const BEACON_FRAGMENT_SHADER =
  'varying vec4 vCol; void main() { vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(vCol.rgb * (a * a + 0.6 * smoothstep(0.35, 0.0, r)), vCol.a); }';

const randRange = (a, b) => a + Math.random() * (b - a);

function decodeBase64(b64) {
  if (typeof Buffer === 'function') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function inflateRawBytes(b64) {
  if (!b64) return new Uint8Array(0);
  const packed = decodeBase64(b64);
  return new Uint8Array(
    await new Response(
      new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
    ).arrayBuffer(),
  );
}

export async function unpackLightVolume(spec) {
  const inflated = await inflateRawBytes(spec.dataBase64);
  const count = spec.nx * spec.ny * spec.nz * 3;
  if (inflated.length !== count * 2) throw Error('Invalid baked GI light volume length');
  const A = new Float32Array(count);
  const B = new Float32Array(count);
  const inv = 1 / 255;
  for (let i = 0; i < count; i++) {
    const a = inflated[i] * inv;
    const b = inflated[count + i] * inv;
    A[i] = a * a * spec.maxA;
    B[i] = b * b * spec.maxB;
  }
  const sources = [];
  if (Array.isArray(spec.sources) && spec.sources.length && spec.sourcesBase64) {
    const srcBytes = await inflateRawBytes(spec.sourcesBase64);
    const dv = new DataView(srcBytes.buffer, srcBytes.byteOffset, srcBytes.byteLength);
    let off = 0;
    for (const s of spec.sources) {
      const n = s.n;
      const idx = new Uint32Array(n);
      const w = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) idx[i] = dv.getUint32(off + i * 4, true);
      const wOff0 = off + n * 4;
      const wOff1 = off + n * 6;
      for (let i = 0; i < n; i++) {
        w[i * 2] = dv.getUint16(wOff0 + i * 2, true) / 16384;
        w[i * 2 + 1] = dv.getUint16(wOff1 + i * 2, true) / 16384;
      }
      off += n * 8;
      sources.push({ k: s.k, idx, w, r: s.rgb[0], g: s.rgb[1], b: s.rgb[2] });
    }
  }
  return { A, B, sources };
}

export function hydrateBakedNav(NavCtor, world, worldNodes) {
  const nav = new NavCtor(world);
  nav.islands = [];
  for (const entry of worldNodes) {
    nav.add(entry.pos[0], entry.pos[1], entry.pos[2], entry.tag || '');
  }
  for (let i = 0; i < worldNodes.length; i++) {
    const node = nav.nodes[i];
    node.links = worldNodes[i].links.map(to => {
      const target = nav.nodes[to];
      return { to, c: Math.hypot(target.x - node.x, target.y - node.y, target.z - node.z) };
    });
  }
  return nav;
}

function make1x1Texture(THREE, r, g, b, a, srgb) {
  const data = new Uint8Array([r, g, b, a]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Recombines two 100%-opaque linear images (RGB + grayscale Alpha) into an
// unpremultiplied THREE.DataTexture so RGB is NEVER wiped to 0 where A == 0.
const pixelExtractCache = new WeakMap();
function extractOpaquePixels(img, reuseCanvas) {
  if (!img) return null;
  const cached = pixelExtractCache.get(img);
  if (cached) return cached;
  const w = img.width || 0;
  const h = img.height || 0;
  if (!w || !h) return null;
  let result = null;
  if (typeof img.getContext === 'function') {
    const id = img.getContext('2d').getImageData(0, 0, w, h);
    result = { data: id.data, width: w, height: h };
  } else if (ArrayBuffer.isView(img.data)) {
    result = { data: img.data, width: w, height: h };
  } else {
    const cv = reuseCanvas.get(w, h);
    if (!cv) return null;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(img, 0, 0, w, h);
    result = { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
  }
  if (result) pixelExtractCache.set(img, result);
  return result;
}

function combineOpaqueRGBAndAlpha(THREE, rgbTex, alphaTex, reuseCanvas, maxAniso) {
  if (!rgbTex?.image || !alphaTex?.image) return rgbTex;
  const rgb = extractOpaquePixels(rgbTex.image, reuseCanvas);
  const alpha = extractOpaquePixels(alphaTex.image, reuseCanvas);
  if (!rgb || !alpha) return rgbTex;
  const w = rgb.width, h = rgb.height;
  const out = new Uint8Array(w * h * 4);
  const sameDim = alpha.width === w && alpha.height === h;
  if (sameDim && (rgb.data.byteOffset & 3) === 0 && (alpha.data.byteOffset & 3) === 0) {
    const out32 = new Uint32Array(out.buffer);
    const rgb32 = new Uint32Array(rgb.data.buffer, rgb.data.byteOffset, w * h);
    const alpha32 = new Uint32Array(alpha.data.buffer, alpha.data.byteOffset, w * h);
    for (let i = 0, n = out32.length; i < n; i++) {
      out32[i] = (rgb32[i] & 0x00ffffff) | ((alpha32[i] & 0xff) << 24);
    }
  } else if (sameDim) {
    for (let i = 0; i < out.length; i += 4) {
      out[i] = rgb.data[i];
      out[i + 1] = rgb.data[i + 1];
      out[i + 2] = rgb.data[i + 2];
      out[i + 3] = alpha.data[i];
    }
  } else {
    for (let y = 0; y < h; y++) {
      const ay = Math.min(alpha.height - 1, Math.floor((y * alpha.height) / h));
      for (let x = 0; x < w; x++) {
        const ax = Math.min(alpha.width - 1, Math.floor((x * alpha.width) / w));
        const di = (y * w + x) * 4;
        const ai = (ay * alpha.width + ax) * 4;
        out[di] = rgb.data[di];
        out[di + 1] = rgb.data[di + 1];
        out[di + 2] = rgb.data[di + 2];
        out[di + 3] = alpha.data[ai];
      }
    }
  }
  const dt = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  dt.flipY = false;
  dt.wrapS = rgbTex.wrapS ?? THREE.RepeatWrapping;
  dt.wrapT = rgbTex.wrapT ?? THREE.RepeatWrapping;
  if (rgbTex.repeat) dt.repeat.copy(rgbTex.repeat);
  if (rgbTex.offset) dt.offset.copy(rgbTex.offset);
  dt.rotation = rgbTex.rotation || 0;
  dt.colorSpace = THREE.NoColorSpace;
  dt.generateMipmaps = true;
  dt.minFilter = THREE.LinearMipmapLinearFilter;
  dt.magFilter = THREE.LinearFilter;
  dt.anisotropy = maxAniso;
  dt.premultiplyAlpha = false;
  dt.needsUpdate = true;
  return dt;
}

function attachSurface2Shader(mat, spec, sharedTex, shaders, THREE, liteDefault = false) {
  if (!shaders?.Aj || !sharedTex.macro) return;
  // On mobile GPUs and Low/Medium (Auto/Default) tiers, drop extra triplanar detail &
  // procedural wear passes on all 39 Hotel surface2 materials (saving ~40-50% fragment cost)
  // while keeping full PBR albedo + normal + ORM + 3D GI light volume.
  const lite = Boolean(globalThis.GH_MAT_LITE || globalThis.GHBoot?.policy?.mobile || liteDefault);
  mat.defines = mat.defines || {};
  if (spec.defines) {
    for (const [k, v] of Object.entries(spec.defines)) {
      if (lite && (k === 'GH_DETAIL' || k === 'GH_WEAR')) continue;
      mat.defines[k] = v;
    }
  }
  if (!mat.map) mat.map = sharedTex.white;
  if (!mat.roughnessMap) mat.roughnessMap = sharedTex.ormWhite;
  if (!mat.normalMap) {
    mat.normalMap = sharedTex.flat;
    mat.normalScale?.set(1, 1);
  }
  for (const t of [mat.map, mat.roughnessMap, mat.normalMap, mat.emissiveMap]) {
    if (t) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
    }
  }
  const u = spec.uniforms;
  const v4 = arr => ({ value: new THREE.Vector4(arr[0], arr[1], arr[2], arr[3]) });
  const uvScale = spec.uvScale ?? 1;
  const m = {
    ghMacro: { value: sharedTex.macro },
    ghDetail: { value: sharedTex.details.get(spec.detailKey) || sharedTex.anyDetail },
    ghUvScale: { value: uvScale },
    ghP: v4(u.ghP),
    ghT: v4(u.ghT),
    ghL: v4(u.ghL),
    ghX: v4(u.ghX),
    ghD: v4(u.ghD),
    ghD2: v4(u.ghD2),
    ghJ: v4(u.ghJ),
    ghJc: v4(u.ghJc),
    ghC: v4(u.ghC),
    ghW0: v4(u.ghW0),
    ghW1: v4(u.ghW1),
    ghW2: v4(u.ghW2),
    ghFl: v4(u.ghFl),
    ghWc: { value: new THREE.Vector3(u.ghWc[0], u.ghWc[1], u.ghWc[2]) },
  };
  Object.defineProperty(mat, 'ghUniforms', { value: m, configurable: true });
  const vertCommon = `uniform float ghUvScale;\n${shaders.Aj}`;
  const vertProj = shaders.kj.replace('vGhUv = uv;', 'vGhUv = uv * ghUvScale;');
  const patch = sh => {
    Object.assign(sh.uniforms, m);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${vertCommon}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${vertProj}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${shaders.Cj}void main() {${shaders.Pj}`)
      .replace('#include <map_fragment>', shaders.zj)
      .replace('#include <roughnessmap_fragment>', shaders.Lj)
      .replace('#include <normal_fragment_begin>', shaders.Dj)
      .replace('#include <normal_fragment_maps>', shaders.Ij)
      .replace('#include <emissivemap_fragment>', shaders.Hj)
      .replace('#include <aomap_fragment>', shaders.Fj);
  };
  const hasOwnOBC = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile');
  const prevOBC = mat.onBeforeCompile;
  mat.onBeforeCompile = hasOwnOBC ? (sh, r) => { prevOBC(sh, r); patch(sh); } : patch;
  const prevKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey : null;
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + 'gh-surface2';
  mat.clone = function () {
    const c = Object.getPrototypeOf(this).clone.call(this);
    c.onBeforeCompile = this.onBeforeCompile;
    c.customProgramCacheKey = this.customProgramCacheKey;
    Object.assign(c.defines, this.defines);
    c.clone = this.clone;
    Object.defineProperty(c, 'ghUniforms', { value: m, configurable: true });
    return c;
  };
  mat.needsUpdate = true;
}

function attachSpecialShader(mat, kind, Ii, THREE) {
  if (kind === 'crystal') {
    mat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	{
		vec3 ghT = inverseTransformDirection( refract( - normalize( vViewPosition ), normal, 0.64 ), viewMatrix );
		vec3 ghK = vec3( dot( ghT, vec3( 31.0, 17.0, 23.0 ) ), dot( ghT, vec3( -13.0, 37.0, 19.0 ) ), dot( ghT, vec3( 21.0, -11.0, 41.0 ) ) );
		vec3 ghF = vec3( 0.0 );
		for ( int i = 0; i < 3; i ++ ) {
			float sc = 0.99 + 0.01 * float( i );
			float gq = sin( ghK.x * sc ) * sin( ghK.y * sc + 1.7 ) * sin( ghK.z * sc + 0.6 );
			ghF[ i ] = 0.12 + 0.55 * smoothstep( -0.2, 0.4, gq ) + 7.0 * pow( max( gq, 0.0 ), 3.0 );
		}
		totalEmissiveRadiance *= ghF;
	}`);
    };
    mat.customProgramCacheKey = () => 'gh-crystal';
  } else if (kind === 'leaf-atlas') {
    mat.alphaToCoverage = true;
    mat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	float back = saturate( dot( -geometryNormal, directLight.direction ) );
	vec3 dc = material.diffuseColor;
	float green = saturate( ( dc.g - max( dc.r, dc.b ) ) / max( dc.g, 0.001 ) * 4.0 );
	vec3 tint = mix( vec3( 1.0, 0.82, 0.55 ), vec3( 0.95, 1.0, 0.3 ), green );
	reflectedLight.directDiffuse += back * directLight.color * dc * tint * ( 0.62 * RECIPROCAL_PI ) * step( 0.126, vMapUv.y );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf`)
        .replace('#include <map_fragment>', `#include <map_fragment>
	{
		vec2 ghT = vMapUv * vec2( 2048.0, 1024.0 ), ghDx = dFdx( ghT ), ghDy = dFdy( ghT );
		diffuseColor.a *= 1.0 + max( 0.0, 0.5 * log2( max( dot( ghDx, ghDx ), dot( ghDy, ghDy ) ) ) ) * 0.3;
		if ( gl_FrontFacing && vMapUv.y > 0.126 ) diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.3, 0.6, 0.1 ) ) ) * vec3( 1.05, 1.12, 0.9 ) + 0.012, 0.35 );
	}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
	roughnessFactor *= texture2D( normalMap, vNormalMapUv ).a;`);
    };
    mat.customProgramCacheKey = () => 'gh-leaf-atlas';
  } else if (kind === 'foliage') {
    mat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	float back = saturate( dot( -geometryNormal, directLight.direction ) );
	reflectedLight.directDiffuse += back * directLight.color * material.diffuseColor * vec3( 0.95, 1.0, 0.3 ) * ( 0.62 * RECIPROCAL_PI );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf`);
    };
    mat.customProgramCacheKey = () => 'gh-foliage';
  } else if (kind === 'farhaze') {
    mat.fog = false;
    const sunXZ = new THREE.Vector2(Ii.x, Ii.z).normalize();
    mat.onBeforeCompile = sh => {
      sh.uniforms.uSunXZ = { value: sunXZ };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHz;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvHz = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHz;\nuniform vec2 uSunXZ;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          { vec2 hd = vHz.xz - cameraPosition.xz; float hdist = length(hd);
            float haz = clamp(dot(hd / max(hdist, 1e-3), uSunXZ) * 0.5 + 0.5, 0.0, 1.0);
            vec3 hcol = mix(vec3(0.30, 0.21, 0.30), vec3(1.55, 0.70, 0.26), haz * haz) * 0.62;
            float hf = clamp(1.0 - exp(-hdist * 0.0034) + smoothstep(30.0, -170.0, vHz.y) * 0.5, 0.0, 1.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, hcol, hf); }`);
    };
    mat.customProgramCacheKey = () => 'gh-farhaze';
  }
  const prevClone = mat.clone;
  mat.clone = function () {
    const c = prevClone.call(this);
    c.onBeforeCompile = this.onBeforeCompile;
    c.customProgramCacheKey = this.customProgramCacheKey;
    c.clone = this.clone;
    return c;
  };
  mat.needsUpdate = true;
}

export function preloadBakedHotel(base = assetBase, fetcher = globalThis.fetch) {
  const opts = { credentials: 'omit', priority: 'high' };
  // Warm up Meshopt WASM decoder in parallel with GLB download so parseAsync
  // starts immediately without waiting on module/WASM init.
  const decoderJob = import('../vendor/meshopt-decoder.js')
    .then(async mod => { await mod.MeshoptDecoder.ready; return mod; })
    .catch(() => null);
  return (async () => {
    const catRes = await fetcher(new URL('assets/maps/catalog.json', base), opts);
    if (!catRes.ok) throw Error('Failed to load map catalog for baked hotel');
    const catalog = await catRes.json();
    const ref = catalog.maps?.find(m => m.id === 'hotel');
    if (!ref?.version) throw Error('Missing hotel entry in map catalog');
    const prefix = `assets/maps/hotel/${ref.version}/`;
    const manifestRes = await fetcher(new URL(prefix + 'manifest.json', base), opts);
    if (!manifestRes.ok) throw Error('Failed to load hotel manifest');
    const manifest = await manifestRes.json();
    if (!manifest.sceneAsset || !manifest.sceneSHA256 || !manifest.sceneBytes) return null;
    const [worldRes, glbRes] = await Promise.all([
      fetcher(new URL(prefix + manifest.worldAsset, base), opts),
      fetcher(new URL(manifest.sceneAsset, base), opts),
    ]);
    if (!worldRes.ok || !glbRes.ok) throw Error('Failed to download baked hotel bundle');
    const [worldJson, glbBuffer] = await Promise.all([worldRes.json(), glbRes.arrayBuffer()]);
    if (glbBuffer.byteLength !== manifest.sceneBytes) throw Error('Hotel GLB byte length mismatch');
    const [digest, decoderMod] = await Promise.all([
      crypto.subtle.digest('SHA-256', glbBuffer),
      decoderJob,
    ]);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== manifest.sceneSHA256) throw Error('Hotel GLB checksum mismatch');
    return { manifest, worldJson, glbBuffer, baseUrl: new URL(prefix, base).href, decoderMod };
  })();
}

export async function loadBakedHotel(env, prefetchedPromise, injected = {}) {
  const bundle = await prefetchedPromise;
  if (!bundle) return null;
  const { manifest, worldJson, glbBuffer, baseUrl, decoderMod } = bundle;
  const {
    scene, world, glass, physics, fx, gfx, sky, THREE,
    Ii, pb, HM, Ir, w$, QM, NavCtor, G, audio, onChandelier, shaders, setLoading,
  } = env;

  setLoading?.(0.14, 'LOADING HOTEL');
  const [{ GLTFLoader }, { MeshoptDecoder }] = injected.loader
    ? [injected.loader, injected.decoder]
    : await Promise.all([
        import('../vendor/gltf-loader.js'),
        decoderMod ? Promise.resolve(decoderMod) : import('../vendor/meshopt-decoder.js'),
      ]);
  await MeshoptDecoder.ready;

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glbBuffer, baseUrl);
  if (globalThis.GHBoot?.policy?.mobile && typeof globalThis.createImageBitmap === 'function') {
    await limitSceneTextures(gltf.scene, globalThis.GHBoot.policy.textureLimit || 512, globalThis.createImageBitmap);
  }

  const meta = gltf.scene.userData?.ghHotel;
  if (!meta || (meta.schema !== 1 && meta.schema !== 2)) throw Error('Baked hotel GLB is missing ghHotel metadata');

  const matsByName = new Map();
  const trackMat = mat => {
    if (!mat?.name) return;
    let list = matsByName.get(mat.name);
    if (!list) matsByName.set(mat.name, (list = []));
    if (!list.includes(mat)) list.push(mat);
  };

  // 1. Extract pre-baked indoor/outdoor raytraced equirectangular reflection textures.
  let envInTex = null;
  let envOutTex = null;
  const envProbes = gltf.scene.getObjectByName('hotel-env-probes');
  if (envProbes) {
    const inNode = envProbes.getObjectByName('hotel-env-in');
    const outNode = envProbes.getObjectByName('hotel-env-out');
    envInTex = inNode?.material?.map || null;
    envOutTex = outNode?.material?.map || null;
    if (envInTex) envInTex.mapping = THREE.EquirectangularReflectionMapping;
    if (envOutTex) envOutTex.mapping = THREE.EquirectangularReflectionMapping;
    envProbes.removeFromParent();
    envProbes.traverse(node => {
      if (node.geometry) node.geometry.dispose?.();
      if (node.material) node.material.dispose?.();
    });
  }

  // 2. Extract shared gh-surface2 linear textures, companion data-alpha maps, & material references.
  const anisoCap = globalThis.GHBoot?.policy?.mobile ? 2 : 8;
  const maxAniso = gfx?.renderer?.capabilities?.getMaxAnisotropy
    ? Math.min(anisoCap, gfx.renderer.capabilities.getMaxAnisotropy())
    : anisoCap;
  const reuseCanvas = (() => {
    let cv = null;
    return {
      get(w, h) {
        if (!cv) {
          if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
            cv = document.createElement('canvas');
          } else if (typeof OffscreenCanvas === 'function') {
            cv = new OffscreenCanvas(w, h);
          } else {
            return null;
          }
        }
        if (cv.width !== w) cv.width = w;
        if (cv.height !== h) cv.height = h;
        return cv;
      },
    };
  })();

  const sharedTex = {
    macro: null,
    details: new Map(),
    anyDetail: null,
    white: make1x1Texture(THREE, 255, 255, 255, 255, true),
    ormWhite: make1x1Texture(THREE, 255, 255, 255, 0, false),
    flat: make1x1Texture(THREE, 128, 128, 255, 255, false),
  };
  const matRefs = new Map();
  const dataAlphaTexByKey = new Map();
  const rawShaderTex = new Map();
  const shaderTexGroup = gltf.scene.getObjectByName('hotel-shader-textures');
  if (shaderTexGroup) {
    for (const child of [...shaderTexGroup.children]) {
      const mat = child.material;
      if (child.name.startsWith('matref-') && mat) {
        matRefs.set(child.name.slice('matref-'.length), mat);
        trackMat(mat);
      } else {
        const tex = mat?.roughnessMap || mat?.map || null;
        if (tex) {
          tex.colorSpace = THREE.NoColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.needsUpdate = true;
          if (child.name.startsWith('alpha-')) {
            dataAlphaTexByKey.set(child.name, tex);
          } else {
            rawShaderTex.set(child.name, tex);
          }
        }
        mat?.dispose?.();
      }
      child.geometry?.dispose?.();
    }
    shaderTexGroup.removeFromParent();
  }
  for (const [name, rgbTex] of rawShaderTex) {
    if (name.endsWith('__alpha')) continue;
    const alphaTex = rawShaderTex.get(`${name}__alpha`) || null;
    const finalTex = alphaTex ? combineOpaqueRGBAndAlpha(THREE, rgbTex, alphaTex, reuseCanvas, maxAniso) : rgbTex;
    finalTex.colorSpace = THREE.NoColorSpace;
    finalTex.wrapS = finalTex.wrapT = THREE.RepeatWrapping;
    if (name === 'macro') sharedTex.macro = finalTex;
    else {
      sharedTex.details.set(name, finalTex);
      if (!sharedTex.anyDetail) sharedTex.anyDetail = finalTex;
    }
    if (alphaTex) {
      rgbTex.dispose?.();
      alphaTex.dispose?.();
    }
  }

  // 3. Extract instanced mesh prototypes (slat screens & bar bottles) before mounting static scene.
  const instProtos = new Map();
  const instProtoGroup = gltf.scene.getObjectByName('hotel-instanced-protos');
  if (instProtoGroup) {
    for (const child of [...instProtoGroup.children]) {
      if (child.isMesh) instProtos.set(child.name, { geometry: child.geometry, material: child.material });
    }
    instProtoGroup.removeFromParent();
  }

  // 4. Extract dynamic physics props & interactive nodes before locking static matrices.
  const propRootGroup = gltf.scene.getObjectByName('hotel-dynamic-props');
  const propNodes = [];
  if (propRootGroup) {
    propRootGroup.updateMatrixWorld(true);
    for (const child of [...propRootGroup.children]) {
      if (child.userData?.ghProp) propNodes.push(child);
    }
    propRootGroup.removeFromParent();
  }

  const interactiveNodes = new Map();
  const interactGroup = gltf.scene.getObjectByName('hotel-interactives');
  if (interactGroup) {
    interactGroup.updateMatrixWorld(true);
    for (const child of [...interactGroup.children]) {
      interactiveNodes.set(child.name, child);
    }
    interactGroup.removeFromParent();
  }

  // Hydrate material flags & attach gh-surface2 / special shaders ONCE per material instance.
  const hydratedMats = new WeakSet();
  const recombinedDataTexCache = new Map();
  const supersededRgbTexes = new Set();

  const hydrateMaterial = mat => {
    if (!mat || hydratedMats.has(mat)) return;
    hydratedMats.add(mat);
    const r = mat.userData?.ghRender;
    if (r) {
      if (r.hasMetalnessMap === false) mat.metalnessMap = null;
      for (const [k, v] of Object.entries(r)) {
        if (k === 'hasMetalnessMap') continue;
        if (k === 'normalScale' && Array.isArray(v) && mat.normalScale) {
          mat.normalScale.set(v[0], v[1]);
        } else {
          mat[k] = v;
        }
      }
    }
    const alphaRefs = mat.userData?.ghDataAlpha;
    if (alphaRefs) {
      for (const [slot, alphaKey] of Object.entries(alphaRefs)) {
        const rgbTex = mat[slot];
        const alphaTex = dataAlphaTexByKey.get(alphaKey);
        if (!rgbTex || !alphaTex) continue;
        const cKey = `${rgbTex.source?.uuid || rgbTex.uuid}|${alphaKey}|${rgbTex.repeat?.x ?? 1}|${rgbTex.repeat?.y ?? 1}`;
        let combined = recombinedDataTexCache.get(cKey);
        if (!combined) {
          combined = combineOpaqueRGBAndAlpha(THREE, rgbTex, alphaTex, reuseCanvas, maxAniso);
          recombinedDataTexCache.set(cKey, combined);
        }
        supersededRgbTexes.add(rgbTex);
        mat[slot] = combined;
      }
    }
    for (const tex of [mat.map, mat.normalMap, mat.roughnessMap, mat.emissiveMap]) {
      if (tex && tex.anisotropy !== undefined) tex.anisotropy = maxAniso;
    }
    if (mat.userData?.ghSurface2) {
      const liteBoot = Boolean(gfx?.quality === 'low' || gfx?.quality === 'medium' || gfx?.quality === 'auto');
      attachSurface2Shader(mat, mat.userData.ghSurface2, sharedTex, shaders, THREE, liteBoot);
    }
    if (mat.userData?.ghShader) {
      attachSpecialShader(mat, mat.userData.ghShader, Ii, THREE);
    }
    trackMat(mat);
  };

  for (const mat of matRefs.values()) hydrateMaterial(mat);
  for (const proto of instProtos.values()) hydrateMaterial(proto.material);

  const applyObjectFlags = obj => {
    if (obj.userData?.ghRender) Object.assign(obj, obj.userData.ghRender);
    if (obj.isMesh) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) hydrateMaterial(mat);
      const primary = mats[0];
      if (primary && !Array.isArray(obj.material) &&
          (primary.transparent || primary.blending !== THREE.NormalBlending || primary.depthWrite === false)) {
        obj.layers.set(1);
      }
    }
  };

  const paddedGeos = new WeakSet();
  const ensureReliableBounds = (obj, { disableCulling = false, needBox = false } = {}) => {
    if (!obj) return;
    if (obj.isInstancedMesh) {
      if (obj.geometry?.attributes?.position) {
        if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
        if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
      }
      obj.computeBoundingSphere?.();
      obj.frustumCulled = false;
      return;
    }
    if (obj.isMesh && obj.geometry?.attributes?.position) {
      const geo = obj.geometry;
      // Trust GLTFLoader's O(1) accessor-derived boundingBox/boundingSphere (100%
      // vertex-enclosing in scene.glb) and only recompute if missing or invalid.
      if ((needBox && !geo.boundingBox) || !geo.boundingSphere || !Number.isFinite(geo.boundingSphere.radius) || geo.boundingSphere.radius <= 0) {
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
      }
      if (disableCulling) {
        obj.frustumCulled = false;
      } else if (geo.boundingSphere && !paddedGeos.has(geo)) {
        paddedGeos.add(geo);
        // Add a conservative >=0.30m world-space safety margin so frustum culling
        // cuts off-screen draw calls/triangles while preventing close-range pop-out.
        const maxScale = Math.max(Math.abs(obj.scale?.x || 1), Math.abs(obj.scale?.y || 1), Math.abs(obj.scale?.z || 1), 1e-3);
        const r = geo.boundingSphere.radius;
        geo.boundingSphere.radius = Math.max(r * 1.12, r + 0.30 / maxScale);
      }
    } else if (disableCulling && (obj.isMesh || obj.isPoints || obj.isLine || obj.isSprite)) {
      obj.frustumCulled = false;
    }
  };

  // 5. Mount static hotel geometry with O(1) padded bounds and frozen static matrices.
  gltf.scene.traverse(obj => {
    applyObjectFlags(obj);
    if (obj.isMesh) {
      const isWoodFrame = obj.material?.name === 'gh-hotel-wood-frame';
      ensureReliableBounds(obj, { disableCulling: false, needBox: isWoodFrame });
      if (obj.userData?.ghWorldMesh) {
        world.meshes.push(obj);
      }
    }
    obj.matrixAutoUpdate = false;
    obj.updateMatrix();
  });
  scene.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.matrixWorldAutoUpdate = false;

  // 6. Hydrate authoritative colliders (preserving exact indices for interactive bindings) + pool water + glass.
  const worldCols = [];
  for (const c of worldJson.colliders) {
    const col = world.addCollider(c.min[0], c.min[1], c.min[2], c.max[0], c.max[1], c.max[2], c.surf || 'concrete', {
      noMove: !!c.noMove,
      noRay: !!c.noRay,
    });
    worldCols.push(col || world.cols[world.cols.length - 1]);
  }
  const pool = meta.pool;
  world.addCollider(pool.x0, pool.water - 0.05, pool.z0, pool.x1, pool.water, pool.z1, 'water', {
    noMove: true,
    water: true,
  });

  if (glass?.addPane && Array.isArray(worldJson.glass)) {
    for (const pane of worldJson.glass) {
      const axis = (pane.axis === 0 || pane.axis === 'x') ? 'x' : 'z';
      const cell = pane.nx > 0 ? (pane.a1 - pane.a0) / pane.nx : 0.2;
      const added = glass.addPane({
        axis, pos: pane.pos, a0: pane.a0, a1: pane.a1,
        y0: pane.y0, y1: pane.y1, support: pane.support, cell,
      });
      if (added && pane.nx > 0 && pane.ny > 0 && (added.nx !== pane.nx || added.ny !== pane.ny)) {
        added.nx = pane.nx;
        added.ny = pane.ny;
        added.count = pane.nx * pane.ny;
        added.total = pane.nx * pane.ny;
      }
    }
    glass.build();
  }

  // 7. Animated pool water shader + hotel handle.
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: Ii },
      uSunCol: { value: pb },
      uRipple: {
        value: [
          new THREE.Vector4(0, 0, -9, 0),
          new THREE.Vector4(0, 0, -9, 0),
          new THREE.Vector4(0, 0, -9, 0),
          new THREE.Vector4(0, 0, -9, 0),
        ],
      },
    },
    vertexShader: POOL_VERTEX_SHADER,
    fragmentShader: POOL_FRAGMENT_SHADER,
  });
  const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(pool.x1 - pool.x0, pool.z1 - pool.z0), waterMat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set((pool.x0 + pool.x1) / 2, pool.water, (pool.z0 + pool.z1) / 2);
  waterMesh.renderOrder = 5;
  waterMesh.frustumCulled = false;
  waterMesh.layers.set(1);
  scene.add(waterMesh);

  let rippleIndex = 0;
  let waterTime = 0;
  const resets = [];
  const qualityHooks = [];
  const hotel = {
    lights: {},
    shafts: meta.shafts || [],
    stairs: meta.stairs || [],
    update: [],
    spawns: [],
    zones: [],
    pool,
    speakerPos: meta.interactive?.speaker?.pos
      ? new THREE.Vector3(...meta.interactive.speaker.pos)
      : new THREE.Vector3(-12.5, 0.9, 8.3),
    kitchenCeil: null,
    ripple(x, z, strength = 1) {
      waterMat.uniforms.uRipple.value[rippleIndex].set(x, z, waterTime, strength);
      rippleIndex = (rippleIndex + 1) % 4;
    },
    inPool(x, z) {
      return x > pool.x0 && x < pool.x1 && z > pool.z0 && z < pool.z1;
    },
    indoor(x, z) {
      return z < 10 && z > -20 && x > -28 && x < 28 ? 1 : 0;
    },
    onQuality(q, quality) {
      for (const fn of qualityHooks) fn(q, quality);
    },
    resetDress() {
      for (const fn of resets) fn();
    },
    finishDress() {},
  };
  hotel.update.push(dt => {
    waterTime += dt;
    waterMat.uniforms.uTime.value = waterTime;
  });

  // 8. Register all 101 dynamic physics props & resetDress hooks.
  // Keep dynamic shadows on sunlit / terrace / large lobby props on High/Ultra only
  // so Low/Medium (Auto/Default) avoid dynamic prop shadow draw-call overhead.
  const shadowPropMeshes = [];
  for (const node of propNodes) {
    const spec = node.userData.ghProp;
    const initPos = node.position.clone();
    const initQuat = node.quaternion.clone();
    const maxDim = Math.max(spec.size?.[0] || 0, spec.size?.[1] || 0, spec.size?.[2] || 0);
    const sunlitZone = initPos.z >= 3.0 || initPos.y >= 3.5;
    const allowShadow = maxDim >= 0.60 && sunlitZone;
    node.traverse(child => {
      applyObjectFlags(child);
      if (child.isMesh) {
        ensureReliableBounds(child, { disableCulling: false });
        const canCast = allowShadow && (child.userData?.ghRender?.castShadow ?? true);
        if (canCast) shadowPropMeshes.push(child);
        child.castShadow = canCast && gfx?.quality !== 'low' && gfx?.quality !== 'medium';
        child.receiveShadow = child.userData?.ghRender?.receiveShadow ?? true;
      }
    });
    scene.add(node);
    const body = physics?.addProp?.(node, {
      size: spec.size,
      center: spec.center || [0, spec.size[1] / 2, 0],
      mass: spec.mass || 6,
      mat: spec.mat || 'wood',
      breakable: spec.breakable || null,
    });
    resets.push(() => {
      node.position.copy(initPos);
      node.quaternion.copy(initQuat);
      node.visible = true;
      if (body) {
        body.dead = false;
        body.sleeping = true;
        body.still = 0;
        body.pvx = body.pvy = body.pvz = 0;
        physics?._placeBox?.(body);
      }
    });
  }
  qualityHooks.push((_q, quality) => {
    const cast = quality === 'high' || quality === 'ultra';
    for (const mesh of shadowPropMeshes) mesh.castShadow = cast;
    if (fx?.shaftMesh) fx.shaftMesh.visible = quality !== 'low';
    if (fx?.motePts) fx.motePts.visible = quality !== 'low';
  });

  // 9. Restore sun, hemisphere, interior/terrace point lights, and fog.
  const sun = new THREE.DirectionalLight(meta.sun.color, meta.sun.intensity);
  sun.position.set(...meta.sun.position);
  sun.target.position.set(...meta.sun.target);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -37, right: 37, top: 17, bottom: -15, near: 20, far: 130 });
  sun.shadow.mapSize.set(gfx?.q?.shadow || 2048, gfx?.q?.shadow || 2048);
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2.2;
  scene.add(sun, sun.target);
  hotel.sun = sun;

  const hemi = new THREE.HemisphereLight(
    new THREE.Color(...meta.hemi.sky),
    new THREE.Color(...meta.hemi.ground),
    meta.hemi.intensity,
  );
  scene.add(hemi);
  hotel.hemi = hemi;

  for (const spec of meta.lights || []) {
    const light = new THREE.PointLight(spec.color, spec.base * spec.k, spec.distance, 1.4);
    light.position.set(...spec.pos);
    scene.add(light);
    hotel.lights[spec.id] = { light, base: spec.base, k: spec.k };
  }
  scene.fog = new THREE.FogExp2(new THREE.Color(...meta.fog.color), meta.fog.density);

  let flickerT = 0;
  hotel.update.push(dt => {
    flickerT += dt;
    const fire = hotel.lights.fire;
    if (fire?.light) {
      fire.light.intensity = fire.base * fire.k *
        (0.8 + 0.2 * Math.sin(flickerT * 13) * Math.sin(flickerT * 7.3) + 0.12 * Math.sin(flickerT * 31));
    }
    const service = hotel.lights.service;
    if (service?.light) {
      const mul = Math.sin(flickerT * 2.1) > 0.93 || Math.sin(flickerT * 17) * Math.sin(flickerT * 0.7) > 0.97 ? 0.25 : 1;
      service.light.intensity = service.base * service.k * mul;
    }
  });

  // 10. Restore volumetric sun shafts and additive light glows.
  if (fx?.buildShafts && hotel.shafts.length) {
    fx.buildShafts(hotel.shafts, Ii.clone().negate());
  }
  if (fx?.addGlow && fx?.buildGlows && meta.glows?.length) {
    for (const glow of meta.glows) {
      const idx = fx.addGlow(
        new THREE.Vector3(...glow.pos),
        new THREE.Vector3(...glow.n),
        glow.sx,
        glow.sy,
        glow.color,
        Array.isArray(glow.rgb) ? 1 : glow.k,
      );
      if (Array.isArray(glow.rgb) && fx._glowList?.[idx]?.color?.setRGB) {
        fx._glowList[idx].color.setRGB(glow.rgb[0], glow.rgb[1], glow.rgb[2]);
      }
    }
    fx.buildGlows();
    if (fx.glows) fx.glows.layers.set(1);
  }
  if (fx?.shaftMesh) fx.shaftMesh.layers.set(1);
  if (fx?.motePts) fx.motePts.layers.set(1);

  // 11. Restore pre-baked 60x9x46 golden-hour GI light volume + dynamic source updates & flickering fixtures.
  if (HM && meta.giVolume) {
    const { A, B, sources } = await unpackLightVolume(meta.giVolume);
    const vol = new HM({
      x0: meta.giVolume.x0, y0: meta.giVolume.y0, z0: meta.giVolume.z0,
      nx: meta.giVolume.nx, ny: meta.giVolume.ny, nz: meta.giVolume.nz,
      s: meta.giVolume.s,
    });
    vol.A.set(A);
    vol.B.set(B);
    if (sources.length && Array.isArray(vol.sources)) vol.sources = sources;
    vol.upload();
    vol.bind(w$ ?? 1);

    const dyn = meta.giDynamic || {};
    const glowSrcMap = dyn.glowSrc || {};
    const lightSrcMap = dyn.lightSrc || {};
    const serviceGlowIdx = dyn.serviceGlowIdx ?? -1;

    const origSetGlow = fx?.setGlow ? fx.setGlow.bind(fx) : null;
    if (origSetGlow && typeof vol.setSource === 'function') {
      fx.setGlow = (idx, k) => {
        origSetGlow(idx, k);
        const srcId = glowSrcMap[idx];
        if (srcId !== undefined) vol.setSource(srcId, k);
      };
    }

    const flickers = [];
    if (fx?.flicker && Array.isArray(dyn.flickers)) {
      for (const fl of dyn.flickers) {
        flickers.push(fx.flicker({ glows: [fl.glowIndex], style: fl.style, depth: fl.depth }));
      }
    }

    if (Ir) {
      Ir.ghLVK.value.z = 1;
      Ir.ghLVK.value.w = 1;
      Ir.ghPool.value.set((pool.x0 + pool.x1) / 2, (pool.z0 + pool.z1) / 2, (pool.x1 - pool.x0) / 2, (pool.z1 - pool.z0) / 2);
      if (hotel.lights.chandelier?.light) {
        const cp = hotel.lights.chandelier.light.position;
        Ir.ghChand.value.set(cp.x, cp.y + 0.6, cp.z, 0);
      }
    }

    const lightTrack = {};
    for (const [id, srcId] of Object.entries(lightSrcMap)) lightTrack[id] = { id: srcId, last: 1 };

    let giTime = 0;
    let flushAcc = 0;
    const lighting = {
      volume: vol,
      glowSrc: glowSrcMap,
      flick: flickers,
      update(dt) {
        giTime += dt;
        if (Ir) {
          Ir.ghLVT.value.x = giTime;
          if (hotel.lights.chandelier) Ir.ghLVK.value.w = hotel.lights.chandelier.k > 0.5 ? 1 : 0;
          if (hotel.lights.pool) Ir.ghLVK.value.z = hotel.lights.pool.k;
        }
        if (typeof vol.setSource === 'function') {
          for (const [id, rec] of Object.entries(lightTrack)) {
            const hl = hotel.lights[id];
            if (!hl) continue;
            const ratio = hl.base > 0 ? Math.min(1.5, hl.light.intensity / hl.base) : 0;
            if (Math.abs(ratio - rec.last) > 0.2) {
              rec.last = ratio;
              vol.setSource(rec.id, ratio);
              if (id === 'service' && serviceGlowIdx >= 0 && origSetGlow) origSetGlow(serviceGlowIdx, 0.25 + 0.75 * ratio);
            }
          }
          flushAcc += dt;
          if (flushAcc > 0.05) {
            flushAcc = 0;
            vol.flush?.();
          }
        }
      },
    };
    hotel.update.push(dt => lighting.update(dt));
    if (fx) {
      fx.lightVolume = vol;
      fx.lighting = lighting;
    }
    hotel.lighting = lighting;
  }

  // 12. Restore ALL 15 interactive & animated Hotel systems (1:1 parity with ND & qD).
  const inter = meta.interactive || {};
  const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
  const tmpVec = new THREE.Vector3();

  // 12a. Shootable Lamps, Sconces, Exit Signs.
  for (const lamp of inter.lamps || []) {
    const col = worldCols[lamp.colliderIndex];
    if (!col) continue;
    const bulbMeshes = [];
    const origMats = [];
    let clonedMats = null;
    for (const bName of lamp.bulbNodes || []) {
      const node = interactiveNodes.get(bName);
      if (!node) continue;
      node.traverse(c => {
        applyObjectFlags(c);
        ensureReliableBounds(c, { disableCulling: false });
        if (c.isMesh && c.material) {
          bulbMeshes.push(c);
          origMats.push(c.material);
        }
      });
      scene.add(node);
    }
    const pos = new THREE.Vector3(...lamp.pos);
    let broken = false;
    const kill = () => {
      if (broken) return;
      broken = true;
      if (!clonedMats) {
        clonedMats = origMats.map(m => {
          const c = m.clone();
          c.emissiveIntensity = 0;
          return c;
        });
      }
      bulbMeshes.forEach((b, i) => { b.material = clonedMats[i]; });
      for (const gIdx of lamp.glowIndices || []) fx?.setGlow?.(gIdx, 0);
      fx?.sparks?.(pos.x, pos.y, pos.z, 0, -0.3, 0, 14, { speed: 4 });
      fx?.glowPuff?.(pos.x, pos.y, pos.z, 0.8, [4, 3, 2], 0.07);
      audio?.breakProp?.(pos, 'bulb');
      audio?.sparks?.(pos);
      physics?.burst?.(pos, 5, 15394524, 0.03, 1.6, 0.6);
      col.off = true;
    };
    col.onShot = kill;
    col.onBlast = (_p, d) => { if (d < 4) kill(); };
    resets.push(() => {
      broken = false;
      col.off = false;
      bulbMeshes.forEach((b, i) => { b.material = origMats[i]; });
      for (const gIdx of lamp.glowIndices || []) fx?.setGlow?.(gIdx, 1);
    });
  }

  // 12b. Shootable TVs.
  const screenOffMat = matRefs.get('screenOff') || matsByName.get('screenOff')?.[0] || null;
  const screenOnMat = matRefs.get('screenOn') || matsByName.get('screenOn')?.[0] || null;
  for (const tv of inter.tvs || []) {
    const node = interactiveNodes.get(tv.nodeName);
    const col = worldCols[tv.colliderIndex];
    if (!node) continue;
    let screenMesh = null;
    node.traverse(c => {
      applyObjectFlags(c);
      ensureReliableBounds(c, { disableCulling: false });
      if (c.isMesh && !screenMesh) screenMesh = c;
    });
    scene.add(node);
    if (!col || !screenMesh) continue;
    const origMat = screenOnMat || screenMesh.material;
    let broken = false;
    col.onShot = pt => {
      if (broken) return;
      broken = true;
      if (screenOffMat) screenMesh.material = screenOffMat;
      fx?.sparks?.(pt.x, pt.y, pt.z, tv.normal[0], 0.2, tv.normal[2], 16, { speed: 5 });
      audio?.sparks?.(pt);
      audio?.breakProp?.(pt, 'glass');
    };
    resets.push(() => {
      broken = false;
      screenMesh.material = origMat;
    });
  }

  // 12c. Shootable Fire Extinguishers.
  for (const ext of inter.extinguishers || []) {
    const col = worldCols[ext.colliderIndex];
    if (!col) continue;
    const pos = new THREE.Vector3(...ext.pos);
    let triggered = false;
    col.onShot = () => {
      if (triggered) return;
      triggered = true;
      audio?.extinguisher?.(pos, 4.5);
      let t = 0;
      const dir = new THREE.Vector3(ext.dir[0] + randRange(-0.5, 0.5), 0.25, ext.dir[2] + randRange(-0.5, 0.5)).normalize();
      fx?.emitters?.push?.(dt => {
        t += dt;
        if (!triggered || t > 4.5) return false;
        const k = 1 - t / 4.5;
        for (let i = 0; i < 2; i++) {
          fx?.smoke?.(pos.x, pos.y, pos.z, 1, {
            size: 0.16, life: 1.5, a: 0.5 * k + 0.12,
            dx: dir.x, dy: dir.y, dz: dir.z, speed: 5.5 * k + 1,
            color: [0.92, 0.94, 0.96], bright: 1.4, drag: 2.2, spread: 0.03,
          });
        }
      });
    };
    resets.push(() => { triggered = false; });
  }

  // 12d. Shootable Reception Bell & Grand Piano.
  for (const idx of inter.bellColliders || []) {
    const col = worldCols[idx];
    if (col) col.onShot = pt => audio?.bell?.(pt);
  }
  for (const idx of inter.pianoColliders || []) {
    const col = worldCols[idx];
    if (col) col.onShot = pt => audio?.pianoNote?.(pt);
  }

  // 12e. Shootable Bar Speaker.
  if (inter.speaker) {
    let bulbMesh = null;
    let initEm = 0;
    if (inter.speaker.bulbNode) {
      const node = interactiveNodes.get(inter.speaker.bulbNode);
      if (node) {
        node.traverse(c => {
          applyObjectFlags(c);
          ensureReliableBounds(c, { disableCulling: false });
          if (c.isMesh && !bulbMesh) {
            c.material = c.material.clone();
            bulbMesh = c;
            initEm = c.material.emissiveIntensity ?? 1;
          }
        });
        scene.add(node);
      }
    }
    let broken = false;
    for (const idx of inter.speaker.colliderIndices || []) {
      const col = worldCols[idx];
      if (!col) continue;
      col.onShot = pt => {
        if (broken) return;
        broken = true;
        audio?.lounge?.kill?.();
        if (bulbMesh) bulbMesh.material.emissiveIntensity = 0;
        fx?.sparks?.(pt.x, pt.y, pt.z, -1, 0.4, 0, 14, { speed: 4 });
        audio?.sparks?.(pt);
      };
    }
    resets.push(() => {
      broken = false;
      if (bulbMesh) bulbMesh.material.emissiveIntensity = initEm;
      audio?.lounge?.start?.(hotel.speakerPos);
    });
  }

  // 12f. Shootable Kitchen Drop-Ceiling Tiles.
  if (inter.kitchenCeil && worldCols[inter.kitchenCeil.colliderIndex]) {
    const kcCol = worldCols[inter.kitchenCeil.colliderIndex];
    hotel.kitchenCeil = kcCol;
    const holeMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.6, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x050505, fog: false }),
      16,
    );
    for (let i = 0; i < 16; i++) holeMesh.setMatrixAt(i, zeroMat);
    holeMesh.instanceMatrix.needsUpdate = true;
    ensureReliableBounds(holeMesh, { disableCulling: true });
    scene.add(holeMesh);
    const tileMat = matRefs.get('ceilingTile') || matsByName.get('ceilingTile')?.[0] || new THREE.MeshStandardMaterial({ color: 0xd8d4c8 });
    const holeSet = new Set();
    let holeCursor = 0;
    const qRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const mTmp = new THREE.Matrix4();
    const oneVec = new THREE.Vector3(1, 1, 1);
    kcCol.onShot = pt => {
      const ox = Math.floor((pt.x - 6) / 0.6);
      const oz = Math.floor((pt.z + 20) / 0.6);
      const key = ox * 100 + oz;
      if (holeSet.has(key) || holeSet.size >= 16) return;
      holeSet.add(key);
      const px = 6 + (ox + 0.5) * 0.6;
      const pz = -20 + (oz + 0.5) * 0.6;
      const y0 = inter.kitchenCeil.y0;
      mTmp.compose(tmpVec.set(px, y0 - 0.003, pz), qRot, oneVec);
      holeMesh.setMatrixAt(holeCursor++ % 16, mTmp);
      holeMesh.instanceMatrix.needsUpdate = true;
      const tile = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.02, 0.58), tileMat);
      tile.position.set(px, y0 - 0.05, pz);
      tile.rotation.set(randRange(-0.3, 0.3), 0, randRange(-0.3, 0.3));
      tile.castShadow = true;
      tile.frustumCulled = false;
      const body = physics?.addProp?.(tile, { size: [0.58, 0.04, 0.58], center: [0, 0, 0], mass: 2, mat: 'plastic' });
      if (body) {
        body.temp = true;
        body.life = 40;
        physics?.wake?.(body);
      }
      fx?.smoke?.(px, y0 - 0.1, pz, 3, { size: 0.3, life: 1.6, a: 0.3, color: [0.8, 0.8, 0.78], dy: -1 });
    };
    resets.push(() => {
      holeSet.clear();
      holeCursor = 0;
      for (let i = 0; i < 16; i++) holeMesh.setMatrixAt(i, zeroMat);
      holeMesh.instanceMatrix.needsUpdate = true;
    });
  }

  // 12g. Shootable Wood Slat Screens (3 InstancedMeshes with per-slat instanceColor).
  for (const screen of inter.slatScreens || []) {
    const proto = instProtos.get(screen.protoName);
    if (!proto) continue;
    const qMat = new THREE.Matrix4().compose(
      new THREE.Vector3(...screen.center),
      new THREE.Quaternion(),
      new THREE.Vector3(screen.scale, screen.scale, screen.scale),
    );
    const im = new THREE.InstancedMesh(proto.geometry, proto.material, screen.count);
    im.castShadow = true;
    im.receiveShadow = true;
    const origMats = [];
    const tmpC = new THREE.Color();
    for (let i = 0; i < screen.count; i++) {
      const m = new THREE.Matrix4().fromArray(screen.matrices, i * 16).multiply(qMat);
      origMats.push(m);
      im.setMatrixAt(i, m);
      tmpC.setRGB(screen.colors[i * 3], screen.colors[i * 3 + 1], screen.colors[i * 3 + 2]);
      im.setColorAt(i, tmpC);
      const sl = screen.slats[i];
      const col = sl && sl.colliderIndex >= 0 ? worldCols[sl.colliderIndex] : null;
      if (col) {
        let hp = 2;
        const shatter = hitPt => {
          if (col.off) return;
          col.off = true;
          im.setMatrixAt(i, zeroMat);
          im.instanceMatrix.needsUpdate = true;
          const hy = hitPt ? hitPt.y : (sl.y0 + sl.y1) / 2;
          for (let d = 0; d < 7; d++) {
            physics?.debris?.(
              sl.x + randRange(-0.03, 0.03), sl.y0 + (sl.y1 - sl.y0) * (d + 0.5) / 7, sl.z + randRange(-0.03, 0.03),
              randRange(-1.6, 1.6), randRange(0, 2.2), randRange(-1.6, 1.6), 0.16, 11569754, 6,
            );
          }
          fx?.chips?.(sl.x, hy, sl.z, 0, 0.4, 0, 10, [0.72, 0.56, 0.36], { speed: 3.5, size: 1.6 });
          audio?.breakProp?.(tmpVec.set(sl.x, hy, sl.z), 'wood');
        };
        col.onShot = pt => { if (--hp <= 0) shatter(pt); };
        col.onBlast = () => shatter(null);
        resets.push(() => { hp = 2; col.off = false; });
      }
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    ensureReliableBounds(im, { disableCulling: true });
    scene.add(im);
    resets.push(() => {
      for (let i = 0; i < screen.count; i++) im.setMatrixAt(i, origMats[i]);
      im.instanceMatrix.needsUpdate = true;
    });
  }

  // 12h. Shootable Bar Bottles (3 InstancedMeshes, 68 bottles).
  for (const bg of inter.bottleGroups || []) {
    const proto = instProtos.get(bg.protoName);
    if (!proto) continue;
    const qMat = new THREE.Matrix4().compose(
      new THREE.Vector3(...bg.center),
      new THREE.Quaternion(),
      new THREE.Vector3(bg.scale, bg.scale, bg.scale),
    );
    const im = new THREE.InstancedMesh(proto.geometry, proto.material, bg.count);
    im.castShadow = false;
    if (proto.material?.transparent || proto.material?.depthWrite === false) im.layers.set(1);
    const origMats = [];
    const cols = [];
    for (let i = 0; i < bg.count; i++) {
      const m = new THREE.Matrix4().fromArray(bg.matrices, i * 16).multiply(qMat);
      origMats.push(m);
      im.setMatrixAt(i, m);
      const b = bg.bottles[i];
      const col = b && b.colliderIndex >= 0 ? worldCols[b.colliderIndex] : null;
      if (col) {
        col.silent = true;
        cols.push([i, col]);
        const shatter = () => {
          if (col.off) return;
          col.off = true;
          im.setMatrixAt(i, zeroMat);
          im.instanceMatrix.needsUpdate = true;
          tmpVec.set(b.pos[0], b.pos[1] + 0.15, b.pos[2]);
          physics?.burst?.(tmpVec, 7, bg.burstColor, 0.035, 2.2, 1.2);
          fx?.splash?.(tmpVec, 0.35);
          audio?.breakProp?.(tmpVec, 'glass');
        };
        col.onShot = shatter;
        col.onBlast = shatter;
      }
    }
    im.instanceMatrix.needsUpdate = true;
    ensureReliableBounds(im, { disableCulling: true });
    scene.add(im);
    resets.push(() => {
      for (const [i, col] of cols) {
        col.off = false;
        im.setMatrixAt(i, origMats[i]);
      }
      im.instanceMatrix.needsUpdate = true;
    });
  }

  // 12i. Shootable Swaying / Falling / Exploding Crystal Chandelier.
  if (inter.chandelier) {
    const ch = inter.chandelier;
    const chNode = interactiveNodes.get(ch.nodeName);
    if (chNode) {
      const bulbs = [];
      const initEm = [];
      chNode.traverse(c => {
        applyObjectFlags(c);
        ensureReliableBounds(c, { disableCulling: false });
        if (c.isMesh) {
          c.castShadow = false;
          if (c.userData?.ghBulb || c.name === 'bulb') {
            c.material = c.material.clone();
            bulbs.push(c);
            initEm.push(c.material.emissiveIntensity ?? 1);
          }
        }
      });
      scene.add(chNode);
      const chainCol = worldCols[ch.chainColliderIndex];
      const ringCol = worldCols[ch.ringColliderIndex];
      const chLight = hotel.lights.chandelier;
      const st = { hp: 3, ring: 9, falling: false, vy: 0, done: false, tilt: 0, by: null };
      const drop = () => {
        if (st.falling || st.done) return;
        st.falling = true;
        st.vy = 0;
        if (chainCol) chainCol.off = true;
        if (ringCol) ringCol.off = true;
        audio?.sparks?.(tmpVec.set(ch.pos[0], ch.pos[1], ch.pos[2]));
      };
      if (chainCol) {
        chainCol.onShot = (pt, _n, _d, actor) => {
          st.by = actor;
          fx?.sparks?.(pt.x, pt.y, pt.z, 0, -0.2, 0, 8);
          if (--st.hp <= 0) drop();
        };
        chainCol.onBlast = drop;
      }
      if (ringCol) {
        ringCol.onShot = (pt, _n, _d, actor) => {
          st.by = actor;
          fx?.sparks?.(pt.x, pt.y, pt.z, 0, -0.4, 0, 6, { color: [3, 2.6, 2] });
          physics?.burst?.(pt, 3, 16773592, 0.03, 1.5, 0);
          audio?.glassCrack?.(pt);
          if (--st.ring <= 0) drop();
        };
        ringCol.onBlast = drop;
      }
      hotel.update.push(dt => {
        if (!st.falling) {
          chNode.rotation.z = Math.sin(performance.now() * 6e-4) * 0.006;
          return;
        }
        st.vy -= 16 * dt;
        chNode.position.y += st.vy * dt;
        st.tilt += dt * 0.5;
        chNode.rotation.z = st.tilt * 0.3;
        chNode.rotation.x = st.tilt * 0.2;
        const groundY = (world.groundAt ? world.groundAt(ch.pos[0], ch.pos[2], chNode.position.y - ch.sizeY + 0.3) : 0) + ch.sizeY - 0.25;
        if (chNode.position.y <= groundY) {
          chNode.position.y = groundY;
          st.falling = false;
          st.done = true;
          const impact = new THREE.Vector3(ch.pos[0], groundY - ch.sizeY + 0.4, ch.pos[2]);
          audio?.chandelierCrash?.(impact);
          physics?.burst?.(impact, 46, 16773592, 0.05, 5.5, 2.5);
          fx?.sparks?.(impact.x, impact.y, impact.z, 0, 0.8, 0, 40, { speed: 9, life: 1.6 });
          fx?.smoke?.(impact.x, impact.y, impact.z, 8, { size: 0.6, life: 2.4, a: 0.3, spread: 0.8 });
          for (const b of bulbs) b.material.emissiveIntensity = 0.04;
          if (chLight) {
            chLight.k = 0;
            chLight.light.intensity = 0;
          }
          if (ch.glowIndex >= 0) fx?.setGlow?.(ch.glowIndex, 0);
          physics?.explode?.(impact, 3.5, 9);
          glass?.blast?.(impact, 1.5);
          onChandelier?.(impact, st.by);
        }
      });
      resets.push(() => {
        st.hp = 3; st.ring = 9; st.by = null; st.falling = false; st.done = false; st.tilt = 0;
        if (chainCol) chainCol.off = false;
        if (ringCol) ringCol.off = false;
        chNode.position.set(ch.pos[0], ch.pos[1], ch.pos[2]);
        chNode.rotation.set(0, 0, 0);
        bulbs.forEach((b, i) => { b.material.emissiveIntensity = initEm[i]; });
        if (chLight) {
          chLight.k = 1;
          chLight.light.intensity = chLight.base;
        }
        if (ch.glowIndex >= 0) fx?.setGlow?.(ch.glowIndex, 1);
      });
    }
  }

  // 12j. 4 Live UTC Reception World Clocks.
  {
    const clocks = [[2.72, -5], [3.42, 0], [4.12, 4], [4.82, 9]];
    const clockY = 2.86;
    const wallZ = inter.clockHandsZ ?? -7.895;
    const handPos = new Float32Array(144);
    const handNrm = new Float32Array(144);
    const handIdx = [];
    for (let i = 0; i < 12; i++) handIdx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    for (let i = 2; i < handNrm.length; i += 3) handNrm[i] = 1;
    const handGeo = new THREE.BufferGeometry();
    handGeo.setAttribute('position', new THREE.BufferAttribute(handPos, 3));
    handGeo.setAttribute('normal', new THREE.BufferAttribute(handNrm, 3));
    handGeo.setIndex(handIdx);
    const handMesh = new THREE.Mesh(handGeo, new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.45, metalness: 0.2 }));
    handMesh.frustumCulled = false;
    handMesh.name = 'clock-hands';
    scene.add(handMesh);
    let lastSec = -1;
    const updateClocks = () => {
      const now = new Date();
      const sec = now.getUTCSeconds();
      if (sec === lastSec) return;
      lastSec = sec;
      const tau = Math.PI * 2;
      clocks.forEach(([cx, tz], cIdx) => {
        const mins = now.getUTCMinutes() + sec / 60;
        const specs = [
          [((now.getUTCHours() + tz + 24) % 12 + mins / 60) / 12 * tau, 0.095, 0.0095, -0.02],
          [mins / 60 * tau, 0.142, 0.0065, -0.02],
          [sec / 60 * tau, 0.15, 0.0025, -0.04],
        ];
        specs.forEach(([ang, len, hw, tail], hIdx) => {
          const off = (cIdx * 3 + hIdx) * 12;
          const s = Math.sin(ang), c = Math.cos(ang);
          const px = c * hw, py = -s * hw;
          const z = wallZ + 0.021 + hIdx * 0.004;
          const bx = cx + s * tail, by = clockY + c * tail;
          const tx = cx + s * len, ty = clockY + c * len;
          handPos[off] = bx - px; handPos[off + 1] = by - py; handPos[off + 2] = z;
          handPos[off + 3] = bx + px; handPos[off + 4] = by + py; handPos[off + 5] = z;
          handPos[off + 6] = tx + px * 0.5; handPos[off + 7] = ty + py * 0.5; handPos[off + 8] = z;
          handPos[off + 9] = tx - px * 0.5; handPos[off + 10] = ty - py * 0.5; handPos[off + 11] = z;
        });
      });
      handGeo.attributes.position.needsUpdate = true;
    };
    updateClocks();
    hotel.update.push(updateClocks);
  }

  // 12k. 2 Shootable Bobbing Pool Floaties.
  const activeFloaties = [];
  for (const fl of inter.floaties || []) {
    const node = interactiveNodes.get(fl.nodeName);
    if (!node) continue;
    node.traverse(c => {
      applyObjectFlags(c);
      ensureReliableBounds(c, { disableCulling: false });
    });
    scene.add(node);
    const col = fl.colliderIndex >= 0 ? worldCols[fl.colliderIndex] : null;
    if (col) {
      col.silent = true;
      col.onShot = pt => {
        if (col.off) return;
        col.off = true;
        node.visible = false;
        fx?.smoke?.(fl.x, fl.y + 0.1, fl.z, 3, { size: 0.25, life: 0.7, a: 0.35, color: [0.95, 0.9, 0.85] });
        fx?.splash?.(new THREE.Vector3(fl.x, pool.water, fl.z), 0.8);
        hotel.ripple(fl.x, fl.z, 1.4);
        audio?.propHit?.(pt, 'plastic', 1);
      };
      resets.push(() => { col.off = false; node.visible = true; });
    }
    activeFloaties.push({ node, ...fl });
  }
  if (activeFloaties.length) {
    let floatT = 0;
    hotel.update.push(dt => {
      floatT += dt;
      for (const fl of activeFloaties) {
        if (!fl.node.visible) continue;
        fl.node.position.y = fl.y + Math.sin(floatT * 1.25 + fl.ph) * 0.012;
        fl.node.rotation.y = floatT * 0.05 + fl.ph;
        fl.node.rotation.x = Math.sin(floatT * 0.9 + fl.ph) * 0.035;
        fl.node.rotation.z = Math.cos(floatT * 0.7 + fl.ph * 2) * 0.035;
        fl.node.position.x = fl.x + Math.sin(floatT * 0.11 + fl.ph) * 0.18;
        fl.node.position.z = fl.z + Math.cos(floatT * 0.083 + fl.ph) * 0.14;
      }
    });
  }

  // 12l. Outdoor Fire Pit & Dripping Poolside Shower Emitters.
  if (fx?.emitters?.push) {
    fx.emitters.push(dt => {
      if (!fx.add?.spawn) return;
      for (let i = 0; i < 3; i++) {
        if (Math.random() < dt * 34) {
          fx.add.spawn({
            x: -15 + randRange(-0.36, 0.36), y: 0.5, z: 17.2 + randRange(-0.36, 0.36),
            vy: randRange(0.9, 2), vx: randRange(-0.15, 0.15), vz: randRange(-0.15, 0.15),
            life: randRange(0.35, 0.7), s0: randRange(0.28, 0.42), s1: 0.08, rv: randRange(-2, 2),
            r: 3.6, g: 1.25, b: 0.25, a: 0.85, frame: 12 + (Math.random() < 0.5 ? 1 : 0), drag: 0.4, grav: -1.2,
          });
        }
      }
      if (Math.random() < dt * 5) {
        fx.add.spawn({
          x: -15 + randRange(-0.3, 0.3), y: 0.7, z: 17.2 + randRange(-0.3, 0.3),
          vy: randRange(1.2, 2.6), vx: randRange(-0.5, 0.5), vz: randRange(-0.5, 0.5),
          life: randRange(0.8, 1.6), s0: 0.025, s1: 0.01,
          r: 5, g: 2, b: 0.4, a: 1, frame: 15, drag: 0.3, grav: -0.6,
        });
      }
    });
    let dripAcc = 0;
    fx.emitters.push(dt => {
      if (!fx.alpha?.spawn) return;
      dripAcc += dt;
      if (dripAcc > 0.8) {
        dripAcc = Math.random() * 0.3;
        fx.alpha.spawn({
          x: 13.2 + randRange(-0.06, 0.06), y: 2.06, z: 12.94 + randRange(-0.06, 0.06),
          vy: -0.2, life: 0.75, s0: 0.016, s1: 0.012,
          r: 0.9, g: 0.85, b: 0.8, a: 0.8, frame: 9, grav: 9.8, stretch: 0.02,
        });
      }
    });
  }

  // 12m. Live Twilight Distant City Skyline (Billboard, Twinkling Beacons, Airplane, Helicopter, 13 Birds).
  if (inter.billboard) {
    const bbMat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: { uTime: { value: 0 }, uHaze: { value: new THREE.Color(0.42, 0.26, 0.22) } },
      vertexShader: BILLBOARD_VERTEX_SHADER,
      fragmentShader: BILLBOARD_FRAGMENT_SHADER,
    });
    const bbMesh = new THREE.Mesh(new THREE.PlaneGeometry(28, 14.4), bbMat);
    bbMesh.position.set(...inter.billboard.pos);
    bbMesh.rotation.y = inter.billboard.rotY;
    bbMesh.frustumCulled = false;
    scene.add(bbMesh);
    hotel.update.push(dt => { bbMat.uniforms.uTime.value += dt; });
  }

  if (inter.cityBeacons) {
    const cb = inter.cityBeacons;
    const bGeo = new THREE.BufferGeometry();
    const bPos = new Float32Array(cb.positions);
    bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3).setUsage(THREE.DynamicDrawUsage));
    bGeo.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(cb.colors), 3));
    bGeo.setAttribute('aDat', new THREE.BufferAttribute(new Float32Array(cb.data), 3));
    const bMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 900 } },
      vertexShader: BEACON_VERTEX_SHADER,
      fragmentShader: BEACON_FRAGMENT_SHADER,
    });
    const bPts = new THREE.Points(bGeo, bMat);
    bPts.frustumCulled = false;
    bPts.renderOrder = 6;
    bPts.layers.set(1);
    scene.add(bPts);

    const planeNode = interactiveNodes.get('hotel-plane') || null;
    if (planeNode) {
      planeNode.traverse(c => { applyObjectFlags(c); c.frustumCulled = false; });
      scene.add(planeNode);
    }
    const heliNode = interactiveNodes.get('hotel-heli') || null;
    if (heliNode) {
      heliNode.traverse(c => { applyObjectFlags(c); c.frustumCulled = false; });
      scene.add(heliNode);
    }

    // 13 flapping sunset birds (exact WD math).
    const birdCount = 13;
    const birdGeo = new THREE.BufferGeometry();
    const birdPos = new Float32Array(birdCount * 18);
    birdGeo.setAttribute('position', new THREE.BufferAttribute(birdPos, 3).setUsage(THREE.DynamicDrawUsage));
    const birdMesh = new THREE.Mesh(birdGeo, new THREE.MeshBasicMaterial({ color: 0x241a1c, fog: false, side: THREE.DoubleSide }));
    birdMesh.frustumCulled = false;
    scene.add(birdMesh);
    let bSeed = 4747;
    const bRand = () => { bSeed = (Math.imul(bSeed, 1664525) + 1013904223) >>> 0; return bSeed / 4294967296; };
    const birds = [];
    for (let i = 0; i < birdCount; i++) {
      birds.push([bRand() * Math.PI * 2, 0.7 + bRand() * 0.6, -6 + bRand() * 12, -5 + bRand() * 10, bRand() * Math.PI * 2]);
    }

    let skyT = 40;
    const pStart = new THREE.Vector3(-1500, 380, 950);
    const pEnd = new THREE.Vector3(1500, 520, 600);
    const pDir = new THREE.Vector3().subVectors(pEnd, pStart).normalize();
    const pPos = new THREE.Vector3();
    const pRight = new THREE.Vector3().crossVectors(pDir, new THREE.Vector3(0, 1, 0)).normalize();
    const setBeacon = (idx, x, y, z) => {
      if (idx < 0 || idx * 3 + 2 >= bPos.length) return;
      bPos[idx * 3] = x; bPos[idx * 3 + 1] = y; bPos[idx * 3 + 2] = z;
    };
    const planeYaw = Math.atan2(-pDir.z, pDir.x);

    const updateVista = dt => {
      skyT += dt;
      bMat.uniforms.uTime.value = skyT;
      bMat.uniforms.uScale.value = globalThis.innerHeight || 900;
      const frac = (skyT % 150) / 150;
      pPos.lerpVectors(pStart, pEnd, frac);
      if (planeNode) {
        planeNode.position.copy(pPos);
        planeNode.rotation.set(0, planeYaw, 0);
      }
      setBeacon(cb.planeIdx, pPos.x, pPos.y - 2.5, pPos.z);
      setBeacon(cb.planeIdx + 1, pPos.x - pRight.x * 17, pPos.y, pPos.z - pRight.z * 17);
      setBeacon(cb.planeIdx + 2, pPos.x + pRight.x * 17, pPos.y, pPos.z + pRight.z * 17);

      const ha = skyT * 0.045;
      const hx = 330 + Math.cos(ha) * 190;
      const hz = 260 + Math.sin(ha) * 150;
      const hy = 70 + Math.sin(skyT * 0.21) * 8;
      if (heliNode) {
        heliNode.position.set(hx, hy, hz);
        heliNode.rotation.y = -ha - Math.PI / 2;
      }
      setBeacon(cb.heliIdx, hx, hy - 1.6, hz);
      setBeacon(cb.heliIdx + 1, hx - Math.sin(ha) * 7, hy + 1, hz + Math.cos(ha) * 7);
      bGeo.attributes.position.needsUpdate = true;

      for (let i = 0; i < birdCount; i++) {
        const bd = birds[i];
        const ang = skyT * 0.11 * bd[1] + bd[0];
        const rad = 30 + bd[2] * 2.2 + Math.sin(skyT * 0.07 + bd[4]) * 6;
        const bx = -64 + Math.cos(ang) * rad;
        const bz = 110 + Math.sin(ang) * rad * 0.8;
        const by = 30 + bd[3] * 1.6 + Math.sin(skyT * 0.23 + bd[4]) * 2.5;
        const tx = -Math.sin(ang), tz = Math.cos(ang) * 0.8;
        const tl = Math.hypot(tx, tz) || 1;
        const fx0 = tx / tl, fz0 = tz / tl;
        const sx0 = fz0, sz0 = -fx0;
        const flap = Math.sin(skyT * (5.5 + bd[1] * 2) + bd[4]) * (Math.sin(skyT * 0.35 + bd[4]) > 0.2 ? 0.25 : 1) * 0.55 + 0.12;
        const span = 1.05;
        birdPos.set([
          bx + fx0 * 0.45, by, bz + fz0 * 0.45,
          bx - fx0 * 0.35, by, bz - fz0 * 0.35,
          bx - sx0 * span - fx0 * 0.1, by + flap, bz - sz0 * span - fz0 * 0.1,
          bx + fx0 * 0.45, by, bz + fz0 * 0.45,
          bx + sx0 * span - fx0 * 0.1, by + flap, bz + sz0 * span - fz0 * 0.1,
          bx - fx0 * 0.35, by, bz - fz0 * 0.35,
        ], i * 18);
      }
      birdGeo.attributes.position.needsUpdate = true;
    };
    // Immediately place distant plane, helicopter, beacons, and birds in the sky
    // so frame 0 and CubeCamera environment capture never see them at (0, 0, 0).
    updateVista(0);
    let vistaVisible = true;
    qualityHooks.push((_q, quality) => {
      vistaVisible = quality !== 'low';
      bPts.visible = vistaVisible;
      birdMesh.visible = vistaVisible;
      if (planeNode) planeNode.visible = vistaVisible;
      if (heliNode) heliNode.visible = vistaVisible;
    });
    hotel.update.push(dt => { if (vistaVisible) updateVista(dt); });
  }

  // Release superseded raw RGB & companion alpha WebP textures once DataTextures are built.
  for (const tex of supersededRgbTexes) {
    tex?.image?.close?.();
    tex?.dispose?.();
  }
  for (const tex of dataAlphaTexByKey.values()) {
    tex?.image?.close?.();
    tex?.dispose?.();
  }
  dataAlphaTexByKey.clear();

  // Match original As0 layer-1 pass AFTER glass, shafts, glows, props, and
  // interactive nodes are mounted so planar floor reflections (layer 0) skip them.
  scene.updateMatrixWorld(true);
  scene.traverse(obj => {
    const mat = obj.material;
    if (mat && (obj.isMesh || obj.isPoints || obj.isSprite) && !Array.isArray(mat) &&
        (mat.transparent || mat.blending !== THREE.NormalBlending || mat.depthWrite === false)) {
      obj.layers.set(1);
    }
  });

  // 13. Wire planar reflections onto floor materials AFTER gh-surface2 attachment.
  const floorEnvMats = [];
  const outdoorEnvMats = [];
  let planar = null;
  if (QM && gfx?.camera) {
    planar = new QM(scene, gfx.camera);
    if (sky?.flare) planar.hide.push(sky.flare);
    for (const [name, cfg] of Object.entries(meta.floorReflections || {})) {
      for (const mat of matsByName.get(name) || []) {
        planar.add(mat, { k: cfg.k, blur: cfg.blur, rough: cfg.rough });
        if (cfg.envIntensity !== null && cfg.envIntensity !== undefined) {
          floorEnvMats.push([mat, cfg.envIntensity]);
        }
      }
    }
  }
  for (const name of meta.outdoorMaterials || []) {
    for (const mat of matsByName.get(name) || []) outdoorEnvMats.push(mat);
  }

  // 14. Build indoor & outdoor PMREM environments using true HDR CubeCamera (1:1 with As0)
  // when a WebGL renderer is active, falling back to pre-baked equirectangular maps otherwise.
  const restoreEnvironment = async () => {
    if (!gfx?.renderer || !THREE?.PMREMGenerator) return;
    const useCube = Boolean(
      typeof gfx.renderer.render === 'function' &&
      THREE.WebGLCubeRenderTarget &&
      THREE.CubeCamera &&
      THREE.HalfFloatType,
    );
    if (!useCube && !envInTex && !envOutTex) return;
    const pmrem = new THREE.PMREMGenerator(gfx.renderer);
    let cubeRT = null;
    let emptyTarget = null;
    let targetIn = null;
    let targetOut = null;
    let committed = false;
    try {
      if (useCube) {
        const cubeSize = globalThis.GHBoot?.policy?.cubeSize || 256;
        cubeRT = new THREE.WebGLCubeRenderTarget(cubeSize, {
          type: THREE.HalfFloatType,
          generateMipmaps: false,
        });
        const cubeCam = new THREE.CubeCamera(0.1, 2600, cubeRT);
        for (const child of cubeCam.children) child.layers.enable(1);
        emptyTarget = pmrem.fromScene(new THREE.Scene());
        const emptyTex = emptyTarget.texture;
        scene.environment = emptyTex;
        scene.environmentIntensity = 0;
        if (gfx.vmScene) gfx.vmScene.environment = emptyTex;
        for (const [mat] of floorEnvMats) {
          mat.envMap = emptyTex;
          mat.needsUpdate = true;
        }
        if (glass?.material) {
          glass.material.envMap = emptyTex;
          glass.material.needsUpdate = true;
        }
        for (const mat of outdoorEnvMats) {
          mat.envMap = emptyTex;
          mat.needsUpdate = true;
        }
        if (typeof gfx.renderer.compileAsync === 'function' && gfx.camera) {
          const prevRT = gfx.renderer.getRenderTarget?.() ?? null;
          try {
            gfx.renderer.setRenderTarget?.(cubeRT);
            await gfx.renderer.compileAsync(scene, gfx.camera);
          } finally {
            gfx.renderer.setRenderTarget?.(prevRT);
          }
        }
        if (gfx.renderer.shadowMap) gfx.renderer.shadowMap.needsUpdate = true;

        cubeCam.position.set(0, 2.6, 5.2);
        cubeCam.update(gfx.renderer, scene);
        targetIn = pmrem.fromCubemap(cubeRT.texture);

        const texInEarly = targetIn.texture;
        scene.environment = texInEarly;
        scene.environmentIntensity = 0.24;
        if (gfx.vmScene) {
          gfx.vmScene.environment = texInEarly;
          gfx.vmScene.environmentIntensity = 1.5;
        }
        for (const [mat, intensity] of floorEnvMats) {
          mat.envMap = texInEarly;
          mat.envMapIntensity = intensity;
          mat.needsUpdate = true;
        }

        cubeCam.position.set(0, 1.9, 12.6);
        cubeCam.update(gfx.renderer, scene);
        targetOut = pmrem.fromCubemap(cubeRT.texture);
        // Free fallback equirectangular env textures once CubeCamera PMREM succeeds.
        envInTex?.image?.close?.();
        envInTex?.dispose?.();
        envOutTex?.image?.close?.();
        envOutTex?.dispose?.();
      } else {
        const inSrc = envInTex || envOutTex;
        const outSrc = envOutTex || envInTex;
        targetIn = pmrem.fromEquirectangular(inSrc);
        targetOut = pmrem.fromEquirectangular(outSrc);
      }

      const texIn = targetIn.texture;
      const texOut = targetOut.texture;
      scene.environment = texIn;
      scene.environmentIntensity = 0.24;
      if (gfx.vmScene) {
        gfx.vmScene.environment = texIn;
        gfx.vmScene.environmentIntensity = 1.5;
      }
      if (!useCube) {
        for (const [mat, intensity] of floorEnvMats) {
          mat.envMap = texIn;
          mat.envMapIntensity = intensity;
          mat.needsUpdate = true;
        }
      }
      if (glass?.material) {
        glass.material.envMap = texOut;
        glass.material.envMapIntensity = 1.25;
        glass.material.needsUpdate = true;
      }
      for (const mat of outdoorEnvMats) {
        mat.envMap = texOut;
        mat.needsUpdate = true;
      }
      if (G) {
        G.envIn = texIn;
        G.envOut = texOut;
      }
      if (gfx.renderer.shadowMap) gfx.renderer.shadowMap.needsUpdate = true;
      for (const prev of gfx._environmentTargets || []) prev.dispose?.();
      gfx._environmentTargets = [targetIn, targetOut];
      committed = true;
    } finally {
      cubeRT?.dispose?.();
      emptyTarget?.dispose?.();
      pmrem.dispose();
      if (!committed) {
        targetIn?.dispose?.();
        targetOut?.dispose?.();
      }
    }
  };

  const nav = NavCtor ? hydrateBakedNav(NavCtor, world, worldJson.nodes || []) : null;
  if (globalThis.GHBoot?.stats) {
    globalThis.GHBoot.stats.hotel = `prebaked-v${manifest.version}-1to1`;
  }
  return {
    hotel, nav, planar, floorEnvMats, outdoorEnvMats,
    envInTex, envOutTex, restoreEnvironment, root: gltf.scene,
  };
}
