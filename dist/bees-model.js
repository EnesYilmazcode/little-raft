// Beehive, Flower Box and Beeswax Candle models (see docs/specs/beehive.md section 7).
// Given THREE, imports nothing. Local origin = centre of the floor tile top (game.js places decor at y = .22).
// Static parts are merged into one vertex-coloured mesh per model so a raft full of flowers stays cheap.

// Merge a list of [geometry, hex, matrix] into one non-indexed geometry with a colour attribute.
function bake(T, parts) {
  const geos = [];
  let n = 0;
  for (const [geo, hex, m4] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    if (m4) g.applyMatrix4(m4);
    const c = new T.Color(hex), cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    geos.push(g); n += cnt;
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

function kit(T) {
  const parts = [], m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3();
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); s.set(sx, sy, sz);
    parts.push([geo, hex, new T.Matrix4().copy(m4.compose(p, q, s))]);
  };
  return { parts, add };
}

const bodyMat = (T, flat = false) => new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0, flatShading: flat });

// ------------------------------------------------------------------ beehive

const SKEP = [[.25, .26], [.23, .25], [.19, .23], [.12, .19]]; // [top, bottom] radius of each straw ring
const SKEP_Y = .2, RING_H = .11;
export const COMB_Y = .4, COMB_X = [-.15, 0, .15];
// Point on the skep surface in front of a comb slot: [x, z, yaw] pushed out by `out`.
const combSpot = (x, out) => { const r = skepRadiusAt(COMB_Y), z = Math.sqrt(Math.max(0, r * r - x * x)), a = Math.atan2(x, z); return [Math.sin(a) * (r + out), Math.cos(a) * (r + out), a]; };
const skepRadiusAt = y => { const i = Math.min(SKEP.length - 1, Math.max(0, Math.floor((y - SKEP_Y) / RING_H))); const f = (y - SKEP_Y - i * RING_H) / RING_H; return SKEP[i][1] + (SKEP[i][0] - SKEP[i][1]) * Math.min(1, Math.max(0, f)); };

