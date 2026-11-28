const smooth = (start, end, time) => {
  const k = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return k * k * (3 - 2 * k);
};

// Stage world magnification so lifting the heavy rifle from hip does not surge
// the background before the ocular aligns with the eye, then ramp smoothly to
// full optical magnification in lockstep with the scope reticle crossfade.
export function m200EffectiveZoom(baseZoom, adsK) {
  if (!(adsK > 1e-4) || !(baseZoom > 1)) return baseZoom;
  const shoulder = Math.min(baseZoom, 1.24);
  const optical = smooth(.46, .96, adsK);
  const targetMag = 1 + (shoulder - 1) * adsK + Math.max(0, baseZoom - shoulder) * optical;
  return 1 + (targetMag - 1) / adsK;
}

export function prepareM200Gun(gun) {
  const bolt = gun.root.getObjectByName('Bolt');
  const grip = gun.anchors.gripR;
  const gripHome = grip.position.clone();
  const fire = gun.clips.fire;
  const reset = gun.resetPose;
  const boltHome = bolt?.position.clone();
  function resetBolt() {
    if (bolt) {
      bolt.position.copy(boltHome);
      bolt.rotation.z = 0;
    }
    grip.position.copy(gripHome);
  }
  gun.resetPose = () => { reset(); resetBolt(); };
  gun.clips = { ...gun.clips };
  for (const name of ['reload', 'reloadEmpty']) {
    const clip = gun.clips[name];
    const scale = 2.8 / clip.duration;
    gun.clips[name] = {
      ...clip, duration: 2.8,
      events: clip.events.map(event => ({ ...event, t: event.type === 'ammo' ? 2.8 : event.t * scale })),
      apply: (time, pose) => { resetBolt(); clip.apply(time / scale, pose); },
    };
  }
  gun.clips.fire = {
    ...fire, duration: 1.25,
    apply(time, pose) {
      fire.apply(Math.min(time, fire.duration), pose);
      const lift = smooth(.14, .27, time) * (1 - smooth(.94, 1.08, time));
      const pull = smooth(.27, .46, time) * (1 - smooth(.69, .94, time));
      const hand = smooth(.09, .23, time) * (1 - smooth(1.02, 1.23, time));
      if (bolt) {
        bolt.position.copy(boltHome);
        bolt.position.z += .075 * pull;
        bolt.rotation.z = .85 * lift;
      }
      grip.position.copy(gripHome);
      grip.position.x += .039 * hand;
      grip.position.y += .055 * hand + .018 * lift;
      grip.position.z += .025 * hand + .075 * pull;
    },
  };
}

export function installM200Handling({ debug: { arsenal, ctx } }) {
  const fire = arsenal._fire;
  const eject = arsenal._eject;
  const update = arsenal.update;
  const reset = arsenal.reset;
  const reload = arsenal.startReload;
  let shot = null;
  let queuedReload = null;
  arsenal.reset = function (...args) { shot = queuedReload = null; return reset.apply(this, args); };
  arsenal.startReload = function () {
    if (this.def.id === 'm200' && this.sinceFire < 1.25) { queuedReload = this.slot; return; }
    queuedReload = null;
    return reload.call(this);
  };
  arsenal._eject = function () {
    if (this.def.id === 'm200' && this.sinceFire < .01) return;
    return eject.call(this);
  };
  arsenal._fire = function (slot, def, ads) {
    fire.call(this, slot, def, ads);
    queuedReload = null;
    shot = def.id === 'm200' ? { slot, ejected: false, closed: false, rescoped: false } : null;
  };
  arsenal.update = function (dt) {
    const previousADS = this.ads;
    if (shot && !shot.rescoped && this.sinceFire + dt >= 1.04 && this.ads <= 2e-4) {
      shot.rescoped = true;
      this.ads = 0;
    }
    update.call(this, dt);
    if (this.def?.id === 'm200' && Number.isFinite(this.def.zoom) && Number.isFinite(ctx.player?.adsK)) {
      ctx.player.zoom = m200EffectiveZoom(this.def.zoom, ctx.player.adsK);
    }
    if (!shot) return;
    if (this.slot !== shot.slot || this.state === 'holster' || !ctx.player.alive) { shot = queuedReload = null; return; }
    if (!shot.ejected && this.sinceFire >= .32) {
      shot.ejected = true;
      eject.call(this);
      ctx.audio.reload('m200', 'pump_back');
    }
    if (!shot.closed && this.sinceFire >= .94) {
      shot.closed = true;
      if (this.state === 'ready') ctx.audio.reload('m200', 'pump_fwd');
    }
    if (this.sinceFire >= .06 && this.sinceFire < 1.04 && this.state === 'ready') {
      const floor = this.adsHeld ? 1e-4 : 0;
      this.ads = Math.max(floor, previousADS - dt * 1.35 / this.def.adsTime);
      ctx.player.adsK = this.ads * this.ads * (3 - 2 * this.ads);
      if (Number.isFinite(this.def.zoom)) ctx.player.zoom = m200EffectiveZoom(this.def.zoom, ctx.player.adsK);
    }
    if (queuedReload === this.slot && this.sinceFire >= 1.25 && this.state === 'ready') this.startReload();
  };
}
