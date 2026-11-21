// Procedural water purifier (pot over a little fire tray) and palm-planter
// growth stages. Callers pass THREE in as T.
import { mergeChildMeshes } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

// Built once per THREE; createPurifier() returns a clone sharing geometries and materials
// (userData.shared: the engine's disposeGeometry() skips them). The ember and steam materials are
// shared too: paintPurifier() drives them from the elapsed time and the part index alone, so every
// busy purifier would write the same values (idle ones hide those parts).
const TEMPLATES = new WeakMap();
export function createPurifier(T) {
  let tpl = TEMPLATES.get(T);
  if (!tpl) {
    tpl = buildPurifier(T);
    tpl.traverse(o => { if (o.isMesh) { o.geometry.userData.shared = true; o.material.userData.shared = true; } });
    TEMPLATES.set(T, tpl);
  }
  const g = tpl.clone(true);
  paintPurifier(g, null, 0);
  return g;
}

function buildPurifier(T) {
  const g = new T.Group();
  g.name = 'craft_purifier';
  const std = (hex, rough = .8, metal = 0, extra = {}) => new T.MeshStandardMaterial({color:hex, roughness:rough, metalness:metal, ...extra});
  const add = (geo, mat, name, x = 0, y = 0, z = 0, shadow = true, parent = g) => {
    const m = new T.Mesh(geo, mat); m.name = name; m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = shadow; parent.add(m); return m;
  };
  const wood = () => std(0x9c7649, .9), steel = () => std(0x76838a, .45, .7);

  add(new T.BoxGeometry(.7, .04, .5), wood(), 'purifierBase', 0, .02, 0);
  const legMat = steel();
  for (const deg of [90, 210, 330]) {
    const a = deg * Math.PI / 180;
    add(new T.CylinderGeometry(.022, .022, .42, 8), legMat, 'purifierLegs', Math.cos(a) * .2, .23, Math.sin(a) * .2);
  }
  const ring = add(new T.TorusGeometry(.2, .018, 8, 28), steel(), 'purifierRing', 0, .44, 0); ring.rotation.x = Math.PI / 2;
  add(new T.CylinderGeometry(.17, .17, .04, 20), std(0x3b3430, .95), 'fireTray', 0, .1, 0);
  const embers = new T.Group(); embers.name = 'embers'; g.add(embers);
  const emberGeo = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26, r = i ? .085 : 0;
    emberGeo.push(new T.IcosahedronGeometry(.035, 0).translate(Math.cos(a) * r, .135, Math.sin(a) * r));
  }
  add(mergeGeo(T, emberGeo), std(0x5a2a14, .7, 0, {emissive:0xff7a2a, emissiveIntensity:.8}), 'emberHeap', 0, 0, 0, false, embers).receiveShadow = true;
  add(new T.CylinderGeometry(.2, .17, .22, 24, 1, true), std(0xb87333, .4, .6, {side:T.DoubleSide}), 'pot', 0, .55, 0);
  const pw = add(new T.CircleGeometry(.185, 24), std(0x5f8fa0, .2), 'potWater', 0, .62, 0, false); pw.rotation.x = -Math.PI / 2; pw.receiveShadow = true;
  const curve = new T.QuadraticBezierCurve3(new T.Vector3(.14, .66, 0), new T.Vector3(.32, .78, 0), new T.Vector3(.42, .42, 0));
  add(new T.TubeGeometry(curve, 16, .018, 8, false), steel(), 'spout');
  add(new T.BoxGeometry(.18, .03, .18), wood(), 'shelf', .42, .3, 0);
  add(new T.CylinderGeometry(.012, .012, .27, 6), steel(), 'shelfRod', .42, .155, 0);
  add(new T.CylinderGeometry(.06, .05, .1, 16, 1, true), std(0xe8e2d0, .6, 0, {side:T.DoubleSide}), 'cup', .42, .365, 0);
  const cw = add(new T.CircleGeometry(.055, 16), std(0x9ad7f0, .15, 0, {emissive:0x2a6f8a, emissiveIntensity:.3}), 'cupWater', .42, .41, 0, false); cw.rotation.x = -Math.PI / 2; cw.receiveShadow = true;
  for (let i = 0; i < 3; i++) {
    const s = add(new T.SphereGeometry(.05, 10, 8), new T.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:.4, depthWrite:false}), 'steam' + i, 0, .7, 0, false);
    s.visible = false;
  }
  // merge the static parts: timber + fire tray, and every metal part into the (double-sided) copper pot's class
  const merge = (names, name, opts) => {
    const set = new Set(g.children.filter(c => names.includes(c.name)));
    const mat = std(0xffffff, opts.rough, opts.metal || 0, {vertexColors:true, ...(opts.extra || {})});
    for (const m of set) if (m.geometry.attributes.uv) m.geometry.deleteAttribute('uv');
    const [m] = mergeChildMeshes(T, g, {colorize:true, skip: c => !set.has(c), material: () => mat});
    m.name = name;
    for (const c of set) { c.geometry.dispose(); c.material.dispose(); }
  };
  merge(['purifierBase', 'shelf', 'fireTray'], 'purifierBase', {rough:.91});
  merge(['purifierLegs', 'purifierRing', 'spout', 'shelfRod', 'pot'], 'purifierMetal', {rough:.43, metal:.64, extra:{side:T.DoubleSide}});
  g.userData.craftType = 'purifier';
  g.userData.height = .78;
  return g;
}

