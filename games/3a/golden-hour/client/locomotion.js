import { clamp } from "./simulation.js";

// Match the native player's camera/viewmodel contract in dist/game.js (Fw).
// The multiplayer movement speed and authority remain in the simulation.
const NATIVE_SPRINT_SPEED = 6.9;
export function updateLocomotion(p, dt, ars, { sprint, wasGrounded, previousVY }) {
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  p.speed = Math.hypot(p.vel.x, p.vel.z);
  p.moveX = (p.vel.x * cy - p.vel.z * sy) / NATIVE_SPRINT_SPEED;
  p.moveZ = (-p.vel.x * sy - p.vel.z * cy) / NATIVE_SPRINT_SPEED;
  const wasSprinting = p.sprinting;
  p.inWater = p.ctx.hotel.inPool(p.e.x, p.e.z) && p.e.y < p.ctx.hotel.pool.water - 0.25;
  p.sprinting = !!sprint && p.speed > 0.6 && p.stance === "stand" &&
    !ars?.blocksSprint() && p.adsK < 0.3 && !p.inWater;
  if (p.sprinting && !wasSprinting) p.ev.sprint++;
  if (!p.sprinting && wasSprinting) p.ev.sprintEnd++;
  p.sprintTime = p.sprinting ? p.sprintTime + dt : 0;
  if (wasGrounded && !p.e.onGround && p.vel.y > 0) {
    p.ev.jump++;
    p.landVel += 0.7;
    p.kickPitch -= 0.006;
    p.ctx.audio.jump();
  }
  if (!wasGrounded && p.e.onGround) p._land(Math.max(0, -previousVY));
  p.airTime = p.e.onGround ? 0 : p.airTime + dt;
  if (dt > 0) {
    const ax = clamp((p.vel.x - p.pvx) / dt, -70, 70);
    const az = clamp((p.vel.z - p.pvz) / dt, -70, 70);
    const blend = 1 - Math.exp(-16 * dt);
    p.accR += (ax * cy - az * sy - p.accR) * blend;
    p.accF += (-ax * sy - az * cy - p.accF) * blend;
    p.pvx = p.vel.x;
    p.pvz = p.vel.z;
  }
  if (!p.e.onGround) return;
  if (p.speed > 0.6) {
    const before = p.stepPhase;
    p.stepPhase += (1.75 + 0.27 * p.speed) * dt;
    if (Math.floor(p.stepPhase) !== Math.floor(before))
      p._footfall(p.sprinting ? 1 : p.stance !== "stand" ? 0.45 : 0.68, true);
  } else {
    const fraction = p.stepPhase - Math.floor(p.stepPhase);
    if (fraction > 0.02) {
      p.stepPhase = Math.min(Math.ceil(p.stepPhase), p.stepPhase + 3.4 * dt);
      if (p.stepPhase === Math.ceil(p.stepPhase) && fraction > 0.3 && p.bobAmt > 0.25)
        p._footfall(0.4, false);
    }
  }
}
