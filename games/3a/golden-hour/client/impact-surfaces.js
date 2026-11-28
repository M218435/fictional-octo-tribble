// Collision boxes decide hits; only visible, static map triangles can support
// a lasting mark. Chunk bounds avoid casting every AI shot over the whole map.
const CELL = 4, CHUNK = 64, REACH = .22, LIFE = 20;

export class ImpactSurfaces {
  constructor(roots, THREE, mapBounds = {}, dynamicRoots = []) {
    this.grid = new Map();
    this.large = [];
    this.geometry = new Map();
    this.THREE = THREE;
    const { Box3, Matrix4, Matrix3, Vector3, Ray } = THREE;
    this.ray = new Ray(); this.localRay = new Ray();
    this.inverse = new Matrix4(); this.normalMatrix = new Matrix3();
    this.currentMatrix = new Matrix4(); this.instanceMatrix = new Matrix4();
    this.a = new Vector3(); this.b = new Vector3(); this.c = new Vector3();
    this.hit = new Vector3(); this.hitNormal = new Vector3(); this.box = new Box3();
    const matrix = new Matrix4(), instance = new Matrix4(), moving = new Set(dynamicRoots);
    for (const root of roots) {
      root.updateWorldMatrix(true, true);
      root.traverse(mesh => {
        if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.morphTargetInfluences?.length || !mesh.geometry?.attributes.position) return;
        if (!this.visible(mesh) || !this.solid(mesh.material)) return;
        for (let parent = mesh; parent; parent = parent.parent) if (moving.has(parent)) return;
        const geometry = mesh.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        for (let id = 0, count = mesh.isInstancedMesh ? mesh.count : 1; id < count; id++) {
          matrix.copy(mesh.matrixWorld);
          if (mesh.isInstancedMesh) { mesh.getMatrixAt(id, instance); matrix.multiply(instance); }
          const bounds = geometry.boundingBox.clone().applyMatrix4(matrix);
          if (bounds.isEmpty()) continue;
          const x0 = Math.floor(Math.max(bounds.min.x, (mapBounds.minX ?? -Infinity)-1) / CELL);
          const x1 = Math.floor(Math.min(bounds.max.x, (mapBounds.maxX ?? Infinity)+1) / CELL);
          const z0 = Math.floor(Math.max(bounds.min.z, (mapBounds.minZ ?? -Infinity)-1) / CELL);
          const z1 = Math.floor(Math.min(bounds.max.z, (mapBounds.maxZ ?? Infinity)+1) / CELL);
          if (x0 > x1 || z0 > z1) continue; // Distant skyline cannot receive in-map impacts.
          if (!this.geometry.has(geometry)) this.geometry.set(geometry, this.chunks(geometry));
          const entry = { mesh, matrix: matrix.clone(), bounds, id };
          if ((x1-x0+1)*(z1-z0+1) > 256) { this.large.push(entry); continue; }
          for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
            const key = x + ',' + z;
            if (!this.grid.has(key)) this.grid.set(key, []);
            this.grid.get(key).push(entry);
          }
        }
      });
    }
  }
  solid(material) {
    if (Array.isArray(material)) return material.some(m => this.solid(m));
    return !!material && material.visible !== false && !material.transparent && !material.alphaTest && material.depthWrite !== false;
  }
  visible(mesh) {
    for (let p = mesh; p; p = p.parent) if (!p.visible) return false;
    return true;
  }
  chunks(geometry) {
    const position = geometry.attributes.position, index = geometry.index;
    const count = index?.count ?? position.count;
    const bounds = new Float32Array(Math.ceil(count / (CHUNK * 3)) * 6);
    for (let start = 0, offset = 0; start < count; start += CHUNK * 3, offset += 6) {
      bounds[offset] = bounds[offset+1] = bounds[offset+2] = Infinity;
      bounds[offset+3] = bounds[offset+4] = bounds[offset+5] = -Infinity;
      for (let i = start; i < Math.min(count, start + CHUNK * 3); i++) {
        this.a.fromBufferAttribute(position, index ? index.getX(i) : i);
        for (let axis = 0; axis < 3; axis++) {
          const value = this.a.getComponent(axis);
          bounds[offset+axis] = Math.min(bounds[offset+axis], value);
          bounds[offset+axis+3] = Math.max(bounds[offset+axis+3], value);
        }
      }
    }
    return bounds;
  }
  // Short projection around the collision plane, never a second combat ray.
  contact(entry, point, normal) {
    const { mesh, matrix, bounds } = entry;
    if (!this.visible(mesh)) return null;
    // Moving props are not static decal receivers. Never use their old bounds.
    this.currentMatrix.copy(mesh.matrixWorld);
    if (mesh.isInstancedMesh) { mesh.getMatrixAt(entry.id, this.instanceMatrix); this.currentMatrix.multiply(this.instanceMatrix); }
    if (!matrix.equals(this.currentMatrix)) return null;
    this.ray.origin.copy(point).addScaledVector(normal, REACH);
    this.ray.direction.copy(normal).negate();
    if (!this.ray.intersectsBox(bounds)) return null;
    this.inverse.copy(matrix).invert();
    this.localRay.copy(this.ray).applyMatrix4(this.inverse);
    this.normalMatrix.getNormalMatrix(matrix);
    const geometry = mesh.geometry, position = geometry.attributes.position, index = geometry.index;
    const chunks = this.geometry.get(geometry);
    let nearest = REACH * 2 + 1e-6, result = null;
    for (let offset = 0; offset < chunks.length; offset += 6) {
      this.box.min.fromArray(chunks, offset); this.box.max.fromArray(chunks, offset+3); this.box.expandByScalar(1e-5);
      if (!this.localRay.intersectsBox(this.box)) continue;
      const start = offset / 6 * CHUNK * 3;
      const end = Math.min(index?.count ?? position.count, start + CHUNK * 3, geometry.drawRange.start + geometry.drawRange.count);
      for (let i = Math.max(start, geometry.drawRange.start); i + 2 < end; i += 3) {
        const group = geometry.groups.find(g => i >= g.start && i < g.start + g.count);
        const material = Array.isArray(mesh.material) ? mesh.material[group?.materialIndex ?? 0] : mesh.material;
        if (!this.solid(material)) continue;
        this.a.fromBufferAttribute(position, index ? index.getX(i) : i);
        this.b.fromBufferAttribute(position, index ? index.getX(i+1) : i+1);
        this.c.fromBufferAttribute(position, index ? index.getX(i+2) : i+2);
        const back = material.side === this.THREE.BackSide;
        if (!this.localRay.intersectTriangle(back ? this.c : this.a, this.b, back ? this.a : this.c,
          material.side !== this.THREE.DoubleSide, this.hit)) continue;
        this.hit.applyMatrix4(matrix);
        const distance = this.hit.distanceTo(this.ray.origin);
        if (distance >= nearest) continue;
        this.hitNormal.subVectors(this.c, this.b); this.a.sub(this.b);
        this.hitNormal.cross(this.a).applyNormalMatrix(this.normalMatrix);
        if (back) this.hitNormal.negate();
        // Rotated/curved props cannot support a quad on the proxy's flat plane.
        if (this.hitNormal.dot(normal) < .995) continue;
        nearest = distance;
        result = { point: this.hit.clone(), normal: this.hitNormal.clone(), entry };
      }
    }
    return result;
  }
  fit(point, normal, size, angle = Math.random() * Math.PI * 2) {
    if (!(size > 0) || !Number.isFinite(size) || ![point.x, point.y, point.z, normal.x, normal.y, normal.z].every(Number.isFinite)) return null;
    const entries = new Set(this.large);
    // A proxy face on a cell boundary can project onto the neighbouring cell.
    for (let x = Math.floor((point.x-Math.abs(normal.x)*REACH)/CELL); x <= Math.floor((point.x+Math.abs(normal.x)*REACH)/CELL); x++)
      for (let z = Math.floor((point.z-Math.abs(normal.z)*REACH)/CELL); z <= Math.floor((point.z+Math.abs(normal.z)*REACH)/CELL); z++)
        for (const entry of this.grid.get(x + ',' + z) || []) entries.add(entry);
    let best = null, distance = Infinity;
    for (const entry of entries) {
      const hit = this.contact(entry, point, normal);
      const delta = hit?.point.distanceToSquared(point) ?? Infinity;
      if (delta < distance) { best = hit; distance = delta; }
    }
    if (!best) return null;
    const { Vector3 } = this.THREE, n = best.normal;
    const tangent = Math.abs(n.y) < .9 ? new Vector3(0, 1, 0).cross(n).normalize() : new Vector3(1, 0, 0);
    const bitangent = new Vector3().crossVectors(n, tangent);
    const cos = Math.cos(angle), sin = Math.sin(angle), half = size * .5;
    // Reject unsupported corners, so a mark cannot bridge a gap or a prop edge.
    for (const x of [-half, half]) for (const y of [-half, half]) {
      const corner = best.point.clone().addScaledVector(tangent, x*cos-y*sin).addScaledVector(bitangent, x*sin+y*cos);
      const support = this.contact(best.entry, corner, n);
      if (!support || support.point.distanceToSquared(corner) > .000025) return null;
    }
    return { point: best.point, normal: n, angle };
  }
  dispose() { this.grid.clear(); this.large.length = 0; this.geometry.clear(); }
}