function mergeGeo(T, list) {
  const out = new T.BufferGeometry();
  for (const n of ['position', 'normal']) {
    const arr = new Float32Array(list.reduce((k, x) => k + x.attributes[n].array.length, 0));
    let o = 0; for (const x of list) { arr.set(x.attributes[n].array, o); o += x.attributes[n].array.length; }
    out.setAttribute(n, new T.BufferAttribute(arr, 3));
  }
  for (const x of list) x.dispose();
  out.computeBoundingSphere();
  return out;
}

export function paintPurifier(g, entry, elapsed) {
  const ud = g.userData, sig = entry ? (entry.ready ? 'r' : 'b') : 'e';
  if (!ud.parts) {
    const get = n => g.getObjectByName(n);
    ud.parts = {embers:get('embers'), potWater:get('potWater'), cup:get('cup'), cupWater:get('cupWater'), steam:[0, 1, 2].map(i => get('steam' + i))};
  }
  const p = ud.parts;
  if (ud.sig !== sig) {
    ud.sig = sig;
    const busy = sig === 'b';
    p.embers.visible = busy;
    p.potWater.visible = sig !== 'e';
    p.cup.visible = sig !== 'e';
    p.cupWater.visible = sig === 'r';
    for (const s of p.steam) s.visible = busy;
  }
  if (sig !== 'b') return;
  p.embers.children.forEach((m, i) => { m.material.emissiveIntensity = .8 + .4 * Math.sin(elapsed * 9 + i); });
  p.steam.forEach((s, i) => {
    const ph = (((elapsed * .45 + i / 3) % 1) + 1) % 1;
    s.position.set(Math.sin(ph * 6 + i) * .04, .7 + ph * .5, 0);
    s.material.opacity = .45 * (1 - ph);
  });
}

const PLANT_PARTS = ['trunk', 'crown', 'coconuts', 'fronds', 'frondRibs'];

export function preparePlanter(T, g) {
  if (!g || g.getObjectByName('plantPivot')) return;
  const parts = PLANT_PARTS.map(n => g.getObjectByName(n)).filter(Boolean);
  if (!parts.length) return;
  const pivot = new T.Group(); pivot.name = 'plantPivot'; pivot.position.set(0, .49, 0);
  g.add(pivot);
  for (const m of parts) { m.position.y -= .49; pivot.add(m); }
}

export function paintPlanter(g, stage, wet) {
  const sig = `${stage}|${wet}`;
  if (g.userData.sig === sig) return;
  g.userData.sig = sig;
  const pivot = g.getObjectByName('plantPivot');
  if (pivot) pivot.scale.setScalar(stage === 2 ? 1 : stage === 1 ? .85 : .7);
  const nuts = g.getObjectByName('coconuts');
  if (nuts) nuts.visible = stage === 2;
  const soil = g.getObjectByName('soil');
  if (soil?.material?.color) soil.material.color.set(wet ? 0x2e1f14 : 0x4a3322);
}
