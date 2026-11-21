// Wind Turbine, Battery, String Lights and Lamp Post models (see docs/specs/power.md section 6).
// Given THREE, imports nothing. Local origin = centre of the floor tile top (game.js places decor at y = .22).
// Two rules: every factory call builds FRESH materials (daynight writes emissiveIntensity per material, so a
// shared one would light every copy), and each light creates its userData.power = {lit:0} right here, so
// daynight caches it at scan time even when it scans before power.js in the same frame.

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
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); s.set(sx, sy, sz);
    parts.push([geo, hex, new T.Matrix4().copy(m4.compose(p, q, s))]);
  };
  return { parts, add };
}

const bodyMat = (T, flat = false) => new T.MeshStandardMaterial({ vertexColors: true, roughness: .8, metalness: 0, flatShading: flat });
const solid = (T, mesh, name, cast = true) => { mesh.name = name; mesh.castShadow = cast; mesh.receiveShadow = true; return mesh; };

// ------------------------------------------------------------------ wind turbine

export const HUB_Y = 2.3, HUB_Z = .17;

export function createTurbine(T) {
  const g = new T.Group(); g.name = 'craft_turbine';
  const { parts, add } = kit(T);
  add(new T.CylinderGeometry(.2, .24, .06, 12), '#8d979e', 0, .03, 0);                // foot plate
  add(new T.CylinderGeometry(.05, .08, HUB_Y - .06, 10), '#b9c2c9', 0, .06 + (HUB_Y - .06) / 2 - .03, 0); // tapered mast
  add(new T.BoxGeometry(.12, .12, .3), '#e9eef1', 0, HUB_Y, .02);                    // nacelle
  add(new T.BoxGeometry(.02, .1, .14), '#d6dde2', 0, HUB_Y + .02, -.19);             // tail fin
  const body = solid(T, new T.Mesh(bake(T, parts), bodyMat(T)), 'turbineBody');
  g.add(body);
  // rotor: pivot at the hub, spins about its local z
  const r = kit(T);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + Math.PI / 2; // first blade points up
    r.add(new T.BoxGeometry(.5, .07, .015), '#f4f1ea', Math.cos(a) * .23, Math.sin(a) * .23, 0, 0, 0, a);
  }
  r.add(new T.ConeGeometry(.05, .1, 10), '#e07a5f', 0, 0, .05, Math.PI / 2, 0, 0);
  const blades = new T.Mesh(bake(T, r.parts), bodyMat(T, true));
  blades.name = 'blades'; blades.castShadow = false; blades.receiveShadow = false;
  blades.position.set(0, HUB_Y, HUB_Z);
  g.add(blades);
  g.userData.blades = blades;
  return g;
}

// ------------------------------------------------------------------ battery

const PIP_ON = '#7dff9a', PIP_OFF = '#2e3b33';

export function createBattery(T) {
  const g = new T.Group(); g.name = 'craft_battery';
  const { parts, add } = kit(T);
  add(new T.BoxGeometry(.45, .34, .3), '#4a5a6a', 0, .17, 0);                        // case
  add(new T.BoxGeometry(.47, .04, .32), '#36424e', 0, .36, 0);                       // lid strip
  add(new T.BoxGeometry(.3, .1, .012), '#3b4955', 0, .2, .156);                      // pip panel
  add(new T.CylinderGeometry(.03, .032, .05, 10), '#d9483b', .13, .405, 0);          // + terminal (red)
  add(new T.CylinderGeometry(.03, .032, .05, 10), '#222222', -.13, .405, 0);         // - terminal (black)
  add(new T.BoxGeometry(.05, .012, .012), '#ffffff', .13, .435, 0);                  // + mark
  add(new T.BoxGeometry(.012, .012, .05), '#ffffff', .13, .435, 0);
  add(new T.BoxGeometry(.05, .012, .012), '#ffffff', -.13, .435, 0);                 // - mark
  // a little lightning bolt on the side
  add(new T.BoxGeometry(.012, .1, .05), '#f2c14e', .226, .2, 0, .5, 0, 0);
  const body = solid(T, new T.Mesh(bake(T, parts), bodyMat(T, true)), 'batteryBody');
  g.add(body);
  const pipGeo = new T.BoxGeometry(.06, .04, .01);
  const pips = [];
  for (let i = 0; i < 4; i++) {
    const m = new T.Mesh(pipGeo, new T.MeshStandardMaterial({ color: PIP_OFF, emissive: PIP_ON, emissiveIntensity: 0, roughness: .5 }));
    m.name = 'pip' + i; m.position.set(-.105 + i * .07, .2, .167); m.castShadow = false;
    g.add(m); pips.push(m);
  }
  g.userData.pips = pips; g.userData.sig = -1;
  return g;
}

/** Light pips < n (0..4). Cached on n, so it costs nothing when the charge level is unchanged. */
export function paintBattery(g, n) {
  const u = g?.userData; if (!u || !u.pips) return;
  if (u.sig === n) return;
  u.sig = n;
  for (let i = 0; i < u.pips.length; i++) {
    const m = u.pips[i].material, on = i < n;
    m.color.set(on ? PIP_ON : PIP_OFF); m.emissiveIntensity = on ? .9 : 0;
  }
}

// ------------------------------------------------------------------ string lights

