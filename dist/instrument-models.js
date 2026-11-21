// [instruments] Held instrument models (own procedural art). Imports nothing; THREE is passed in as T.
// buildInstrument(T, kind) -> Group for 'drum' | 'pipes' | 'bells' (own geometries + materials, origin at the grip),
// or null for any other kind. held-items.js fits and scales it for the first-person viewmodel.

function mat(T, color, o = {}) { return new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.7, metalness: 0 }, o)); }
function mesh(T, g, geo, m, name, x = 0, y = 0, z = 0) {
  const o = new T.Mesh(geo, m); o.name = name; o.position.set(x, y, z); g.add(o); return o;
}

function drum(T) {
  const g = new T.Group();
  const wood = mat(T, 0x9c7649, { side: T.DoubleSide, roughness: 0.75 }), leaf = mat(T, 0x7da35a, { roughness: 0.65 }), rope = mat(T, 0xc9a46a, { roughness: 0.8 });
  mesh(T, g, new T.CylinderGeometry(0.11, 0.09, 0.12, 12, 1, true), wood, 'drumBody', 0, 0.06, 0);
  const head = mesh(T, g, new T.CircleGeometry(0.112, 16), leaf, 'drumHead', 0, 0.121, 0); head.rotation.x = -Math.PI / 2;
  const base = mesh(T, g, new T.CircleGeometry(0.09, 12), wood, 'drumBase', 0, 0.001, 0); base.rotation.x = Math.PI / 2;
  const lashGeo = new T.TorusGeometry(0.1, 0.006, 5, 20);
  for (const y of [0.025, 0.06, 0.095]) {
    const l = mesh(T, g, lashGeo, rope, 'drumLash', 0, y, 0); l.rotation.x = Math.PI / 2;
    l.scale.setScalar((0.09 + 0.02 * (y / 0.12)) / 0.1 + 0.03); // hug the taper, just proud of the wood
  }
  return g;
}

function pipes(T) {
  const g = new T.Group();
  const plastic = mat(T, 0x8fc3c9, { roughness: 0.6 }), dark = mat(T, 0x6aa6ad, { roughness: 0.6 }), rope = mat(T, 0xc9a46a, { roughness: 0.8 });
  const lens = [0.16, 0.14, 0.12, 0.1, 0.08];
  lens.forEach((h, i) => mesh(T, g, new T.CylinderGeometry(0.012, 0.012, h, 10), i % 2 ? dark : plastic, 'pipe' + i, (i - 2) * 0.028, -h / 2, 0)); // tops at y = 0
  mesh(T, g, new T.BoxGeometry(0.14, 0.016, 0.03), rope, 'pipeBand', 0, -0.03, 0);
  return g;
}

function bells(T) { // a little glockenspiel: brass bars stepping down in length on two wooden rails
  const g = new T.Group();
  const wood = mat(T, 0x7a5432, { roughness: 0.75 }), head = mat(T, 0xd9573f, { roughness: 0.6 });
  const brass = mat(T, 0xd9a93e, { metalness: 0.35, roughness: 0.3, emissive: 0x3a2806 }); // reads as brass without an env map
  const lens = [0.1, 0.088, 0.076, 0.064, 0.052, 0.042];
  // rails converge with the bars, like a real glockenspiel frame
  for (const s of [-1, 1]) {
    const r = mesh(T, g, new T.BoxGeometry(0.22, 0.014, 0.012), wood, s < 0 ? 'rail0' : 'rail1', 0, 0, s * 0.036);
    r.rotation.y = s * 0.1;
  }
  lens.forEach((l, i) => mesh(T, g, new T.BoxGeometry(0.024, 0.008, l), brass, 'bar' + i, -0.085 + i * 0.034, 0.011, 0));
  const mallet = new T.Group(); mallet.name = 'mallet';
  mesh(T, mallet, new T.CylinderGeometry(0.004, 0.004, 0.1, 6), wood, 'malletStick', 0, 0.05, 0);
  mesh(T, mallet, new T.SphereGeometry(0.012, 10, 8), head, 'malletHead', 0, 0.1, 0);
  mallet.position.set(-0.03, 0.024, 0.06); mallet.rotation.set(0, 0, 1.25); // resting across the long bars, in front
  g.add(mallet);
  g.userData.gripFrac = [0.42, 0, 0]; // right fist on the short (+x) end; the long bars reach toward screen centre
  return g;
}

const BUILDERS = { drum, pipes, bells };

export function buildInstrument(T, kind) {
  const b = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(BUILDERS, kind) ? BUILDERS[kind] : null;
  if (!b) return null;
  const g = b(T); g.name = 'instrument_' + kind; g.userData.instrument = kind;
  return g;
}

export default buildInstrument;
