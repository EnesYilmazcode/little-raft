// Map Table model: a small driftwood chart table with an open chart, a rolled chart and a brass pin cup.
// Geometries and materials are built once per THREE instance and shared by every table (marked
// userData.shared and a no-op dispose(), so rebuildRaft() and the ghost preview cannot free them). Origin = centre of the tile top
// (game.js places decor at y = .22). Footprint ~1.1 x 0.8, ~0.85 tall, 7 meshes.
const cache = new WeakMap();
const TOP_Y = 0.82; // centre height of the 6 cm table top

function shared(T) {
  let s = cache.get(T);
  if (s) return s;
  const noop = () => {};
  const mark = o => { o.userData.shared = true; o.dispose = noop; return o; }; // shared: rebuildRaft / ghost must not free them
  const mat = (color, rough = .85, metal = 0) => mark(new T.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  const legH = TOP_Y - .03;
  const legs = [];
  for (const [x, z] of [[-.46, -.31], [.46, -.31], [-.46, .31], [.46, .31]]) {
    const g = new T.BoxGeometry(.07, legH, .07); g.translate(x, legH / 2, z); legs.push(g);
  }
  // Merge the four legs by hand (same attribute layout), plus a low stretcher bar between them.
  const bar = new T.BoxGeometry(.86, .04, .04); bar.translate(0, .22, 0); legs.push(bar);
  const legGeo = mergeBoxes(T, legs);
  const top = new T.BoxGeometry(1.1, .06, .8); top.translate(0, TOP_Y, 0);
  const sheet = new T.BoxGeometry(.8, .01, .55); sheet.translate(-.05, TOP_Y + .035, 0);
  const inkA = new T.BoxGeometry(.5, .004, .012); inkA.rotateY(.5); inkA.translate(-.08, TOP_Y + .042, .02);
  const inkB = new T.BoxGeometry(.012, .004, .22); inkB.translate(.14, TOP_Y + .042, -.08);
  const roll = new T.CylinderGeometry(.045, .045, .6, 14); roll.rotateX(Math.PI / 2); roll.translate(.44, TOP_Y + .075, .02);
  const cup = new T.CylinderGeometry(.05, .045, .07, 14); cup.translate(.42, TOP_Y + .065, -.3);
  for (const g of [legGeo, top, sheet, inkA, inkB, roll, cup]) mark(g);
  s = {
    legGeo, top, sheet, inkA, inkB, roll, cup,
    wood: mat('#a27a4f'), legWood: mat('#8c6640'), paper: mat('#efe0bb', .95), ink: mat('#6b4e2e', .9),
    rolled: mat('#e8d6a8', .95), brass: mat('#c58b3b', .45, .55),
  };
  cache.set(T, s);
  return s;
}

function mergeBoxes(T, list) {
  let n = 0, ni = 0;
  for (const g of list) { n += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = new Uint16Array(ni);
  let o = 0, oi = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    const src = g.index.array; for (let k = 0; k < src.length; k++) idx[oi + k] = src[k] + o;
    o += g.attributes.position.count; oi += src.length; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setIndex(new T.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** A new map table Group (cheap: meshes only, shared geometry and materials). */
export function createMapTableModel(T) {
  const s = shared(T);
  const g = new T.Group(); g.name = 'maptable';
  const add = (geo, m, shadow) => { const x = new T.Mesh(geo, m); x.castShadow = !!shadow; x.receiveShadow = true; g.add(x); return x; };
  add(s.top, s.wood, true); add(s.legGeo, s.legWood, true); add(s.sheet, s.paper); add(s.inkA, s.ink); add(s.inkB, s.ink);
  add(s.roll, s.rolled, true); add(s.cup, s.brass, true);
  g.userData.craftType = 'maptable'; g.userData.height = .9;
  return g;
}
