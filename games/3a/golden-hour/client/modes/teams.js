// Team-mode presentation owns victory rules and labels. Map adapters only
// supply scenery/minimap data; future round/objective modes register their own UI.
export function prepareTeamHud({ engine, room }) {
  const hud = engine.ctx.hud;
  const start = hud.matchStart, board = hud.board;
  const modeName = room.modeName || room.modeId;
  const mapName = room.mapName || room.mapId;
  const menus = hud.menus;
  const buildEnd = menus?.buildEnd;
  const pauseHeading = menus?.pages.pause?.querySelector('.kicker');
  const pauseRule = menus?.pages.pause?.querySelector('#p-board .sech span:last-child');
  const savedLabels = [pauseHeading, pauseRule].map(node => node?.textContent);
  const title = `${modeName} · ${mapName}`;
  if (pauseHeading) pauseHeading.textContent = title;
  if (pauseRule) pauseRule.textContent = room.scoreLimit > 0 ? `先到 ${room.scoreLimit} 分` : '限时团队作战';
  if (buildEnd) menus.buildEnd = function(...args) {
    const result = buildEnd.apply(this, args);
    const heading = this.pages.end.querySelector('.e-k');
    if (heading) heading.textContent = title;
    const performanceTeam = this.pages.end.querySelector('.e-cols > .e-col:nth-child(2) > .sech span:last-child');
    const team = teamLobby(room).find(entry => entry.id === args[1]?.player?.team);
    if (performanceTeam && team) performanceTeam.textContent = team.name;
    return result;
  };
  hud.matchStart = function(...args) {
    const result = start.apply(this, args);
    const intro = this.e.intro;
    intro.querySelector('.i-map').textContent = mapName;
    intro.querySelector('.i-mode').textContent = modeName;
    intro.querySelector('.i-sub').textContent = room.scoreLimit > 0 ? `先到 ${room.scoreLimit} 分` : '限时团队作战';
    return result;
  };
  hud.board = function(...args) {
    const result = board.apply(this, args);
    const label = (args[1] || this.e.board).querySelector('.bd-h span');
    if (label) label.textContent = `${modeName} · ${mapName}`;
    return result;
  };
  return () => {
    hud.matchStart = start; hud.board = board;
    if (buildEnd) menus.buildEnd = buildEnd;
    [pauseHeading, pauseRule].forEach((node, i) => { if (node) node.textContent = savedLabels[i]; });
  };
}

export function teamLobby(room) {
  return Array.from({ length: room.teamCount || 2 }, (_, id) => ({
    id, name: id === 0 ? '先锋' : id === 1 ? '余烬' : `队伍 ${id + 1}`,
    capacity: room.teamSize || Math.floor(room.capacity / (room.teamCount || 2)),
  }));
}
