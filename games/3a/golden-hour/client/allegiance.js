// Team IDs belong to the match. Palette IDs belong to the viewer: 0 blue, 1 red.
export const teamPalette = (team, localTeam) => team === localTeam ? 0 : 1;

export function setTeamPerspective(root, team) {
  if (!root) return;
  if (team === 0 || team === 1) {
    const value = String(team);
    if (root.dataset.teamView !== value) root.dataset.teamView = value;
  } else delete root.dataset.teamView;
}

const radarRosters = new WeakMap();
function removeBlip(map, index) {
  const blip = map.blips[index];
  if (!blip) return;
  blip.anim?.cancel();
  blip.ring?.cancel();
  blip.el.remove();
  delete map.blips[index];
}

export function resetTeamRadar(map) {
  if (!Array.isArray(map?.blips)) return;
  for (let i = 0; i < map.blips.length; i++) removeBlip(map, i);
  map.blips.length = 0;
  radarRosters.delete(map);
}

// Native radar caches by array slot. A slot can be reused by another player
// even when its allegiance is unchanged; never inherit the old ping/death state.
export function syncTeamRadar(map, actors) {
  if (!Array.isArray(map?.blips)) return;
  let roster = radarRosters.get(map);
  if (!roster) {
    resetTeamRadar(map);
    radarRosters.set(map, roster = []);
  }
  for (let i = 0; i < Math.max(actors.length, roster.length, map.blips.length); i++) {
    const actor = actors[i], previous = roster[i];
    if (!actor || !previous || actor.id !== previous.id || actor.team !== previous.team) {
      removeBlip(map, i);
      if (actor) roster[i] = { id: actor.id, team: actor.team };
    }
  }
  roster.length = actors.length;
  if (map.blips.length > actors.length) map.blips.length = actors.length;
}
