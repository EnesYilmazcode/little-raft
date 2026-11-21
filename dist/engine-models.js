// Little Motor and Steering Wheel models (see docs/specs/engine.md). THREE is passed in.
// Geometry is built ONCE per kind and shared by every instance; game.js rebuildRaft() disposes the
// children it removes, so the shared geometry dispose() is a no-op and the module's dispose() frees it.
// Materials come from mat(color) (game.js material cache, never disposed by rebuildRaft).
// Local origin = centre of the floor tile top (game.js places decor at y = .22).

const noop = () => {};
function shared(T, geos) {
  const real = T.BufferGeometry.prototype.dispose;
  for (const g of Object.values(geos)) g.dispose = noop;
  return () => { for (const g of Object.values(geos)) real.call(g); };
}

/** Motor: grey scrap housing on a wood plinth, exhaust stack, and a propeller fan at the back (+z). */
export function buildMotor(T, mat) {
  const G = {
    plinth: new T.BoxGeometry(.8, .08, .6), housing: new T.BoxGeometry(.7, .5, .5), cap: new T.BoxGeometry(.5, .06, .36),
    exhaust: new T.CylinderGeometry(.05, .05, .35, 8), shaft: new T.BoxGeometry(.07, .07, .3), blade: new T.BoxGeometry(.5, .09, .03),
  };
  const disposeAll = shared(T, G);
  const mesh = (geo, color, x, y, z, parent) => { const m = new T.Mesh(geo, mat(color)); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  return {
    instance() {
      const g = new T.Group(); g.name = 'craft_motor';
      mesh(G.plinth, '#906f48', 0, .04, 0, g);
      const housing = mesh(G.housing, '#6f7f86', 0, .33, 0, g); housing.name = 'engineHousing';
      mesh(G.cap, '#59666c', 0, .03 + .25, 0, housing); // lid, rides the housing bob
      mesh(G.exhaust, '#3b3f42', -.2, .25 + .175, -.1, housing);
      mesh(G.shaft, '#3b3f42', 0, .3, .4, g);
      const prop = new T.Group(); prop.name = 'engineProp'; prop.position.set(0, .3, .56); g.add(prop);
      mesh(G.blade, '#d9b25a', 0, 0, 0, prop);
      mesh(G.blade, '#d9b25a', 0, 0, 0, prop).rotation.z = Math.PI / 2;
      g.userData.engine = 'motor'; g.userData.craftType = 'motor'; g.userData.height = .7;
      return g;
    },
    dispose: disposeAll,
  };
}

/** Wheel: a post with a spoked ring facing +-z at y .83 (about 1.05 above the water line with the .22 deck). */
export function buildWheel(T, mat) {
  const RY = .83;
  const G = {
    post: new T.CylinderGeometry(.07, .09, RY, 8), ring: new T.TorusGeometry(.38, .04, 8, 24), hub: new T.CylinderGeometry(.07, .07, .12, 10).rotateX(Math.PI / 2),
    spoke: new T.BoxGeometry(.74, .04, .03), knob: new T.CylinderGeometry(.03, .03, .14, 6), base: new T.BoxGeometry(.4, .06, .4),
  };
  const disposeAll = shared(T, G);
  const mesh = (geo, color, x, y, z, parent) => { const m = new T.Mesh(geo, mat(color)); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  return {
    instance() {
      const g = new T.Group(); g.name = 'craft_wheel';
      mesh(G.base, '#906f48', 0, .03, 0, g);
      mesh(G.post, '#906f48', 0, RY / 2, 0, g);
      const w = new T.Group(); w.name = 'engineWheel'; w.position.set(0, RY, .1); g.add(w);
      mesh(G.ring, '#b4824b', 0, 0, 0, w);
      mesh(G.hub, '#725942', 0, 0, 0, w);
      mesh(G.spoke, '#b4824b', 0, 0, 0, w);
      mesh(G.spoke, '#b4824b', 0, 0, 0, w).rotation.z = Math.PI / 2;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, k = mesh(G.knob, '#725942', Math.cos(a) * .45, Math.sin(a) * .45, 0, w); k.rotation.z = a - Math.PI / 2; }
      g.userData.engine = 'wheel'; g.userData.craftType = 'wheel'; g.userData.height = 1.3;
      return g;
    },
    dispose: disposeAll,
  };
}
