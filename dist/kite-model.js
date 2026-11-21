// Sky Kite models (docs/specs/kite.md). THREE comes in as T. Original art: leaf-and-spar diamond kites.
// World kite: one merged vertex-coloured geometry per pattern (<=32 tris), one shared material. String and tail are T.Line.

export const PATTERNS = Object.freeze([
  Object.freeze({ id: 'sunburst', name: 'Sunburst', a: '#e9a08c', b: '#f1d78d', tail: '#e9805f' }),   // coral and sunshell rays
  Object.freeze({ id: 'gullwing', name: 'Gullwing', a: '#f4f1ea', b: '#5d6b78', tail: '#5d6b78' }),   // white, slate wing tips
  Object.freeze({ id: 'tidestripe', name: 'Tidestripe', a: '#86b3d6', b: '#9fd3c1', tail: '#9fd3c1' }), // lagoon and seafoam bands
]);
export const KITE_SCALE = 1.5;
// Sail corners (kite space: face +Z toward the flyer, nose +Y). BOTTOM is where the tail hangs.
const TOP = [0, 0.55, 0], RIGHT = [0.42, 0.12, 0], BOTTOM = [0, -0.62, 0], LEFT = [-0.42, 0.12, 0], MID = [0, 0.12, 0];
export const TAIL_Y = BOTTOM[1];
const SPAR = '#8a5f36', BRIDLE = '#3b3126';

function sailColours(p) {
  const P = PATTERNS[p] ?? PATTERNS[0];
  // tris: (mid, top, right), (mid, right, bottom), (mid, bottom, left), (mid, left, top); colours per vertex
  if (P.id === 'sunburst') return [[P.b, P.a, P.a], [P.b, P.b, P.b], [P.b, P.a, P.a], [P.b, P.b, P.b]];
  if (P.id === 'gullwing') return [[P.a, P.a, P.b], [P.a, P.b, P.a], [P.a, P.a, P.b], [P.a, P.b, P.a]];
  return [[P.a, P.a, P.b], [P.b, P.b, P.b], [P.b, P.b, P.b], [P.a, P.b, P.a]];
}

/** Merged world-kite geometry for pattern p (vertex colours, ~30 tris). */
export function buildKiteGeometry(T, p) {
  const pos = [], col = [], c = new T.Color();
  const tri = (a, b, d, ca, cb, cd) => {
    pos.push(...a, ...b, ...d);
    for (const h of [ca, cb, cd]) { c.set(h); col.push(c.r, c.g, c.b); }
  };
  const cols = sailColours(p), V = [[MID, TOP, RIGHT], [MID, RIGHT, BOTTOM], [MID, BOTTOM, LEFT], [MID, LEFT, TOP]];
  V.forEach((v, i) => tri(v[0], v[1], v[2], ...cols[i]));
  const box = (w, h, d, x, y, z) => {
    const g = new T.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z);
    const a = g.attributes.position.array;
    for (let i = 0; i < a.length; i += 9) tri([a[i], a[i + 1], a[i + 2]], [a[i + 3], a[i + 4], a[i + 5]], [a[i + 6], a[i + 7], a[i + 8]], SPAR, SPAR, SPAR);
    g.dispose();
  };
  box(0.03, TOP[1] - BOTTOM[1], 0.03, 0, (TOP[1] + BOTTOM[1]) / 2, 0.02); // spine
  box(RIGHT[0] - LEFT[0], 0.03, 0.03, 0, MID[1], 0.03);                  // cross spar
  const apex = [0, 0.02, 0.26], up = [0, 0.38, 0.03], lo = [0, -0.36, 0.03];
  tri(up, apex, MID, BRIDLE, BRIDLE, BRIDLE); tri(MID, apex, lo, BRIDLE, BRIDLE, BRIDLE); // bridle wedge
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Shared resources for the world kites: per-pattern geometry and tail material, one sail and one string material. */
export function createKiteKit(T) {
  const geos = PATTERNS.map((_, i) => buildKiteGeometry(T, i));
  const sail = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  const string = new T.LineBasicMaterial({ color: '#3b3126', transparent: true, opacity: 0.85 });
  const tails = PATTERNS.map(P => new T.LineBasicMaterial({ color: P.tail }));
  const line = n => {
    const g = new T.BufferGeometry(), a = new T.BufferAttribute(new Float32Array(n * 3), 3);
    a.setUsage(T.DynamicDrawUsage); g.setAttribute('position', a);
    return g;
  };
  /** One pooled kite: {kite, line, tail, p}. Lines are frustumCulled=false (their bounds change every frame). */
  function make(p) {
    const kite = new T.Mesh(geos[p] ?? geos[0], sail); kite.castShadow = false; kite.receiveShadow = false;
    kite.scale.setScalar(KITE_SCALE); kite.rotation.order = 'YXZ'; kite.name = 'kite';
    const l = new T.Line(line(17), string); l.frustumCulled = false; l.name = 'kiteString';
    const t = new T.Line(line(8), tails[p] ?? tails[0]); t.frustumCulled = false; t.name = 'kiteTail';
    return { kite, line: l, tail: t, p };
  }
  function setPattern(slot, p) {
    if (slot.p === p) return;
    slot.p = p; slot.kite.geometry = geos[p] ?? geos[0]; slot.tail.material = tails[p] ?? tails[0];
  }
  function dispose(slots) {
    for (const s of slots) { s.line.geometry.dispose(); s.tail.geometry.dispose(); }
    for (const g of geos) g.dispose();
    sail.dispose(); string.dispose(); for (const m of tails) m.dispose();
  }
  return { make, setPattern, dispose };
}

/** Held model: a line spool plus the folded kite (userData.sail, hidden while the kite flies). <=80 tris. */
export function createKiteHeld(T, p) {
  const P = PATTERNS[p] ?? PATTERNS[0];
  const root = new T.Group(); root.name = 'kiteSpool';
  const inner = new T.Group(); root.add(inner);
  const wood = new T.MeshStandardMaterial({ color: 0xbb8650, roughness: 0.85 });
  const twine = new T.MeshStandardMaterial({ color: 0xd9c38c, roughness: 0.95 });
  const cloth = new T.MeshStandardMaterial({ color: new T.Color(P.a), roughness: 0.9 });
  const spool = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.12, 12), twine); // 48 tris
  spool.rotation.z = Math.PI / 2; inner.add(spool);
  const bar = new T.Mesh(new T.BoxGeometry(0.2, 0.025, 0.025), wood); bar.position.y = 0.0; inner.add(bar); // 12 tris
  const sail = new T.Mesh(new T.OctahedronGeometry(0.1, 0), cloth); // 8 tris: a slim folded diamond
  sail.scale.set(0.9, 3, 0.18); sail.position.set(0, 0.38, -0.02); sail.rotation.x = -0.15; inner.add(sail);
  root.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner), c = box.getCenter(new T.Vector3()), s = box.getSize(new T.Vector3());
  inner.position.sub(c);
  root.userData.grip = new T.Vector3(0, 0, 0).sub(c);
  root.userData.size = { x: s.x, y: s.y, z: s.z };
  root.userData.sail = sail;
  return root;
}
