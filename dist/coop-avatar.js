// Remote co-op player avatar: the brother's body, driven by interpolated pose snapshots.
// createRemoteAvatar(T, {color, name}) -> { group, update(dt, s, time, camera?), handWorld(out), setName(str), dispose() }
//   s = {x,y,z,yaw,pitch,speed,swimming,grounded,held,charge,reeling,hookOut,stage,emote:{kind,age}|null,throwAge}
//   s.y is the FEET height (physics eye y - EYE_OFFSET). Avatar faces yaw + PI like the local player model.
// Built on createAvatar (./avatar.js). Held items are tiny own low-poly models (~40-250 tris each; the
// first-person hook/hammer/rod factories are 6-13k tris, too heavy for a third-person prop), built lazily
// and cached per kind. update() allocates nothing. Name tag needs a DOM (or OffscreenCanvas); skipped in Node.
// Draw calls: createAvatar's 36 meshes are baked into one mesh per rigid pivot (body, legs, arms, head+hat)
// with per-vertex colour + roughness on one shared material (exact same shading), plus the emissive eye shine
// and the flat-shaded straw: 8 meshes instead of 36. Pivots in body.userData.parts stay animatable.
import { createAvatar } from './avatar.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
const EMOTE_LEN = 1.6, SWING = 0.16, RECOVER = 0.45, PULL_BACK = -3.45;

