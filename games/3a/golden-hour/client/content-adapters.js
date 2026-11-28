import { prepareGltfScene } from "./maps/gltf-scene.js";
import { prepareMapHud } from "./maps/map-hud.js";
import { prepareTeamHud, teamLobby } from './modes/teams.js';

import { prepareZombies, zombieLobby } from './modes/zombies.js';

const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const mapScenes = new Map();
const modes = new Map();

export function registerMapScene(id, adapter) {
  if (!ID.test(id) || !adapter || typeof adapter.prepare !== "function")
    throw Error("无效的客户端地图适配器。");
  mapScenes.set(id, adapter);
}

export function registerModeAdapter(id, adapter) {
  if (!ID.test(id) || !adapter || typeof adapter.prepare !== "function")
    throw Error("无效的客户端模式适配器。");
  modes.set(id, adapter);
}

export function mapSceneAdapter(id) { return mapScenes.get(id) || null; }
export function modeAdapter(id) { return modes.get(id) || null; }

export function filterClientCatalog(catalog) {
  const supportedModes = catalog.modes.filter((mode) => modes.has(mode.clientAdapter));
  const supportedModeIDs = new Set(supportedModes.map((mode) => mode.id));
  const supportedMaps = catalog.maps.map((map) => ({
    ...map,
    modes: map.modes.filter((modeID) => supportedModeIDs.has(modeID)),
  })).filter((map) => mapSceneAdapter(map.clientScene) && map.modes.length > 0);
  if (!supportedMaps.some((map) => map.id === catalog.defaultMap && map.modes.includes(catalog.defaultMode)))
    throw Error("当前客户端不支持服务器默认地图或模式。");
  return {
    ...catalog,
    maps: supportedMaps,
    modes: supportedModes.filter((mode) => supportedMaps.some((map) => map.modes.includes(mode.id))),
  };
}

registerMapScene("hotel", { async prepare() { return null; } });
registerMapScene("gltf", { async prepare(context) {
  const sceneCleanup = await prepareGltfScene(context);
  try {
    const hudCleanup = prepareMapHud(context);
    return () => { try { hudCleanup(); } finally { sceneCleanup(); } };
  } catch (failure) { sceneCleanup(); throw failure; }
} });
registerModeAdapter("teams", { async prepare(context) { return prepareTeamHud(context); }, lobby: teamLobby });
registerModeAdapter('zombies', { prepare: prepareZombies, lobby: zombieLobby });
