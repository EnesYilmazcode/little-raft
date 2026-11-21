// Procedural water purifier (pot over a little fire tray) and palm-planter
// growth stages. Imports nothing: callers pass THREE in as T.

export function createPurifier(T) {
  const g = new T.Group();
  g.name = 'craft_purifier';
  const std = (hex, rough = .8, metal = 0, extra = {}) => new T.MeshStandardMaterial({color:hex, roughness:rough, metalness:metal, ...extra});
  const add = (geo, mat, name, x = 0, y = 0, z = 0, shadow = true) => {
    const m = new T.Mesh(geo, mat); m.name = name; m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = shadow; g.add(m); return m;
  };
  const wood = () => std(0x9c7649, .9), steel = () => std(0x76838a, .45, .7);

  add(new T.BoxGeometry(.7, .04, .5), wood(), 'purifierBase', 0, .02, 0);
  const legs = new T.Group(); legs.name = 'purifierLegs'; g.add(legs);
  const legMat = steel();
  for (const deg of [90, 210, 330]) {
    const a = deg * Math.PI / 180, m = new T.Mesh(new T.CylinderGeometry(.022, .022, .42, 8), legMat);
    m.position.set(Math.cos(a) * .2, .23, Math.sin(a) * .2); m.castShadow = m.receiveShadow = true; legs.add(m);
  }
  const ring = add(new T.TorusGeometry(.2, .018, 8, 28), steel(), 'purifierRing', 0, .44, 0); ring.rotation.x = Math.PI / 2;
  add(new T.CylinderGeometry(.17, .17, .04, 20), std(0x3b3430, .95), 'fireTray', 0, .1, 0);
  const embers = new T.Group(); embers.name = 'embers'; g.add(embers);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26, r = i ? .085 : 0;
    const m = new T.Mesh(new T.IcosahedronGeometry(.035, 0), std(0x5a2a14, .7, 0, {emissive:0xff7a2a, emissiveIntensity:.8}));
    m.position.set(Math.cos(a) * r, .135, Math.sin(a) * r); m.castShadow = m.receiveShadow = true; embers.add(m);
  }
  // Fuel: up to 3 little planks in the tray (one per 50 s of fire) and a flame that shows only while lit.
  const logs = new T.Group(); logs.name = 'fuelLogs'; g.add(logs);
  const logMat = std(0x7a5a36, .9);
  for (let i = 0; i < 3; i++) {
    const m = new T.Mesh(new T.BoxGeometry(.26, .03, .045), logMat);
    m.position.set(0, .135 + i * .03, (i - 1) * .05); m.rotation.y = i * 1.05; m.castShadow = m.receiveShadow = true; logs.add(m);
  }
  const flame = new T.Group(); flame.name = 'flame'; flame.position.set(0, .15, 0); g.add(flame);
  const flameMats = [new T.MeshBasicMaterial({color:0xff8a2a, transparent:true, opacity:.85, depthWrite:false}), new T.MeshBasicMaterial({color:0xffd060, transparent:true, opacity:.9, depthWrite:false})];
  for (let i = 0; i < 2; i++) {
    const m = new T.Mesh(new T.ConeGeometry(i ? .055 : .1, i ? .16 : .24, 10, 1, true), flameMats[i]);
    m.name = 'flame' + i; m.position.y = i ? .08 : .12; m.castShadow = m.receiveShadow = false; flame.add(m);
  }
  add(new T.CylinderGeometry(.2, .17, .22, 24, 1, true), std(0xb87333, .4, .6, {side:T.DoubleSide}), 'pot', 0, .55, 0);
  const pw = add(new T.CircleGeometry(.185, 24), std(0x5f8fa0, .2), 'potWater', 0, .62, 0); pw.rotation.x = -Math.PI / 2;
  const curve = new T.QuadraticBezierCurve3(new T.Vector3(.14, .66, 0), new T.Vector3(.32, .78, 0), new T.Vector3(.42, .42, 0));
  add(new T.TubeGeometry(curve, 16, .018, 8, false), steel(), 'spout');
  add(new T.BoxGeometry(.18, .03, .18), wood(), 'shelf', .42, .3, 0);
  add(new T.CylinderGeometry(.012, .012, .27, 6), steel(), 'shelfRod', .42, .155, 0);
  add(new T.CylinderGeometry(.06, .05, .1, 16, 1, true), std(0xe8e2d0, .6, 0, {side:T.DoubleSide}), 'cup', .42, .365, 0);
  const cw = add(new T.CircleGeometry(.055, 16), std(0x9ad7f0, .15, 0, {emissive:0x2a6f8a, emissiveIntensity:.3}), 'cupWater', .42, .41, 0); cw.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const s = add(new T.SphereGeometry(.05, 10, 8), new T.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:.4, depthWrite:false}), 'steam' + i, 0, .7, 0, false);
    s.visible = false;
  }
  g.userData.craftType = 'purifier';
  g.userData.height = .78;
  paintPurifier(g, null, 0);
  return g;
}

/** entry: a world.purifiers entry ({t, ready, fuel, cup}) or null. Lit = a cup is boiling and fuel > 0. */
export function paintPurifier(g, entry, elapsed) {
  const ud = g.userData, cup = !!entry && entry.cup !== 0, fuel = entry && entry.fuel > 0 ? entry.fuel : 0;
  const lit = cup && !entry.ready && fuel > 0, logCount = Math.min(3, Math.ceil(fuel / 50));
  const state = !cup ? 0 : entry.ready ? 1 : lit ? 2 : 3, sig = state * 4 + logCount; // 0 empty, 1 ready, 2 boiling, 3 paused (no fuel)
  if (!ud.parts) {
    const get = n => g.getObjectByName(n);
    ud.parts = {embers:get('embers'), potWater:get('potWater'), cup:get('cup'), cupWater:get('cupWater'), steam:[0, 1, 2].map(i => get('steam' + i)), logs:get('fuelLogs'), flame:get('flame')};
  }
  const p = ud.parts;
  if (ud.sig !== sig) {
    ud.sig = sig;
    p.embers.visible = lit;
    if (p.flame) p.flame.visible = lit;
    if (p.logs) for (let i = 0; i < p.logs.children.length; i++) p.logs.children[i].visible = i < logCount;
    p.potWater.visible = cup;
    p.cup.visible = cup;
    p.cupWater.visible = state === 1;
    for (const s of p.steam) s.visible = lit;
  }
  if (!lit) return;
  const em = p.embers.children;
  for (let i = 0; i < em.length; i++) em[i].material.emissiveIntensity = .8 + .4 * Math.sin(elapsed * 9 + i);
  if (p.flame) { const f = p.flame; f.scale.set(1, .85 + .25 * Math.sin(elapsed * 13) + .1 * Math.sin(elapsed * 31), 1); f.rotation.y = elapsed * 1.7; }
  for (let i = 0; i < p.steam.length; i++) {
    const s = p.steam[i], ph = (((elapsed * .45 + i / 3) % 1) + 1) % 1;
    s.position.set(Math.sin(ph * 6 + i) * .04, .7 + ph * .5, 0);
    s.material.opacity = .45 * (1 - ph);
  }
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
