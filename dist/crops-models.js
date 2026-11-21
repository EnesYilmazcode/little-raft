// Garden Bed model and crop stage meshes (see docs/specs/crops.md). Given THREE, imports nothing.
// Local origin = centre of the floor tile top (game.js places decor at y = .22).
// Static parts are baked into vertex-coloured geometries; geometries and materials are cached per THREE
// and shared by every bed, so paintBed only swaps references (no allocation after the first use).

const SOIL_Y = .25, SLOTS = [[-.19, -.16], [.19, .16]], STAGE_SCALE = [.5, .75, 1];
export const SOIL_DRY = '#9a7552', SOIL_WET = '#3e2a1c';
export const CROP_INDEX = Object.freeze({ flax: 1, bell: 2, tuber: 3 });

function bake(T, parts) { // [geometry, hex, matrix] -> one non-indexed geometry with a colour attribute
  const geos = []; let n = 0;
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
  const parts = [], e = new T.Euler(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3();
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); s.set(sx, sy, sz);
    parts.push([geo, hex, new T.Matrix4().compose(p, q, s)]);
  };
  return { parts, add };
}

// One plant at the origin (soil level y = 0), full size. ripe adds the flowers / bells / root.
function plantParts(T, add, c, ripe, seedRot) {
  if (c === 'flax') {
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4 + seedRot, r = i ? .045 : 0, h = .34 + (i * 7 % 5) * .025, lean = i ? .14 : 0;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      add(new T.CylinderGeometry(.006, .009, h, 5), '#5f9a8a', x + Math.cos(a) * lean * h / 2, h / 2, z + Math.sin(a) * lean * h / 2, Math.sin(a) * lean, 0, -Math.cos(a) * lean);
      add(new T.SphereGeometry(.018, 5, 3), '#7fb5a0', x + Math.cos(a) * lean * h * .4, h * .4, z + Math.sin(a) * lean * h * .4, 0, a, 0, .5, 1.6, .5); // leaf
      if (ripe) {
        const tx = x + Math.cos(a) * lean * h, tz = z + Math.sin(a) * lean * h;
        for (let k = 0; k < 5; k++) { const b = k * Math.PI * 2 / 5; add(new T.SphereGeometry(.016, 6, 4), '#a9c8f0', tx + Math.cos(b) * .016, h + .005, tz + Math.sin(b) * .016, 0, -b, 0, 1, .4, .7); }
        add(new T.SphereGeometry(.008, 5, 3), '#f5e7a0', tx, h + .01, tz);
      }
    }
  } else if (c === 'bell') {
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + seedRot; add(new T.SphereGeometry(.07, 7, 4), i % 2 ? '#4f8f4a' : '#5fa356', Math.cos(a) * .06, .03, Math.sin(a) * .06, 0, -a, .25, 1.1, .3, .55); }
    add(new T.SphereGeometry(.04, 7, 4), '#6cb862', 0, .05, 0, 0, 0, 0, 1, .7, 1);
    if (ripe) {
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + seedRot + .5;
        add(new T.CylinderGeometry(.006, .008, .24, 5), '#3f7f45', Math.cos(a) * .03, .14, Math.sin(a) * .03, Math.sin(a) * .2, 0, -Math.cos(a) * .2);
        for (let k = 0; k < 3; k++) {
          const t = .55 + k * .2, bx = Math.cos(a) * (.03 + .05 * t + .03 * k), bz = Math.sin(a) * (.03 + .05 * t + .03 * k);
          add(new T.ConeGeometry(.038, .06, 8, 1, false), '#ff6fa3', bx, .2 - k * .035, bz, Math.PI, 0, 0);
          add(new T.SphereGeometry(.02, 6, 4), '#ffb3cf', bx, .225 - k * .035, bz);
        }
      }
    }
  } else if (c === 'tuber') {
    add(new T.SphereGeometry(.09, 8, 5), '#6e4e34', 0, 0, 0, 0, 0, 0, 1.2, .45, 1.1); // mound
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + seedRot, h = .16 + (i % 3) * .03;
      add(new T.CylinderGeometry(.006, .008, h, 5), '#4f8a3c', Math.cos(a) * .03, h / 2, Math.sin(a) * .03, Math.sin(a) * .3, 0, -Math.cos(a) * .3);
      add(new T.SphereGeometry(.05, 7, 4), i % 2 ? '#6aa04a' : '#7cb85a', Math.cos(a) * (.03 + h * .3), h + .005, Math.sin(a) * (.03 + h * .3), 0, -a, .35, 1.1, .22, .7);
    }
    if (ripe) {
      add(new T.SphereGeometry(.055, 9, 6), '#e8873a', .07, .02, .03, 0, .4, .6, 1.5, .85, .85);
      add(new T.SphereGeometry(.04, 8, 5), '#d9773a', -.06, .015, -.05, 0, -.6, -.5, 1.4, .8, .8);
    }
  }
}

