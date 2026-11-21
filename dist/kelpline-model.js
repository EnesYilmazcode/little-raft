// Kelp Line model (see docs/specs/kelp.md section 8). Given THREE, imports nothing.
// Local origin = centre of the floor tile top (game.js places decor at y = .22); the open water is local +z.
// A short post with a cleat near the tile edge, a rope sloping down to three floats on the waterline, and
// seaweed strands (the seafloor's seaweed geometry, passed in) hanging under each float. Above the water (what the
// deck sees): nothing when Bare, a small sprig on the middle float when Leafy, and a tuft on every float when Lush.

export const OVERHANG = 1.2;
const POST_Z = .6, CLEAT_Y = .38, FLOAT_Y = -.2, FLOAT_R = .09;
const FLOAT_Z = [OVERHANG, OVERHANG + .3, OVERHANG + .6];
const FLOAT_HEX = ['#e9e4d4', '#d9774a', '#e9e4d4'];
const SCALE_Y = [.18, .4, .6], SCALE_XZ = [.35, .5, .6]; // strand size by stage (Bare, Leafy, Lush)

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

// A cylinder from a to b (each [y, z] on the x = 0 plane), radius r.
function ropeBetween(T, parts, a, b, r, hex) {
  const dy = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dy, dz);
  const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(0, dy / len, dz / len));
  const m = new T.Matrix4().compose(new T.Vector3(0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2), q, new T.Vector3(1, 1, 1));
  parts.push([new T.CylinderGeometry(r, r, len, 5), hex, m]);
}

/** Group 'craft_kelpline'. weedGeo: the seafloor's seaweedGeometry (shared, never disposed here). */
export function createKelpLine(T, weedGeo) {
  const g = new T.Group(); g.name = 'craft_kelpline';
  const at = (x, y, z) => new T.Matrix4().makeTranslation(x, y, z);
  // --- static: post, cleat, foot plate and rope
  const parts = [];
  parts.push([new T.BoxGeometry(.08, .45, .08), '#8a6640', at(0, .225, POST_Z)]);
  parts.push([new T.BoxGeometry(.18, .04, .05), '#6e4f33', at(0, CLEAT_Y, POST_Z + .055)]);
  parts.push([new T.BoxGeometry(.14, .03, .14), '#7a5530', at(0, .015, POST_Z)]);
  const ROPE = '#d8c39a';
  ropeBetween(T, parts, [CLEAT_Y, POST_Z + .08], [-.18, OVERHANG + .3], .012, ROPE); // cleat down to the middle float
  ropeBetween(T, parts, [FLOAT_Y + .01, FLOAT_Z[0]], [FLOAT_Y + .01, FLOAT_Z[2]], .01, ROPE); // the float line on the water
  const body = new T.Mesh(bake(T, parts), new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, flatShading: true }));
  body.name = 'kelpBody'; body.castShadow = true; body.receiveShadow = true; g.add(body);

  // --- floats (they bob) and strands (they follow their float)
  const floats = new T.Group(); floats.name = 'floats'; g.add(floats);
  const floatGeo = new T.SphereGeometry(FLOAT_R, 10, 6); floatGeo.scale(1, .6, 1);
  const fmats = {};
  const strands = new T.Group(); strands.name = 'strands'; g.add(strands);
  const weedMat = new T.MeshStandardMaterial({ vertexColors: true, side: T.DoubleSide, roughness: .8 });
  for (let i = 0; i < 3; i++) {
    const hex = FLOAT_HEX[i];
    const f = new T.Mesh(floatGeo, fmats[hex] ??= new T.MeshStandardMaterial({ color: hex, roughness: .55 }));
    f.position.set(0, FLOAT_Y, FLOAT_Z[i]); f.castShadow = true; f.userData.baseY = FLOAT_Y; floats.add(f);
    const s = new T.Mesh(weedGeo, weedMat); s.name = 'strand' + i;
    s.position.set(0, FLOAT_Y, FLOAT_Z[i]); s.rotation.set(Math.PI, i * Math.PI / 2, 0); s.scale.set(SCALE_XZ[0], SCALE_Y[0], SCALE_XZ[0]); // quarter turns keep the strands within the tile width
    strands.add(s);
  }
  // Lush: an upright tuft on each float; Leafy: one small sprig on the middle float
  const tuft = new T.Group(); tuft.name = 'tuft'; tuft.visible = false; g.add(tuft);
  for (let i = 0; i < 3; i++) {
    const m = new T.Mesh(weedGeo, weedMat); m.position.set(0, FLOAT_Y + FLOAT_R * .4, FLOAT_Z[i]); m.rotation.y = i * 1.3;
    const k = i === 1 ? 1 : .8; m.scale.set(.3 * k, .2 * k, .3 * k); tuft.add(m);
  }
  const sprig = new T.Mesh(weedGeo, weedMat); sprig.name = 'sprig'; sprig.visible = false;
  sprig.position.set(0, FLOAT_Y + FLOAT_R * .4, FLOAT_Z[1]); sprig.scale.set(.2, .09, .2); g.add(sprig);
  g.userData.floats = floats; g.userData.strands = strands; g.userData.tuft = tuft; g.userData.sprig = sprig; g.userData.sig = -1;
  return g;
}

/** Stage cues (cached on userData.sig) and, when `move`, a gentle bob. No allocation, no ocean sampling. */
export function paintKelp(g, stage, elapsed = 0, phase = 0, move = true) {
  const u = g?.userData; if (!u || !u.floats) return;
  const st = stage === 2 ? 2 : stage === 1 ? 1 : 0;
  const ss = u.strands.children, fs = u.floats.children;
  if (u.sig !== st) {
    u.sig = st;
    for (let i = 0; i < ss.length; i++) ss[i].scale.set(SCALE_XZ[st], SCALE_Y[st], SCALE_XZ[st]);
    u.tuft.visible = st === 2; u.sprig.visible = st === 1;
  }
  if (!move) return;
  for (let i = 0; i < fs.length; i++) {
    const y = fs[i].userData.baseY + .025 * Math.sin(elapsed * 1.3 + phase + i * .9);
    fs[i].position.y = y;
    if (ss[i]) { ss[i].position.y = y; ss[i].rotation.z = .08 * Math.sin(elapsed * .8 + phase + i); }
    const t = u.tuft.children[i]; if (t) t.position.y = y + FLOAT_R * .4;
    if (i === 1) u.sprig.position.y = y + FLOAT_R * .4;
  }
}
