const DB_NAME = "golden-hour-startup";
const DB_VERSION = 1;
const MAX_TEXTURE_BYTES = 160 * 1024 * 1024;
const PROPERTIES = [
  "mapping",
  "channel",
  "wrapS",
  "wrapT",
  "magFilter",
  "minFilter",
  "format",
  "type",
  "internalFormat",
  "colorSpace",
  "flipY",
  "premultiplyAlpha",
  "unpackAlignment",
  "generateMipmaps",
  "anisotropy",
  "rotation",
  "matrixAutoUpdate",
];

// Cache pixel data, not WebGL objects or shader binaries: those belong to a
// particular GPU/context. No network or room state is stored in this database.
function materialPlan(tree, budget = MAX_TEXTURE_BYTES) {
  const textures = [],
    seen = new Map();
  let bytes = 0;
  function visit(value) {
    if (value?.isTexture) {
      if (seen.has(value)) return { texture: seen.get(value) };
      const image = value.image;
      if (!image?.width || !image?.height)
        throw Error("Unsupported cached image");
      if (!Number.isInteger(image.width) || !Number.isInteger(image.height) ||
          image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192)
        throw Error("Unsupported cached image");
      bytes += image.width * image.height * 4;
      // Check the budget before getImageData allocates a canvas readback copy.
      if (bytes > Math.min(budget, MAX_TEXTURE_BYTES))
        throw Error("Material cache budget exceeded");
      const record = {
        texture: value,
        width: image.width,
        height: image.height,
      };
      const index = textures.length;
      seen.set(value, index);
      textures.push(record);
      return { texture: index };
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        if (key !== "timings") out[key] = visit(child);
      }
      return out;
    }
    return value;
  }
  const result = { schema: 1, tree: visit(tree), textures, bytes };
  return result;
}

function captureTexture({ texture: value, width, height }) {
  const image = value.image;
  let data = image.data;
  if (!data)
    data = image.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, width, height).data;
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) ||
      data.byteLength !== width * height * 4)
    throw Error("Unsupported cached pixels");
  const properties = {};
  for (const key of PROPERTIES) properties[key] = value[key];
  return { data, canvas: !value.isDataTexture, width, height, properties,
    repeat: value.repeat.toArray(), offset: value.offset.toArray(),
    center: value.center.toArray(), userData: value.userData };
}

export function captureMaterials(tree, budget = MAX_TEXTURE_BYTES) {
  const plan = materialPlan(tree, budget);
  return { ...plan, textures: plan.textures.map(captureTexture) };
}

export function restoreMaterials(pack, create, anisotropy, { consume = false } = {}) {
  if (
    pack?.schema !== 1 ||
    !pack.tree ||
    !Array.isArray(pack.textures) ||
    !pack.textures.length ||
    !Number.isInteger(pack.bytes) || pack.bytes < 1 || pack.bytes > MAX_TEXTURE_BYTES
  )
    return null;
  let totalBytes = 0;
  // Reject an entire invalid pack before creating canvas or GPU texture objects.
  for (const record of pack.textures) {
    if (
      !record || !Number.isInteger(record.width) ||
      !Number.isInteger(record.height) ||
      record.width < 1 ||
      record.height < 1 ||
      record.width > 8192 ||
      record.height > 8192 ||
      !record.properties ||
      ![record.repeat, record.offset, record.center].every((v) =>
        Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)) ||
      !(
        record.data instanceof Uint8Array ||
        record.data instanceof Uint8ClampedArray
      ) ||
      record.data?.byteLength !== record.width * record.height * 4
    )
      throw Error("Invalid material cache");
    totalBytes += record.data.byteLength;
    if (totalBytes > MAX_TEXTURE_BYTES)
      throw Error("Material cache budget exceeded");
  }
  if (totalBytes !== pack.bytes) throw Error("Invalid material cache byte count");
  function validateReferences(value) {
    if (value && typeof value === "object" && Object.keys(value).length === 1 &&
        Number.isInteger(value.texture)) {
      if (!pack.textures[value.texture]) throw Error("Invalid texture reference");
    } else if (Array.isArray(value)) value.forEach(validateReferences);
    else if (value && typeof value === "object") Object.values(value).forEach(validateReferences);
  }
  validateReferences(pack.tree);
  const textures = pack.textures.map((record, index) => {
    const texture = create(record);
    for (const key of PROPERTIES) texture[key] = record.properties[key];
    texture.repeat.fromArray(record.repeat);
    texture.offset.fromArray(record.offset);
    texture.center.fromArray(record.center);
    texture.userData = record.userData || {};
    texture.anisotropy = Math.min(anisotropy, record.properties.anisotropy ?? 8);
    texture.needsUpdate = true;
    // Canvas restoration copies the pixels. Drop cache records as each texture
    // is restored instead of holding their full readback pack through startup.
    if (consume) pack.textures[index] = null;
    return texture;
  });
  function visit(value) {
    if (
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 1 &&
      Number.isInteger(value.texture)
    ) {
      if (!textures[value.texture]) throw Error("Invalid texture reference");
      return textures[value.texture];
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, visit(child)]),
      );
    return value;
  }
  return { ...visit(pack.tree), timings: { cached: 1 } };
}