// Match native effect fitting to the active map, rather than hidden hotel data.
export function effectWorld(world) {
  const origin = {}, dir = {}, columns = new WeakMap();
  return { raycast(x, y, z, dx, dy, dz, limit, out) {
    Object.assign(origin, { x, y, z }); Object.assign(dir, { x: dx, y: dy, z: dz });
    const hit = world.raycast(origin, dir, limit);
    if (!hit || hit.distance < 1e-5) return false;
    if (out) {
      const box = hit.collider;
      if (!columns.has(box)) columns.set(box, { x0: box.min[0], y0: box.min[1], z0: box.min[2], x1: box.max[0], y1: box.max[1], z1: box.max[2], water: box.surf === 'water' });
      Object.assign(out, { t: hit.distance, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z, col: columns.get(box) });
    }
    return true;
  } };
}

export function wallImpact(fx, surface, point, normal, floor, world, surfaces) {
  const savedWorld = fx.world, decals = fx.decals, add = decals?.add;
  fx.world = world;
  if (add) decals.add = function(type, center, n, size, tint, angle, life = LIFE) {
    const fit = surfaces?.fit(center, n, size, Number.isFinite(angle) ? angle : undefined);
    return fit ? add.call(this, type, fit.point, fit.normal, size, tint, fit.angle, Math.min(life, LIFE)) : -1;
  };
  try { fx.impact?.(surface, point, normal, floor); }
  finally { fx.world = savedWorld; if (add) decals.add = add; }
}