const CACHE = new WeakMap(); // THREE namespace -> shared geometries and materials
function shared(T) {
  let c = CACHE.get(T); if (c) return c;
  const body = new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0 });
  const dry = new T.MeshStandardMaterial({ color: SOIL_DRY, roughness: .95, metalness: 0 });
  const wet = new T.MeshStandardMaterial({ color: SOIL_WET, roughness: .45, metalness: .1 });
  const { parts, add } = kit(T);
  const W = .9, H = .28, th = .06;
  for (const sx of [-1, 1]) add(new T.BoxGeometry(th, H, W), '#a07850', sx * (W - th) / 2, H / 2, 0);
  for (const sz of [-1, 1]) add(new T.BoxGeometry(W - th * 2, H, th), '#b08858', 0, H / 2, sz * (W - th) / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new T.BoxGeometry(.08, H + .03, .08), '#7a5a3a', sx * (W / 2 - .03), (H + .03) / 2, sz * (W / 2 - .03));
  add(new T.BoxGeometry(W - .02, .02, .07), '#c29a68', 0, H + .01, -(W - th) / 2); // top rails
  add(new T.BoxGeometry(W - .02, .02, .07), '#c29a68', 0, H + .01, (W - th) / 2);
  const frame = bake(T, parts);
  const soil = new T.BoxGeometry(W - th * 2, .04, W - th * 2).translate(0, SOIL_Y - .02, 0);
  const plants = new Map();
  for (const o of [body, dry, wet, frame, soil]) o.userData.shared = true; // game.js disposeGeometry skips them on rebuildRaft
  c = { body, dry, wet, frame, soil, plants }; CACHE.set(T, c);
  return c;
}

// Baked geometry for both slots of crop c at stage s (cached).
function plantGeo(T, sh, c, s) {
  const key = c + s;
  let g = sh.plants.get(key); if (g) return g;
  const { parts, add } = kit(T);
  const k = kit(T);
  plantParts(T, k.add, c, s === 2, 0);
  const one = bake(T, k.parts);
  const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), sc = new T.Vector3();
  SLOTS.forEach(([x, z], i) => {
    const geo = one.clone();
    q.setFromAxisAngle(new T.Vector3(0, 1, 0), i * 2.2); p.set(x, SOIL_Y, z); sc.setScalar(STAGE_SCALE[s] * (i ? .92 : 1));
    geo.applyMatrix4(m.compose(p, q, sc));
    parts.push([geo, null, null]);
  });
  one.dispose();
  // merge the two slot copies, keeping their colours
  let n = 0; for (const [geo] of parts) n += geo.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const [geo] of parts) { pos.set(geo.attributes.position.array, o * 3); nor.set(geo.attributes.normal.array, o * 3); col.set(geo.attributes.color.array, o * 3); o += geo.attributes.position.count; geo.dispose(); }
  g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeBoundingSphere(); g.userData.shared = true;
  sh.plants.set(key, g);
  return g;
}

export function createGardenBed(T) {
  const sh = shared(T);
  const g = new T.Group(); g.name = 'craft_gardenbed';
  const frame = new T.Mesh(sh.frame, sh.body); frame.name = 'bedFrame'; frame.castShadow = true; frame.receiveShadow = true;
  const soil = new T.Mesh(sh.soil, sh.dry); soil.name = 'bedSoil'; soil.receiveShadow = true;
  const crop = new T.Mesh(sh.soil, sh.body); crop.name = 'bedCrop'; crop.visible = false; crop.castShadow = true;
  g.add(frame, soil, crop);
  g.userData.T = T; g.userData.soil = soil; g.userData.crop = crop; g.userData.sig = -1;
  return g;
}

/** Signature of what a bed shows: crop index * 10 + stage * 2 + wet (0 = empty and dry). */
export function bedSig(c, s, wet) { return (CROP_INDEX[c] ?? 0) * 10 + (CROP_INDEX[c] ? s * 2 : 0) + (wet ? 1 : 0); }

/** Show entry {c, stage, wet} (or null = empty dry bed) on a createGardenBed group. Repaints only on a new signature. */
export function paintBed(group, entry) {
  const u = group && group.userData; if (!u || !u.soil) return false;
  const c = entry && CROP_INDEX[entry.c] ? entry.c : null, s = c ? Math.min(2, Math.max(0, entry.stage | 0)) : 0, wet = !!(entry && entry.wet);
  const sig = bedSig(c, s, wet);
  if (sig === u.sig) return false;
  u.sig = sig;
  const sh = shared(u.T);
  u.soil.material = wet ? sh.wet : sh.dry;
  if (c) { u.crop.geometry = plantGeo(u.T, sh, c, s); u.crop.visible = true; } else u.crop.visible = false;
  return true;
}