function database(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Error("Startup cache canceled")); return; }
    let settled = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    const cleanup = () => signal?.removeEventListener("abort", aborted);
    const aborted = () => { settled = true; cleanup(); reject(Error("Startup cache canceled")); };
    signal?.addEventListener("abort", aborted, { once: true });
    request.onupgradeneeded = () => request.result.createObjectStore("cache");
    request.onsuccess = () => {
      const db = request.result;
      cleanup();
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => { settled = true; cleanup(); reject(request.error); };
    request.onblocked = () => { settled = true; cleanup(); reject(Error("Startup cache locked")); };
  });
}
export async function readCache(key, budget = MAX_TEXTURE_BYTES, { signal } = {}) {
  const db = await database(signal);
  let cancel;
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("cache"), store = tx.objectStore("cache");
      cancel = () => { try { tx.abort(); } catch {} reject(Error("Startup cache canceled")); };
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      let value;
      const request = store.get(key);
      request.onsuccess = () => {
        const manifest = request.result;
        if (!manifest || !Number.isInteger(manifest.bytes) || manifest.bytes < 1 ||
            manifest.bytes > Math.min(budget, MAX_TEXTURE_BYTES)) return;
        // Read all records in one transaction, so another tab cannot replace
        // the manifest halfway through a read. Old single-record caches work.
        if (manifest.storage !== 2) { value = manifest; return; }
        const { storage, count, ...pack } = manifest;
        if (!Number.isInteger(count) || count < 1 || count > 256) {
          tx.abort();
          return;
        }
        value = { ...pack, textures: new Array(count) };
        for (let i = 0; i < count; i++) {
          const pixels = store.get([key, i]);
          pixels.onsuccess = () => {
            if (!pixels.result) { tx.abort(); return; }
            value.textures[i] = pixels.result;
          };
        }
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error || Error("Material cache read failed"));
      tx.onabort = () => reject(tx.error || Error("Incomplete material cache"));
    });
  } finally {
    if (cancel) signal?.removeEventListener("abort", cancel);
    db.close();
  }
}
export async function writeCache(key, value) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("cache", "readwrite"),
        store = tx.objectStore("cache");
      // Derived data from an older bundle is disposable; bound disk usage.
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      try {
        store.clear();
        // Chromium caps each serialized IDB value at about 128 MiB. The desktop
        // pack exceeds that; store each texture separately in this atomic write.
        const { textures, ...manifest } = value;
        store.put({ ...manifest, storage: 2, count: textures.length }, key);
        textures.forEach((texture, i) => store.put(texture, [key, i]));
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}

// Capture/serialize one texture at a time. Building the complete readback pack
// first adds another 69/154 MiB of temporary pixels to a fully loaded scene.
export async function writeMaterialsCache(key, tree, budget = MAX_TEXTURE_BYTES) {
  const { textures, ...manifest } = materialPlan(tree, budget);
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("cache", "readwrite"), store = tx.objectStore("cache");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || Error("Material cache write failed"));
      tx.onabort = () => reject(tx.error || Error("Material cache write aborted"));
      let index = 0;
      const next = () => {
        try {
          if (index === textures.length) return;
          const texture = captureTexture(textures[index]);
          const request = store.put(texture, [key, index++]);
          request.onsuccess = next;
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      try {
        store.clear();
        const request = store.put({ ...manifest, storage: 2, count: textures.length }, key);
        request.onsuccess = next;
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
    return { bytes: manifest.bytes, textures: textures.length };
  } finally {
    db.close();
  }
}

export function hydrateArmoury(studio, pack) {
  if (
    pack?.schema !== 1 ||
    !Array.isArray(pack.flat) ||
    !Array.isArray(pack.cards)
  )
    return false;
  const flat = new Map(pack.flat),
    cards = new Map(pack.cards);
  for (const key of ["frag", "ar", "smg", "shotgun", "pistol"]) {
    const icon = flat.get(key);
    if (
      !icon ||
      !/^data:image\/(png|webp);base64,/.test(icon.sil) ||
      !/^data:image\/(png|webp);base64,/.test(icon.line) ||
      !Number.isFinite(icon.aspect) ||
      !/^data:image\/(png|webp);base64,/.test(pack.shaded?.[key])
    )
      return false;
  }
  studio.flat = flat;
  studio.cards = cards;
  studio.shaded = { ...pack.shaded };
  studio.bakeMs = 0;
  return true;
}