export const HOOK = [0, 1.05, 0], ANCHOR = [.78, .55, 0];
const BULBS = ['#ffd27a', '#ffb35a', '#fff1c4'];

function wireCurve(T) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    pts.push(new T.Vector3(HOOK[0] + (ANCHOR[0] - HOOK[0]) * t, HOOK[1] + (ANCHOR[1] - HOOK[1]) * t - .22 * 4 * t * (1 - t), 0));
  }
  return new T.CatmullRomCurve3(pts);
}

export function createStringLights(T) {
  const g = new T.Group(); g.name = 'craft_stringlights';
  const { parts, add } = kit(T);
  add(new T.CylinderGeometry(.075, .085, .05, 10), '#7d5c37', 0, .025, 0);           // post foot
  add(new T.CylinderGeometry(.03, .035, 1.1, 8), '#906f48', 0, .55, 0);              // post
  add(new T.TorusGeometry(.03, .007, 5, 10, Math.PI * 1.4), '#2b2b2b', .02, 1.08, 0); // top hook
  add(new T.CylinderGeometry(.014, .02, .58, 6), '#906f48', ANCHOR[0], .29, 0);      // anchor peg / stake
  add(new T.SphereGeometry(.022, 6, 4), '#7d5c37', ANCHOR[0], ANCHOR[1] + .01, 0);
  const curve = wireCurve(T);
  parts.push([new T.TubeGeometry(curve, 28, .006, 4, false), '#2b2b2b', null]);
  const body = solid(T, new T.Mesh(bake(T, parts), bodyMat(T)), 'lightsBody'); // post + wire, one draw call (the 6 mm wire shadow is negligible)
  g.add(body);
  const b = kit(T), p = new T.Vector3();
  for (let i = 0; i < 6; i++) {
    curve.getPoint((i + 1) / 7, p);
    b.add(new T.CylinderGeometry(.006, .006, .03, 4), '#2b2b2b', p.x, p.y - .015, 0);
    b.add(new T.SphereGeometry(.035, 8, 6), BULBS[i % 3], p.x, p.y - .055, 0);
  }
  const bulbs = new T.Mesh(bake(T, b.parts), new T.MeshStandardMaterial({ vertexColors: true, emissive: '#ffc070', emissiveIntensity: .45, roughness: .35 }));
  bulbs.name = 'candle'; bulbs.castShadow = false; bulbs.receiveShadow = false; // daynight multiplier 2.0
  g.add(bulbs);
  g.userData.power = { lit: 0 };
  g.userData.noPool = true; // emissive only: never takes a pool PointLight
  return g;
}

// ------------------------------------------------------------------ lamp post

export const LAMP_Y = 1.95;

export function createLampPost(T) {
  const g = new T.Group(); g.name = 'craft_lamppost';
  const { parts, add } = kit(T);
  add(new T.CylinderGeometry(.14, .17, .08, 10), '#4c5864', 0, .04, 0);              // base
  add(new T.CylinderGeometry(.04, .055, 1.78, 10), '#5d6b78', 0, .08 + .89, 0);      // post
  add(new T.CylinderGeometry(.07, .07, .04, 10), '#4c5864', 0, 1.82, 0);             // collar under the head
  add(new T.BoxGeometry(.2, .025, .025), '#4c5864', .09, 1.55, 0, 0, 0, .35);        // small decorative arm
  add(new T.SphereGeometry(.025, 6, 4), '#4c5864', .185, 1.585, 0);
  add(new T.CylinderGeometry(.13, .13, .025, 4), '#4c5864', 0, 1.84, 0, 0, Math.PI / 4, 0); // head floor
  add(new T.ConeGeometry(.17, .12, 4), '#4c5864', 0, 2.13, 0, 0, Math.PI / 4, 0);   // roof
  add(new T.SphereGeometry(.025, 6, 4), '#4c5864', 0, 2.2, 0);                       // finial
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) add(new T.BoxGeometry(.015, .22, .015), '#4c5864', x * .085, 1.96, z * .085); // head frame
  const body = solid(T, new T.Mesh(bake(T, parts), bodyMat(T, true)), 'lampBody');
  g.add(body);
  const glass = new T.Mesh(new T.BoxGeometry(.16, .21, .16).translate(0, LAMP_Y, 0),
    new T.MeshStandardMaterial({ color: '#fff4d8', emissive: '#ffe2a8', emissiveIntensity: .3, transparent: true, opacity: .5, roughness: .15, depthWrite: false }));
  glass.name = 'lanternGlass'; glass.userData.glass = true; glass.castShadow = false; glass.receiveShadow = false;
  g.add(glass);
  const glow = new T.Mesh(new T.SphereGeometry(.055, 10, 8).translate(0, LAMP_Y, 0),
    new T.MeshStandardMaterial({ color: '#fff0c8', emissive: '#ffd27a', emissiveIntensity: .5, transparent: true, opacity: .6, depthWrite: false }));
  glow.name = 'lanternGlow'; glow.castShadow = false; glow.receiveShadow = false;
  glow.userData.pool = { color: '#fff1d6', gain: .8 }; // daynight: a lamp post's night pool is a little softer than a lantern's
  g.add(glow);
  g.userData.power = { lit: 0 };
  return g;
}
