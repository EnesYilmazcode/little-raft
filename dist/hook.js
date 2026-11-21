// Held salvage hook model (first-person, thrown and icon). ES module.
// Usage: import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b'; const g = createHook(THREE);
import { mergeChildMeshes } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';
// A moulded plastic hook head (sun-faded teal, matte, scuffed) swept along a smooth J with a rounded-square
// profile, pushed into a dark plastic collar on a white tape-wrapped grip with a dark butt cap.
// Group is re-centered on its bounding box: ~0.47 wide (X), ~0.84 tall (Y), ~0.11 deep (Z).
// Handle at bottom (-Y), hook head at top (+Y); the head lies in the X-Y plane and its bend opens to -X.
// userData.gripRadius: tape radius in model units (hands.js sizes the fist to it).
// userData.viewScale: extra scale for the first-person viewmodel (read by hands.js).
export function createHook(T) {
  const root = new T.Group();
  root.name = 'scrapHook';
  const inner = new T.Group();
  root.add(inner);
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const C = (h) => new T.Color(h);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

  // ---------- grip tape texture (procedural DataTexture: works without a DOM) ----------
  // u = around the grip, v = along it. Overlapping helical tape bands with a fine weave and hand grime.
  const TW = 32, TH = 128, data = new Uint8Array(TW * TH * 4);
  {
    const tape = C(0xeeece4), edge = C(0xc4c0b2), grime = C(0xa59d8a), c = C(0);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const u = x / TW, v = y / TH;
      const s = (v * 7 + u) % 1;                                  // 7 helical bands, one turn each
      const lap = s < 0.12 ? 1 - s / 0.12 : 0;                    // shadowed overlap edge
      const lip = s > 0.94 ? (s - 0.94) / 0.06 : 0;               // bright lifted lip
      const weave = ((x + y) % 2 ? 0.025 : -0.015) + (y % 4 === 0 ? -0.02 : 0) + (hash(x, y) - 0.5) * 0.04;
      const dirt = Math.max(0, Math.sin(u * 6.28 * 2 + v * 9) * 0.5 + 0.5 - v * 0.6) * 0.28 + hash(x >> 2, y >> 3) * 0.1;
      c.copy(tape).lerp(edge, lap * 0.7).lerp(grime, Math.min(0.5, dirt));
      const k = 1 + weave + lip * 0.05;
      c.convertLinearToSRGB();
      const i = (y * TW + x) * 4;
      data[i] = Math.min(255, c.r * 255 * k); data[i + 1] = Math.min(255, c.g * 255 * k); data[i + 2] = Math.min(255, c.b * 255 * k); data[i + 3] = 255;
    }
  }
  const tapeTex = new T.DataTexture(data, TW, TH, T.RGBAFormat);
  tapeTex.colorSpace = T.SRGBColorSpace; tapeTex.wrapS = tapeTex.wrapT = T.RepeatWrapping;
  tapeTex.magFilter = T.LinearFilter; tapeTex.minFilter = T.LinearFilter; tapeTex.generateMipmaps = false;
  tapeTex.needsUpdate = true;

  // ---------- materials (matte plastics, no metal) ----------
  const headMat = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.7, metalness: 0 });
  const tapeMat = new T.MeshStandardMaterial({ color: 0xffffff, map: tapeTex, roughness: 0.9, metalness: 0 });
  const darkPlastic = new T.MeshStandardMaterial({ color: 0x252626, roughness: 0.66, metalness: 0 });
  const rope = new T.MeshStandardMaterial({ color: 0xb89a64, roughness: 0.95, metalness: 0 });

  const HX = 0.2; // handle axis X (hands.js grips the handle at (HX, -0.27, 0) in pre-centered coordinates)
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    inner.add(m);
    return m;
  };

  // Sweep a rounded-square profile along a planar (X-Y) centerline. prof(s) -> [width in plane, depth in Z].
  // Superellipse cross-section (exponent ~3) reads as a moulded part with soft bevels rather than a pipe.
  const sweep = (pts, prof, radial = 18, capEnd = true) => {
    const n = pts.length, pos = [], idx = [];
    const ring = [];
    for (let k = 0; k < radial; k++) {
      const th = (k / radial) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th), e = 2 / 3.2;
      ring.push([Math.sign(c) * Math.pow(Math.abs(c), e), Math.sign(s) * Math.pow(Math.abs(s), e)]);
    }
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[Math.min(i + 1, n - 1)], o = pts[Math.max(i - 1, 0)];
      let tx = q[0] - o[0], ty = q[1] - o[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const nx = ty, ny = -tx;                                  // in-plane normal (outer side of the bend)
      const [w, d] = prof(i / (n - 1));
      for (const [a, b] of ring) pos.push(p[0] + nx * a * w / 2, p[1] + ny * a * w / 2, b * d / 2);
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < radial; k++) {
      const a = i * radial + k, b = i * radial + (k + 1) % radial, c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
    if (capEnd) {                                             // close the open start with a fan (hidden in the collar)
      const ci = pos.length / 3; pos.push(pts[0][0], pts[0][1], 0);
      for (let k = 0; k < radial; k++) idx.push(ci, (k + 1) % radial, k);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // ---------- 1. moulded hook head: stem out of the collar, smooth J bend, tapered point ----------
  const cx = HX - 0.15, cy = 0.17, RA = 0.15;                   // bend arc center / radius (opens to -X)
  const center = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14; center.push([HX, -0.07 + t * (cy + 0.07)]); }   // stem
  const ARC = 222, NA = 72;
  for (let i = 1; i <= NA; i++) { const a = (i / NA) * ARC * Math.PI / 180; center.push([cx + RA * Math.cos(a), cy + RA * Math.sin(a)]); }
  for (let i = 1; i <= 12; i++) {                             // point: keeps following the bend, curling in slightly
    const a = (ARC + i * 2.4) * Math.PI / 180, r = RA - 0.0012 * i;
    center.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const tipStart = (center.length - 26) / (center.length - 1);
  const headGeo = sweep(center, (s) => {
    const w0 = 0.082 - 0.016 * clamp01((s - 0.05) / 0.6);        // 0.082 at the stem -> 0.066 round the bend
    const d0 = 0.054 - 0.008 * clamp01((s - 0.05) / 0.6);
    const tp = clamp01((s - tipStart) / (1 - tipStart));         // taper to a blunt rounded point
    const k = Math.pow(1 - tp, 0.8) * (1 - 0.15 * tp) + 0.04;
    return [Math.max(0.004, w0 * k), Math.max(0.004, d0 * (0.35 + 0.65 * k))];
  });
  // barb: a short swept spur on the inner side just behind the point, raking back toward the stem
  let barbGeo;
  {
    const a = (ARC - 26) * Math.PI / 180;
    const bx = cx + (RA - 0.026) * Math.cos(a), by = cy + (RA - 0.026) * Math.sin(a);
    const dx = (cx - bx), dy = (cy - by), dl = Math.hypot(dx, dy);
    const tx = Math.sin(a), ty = -Math.cos(a);                    // back along the bend (toward the stem)
    const pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([bx + (dx / dl) * 0.05 * t + tx * 0.034 * t * t, by + (dy / dl) * 0.05 * t + ty * 0.034 * t * t]); }
    barbGeo = sweep(pts, (s) => [0.04 * Math.pow(1 - s, 0.9) + 0.004, 0.04 * (1 - 0.6 * s)], 12);
  }
  // sun-faded teal: paler on the exposed crown and outer rim, deeper lower down, a few pale scuffs and a faint mould seam
  const tint = (g) => {
    const pos = g.attributes.position, cols = [];
    const base = C(0x3d8f87), faded = C(0x86bcb0), deep = C(0x2b6f69), scuff = C(0xb5d3c9), seam = C(0x2f7973), c = C(0);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const sun = clamp01((y - 0.02) / 0.3) * 0.5 + clamp01(z / 0.024) * 0.12;
      c.copy(base).lerp(faded, sun).lerp(deep, clamp01(-y * 3));
      const qx = Math.round(x * 160), qy = Math.round(y * 160), qz = Math.round(z * 160);
      const h = hash(qx + qz * 7.3, qy - qz * 3.1), blot = hash(Math.round(x * 28), Math.round(y * 28) + Math.round(z * 28) * 5);
      if (blot > 0.8 && z > -0.01) c.lerp(scuff, (blot - 0.8) * 2.2 * (0.5 + 0.5 * h));   // worn pale patches on the exposed face
      if (Math.abs(z) < 0.003) c.lerp(seam, 0.35);                                     // mould parting line
      c.lerp(deep, h * 0.14);                                                          // fine grime mottling
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    return g;
  };
  add(tint(headGeo), headMat);
  add(tint(barbGeo), headMat);

  // ---------- 2. dark zip-tie lash around the stem (repair) ----------
  const tie = new T.LatheGeometry([[0.046, -0.008], [0.051, -0.007], [0.053, 0], [0.051, 0.007], [0.046, 0.008]].map(([r, y]) => new T.Vector2(r, y)), 20);
  const tieM = add(tie, darkPlastic, HX, 0.07, 0); tieM.scale.set(1, 1, 0.74);
  add(new T.BoxGeometry(0.02, 0.022, 0.018), darkPlastic, HX + 0.054, 0.07, 0.006);          // tie head

  // ---------- 3. upper collar (dark plastic socket the head is pushed into) ----------
  const collar = new T.LatheGeometry([
    [0.044, -0.138], [0.054, -0.134], [0.057, -0.12], [0.056, -0.1], [0.05, -0.094], [0.05, -0.086], [0.056, -0.08],
    [0.058, -0.066], [0.054, -0.054], [0.046, -0.048], [0.04, -0.046],
  ].map(([r, y]) => new T.Vector2(r, y)), 28);
  add(collar, darkPlastic, HX, 0, 0);

  // ---------- 4. tape-wrapped grip (lumpy helical overlaps in the geometry too) ----------
  const gTop = -0.135, gBot = -0.40, gLen = gTop - gBot, GR = 0.046;
  const gGeo = new T.CylinderGeometry(GR, GR + 0.002, gLen, 24, 28, true);
  {
    const pos = gGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const u = (Math.atan2(x, z) / (Math.PI * 2) + 1) % 1, v = (y + gLen / 2) / gLen;
      const s = (v * 7 + u) % 1;
      const k = 1 + (s < 0.12 ? 0.05 * (s / 0.12) : 0.05 - 0.025 * (s - 0.12)); // each band thickens toward its overlap
      pos.setX(i, x * k); pos.setZ(i, z * k);
    }
    gGeo.computeVertexNormals();
  }
  add(gGeo, tapeMat, HX, (gTop + gBot) / 2, 0);

  // ---------- 5. butt cap (dark plastic) ----------
  const butt = new T.LatheGeometry([
    [0.001, -0.438], [0.03, -0.437], [0.048, -0.432], [0.057, -0.42], [0.058, -0.406], [0.052, -0.397], [0.044, -0.393],
  ].map(([r, y]) => new T.Vector2(r, y)), 28);
  add(butt, darkPlastic, HX, 0, 0);

  // ---------- 6. rope lashing: tied loop under the collar (where the throw line is made fast) ----------
  const band = add(new T.TorusGeometry(0.052, 0.008, 6, 24), rope, HX, -0.146, 0); band.rotation.x = Math.PI / 2;
  add(new T.SphereGeometry(0.016, 8, 6), rope, HX + 0.054, -0.15, 0.012);

  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });

  // ---------- recenter on bounding box ----------
  inner.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner);
  const cen = box.getCenter(V());
  inner.position.sub(cen);
  const size = box.getSize(V());
  // Static parts never move relative to each other: one draw call per material (4).
  mergeChildMeshes(T, inner);
  root.userData.size = { x: size.x, y: size.y, z: size.z };
  root.userData.gripRadius = GR;
  root.userData.viewScale = 1.1;
  root.userData.orientation = 'handle -Y, hook head +Y, head in the X-Y plane, bend opens to -X';
  return root;
}
