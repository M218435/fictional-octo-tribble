// Asset ownership, independent of map IDs and gameplay modes. A map adapter
// can replace scenery without changing the visibility of actors or effects.
export class SceneLayers {
  constructor(scene) { this.scene = scene; this.owners = new Map(); }
  share(...objects) {
    for (let object of objects) {
      if (!object) continue;
      while (object.parent && object.parent !== this.scene) object = object.parent;
      if (object !== this.scene && this.scene.children.includes(object)) this.owners.set(object, 'shared');
    }
    return this;
  }
  captureMap() {
    for (const object of this.scene.children)
      if (!this.owners.has(object)) this.owners.set(object, 'map');
    return this;
  }
  forget(object) { this.owners.delete(object); }
  hideMap() {
    const { scene } = this;
    const saved = [...this.owners].filter(([, owner]) => owner === 'map').map(([object]) => [object, object.visible]);
    const previous = scene.ghHiddenMapRoots;
    scene.ghHiddenMapRoots = new Set(saved.map(([object]) => object));
    const enforce = () => { for (const [object] of saved) object.visible = false; };
    const show = () => { for (const [object, visible] of saved) object.visible = visible; };
    enforce();
    let restored = false;
    return { enforce, show, restore() {
      if (restored) return;
      restored = true;
      show();
      scene.ghHiddenMapRoots = previous;
    } };
  }
}

export function nativeSceneLayers(debug) {
  const layers = new SceneLayers(debug.gfx.scene), body = debug.fpbody, fx = debug.fx;
  layers.share(debug.gfx.camera, body?.op?.root, body?.view, body?.rest, body?.pud,
    debug.vm?.laserDot,
    fx?.p?.mesh, fx?.distort?.mesh, fx?.decals?.mesh, ...(fx?.lights || []).map(entry => entry.l));
  for (const bot of debug.match.bots)
    for (const rig of bot.rigs) layers.share(rig.root);
  for (const rig of debug.match.k9?.rigs?.() || []) layers.share(rig.root);
  return layers.captureMap();
}
