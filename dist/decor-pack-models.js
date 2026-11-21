// Decoration pack models: Woven Deck Mat, Wind Pennant, Hanging Fern Post, Shell Chime, Rope Hammock,
// Clay Pot Trio and Signboard, plus the sign canvas painter. Each type's geometry is built lazily ONCE
// as one merged vertex-coloured geometry (plus one swinging part), shared by every instance.
// Shared geometry/material dispose() calls are no-ops so game.js rebuildRaft() cannot free them;
// dispose() below frees them for real.
// Local origin = tile top centre (the game places it at y = .22); the front faces +Z; footprint inside ±.9 m.

export const TYPES = Object.freeze(['rug', 'pennant', 'fern', 'chime', 'hammock', 'pots', 'sign']);
const TAU = Math.PI * 2;

/** Paint up to 3 lines of sign text with the canvas 2D API only (testable with a fake context). */
export function paintSign(g, lines, w = 256, h = 128) {
  const list = Array.isArray(lines) ? lines : [];
  g.globalAlpha = 1;
  g.fillStyle = '#c39a63'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#a97d4c'; g.globalAlpha = .45;
  for (let i = 0; i < 3; i++) g.fillRect(0, Math.round(h * (i + 1) / 4 + (i - 1) * 5), w, 2);
  g.globalAlpha = 1;
  let px = 30;
  const font = () => { g.font = `600 ${px}px "Trebuchet MS", system-ui, sans-serif`; };
  const widest = () => { let m = 0; for (const l of list) m = Math.max(m, g.measureText(l).width || 0); return m; };
  font();
  while (px > 14 && widest() > 236) { px -= 2; font(); }
  g.fillStyle = '#3b2a1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const pitch = px * 1.15, y0 = h / 2 - pitch * (list.length - 1) / 2;
  for (let i = 0; i < list.length; i++) g.fillText(list[i], w / 2, y0 + i * pitch);
}

