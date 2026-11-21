// Juicer model (see docs/specs/juicer.md section 5). Given THREE, imports nothing.
// Local origin = centre of the floor tile top. Static parts are merged into one vertex-coloured mesh;
// the crank, the glass jar, its smoothie fill and the splash drops stay separate so they can move.

export const SPIN_SECONDS = 0.9;
export const JAR_COLOR = Object.freeze({ berry: 0xc2335a, coconut: 0xf1e8d6, mixed: 0xe9835f });

// Merge a list of [geometry, hex, matrix] into one non-indexed geometry with a colour attribute (as bees-model.js).
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
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); s.set(1, 1, 1);
    parts.push([geo, hex, new T.Matrix4().copy(m4.compose(p, q, s))]);
  };
  return { parts, add };
}

const LEG_H = .32, TOP_Y = LEG_H + .05;           // stand top surface
const BODY_Z = -.06, BODY_R = .1, BODY_H = .14, BODY_Y = TOP_Y + BODY_H / 2;
const JAR_Z = .105, JAR_R = .07, JAR_H = .12, FILL_R = .062, FILL_H = .105;
const DROPS = 5;

export function createJuicerModel(T) {
  const g = new T.Group(); g.name = 'craft_juicer';
  const { parts, add } = kit(T);
  // stand: top board on four legs
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new T.BoxGeometry(.04, LEG_H, .04), '#7d5a36', sx * .17, LEG_H / 2, sz * .17);
  for (const sx of [-1, 1]) add(new T.BoxGeometry(.03, .03, .34), '#7d5a36', sx * .17, .1, 0); // low rails
  add(new T.BoxGeometry(.4, .05, .4), '#9c7649', 0, LEG_H + .025, 0);
  // squat tin body with a rim band, the hopper funnel on top and a spout over the jar
  add(new T.CylinderGeometry(BODY_R, BODY_R * 1.05, BODY_H, 8), '#a9b4c2', 0, BODY_Y, BODY_Z);
  add(new T.CylinderGeometry(BODY_R * 1.08, BODY_R * 1.08, .02, 8), '#8d97a3', 0, TOP_Y + BODY_H - .01, BODY_Z);
  add(new T.CylinderGeometry(.135, .135, .012, 8, 1, true), '#5d6b78', 0, TOP_Y + BODY_H + .11, BODY_Z); // hopper lip
  add(new T.BoxGeometry(.035, .03, .1), '#8d97a3', 0, TOP_Y + .125, .06);
  add(new T.CylinderGeometry(.012, .014, .025, 6), '#5d6b78', 0, TOP_Y + .1, JAR_Z);
  add(new T.CylinderGeometry(.085, .085, .008, 12), '#7d5a36', 0, TOP_Y + .004, JAR_Z); // jar coaster
  const body = new T.Mesh(bake(T, parts), new T.MeshStandardMaterial({ vertexColors: true, roughness: .7, metalness: .1, flatShading: true }));
  body.name = 'juicerBody'; body.castShadow = true; body.receiveShadow = true; g.add(body);
  // hopper: an open funnel, double-sided so its inside shows from above, with a dark throat at the bottom
  const hopper = new T.Mesh(new T.CylinderGeometry(.13, .045, .11, 8, 1, true).translate(0, TOP_Y + BODY_H + .055, BODY_Z),
    new T.MeshStandardMaterial({ color: '#8d97a3', roughness: .7, metalness: .1, flatShading: true, side: T.DoubleSide }));
  hopper.name = 'hopper'; hopper.castShadow = false; // the body's shadow already covers it; no extra shadow caster g.add(hopper);
  const throat = new T.Mesh(new T.CircleGeometry(.046, 8).rotateX(-Math.PI / 2).translate(0, TOP_Y + BODY_H + .003, BODY_Z), new T.MeshLambertMaterial({ color: '#2b3036' }));
  throat.name = 'hopperThroat'; g.add(throat);

  // crank: pivots on the x axis at the body centre, on the +x side
  const crank = new T.Group(); crank.name = 'crank'; crank.position.set(BODY_R, BODY_Y, BODY_Z);
  const armMat = new T.MeshStandardMaterial({ color: '#5d6b78', roughness: .5, metalness: .3, flatShading: true });
  const axle = new T.Mesh(new T.CylinderGeometry(.012, .012, .05, 6).rotateZ(Math.PI / 2).translate(.025, 0, 0), armMat);
  const arm = new T.Mesh(new T.BoxGeometry(.018, .09, .018).translate(.05, .045, 0), armMat);
  const knob = new T.Mesh(new T.CylinderGeometry(.018, .018, .04, 8).rotateZ(Math.PI / 2).translate(.075, .085, 0),
    new T.MeshStandardMaterial({ color: '#c69860', roughness: .8, flatShading: true }));
  axle.name = 'crankAxle'; arm.name = 'crankArm'; knob.name = 'crankKnob';
  crank.add(axle, arm, knob); g.add(crank);

  // glass jar, the smoothie fill inside and the splash drops above it
  const jar = new T.Mesh(new T.CylinderGeometry(JAR_R, JAR_R * .95, JAR_H, 12, 1, true).translate(0, TOP_Y + .008 + JAR_H / 2, JAR_Z),
    new T.MeshStandardMaterial({ color: '#cfeef0', transparent: true, opacity: .35, roughness: .1, side: T.DoubleSide, forceSinglePass: true, depthWrite: false }));
  jar.name = 'jar'; jar.userData.glass = true; g.add(jar);
  const fill = new T.Mesh(new T.CylinderGeometry(FILL_R, FILL_R * .95, FILL_H, 12).translate(0, FILL_H / 2, 0), new T.MeshLambertMaterial({ color: JAR_COLOR.mixed }));
  fill.name = 'fill'; fill.position.set(0, TOP_Y + .01, JAR_Z); fill.visible = false; g.add(fill);
  const splash = new T.Group(); splash.name = 'splash'; splash.visible = false; splash.position.set(0, TOP_Y + .008, JAR_Z); // drop y is measured from the jar base
  const dropGeo = new T.IcosahedronGeometry(.012, 0), dropMat = new T.MeshLambertMaterial({ color: JAR_COLOR.mixed });
  for (let i = 0; i < DROPS; i++) { const d = new T.Mesh(dropGeo, dropMat); d.name = 'drop' + i; splash.add(d); }
  g.add(splash);
  g.userData.crank = crank; g.userData.fill = fill; g.userData.splash = splash; g.userData.dropMat = dropMat; g.userData.sig = undefined;
  return g;
}

