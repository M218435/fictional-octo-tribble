import { apiOrigin } from "./api-config.js";
import { validGlass, glassCollider } from './glass.js';

const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validSceneDescriptor(map) {
  if (map.clientScene !== 'gltf' && !map.sceneAsset) return true;
  const env = map.environment;
  return map.sceneAsset === `assets/maps/${map.mapId || map.id}/${map.version}/scene.glb` &&
    /^[0-9a-f]{64}$/.test(map.sceneSHA256 || '') && Number.isInteger(map.sceneBytes) && map.sceneBytes >= 20 && map.sceneBytes <= 64 * 1024 * 1024 &&
    !!env && /^[0-9a-f]{6}$/i.test(env.background || '') && /^[0-9a-f]{6}$/i.test(env.fogColor || '') &&
    Number.isFinite(env.fogDensity) && env.fogDensity >= 0 && env.fogDensity <= 1;
}

function validateCatalog(value) {
  if (!value || !ID.test(value.defaultMap || "") || !ID.test(value.defaultMode || "") ||
      !Array.isArray(value.maps) || !Array.isArray(value.modes))
    throw Error("服务器地图与模式目录无效。");
  const maps = value.maps.filter((map) => map && ID.test(map.id || "") &&
    typeof map.name === "string" && map.name && VERSION.test(map.version || '') && validSceneDescriptor(map) &&
    typeof map.clientScene === "string" && ID.test(map.clientScene) && Array.isArray(map.modes) &&
    map.modes.length > 0 && map.modes.every((modeId) => ID.test(modeId)));
  const modes = value.modes.filter((mode) => mode && ID.test(mode.id || "") &&
    typeof mode.name === "string" && mode.name && typeof mode.clientAdapter === "string" &&
    ID.test(mode.clientAdapter));
  if (maps.length !== value.maps.length || modes.length !== value.modes.length ||
      !maps.some((map) => map.id === value.defaultMap && map.modes.includes(value.defaultMode)) ||
      !modes.some((mode) => mode.id === value.defaultMode))
    throw Error("服务器地图与模式目录不完整。");
  return { defaultMap: value.defaultMap, defaultMode: value.defaultMode, maps, modes };
}

export async function loadCatalog(origin, pageURL, fetcher = globalThis.fetch) {
  const approved = apiOrigin(origin, pageURL);
  if (typeof fetcher !== "function") throw Error("当前浏览器无法读取地图目录。");
  const response = await fetcher(new URL("/api/catalog", approved), {
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw Error("地图目录暂不可用。");
  return validateCatalog(await response.json());
}

function vector3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

export function validateMapData(value, mapId, version) {
  const bounds = value?.bounds;
  if (!value || value.mapId !== mapId || value.version !== version || !ID.test(mapId) || !VERSION.test(version) || !validSceneDescriptor(value) ||
      !bounds || ![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite) ||
      bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ ||
      !Array.isArray(value.colliders) || value.colliders.length === 0 || value.colliders.length > 20000 ||
      !value.colliders.every((collider) => collider && vector3(collider.min) && vector3(collider.max) &&
        collider.min.every((entry, axis) => entry <= collider.max[axis] && Math.abs(entry) <= 10000 && Math.abs(collider.max[axis]) <= 10000) &&
        typeof collider.noMove === "boolean" && typeof collider.noRay === "boolean") ||
      !validGlass(value.glass ?? []) || !Array.isArray(value.nodes) || value.nodes.length > 10000)
    throw Error("地图碰撞数据无效。");
  const geometry = [...value.colliders, ...(value.glass || []).map(glassCollider)];
  const gridCells = geometry.reduce((sum, box) => sum + (Math.floor(box.max[0] / 4) - Math.floor(box.min[0] / 4) + 1) * (Math.floor(box.max[2] / 4) - Math.floor(box.min[2] / 4) + 1), 0);
  if (gridCells > 1000000) throw Error('地图碰撞网格超过资源预算。');
  if (!value.nodes.every((node, index) => node && vector3(node.pos) && Array.isArray(node.links) &&
      node.links.every((link) => Number.isInteger(link) && link >= 0 && link < value.nodes.length && link !== index)))
    throw Error("地图导航数据无效。");
  return { ...value, bounds };
}

export async function loadMapData(origin, pageURL, mapId, version, fetcher = globalThis.fetch) {
  const approved = apiOrigin(origin, pageURL);
  if (typeof fetcher !== "function" || !ID.test(mapId || "") || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version || ""))
    throw Error("地图资源地址无效。");
  const url = new URL(`/api/maps/${mapId}`, approved);
  url.searchParams.set("v", version);
  const response = await fetcher(url, { credentials: "omit", cache: "force-cache", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Error("地图碰撞数据暂不可用。");
  return validateMapData(await response.json(), mapId, version);
}

export { validateCatalog };
