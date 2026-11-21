// Driftboard model (docs/specs/paddleboard.md, Model). Origin = deck top centre, +z = nose.
// Three draw calls per board: merged hull (vertex colours), paddle (shaft + blade) and the tie rope line.
// Geometry and materials are built once at module scope and shared by every board.

let shared = null;
const HAND_Y = 1.0, HAND_X = .32, HAND_Z = .4; // paddle pivot: the rider's right hand

function painter(T) {
  const parts = [], m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), sc = new T.Vector3();
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function add(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = null, jitter = .05) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); sc.set(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1);
    m4.compose(p, q, sc); g.applyMatrix4(m4);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), base = new T.Color(hex), c = new T.Color();
    for (let i = 0; i < n; i++) { c.copy(base).multiplyScalar(1 + (rnd() - .5) * jitter * 2); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    parts.push(g);
  }
  function merge() {
    let total = 0; for (const g of parts) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
    parts.length = 0;
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return geo;
  }
  return { add, merge };
}

function build(T) {
  const P = painter(T), WOOD = ['#b98a55', '#a87a48', '#c49862', '#b08050', '#bd9059'];
  // rounded plank board 2.6 x 0.1 x 0.7: five planks side by side, rounded ends, top at y = 0
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * .14, len = 2.3 - Math.abs(i - 2) * .16;
    P.add(new T.BoxGeometry(.135, .1, len), WOOD[i], x, -.05, -.05);
  }
  P.add(new T.CylinderGeometry(.35, .35, .1, 14, 1, false, -Math.PI / 2, Math.PI), '#b48550', 0, -.05, 1.07, 0, 0, 0, [1, 1, .55]); // round nose
  P.add(new T.CylinderGeometry(.35, .35, .1, 14, 1, false, Math.PI / 2, Math.PI), '#ad7f4c', 0, -.05, -1.2, 0, 0, 0, [1, 1, .3]); // round tail
  P.add(new T.BoxGeometry(.6, .08, .4), '#b78955', 0, .0, 1.12, -.32, 0, 0); // raised nose kick
  P.add(new T.BoxGeometry(.7, .03, .06), '#7a5531', 0, .005, .7); P.add(new T.BoxGeometry(.7, .03, .06), '#7a5531', 0, .005, -.8); // cross battens
  // two plastic float pontoons under the board
  for (const sx of [-.24, .24]) {
    P.add(new T.CapsuleGeometry(.12, 1.7, 4, 10), '#3aa6a0', sx, -.17, -.05, Math.PI / 2, 0, 0);
    P.add(new T.TorusGeometry(.125, .018, 5, 12), '#f0e2b6', sx, -.17, .45, 0, 0, 0);
    P.add(new T.TorusGeometry(.125, .018, 5, 12), '#f0e2b6', sx, -.17, -.55, 0, 0, 0);
  }
  // woven standing pad
  for (let i = 0; i < 4; i++) P.add(new T.BoxGeometry(.46, .015, .1), i % 2 ? '#d9c08a' : '#cfb27a', 0, .008, -.28 + i * .12);
  for (let i = 0; i < 3; i++) P.add(new T.BoxGeometry(.08, .02, .5), '#c4a46c', -.15 + i * .15, .012, -.1);
  const hull = P.merge();
  // paddle: shaft along -y from the hand pivot, blade at the bottom
  P.add(new T.CylinderGeometry(.022, .022, 1.75, 6), '#8a5f36', 0, -.75, 0);
  P.add(new T.BoxGeometry(.07, .05, .1), '#6f4a2a', 0, .12, 0); // T grip
  P.add(new T.BoxGeometry(.2, .45, .03), '#c99b61', 0, -1.6, 0);
  P.add(new T.BoxGeometry(.2, .05, .035), '#3aa6a0', 0, -1.36, 0); // teal band
  const paddle = P.merge();
  const ropeGeo = new T.BufferGeometry(); // per-board positions; this one only seeds the shape
  const hullMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .85 });
  const ropeMat = new T.LineBasicMaterial({ color: '#e9d39a' });
  shared = { hull, paddle, hullMat, ropeMat, ropeGeo };
  return shared;
}

/** A Driftboard group (3 draw calls). userData: paddle, setStroke(ph, side), rope, setTie(x, z), hull. */
export function createDriftboard(T, ropeMat) {
  const S = shared ?? build(T);
  const g = new T.Group(); g.name = 'driftboard';
  const hull = new T.Mesh(S.hull, S.hullMat); hull.castShadow = true; hull.receiveShadow = false; g.add(hull);
  const pivot = new T.Group(); pivot.position.set(HAND_X, HAND_Y, HAND_Z); g.add(pivot);
  const paddle = new T.Mesh(S.paddle, S.hullMat); paddle.castShadow = false; pivot.add(paddle);
  const pos = new Float32Array(6), rg = new T.BufferGeometry(); rg.setAttribute('position', new T.BufferAttribute(pos, 3));
  const rope = new T.Line(rg, ropeMat ?? S.ropeMat); rope.frustumCulled = false; rope.visible = false; g.add(rope);
  g.userData.hull = hull; g.userData.paddle = pivot; g.userData.rope = rope;
  // ph 0..1 through one stroke; side +1 right, -1 left. Blade dips forward, pulls back, lifts out.
  g.userData.setStroke = (ph, side) => {
    const s = side < 0 ? -1 : 1, a = Math.sin(Math.PI * ph);
    pivot.position.set(HAND_X * s, HAND_Y - .12 * a, HAND_Z);
    pivot.rotation.set(-.55 + ph * 1.1, 0, s * (.18 + .12 * a)); // the blade enters ahead and pulls back
  };
  g.userData.rest = () => { pivot.position.set(.2, .045, -.75); pivot.rotation.set(-Math.PI / 2, 0, 0); }; // paddle laid flat along the deck
  // tie rope from the nose cleat to a raft point given in board-local coordinates (y: optional height above the board top)
  g.userData.setTie = (x, z, y = .2) => { pos[0] = 0; pos[1] = .03; pos[2] = .9; pos[3] = x; pos[4] = y; pos[5] = z; rg.attributes.position.needsUpdate = true; };
  g.userData.dispose = () => { rg.dispose(); };
  g.userData.rest();
  return g;
}

/** Free the shared geometry/materials (module dispose). */
export function disposeDriftboards() {
  if (!shared) return;
  shared.hull.dispose(); shared.paddle.dispose(); shared.hullMat.dispose(); shared.ropeMat.dispose(); shared.ropeGeo.dispose();
  shared = null;
}