export function buildDecorPack(T) {
  const noop = () => {};
  const realGeo = T.BufferGeometry.prototype.dispose, realMat = T.Material.prototype.dispose;
  const body = new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0 }); body.name = 'decorPack';
  const cloth = new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0, side: T.DoubleSide }); cloth.name = 'decorPackCloth';
  const textPlane = new T.PlaneGeometry(.82, .42);
  for (const x of [body, cloth, textPlane]) x.dispose = noop;

  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), sc = new T.Vector3();
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // add(parts, geometry, colour, x,y,z, rx,ry,rz, sx,sy,sz, jitter): bakes transform + vertex colour.
  function add(parts, geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, jitter = .05) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); sc.set(sx, sy, sz); m4.compose(p, q, sc); g.applyMatrix4(m4);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new T.Color(hex).multiplyScalar(1 + (rnd() - .5) * jitter * 2);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    parts.push(g);
  }
  function merge(parts) {
    let total = 0; for (const g of parts) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count; g.dispose();
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    geo.dispose = noop;
    return geo;
  }
  const kit = parts => ({
    box: (w, h, d, hex, x, y, z, rx, ry, rz) => add(parts, new T.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz),
    cyl: (rt, rb, h, seg, hex, x, y, z, rx, ry, rz, sx, sy, sz) => add(parts, new T.CylinderGeometry(rt, rb, h, seg), hex, x, y, z, rx, ry, rz, sx, sy, sz),
    ico: (r, hex, x, y, z, sx = 1, sy = 1, sz = 1) => add(parts, new T.IcosahedronGeometry(r, 0), hex, x, y, z, 0, 0, 0, sx, sy, sz),
    cone: (r, h, seg, hex, x, y, z, rx, ry, rz) => add(parts, new T.ConeGeometry(r, h, seg), hex, x, y, z, rx, ry, rz),
    quad: (pts, hex) => { // flat quad (x,y pairs at z=0), non-indexed
      const [a, b, c, d] = pts, arr = new Float32Array([...a, 0, ...b, 0, ...c, 0, ...a, 0, ...c, 0, ...d, 0]);
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(arr, 3)); g.computeVertexNormals();
      add(parts, g, hex, 0, 0, 0, 0, 0, 0, 1, 1, 1, .02);
    },
  });

  // Each builder returns { body: parts[], swing?: { parts[], at:[x,y,z], cloth? } }.
  const BUILD = {
    rug() {
      const b = [], { box, cyl } = kit(b);
      [[.8, .012, 0x6f9a4e], [.62, .016, 0xc9a96b], [.44, .02, 0x7fae5a], [.26, .024, 0xd8bb7c]]
        .forEach(([r, h, c]) => cyl(r, r, h, 24, c, 0, h / 2, 0, 0, 0, 0, 1, 1, .7));
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU, x = .82 * Math.sin(a), z = .82 * .7 * Math.cos(a);
        box(.04, .01, .08, 0xc9a96b, x, .005, z, 0, Math.atan2(x, z / .49), 0);
      }
      return { body: b };
    },
    pennant() {
      const b = [], f = [], { box, cyl, ico } = kit(b), F = kit(f);
      box(.3, .06, .3, 0x7a5a3a, 0, .03, 0);
      cyl(.035, .045, 2.4, 8, 0x8a6a45, 0, 1.23, 0);
      ico(.05, 0xd9b25a, 0, 2.45, 0);
      const Y = 2.14; // pivot height (geometry in pivot space)
      F.quad([[0, 2.32 - Y], [.9, 2.32 - Y], [.62, 2.14 - Y], [0, 2.14 - Y]], 0xd9583c);
      F.quad([[0, 2.14 - Y], [.62, 2.14 - Y], [.9, 1.96 - Y], [0, 1.96 - Y]], 0xf3d37c);
      return { body: b, swing: { parts: f, at: [0, Y, 0], cloth: true } };
    },
    fern() {
      const b = [], s = [], { box, cyl } = kit(b), S = kit(s);
      box(.4, .05, .4, 0x7a5a3a, -.45, .025, 0);
      cyl(.05, .06, 2, 8, 0x8a6a45, -.45, 1.02, 0);
      box(.72, .05, .05, 0x8a6a45, -.12, 1.97, 0);
      box(.3, .04, .04, 0x7a5a3a, -.34, 1.86, 0, 0, 0, Math.PI / 4);
      for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; S.box(.01, .35, .01, 0xd8c89a, Math.sin(a) * .09, -.18, Math.cos(a) * .09, -.47 * Math.cos(a), 0, .47 * Math.sin(a)); }
      S.cyl(.2, .14, .18, 10, 0xb08a55, 0, -.45, 0);
      S.cyl(.18, .18, .02, 10, 0x5b3d26, 0, -.37, 0);
      for (let i = 0; i < 7; i++) {
        const ry = i * TAU / 7, rz = 2.3, dx = -Math.sin(rz), dy = Math.cos(rz); // tip direction before ry
        const ox = dx * Math.cos(ry), oz = -dx * Math.sin(ry);
        S.cone(.07, .6, 3, i % 2 ? 0x6cab55 : 0x4f8f45, ox * (.05 + .3), -.38 + dy * .3, oz * (.05 + .3), 0, ry, rz);
      }
      return { body: b, swing: { parts: s, at: [.2, 1.95, 0] } };
    },
    chime() {
      const b = [], s = [], { box, cyl } = kit(b), S = kit(s);
      for (const x of [-.35, .35]) { cyl(.04, .045, 1.3, 8, 0x8a6a45, x, .65, 0); box(.12, .04, .3, 0x7a5a3a, x, .02, 0); }
      box(.8, .05, .06, 0x7a5a3a, 0, 1.3, 0);
      for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; S.box(.008, .12, .008, 0xd8c89a, Math.sin(a) * .06, -.06, Math.cos(a) * .06, -.5 * Math.cos(a), 0, .5 * Math.sin(a)); }
      S.cyl(.16, .16, .03, 10, 0xc9b48a, 0, -.12, 0);
      for (let i = 0; i < 5; i++) {
        const L = .28 + .035 * i, a = i / 5 * TAU, x = Math.sin(a) * .1, z = Math.cos(a) * .1;
        S.cyl(.015, .015, L, 6, 0xb8c2c4, x, -.14 - L / 2, z);
        S.ico(.035, 0xf3e4d0, x, -.14 - L - .02, z, 1, .4, 1);
      }
      add(s, new T.SphereGeometry(.03, 8, 6), 0xd9b25a, 0, -.3, 0);
      return { body: b, swing: { parts: s, at: [0, 1.27, 0] } };
    },
    hammock() {
      const b = [], { box, cyl } = kit(b);
      for (const v of [-.72, .72]) cyl(.05, .06, 1.15, 8, 0x8a6a45, v, .575, v);
      const R = -Math.PI / 4, c = Math.cos(R), sn = Math.sin(R), half = .72 * Math.SQRT2;
      const at = (lx, y, lz) => [lx * c + lz * sn, y, -lx * sn + lz * c]; // local diagonal frame -> tile (ry = R)
      for (let i = 0; i < 10; i++) {
        const s = (i + .5) / 10, lx = -half + 2 * half * s, y = .95 - .42 * Math.sin(Math.PI * s);
        const pitch = Math.atan(-.42 * Math.PI * Math.cos(Math.PI * s) / (2 * half));
        const [x, , z] = at(lx, 0, 0);
        box(.22, .02, .44 + .26 * Math.sin(Math.PI * s), i % 2 ? 0xc9a96b : 0xeadcae, x, y, z, 0, R, pitch); // gathers toward the ends (footprint)
      }
      for (const sgn of [-1, 1]) { // spreader + rope to the post top
        const [x, , z] = at(sgn * (half - .07), 0, 0);
        box(.04, .04, .46, 0x8a6a45, x, .96, z, 0, R, 0);
        box(.03, .2, .03, 0xd8c89a, sgn * .72, 1.06, sgn * .72);
      }
      { // pillow lies on the sloped cloth (same frame + pitch as the slats)
        const s = .14, lx = -half + 2 * half * s, [x, , z] = at(lx, 0, 0);
        const pitch = Math.atan(-.42 * Math.PI * Math.cos(Math.PI * s) / (2 * half));
        box(.24, .08, .36, 0x7fae5a, x, .95 - .42 * Math.sin(Math.PI * s) + .06, z, 0, R, pitch);
      }
      return { body: b };
    },
    pots() {
      const b = [], { box, cyl, ico, cone } = kit(b);
      const BLOOM = [0xf2c14e, 0xe86f8a, 0xfff4e0];
      [[.2, .14, .32, -.35, .1], [.16, .11, .24, .25, .25], [.24, .17, .44, .05, -.3]].forEach(([rt, rb, h, x, z], k) => {
        cyl(rt, rb, h, 12, 0xb8653d, x, h / 2, z);
        cyl(rt + .02, rt + .02, .04, 12, 0xd59a72, x, h - .02, z);
        cyl(rt - .01, rt - .01, .02, 12, 0x5b3d26, x, h - .025, z);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3 + k * .2) * TAU, ox = Math.sin(a) * rt * .4, oz = Math.cos(a) * rt * .4, tall = .25 * (.85 + .1 * i);
          box(.015, tall, .015, 0x5f9e4f, x + ox, h + tall / 2 - .02, z + oz, oz * .8, 0, -ox * .8);
          ico(.05, BLOOM[(i + k) % 3], x + ox * 1.25, h + tall - .01, z + oz * 1.25);
        }
        for (let i = 0; i < 2; i++) { const a = (i + .3 + k) * Math.PI; cone(.04, .2, 3, 0x6cab55, x + Math.sin(a) * .08, h + .06, z + Math.cos(a) * .08, .9 * Math.cos(a), 0, -.9 * Math.sin(a)); }
      });
      return { body: b };
    },
    sign() {
      const b = [], { box, cyl } = kit(b);
      box(.32, .06, .32, 0x7a5a3a, 0, .03, 0);
      cyl(.05, .06, 1.4, 8, 0x7a5a3a, 0, .7, -.06);
      [[.93, 0xb4824b], [1.09, 0xa97d4c], [1.25, 0xb98a55]].forEach(([y, c]) => box(.9, .16, .045, c, 0, y, 0));
      for (const x of [-.3, .3]) box(.05, .48, .02, 0x7a5a3a, x, 1.09, -.033);
      return { body: b, text: [0, 1.09, .026] };
    },
  };

  const built = new Map(); // type -> { body, swing, at, cloth, text }
  function get(type) {
    let m = built.get(type);
    if (m) return m;
    const r = BUILD[type]();
    m = { body: merge(r.body), swing: r.swing ? merge(r.swing.parts) : null, at: r.swing?.at ?? null, cloth: !!r.swing?.cloth, text: r.text ?? null };
    built.set(type, m);
    return m;
  }
  const mesh = (geo, mat) => { const o = new T.Mesh(geo, mat); o.castShadow = true; o.receiveShadow = true; return o; };

  return {
    TYPES, textPlane, paintSign,
    instance(type) {
      if (!BUILD[type]) return null;
      const m = get(type), g = new T.Group();
      g.name = 'decor_' + type; g.userData.decorType = type;
      g.add(mesh(m.body, body));
      if (m.swing) { const s = mesh(m.swing, m.cloth ? cloth : body); s.position.set(m.at[0], m.at[1], m.at[2]); s.name = 'swing'; g.add(s); g.userData.swing = s; }
      if (m.text) { const t = new T.Mesh(textPlane, body); t.position.set(m.text[0], m.text[1], m.text[2]); t.visible = false; t.castShadow = false; t.receiveShadow = true; t.name = 'text'; g.add(t); g.userData.text = t; }
      return g;
    },
    stats() {
      const meshes = {};
      for (const [type, m] of built) meshes[type] = 1 + (m.swing ? 1 : 0) + (m.text ? 1 : 0);
      return { built: [...built.keys()], meshes };
    },
    dispose() {
      for (const m of built.values()) { realGeo.call(m.body); if (m.swing) realGeo.call(m.swing); }
      built.clear();
      realGeo.call(textPlane); realMat.call(body); realMat.call(cloth);
    },
  };
}
