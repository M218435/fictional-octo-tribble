export const STEP = 1 / 60;
export const JUMP = 1,
  SPRINT = 2,
  CROUCH = 4,
  ADS = 8,
  SLIDE = 16;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const motion = (s) => {
  const vx = s.vx || 0,
    vz = s.vz || 0,
    slideSpeed = Math.hypot(vx, vz) || 1;
  return {
    x: s.x,
    y: s.y,
    z: s.z,
    vx,
    vy: s.vy || 0,
    vz,
    ground: s.ground ?? true,
    crouch: !!s.crouch,
    sliding: !!s.sliding,
    slideTime: s.slideTime || 0,
    slideCooldown: s.slideCooldown || 0,
    slideX: s.slideX ?? (s.sliding ? vx / slideSpeed : 0),
    slideZ: s.slideZ ?? (s.sliding ? vz / slideSpeed : 0),
    slideHeld: false,
    crouchHeld: false,
    jumpHeld: !!s.jumpHeld,
  };
};

// Fixed-step prediction, kept numerically equivalent to internal/game/world.go.
export class World {
  constructor(colliders, bounds = {}) {
    this.colliders = colliders;
    this.bounds = {
      minX: bounds.minX ?? -31,
      maxX: bounds.maxX ?? 31,
      minZ: bounds.minZ ?? -24,
      maxZ: bounds.maxZ ?? 25,
    };
    this.grid = new Map();
    this.seen = new Uint32Array(colliders.length);
    this.queryId = 0;
    this.nearbyBuffer = [];
    for (let index = 0; index < colliders.length; index++) {
      const c = colliders[index];
      for (
        let x = Math.floor(c.min[0] / 4);
        x <= Math.floor(c.max[0] / 4);
        x++
      ) {
        for (
          let z = Math.floor(c.min[2] / 4);
          z <= Math.floor(c.max[2] / 4);
          z++
        ) {
          if (!this.grid.has(x)) this.grid.set(x, new Map());
          const column = this.grid.get(x);
          if (!column.has(z)) column.set(z, []);
          column.get(z).push(index);
        }
      }
    }
  }
  nearby(x, z) {
    const out = this.nearbyBuffer;
    out.length = 0;
    this.queryId = (this.queryId + 1) >>> 0;
    if (this.queryId === 0) {
      this.seen.fill(0);
      this.queryId = 1;
    }
    for (
      let i = Math.floor((x - 0.33) / 4);
      i <= Math.floor((x + 0.33) / 4);
      i++
    )
      for (
        let j = Math.floor((z - 0.33) / 4);
        j <= Math.floor((z + 0.33) / 4);
        j++
      )
        for (const index of this.grid.get(i)?.get(j) || []) {
          if (this.seen[index] !== this.queryId) {
            this.seen[index] = this.queryId;
            out.push(this.colliders[index]);
          }
        }
    return out;
  }
  blockedAt(x, y, z, h) {
    for (const c of this.nearby(x, z))
      if (
        !c.noMove &&
        x + 0.32 > c.min[0] + 0.001 &&
        x - 0.32 < c.max[0] - 0.001 &&
        z + 0.32 > c.min[2] + 0.001 &&
        z - 0.32 < c.max[2] - 0.001 &&
        y + h > c.min[1] + 0.002 &&
        y < c.max[1] - 0.002
      )
        return true;
    return false;
  }
  blocked(p, h) {
    return this.blockedAt(p.x, p.y, p.z, h);
  }
  groundAt(x, z, y, tolerance = .05) {
    let height = -Infinity;
    for (const box of this.nearby(x, z))
      if (!box.noMove && x >= box.min[0] && x <= box.max[0] && z >= box.min[2] && z <= box.max[2] && box.max[1] <= y + tolerance)
        height = Math.max(height, box.max[1]);
    return height;
  }
  // Cosmetic bullet traces use the same 4 m broadphase as movement/server rays,
  // never a triangle raycast over the imported map's million vertices.
  raycast(origin, dir, limit = 140) {
    let hit = null;
    this.queryId = (this.queryId + 1) >>> 0;
    if (!this.queryId) { this.seen.fill(0); this.queryId = 1; }
    let x = Math.floor(origin.x / 4), z = Math.floor(origin.z / 4), travelled = 0;
    const sx = Math.sign(dir.x), sz = Math.sign(dir.z);
    const dx = sx ? Math.abs(4 / dir.x) : Infinity, dz = sz ? Math.abs(4 / dir.z) : Infinity;
    let tx = sx ? ((x + (sx > 0 ? 1 : 0)) * 4 - origin.x) / dir.x : Infinity;
    let tz = sz ? ((z + (sz > 0 ? 1 : 0)) * 4 - origin.z) / dir.z : Infinity;
    while (travelled <= limit) {
      for (const index of this.grid.get(x)?.get(z) || []) {
        if (this.seen[index] === this.queryId) continue;
        this.seen[index] = this.queryId;
        const box = this.colliders[index];
        if (box.noRay || box.nativeCol?.off) continue;
        const contact = rayBoxContact(origin, dir, box.min, box.max, limit);
        if (contact && contact.distance < limit) {
          limit = contact.distance;
          hit = { ...contact, surface: box.surf || 'concrete', collider: box };
        }
      }
      if (tx <= tz) { travelled = tx; tx += dx; x += sx; }
      else { travelled = tz; tz += dz; z += sz; }
    }
    return hit;
  }
  move(m, input, movement) {
    let stepped = 0;
    const crouch = !!(input.buttons & CROUCH),
      slideInput = !!(input.buttons & SLIDE),
      slidePressed = (slideInput && !m.slideHeld) || (crouch && !m.crouchHeld),
      wasCrouched = m.crouch,
      preSlideSpeed = Math.hypot(m.vx, m.vz),
      wantsSprint = !!(input.buttons & SPRINT) && !(input.buttons & ADS) &&
        Math.hypot(input.forward, input.right) > 0.01;
    m.slideHeld = slideInput;
    m.crouchHeld = crouch;
    m.slideCooldown = Math.max(0, m.slideCooldown - STEP);
    if ((slidePressed || slideInput) && wantsSprint && !m.sliding && !wasCrouched && m.ground &&
        preSlideSpeed > 5.2 && m.slideCooldown <= 0) {
      m.sliding = true;
      m.slideTime = 0;
      m.crouch = false;
      m.slideX = m.vx / preSlideSpeed;
      m.slideZ = m.vz / preSlideSpeed;
      const boosted = clamp(preSlideSpeed * 1.3, 8.6, 11);
      m.vx = m.slideX * boosted;
      m.vz = m.slideZ * boosted;
    }
    const sliding = m.sliding;
    let height = 1.8;
    if (sliding) {
      m.crouch = false;
      height = 0.95;
      m.slideTime += STEP;
      const speed = Math.max(0, Math.hypot(m.vx, m.vz) * Math.exp(-0.75 * STEP) -
        (1.2 + m.slideTime * 3.2) * STEP);
      m.vx = m.slideX * speed;
      m.vz = m.slideZ * speed;
    } else {
      const waitingForSlideSpeed = slideInput && wantsSprint && !wasCrouched;
      if (crouch && !waitingForSlideSpeed) m.crouch = true;
      else if (!this.blocked(m, 1.8)) m.crouch = false;
      if (m.crouch) height = 1.2;
      let speed = m.crouch ? 2.7 : wantsSprint && !m.crouch ? 7.5 : 4.6;
      if (input.buttons & ADS) speed *= 0.65 * (movement?.adsMove ?? 1);
      speed *= movement?.mobility ?? 1;
      let f = input.forward,
        r = input.right;
      const len = Math.hypot(f, r);
      if (len > 1) {
        f /= len;
        r /= len;
      }
      const sy = Math.sin(input.yaw),
        cy = Math.cos(input.yaw);
      let ax = (-sy * f + cy * r) * speed - m.vx,
        az = (-cy * f - sy * r) * speed - m.vz;
      const accel = Math.hypot(ax, az);
      if (accel > 36 * STEP) {
        ax *= (36 * STEP) / accel;
        az *= (36 * STEP) / accel;
      }
      m.vx += ax;
      m.vz += az;
    }
    const jump = !!(input.buttons & JUMP);
    if (jump && !m.jumpHeld && m.ground) {
      m.vy = 7;
      m.ground = false;
    }
    m.jumpHeld = jump;
    m.vy -= 22 * STEP;
    for (let axis = 0; axis < 2; axis++) {
      const x = m.x + (axis === 0 ? m.vx * STEP : 0);
      const z = m.z + (axis === 1 ? m.vz * STEP : 0);
      if (!this.blockedAt(x, m.y, z, height)) {
        m.x = x;
        m.z = z;
      } else if (m.ground) {
        // Climb onto the actual tread, rather than launching 42 cm into the
        // air and falling back onto every stair. Keep the same step limit.
        let top = m.y;
        for (const c of this.nearby(x, z))
          if (!c.noMove && x + .32 > c.min[0] + .001 && x - .32 < c.max[0] - .001 &&
              z + .32 > c.min[2] + .001 && z - .32 < c.max[2] - .001 &&
              c.max[1] > top && c.max[1] <= m.y + .42)
            top = c.max[1];
        if (top > m.y && !this.blockedAt(x, top, z, height)) {
          m.x = x;
          stepped += top - m.y;
          m.y = top;
          m.z = z;
        }
      }
    }
    let dy = m.vy * STEP;
    const oldY = m.y;
    m.ground = false;
    for (const c of this.nearby(m.x, m.z)) {
      if (
        c.noMove ||
        m.x + 0.32 <= c.min[0] + 0.001 ||
        m.x - 0.32 >= c.max[0] - 0.001 ||
        m.z + 0.32 <= c.min[2] + 0.001 ||
        m.z - 0.32 >= c.max[2] - 0.001
      )
        continue;
      if (dy <= 0 && oldY >= c.max[1] - 0.02 && oldY + dy <= c.max[1]) {
        dy = Math.max(dy, c.max[1] - oldY);
        m.ground = true;
      }
      if (
        dy > 0 &&
        oldY + height <= c.min[1] + 0.002 &&
        oldY + height + dy >= c.min[1]
      )
        dy = Math.min(dy, c.min[1] - height - oldY);
    }
    m.y += dy;
    if (m.ground || Math.abs(dy - m.vy * STEP) > 0.00001) m.vy = 0;
    if (sliding && (Math.hypot(m.vx, m.vz) < 3.6 || m.slideTime > 1.25 ||
        (m.slideTime > 0.28 && crouch))) {
      m.sliding = false;
      m.slideTime = 0;
      m.slideCooldown = 0.4;
      m.crouch = crouch || this.blocked(m, 1.8);
    }
    m.x = clamp(m.x, this.bounds.minX, this.bounds.maxX);
    m.z = clamp(m.z, this.bounds.minZ, this.bounds.maxZ);
    return stepped;
  }
}

const RAY_AXES = ['x', 'y', 'z'];
export function rayBoxContact(origin, dir, min, max, limit) {
  let near = 0, far = limit, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const o = origin[RAY_AXES[i]], d = dir[RAY_AXES[i]];
    if (Math.abs(d) < 1e-9) { if (o < min[i] || o > max[i]) return null; continue; }
    let a = (min[i] - o) / d, b = (max[i] - o) / d;
    if (a > b) [a, b] = [b, a];
    if (a > near) { near = a; axis = i; sign = d > 0 ? -1 : 1; }
    far = Math.min(far, b);
    if (near > far) return null;
  }
  if (far < 0) return null;
  const normal = { x: 0, y: 0, z: 0 };
  if (axis >= 0) normal[RAY_AXES[axis]] = sign;
  else { normal.x = -dir.x; normal.y = -dir.y; normal.z = -dir.z; }
  return { distance: near, normal };
}
