// Unified pre-baked startup resource pack (GHSP v1).
// Decodes WebP textures via native createImageBitmap and deflate-raw geometry
// chunks via DecompressionStream so 38%/47%/80% boot stages avoid live CPU
// procedural synthesis while preserving exact Three.js runtime semantics.

const MAGIC = 0x50534847; // "GHSP" little-endian
const MAX_PACK_BYTES = 32 * 1024 * 1024;
const TYPES = {
  Float32Array,
  Uint32Array,
  Uint16Array,
  Uint8Array,
  Int16Array,
  Int8Array,
};

const align8 = n => Math.ceil(n / 8) * 8;

async function inflateRawBytes(compressed) {
  if (typeof globalThis.DecompressionStream === "function") {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const zlib = await import("node:zlib");
  const out = zlib.inflateRawSync(compressed);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

async function decodeWebPImage(bytes, { data = false, maxDim = 0 } = {}) {
  if (typeof globalThis.createImageBitmap !== "function" || typeof globalThis.Blob !== "function") {
    return { bytes, width: 0, height: 0, _rawWebp: true };
  }
  const blob = new Blob([bytes], { type: "image/webp" });
  const opts = data ? { premultiplyAlpha: "none", colorSpaceConversion: "none" } : undefined;
  let bmp;
  try {
    bmp = opts ? await createImageBitmap(blob, opts) : await createImageBitmap(blob);
  } catch {
    bmp = await createImageBitmap(blob);
  }
  if (maxDim > 0 && Math.max(bmp.width, bmp.height) > maxDim) {
    const scale = maxDim / Math.max(bmp.width, bmp.height);
    const resizeWidth = Math.max(1, Math.round(bmp.width * scale));
    const resizeHeight = Math.max(1, Math.round(bmp.height * scale));
    try {
      const resized = await createImageBitmap(bmp, {
        ...(opts || {}),
        resizeWidth,
        resizeHeight,
        resizeQuality: "medium",
      });
      bmp.close?.();
      bmp = resized;
    } catch {
      // Keep original bitmap if resize options are unsupported.
    }
  }
  return bmp;
}

export function parseStartupPackHeader(buffer, expectedSource) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 16 || buffer.byteLength > MAX_PACK_BYTES) {
    throw Error("Invalid startup pack size");
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw Error("Invalid startup pack magic");
  const headerLength = view.getUint32(4, true);
  const dataStart = 8 + align8(headerLength);
  if (headerLength < 2 || headerLength > 512 * 1024 || dataStart > buffer.byteLength) {
    throw Error("Invalid startup pack header");
  }
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength)));
  if (header.schema !== 1) throw Error("Unsupported startup pack schema");
  if (expectedSource && header.source !== expectedSource) throw Error("Obsolete startup pack");
  if (!Array.isArray(header.chunks)) throw Error("Invalid startup pack chunks");
  for (const chunk of header.chunks) {
    if (
      !Number.isInteger(chunk?.offset) ||
      chunk.offset < 0 ||
      !Number.isInteger(chunk?.byteLength) ||
      chunk.byteLength < 1 ||
      dataStart + chunk.offset + chunk.byteLength > buffer.byteLength
    ) {
      throw Error("Invalid startup pack chunk bounds");
    }
  }
  return { header, dataStart };
}