export function createRemoteAvatar(T, { color = '#70a7e4', name = 'Brother' } = {}) {
  const group = new T.Group();
  group.name = 'remoteAvatar';
  const body = createAvatar(T, color);          // bob / lean happen on body, world pose on group
  group.add(body);
  const P = body.userData.parts;
  const baked = bakeAvatar(T, body);

  // ---------------------------------------------------------------- held item models (own art)
  const geos = [], mats = [];
  const G = (g) => (geos.push(g), g);
  const M = (c, o) => { const m = new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.8, flatShading: true }, o)); mats.push(m); return m; };
  let MAT = null;   // shared item palette, created on first held item
  const mat = () => MAT || (MAT = {
    wood: M('#9a6b3f'), woodDark: M('#6e4a2b'), steel: M('#9fb3b6', { metalness: 0.6, roughness: 0.4 }),
    rope: M('#c9a76a'), leaf: M('#5fae4a'), leafDark: M('#3f8a3a'), scrap: M('#8c969a', { metalness: 0.5, roughness: 0.5 }),
    rust: M('#a8643a'), plastic: M('#dfeef5', { roughness: 0.5 }), cap: M('#e2574c'), cloth: M('#f3ead2'),
    glow: M('#ffd27a', { emissive: '#ffb347', emissiveIntensity: 1.2 }), net: M('#d9c48f', { side: T.DoubleSide, transparent: true, opacity: 0.7 }),
  });
  // part(parent, geometry, material, x,y,z, rx,ry,rz)
  const part = (p, g, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const o = new T.Mesh(G(g), m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); p.add(o); return o;   // tiny props: no shadow pass
  };
  const Cyl = (r0, r1, h, n = 6) => new T.CylinderGeometry(r0, r1, h, n);
  const Box = (x, y, z) => new T.BoxGeometry(x, y, z);
  // Every model: grip at origin, long axis +Y (holder turns +Y forward/up). tip = rope/line attach point.
  const BUILD = {
    hook(g, K) {
      part(g, Cyl(0.028, 0.03, 0.24), K.wood, 0, 0.04);
      part(g, Cyl(0.032, 0.032, 0.06), K.rope, 0, 0.02);
      part(g, Cyl(0.012, 0.012, 0.2, 5), K.steel, 0, 0.26);
      part(g, new T.TorusGeometry(0.07, 0.013, 4, 9, Math.PI * 1.25), K.steel, -0.07, 0.36, 0, 0, 0, -0.1);
      part(g, new T.ConeGeometry(0.018, 0.06, 5), K.steel, -0.14, 0.31, 0, 0, 0, Math.PI);
      return [0, 0.15, 0];
    },
    hammer(g, K) {
      part(g, Cyl(0.022, 0.026, 0.4), K.wood, 0, 0.1);
      part(g, Cyl(0.03, 0.03, 0.1), K.rope, 0, 0.0);
      part(g, Box(0.06, 0.07, 0.15), K.steel, 0, 0.3, 0.03);
      part(g, Box(0.05, 0.03, 0.1), K.steel, 0, 0.31, -0.08, -0.5);
      return [0, 0.3, 0.1];
    },
    fishingrod(g, K) {
      part(g, Cyl(0.026, 0.03, 0.26), K.woodDark, 0, 0.0);
      part(g, Cyl(0.006, 0.016, 1.0, 5), K.wood, 0, 0.63);
      const reel = part(g, Cyl(0.04, 0.04, 0.03, 8), K.steel, 0, 0.12, 0.045, 0, 0, Math.PI / 2);
      g.userData.reel = reel;
      return [0, 1.13, 0];
    },
    wood(g, K) { part(g, Box(0.13, 0.5, 0.035), K.wood, 0, 0.12); part(g, Box(0.135, 0.03, 0.04), K.woodDark, 0, 0.3); return [0, 0.12, 0]; },
    leaf(g, K) {
      part(g, Cyl(0.006, 0.008, 0.16, 4), K.leafDark, 0, 0.04);
      const l = part(g, new T.SphereGeometry(0.1, 6, 4), K.leaf, 0, 0.2); l.scale.set(0.8, 1.6, 0.18);
      return [0, 0.2, 0];
    },
    scrap(g, K) { part(g, Box(0.2, 0.16, 0.02), K.scrap, 0, 0.06, 0, 0, 0, 0.25); part(g, Box(0.12, 0.08, 0.022), K.rust, 0.04, 0.1, 0.004, 0, 0, 0.4); return [0, 0.06, 0]; },
    plastic(g, K) { part(g, Cyl(0.07, 0.08, 0.2, 8), K.plastic, 0, 0.1); part(g, Cyl(0.03, 0.03, 0.04, 6), K.cap, 0, 0.22); return [0, 0.1, 0]; },
    sail(g, K) { part(g, Cyl(0.06, 0.06, 0.42, 7), K.cloth, 0, 0.12); part(g, Cyl(0.065, 0.065, 0.04, 7), K.rope, 0, 0.12); part(g, Cyl(0.012, 0.012, 0.52, 4), K.woodDark, 0.05, 0.12); return [0, 0.12, 0]; },
    palm(g, K) {
      part(g, Cyl(0.08, 0.06, 0.12, 7), K.rust, 0, 0.05); part(g, Cyl(0.014, 0.018, 0.2, 4), K.wood, 0, 0.18);
      for (let i = 0; i < 3; i++) part(g, new T.ConeGeometry(0.035, 0.18, 4), K.leaf, Math.cos(i * 2.1) * 0.06, 0.29, Math.sin(i * 2.1) * 0.06, Math.sin(i * 2.1) * 0.9, 0, -Math.cos(i * 2.1) * 0.9);
      return [0, 0.15, 0];
    },
    lantern(g, K) {
      part(g, new T.TorusGeometry(0.04, 0.007, 3, 8), K.steel, 0, 0.01);
      part(g, Box(0.1, 0.02, 0.1), K.woodDark, 0, -0.05); part(g, Box(0.1, 0.02, 0.1), K.woodDark, 0, -0.19);
      part(g, new T.SphereGeometry(0.042, 6, 4), K.glow, 0, -0.12);
      return [0, -0.12, 0];
    },
    net(g, K) { part(g, Cyl(0.012, 0.012, 0.3, 4), K.wood, 0, 0.08); part(g, new T.TorusGeometry(0.11, 0.012, 3, 10), K.rope, 0, 0.33); part(g, new T.CircleGeometry(0.105, 8), K.net, 0, 0.33); return [0, 0.33, 0]; },
    bench(g, K) { part(g, Box(0.34, 0.03, 0.12), K.wood, 0, 0.1, 0, Math.PI / 2); part(g, Box(0.03, 0.1, 0.1), K.woodDark, 0.13, 0.1, -0.06); part(g, Box(0.03, 0.1, 0.1), K.woodDark, -0.13, 0.1, -0.06); return [0, 0.1, 0]; },
    crate(g, K) { part(g, Box(0.24, 0.24, 0.24), K.wood, 0, 0.1); part(g, Box(0.25, 0.04, 0.25), K.woodDark, 0, 0.1); return [0, 0.1, 0]; },
  };
  // Holder sits in the right hand; carry items sit upright-ish, tools point forward.
  const holder = new T.Group();
  holder.position.set(0, -0.5, 0.03);
  P.rightArm.add(holder);
  const TOOL_TILT = { hook: 1.25, hammer: 1.35, fishingrod: 0.95, lantern: 1.45 };
  const cache = new Map();
  let curKind, cur = null;
  const getModel = (kind) => {
    if (cache.has(kind)) return cache.get(kind);
    const b = BUILD[kind];
    let entry = null;
    if (b) {
      const g = new T.Group(); g.name = 'held_' + kind;
      const t = b(g, mat());
      const tip = new T.Object3D(); tip.position.set(t[0], t[1], t[2]); g.add(tip);
      if (kind === 'hook') g.scale.setScalar(1.3);
      g.rotation.x = TOOL_TILT[kind] !== undefined ? TOOL_TILT[kind] : 1.5;
      g.visible = false; holder.add(g);
      entry = { g, tip, reel: g.userData.reel || null };
    }
    cache.set(kind, entry);
    return entry;
  };

  // ---------------------------------------------------------------- name tag (canvas sprite)
  let canvas = null, ctx = null, tex = null, tag = null, tagMat = null;
  if (typeof document !== 'undefined' && document.createElement) canvas = document.createElement('canvas');
  else if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(256, 64);
  if (canvas) {
    canvas.width = 256; canvas.height = 64; ctx = canvas.getContext('2d');
    tex = new T.CanvasTexture(canvas); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    tagMat = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
    tag = new T.Sprite(tagMat); tag.center.set(0.5, 0); tag.renderOrder = 20; // after water
    tag.position.set(0, 2.08, 0); tag.scale.set(0.8, 0.2, 1);
    group.add(tag);
  }
  const dot = '#' + new T.Color(color).getHexString();
  function setName(str) {
    if (!ctx) return;
    const label = String(str || 'Brother').slice(0, 16);
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 30px system-ui, -apple-system, Segoe UI, sans-serif';
    const w = Math.min(248, ctx.measureText(label).width + 62), x0 = (256 - w) / 2;
    ctx.fillStyle = 'rgba(18,32,48,0.78)';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, 8, w, 48, 24) : ctx.rect(x0, 8, w, 48); ctx.fill();
    ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(x0 + 26, 32, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.fillText(label, x0 + 44, 33, w - 54);
    tex.needsUpdate = true;
  }
  setName(name);

  // ---------------------------------------------------------------- animation state
  const A = { lLx: 0, lLz: 0, rLx: 0, laX: 0, laZ: 0.12, raX: 0, raZ: -0.12, head: 0, lean: 0, bob: 0, swim: 0, emote: 0 };
  let phase = 0, emoteKind = 'wave', crank = 0;
  const camPos = new T.Vector3();

  function update(dt, s, time = 0, camera = null) {
    dt = clamp(dt || 0, 0, 0.1);
    group.position.set(s.x || 0, s.y || 0, s.z || 0);
    group.rotation.y = (s.yaw || 0) + Math.PI;
    const speed = s.swimming ? Math.min(s.speed || 0, 3) : (s.speed || 0);
    const pitch = clamp(s.pitch || 0, -1.3, 1.3);
    A.swim = damp(A.swim, s.swimming ? 1 : 0, 5, dt);
    const sw = A.swim, air = !s.swimming && s.grounded === false ? 1 : 0;

    // walk cycle: stride phase advances with ground speed, amplitude grows with speed
    const amp = clamp(speed / 3.5, 0, 1) * (1 - sw) * (1 - air);
    phase += dt * (2.2 + speed * 2.1);
    const sn = Math.sin(phase) * amp;
    let lL = sn * 0.7, rL = -sn * 0.7;
    lL = lerp(lL, Math.sin(time * 7) * 0.35, sw); rL = lerp(rL, -Math.sin(time * 7) * 0.35, sw);
    if (air) { lL = -0.45; rL = 0.25; }
    const idle = Math.sin(time * 1.7) * 0.035;             // gentle breathing sway
    let laX = -sn * 0.55, laZ = 0.12 + idle, raX = sn * 0.55, raZ = -0.12 - idle;
    // swimming: slow breast-stroke on free arms
    const st = Math.sin(time * 2.4);
    laX = lerp(laX, -1.2 + st * 0.3, sw); laZ = lerp(laZ, 0.5 + st * 0.45, sw);
    raX = lerp(raX, -1.2 + st * 0.3, sw); raZ = lerp(raZ, -0.5 - st * 0.45, sw);

    // held item swap (cached models, hide previous)
    const kind = s.held || null;
    if (kind !== curKind) {
      if (cur) cur.g.visible = false;
      cur = kind ? getModel(kind) : null; curKind = kind;
      if (cur) cur.g.visible = true;
    }
    if (cur) {
      cur.g.visible = !(curKind === 'hook' && s.hookOut);        // rope module draws the flying hook
      raX = lerp(raX * 0.4 - 0.35, raX, sw);                    // hold it forward a bit
    }
    // reeling: both hands forward, alternating hand-over-hand crank
    if (s.reeling) {
      crank += dt * 11;
      if (cur && cur.reel) cur.reel.rotation.y = crank * 2;
      raX = -1.05 + Math.sin(crank) * 0.28; raZ = -0.12 - Math.cos(crank) * 0.12;
      laX = -1.05 - Math.sin(crank) * 0.28; laZ = 0.2 + Math.cos(crank) * 0.1;
    }
    // charge: right arm cocks up and back over the shoulder, left arm reaches forward for balance
    const c = smooth(s.charge || 0);
    raX = lerp(raX, PULL_BACK, c); raZ = lerp(raZ, -0.3, c); laX = lerp(laX, -0.9, c);
    let lean = -0.12 * c + 0.3 * sw;
    // throw: fast overhand swing from the cocked pose, then ease back
    const ta = s.throwAge;
    if (ta !== null && ta !== undefined && ta >= 0 && ta < SWING + RECOVER) {
      const w = ta < SWING ? 1 : 1 - smooth((ta - SWING) / RECOVER);
      const p = clamp(ta / SWING, 0, 1), e = 1 - (1 - p) * (1 - p) * (1 - p);
      raX = lerp(raX, lerp(PULL_BACK, -0.6, e), w); raZ = lerp(raZ, -0.15, w);
      lean = lerp(lean, lerp(-0.12, 0.18, e), w);
    }
    // emotes override the right arm, blended in/out
    const em = s.emote;
    let ew = 0;
    if (em && em.age >= 0 && em.age < EMOTE_LEN) { emoteKind = em.kind; ew = smooth(em.age / 0.2) * (1 - smooth((em.age - EMOTE_LEN + 0.3) / 0.3)); }
    A.emote = damp(A.emote, ew, 14, dt);
    if (A.emote > 0.001) {
      const w = A.emote;
      if (emoteKind === 'point') { raX = lerp(raX, -Math.PI / 2 - pitch, w); raZ = lerp(raZ, -0.04, w); }
      else { raX = lerp(raX, -0.25, w); raZ = lerp(raZ, -2.65 + Math.sin(time * 11) * 0.35, w); }
    }

    // apply with light damping (fast enough for the swing, kills pops on state changes)
    const k = 22;
    A.lLx = damp(A.lLx, lL, k, dt); A.rLx = damp(A.rLx, rL, k, dt);
    A.laX = damp(A.laX, laX, k, dt); A.laZ = damp(A.laZ, laZ, k, dt);
    A.raX = damp(A.raX, raX, ta !== null && ta !== undefined && ta < SWING ? 60 : k, dt); A.raZ = damp(A.raZ, raZ, k, dt);
    A.head = damp(A.head, -pitch * 0.75, 12, dt); A.lean = damp(A.lean, lean, 10, dt);
    P.leftLeg.rotation.x = A.lLx; P.rightLeg.rotation.x = A.rLx;
    P.leftArm.rotation.set(A.laX, 0, A.laZ); P.rightArm.rotation.set(A.raX, 0, A.raZ);
    P.head.rotation.x = A.head - A.lean * 0.6;
    body.rotation.x = A.lean;
    const bob = Math.abs(Math.sin(phase)) * 0.045 * amp + sw * (Math.sin(time * 2.1) * 0.06 - 0.05);
    body.position.y = damp(body.position.y, bob, 20, dt);

    // name tag: ~constant screen size, fades beyond 40 m
    if (tag) {
      let d = 6;
      if (camera) { camPos.setFromMatrixPosition(camera.matrixWorld); d = camPos.distanceTo(group.position); }
      const h = clamp(d * 0.034, 0.17, 2.2);
      tag.scale.set(h * 4, h, 1);
      tagMat.opacity = 1 - smooth((d - 40) / 10);
      tag.visible = tagMat.opacity > 0.01;
    }
  }

  // world position of the held item's tip (rope / line attach); hand when nothing or hook is out
  function handWorld(out) {
    const node = cur && cur.g.visible ? cur.tip : holder;
    node.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(node.matrixWorld);
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    body.userData.dispose(); baked.dispose();
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    geos.length = mats.length = 0; cache.clear(); cur = null;
    if (tex) tex.dispose();
    if (tagMat) tagMat.dispose();
  }

  return { group, update, handWorld, setName, dispose };
}

