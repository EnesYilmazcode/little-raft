// Held salvage hook model (first-person + thrown). ES module.
// Usage: import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b'; const g = createHook(THREE);
// Chunky molded-plastic hook head (sun-faded teal) on a tape-wrapped grip with dark plastic collars.
// Group is re-centered on its bounding box: ~0.62 wide (X), ~0.98 tall (Y), ~0.12 deep (Z).
// Handle at bottom (-Y), hook head at top (+Y); the head is a flat molded piece in the X-Y plane whose bend opens to -X.
// userData.viewScale: suggested extra scale for the first-person viewmodel (read by hands.js).
export function createHook(T) {
  const root = new T.Group();
  root.name = 'scrapHook';
  const inner = new T.Group();
  root.add(inner);
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const C = (h) => new T.Color(h);

  // ---------- grip tape texture (procedural DataTexture: works without a DOM) ----------
  // u = around the grip, v = along it. Overlapping helical tape bands with canvas weave and hand grime.
  const TW = 32, TH = 128, data = new Uint8Array(TW * TH * 4);
  {
    const tape = C(0xe6e4da), edge = C(0xb9b4a4), grime = C(0x9c9482), c = C(0);
    const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const u = x / TW, v = y / TH;
      const s = (v * 7 + u) % 1;                                  // 7 helical bands, one turn each
      const lap = s < 0.12 ? 1 - s / 0.12 : 0;                    // shadowed overlap edge
      const lip = s > 0.94 ? (s - 0.94) / 0.06 : 0;               // bright lifted lip
      const weave = ((x + y) % 2 ? 0.03 : -0.02) + (y % 4 === 0 ? -0.025 : 0) + (hash(x, y) - 0.5) * 0.05;
      const dirt = Math.max(0, Math.sin(u * 6.28 * 2 + v * 9) * 0.5 + 0.5 - v * 0.6) * 0.35 + hash(x >> 2, y >> 3) * 0.12;
      c.copy(tape).lerp(edge, lap * 0.75).lerp(grime, Math.min(0.6, dirt));
      const k = 1 + weave + lip * 0.06;
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
  const head = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.7, metalness: 0 });
  const tapeMat = new T.MeshStandardMaterial({ color: 0xffffff, map: tapeTex, roughness: 0.92, metalness: 0 });
  const darkPlastic = new T.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.62, metalness: 0 });
  const rope = new T.MeshStandardMaterial({ color: 0xb89a64, roughness: 0.95, metalness: 0 });

  const HX = 0.2; // handle axis X (hands.js grips the handle at (HX, -0.27, 0) in pre-centered coordinates)
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    inner.add(m);
    return m;
  };

  // ---------- 1. molded hook head: stem rising out of the collar, bending over into a wide J with a barbed point ----------
  const DEPTH = 0.06, BEV = 0.014;
  {
    const cx = HX - 0.19, cy = 0.2, RA = 0.19;            // bend arc center / radius (bend opens to -X)
    const center = [], width = [];
    const N = 26;
    for (let i = 0; i <= 6; i++) { const t = i / 6; center.push([HX, -0.08 + t * (cy + 0.08)]); width.push(0.078 - 0.004 * t); } // stem
    for (let i = 1; i <= N; i++) {                         // arc from 0 deg over the top to ~228 deg
      const t = i / N, a = t * 228 * Math.PI / 180;
      center.push([cx + RA * Math.cos(a), cy + RA * Math.sin(a)]);
      width.push(0.074 - 0.03 * t * t);
    }
    // offset the centerline to both sides
    const outer = [], innerS = [];
    for (let i = 0; i < center.length; i++) {
      const p = center[i], q = center[Math.min(i + 1, center.length - 1)], o = center[Math.max(i - 1, 0)];
      let tx = q[0] - o[0], ty = q[1] - o[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const nx = ty, ny = -tx;                              // right-hand normal = outer side of the bend
      const w = width[i] / 2;
      outer.push([p[0] + nx * w, p[1] + ny * w]); innerS.push([p[0] - nx * w, p[1] - ny * w]);
    }
    const last = center[center.length - 1], prev = center[center.length - 3];
    let dx = last[0] - prev[0], dy = last[1] - prev[1]; const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
    const tip = [last[0] + dx * 0.075, last[1] + dy * 0.075];
    const shape = new T.Shape();
    shape.moveTo(outer[0][0], outer[0][1]);
    outer.forEach((p) => shape.lineTo(p[0], p[1]));
    shape.lineTo(tip[0], tip[1]);
    // barb: juts back toward the bend center from the inner side, just behind the point
    const ib = innerS[innerS.length - 1], ib2 = innerS[innerS.length - 4];
    const bx = cx - ib[0], by = cy - ib[1], bl = Math.hypot(bx, by);
    shape.lineTo(ib[0] + (bx / bl) * 0.045 - dx * 0.01, ib[1] + (by / bl) * 0.045 - dy * 0.01);
    shape.lineTo(ib2[0], ib2[1]);
    for (let i = innerS.length - 5; i >= 0; i--) shape.lineTo(innerS[i][0], innerS[i][1]);
    shape.closePath();
    // lightening hole through the stem (salvaged moulding)
    const hole = new T.Path(); hole.absarc(HX, 0.06, 0.019, 0, Math.PI * 2, true); shape.holes.push(hole);

    const g = new T.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 2, curveSegments: 12 });
    g.translate(0, 0, -DEPTH / 2);
    // sun-faded teal: paler on the exposed crown and outer rim, deeper and scuffed lower down
    const pos = g.attributes.position, cols = [];
    const base = C(0x2f8f8a), faded = C(0x6fb3a8), deep = C(0x226f6b), scuff = C(0x9cc7bd), c = C(0);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const sun = Math.min(1, Math.max(0, (y - 0.05) / 0.38)) * 0.55;
      const n = Math.sin(x * 61 + y * 37) * Math.sin(y * 53 - z * 29);
      c.copy(base).lerp(faded, sun).lerp(deep, Math.max(0, -y) * 1.8);
      if (n > 0.82) c.lerp(scuff, (n - 0.82) * 2.2);
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    add(g, head);
  }

  // ---------- 2. dark zip-tie lash around the stem ----------
  add(new T.BoxGeometry(0.096, 0.024, DEPTH + 2 * BEV + 0.014), darkPlastic, HX, 0.135, 0);

  // ---------- 3. upper collar (dark plastic socket the head is pushed into) ----------
  const collar = new T.LatheGeometry([
    [0.046, -0.135], [0.06, -0.13], [0.062, -0.105], [0.056, -0.1], [0.056, -0.085], [0.064, -0.08], [0.064, -0.055], [0.05, -0.048],
  ].map(([r, y]) => new T.Vector2(r, y)), 18);
  add(collar, darkPlastic, HX, 0, 0);

  // ---------- 4. tape-wrapped grip (lumpy helical overlaps in the geometry too) ----------
  const gTop = -0.135, gBot = -0.40, gLen = gTop - gBot, GR = 0.048;
  const gGeo = new T.CylinderGeometry(GR, GR + 0.002, gLen, 18, 24, true);
  {
    const pos = gGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const u = (Math.atan2(x, z) / (Math.PI * 2) + 1) % 1, v = (y + gLen / 2) / gLen;
      const s = (v * 7 + u) % 1;
      const k = 1 + (s < 0.12 ? 0.06 * (s / 0.12) : 0.06 - 0.03 * (s - 0.12)); // each band thickens toward its overlap
      pos.setX(i, x * k); pos.setZ(i, z * k);
    }
    gGeo.computeVertexNormals();
  }
  add(gGeo, tapeMat, HX, (gTop + gBot) / 2, 0);

  // ---------- 5. butt cap (dark plastic) ----------
  const butt = new T.LatheGeometry([
    [0.001, -0.44], [0.05, -0.438], [0.062, -0.428], [0.064, -0.405], [0.054, -0.395], [0.044, -0.39],
  ].map(([r, y]) => new T.Vector2(r, y)), 18);
  add(butt, darkPlastic, HX, 0, 0);

  // ---------- 6. rope lashing: tied loop under the collar (where the throw line is made fast) ----------
  const band = add(new T.TorusGeometry(0.056, 0.009, 6, 22), rope, HX, -0.148, 0); band.rotation.x = Math.PI / 2;
  add(new T.SphereGeometry(0.018, 8, 6), rope, HX + 0.058, -0.152, 0.012);

  // Meshes: head, lash, collar, grip, butt, band, knot = 7

  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });

  // ---------- recenter on bounding box ----------
  inner.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner);
  const center = box.getCenter(V());
  inner.position.sub(center);
  const size = box.getSize(V());
  root.userData.size = { x: size.x, y: size.y, z: size.z };
  root.userData.viewScale = 1.3;
  root.userData.orientation = 'handle -Y, hook head +Y, flat head in the X-Y plane, bend opens to -X';
  return root;
}
