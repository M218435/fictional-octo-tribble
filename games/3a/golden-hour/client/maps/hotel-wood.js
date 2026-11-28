const frameMaterial = 'gh-hotel-wood-frame';
const colorURL = new URL('../../assets/hotel-wood-color.webp', import.meta.url);
const surfaceURL = new URL('../../assets/hotel-wood-surface.webp', import.meta.url);

export const usesHighDetailHotelWood = quality => quality === 'high' || quality === 'ultra';

function addGrainUV(geometry, THREE) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = new Float32Array(position.count * 2);
  // The native builder emits independent triangles. The lintel runs across
  // the doorway; the two jambs run vertically and use different grain areas.
  const top = geometry.boundingBox.max.y;
  for (let face = 0; face < position.count; face += 6) {
    const lintel = [0, 1, 2, 3, 4, 5].every(i => position.getY(face + i) >= top - .061);
    for (let i = face; i < face + 6; i++) {
      const x = position.getX(i) - 16, y = position.getY(i), z = position.getZ(i) - 4;
      const broadFace = Math.abs(normal.getX(i)) > .5;
      const endGrain = Math.abs(lintel ? normal.getZ(i) : normal.getY(i)) > .5;
      uv[i * 2] = endGrain ? x * 1.3 : lintel ? z / 1.1 : y / 2.3;
      uv[i * 2 + 1] = lintel ? .55 + (broadFace || endGrain ? top - y : x) * 1.3
        : (z < .5 ? .24 : .72) + (broadFace || endGrain ? z - (z < .5 ? 0 : 1.1) : x) * 1.3;
    }
  }
  geometry.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
}

export function installHotelWood(GH) {
  const { three: THREE, debug: { gfx, world } } = GH;
  const frame = world.meshes.find(mesh => mesh.material.name === frameMaterial);
  if (!frame) return;
  const original = frame.material;
  const loader = new THREE.TextureLoader();
  let requested = false;
  let pending;

  async function loadMaterial() {
    const results = await Promise.allSettled([colorURL, surfaceURL].map(url => loader.loadAsync(url.href)));
    if (results.some(result => result.status === 'rejected')) {
      for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
      throw new Error('高清木门框贴图加载失败。');
    }
    const [map, surface] = results.map(result => result.value);
    map.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [map, surface]) {
      texture.channel = 1;
      texture.anisotropy = Math.min(8, gfx.renderer.capabilities.getMaxAnisotropy());
    }
    addGrainUV(frame.geometry, THREE);
    return new THREE.MeshStandardMaterial({ name: `${frameMaterial}-hd`, map,
      color: new THREE.Color(1.8, 1.75, 1.65),
      bumpMap: surface, bumpScale: .008, roughnessMap: surface, roughness: .8 });
  }

  const applyQuality = async () => {
    requested = usesHighDetailHotelWood(gfx.quality);
    if (!requested) { frame.material = original; return; }
    pending ??= loadMaterial().catch(error => {
      pending = undefined;
      console.warn(error.message);
      return null;
    });
    const material = await pending;
    if (requested && material) frame.material = material;
  };
  const onQuality = gfx.onQuality;
  gfx.onQuality = function(...args) {
    const result = onQuality?.apply(this, args);
    void applyQuality();
    return result;
  };
  void applyQuality();
}
