// Held Spyglass model (own procedural art, MODEL-STYLE handheld tool). ES module.
// createSpyglassModel(T) -> Group: grip at the origin (on the draw tube, by the eyepiece), tube along +Y
//   (lens end), eyepiece at -Y.
//   Dark wooden body, brass draw tube, brass rings at both ends and one mid, slightly flared lens end with
//   a pale polished-plastic lens. Bevelled lathe cylinders, colour in vertex colours, merged into
//   2 meshes (wood + brass), ~0.34 m long, well under 900 triangles.
//   userData = {kind:'spyglass', grip:Vector3(0,0,0), size:{x,y,z}, height}.
import { mergeGeometries } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

const SEG = 12;
const WOOD = 0x6b4529, WOOD_LT = 0x845a37, BRASS = 0xc9a15a, BRASS_SH = 0x8a6a32, LENS = 0xcfe8ea;

// Solid bevelled cylinder from y0 to y1, radius r0 at the bottom and r1 at the top, bevel b.
function tube(T, y0, y1, r0, r1, b) {
  const P = T.Vector2;
  const pts = [new P(0, y0), new P(r0 - b, y0), new P(r0, y0 + b), new P(r1, y1 - b), new P(r1 - b, y1), new P(0, y1)];
  return new T.LatheGeometry(pts, SEG);
}
// Vertex colours: base colour, shaded toward `shade` on the lower part (k = 0 top .. 1 bottom of the part).
function paint(T, g, base, shade, amount) {
  const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
  const a = new T.Color(base), s = new T.Color(shade), c = new T.Color();
  g.computeBoundingBox();
  const lo = g.boundingBox.min.y, hi = g.boundingBox.max.y, span = hi - lo || 1;
  for (let i = 0; i < n; i++) {
    const k = (hi - pos.getY(i)) / span;
    c.copy(a).lerp(s, amount * k);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  return g;
}

export function createSpyglassModel(T) {
  const root = new T.Group(); root.name = 'spyglass';
  const wood = [
    paint(T, tube(T, 0.02, 0.22, 0.0235, 0.026, 0.003), WOOD_LT, WOOD, 0.8),          // wooden body, wider toward the lens
  ];
  const lens = new T.CircleGeometry(0.0235, SEG).rotateX(-Math.PI / 2).translate(0, 0.2655, 0);
  const brass = [
    paint(T, tube(T, -0.075, -0.058, 0.0155, 0.0165, 0.003), BRASS, BRASS_SH, 0.6),     // eyepiece cap
    paint(T, tube(T, -0.06, 0.02, 0.019, 0.019, 0.002), BRASS, BRASS_SH, 0.45),        // draw tube
    paint(T, tube(T, 0.005, 0.028, 0.0275, 0.0275, 0.004), BRASS, BRASS_SH, 0.5),     // rear ring
    paint(T, tube(T, 0.112, 0.126, 0.0272, 0.0272, 0.003), BRASS, BRASS_SH, 0.4),       // mid ring
    paint(T, tube(T, 0.214, 0.265, 0.0275, 0.031, 0.004), BRASS, BRASS_SH, 0.5),        // flared lens end
    paint(T, lens, LENS, 0x8fb8c0, 0),                                                   // polished plastic lens
  ];
  const woodMat = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8 });
  const brassMat = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.38, metalness: 0.6, flatShading: true });
  const wm = new T.Mesh(mergeGeometries(T, wood), woodMat); wm.name = 'spyglassWood';
  const bm = new T.Mesh(mergeGeometries(T, brass), brassMat); bm.name = 'spyglassBrass';
  for (const g of [...wood, ...brass]) g.dispose();
  root.add(wm, bm);
  const box = new T.Box3().setFromObject(root), size = box.getSize(new T.Vector3());
  root.userData = { kind: 'spyglass', grip: new T.Vector3(0, 0, 0), size: { x: size.x, y: size.y, z: size.z }, height: size.y };
  return root;
}