export function createHive(T) {
  const g = new T.Group(); g.name = 'craft_beehive';
  const { parts, add } = kit(T);
  // stand on four short legs
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new T.BoxGeometry(.05, .12, .05), '#7d5c37', sx * .22, .06, sz * .22);
  add(new T.BoxGeometry(.55, .08, .55), '#9c7649', 0, .16, 0);
  // straw skep: stacked tapering rings, alternating tones
  SKEP.forEach(([rt, rb], i) => add(new T.CylinderGeometry(rt, rb, RING_H, 14), i % 2 ? '#c58f32' : '#d9a441', 0, SKEP_Y + RING_H * (i + .5), 0));
  add(new T.CylinderGeometry(.04, .12, .05, 14), '#d9a441', 0, SKEP_Y + RING_H * 4 + .025, 0);
  // door arch at the front, at the bottom ring
  add(new T.CylinderGeometry(.05, .05, .03, 14), '#3b2a1a', 0, .26, .25, Math.PI / 2, 0, 0);
  add(new T.BoxGeometry(.1, .06, .03), '#3b2a1a', 0, .23, .25);
  add(new T.BoxGeometry(.2, .02, .08), '#8a6840', 0, .21, .29); // landing board
  // little pitched roof board
  for (const sx of [-1, 1]) add(new T.BoxGeometry(.28, .025, .42), '#9c7649', sx * .12, .72, 0, 0, 0, -sx * .45);
  add(new T.BoxGeometry(.03, .03, .44), '#7d5c37', 0, .78, 0);
  // window strip: dark hexagon cells the combs sit in
  for (const x of COMB_X) {
    const [px, pz, a] = combSpot(x, -.004);
    parts.push([new T.CylinderGeometry(.08, .08, .02, 6), '#5a3d1e', new T.Matrix4().makeRotationFromEuler(new T.Euler(Math.PI / 2, a, 0, 'YXZ')).setPosition(px, COMB_Y, pz)]);
  }
  const body = new T.Mesh(bake(T, parts), bodyMat(T, true)); body.name = 'hiveBody'; body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  // honeycomb slabs
  const combMat = new T.MeshStandardMaterial({ color: '#b8600c', roughness: .35, flatShading: true }); // deep amber: reads against the straw by day, no emissive needed
  const combGeo = new T.CylinderGeometry(.07, .07, .03, 6);
  const combs = [];
  COMB_X.forEach((x, i) => {
    const [px, pz, a] = combSpot(x, .008);
    const m = new T.Mesh(combGeo, combMat); m.name = 'comb' + i;
    m.position.set(px, COMB_Y, pz); m.rotation.set(Math.PI / 2, a, 0, 'YXZ');
    m.visible = false; g.add(m); combs.push(m);
  });
  // three friendly bees
  const bees = new T.Group(); bees.name = 'bees'; bees.visible = false;
  const beeBody = new T.SphereGeometry(.025, 8, 6), stripe = new T.CylinderGeometry(.0255, .0255, .012, 8), wing = new T.PlaneGeometry(.03, .018);
  const yellow = new T.MeshStandardMaterial({ color: '#f5c542', roughness: .6 }), dark = new T.MeshStandardMaterial({ color: '#2b2116', roughness: .7 });
  const white = new T.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: .8, side: T.DoubleSide, roughness: .3 });
  for (let i = 0; i < 3; i++) {
    const b = new T.Group(); b.name = 'bee' + i;
    const body0 = new T.Mesh(beeBody, yellow); body0.scale.set(1, .85, 1.25); b.add(body0);
    const st = new T.Mesh(stripe, dark); st.rotation.x = Math.PI / 2; b.add(st);
    for (const sx of [-1, 1]) { const w = new T.Mesh(wing, white); w.position.set(sx * .022, .02, -.004); w.rotation.set(-Math.PI / 2, 0, sx * .5); b.add(w); }
    bees.add(b);
  }
  g.add(bees);
  g.userData.combs = combs; g.userData.bees = bees; g.userData.sig = -1;
  return g;
}

/** Comb visibility (cached by c) and the bee orbit. Bees only fly when the hive is working and the camera is near. */
export function paintHive(g, c, active, elapsed, near) {
  const u = g?.userData; if (!u || !u.combs) return;
  if (u.sig !== c) { u.sig = c; for (let i = 0; i < u.combs.length; i++) u.combs[i].visible = i < c; }
  const show = !!(active && near);
  if (u.bees.visible !== show) u.bees.visible = show;
  if (!show) return;
  const list = u.bees.children;
  for (let i = 0; i < list.length; i++) {
    const a = elapsed * 1.6 + i * 2.1, r = .35 + .05 * Math.sin(elapsed * 3 + i), b = list[i];
    b.position.set(Math.sin(a) * r, .55 + .1 * Math.sin(elapsed * 2.3 + i), Math.cos(a) * r);
    b.rotation.y = a + Math.PI / 2; // nose along the orbit
    const flap = Math.sin(elapsed * 60 + i) * .5;
    if (b.children[2]) b.children[2].rotation.z = -.5 - flap;
    if (b.children[3]) b.children[3].rotation.z = .5 + flap;
  }
}

// ------------------------------------------------------------------ flower box

const BLOOMS = ['#ff7aa2', '#ffd35a', '#9b7bff', '#ff9f45', '#6fd3ff', '#ffffff'];