// ---------------------------------------------------------------- avatar draw-call baking
// Merge every mesh that hangs (directly, or via a rigid sub-group such as the hat) off one pivot into one
// geometry per material class. Plain MeshStandardMaterials that differ only in colour/roughness share one
// material driven by vertex colour + a per-vertex roughness attribute; anything else (emissive, flat
// shading, ...) merges per original material. Bakes positions/normals with the local matrices.
const PLAIN = (m) => m.isMeshStandardMaterial && !m.flatShading && !m.map && !m.transparent && m.metalness === 0 &&
  m.emissive.r === 0 && m.emissive.g === 0 && m.emissive.b === 0;

function bakeAvatar(T, body) {
  const P = body.userData.parts;
  const pivots = [body, P.head, P.leftArm, P.rightArm, P.leftLeg, P.rightLeg];
  const owned = [];
  const shared = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0 });
  shared.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float rough;\nvarying float vRough;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvRough = rough;');
    sh.fragmentShader = 'varying float vRough;\n' +
      sh.fragmentShader.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;');
  };
  shared.customProgramCacheKey = () => 'coopAvatarVertexRough';
  owned.push(shared);
  const m4 = new T.Matrix4(), n3 = new T.Matrix3(), v = new T.Vector3();

  for (const pivot of pivots) {
    const buckets = new Map();   // material -> [{mesh, matrix}]
    const collect = (node, parentM) => {
      for (const c of node.children.slice()) {
        if (pivots.includes(c)) continue;
        c.updateMatrix();
        const m = parentM ? parentM.clone().multiply(c.matrix) : c.matrix.clone();
        if (c.isMesh) {
          const key = PLAIN(c.material) ? shared : c.material;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push({ mesh: c, m });
          node.remove(c);
        } else if (c.children.length) collect(c, m);   // rigid sub-group (hat): its meshes bake into the pivot
      }
    };
    collect(pivot, null);
    for (const [mat, list] of buckets) {
      let nv = 0, ni = 0;
      for (const { mesh } of list) { const g = mesh.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
      const col = mat === shared ? new Float32Array(nv * 3) : null, rough = mat === shared ? new Float32Array(nv) : null;
      const idx = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
      let vo = 0, io = 0;
      for (const { mesh, m } of list) {
        const g = mesh.geometry, gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv, n = gp.count;
        n3.getNormalMatrix(m);
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(gp, i).applyMatrix4(m); v.toArray(pos, (vo + i) * 3);
          v.fromBufferAttribute(gn, i).applyMatrix3(n3).normalize(); v.toArray(nor, (vo + i) * 3);
          if (gu) { uv[(vo + i) * 2] = gu.getX(i); uv[(vo + i) * 2 + 1] = gu.getY(i); }
          if (col) { const c = mesh.material.color; col[(vo + i) * 3] = c.r; col[(vo + i) * 3 + 1] = c.g; col[(vo + i) * 3 + 2] = c.b; rough[vo + i] = mesh.material.roughness; }
        }
        if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
        else for (let i = 0; i < n; i++) idx[io++] = i + vo;
        vo += n;
      }
      const geo = new T.BufferGeometry();
      geo.setIndex(new T.BufferAttribute(idx, 1));
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      if (col) { geo.setAttribute('color', new T.BufferAttribute(col, 3)); geo.setAttribute('rough', new T.BufferAttribute(rough, 1)); }
      geo.computeBoundingSphere();
      owned.push(geo);
      const merged = new T.Mesh(geo, mat);
      merged.name = 'baked_' + (pivot.name || 'part') + (mat === shared ? '' : '_' + list.length);
      merged.castShadow = mat === shared || !!mat.flatShading;   // body/limbs/head + straw hat; not the eye shine
      merged.receiveShadow = true;
      pivot.add(merged);
    }
  }
  return { dispose() { for (const o of owned) o.dispose(); owned.length = 0; } };
}
