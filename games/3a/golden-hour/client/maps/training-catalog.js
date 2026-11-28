import { validSceneDescriptor, validateMapData } from '../catalog.js';

const base = new URL('../../assets/maps/', import.meta.url);
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

async function readJSON(url, signal, fetcher) {
  const response = await fetcher(url, { credentials: 'omit', signal });
  if (!response.ok) throw Error('无法读取单人训练地图资源。');
  return response.json();
}

export async function loadTrainingCatalog(fetcher = fetch) {
  const signal = AbortSignal.timeout(8000);
  const registry = await readJSON(new URL('catalog.json', base), signal, fetcher);
  if (registry.schema !== 1 || !Array.isArray(registry.maps) || !registry.maps.length ||
      new Set(registry.maps.map(map => map?.id)).size !== registry.maps.length ||
      !registry.maps.every(map => ID.test(map?.id) && VERSION.test(map.version)))
    throw Error('单人训练地图目录无效。');
  const maps = await Promise.all(registry.maps.map(async ({ id, version }) => {
    const manifest = await readJSON(new URL(id + '/' + version + '/manifest.json', base), signal, fetcher);
    if (manifest.schema !== 1 || manifest.id !== id || manifest.version !== version || !manifest.name ||
        manifest.worldAsset !== 'world.json' || manifest.gameplayAsset !== 'gameplay.json' ||
        !validSceneDescriptor(manifest))
      throw Error('单人训练地图配置无效。');
    return manifest;
  }));
  const available = maps.filter(map => map.training !== false && ['hotel', 'gltf'].includes(map.clientScene));
  if (!available.some(map => map.id === registry.defaultMap)) throw Error('缺少默认训练地图。');
  return { defaultMap: registry.defaultMap, maps: available };
}

export async function loadTrainingMap(map, signal, fetcher = fetch) {
  const folder = new URL(map.id + '/' + map.version + '/', base);
  const [world, gameplay] = await Promise.all([
    readJSON(new URL('world.json', folder), signal, fetcher),
    readJSON(new URL('gameplay.json', folder), signal, fetcher),
  ]);
  const data = validateMapData({ ...world, ...map, mapId: map.id }, map.id, map.version);
  const { minX, maxX, minZ, maxZ } = data.bounds;
  const spawns = gameplay.spawns;
  if (!spawns?.length || ![0, 1].every(team => spawns.some(spawn => spawn?.team === team)) ||
      !spawns.every(spawn => {
        if (!Array.isArray(spawn?.pos) || spawn.pos.length !== 3 || !spawn.pos.every(Number.isFinite)) return false;
        const [x, , z] = spawn.pos;
        return x >= minX && x <= maxX && z >= minZ && z <= maxZ &&
          [0, 1].includes(spawn.team) && (spawn.yaw === undefined || Number.isFinite(spawn.yaw));
      }) || !data.nodes.length)
    throw Error('单人训练地图缺少出生点或导航路线。');
  return { ...data, spawns };
}
