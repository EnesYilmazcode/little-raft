// Held raft-building hammer model (first-person). ES module, procedural only.
// Usage: import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b'; const g = createHammer(THREE);
// Root group is re-centered on its bounding box (origin = box center).
// Orientation: handle along Y with the butt at -Y, head at +Y.
//   Head axis runs along Z: square striking face points -Z (forward), split claw points +Z.
// Size: ~0.81 tall (Y, incl. lanyard loop), ~0.29 long (Z), ~0.05 wide (X).
// userData.grip         Vector3: center of the rope grip, in root space (put the hand here)
// userData.strikeFace   Vector3: center of the striking face, in root space
// userData.strikeNormal Vector3: outward normal of the striking face (0,0,-1)
// userData.clawTip      Vector3: tip of the claw, in root space
// userData.firstPerson  suggested camera-space pose for a right-hand hold (tune in game)
// Meshes: handle, head, face, collar (+ wedge), rivets, rope wrap, rope ties = 7.
export function createHammer(T) {
  const root = new T.Group();
  root.name = 'buildHammer';
  const inner = new T.Group();
  root.add(inner);

  // ---------- deterministic helpers ----------
  let seed = 0x5eed1234;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = t => t * t * (3 - 2 * t);
  const interp = (keys, y) => {
    if (y <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (y <= keys[i][0]) {
        const [y0, a] = keys[i - 1], [y1, b] = keys[i];
        return a + (b - a) * smooth((y - y0) / (y1 - y0));
      }
    }
    return keys[keys.length - 1][1];
  };
  const noise = (x, y, z) =>
    Math.sin(x * 91.3 + Math.sin(y * 57.1) * 2.0) * Math.sin(y * 73.7 + Math.sin(z * 63.9) * 2.0) *
    Math.sin(z * 81.1 + Math.sin(x * 49.3) * 2.0);

  // merge geometries into one non-indexed geometry (position, normal, optional color)
  const merge = list => {
    const parts = list.map(g => {
      const n = g.index ? g.toNonIndexed() : g;
      if (n !== g) g.dispose();
      return n;
    });
    const withColor = parts.every(p => p.attributes.color);
    let count = 0;
    for (const p of parts) count += p.attributes.position.count;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    const col = withColor ? new Float32Array(count * 3) : null;
    let o = 0;
    for (const p of parts) {
      pos.set(p.attributes.position.array, o);
      nor.set(p.attributes.normal.array, o);
      if (col) col.set(p.attributes.color.array, o);
      o += p.attributes.position.count * 3;
      p.dispose();
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(nor, 3));
    if (col) g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  };

  // ---------- materials (own instances) ----------
  const timber = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0.0 });
  const headSteel = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, metalness: 0.7 });
  const faceSteel = new T.MeshStandardMaterial({ color: 0x8e9599, roughness: 0.45, metalness: 0.7 });
  const collarSteel = new T.MeshStandardMaterial({ color: 0x3f4549, roughness: 0.45, metalness: 0.7 });
  const rivetSteel = new T.MeshStandardMaterial({ color: 0x8a8f90, roughness: 0.45, metalness: 0.7 });
  const rope = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0.0 });
  const ropeDark = new T.MeshStandardMaterial({ color: 0x7d6642, roughness: 0.95, metalness: 0.0 });

  const add = (geo, mat, name) => {
    const m = new T.Mesh(geo, mat);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = false;
    inner.add(m);
    return m;
  };

  // ---------- layout constants (local space, butt at y=0) ----------
  const TOP = 0.782;          // top of handle end grain (pokes through the head eye)
  const HY = 0.725;           // head eye center height
  const OVAL = 0.72;          // handle cross-section: X radius = Z radius * OVAL
  const WRAP_BOT = 0.06, WRAP_TOP = 0.30, GRIP_Y = (WRAP_BOT + WRAP_TOP) / 2;
  const COLLAR_Y = 0.648, COLLAR_H = 0.048;
  // handle radius (Z axis) along its length
  const R_KEYS = [
    [0.0, 0.0225], [0.03, 0.0235], [0.10, 0.0196], [0.30, 0.0186],
    [0.48, 0.0172], [0.60, 0.0194], [0.68, 0.0205], [0.70, 0.019], [0.80, 0.019],
  ];
  const R = y => interp(R_KEYS, y);

  // ================= 1. worn wooden handle =================
  {
    const ys = [0, 0.0008, 0.003, 0.006, 0.01];
    for (let y = 0.016; y < TOP - 0.004; y += 0.012) ys.push(y);
    const pts = [];
    const capR = 0.01;
    for (const y of ys) {
      let r = R(y);
      if (y < capR) r *= Math.sqrt(Math.max(0, 1 - ((capR - y) / capR) ** 2));
      pts.push(new T.Vector2(r, y));
    }
    pts.push(new T.Vector2(R(TOP) * 0.98, TOP - 0.002));
    pts.push(new T.Vector2(R(TOP) * 0.84, TOP));
    pts.push(new T.Vector2(0, TOP));
    const geo = new T.LatheGeometry(pts, 22);

    // chips / nicks: small scooped dents in exposed wood (not under rope or inside head)
    const chips = [];
    for (let i = 0; i < 11; i++) {
      const lower = i < 2;
      chips.push({
        a: rnd() * Math.PI * 2 - Math.PI,
        y: lower ? 0.014 + rnd() * 0.03 : 0.32 + rnd() * 0.28,
        s: 0.006 + rnd() * 0.007,
        d: 0.0018 + rnd() * 0.0022,
      });
    }
    // long shallow gouge (old tool slip)
    chips.push({ a: 1.9, y: 0.43, s: 0.012, d: 0.0016, stretch: 0.35 });

    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const base = new T.Color(0x8a6840), dark = new T.Color(0x553b22), grey = new T.Color(0xa39883);
    const fresh = new T.Color(0xc8a674), grime = new T.Color(0x4a3726), endGrain = new T.Color(0x6a4e30);
    const c = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      let r = Math.hypot(x, z);
      const ang = Math.atan2(x, z);
      let chipK = 0;
      if (r > 1e-5) {
        // whittled irregularity
        r *= 1 + 0.018 * Math.sin(ang * 3 + y * 21) + 0.01 * Math.sin(ang * 7 - y * 47);
        for (const ch of chips) {
          let da = ang - ch.a;
          da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
          const dy = (y - ch.y) * (ch.stretch || 1);
          const d = Math.hypot(da * r, dy) / ch.s;
          if (d < 1) {
            const k = 1 - d * d;
            r -= ch.d * k;
            chipK = Math.max(chipK, k);
          }
        }
        pos.setXYZ(i, Math.sin(ang) * r * OVAL, y, Math.cos(ang) * r);
      }
      // colour: grain streaks, sun-greying, hand grime, fresh wood in chips
      const grain = 0.5 + 0.5 * Math.sin(ang * 13 + 3 * Math.sin(y * 9) + 2 * Math.sin(y * 31 + ang));
      const crack = Math.pow(Math.abs(Math.sin(ang * 5 + y * 2.3)), 60);
      const weather = (0.5 + 0.5 * Math.sin(y * 7 + ang * 2)) * (0.25 + 0.35 * clamp01((y - 0.3) / 0.35));
      c.copy(base).lerp(dark, grain * 0.4 + crack * 0.5).lerp(grey, weather);
      const nearGrip = clamp01(1 - Math.abs(y - GRIP_Y) / 0.17);
      c.lerp(grime, nearGrip * 0.35 + clamp01((0.03 - y) / 0.03) * 0.3);
      if (chipK > 0) c.lerp(fresh, chipK * 0.85);
      if (y > TOP - 0.0005 && r < R(TOP) * 0.85) {
        const ring = 0.5 + 0.5 * Math.sin(r * 900);
        c.copy(endGrain).lerp(dark, ring * 0.5);
      }
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    add(geo, timber, 'handle');
  }

  // ================= 2. steel wedge in handle top (merged into the collar mesh below) =================
  const wedgeGeo = new T.BoxGeometry(0.0034, 0.004, 0.024);
  wedgeGeo.translate(0, TOP, 0);

  // ================= 3. forged head body + split claw =================
  const extrudeX = (shape, depth, bev, bevT, curveSeg) => {
    const g = new T.ExtrudeGeometry(shape, {
      depth, steps: 1, curveSegments: curveSeg, bevelEnabled: true,
      bevelThickness: bevT, bevelSize: bev, bevelOffset: 0, bevelSegments: 2,
    });
    g.translate(0, 0, -depth / 2);
    g.rotateY(-Math.PI / 2); // shape u -> world Z, extrusion -> world X
    return g;
  };
  {
    // side profile (u = Z, v = Y relative to eye center)
    const s = new T.Shape();
    s.moveTo(-0.12, -0.022);
    s.lineTo(-0.12, 0.022);
    s.lineTo(-0.10, 0.019);
    s.lineTo(-0.078, 0.018);
    s.lineTo(-0.0725, 0.0148); // small forging nick on the neck
    s.lineTo(-0.0675, 0.018);
    s.lineTo(-0.052, 0.019);
    s.quadraticCurveTo(-0.040, 0.020, -0.036, 0.040);
    s.lineTo(-0.030, 0.044);
    s.lineTo(0.030, 0.044);
    s.lineTo(0.037, 0.039);
    s.lineTo(0.038, -0.036);
    s.lineTo(0.030, -0.044);
    s.lineTo(-0.030, -0.044);
    s.lineTo(-0.036, -0.040);
    s.quadraticCurveTo(-0.040, -0.020, -0.052, -0.019);
    s.lineTo(-0.10, -0.019);
    s.lineTo(-0.12, -0.022);
    const body = extrudeX(s, 0.034, 0.004, 0.004, 8);

    // claw prong profile: curves back (+Z) and down toward the handle
    const cs = new T.Shape();
    cs.moveTo(0.02, 0.040);
    cs.quadraticCurveTo(0.10, 0.042, 0.158, -0.034);
    cs.lineTo(0.155, -0.043);
    cs.lineTo(0.149, -0.041); // chipped tip
    cs.quadraticCurveTo(0.09, 0.0, 0.02, -0.022);
    cs.lineTo(0.02, 0.040);
    const prongs = [];
    for (const side of [1, -1]) {
      const p = extrudeX(cs, 0.011, 0.0015, 0.002, 14);
      p.translate(0, 0, -0.035);
      p.rotateY(side * 0.035); // splay so the nail slot widens toward the tips
      p.translate(side * 0.0105, 0, 0.035);
      prongs.push(p);
    }
    const geo = merge([body, ...prongs]);
    geo.translate(0, HY, 0);

    // vertex colours: dark forged steel, bright worn edges, salt rust specks
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const cols = new Float32Array(pos.count * 3);
    const base = new T.Color(0x4d5458), worn = new T.Color(0x9da3a6), rust = new T.Color(0x77502f), scale = new T.Color(0x2c3134);
    const c = new T.Color();
    const spots = [];
    for (let i = 0; i < 6; i++) spots.push(new T.Vector3((rnd() - 0.5) * 0.04, HY + (rnd() - 0.5) * 0.08, -0.1 + rnd() * 0.24));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
      const edge = clamp01((1 - Math.max(nx, ny, nz)) * 3.2);
      const n = noise(x * 3, y * 3, z * 3);
      c.copy(base).lerp(scale, clamp01(n * 0.8 + 0.2) * 0.5);
      let w = edge * 0.75;
      w += clamp01((z - 0.12) / 0.04) * 0.6;        // claw tips worn from prying
      w += clamp01((-0.105 - z) / 0.02) * 0.5;      // neck near the face
      for (const sp of spots) {
        const d = Math.hypot(x - sp.x, y - sp.y, z - sp.z);
        if (d < 0.009) w += (1 - d / 0.009) * 0.6;   // bright chips
      }
      c.lerp(worn, clamp01(w));
      const r = clamp01((noise(x * 5 + 1.7, y * 5, z * 5 - 0.6) - 0.45) * 4) * (0.5 + 0.5 * clamp01((HY - y) / 0.04));
      c.lerp(rust, r * 0.7);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(cols, 3));
    add(geo, headSteel, 'head');
  }

  // ================= 4. square striking face (chipped corner) =================
  const FACE_Z = -0.134;
  {
    const h = 0.024, ch = 0.005;
    const s = new T.Shape();
    s.moveTo(-h, -h);
    s.lineTo(h, -h);
    s.lineTo(h, h - ch);
    s.lineTo(h - ch, h); // chipped corner
    s.lineTo(-h, h);
    s.lineTo(-h, -h);
    const geo = new T.ExtrudeGeometry(s, {
      depth: 0.008, steps: 1, curveSegments: 1, bevelEnabled: true,
      bevelThickness: 0.002, bevelSize: 0.002, bevelOffset: 0, bevelSegments: 2,
    });
    geo.translate(0, HY, FACE_Z + 0.002); // bevel spans z -0.002..0.010 -> FACE_Z .. FACE_Z + 0.012
    add(geo, faceSteel, 'strikingFace');
  }

  // ================= 5. riveted steel collar =================
  {
    const rz = R(COLLAR_Y) + 0.0026;
    const geo = new T.CylinderGeometry(rz * 1.02, rz, COLLAR_H, 18, 1);
    geo.scale(OVAL, 1, 1);
    geo.translate(0, COLLAR_Y, 0);
    add(merge([geo, wedgeGeo]), collarSteel, 'collar');

    // ================= 6. rivets (merged) =================
    const parts = [];
    const rx = rz * OVAL * 1.02;
    for (const side of [1, -1]) {
      for (const dz of [-0.0085, 0.0085]) {
        for (const dy of [-0.012, 0.012]) {
          const g = new T.SphereGeometry(0.0033, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
          g.scale(1, 0.6, 1);
          g.rotateZ(-side * Math.PI / 2);
          g.translate(side * rx, COLLAR_Y + dy, dz);
          parts.push(g);
        }
      }
    }
    add(merge(parts), rivetSteel, 'rivets');
  }

  // ================= 7. rope-wrapped grip =================
  const ROPE_R = 0.0048;
  const ropeX = y => R(y) * OVAL + ROPE_R * 0.8;
  const ropeZ = y => R(y) + ROPE_R * 0.8;
  {
    class Wrap extends T.Curve {
      constructor(turns) { super(); this.turns = turns; }
      getPoint(t, out = new T.Vector3()) {
        const y = WRAP_BOT + (WRAP_TOP - WRAP_BOT) * t;
        const a = t * this.turns * Math.PI * 2;
        return out.set(Math.cos(a) * ropeX(y), y, Math.sin(a) * ropeZ(y));
      }
    }
    const turns = 23;
    const tub = turns * 14, rad = 6;
    const geo = new T.TubeGeometry(new Wrap(turns), tub, ROPE_R, rad, false);
    const n = geo.attributes.position.count;
    const cols = new Float32Array(n * 3);
    const base = new T.Color(0xae9464), hi = new T.Color(0xcdb487), lo = new T.Color(0x6f5a38);
    const c = new T.Color();
    for (let i = 0; i < n; i++) {
      const j = Math.floor(i / (rad + 1)), k = i % (rad + 1);
      const ply = Math.sin((k / rad) * Math.PI * 2 * 3 + j * 1.25); // 3-ply twist
      const dirt = 0.5 + 0.5 * Math.sin(j * 0.07) * Math.sin(j * 0.031 + 1.3);
      c.copy(base).lerp(ply > 0 ? hi : lo, Math.abs(ply) * 0.55).lerp(lo, dirt * 0.25);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(cols, 3));
    add(geo, rope, 'ropeGrip');
  }

  // ================= 8. rope ties, knot, tail, butt lanyard (merged) =================
  {
    const parts = [];
    const band = y => {
      const rzB = R(y) + 0.0048;
      const g = new T.TorusGeometry(rzB, 0.0042, 6, 24);
      g.rotateX(Math.PI / 2);
      g.scale((R(y) * OVAL + 0.0048) / rzB, 1, 1);
      g.translate(0, y, 0);
      parts.push(g);
    };
    band(WRAP_BOT - 0.004); band(WRAP_BOT - 0.0115);
    band(WRAP_TOP + 0.004); band(WRAP_TOP + 0.0115);

    // knot on the inner (-X) side, visible from a right-hand first-person view
    const kx = -(R(WRAP_TOP) * OVAL + 0.008), ky = WRAP_TOP + 0.008;
    const knot = new T.SphereGeometry(0.0072, 8, 6);
    knot.scale(1, 0.8, 1.1);
    knot.translate(kx, ky, 0.0);
    parts.push(knot);
    const tail = new T.CatmullRomCurve3([
      new T.Vector3(kx, ky, 0.0),
      new T.Vector3(kx - 0.004, ky - 0.018, 0.004),
      new T.Vector3(kx - 0.007, ky - 0.038, 0.002),
      new T.Vector3(kx - 0.008, ky - 0.052, -0.003),
    ]);
    parts.push(new T.TubeGeometry(tail, 14, 0.0032, 5, false));
    // frayed tail end
    const fray = new T.ConeGeometry(0.0042, 0.008, 5);
    fray.rotateX(Math.PI);
    fray.translate(kx - 0.008, ky - 0.056, -0.003);
    parts.push(fray);

    // lanyard loop through the butt
    const loop = new T.TorusGeometry(0.016, 0.0028, 6, 20);
    loop.rotateY(Math.PI / 2);
    loop.translate(0, -0.006, 0);
    parts.push(loop);

    add(merge(parts), ropeDark, 'ropeTies');
  }

  // ---------- recenter on bounding box ----------
  inner.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner);
  const center = box.getCenter(new T.Vector3());
  inner.position.sub(center);
  const size = box.getSize(new T.Vector3());

  root.userData.size = { x: size.x, y: size.y, z: size.z };
  root.userData.grip = new T.Vector3(0, GRIP_Y, 0).sub(center);
  root.userData.strikeFace = new T.Vector3(0, HY, FACE_Z).sub(center);
  root.userData.strikeNormal = new T.Vector3(0, 0, -1);
  root.userData.clawTip = new T.Vector3(0, HY - 0.038, 0.158).sub(center);
  root.userData.orientation = 'handle -Y, head +Y, striking face -Z (forward), claw +Z';
  // Suggested right-hand hold in camera space (camera looks down -Z). Tune in game.
  root.userData.firstPerson = {
    position: new T.Vector3(0.3, -0.3, -0.55),
    rotation: new T.Euler(-0.25, 0.2, 0.22),
  };
  return root;
}