export async function decodeStartupPack(buffer, expectedSource, { textureLimit = 0 } = {}) {
  const { header, dataStart } = parseStartupPackHeader(buffer, expectedSource);
  const decodedChunks = new Array(header.chunks.length);

  await Promise.all(
    header.chunks.map(async (chunk, idx) => {
      const slice = new Uint8Array(buffer, dataStart + chunk.offset, chunk.byteLength);
      if (chunk.encoding === "webp") {
        decodedChunks[idx] = await decodeWebPImage(slice, {
          data: !!chunk.data,
          maxDim: chunk.keepFullRes ? 0 : textureLimit,
        });
      } else if (chunk.encoding === "deflate-raw") {
        decodedChunks[idx] = await inflateRawBytes(slice);
      } else if (chunk.encoding === "raw") {
        decodedChunks[idx] = slice;
      } else {
        throw Error(`Unsupported chunk encoding: ${chunk.encoding}`);
      }
    }),
  );

  function typedArray(ref) {
    if (!ref || !Object.hasOwn(TYPES, ref.type)) throw Error("Invalid typed array ref");
    const bytes = decodedChunks[ref.chunk];
    if (!(bytes instanceof Uint8Array)) throw Error("Missing binary chunk");
    const Type = TYPES[ref.type];
    const byteOffset = ref.byteOffset || 0;
    const byteLength = ref.length * Type.BYTES_PER_ELEMENT;
    if (byteOffset < 0 || byteOffset + byteLength > bytes.byteLength) {
      throw Error("Typed array out of chunk bounds");
    }
    const absOffset = bytes.byteOffset + byteOffset;
    if (absOffset % Type.BYTES_PER_ELEMENT === 0) {
      return new Type(bytes.buffer, absOffset, ref.length);
    }
    const copy = bytes.slice(byteOffset, byteOffset + byteLength);
    return new Type(copy.buffer, 0, ref.length);
  }

  function decodeGeometry(rec) {
    if (!rec) return null;
    const attributes = {};
    for (const [name, attr] of Object.entries(rec.attributes || {})) {
      attributes[name] = {
        data: typedArray(attr),
        itemSize: attr.itemSize,
        normalized: !!attr.normalized,
      };
    }
    return {
      attributes,
      index: rec.index ? typedArray(rec.index) : null,
      fp: rec.fp ? typedArray(rec.fp) : null,
      drawRange: rec.drawRange || null,
      triangles: rec.triangles || 0,
    };
  }

  function imageOf(ref) {
    if (ref == null) return null;
    const img = decodedChunks[ref.chunk];
    return img ? { image: img, width: ref.width, height: ref.height, flipY: !!ref.flipY, srgb: !!ref.srgb, data: !!ref.data } : null;
  }

  const operators = Array.isArray(header.operators) ? header.operators.map(decodeGeometry) : null;

  const actorTextures = header.actorTextures
    ? Object.fromEntries(Object.entries(header.actorTextures).map(([k, v]) => [k, imageOf(v)]))
    : null;

  const arms = header.arms
    ? {
        geometry: decodeGeometry(header.arms.geometry),
        info: header.arms.info,
        atlas: Object.fromEntries(Object.entries(header.arms.atlas || {}).map(([k, v]) => [k, imageOf(v)])),
        sleeve: {
          noise: header.arms.sleeve?.noise ? { data: typedArray(header.arms.sleeve.noise), width: 64, height: 64 } : null,
          weave: imageOf(header.arms.sleeve?.weave),
        },
      }
    : null;

  const weaponMats = header.weaponMats
    ? {
        ao: header.weaponMats.ao
          ? {
              pairs: Object.fromEntries(
                Object.entries(header.weaponMats.ao.pairs || {}).map(([k, pair]) => [
                  k,
                  { n: imageOf(pair.n), r: imageOf(pair.r) },
                ]),
              ),
              wood: imageOf(header.weaponMats.ao.wood),
              sleeve: imageOf(header.weaponMats.ao.sleeve),
              mark: imageOf(header.weaponMats.ao.mark),
              markCells: header.weaponMats.ao.markCells,
            }
          : null,
        p4: header.weaponMats.p4
          ? {
              wear: imageOf(header.weaponMats.p4.wear),
              mark: imageOf(header.weaponMats.p4.mark),
              markCells: header.weaponMats.p4.markCells,
            }
          : null,
        bk: header.weaponMats.bk
          ? { wear: imageOf(header.weaponMats.bk.wear) }
          : null,
      }
    : null;

  const camos = header.camos
    ? {
        packs: Object.fromEntries(
          Object.entries(header.camos.packs || {}).map(([id, p]) => [
            id,
            {
              tile: p.tile,
              map: imageOf(p.map),
              normalMap: imageOf(p.normalMap),
              orm: imageOf(p.orm),
            },
          ]),
        ),
        details: Object.fromEntries(
          Object.entries(header.camos.details || {}).map(([id, ref]) => [id, imageOf(ref)]),
        ),
      }
    : null;

  const fx = header.fx
    ? {
        noise3d: header.fx.noise3d
          ? { data: typedArray(header.fx.noise3d), size: header.fx.noise3d.size || 64 }
          : null,
        sprites: imageOf(header.fx.sprites),
        decals: header.fx.decals
          ? { map: imageOf(header.fx.decals.map), normalMap: imageOf(header.fx.decals.normalMap) }
          : null,
      }
    : null;

  const k9 = header.k9
    ? {
        detail: imageOf(header.k9.detail),
        mask: imageOf(header.k9.mask),
        marks: imageOf(header.k9.marks),
        cells: header.k9.cells,
        eb: header.k9.eb
          ? {
              geometry: decodeGeometry(header.k9.eb.geometry),
              rest: header.k9.eb.rest,
              stats: header.k9.eb.stats,
            }
          : null,
      }
    : null;

  const arGeo = header.arGeo
    ? Object.fromEntries(
        Object.entries(header.arGeo).map(([key, parts]) => [
          key,
          Object.fromEntries(Object.entries(parts).map(([part, geo]) => [part, decodeGeometry(geo)])),
        ]),
      )
    : null;

  const minimap = header.minimap
    ? {
        ...header.minimap.meta,
        floor0: imageOf(header.minimap.floor0),
        floor1: imageOf(header.minimap.floor1),
      }
    : null;

  return {
    schema: 1,
    source: header.source,
    operators,
    actorTextures,
    arms,
    weaponMats,
    camos,
    fx,
    k9,
    arGeo,
    minimap,
  };
}

export function buildBufferGeometry(record, createGeometry, createAttribute) {
  if (!record) return null;
  const geo = createGeometry();
  for (const [name, attr] of Object.entries(record.attributes)) {
    geo.setAttribute(name, createAttribute(attr.data, attr.itemSize, attr.normalized));
  }
  if (record.index) geo.setIndex(createAttribute(record.index, 1, false));
  if (record.drawRange) geo.setDrawRange(record.drawRange.start, record.drawRange.count);
  if (record.fp) geo.userData.fp = record.fp;
  if (record.triangles) geo.userData.triangles = record.triangles;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function createBitmapTexture(rec, createTexture, opts = {}) {
  if (!rec?.image) return null;
  const tex = createTexture(rec.image);
  tex.flipY = opts.flipY !== undefined ? opts.flipY : !!rec.flipY;
  if (opts.wrap !== undefined) tex.wrapS = tex.wrapT = opts.wrap;
  if (opts.minFilter !== undefined) tex.minFilter = opts.minFilter;
  if (opts.magFilter !== undefined) tex.magFilter = opts.magFilter;
  if (opts.generateMipmaps !== undefined) tex.generateMipmaps = opts.generateMipmaps;
  if (opts.anisotropy !== undefined) tex.anisotropy = opts.anisotropy;
  if (opts.colorSpace !== undefined) tex.colorSpace = opts.colorSpace;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.needsUpdate = true;
  return tex;
}