/** entry = {m, n} or null (empty jar). spinT = seconds since a blend (0 / >= SPIN_SECONDS: idle). No allocation. */
export function paintJuicer(g, entry, spinT) {
  const u = g?.userData; if (!u || !u.fill) return;
  const m = entry && Object.prototype.hasOwnProperty.call(JAR_COLOR, entry.m) ? entry.m : null;
  if (u.sig !== m) {
    u.sig = m; u.fill.visible = m !== null;
    if (m !== null) { u.fill.material.color.setHex(JAR_COLOR[m]); u.dropMat.color.setHex(JAR_COLOR[m]); }
  }
  const spinning = m !== null && spinT > 0 && spinT < SPIN_SECONDS;
  if (!spinning) {
    if (u.splash.visible) u.splash.visible = false;
    if (u.fill.scale.y !== 1) u.fill.scale.y = 1;
    return;
  }
  u.crank.rotation.x = spinT * 14;
  u.fill.scale.y = .8 + .2 * Math.sin(spinT * 30);
  u.splash.visible = true;
  const t = spinT / SPIN_SECONDS, drops = u.splash.children;
  for (let i = 0; i < drops.length; i++) {
    const a = i / drops.length * Math.PI * 2 + .4, r = .015 + t * .05;
    drops[i].position.set(Math.cos(a) * r, .2 + Math.sin(t * Math.PI) * .08 - (i % 2) * .015, Math.sin(a) * r);
  }
}
