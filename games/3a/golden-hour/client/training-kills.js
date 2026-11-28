// Observe the native match objects; no timer or bundle patch is needed.
export function installTrainingKills({ gh, account, isOnline, progression }) {
  const { match, player, hud } = gh.debug.ctx;
  const callbacks = hud.menus.cb;
  let active = !isOnline() && ["countdown", "live", "ending"].includes(match.state);
  const streaks = new Map();
  // Installing during a round must not import kills earned before installation.
  let highWater = Number.isSafeInteger(player.kills) && player.kills >= 0 ? player.kills : 0;

  function sample() {
    // Online rendering uses this same player and writes authoritative kills into
    // it. An online native start is preparation, never a training round.
    if (isOnline()) {
      active = false;
      return 0;
    }
    const kills = player.kills;
    if (!active || !Number.isSafeInteger(kills) || kills <= highWater) return 0;
    const delta = kills - highWater;
    highWater = kills;
    // Advance even for an anonymous account: authorization must not backfill.
    account.record("training", delta);
    return delta;
  }

  function flush() {
    try {
      Promise.resolve(account.flush()).catch(() => {});
    } catch {
      // Account state owns synchronization failures; never claim success here.
    }
  }

  const start = match.start;
  match.start = function (...args) {
    sample();
    if (active) flush();
    active = false;
    const result = start.apply(this, args);
    // start resets every actor's counters, then respawns and starts countdown.
    highWater = Number.isSafeInteger(player.kills) && player.kills >= 0 ? player.kills : 0;
    streaks.clear();
    active = !isOnline();
    return result;
  };

  const kill = match._kill;
  match._kill = function (victim, killer, shot, ...args) {
    try {
      const result = kill.call(this, victim, killer, shot, ...args);
      if (active && victim === player) streaks.clear();
      if (active && killer === player && victim !== player) {
        const weapon = shot?.weapon;
        if (["ar", "smg", "shotgun", "pistol", "m200", "rpk"].includes(weapon)) {
          const time = gh.debug.ctx.time?.() ?? 0;
          const previous = streaks.get(weapon);
          const multikill = !!previous && time - previous.lastAt <= 4;
          streaks.set(weapon, { count: multikill ? previous.count + 1 : 1, lastAt: time });
          const distance = victim.pos?.distanceTo?.(player.pos);
          const ads = player.adsK >= .5;
          // The native local match already recorded the weapon kill/headshot
          // inside _kill; persist only the extra contract traits here.
          progression?.challengeKill(weapon, {
            ads,
            hipfire: !ads,
            longshot: Number.isFinite(distance) && distance >= 35,
            multikill,
          });
        }
      }
      return result;
    } finally {
      // Native _kill can synchronously call _end on the final scoring kill.
      // Read only the local actor's counter, never team scores or killfeed.
      sample();
    }
  };

  function wrapSettlement(target, name) {
    const original = target[name];
    target[name] = function (...args) {
      sample();
      const finishing = active;
      try {
        return original.apply(this, args);
      } finally {
        sample();
        if (finishing && active) {
          active = false;
          flush();
        }
      }
    };
  }

  // Native quit marks match idle directly, without an end callback. Normal end
  // reaches hud.matchEnd after the slow-motion ending (which still allows kills).
  wrapSettlement(hud, "matchEnd");
  wrapSettlement(callbacks, "onQuit");
  return { sample };
}
