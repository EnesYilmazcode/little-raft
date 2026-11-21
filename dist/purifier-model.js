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
  // Flame: two crossed emissive cones (no light), shown only while fuel is burning.
  const flame = new T.Group(); flame.name = 'flame'; g.add(flame);
  const flameMat = new T.MeshBasicMaterial({color:0xffa53a, transparent:true, opacity:.85, depthWrite:false});
  const coneGeo = new T.ConeGeometry(.07, .2, 8, 1, true);
  for (let i = 0; i < 2; i++) { const c = new T.Mesh(coneGeo, flameMat); c.position.set(i ? .03 : -.02, .22, i ? -.02 : .02); c.scale.setScalar(i ? .75 : 1); flame.add(c); }
  // Fuel slot: up to three planks stacked on the base beside the fire tray (one per stored plank).
  const planks = new T.Group(); planks.name = 'fuelPlanks'; g.add(planks);
  const plankMat = std(0xa8794a, .9), plankGeo = new T.BoxGeometry(.06, .03, .3);
  for (let i = 0; i < 3; i++) { const m = new T.Mesh(plankGeo, plankMat); m.position.set(-.28 + (i % 2) * .065, .055 + i * .03, 0); m.rotation.y = (i - 1) * .12; m.castShadow = m.receiveShadow = true; m.visible = false; planks.add(m); }
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

// entry: watering.js purifier entry ({cup, t, ready, fuel, burn}) or null. Allocation-free per frame.
export function paintPurifier(g, entry, elapsed) {
  const ud = g.userData;
  const cup = !!entry && entry.cup !== 0, ready = cup && !!entry.ready, fuel = entry ? Math.min(3, entry.fuel | 0) : 0;
  const lit = cup && !ready && (entry.burn > 0 || fuel > 0); // fire only while a cup is purifying
  const sig = (cup ? (ready ? 3 : lit ? 2 : 1) : 0) * 4 + fuel; // 0 empty, 1 paused (no fuel), 2 burning, 3 ready
  if (!ud.parts) {
    const get = n => g.getObjectByName(n);
    ud.parts = {embers:get('embers'), flame:get('flame'), planks:get('fuelPlanks'), potWater:get('potWater'), cup:get('cup'), cupWater:get('cupWater'), steam:[0, 1, 2].map(i => get('steam' + i))};
  }
  const p = ud.parts;
  if (ud.sig !== sig) {
    ud.sig = sig;
    p.embers.visible = lit;
    if (p.flame) p.flame.visible = lit;
    if (p.planks) for (let i = 0; i < p.planks.children.length; i++) p.planks.children[i].visible = i < fuel;
    p.potWater.visible = cup;
    p.cup.visible = cup;
    p.cupWater.visible = ready;
    for (let i = 0; i < p.steam.length; i++) p.steam[i].visible = lit;
  }
  if (!lit) return;
  const em = p.embers.children;
  for (let i = 0; i < em.length; i++) em[i].material.emissiveIntensity = .8 + .4 * Math.sin(elapsed * 9 + i);
  if (p.flame) { const f = p.flame.children; for (let i = 0; i < f.length; i++) f[i].scale.y = (i ? .75 : 1) * (.85 + .25 * Math.sin(elapsed * (13 + i * 4) + i)); }
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