export function createFlowerBox(T) {
  const g = new T.Group(); g.name = 'craft_flowerbox';
  const { parts, add } = kit(T);
  add(new T.BoxGeometry(.66, .2, .33), '#a0704a', 0, .1, 0);
  add(new T.BoxGeometry(.7, .03, .35), '#8a5c3a', 0, .215, 0);           // rim
  add(new T.BoxGeometry(.62, .02, .29), '#4a3222', 0, .222, 0);           // soil
  for (const sx of [-1, 1]) add(new T.BoxGeometry(.04, .2, .34), '#8a5c3a', sx * .32, .1, 0); // corner boards
  const petal = () => new T.SphereGeometry(.032, 7, 5);
  BLOOMS.forEach((hex, i) => {
    const x = -.27 + i * .108, z = i % 2 ? .06 : -.05, h = .13 + (i * 37 % 5) * .012, y = .23 + h;
    add(new T.CylinderGeometry(.007, .009, h, 5), '#3f8f5a', x, .23 + h / 2, z);
    add(new T.SphereGeometry(.03, 5, 3), '#5fae6b', x + .025, .23 + h * .45, z, 0, 0, .6, 1, .35, .6); // leaf
    for (let k = 0; k < 5; k++) {
      const a = k * Math.PI * 2 / 5 + i;
      add(petal(), hex, x + Math.cos(a) * .032, y, z + Math.sin(a) * .032, 0, -a, 0, 1, .38, .75);
    }
    add(new T.SphereGeometry(.018, 7, 5), '#ffc21a', x, y + .006, z, 0, 0, 0, 1, .6, 1);
  });
  const m = new T.Mesh(bake(T, parts), bodyMat(T)); m.name = 'flowerBody'; m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

// ------------------------------------------------------------------ beeswax candle

export function createCandle(T) {
  const g = new T.Group(); g.name = 'craft_candle';
  const wax = new T.Mesh(new T.CylinderGeometry(.055, .058, .1, 16).translate(0, .055, 0),
    new T.MeshStandardMaterial({ color: '#f6e7b8', emissive: '#ffb35a', emissiveIntensity: .15, roughness: .7 }));
  wax.name = 'candle'; g.add(wax);
  const base = new T.Mesh(new T.CylinderGeometry(.08, .08, .012, 16).translate(0, .006, 0), new T.MeshStandardMaterial({ color: '#9c7649', roughness: .8 }));
  base.name = 'candleBase'; g.add(base);
  const wick = new T.Mesh(new T.CylinderGeometry(.003, .003, .02, 4).translate(0, .115, 0), new T.MeshStandardMaterial({ color: '#2b2116' }));
  wick.name = 'wick'; g.add(wick);
  const flame = new T.Mesh(new T.ConeGeometry(.014, .04, 8).translate(0, .14, 0),
    new T.MeshStandardMaterial({ color: '#ffe3a0', emissive: '#ffcc66', emissiveIntensity: .8, roughness: .4 }));
  flame.name = 'flame'; g.add(flame);
  const glow = new T.Mesh(new T.SphereGeometry(.032, 10, 8).translate(0, .14, 0),
    new T.MeshStandardMaterial({ color: '#ffe8b0', emissive: '#ffd27a', emissiveIntensity: .5, transparent: true, opacity: .6, depthWrite: false }));
  glow.name = 'lanternGlow'; g.add(glow);
  glow.userData.pool = { color: '#ffdcb0', gain: .55 }; // daynight: a candle's night pool is smaller and paler than a lantern's
  // daynight puts its night pool light (5 cd, decay 2) at this geometry's bounding-sphere centre. At the flame
  // (.14 m over the deck) it blows the floor out to white, so lift the centre to about lantern-foot height and
  // grow the radius so the sphere still encloses the glow (culling and raycasts stay correct).
  glow.geometry.computeBoundingSphere(); glow.geometry.boundingSphere.center.set(0, .8, 0); glow.geometry.boundingSphere.radius = .72;
  const jar = new T.Mesh(new T.CylinderGeometry(.075, .072, .17, 18, 1, true).translate(0, .097, 0),
    new T.MeshStandardMaterial({ color: '#cfeef0', transparent: true, opacity: .3, roughness: .1, side: T.DoubleSide, depthWrite: false }));
  jar.name = 'jar'; jar.userData.glass = true; g.add(jar);
  const rim = new T.Mesh(new T.TorusGeometry(.075, .006, 6, 18).rotateX(Math.PI / 2).translate(0, .182, 0), new T.MeshStandardMaterial({ color: '#c9a46a', roughness: .6 }));
  rim.name = 'rim'; g.add(rim);
  return g;
}
